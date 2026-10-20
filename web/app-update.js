// زر "تحديث" في الإعدادات (جوه تطبيق الأندرويد بس). من غير أي نافذة منبثقة.
// - بيظهر دايماً جوه التطبيق. لو فيه تحديث بيوميض.
// - الضغط بينادي window.AndroidUpdate.press(): التطبيق يفحص السيرفر دلوقتي؛ لو فيه جديد ينزّل الـ APK (الزرار بيعرض النسبة) ويفتح شاشة التثبيت،
//   ولو لأ الزرار نفسه بيكتب إنك على آخر إصدار.
// التطبيق (MainActivity) بيبعت الحالة عن طريق window.lrAppUpdate. بيتضم جوه public/app.js وقت الـ build.
(() => {
  const btn = document.getElementById('appUpdateBtn');
  if (!btn) return;
  try { const old = document.getElementById('updPrompt'); if (old) old.remove(); } catch {}   // بقايا النافذة القديمة كانت بتغطي الشاشة
  const en = () => document.documentElement.lang === 'en';
  let s = null, note = '', noteT = 0, checking = false, checkT = 0;

  function label() {
    if (s && s.phase === 'downloading') return (en() ? 'Downloading… ' : 'جاري التحميل… ') + (s.pct || 0) + '%';
    if (checking) return en() ? 'Checking…' : 'جاري الفحص…';
    if (note) return note;
    return en() ? 'Update' : 'تحديث';
  }

  function render() {
    if (!window.AndroidUpdate) { btn.hidden = true; return; }
    const busy = !!(s && s.phase === 'downloading');
    btn.hidden = false;
    btn.disabled = busy || checking;
    btn.classList.toggle('blink', !!(s && s.available) && !busy && !checking && !note);
    btn.textContent = label();
  }

  function flash(text) {
    clearTimeout(noteT);
    note = text; render();
    noteT = setTimeout(() => { note = ''; render(); }, 3500);
  }

  function endCheck() { checking = false; clearTimeout(checkT); }

  window.lrAppUpdate = (o) => {
    s = o || s;
    if (s && (s.phase === 'downloading' || s.available)) endCheck();
    if (s && s.result === 'latest') { endCheck(); flash(en() ? "You're on the latest version" : 'أنت على آخر إصدار'); return; }
    if (s && s.result === 'error') { endCheck(); flash(en() ? "Couldn't check, try again" : 'تعذّر الفحص، جرّب تاني'); return; }
    render();
  };

  btn.addEventListener('click', () => {
    const u = window.AndroidUpdate;
    if (!u || btn.disabled) return;
    checking = true; clearTimeout(checkT);
    checkT = setTimeout(() => { checking = false; render(); }, 15000);   // أمان: لو الرد ما وصلش
    render();
    try {
      if (typeof u.press === 'function') u.press();
      else if (s && s.available) u.start();                              // نسخة تطبيق أقدم من 1.6.7
      else { endCheck(); flash(en() ? "You're on the latest version" : 'أنت على آخر إصدار'); }
    } catch { endCheck(); render(); }
  });

  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  try { if (window.AndroidUpdate) { s = JSON.parse(window.AndroidUpdate.state()); render(); } } catch {}
})();
