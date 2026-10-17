/* ---------- 1.18: إرسال وعرض أي ملف (صور/فيديو/صوت/مستندات/أي صيغة) — بيتضم جوه closure بتاع app.js وقت الـ build ----------
   الإرسال: الملف بيتقسّم لأجزاء 2 ميجا، كل جزء رسالة مشفّرة {k:"fc"} (نفس التشفير والتخزين بتاع باقي الرسايل)، حد أقصى 100 ميجا.
   الاستقبال: الأجزاء بتتجمّع (حتى لو جت من السجل القديم) وبتظهر كصورة/فيديو/صوت أو كارت تحميل. */
const LRF_CHUNK = 2 * 1024 * 1024, LRF_MAX = 100 * 1024 * 1024;
const LRF_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", flv: "video/x-flv", "3gp": "video/3gpp", "3g2": "video/3gpp2", ogv: "video/ogg", mpg: "video/mpeg", mpeg: "video/mpeg", ts: "video/mp2t", mts: "video/mp2t",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", amr: "audio/amr", weba: "audio/webm", wma: "audio/x-ms-wma", mid: "audio/midi", midi: "audio/midi",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", json: "application/json", zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", apk: "application/vnd.android.package-archive"
};
const lrfExt = (n) => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(n || ""); return m ? m[1].toLowerCase() : ""; };
function lrfType(name, type) {
  type = String(type || "").toLowerCase().split(";")[0].trim();
  if (type && type !== "application/octet-stream") return type;
  return LRF_EXT[lrfExt(name)] || "application/octet-stream";
}
const lrfIsHeic = (type, name) => /^image\/hei[cf]/.test(type) || /^(heic|heif)$/.test(lrfExt(name));
function lrfSize(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
const lrfSleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lrfHeicP = null;
function lrfHeicLoad() { // بيحمّل فك HEIC (wasm) أول مرة بس
  if (window.lrHeicDecode) return Promise.resolve(window.lrHeicDecode);
  return lrfHeicP || (lrfHeicP = new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = "/heic.js";
    s.onload = () => window.lrHeicDecode ? ok(window.lrHeicDecode) : no(Error("heic")); s.onerror = () => { lrfHeicP = null; no(Error("heic load")); };
    document.head.appendChild(s);
  }));
}
window.lrfHeicLoad = lrfHeicLoad; window.lrfType = lrfType; window.lrfIsHeic = lrfIsHeic;

function lrfCard(blob, name, type, size, note) {
  const url = URL.createObjectURL(blob), c = document.createElement("div"); c.className = "lrfCard fileMessage";
  const ic = document.createElement("span"); ic.className = "lrfIc"; ic.innerHTML = uiIcon("file");
  const ex = document.createElement("b"); ex.textContent = (lrfExt(name) || "FILE").slice(0, 5).toUpperCase(); ic.appendChild(ex);
  const tx = document.createElement("div"); tx.className = "lrfTx";
  const nm = document.createElement("strong"); nm.textContent = name || "attachment"; nm.title = name || "";
  const sm = document.createElement("small"); sm.textContent = (note ? note + " · " : "") + lrfSize(size || blob.size);
  tx.append(nm, sm);
  const act = document.createElement("div"); act.className = "lrfAct";
  const dl = document.createElement("a"); dl.href = url; dl.download = name || "attachment"; dl.textContent = "تحميل";
  act.appendChild(dl);
  if (/^(application\/pdf|text\/)/.test(type)) { const op = document.createElement("a"); op.href = url; op.target = "_blank"; op.rel = "noopener"; op.textContent = "فتح"; act.appendChild(op); }
  c.append(ic, tx, act); return c;
}
function lrfView(blob, name, type, size) {
  const url = URL.createObjectURL(blob), k = type.split("/")[0], wrap = document.createElement("div"); wrap.className = "lrfView";
  const toCard = (note) => wrap.replaceChildren(lrfCard(blob, name, type, size, note));
  if (k === "image") {
    const img = document.createElement("img"); img.alt = name || "صورة"; img.decoding = "async"; img.draggable = false; img.className = "lrfImg";
    img.addEventListener("load", () => { try { Xe(); } catch {} });
    if (lrfIsHeic(type, name)) {
      wrap.textContent = "⏳ " + (name || "HEIC");
      blob.arrayBuffer().then(async (b) => {
        const id = await (await lrfHeicLoad())(b), cv = document.createElement("canvas"); cv.width = id.width; cv.height = id.height; cv.getContext("2d").putImageData(id, 0, 0);
        const jb = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.9)); if (!jb) throw Error("x");
        img.src = URL.createObjectURL(jb); wrap.replaceChildren(img);
      }).catch(() => toCard("مش قادر يعرضها هنا"));
    } else { img.onerror = () => toCard("مش قادر يعرضها هنا"); img.src = url; wrap.appendChild(img); }
    return wrap;
  }
  if (k === "video") {
    const v = document.createElement("video"); v.className = "lrfVid"; v.controls = true; v.playsInline = true; v.preload = "metadata"; v.setAttribute("playsinline", "");
    v.addEventListener("loadedmetadata", () => { try { Xe(); } catch {} });
    v.onerror = () => toCard("المتصفح مش بيشغّل الصيغة دي");
    v.src = url; wrap.appendChild(v);
    const cap = document.createElement("small"); cap.className = "lrfCap"; cap.textContent = (name || "") + " · " + lrfSize(size || blob.size); wrap.appendChild(cap);
    return wrap;
  }
  if (k === "audio") {
    const cap = document.createElement("small"); cap.className = "lrfCap"; cap.textContent = (name || "") + " · " + lrfSize(size || blob.size);
    const a = document.createElement("audio"); a.className = "lrfAud"; a.controls = true; a.preload = "metadata";
    a.onerror = () => toCard("المتصفح مش بيشغّل الصيغة دي");
    a.src = url; wrap.append(cap, a); return wrap;
  }
  toCard(""); return wrap;
}
function lrfProgress(host, name, done, total, label) {
  host.replaceChildren();
  const c = document.createElement("div"); c.className = "lrfCard lrfBusy";
  const tx = document.createElement("div"); tx.className = "lrfTx";
  const nm = document.createElement("strong"); nm.textContent = name || "attachment";
  const sm = document.createElement("small"); sm.textContent = label + (total > 1 ? " " + Math.min(100, Math.floor(done / total * 100)) + "%" : "…");
  const bar = document.createElement("div"); bar.className = "lrfBar"; const fill = document.createElement("i"); fill.style.width = (total ? Math.floor(done / total * 100) : 0) + "%"; bar.appendChild(fill);
  tx.append(nm, sm, bar); c.appendChild(tx); host.appendChild(c);
}

/* ===== الاستقبال ===== */
const lrfS = new Map();
function lrFc(r, l, at, mid, s) {
  if (typeof r.id !== "string" || r.id.length > 40 || !(r.n >= 1 && r.n <= 64) || !(r.i >= 0 && r.i < r.n)) return null;
  const key = L + ":" + r.id; let st = lrfS.get(key);
  if (!st) { st = { n: r.n, parts: new Array(r.n), got: 0, blob: null, el: null, nm: String(r.nm || "attachment").slice(0, 180), t: lrfType(r.nm, r.t), z: Number(r.z) || 0 }; lrfS.set(key, st); }
  if (!st.blob && !st.parts[r.i] && typeof r.d === "string") { try { st.parts[r.i] = $e(r.d); st.got++; } catch { return null; } }
  if (!st.blob && st.got === st.n) { st.blob = new Blob(st.parts, { type: st.t }); st.parts = null; }
  let created = null;
  if (!st.el || !st.el.isConnected) {
    const host = document.createElement("div"); host.className = "lrfHost"; st.el = host; st.shown = false;
    created = R(l, host, at, mid, s);
  }
  if (st.blob) { if (!st.shown) { st.shown = true; st.el.replaceChildren(lrfView(st.blob, st.nm, st.t, st.z)); } }
  else lrfProgress(st.el, st.nm, st.got, st.n, "جاري استلام الملف");
  try { Xe(); } catch {}
  return created;
}

/* ===== الإرسال ===== */
async function lrSendAny(file) {
  if (!file) return false;
  if (!file.size) { w("الملف فاضي."); return false; }
  if (file.size > LRF_MAX) { w("الملف كبير قوي. الحد الأقصى 100 ميجابايت."); return false; }
  if (!u || u.readyState !== 1 || !te) { try { await window.lrReconnect(); } catch {} for (let i = 0; i < 40 && (!u || u.readyState !== 1 || !te); i++) await lrfSleep(250); }
  if (!u || u.readyState !== 1 || !te) { w("لسه متصلش بالغرفة، استنى لحظة وجرب تاني."); return false; }
  const name = (file.name || "file").slice(0, 180), type = lrfType(name, file.type), n = Math.ceil(file.size / LRF_CHUNK);
  const id = ze(crypto.getRandomValues(new Uint8Array(8))), host = document.createElement("div"); host.className = "lrfHost";
  lrfProgress(host, name, 0, n, "جاري التجهيز");
  const fail = (msg) => {
    host.replaceChildren(); const c = document.createElement("div"); c.className = "lrfCard lrfFail";
    const tx = document.createElement("div"); tx.className = "lrfTx"; const nm = document.createElement("strong"); nm.textContent = name; const sm = document.createElement("small"); sm.textContent = msg;
    const b = document.createElement("button"); b.type = "button"; b.textContent = "إعادة المحاولة"; b.onclick = () => { host.closest(".m")?.remove(); lrSendAny(file); };
    tx.append(nm, sm); c.append(tx, b); host.appendChild(c);
  };
  try {
    for (let i = 0; i < n; i++) {
      const buf = await file.slice(i * LRF_CHUNK, (i + 1) * LRF_CHUNK).arrayBuffer();
      for (let k = 0; k < 150 && u && u.bufferedAmount > 6e6; k++) await lrfSleep(120);
      if (!u || u.readyState !== 1) throw Error("conn");
      const ok = await Pe({ k: "fc", id, i, n, nm: name, t: type, z: file.size, d: Y(buf) }, i === 0 ? host : null, "me", "sending");
      if (!ok) throw Error("send");
      if (i === 0 && n > 1) { /* الكارت اتحط في الشات بعد أول جزء */ }
      lrfProgress(host, name, i + 1, n, "جاري الإرسال");
      if (i < n - 1) await lrfSleep(260);
    }
  } catch (e) { fail(e && e.message === "conn" ? "الاتصال اتقطع أثناء الإرسال" : "فشل الإرسال"); return false; }
  host.replaceChildren(lrfView(file, name, type, file.size));
  return true;
}
window.lrSendAny = lrSendAny;
