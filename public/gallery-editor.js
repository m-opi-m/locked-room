// محرر الصور: بعد ما المستخدم يختار الصور من نافذة الموبايل (زي واتساب) بتفتح صفحة معاينة:
// فوق أدوات (رسم / كتابة / قص / تدوير / جودة)، تحت شريط الشرح + زر الإرسال.
// بيتضم جوه app.js وقت الـ build (مش ملف لوحده).
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const file = $('file'), editor = $('lrEditor'), canvas = $('lrEditorCanvas'), stage = $('lrStage');
  if (!file || !editor || !canvas) return;
  document.body.append(editor); // برا أي شاشة تانية عشان ما يتغطاش
  const ctx = canvas.getContext('2d');
  const crop = $('lrCrop'), cropBox = $('lrCropBox');
  const COLORS = ['#ffd43b', '#ff6b6b', '#4dabf7', '#69db7c', '#ffffff', '#111111'];
  const MAX_SIDE = 2400;

  let items = [], cur = 0, tool = '', color = COLORS[0], hd = true, busy = false;
  let drag = null, cropRect = null;

  const item = () => items[cur];
  const bw = (b) => b.naturalWidth || b.width, bh = (b) => b.naturalHeight || b.height;
  const err = (m) => { const e = $('lrErr'); e.textContent = m || ''; e.classList.toggle('hidden', !m); if (m) setTimeout(() => { if (e.textContent === m) err(''); }, 4000); };

  // ---------- الرسم ----------
  function render(it, cv) {
    const c = cv.getContext('2d'), rot = it.rotation || 0, w = bw(it.base), h = bh(it.base);
    cv.width = rot % 180 ? h : w; cv.height = rot % 180 ? w : h;
    c.clearRect(0, 0, cv.width, cv.height);
    c.save(); c.translate(cv.width / 2, cv.height / 2); c.rotate(rot * Math.PI / 180); c.drawImage(it.base, -w / 2, -h / 2); c.restore();
    const lw = Math.max(5, cv.width * 0.007);
    it.strokes.forEach((s) => {
      c.strokeStyle = s.color; c.lineWidth = lw; c.lineCap = c.lineJoin = 'round'; c.beginPath();
      s.points.forEach((p, i) => i ? c.lineTo(p.x * cv.width, p.y * cv.height) : c.moveTo(p.x * cv.width, p.y * cv.height));
      if (s.points.length === 1) c.lineTo(s.points[0].x * cv.width + 0.01, s.points[0].y * cv.height);
      c.stroke();
    });
    it.texts.forEach((t) => {
      c.font = `bold ${Math.max(30, cv.width * 0.06)}px "Segoe UI",Tahoma,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = Math.max(4, cv.width * 0.008); c.lineJoin = 'round'; c.strokeStyle = t.color === '#111111' ? '#fff' : '#111'; c.fillStyle = t.color;
      c.strokeText(t.text, t.x * cv.width, t.y * cv.height); c.fillText(t.text, t.x * cv.width, t.y * cv.height);
    });
  }
  const draw = () => { if (item()) render(item(), canvas); };

  // ---------- تحميل الصور ----------
  function loadItem(f) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(f), img = new Image();
      img.onload = () => {
        const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const base = document.createElement('canvas'); base.width = Math.round(img.naturalWidth * s); base.height = Math.round(img.naturalHeight * s);
        base.getContext('2d').drawImage(img, 0, 0, base.width, base.height);
        resolve({ base, url, rotation: 0, strokes: [], texts: [] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function open(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const loaded = (await Promise.all(list.map(loadItem))).filter(Boolean);
    if (!loaded.length) return;
    items.forEach((x) => URL.revokeObjectURL(x.url));
    items = loaded; cur = 0; setTool(''); err('');
    $('lrCaption').value = '';
    editor.classList.remove('hidden');
    renderThumbs(); draw();
  }
  function close() {
    exitCrop(false); editor.classList.add('hidden');
    items.forEach((x) => URL.revokeObjectURL(x.url)); items = [];
  }

  function renderThumbs() {
    const box = $('lrThumbs'); box.replaceChildren();
    box.classList.toggle('hidden', items.length < 2);
    items.forEach((it, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lrThumb' + (i === cur ? ' on' : '');
      const im = document.createElement('img'); im.src = it.url; im.alt = ''; b.append(im);
      b.onclick = () => { exitCrop(false); cur = i; renderThumbs(); draw(); };
      box.append(b);
    });
  }

  // ---------- الأدوات ----------
  function setTool(t) {
    if (tool === 'crop' && t !== 'crop') exitCrop(false);
    tool = t;
    editor.querySelectorAll('[data-tool=draw],[data-tool=text],[data-tool=crop]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('lrColors').classList.toggle('hidden', t !== 'draw');
    $('lrTextRow').classList.toggle('hidden', t !== 'text');
    canvas.style.cursor = t === 'draw' ? 'crosshair' : t === 'text' ? 'move' : '';
  }
  editor.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => {
    const t = b.dataset.tool;
    if (busy || !item()) return;
    if (t === 'rotate') { const it = item(); it.rotation = ((it.rotation || 0) + 90) % 360; it.strokes = []; it.texts = []; draw(); return; }
    if (t === 'hd') { hd = !hd; b.classList.toggle('on', hd); err(hd ? 'الجودة العالية مفعلة' : 'الجودة العادية (حجم أصغر)'); return; }
    if (t === 'crop') { tool === 'crop' ? setTool('') : (setTool('crop'), enterCrop()); return; }
    setTool(tool === t ? '' : t);
  });
  $('lrColors').replaceChildren(...COLORS.map((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lrColor' + (i ? '' : ' on'); b.style.background = c; b.setAttribute('aria-label', 'لون');
    b.onclick = () => { color = c; $('lrColors').querySelectorAll('.lrColor').forEach((x) => x.classList.toggle('on', x === b)); };
    return b;
  }), Object.assign(document.createElement('button'), { type: 'button', className: 'lrUndo', textContent: '↶', title: 'تراجع', onclick: () => { item()?.strokes.pop(); draw(); } }));
  $('lrAddText').onclick = () => {
    const input = $('lrTextIn'), text = input.value.trim(); if (!text || !item()) return;
    item().texts.push({ text, x: 0.5, y: 0.5, color }); input.value = ''; draw();
  };

  // ---------- رسم بالإصبع + سحب الكتابة ----------
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!item() || busy) return;
    const p = pt(e);
    if (tool === 'draw') { canvas.setPointerCapture(e.pointerId); const s = { color, points: [p] }; item().strokes.push(s); drag = { type: 'draw', s }; draw(); }
    else if (tool === 'text' && item().texts.length) {
      let best = null, bd = 0.15;
      item().texts.forEach((t) => { const d = Math.hypot(t.x - p.x, t.y - p.y); if (d < bd) { bd = d; best = t; } });
      if (best) { canvas.setPointerCapture(e.pointerId); drag = { type: 'text', t: best }; }
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return; const p = pt(e);
    if (drag.type === 'draw') drag.s.points.push(p); else { drag.t.x = p.x; drag.t.y = p.y; }
    draw();
  });
  ['pointerup', 'pointercancel'].forEach((ev) => canvas.addEventListener(ev, () => { drag = null; }));

  // ---------- القص ----------
  function placeCrop() {
    const r = canvas.getBoundingClientRect(), s = stage.getBoundingClientRect();
    Object.assign(crop.style, { left: r.left - s.left + 'px', top: r.top - s.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    Object.assign(cropBox.style, { left: cropRect.x * 100 + '%', top: cropRect.y * 100 + '%', width: cropRect.w * 100 + '%', height: cropRect.h * 100 + '%' });
  }
  function enterCrop() { cropRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 }; crop.classList.remove('hidden'); $('lrCropBar').classList.remove('hidden'); $('lrBottom').classList.add('hidden'); placeCrop(); }
  function exitCrop(apply) {
    if (crop.classList.contains('hidden')) return;
    if (apply && item()) applyCrop();
    crop.classList.add('hidden'); $('lrCropBar').classList.add('hidden'); $('lrBottom').classList.remove('hidden'); cropRect = null;
    if (tool === 'crop') setTool('');
  }
  function applyCrop() {
    const it = item(), r = cropRect, rot = document.createElement('canvas');
    const w = bw(it.base), h = bh(it.base), a = it.rotation || 0;
    rot.width = a % 180 ? h : w; rot.height = a % 180 ? w : h;
    const c = rot.getContext('2d'); c.translate(rot.width / 2, rot.height / 2); c.rotate(a * Math.PI / 180); c.drawImage(it.base, -w / 2, -h / 2);
    const sx = Math.round(r.x * rot.width), sy = Math.round(r.y * rot.height), sw = Math.max(8, Math.round(r.w * rot.width)), sh = Math.max(8, Math.round(r.h * rot.height));
    const out = document.createElement('canvas'); out.width = sw; out.height = sh;
    out.getContext('2d').drawImage(rot, sx, sy, sw, sh, 0, 0, sw, sh);
    const map = (p) => ({ ...p, x: (p.x - r.x) / r.w, y: (p.y - r.y) / r.h });
    it.strokes.forEach((s) => { s.points = s.points.map(map); });
    it.texts = it.texts.map(map);
    it.base = out; it.rotation = 0; draw();
  }
  $('lrCropOk').onclick = () => exitCrop(true);
  $('lrCropCancel').onclick = () => exitCrop(false);
  cropBox.addEventListener('pointerdown', (e) => {
    e.preventDefault(); cropBox.setPointerCapture(e.pointerId);
    const h = e.target.dataset?.h || 'move', r = crop.getBoundingClientRect();
    drag = { type: 'crop', h, sx: e.clientX, sy: e.clientY, r0: { ...cropRect }, W: r.width, H: r.height };
  });
  cropBox.addEventListener('pointermove', (e) => {
    if (!drag || drag.type !== 'crop') return;
    const dx = (e.clientX - drag.sx) / drag.W, dy = (e.clientY - drag.sy) / drag.H, o = drag.r0, MIN = 0.1;
    let { x, y, w, h } = o;
    if (drag.h === 'move') { x = Math.min(1 - w, Math.max(0, o.x + dx)); y = Math.min(1 - h, Math.max(0, o.y + dy)); }
    else {
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      if (drag.h.includes('w')) x1 = Math.min(x2 - MIN, Math.max(0, o.x + dx));
      if (drag.h.includes('e')) x2 = Math.max(x1 + MIN, Math.min(1, x2 + dx));
      if (drag.h.includes('n')) y1 = Math.min(y2 - MIN, Math.max(0, o.y + dy));
      if (drag.h.includes('s')) y2 = Math.max(y1 + MIN, Math.min(1, y2 + dy));
      x = x1; y = y1; w = x2 - x1; h = y2 - y1;
    }
    cropRect = { x, y, w, h }; placeCrop();
  });
  ['pointerup', 'pointercancel'].forEach((ev) => cropBox.addEventListener(ev, () => { drag = null; }));
  addEventListener('resize', () => { if (cropRect) placeCrop(); });

  // ---------- الإرسال ----------
  async function send() {
    if (busy || !items.length) return;
    if (typeof window.lrSendSelectedImage !== 'function') return err('مسار إرسال الصور غير جاهز، حدّث الصفحة.');
    busy = true; const btn = $('lrSend'); btn.disabled = true; btn.classList.add('busy'); err('');
    try {
      const off = document.createElement('canvas');
      for (let i = 0; i < items.length; i++) {
        render(items[i], off);
        const blob = await new Promise((r) => off.toBlob(r, 'image/jpeg', hd ? 0.94 : 0.78));
        if (!blob) throw Error('تعذر تجهيز الصورة');
        await window.lrSendSelectedImage(new File([blob], `locked-room-${Date.now()}-${i + 1}.jpg`, { type: 'image/jpeg' }));
        if (i < items.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
      const cap = $('lrCaption').value.trim();
      if (cap && typeof window.lrSendCaption === 'function') await window.lrSendCaption(cap);
      close();
    } catch (e) {
      err(e?.message || 'فشل إرسال الصورة. اتأكد إنك متصل بالغرفة وجرب تاني.');
    } finally { busy = false; btn.disabled = false; btn.classList.remove('busy'); }
  }
  $('lrSend').onclick = send;
  $('lrCaption').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $('lrClose').onclick = close;

  // ---------- فتح المحرر بعد اختيار الصور ----------
  // listener في الـ capture + stopImmediatePropagation عشان معالج app.js القديم (اللي بيبعت الصورة علطول) ما يشتغلش.
  file.onchange = null;
  file.addEventListener('change', (e) => {
    e.stopImmediatePropagation();
    const files = [...(file.files || [])];
    file.value = '';
    if (files.length) open(files);
  }, true);
})();
