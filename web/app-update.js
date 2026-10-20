// زر "تحديث" في الإعدادات (جوه تطبيق الأندرويد بس). التطبيق (MainActivity) بيبعت الحالة عن طريق window.lrAppUpdate،
// والضغط بينادي window.AndroidUpdate.start() اللي بينزّل الـ APK لوحده ويفتح شاشة التثبيت. بيتضم جوه public/app.js وقت الـ build.
(() => {
  const btn = document.getElementById('appUpdateBtn');
  if (!btn) return;
  const en = () => document.documentElement.lang === 'en';
  let s = null;
  function render() {
    if (!s || !s.available || !window.AndroidUpdate) { btn.hidden = true; return; }
    const busy = s.phase === 'downloading';
    btn.hidden = false;
    btn.disabled = busy;
    btn.classList.toggle('blink', !busy);
    btn.textContent = busy ? (en() ? 'Downloading… ' : 'جاري التحميل… ') + (s.pct || 0) + '%' : (en() ? 'Update' : 'تحديث');
  }
  window.lrAppUpdate = (o) => { s = o; render(); };
  btn.addEventListener('click', () => { try { window.AndroidUpdate.start(); } catch {} });
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  try { if (window.AndroidUpdate) { s = JSON.parse(window.AndroidUpdate.state()); render(); } } catch {}
})();
