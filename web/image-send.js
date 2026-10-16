// إرسال الصور من المعرض — مكتوب من الصفر (1.1.0).
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
  async function toJpeg(blob) {
    const d = await decode(blob);
    if (!d.w || !d.h) throw Error('الصورة فاضية');
    const s = Math.min(1, MAX_SIDE / Math.max(d.w, d.h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(d.w * s)); c.height = Math.max(1, Math.round(d.h * s));
    c.getContext('2d').drawImage(d.src, 0, 0, c.width, c.height);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', QUALITY));
    if (!out) throw Error('تعذر تجهيز الصورة');
    return new File([out], `locked-room-${Date.now()}.jpg`, { type: 'image/jpeg' });
  }
  const chatOpen = () => { const c = $('chat'); return !!c && !c.classList.contains('hidden'); };

  // ---------- فقاعة الصورة في الشات (دايرة تحميل / ⟳ للإعادة) ----------
  function bubble(previewUrl, retry) {
    const log = $('log'); if (!log) return { ok() {}, fail() {} };
    const m = document.createElement('div'); m.className = 'm me lrPending';
    const wrap = document.createElement('div'); wrap.className = 'lrPendWrap';
    const im = document.createElement('img'); im.alt = 'صورة'; im.src = previewUrl; im.draggable = false;
    const ov = document.createElement('button'); ov.type = 'button'; ov.className = 'lrPendOv';
    const note = document.createElement('small'); note.className = 'lrPendNote';
    wrap.append(im, ov); m.append(wrap, note);
    const state = (s, msg) => {
      m.dataset.state = s; ov.disabled = s === 'sending';
      ov.innerHTML = s === 'sending' ? '<span class="lrSpin2"></span>' : '<span class="lrRetry">⟳</span>';
      note.textContent = s === 'sending' ? 'جاري الإرسال…' : (msg ? msg + ' — ' : '') + 'اضغط على الصورة لإعادة المحاولة';
    };
    ov.onclick = (e) => { e.stopPropagation(); if (m.dataset.state === 'failed') retry(); };
    log.append(m); log.scrollTop = log.scrollHeight; im.onload = () => { log.scrollTop = log.scrollHeight; };
    state('sending');
    return { sending: () => state('sending'), fail: (msg) => state('failed', msg), ok: () => m.remove(), el: m };
  }

  // ---------- إرسال ملف جاهز (JPEG) مع محاولات ----------
  async function sendPrepared(file, ui) {
    ui.sending();
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        step('send', attempt);
        await window.lrSendSelectedImage(file);
        step('sent'); ui.ok(); return true;
      } catch (e) { lastErr = e; step('send-fail', e?.message); await sleep(700); }
    }
    ui.fail(lastErr?.message || 'فشل الإرسال');
    say('❌ ' + (lastErr?.message || 'فشل الإرسال') + ' — اضغط على الصورة في الشات لإعادة المحاولة', 6000);
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
    let prepared, previewUrl;
    try {
      // نقرأ البايتات فوراً: على أندرويد الـ URI ممكن يبوظ لو اتأخرنا بعد رجوع التطبيق.
      const buf = await f.arrayBuffer();
      step('read', buf.byteLength);
      if (!buf.byteLength) throw Error('الصورة فاضية أو مش مسموح بقراءتها');
      const type = f.type && f.type.startsWith('image/') ? f.type : sniffType(buf);
      if (!type) throw Error('الملف ده مش صورة');
      prepared = await toJpeg(new Blob([buf], { type }));
      step('jpeg', prepared.size);
    } catch (e) {
      step('prep-fail', e?.message);
      say('❌ ' + (e?.message || 'معرفتش أقرأ الصورة') + (/heic|heif/i.test(f.type) ? ' (HEIC مش مدعوم هنا)' : ''), 6000);
      try { input.value = ''; } catch {}
      return;
    }
    try { input.value = ''; } catch {}

    if (!chatOpen()) { say('🔒 الشات اتقفل. ادخل الباسورد وارجع ابعت الصورة تاني.', 7000); step('chat-closed'); return; }
    previewUrl = URL.createObjectURL(prepared);
    const ui = bubble(previewUrl, () => sendPrepared(prepared, ui));
    say('⏳ جاري الإرسال…', 0);
    const ok = await sendPrepared(prepared, ui);
    if (ok) { say('✅ اتبعتت', 1800); setTimeout(() => URL.revokeObjectURL(previewUrl), 3000); }
  }
  input.addEventListener('change', onPicked);
  input.addEventListener('input', onPicked); // بعض الـ WebViews بتطلق input بس
  input.addEventListener('cancel', () => { window.lrPickAt = 0; step('cancel'); });

  // ---------- رجّع الاتصال أول ما ترجع للتطبيق (من غير ما يمسح الشات) ----------
  ['visibilitychange', 'focus', 'online', 'pageshow'].forEach((ev) => addEventListener(ev, () => {
    if (!document.hidden) setTimeout(() => { try { window.lrReconnect?.()?.catch?.(() => {}); } catch {} }, 300);
  }));
})();
