// زر الصوت في المكالمة: مكبر الصوت ← سماعة الأذن ← سماعات متوصلة (بلوتوث/سلك) لو موجودة.
// ضغطة = الوضع اللي بعده، ضغطة مطوّلة = قايمة تختار منها. لو مفيش غير مخرج واحد بنقول للمستخدم.
// بيتضم جوه public/app.js وقت الـ build (زي image-send.js). المتصفح مفيهوش API رسمي لتحويل الصوت،
// فبنستخدم setSinkId + enumerateDevices (شغّالين على كروم).
(() => {
  const $ = (id) => document.getElementById(id);
  const btn = $('speakerBtn'), vid = $('remoteVid'), call = $('call');
  if (!btn || !vid || !call) return;
  const en = () => document.documentElement.lang === 'en';
  const TXT = {
    spk: ['مكبر الصوت', 'Speaker'],
    ear: ['سماعة الأذن', 'Earpiece'],
    oth: ['سماعة', 'Headset'],
    no: ['مفيش مخرج صوت تاني متاح، أو المتصفح ما بيسمحش بالتحويل. استخدم أزرار الصوت في الموبايل.', 'No other audio output is available, or the browser does not allow switching. Use your phone’s sound controls.'],
  };
  const tr = (k) => TXT[k][en() ? 1 : 0];
  let cur = { kind: 'spk', id: '', label: '' }, busy = false, toastEl = null, toastT = 0, menu = null;

  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'lrToast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 4200);
  }
  function render() {
    const spk = cur.kind === 'spk';
    if (btn.classList.contains('isOn') !== spk) btn.classList.toggle('isOn', spk);
    if (btn.getAttribute('aria-pressed') !== String(spk)) btn.setAttribute('aria-pressed', String(spk));
    // بنكتب بس لو القيمة اتغيّرت: مترجم التطبيق بيراقب تغييرات النص، والكتابة المتكررة ممكن تعمل حلقة لا نهائية.
    const label = $('speakerLabel'), txt = cur.kind === 'oth' ? (cur.label || tr('oth')) : tr(cur.kind);
    if (label.textContent !== txt) label.textContent = txt;
    const use = $('speakerIcon').querySelector('use'), href = cur.kind === 'ear' ? '#i-phone' : '#i-volume';
    if (use && use.getAttribute('href') !== href) use.setAttribute('href', href);
  }
  const isEar = (d) => /earpiece|receiver|handset|سماعة الأذن/i.test(d.label || '');
  const isSpk = (d) => !isEar(d) && /speaker|loud|مكبر/i.test(d.label || '');

  // المخارج المتاحة بالترتيب: مكبر ← سماعة الأذن ← أي سماعة تانية متوصلة
  async function options() {
    if (typeof vid.setSinkId !== 'function' || !navigator.mediaDevices?.enumerateDevices) return [];
    let outs = [];
    try { outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch { return []; }
    const spk = outs.find(isSpk) || outs.find((d) => d.deviceId === 'default') || outs[0];
    const ear = outs.find(isEar);
    const others = outs.filter((d) => d !== spk && d !== ear && !isSpk(d) && !isEar(d) && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const res = [];
    if (spk) res.push({ kind: 'spk', id: spk.deviceId, label: spk.label });
    if (ear) res.push({ kind: 'ear', id: ear.deviceId, label: ear.label });
    for (const o of others) res.push({ kind: 'oth', id: o.deviceId, label: o.label });
    return res;
  }
  async function apply(o) {
    try { await vid.setSinkId(o.id); cur = o; render(); return true; } catch { return false; }
  }
  const hideMenu = () => { menu && menu.remove(); menu = null; };

  async function next() {
    if (busy) return; busy = true;
    const opts = await options();
    if (opts.length < 2) { busy = false; return toast(tr('no')); }
    let i = opts.findIndex((o) => o.id === cur.id && o.kind === cur.kind);
    if (i < 0) i = 0; // الوضع الافتراضي = مكبر الصوت (أول اختيار)
    const o = opts[(i + 1) % opts.length];
    const ok = await apply(o); busy = false;
    if (!ok) toast(tr('no'));
  }
  async function pick() {
    hideMenu();
    const opts = await options();
    if (opts.length < 2) return toast(tr('no'));
    menu = document.createElement('div'); menu.className = 'lrMenu';
    for (const o of opts) {
      const b = document.createElement('button'); b.type = 'button';
      b.textContent = (o.kind === 'oth' ? (o.label || tr('oth')) : tr(o.kind)) + (o.id === cur.id && o.kind === cur.kind ? ' ✓' : '');
      b.onclick = async () => { hideMenu(); if (!(await apply(o))) toast(tr('no')); };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left + r.width / 2 - menu.offsetWidth / 2)) + 'px';
    if (r.top < innerHeight / 2) menu.style.top = (r.bottom + 10) + 'px'; else menu.style.bottom = (innerHeight - r.top + 10) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function f(e) { if (menu && !menu.contains(e.target)) hideMenu(); document.removeEventListener('pointerdown', f); }, { once: true }), 0);
  }

  let tm = 0, fired = false;
  btn.addEventListener('pointerdown', () => { fired = false; clearTimeout(tm); tm = setTimeout(() => { fired = true; pick(); }, 550); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => clearTimeout(tm));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => { if (fired) { fired = false; e.preventDefault(); return; } next(); });

  // كل مكالمة جديدة تبدأ بمكبر الصوت (الوضع الافتراضي) والمخرج الافتراضي للجهاز.
  let wasHidden = call.classList.contains('hidden');
  new MutationObserver(() => {
    const hidden = call.classList.contains('hidden');
    if (hidden === wasHidden) return;
    wasHidden = hidden;
    if (hidden) {
      cur = { kind: 'spk', id: '', label: '' }; hideMenu();
      try { vid.setSinkId?.('')?.catch?.(() => {}); } catch {}
    }
    render(); // بيتنادى عند الفتح والقفل بس (مش مع كل تغيير class تاني)، فمفيش حلقة مع مترجم التطبيق
  }).observe(call, { attributes: true, attributeFilter: ['class'] });
  render();
})();
