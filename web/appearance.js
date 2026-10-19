// ثيم التطبيق + أيقونته (الإعدادات ← السمات). بيتضم جوه public/app.js وقت الـ build.
// الثيم = متغيرات CSS على <html data-appearance>، والأيقونة (جوه تطبيق الأندرويد بس) بتتبدّل عن طريق window.AndroidIcon.
(() => {
  const KEY = 'lrAppearance';
  const THEMES = {"default": {"n": ["الأصلي", "Original"], "c": "linear-gradient(135deg,#07162d,#10a78a)", "meta": "#07142a"}, "pink": {"n": ["وردي (بناتي)", "Pink"], "c": "linear-gradient(135deg,#230c1c,#f0509a)", "meta": "#1a0814"}, "violet": {"n": ["بنفسجي", "Violet"], "c": "linear-gradient(135deg,#130c2a,#8f6bf5)", "meta": "#0d081c"}, "orange": {"n": ["برتقالي", "Orange"], "c": "linear-gradient(135deg,#20120a,#f27d1a)", "meta": "#170c05"}, "blue": {"n": ["أزرق", "Blue"], "c": "linear-gradient(135deg,#071a36,#2f8cf0)", "meta": "#040f22"}};
  const en = () => document.documentElement.lang === 'en';
  const get = () => { try { const v = localStorage.getItem(KEY); return THEMES[v] ? v : 'default'; } catch { return 'default'; } };
  const meta = document.querySelector('meta[name="theme-color"]');
  function apply(k, withIcon) {
    if (k === 'default') document.documentElement.removeAttribute('data-appearance'); else document.documentElement.setAttribute('data-appearance', k);
    if (meta) meta.setAttribute('content', THEMES[k].meta);
    if (withIcon) { try { window.AndroidIcon && window.AndroidIcon.set(k); } catch {} }
  }
  apply(get(), false);
  const panel = document.getElementById('settingsThemes');
  if (!panel) return;
  const box = document.createElement('div'); box.id = 'appearanceBox';
  const h = document.createElement('h3'); const grid = document.createElement('div'); grid.className = 'apGrid';
  const note = document.createElement('p'); note.className = 'apNote';
  h.textContent = en() ? 'App theme & icon' : 'ثيم التطبيق وأيقونته';
  note.textContent = (window.AndroidIcon ? '' : (en() ? 'The home-screen icon changes only inside the Android app.' : 'أيقونة الشاشة الرئيسية بتتغير جوه تطبيق الأندرويد بس.'));
  function draw() {
    const cur = get(); grid.textContent = '';
    for (const k of Object.keys(THEMES)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'apItem' + (k === cur ? ' on' : '');
      const dot = document.createElement('span'); dot.className = 'apDot'; dot.style.background = THEMES[k].c;
      const lb = document.createElement('span'); lb.textContent = THEMES[k].n[en() ? 1 : 0];
      b.append(dot, lb);
      b.onclick = () => { try { localStorage.setItem(KEY, k); } catch {} apply(k, true); draw(); };
      grid.appendChild(b);
    }
  }
  draw(); box.append(h, grid, note); panel.insertBefore(box, panel.firstChild);
})();
