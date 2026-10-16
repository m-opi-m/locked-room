// إرسال الصور من المعرض — مكتوب من الصفر (1.1.0) + صفحة معاينة وقص وشرح (1.2.0).
// بيتضم جوه app.js وقت الـ build. بيعتمد على الجسور اللي في app.js:
//   window.lrSendSelectedImage(File)  window.lrReconnect()  window.lrPickAt
// المبدأ: ما نفترضش إن حاجة اشتغلت. كل مرحلة ليها رسالة ظاهرة فوق الشاشة (مش جوه الشات)،
// فلو فشل حاجة المستخدم يشوف في أنهي مرحلة وليه.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const attachBtn = $('attach');
  if (!attachBtn) return;

  const MAX_SIDE = 1600, QUALITY = 0.85;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- رسالة ظاهرة فوق (مستقلة عن #log) ----------
  let banner = null, bannerT = 0;
  function say(msg, ms = 4000) {
    if (!banner) { banner = document.createElement('div'); banner.className = 'lrToast'; document.body.append(banner); }
    banner.textContent = msg; banner.classList.add('show');
    clearTimeout(bannerT); if (ms) bannerT = setTimeout(() => banner.classList.remove('show'), ms);
  }
  const trace = (window.lrImgTrace = []);
  const step = (s, extra) => { trace.push([Date.now() % 1e6, s, extra == null ? '' : String(extra)]); if (trace.length > 60) trace.shift(); };

  // ---------- input جديد مخصوص للصور (مش #file القديم) ----------
  // مش display:none: بعض الـ WebViews بتتجاهل click() على العناصر المخفية بالكامل.
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.id = 'imgPick';
  input.setAttribute('aria-hidden', 'true'); input.tabIndex = -1;
  input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(input);

  attachBtn.onclick = () => {
    $('attachMenu')?.classList.add('hidden');
    $('attachMenuBtn')?.setAttribute('aria-expanded', 'false');
    window.lrPickAt = Date.now(); // يمنع القفل التلقائي لحد دقيقتين أثناء المعرض
    step('open-picker');
    try { input.value = ''; } catch {}
    input.click();
  };

  // ---------- أدوات ----------
  function sniffType(b) { // لو الموبايل رجّع type فاضي
    const u = new Uint8Array(b.slice(0, 12));
    if (u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg';
    if (u[0] === 0x89 && u[1] === 0x50) return 'image/png';
    if (u[0] === 0x47 && u[1] === 0x49) return 'image/gif';
    if (u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57) return 'image/webp';
    const tag = String.fromCharCode(...u.slice(4, 12));
    if (/ftyp(heic|heix|mif1|hevc)/.test(tag)) return 'image/heic';
    return '';
  }
  async function decode(blob) {
    try { const bm = await createImageBitmap(blob); return { src: bm, w: bm.width, h: bm.height }; } catch (e) { step('bitmap-fail', e?.message); }
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(Error('decode')); i.src = url; });
      return { src: img, w: img.naturalWidth, h: img.naturalHeight };
    } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }
  const MAX_WORK = 2400;
  async function toCanvas(blob) { // بنفك الصورة لـ canvas شغّال (أقصى ضلع 2400)
    const d = await decode(blob);
    if (!d.w || !d.h) throw Error('الصورة فاضية');
    const s = Math.min(1, MAX_WORK / Math.max(d.w, d.h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(d.w * s)); c.height = Math.max(1, Math.round(d.h * s));
    c.getContext('2d').drawImage(d.src, 0, 0, c.width, c.height);
    return c;
  }
  async function canvasToJpeg(cv) { // للإرسال: أقصى ضلع 1600
    const s = Math.min(1, MAX_SIDE / Math.max(cv.width, cv.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(cv.width * s)); c.height = Math.max(1, Math.round(cv.height * s));
    c.getContext('2d').drawImage(cv, 0, 0, c.width, c.height);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', QUALITY));
    if (!out) throw Error('تعذر تجهيز الصورة');
    return new File([out], `locked-room-${Date.now()}.jpg`, { type: 'image/jpeg' });
  }
  const chatOpen = () => { const c = $('chat'); return !!c && !c.classList.contains('hidden'); };

  // ---------- فقاعة الصورة في الشات (دايرة تحميل / ⟳ للإعادة) ----------
  function bubble(previewUrl, retry) {
    const log = $('log'); if (!log) return { sending() {}, fail() {}, ok() {}, cancelled: false };
    const m = document.createElement('div'); m.className = 'm me lrPending';
    const wrap = document.createElement('div'); wrap.className = 'lrPendWrap';
    const im = document.createElement('img'); im.alt = 'صورة'; im.src = previewUrl; im.draggable = false;
    const ov = document.createElement('button'); ov.type = 'button'; ov.className = 'lrPendOv';
    wrap.append(im, ov); m.append(wrap);
    const ui = { cancelled: false };
    const state = (s) => {
      m.dataset.state = s;
      // جاري الإرسال: دايرة بتلف وجواها X (اضغط لإلغاء الإرسال) — فشل: زر "إعادة المحاولة"
      ov.innerHTML = s === 'sending'
        ? '<span class="lrCancel"><span class="lrSpin2"></span><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></span>'
        : '<span class="lrRetryPill">إعادة المحاولة <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg></span>';
    };
    ov.onclick = (e) => {
      e.stopPropagation();
      if (m.dataset.state === 'sending') { ui.cancelled = true; m.remove(); URL.revokeObjectURL(previewUrl); step('cancelled'); say('اتلغى الإرسال', 1800); }
      else if (m.dataset.state === 'failed') retry();
    };
    log.append(m); log.scrollTop = log.scrollHeight; im.onload = () => { log.scrollTop = log.scrollHeight; };
    state('sending');
    ui.sending = () => state('sending'); ui.fail = () => state('failed'); ui.ok = () => m.remove();
    return ui;
  }

  // ---------- إرسال ملف جاهز (JPEG) مع محاولات ----------
  async function sendPrepared(file, ui) {
    ui.cancelled = false; ui.sending();
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (ui.cancelled) return false;
      try {
        step('send', attempt);
        await window.lrSendSelectedImage(file, () => ui.cancelled);
        if (ui.cancelled) return false;
        step('sent'); ui.ok(); return true;
      } catch (e) {
        if (ui.cancelled || e?.message === 'cancelled') return false;
        lastErr = e; step('send-fail', e?.message); await sleep(700);
      }
    }
    if (ui.cancelled) return false;
    ui.fail();
    say('❌ ' + (lastErr?.message || 'فشل الإرسال') + ' — اضغط "إعادة المحاولة" على الصورة', 6000);
    return false;
  }

  // ---------- استقبال الاختيار ----------
  const seen = new WeakSet();
  async function onPicked() {
    const f = input.files && input.files[0];
    window.lrPickAt = 0;
    step('picked', f ? `${f.name}|${f.type}|${f.size}` : 'none');
    if (!f || seen.has(f)) return;
    seen.add(f);
    say('⏳ جاري تجهيز الصورة…', 0);
    let work;
    try {
      // نقرأ البايتات فوراً: على أندرويد الـ URI ممكن يبوظ لو اتأخرنا بعد رجوع التطبيق.
      const buf = await f.arrayBuffer();
      step('read', buf.byteLength);
      if (!buf.byteLength) throw Error('الصورة فاضية أو مش مسموح بقراءتها');
      const type = f.type && f.type.startsWith('image/') ? f.type : sniffType(buf);
      if (!type) throw Error('الملف ده مش صورة');
      work = await toCanvas(new Blob([buf], { type }));
      step('canvas', work.width + 'x' + work.height);
    } catch (e) {
      step('prep-fail', e?.message);
      say('❌ ' + (e?.message || 'معرفتش أقرأ الصورة') + (/heic|heif/i.test(f.type) ? ' (HEIC مش مدعوم هنا)' : ''), 6000);
      try { input.value = ''; } catch {}
      return;
    }
    try { input.value = ''; } catch {}
    if (!chatOpen()) { say('🔒 الشات اتقفل. ادخل الباسورد وارجع ابعت الصورة تاني.', 7000); step('chat-closed'); return; }
    say('', 1); banner?.classList.remove('show');
    openPreview(work);
  }
  // الإرسال الفعلي (بعد المعاينة): الصورة + الشرح لو اتكتب
  async function sendFinal(cv, caption) {
    let prepared;
    try { prepared = await canvasToJpeg(cv); } catch (e) { say('❌ ' + (e?.message || 'تعذر تجهيز الصورة'), 6000); return; }
    if (!chatOpen()) { say('🔒 الشات اتقفل. ادخل الباسورد وارجع ابعت الصورة تاني.', 7000); return; }
    const previewUrl = URL.createObjectURL(prepared);
    const ui = bubble(previewUrl, () => sendPrepared(prepared, ui));
    const ok = await sendPrepared(prepared, ui);
    if (ok) {
      if (caption && typeof window.lrSendCaption === 'function') { try { await window.lrSendCaption(caption); } catch (e) { say('الصورة اتبعتت بس الشرح فشل: ' + (e?.message || ''), 5000); } }
      setTimeout(() => URL.revokeObjectURL(previewUrl), 3000);
    }
  }
  // ================= صفحة المعاينة + القص =================
  const ICON_CROP = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';
  const ICON_ROT = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M2.5 12 21 3.5 17 12l4 8.5z"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>';

  const ov = document.createElement('div');
  ov.className = 'lrp hidden'; ov.dir = 'rtl'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'معاينة الصورة');
  ov.innerHTML =
    '<div class="lrpTop"><button type="button" id="lrpClose" aria-label="إغلاق">' + ICON_X + '</button><span class="lrpGrow"></span>' +
    '<button type="button" id="lrpCrop" aria-label="قص">' + ICON_CROP + '</button></div>' +
    '<div class="lrpStage"><canvas id="lrpCv"></canvas></div>' +
    '<div class="lrpBottom"><input id="lrpCaption" type="text" maxlength="1000" autocomplete="off" placeholder="إضافة شرح توضيحي...">' +
    '<div class="lrpRow"><button type="button" id="lrpSend" class="lrpSend" aria-label="إرسال">' + ICON_SEND + '</button></div></div>' +
    '<div class="lrpCrop hidden" id="lrpCropUI"><div class="lrpCropStage"><div class="lrpWrap" id="lrpWrap"><canvas id="lrpCropCv"></canvas>' +
    '<div class="lrpBox" id="lrpBox"><i class="g1"></i><i class="g2"></i><i class="g3"></i><i class="g4"></i>' +
    '<b class="c tl"></b><b class="c tr"></b><b class="c bl"></b><b class="c br"></b><b class="c tm"></b><b class="c bm"></b><b class="c ml"></b><b class="c mr"></b></div></div></div>' +
    '<div class="lrpCropBar"><button type="button" id="lrpCCancel">إلغاء</button><button type="button" id="lrpRot" aria-label="تدوير">' + ICON_ROT + '</button><button type="button" id="lrpCDone">تم</button></div></div>';
  document.body.append(ov);
  const q = (id) => ov.querySelector('#' + id);
  const pv = q('lrpCv'), cropUI = q('lrpCropUI'), cropCv = q('lrpCropCv'), wrap = q('lrpWrap'), box = q('lrpBox');
  const cap = q('lrpCaption'), sendBtn = q('lrpSend');
  let cur = null, sending = false, cr = { x: 0, y: 0, w: 0, h: 0 }, dw = 0, dh = 0;

  function paint(cv, src) { cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0); }
  function openPreview(c) {
    cur = c; sending = false; sendBtn.disabled = false; cap.value = '';
    paint(pv, cur); cropUI.classList.add('hidden'); ov.classList.remove('hidden'); step('preview-open');
  }
  function closePreview() { ov.classList.add('hidden'); cropUI.classList.add('hidden'); cur = null; cap.value = ''; try { cap.blur(); } catch {} }
  q('lrpClose').onclick = closePreview;
  // أمان: لو الشات اتقفل (قفل تلقائي) المعاينة تتشال فوراً ومتفضلش فوق شاشة القفل
  setInterval(() => { if (!ov.classList.contains('hidden') && !chatOpen()) { closePreview(); say('🔒 الشات اتقفل.', 4000); } }, 500);

  sendBtn.onclick = async () => {
    if (sending || !cur) return;
    sending = true; sendBtn.disabled = true;
    const c = cur, caption = cap.value.trim();
    closePreview();
    await sendFinal(c, caption);
  };
  cap.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); } });

  // ---- وضع القص ----
  const MIN = 48;
  const applyBox = () => { box.style.left = cr.x + 'px'; box.style.top = cr.y + 'px'; box.style.width = cr.w + 'px'; box.style.height = cr.h + 'px'; };
  function startCrop() {
    paint(cropCv, cur); cropUI.classList.remove('hidden');
    requestAnimationFrame(() => {
      const r = cropCv.getBoundingClientRect(); dw = r.width; dh = r.height;
      cr = { x: 0, y: 0, w: dw, h: dh }; applyBox();
    });
  }
  q('lrpCrop').onclick = () => { if (cur) startCrop(); };
  q('lrpCCancel').onclick = () => cropUI.classList.add('hidden');
  q('lrpRot').onclick = () => {
    const n = document.createElement('canvas'); n.width = cur.height; n.height = cur.width;
    const c = n.getContext('2d'); c.translate(n.width / 2, n.height / 2); c.rotate(Math.PI / 2); c.drawImage(cur, -cur.width / 2, -cur.height / 2);
    cur = n; startCrop();
  };
  q('lrpCDone').onclick = () => {
    const sx = cur.width / dw, sy = cur.height / dh;
    const x = Math.max(0, Math.round(cr.x * sx)), y = Math.max(0, Math.round(cr.y * sy));
    const w = Math.max(1, Math.min(cur.width - x, Math.round(cr.w * sx))), h = Math.max(1, Math.min(cur.height - y, Math.round(cr.h * sy)));
    const n = document.createElement('canvas'); n.width = w; n.height = h;
    n.getContext('2d').drawImage(cur, x, y, w, h, 0, 0, w, h);
    cur = n; paint(pv, cur); cropUI.classList.add('hidden'); step('cropped', w + 'x' + h);
  };
  // سحب المقابض/الصندوق (pointer events: يشتغل بالإصبع والماوس)
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect(), M = 28;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < -M || py < -M || px > r.width + M || py > r.height + M) return;
    const T = Math.min(36, r.width / 3, r.height / 3);
    drag = { sx: e.clientX, sy: e.clientY, o: { ...cr }, L: px < T, R: px > r.width - T, T: py < T, B: py > r.height - T };
    drag.move = !(drag.L || drag.R || drag.T || drag.B);
    try { wrap.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, o = drag.o, n = { ...o };
    if (drag.move) {
      n.x = Math.min(Math.max(0, o.x + dx), dw - o.w); n.y = Math.min(Math.max(0, o.y + dy), dh - o.h);
    } else {
      if (drag.L) { const nx = Math.min(Math.max(0, o.x + dx), o.x + o.w - MIN); n.x = nx; n.w = o.x + o.w - nx; }
      if (drag.R) n.w = Math.min(Math.max(MIN, o.w + dx), dw - o.x);
      if (drag.T) { const ny = Math.min(Math.max(0, o.y + dy), o.y + o.h - MIN); n.y = ny; n.h = o.y + o.h - ny; }
      if (drag.B) n.h = Math.min(Math.max(MIN, o.h + dy), dh - o.y);
    }
    cr = n; applyBox();
  });
  const endDrag = () => { drag = null; };
  wrap.addEventListener('pointerup', endDrag); wrap.addEventListener('pointercancel', endDrag);

  input.addEventListener('change', onPicked);
  input.addEventListener('input', onPicked); // بعض الـ WebViews بتطلق input بس
  input.addEventListener('cancel', () => { window.lrPickAt = 0; step('cancel'); });

  // ---------- رجّع الاتصال أول ما ترجع للتطبيق (من غير ما يمسح الشات) ----------
  ['visibilitychange', 'focus', 'online', 'pageshow'].forEach((ev) => addEventListener(ev, () => {
    if (!document.hidden) setTimeout(() => { try { window.lrReconnect?.()?.catch?.(() => {}); } catch {} }, 300);
  }));
})();
