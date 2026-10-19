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
    noProx: ['المتصفح ده مفيهوش حسّاس القرب، فالشاشة مش هتقفل لوحدها عند الودن.', 'This browser has no proximity sensor access, so the screen will not turn off by your ear.'],
    no: ['مفيش مخرج صوت تاني متاح، أو المتصفح ما بيسمحش بالتحويل. استخدم أزرار الصوت في الموبايل.', 'No other audio output is available, or the browser does not allow switching. Use your phone’s sound controls.'],
  };
  // داخل تطبيق الأندرويد فيه جسر native (AndroidAudio): تحويل حقيقي لسماعة الأذن + إطفاء الشاشة بحسّاس القرب.
  const nat = (typeof window.AndroidAudio === 'object' && typeof window.AndroidAudio.setEarpiece === 'function') ? window.AndroidAudio : null;
  const natSet = (ear) => { try { nat.setEarpiece(!!ear); } catch {} };
  const tr = (k) => TXT[k][en() ? 1 : 0];
  let cur = { kind: 'spk', id: '', label: '' }, soft = false, busy = false, toastEl = null, toastT = 0, menu = null;

  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'lrToast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 4200);
  }
  // ===== حسّاس القرب: شغّال في وضع سماعة الأذن بس =====
  // المتصفح مبيقدرش يطفي الشاشة فعلاً، فبنغطيها بطبقة سودا بتمسك اللمس (OLED الأسود = مطفية، ومفيش لمسة غلط).
  // الحسّاس: ProximitySensor (Generic Sensor) أو أحداث deviceproximity/userproximity لو المتصفح بيدعمهم.
  let prox = null, proxCover = null, proxOn = false, proxWarned = false;
  const coverSet = (near) => {
    if (near && !proxCover) {
      proxCover = document.createElement('div'); proxCover.id = 'lrProxCover';
      proxCover.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483647;touch-action:none;';
      for (const ev of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend', 'contextmenu']) proxCover.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
      document.body.appendChild(proxCover);
    } else if (!near && proxCover) { proxCover.remove(); proxCover = null; }
  };
  const onDevProx = (e) => coverSet(typeof e.value === 'number' ? e.value < (e.max || 5) / 2 : false);
  const onUserProx = (e) => coverSet(!!e.near);
  function proxStart() {
    if (proxOn) return; proxOn = true;
    try {
      if ('ProximitySensor' in window) {
        prox = new window.ProximitySensor({ frequency: 8 });
        prox.addEventListener('reading', () => coverSet(!!prox.near));
        prox.addEventListener('error', () => { if (!proxWarned) { proxWarned = true; toast(tr('noProx')); } });
        prox.start(); return;
      }
    } catch {}
    if ('ondeviceproximity' in window || 'onuserproximity' in window) {
      addEventListener('deviceproximity', onDevProx); addEventListener('userproximity', onUserProx); return;
    }
    if (!proxWarned) { proxWarned = true; toast(tr('noProx')); }
  }
  function proxStop() {
    if (!proxOn) return; proxOn = false;
    try { prox && prox.stop(); } catch {}
    prox = null;
    removeEventListener('deviceproximity', onDevProx); removeEventListener('userproximity', onUserProx);
    coverSet(false);
  }

  function render() {
    const spk = cur.kind === 'spk';
    if (!nat && cur.kind === 'ear' && !call.classList.contains('hidden')) proxStart(); else proxStop();
    if (btn.classList.contains('isOn') !== spk) btn.classList.toggle('isOn', spk);
    if (btn.getAttribute('aria-pressed') !== String(spk)) btn.setAttribute('aria-pressed', String(spk));
    // بنكتب بس لو القيمة اتغيّرت: مترجم التطبيق بيراقب تغييرات النص، والكتابة المتكررة ممكن تعمل حلقة لا نهائية.
    const label = $('speakerLabel'), txt = cur.kind === 'oth' ? (cur.label || tr('oth')) : tr(cur.kind);
    if (label.textContent !== txt) label.textContent = txt;
    const use = $('speakerIcon').querySelector('use'), href = cur.kind === 'ear' ? '#i-phone' : '#i-volume';
    if (use && use.getAttribute('href') !== href) use.setAttribute('href', href);
  }
  const isEar = (d) => /earpiece|receiver|handset|phone speaker|ear speaker|سماعة الأذن/i.test(d.label || '');
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

  // الكروم على أندرويد مبيعرضش سماعة الأذن كمخرج صوت، فلو مفيش مخرجين حقيقيين بنبدّل بين
  // "مكبر الصوت" (صوت كامل) و"سماعة الأذن" (صوت هادي للسمع من قريب). ده تقليد للوضع مش تحويل حقيقي للمخرج.
  function softToggle() {
    soft = !soft;
    try { vid.volume = soft ? 0.3 : 1; } catch {}
    cur = soft ? { kind: 'ear', id: 'soft', label: '' } : { kind: 'spk', id: '', label: '' };
    render();
  }
  function natToggle() {
    const ear = cur.kind !== 'ear';
    natSet(ear);
    cur = ear ? { kind: 'ear', id: 'native', label: '' } : { kind: 'spk', id: '', label: '' };
    render();
  }
  async function next() {
    if (nat) return natToggle();
    if (busy) return; busy = true;
    const opts = await options();
    if (opts.length < 2) { busy = false; return softToggle(); }
    let i = opts.findIndex((o) => o.id === cur.id && o.kind === cur.kind);
    if (i < 0) i = 0; // الوضع الافتراضي = مكبر الصوت (أول اختيار)
    const o = opts[(i + 1) % opts.length];
    const ok = await apply(o); busy = false;
    if (!ok) softToggle();
  }
  async function pick() {
    if (nat) return natToggle();
    hideMenu();
    const opts = await options();
    if (opts.length < 2) return softToggle();
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
    if (nat) { if (hidden) { try { nat.release(); } catch {} } else natSet(false); }
    if (hidden) {
      cur = { kind: 'spk', id: '', label: '' }; soft = false; hideMenu();
      try { vid.volume = 1; } catch {}
      try { vid.setSinkId?.('')?.catch?.(() => {}); } catch {}
    }
    render(); // بيتنادى عند الفتح والقفل بس (مش مع كل تغيير class تاني)، فمفيش حلقة مع مترجم التطبيق
  }).observe(call, { attributes: true, attributeFilter: ['class'] });
  render();
})();
