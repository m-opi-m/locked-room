/* ---------- 1.22: فواصل التواريخ في الشات (اليوم / امبارح / اسم اليوم / التاريخ) — ملف لوحده بيتضم لآخر app.js وقت الـ build ----------
   بيراقب #log وبيحط .daySep قبل أول رسالة في كل يوم (حسب data-at بتاع .m). الفاصل جزء عادي من الشات (بيسكرول معاه، مش عايم).
   بيشتغل مع الرسايل الجديدة والسجل القديم (اللي بيتحمّل لفوق) من غير ما الشات يقفز. */
(() => {
  const log = document.getElementById("log");
  if (!log) return;
  const en = () => document.documentElement.lang === "en";
  const key = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  function label(at) {
    const d = new Date(at), now = new Date(), diff = Math.round((day0(now) - day0(d)) / 864e5), loc = en() ? "en-US" : "ar-EG";
    if (diff === 0) return en() ? "Today" : "اليوم";
    if (diff === 1) return en() ? "Yesterday" : "امبارح";
    if (diff > 1 && diff < 7) return new Intl.DateTimeFormat(loc, { weekday: "long" }).format(d);
    return new Intl.DateTimeFormat(loc, { day: "numeric", month: "long", year: "numeric" }).format(d);
  }
  let queued = false, busy = false;
  function run() {
    queued = false; busy = true;
    try {
      // نثبّت أول رسالة ظاهرة عشان إضافة فواصل فوقها ما تقفّزش الشات
      const top = log.scrollTop, kids = [...log.children];
      const anchor = kids.find((c) => c.classList.contains("m") && c.offsetTop >= top), aOff = anchor ? anchor.offsetTop - top : 0;
      let last = 0, changed = false;
      for (const el of kids) {
        if (!el.classList || !el.classList.contains("m")) continue;
        const at = Number(el.dataset.at); if (!at) continue;
        const k = key(new Date(at)), prev = el.previousElementSibling;
        if (k !== last) {
          let sep = prev && prev.classList.contains("daySep") ? prev : null;
          if (!sep) { sep = document.createElement("div"); sep.className = "daySep"; sep.setAttribute("role", "separator"); log.insertBefore(sep, el); changed = true; }
          const txt = label(at);
          if (sep.dataset.k !== String(k) || sep.textContent !== txt) { sep.dataset.k = String(k); sep.textContent = txt; changed = true; }
        } else if (prev && prev.classList.contains("daySep")) { prev.remove(); changed = true; }
        last = k;
      }
      for (const s of log.querySelectorAll(".daySep")) { const n = s.nextElementSibling; if (!n || !n.classList.contains("m")) { s.remove(); changed = true; } }
      if (changed && anchor && anchor.isConnected && top > 0 && log.scrollHeight - top - log.clientHeight > 160) log.scrollTop = anchor.offsetTop - aOff;
    } finally { busy = false; }
  }
  const sched = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  new MutationObserver(() => { if (!busy) sched(); }).observe(log, { childList: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sched(); });
  setInterval(sched, 60000); // بعد نص الليل "اليوم" يبقى "امبارح"
  sched();
})();
