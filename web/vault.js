/* ---------- 1.18: نسخة احتياطية مشفّرة لقايمة المحادثات على الحساب (بيتضم جوه closure بتاع app.js وقت الـ build) ----------
   قايمة الغرف (أكواد الغرف + أسماء/صور الطرف التاني) كانت محفوظة في متصفح الجهاز بس، فأي جهاز جديد بيبدأ فاضي.
   دلوقتي بتتشفّر في المتصفح بمفتاح مشتق من باسورد الحساب (PBKDF2 + AES-GCM) وتتخزن على الحساب؛ السيرفر مبيقدرش يقرأها.
   بتتسحب تلقائياً بعد تسجيل الدخول بالباسورد من أي جهاز. */
const LRV_B64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode.apply(null, u8.subarray(i, i + 4096)); return btoa(s); };
const LRV_UN = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
function lrvDb() { return new Promise((ok, no) => { const r = indexedDB.open("lr-vault", 1); r.onupgradeneeded = () => r.result.createObjectStore("k"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
async function lrvRec(val) { // val===undefined: قراءة، null: مسح، غير كده: حفظ
  try {
    const db = await lrvDb();
    return await new Promise((ok) => {
      const tx = db.transaction("k", val === undefined ? "readonly" : "readwrite"), st = tx.objectStore("k");
      let out = null;
      if (val === undefined) { const q = st.get("rec"); q.onsuccess = () => { out = q.result || null; }; }
      else if (val === null) st.delete("rec"); else st.put(val, "rec");
      tx.oncomplete = () => { db.close(); ok(out); }; tx.onerror = tx.onabort = () => { db.close(); ok(null); };
    });
  } catch { return null; }
}
async function lrvDerive(pw, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function lrvDecrypt(key, v) {
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: LRV_UN(v.iv) }, key, LRV_UN(v.ct)))); } catch { return null; }
}
function lrvMerge(data) { // دمج: اللي على الجهاز الأول، وبعدين اللي من الحساب
  if (!data || !Array.isArray(data.r)) return false;
  const have = ie(), add = data.r.filter((c) => typeof c === "string" && Ke(c) && !have.includes(c));
  const all = have.concat(add).slice(0, 100);
  if (add.length) d.set("rooms", JSON.stringify(all));
  const pr = Ye(); let ch = false;
  if (data.p && typeof data.p === "object") for (const c of all) { const x = data.p[c]; if (x && typeof x === "object" && !pr[c]) { pr[c] = { n: String(x.n || "").slice(0, 80), a: typeof x.a === "string" ? x.a : "" }; ch = true; } }
  if (ch) d.set("roomProfiles", JSON.stringify(pr));
  if (add.length || ch) { try { re(); } catch {} }
  return add.length > 0;
}
let lrvPushT = 0, lrvBusy = null;
async function lrvPush() {
  const rec = await lrvRec();
  if (!rec || !rec.key) return false;
  const rooms = ie(); if (!rooms.length) return false; // مبنكتبش قايمة فاضية فوق نسخة موجودة
  let prof = Ye(), pl = { r: rooms, p: prof, t: Date.now() }, txt = JSON.stringify(pl);
  if (txt.length > 60000) { pl.p = Object.fromEntries(Object.entries(prof).map(([k, v]) => [k, { n: v.n || "", a: "" }])); txt = JSON.stringify(pl); }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, rec.key, new TextEncoder().encode(txt)));
  const { status } = await C("/api/vault", { op: "put", salt: rec.salt, iv: LRV_B64(iv), ct: LRV_B64(ct) });
  return status === 200;
}
function lrvSoon() { clearTimeout(lrvPushT); lrvPushT = setTimeout(() => { lrvBusy = lrvPush().catch(() => false); }, 1500); }
/* أي تعديل على قايمة الغرف أو بروفايلاتها بيتزامن لوحده */
{ const set0 = d.set; d.set = (k, v) => { set0(k, v); if (k === "rooms" || k === "roomProfiles") lrvSoon(); }; }
/* بعد ما الباسورد يتكتب صح (تسجيل دخول / إنشاء حساب / تغيير باسورد): اسحب النسخة وادمجها وخزّن المفتاح على الجهاز.
   لو الباسورد اتغيّر بنفك النسخة القديمة بالمفتاح المخزّن على الجهاز وبنعيد تشفيرها بالباسورد الجديد. */
async function lrVaultLogin(pw, rekey) {
  try {
    if (!pw || !crypto?.subtle || !window.indexedDB) return false;
    const { status, data } = await C("/api/vault", { op: "get" });
    if (status !== 200) return false;
    const v = data && data.vault, old = await lrvRec();
    let rec = null, merged = false;
    if (v && v.salt && v.iv && v.ct) {
      let pl = null;
      if (old && old.key && old.salt === v.salt) pl = await lrvDecrypt(old.key, v), rec = pl ? old : null;
      if (!pl) { const key = await lrvDerive(pw, LRV_UN(v.salt)); pl = await lrvDecrypt(key, v); if (pl) rec = { key, salt: v.salt }; }
      if (pl) merged = lrvMerge(pl);
    }
    if (rekey) { merged = merged || false; rec = null; }
    if (!rec) { const salt = crypto.getRandomValues(new Uint8Array(16)); rec = { key: await lrvDerive(pw, salt), salt: LRV_B64(salt) }; await lrvRec(rec); await lrvPush(); }
    else { await lrvRec(rec); if (merged || !v) await lrvPush(); }
    return merged;
  } catch { return false; }
}
function lrVaultForget() { clearTimeout(lrvPushT); return lrvRec(null); }
{
  const b = document.getElementById("vaultSync"), st = document.getElementById("vaultStatus"), pw = document.getElementById("vaultPw");
  if (b) b.addEventListener("click", async () => {
    st.textContent = ""; st.style.color = "";
    if (!pw.value) { st.textContent = "اكتب باسورد الحساب."; return; }
    b.disabled = true;
    try {
      const { status, data } = await C("/api/vault", { op: "check", pw: pw.value });
      if (status !== 200 || !data.ok) { st.textContent = "الباسورد غلط."; return; }
      const m = await lrVaultLogin(pw.value);
      pw.value = ""; st.style.color = "#7ee2b8"; st.textContent = m ? "تم، ورجّعنا محادثات من النسخة المحفوظة." : "تم تفعيل الحفظ.";
    } catch { st.textContent = "حصل خطأ، جرب تاني."; } finally { b.disabled = false; }
  });
}

/* ---------- 1.19: تنبيه للأجهزة اللي لسه ما فعّلتش حفظ المحادثات ----------
   قبل كده الحفظ ما كانش بيشتغل غير بعد تسجيل دخول بالباسورد على الجهاز. فأي جهاز مفتوح من قبل 1.18 كان ما بيحفظش حاجة،
   وأول ما تفتح الحساب من جهاز جديد (أو تسترجعه) بتلاقيه فاضي. التنبيه ده بيطلب الباسورد مرة واحدة ويفعّل الحفظ. */
(function () {
  let el = null, busy = false;
  const en = () => document.documentElement.lang === "en";
  const dismissed = () => { try { return Date.now() - Number(localStorage.getItem("lr.vnDismiss") || 0) < 6 * 3600e3; } catch { return false; } };
  function close(later) { if (later) { try { localStorage.setItem("lr.vnDismiss", String(Date.now())); } catch {} } el && el.remove(); el = null; }
  async function maybe() {
    try {
      if (el || busy || !he || dismissed() || document.visibilityState !== "visible") return;
      if (t("home").classList.contains("hidden") || !ie().length || !window.indexedDB || !crypto?.subtle) return;
      busy = true;
      const rec = await lrvRec();
      busy = false;
      if (rec && rec.key) return;
      el = document.createElement("div"); el.className = "vaultNudge"; el.setAttribute("role", "dialog");
      const h = document.createElement("strong"); h.textContent = en() ? "Back up your chats to your account" : "احفظ محادثاتك على حسابك";
      const p = document.createElement("p"); p.textContent = en()
        ? "Type your account password once. If you open the account on another phone or recover it, your chats will be there."
        : "اكتب باسورد الحساب مرة واحدة. لو فتحت الحساب من جهاز تاني أو استرجعته هتلاقي محادثاتك موجودة.";
      const pw = document.createElement("input"); pw.type = "password"; pw.autocomplete = "current-password"; pw.placeholder = en() ? "Account password" : "باسورد الحساب";
      const err = document.createElement("small");
      const go = document.createElement("button"); go.type = "button"; go.textContent = en() ? "Save" : "احفظ";
      const later = document.createElement("button"); later.type = "button"; later.className = "ghost"; later.textContent = en() ? "Later" : "بعدين";
      const row = document.createElement("div"); row.className = "vnRow"; row.append(go, later);
      el.append(h, p, pw, err, row); document.body.appendChild(el);
      later.onclick = () => close(true);
      go.onclick = async () => {
        if (!pw.value) { err.textContent = en() ? "Type the password." : "اكتب الباسورد."; return; }
        go.disabled = true; err.textContent = "";
        try {
          const { status, data } = await C("/api/vault", { op: "check", pw: pw.value });
          if (status !== 200 || !data.ok) { err.textContent = en() ? "Wrong password." : "الباسورد غلط."; return; }
          await lrVaultLogin(pw.value); pw.value = "";
          const ok = await lrvRec();
          if (ok && ok.key) { close(false); lrToast(en() ? "Chats are now backed up to your account." : "تم حفظ محادثاتك على حسابك."); }
          else err.textContent = en() ? "Could not save. Try again." : "معرفتش أحفظ، جرب تاني.";
        } catch { err.textContent = en() ? "Something went wrong." : "حصل خطأ، جرب تاني."; } finally { go.disabled = false; }
      };
      pw.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); });
    } catch { busy = false; }
  }
  setInterval(maybe, 5000);
  setTimeout(maybe, 3000);
})();
