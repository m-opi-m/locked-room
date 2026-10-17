/* ---------- 1.21: "نسمع معًا" — تشغيل أغنية متزامنة عند الطرفين (بيتضم جوه closure بتاع app.js وقت الـ build زي files.js) ----------
   الفكرة: اللي بيختار الملف بيبعته مشفّر (أجزاء 1 ميجا، رسايل مؤقتة p:0 مش بتتخزّن على السيرفر) للطرف التاني.
   لما الطرف التاني يخلّص استلام بيبعت "ready" فالاتنين يبدأوا التشغيل مع بعض. بعد كده أي حد فيهم يقدر يشغّل/يوقف/يقدّم/يأخّر
   وبيتبعت للتاني. التحكم بيظهر كمان في إشعار الموبايل (Media Session) والصوت بيكمّل في الخلفية.
   ⚠️ السيرفر بيقفل السوكت لو أكتر من 40 رسالة في 10 ثواني، فالأجزاء بتتبعت بمعدّل ~2.5/ثانية. */
const LRM_CHUNK = 1024 * 1024, LRM_MAX = 50 * 1024 * 1024;
const lrmT = (ar, en) => (document.documentElement.lang === "en" ? en : ar);
let lrmS = null, lrmAudio = null, lrmUrl = "", lrmPick = null, lrmLastPos = 0;
const lrmBar = () => t("musicBar");
const lrmId = (x) => typeof x === "string" && /^[a-f0-9]{16}$/.test(x);
const lrmTime = (s) => { s = Math.max(0, Math.floor(Number(s) || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const lrmTitle = (nm) => String(nm || "").replace(/\.[A-Za-z0-9]{1,5}$/, "").slice(0, 120) || lrmT("أغنية", "Track");

function lrmSend(obj) { // رسالة مشفّرة مؤقتة للطرف التاني
  if (!u || u.readyState !== 1 || !te) return Promise.resolve(false);
  return Ee({ k: "music", ...obj }).then((enc) => { u.send(JSON.stringify({ ...enc, p: 0 })); return true; }).catch(() => false);
}
function lrmEnsureAudio() {
  if (lrmAudio) return lrmAudio;
  const a = lrmAudio = new Audio();
  a.preload = "auto"; a.setAttribute("playsinline", "");
  a.addEventListener("timeupdate", lrmUi);
  a.addEventListener("play", lrmUi); a.addEventListener("pause", lrmUi);
  a.addEventListener("loadedmetadata", lrmUi); a.addEventListener("durationchange", lrmUi);
  a.addEventListener("ended", () => { a.currentTime = 0; lrmUi(); });
  a.addEventListener("error", () => { if (lrmS && lrmS.ready) { lrmToast(lrmT("الصيغة دي مش بتشتغل على الجهاز ده", "This format can't be played on this device")); } });
  return a;
}
function lrmToast(m) { try { lrToast(m); } catch {} }

/* ===== الواجهة + إشعار التحكم ===== */
function lrmUi() {
  const bar = lrmBar(); if (!bar) return;
  if (!lrmS) { bar.classList.add("hidden"); document.body.classList.remove("musicOn"); return; }
  bar.classList.remove("hidden"); document.body.classList.add("musicOn");
  const a = lrmAudio, s = lrmS;
  t("musicName").textContent = lrmTitle(s.nm);
  const rng = t("musicSeek"), prog = s.ready ? null : s.progress || 0;
  let sub;
  if (!s.ready) sub = s.mine
    ? (s.sent >= s.n ? lrmT("بانتظار الطرف التاني…", "Waiting for the other person…") : lrmT("جاري إرسال الأغنية ", "Sending ") + Math.floor((s.sent / s.n) * 100) + "%")
    : lrmT("جاري استلام الأغنية ", "Receiving ") + Math.floor((s.got / s.n) * 100) + "%";
  else sub = lrmT("نسمع معًا · ", "Listening together · ") + lrmTime(a.currentTime) + " / " + lrmTime(a.duration);
  t("musicSub").textContent = sub;
  const dur = a && isFinite(a.duration) ? a.duration : 0;
  rng.disabled = !s.ready || !dur; rng.max = 1000; rng.value = dur && s.ready ? Math.round((a.currentTime / dur) * 1000) : prog ? prog * 10 : 0;
  rng.style.setProperty("--p", (rng.value / 10) + "%");
  const playing = s.ready && a && !a.paused;
  t("musicPlay").innerHTML = uiIcon(playing ? "pause" : "play");
  t("musicPlay").disabled = !s.ready;
  t("musicPlay").setAttribute("aria-label", playing ? lrmT("إيقاف مؤقت", "Pause") : lrmT("تشغيل", "Play"));
  lrmMedia(playing);
}
function lrmMedia(playing) {
  if (!("mediaSession" in navigator) || !lrmS || !lrmS.ready) return;
  const ms = navigator.mediaSession;
  try { ms.playbackState = playing ? "playing" : "paused"; } catch {}
  const a = lrmAudio;
  if (a && isFinite(a.duration) && a.duration > 0 && Date.now() - lrmLastPos > 900) {
    lrmLastPos = Date.now();
    try { ms.setPositionState({ duration: a.duration, playbackRate: 1, position: Math.min(a.currentTime, a.duration) }); } catch {}
  }
}
function lrmMediaInit() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({
      title: lrmTitle(lrmS.nm), artist: lrmT("نسمع معًا · Locked Room", "Listening together · Locked Room"), album: "Locked Room",
      artwork: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/app-icon.png", sizes: "512x512", type: "image/png" }],
    });
  } catch {}
  const set = (n, f) => { try { ms.setActionHandler(n, f); } catch {} };
  set("play", () => lrmPlay(true)); set("pause", () => lrmPlay(false));
  set("seekto", (d) => { if (d && typeof d.seekTime === "number") lrmSeek(d.seekTime); });
  set("seekbackward", (d) => lrmSeek((lrmAudio ? lrmAudio.currentTime : 0) - ((d && d.seekOffset) || 10)));
  set("seekforward", (d) => lrmSeek((lrmAudio ? lrmAudio.currentTime : 0) + ((d && d.seekOffset) || 10)));
  set("stop", () => lrmClose(true));
}
function lrmMediaClear() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try { ms.metadata = null; ms.playbackState = "none"; } catch {}
  for (const n of ["play", "pause", "seekto", "seekbackward", "seekforward", "stop"]) { try { ms.setActionHandler(n, null); } catch {} }
}

/* ===== التحكم (محلي + إرسال للطرف التاني) ===== */
async function lrmPlay(want, remote, pos) {
  const s = lrmS; if (!s || !s.ready) return;
  const a = lrmAudio;
  if (typeof pos === "number" && isFinite(pos) && Math.abs(a.currentTime - pos) > 0.4) { try { a.currentTime = Math.max(0, pos); } catch {} }
  if (want) {
    try { await a.play(); }
    catch { if (remote) lrmToast(lrmT("الطرف التاني شغّل الأغنية — اضغط تشغيل", "The other person started playback — tap play")); lrmUi(); return; }
  } else a.pause();
  lrmUi();
  if (!remote) lrmSend({ a: want ? "play" : "pause", id: s.id, pos: a.currentTime });
}
function lrmSeek(pos, remote) {
  const s = lrmS; if (!s || !s.ready) return;
  const a = lrmAudio, d = isFinite(a.duration) ? a.duration : 0;
  pos = Math.min(Math.max(0, Number(pos) || 0), d || Infinity);
  try { a.currentTime = pos; } catch {}
  lrmUi();
  if (!remote) lrmSend({ a: "seek", id: s.id, pos });
}
function lrmCleanup() {
  if (lrmS) lrmS.aborted = true;
  lrmS = null;
  if (lrmAudio) { try { lrmAudio.pause(); lrmAudio.removeAttribute("src"); lrmAudio.load(); } catch {} }
  if (lrmUrl) { try { URL.revokeObjectURL(lrmUrl); } catch {} lrmUrl = ""; }
  lrmMediaClear(); lrmUi();
}
function lrmClose(notify) {
  const id = lrmS && lrmS.id;
  if (notify && id) lrmSend({ a: "stop", id });
  lrmCleanup();
}
function lrmReady(s, blob) { // الملف جاهز عندي: حمّله وجهّز الإشعار
  const a = lrmEnsureAudio();
  if (lrmUrl) { try { URL.revokeObjectURL(lrmUrl); } catch {} }
  lrmUrl = URL.createObjectURL(blob); a.src = lrmUrl; a.load();
  s.ready = true; lrmMediaInit(); lrmUi();
}

/* ===== الإرسال ===== */
async function lrmStart(file) {
  if (!file) return;
  const name = (file.name || "audio").slice(0, 180), type = lrfType(name, file.type);
  if (!file.size) return lrmToast(lrmT("الملف فاضي.", "The file is empty."));
  if (!/^audio\//.test(type) && !/^video\/(mp4|webm|ogg|3gpp)$/.test(type)) return lrmToast(lrmT("اختار ملف صوتي.", "Please choose an audio file."));
  if (file.size > LRM_MAX) return lrmToast(lrmT("الملف كبير. الحد الأقصى 50 ميجابايت.", "File too large. Max 50 MB."));
  if (!u || u.readyState !== 1 || !te || A !== 2) return lrmToast(lrmT("لازم الطرف التاني يكون متصل.", "The other person must be online."));
  if (lrmS) lrmClose(true);
  const id = ze(crypto.getRandomValues(new Uint8Array(8))), n = Math.ceil(file.size / LRM_CHUNK);
  const s = lrmS = { id, nm: name, n, mine: true, sent: 0, ready: false, room: L, file, type };
  lrmEnsureAudio(); lrmUi();
  const ok = await lrmSend({ a: "offer", id, nm: name, z: file.size, n, t: type });
  if (!ok) { lrmCleanup(); return lrmToast(lrmT("فشل الإرسال.", "Send failed.")); }
  for (let w = 0; w < 30 && !s.acked && !s.aborted; w++) await lrfSleep(200); // 6 ثواني
  if (s.aborted) return;
  if (!s.acked) { lrmClose(true); return lrmToast(lrmT("الطرف التاني مردّش — لازم يقفل التطبيق ويفتحه تاني علشان ياخد التحديث (1.21.0) أو يكون داخل الغرفة.", "The other person didn't respond — they need to close and reopen the app to get the update (1.21.0), and be in this room.")); }
  try {
    for (let i = 0; i < n; i++) {
      if (s.aborted) return;
      const buf = await file.slice(i * LRM_CHUNK, (i + 1) * LRM_CHUNK).arrayBuffer();
      for (let k = 0; k < 150 && u && u.bufferedAmount > 4e6; k++) await lrfSleep(120);
      if (s.aborted) return;
      if (!(await lrmSend({ a: "chunk", id, i, d: Y(buf) }))) throw Error("send");
      s.sent = i + 1; lrmUi();
      if (i < n - 1) await lrfSleep(420);
    }
  } catch { if (lrmS === s) { lrmCleanup(); lrmToast(lrmT("الاتصال اتقطع أثناء الإرسال.", "Connection lost while sending.")); } return; }
  if (s.peerReady && !s.ready) lrmBegin(s);
  else if (!s.ready) setTimeout(() => { if (lrmS === s && !s.ready) { lrmClose(true); lrmToast(lrmT("الطرف التاني ماجهّزش الأغنية. جرب تاني.", "The other person couldn't prepare the track. Try again.")); } }, 40000);
}
function lrmBegin(s) { // الطرفين جاهزين: ابدأ
  lrmReady(s, s.file);
  lrmPlay(true);
}

/* ===== الاستقبال ===== */
function lrMusic(r) {
  if (!r || !lrmId(r.id)) return;
  const s = lrmS;
  if (r.a === "offer") {
    if (!(r.n >= 1 && r.n <= 64) || !(Number(r.z) > 0 && r.z <= LRM_MAX + 1024)) return;
    if (s) lrmCleanup();
    const nm = String(r.nm || "audio").slice(0, 180), type = /^(audio|video)\//.test(String(r.t)) ? String(r.t).split(";")[0] : lrfType(nm, "");
    lrmS = { id: r.id, nm, n: r.n, mine: false, got: 0, parts: new Array(r.n), ready: false, room: L, type };
    lrmEnsureAudio(); lrmUi();
    const me = lrmS; me.last = Date.now();
    lrmSend({ a: "ack", id: r.id });
    const wd = setInterval(() => { if (lrmS !== me || me.ready) return clearInterval(wd); if (Date.now() - me.last > 25000) { clearInterval(wd); lrmCleanup(); lrmToast(lrmT("استلام الأغنية وقف (الاتصال ضعيف).", "Receiving stopped (weak connection).")); } }, 3000);
    return;
  }
  if (!s || s.id !== r.id) return;
  if (r.a === "ack") { if (s.mine) s.acked = true; return; }
  if (r.a === "chunk") {
    if (s.mine || s.ready || !(r.i >= 0 && r.i < s.n) || typeof r.d !== "string" || s.parts[r.i]) return;
    try { s.parts[r.i] = $e(r.d); } catch { return; }
    s.got++; s.last = Date.now();
    if (s.got === s.n) {
      const blob = new Blob(s.parts, { type: s.type }); s.parts = null;
      lrmReady(s, blob);
      lrmSend({ a: "ready", id: s.id });
      if (s.pending) { const p = s.pending; s.pending = null; if (p.playing) lrmPlay(true, true, p.pos); else lrmSeek(p.pos, true); }
    } else lrmUi();
    return;
  }
  if (r.a === "ready") { if (s.mine) { s.peerReady = true; if (s.sent >= s.n && !s.ready) lrmBegin(s); } return; }
  if (r.a === "stop") { lrmCleanup(); lrmToast(lrmT("الطرف التاني قفل الأغنية", "The other person closed the track")); return; }
  const pos = typeof r.pos === "number" && isFinite(r.pos) && r.pos >= 0 && r.pos < 86400 ? r.pos : 0;
  if (r.a === "play" || r.a === "pause" || r.a === "seek") {
    if (!s.ready) { s.pending = { playing: r.a === "play" ? true : r.a === "pause" ? false : (s.pending ? s.pending.playing : false), pos }; return; }
    if (r.a === "seek") lrmSeek(pos, true); else lrmPlay(r.a === "play", true, pos);
  }
}
window.lrMusic = lrMusic;

/* ===== ربط الأزرار ===== */
(function lrmInit() {
  const pick = lrmPick = document.createElement("input");
  pick.type = "file"; pick.accept = "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac"; pick.hidden = true;
  pick.addEventListener("change", () => { const f = pick.files && pick.files[0]; pick.value = ""; if (f) lrmStart(f); });
  document.body.appendChild(pick);
  const open = () => {
    t("menu").classList.add("hidden");
    if (!u || u.readyState !== 1 || A !== 2) return lrmToast(lrmT("لازم الطرف التاني يكون متصل.", "The other person must be online."));
    pick.click(); // بيفتح ملفات الصوت على طول
  };
  const b = t("listenTogether"); if (b) b.onclick = open;
  const sw = t("musicSwap"); if (sw) sw.onclick = open;
  t("musicPlay").onclick = () => { if (lrmS && lrmS.ready) lrmPlay(lrmAudio.paused); };
  t("musicClose").onclick = () => lrmClose(true);
  const rng = t("musicSeek");
  rng.addEventListener("input", () => { if (lrmS && lrmS.ready && isFinite(lrmAudio.duration)) t("musicSub").textContent = lrmT("نسمع معًا · ", "Listening together · ") + lrmTime((rng.value / 1000) * lrmAudio.duration) + " / " + lrmTime(lrmAudio.duration); });
  rng.addEventListener("change", () => { if (lrmS && lrmS.ready && isFinite(lrmAudio.duration)) lrmSeek((rng.value / 1000) * lrmAudio.duration); });
  setInterval(() => { if (lrmS && lrmS.room !== L) lrmCleanup(); }, 1500); // خرجت من الغرفة → اقفل
})();
