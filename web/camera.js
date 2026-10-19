// الكاميرا الجديدة (1.27.0): شاشة كاميرا زي واتساب + شريط آخر الصور + معاينة الصورة + محرر الفيديو (قص/كتم).
// بيتضم في آخر app.js وقت الـ build (بعد image-send.js) وبيعتمد على الجسور:
//   window.lrOpenPhotoPreview(canvas,{onCancel,onSend})  window.lrImgToCanvas(file)   (image-send.js)
//   window.lrSendVideo(blob,type,caption,once)  window.lrSendAny(file)  window.lrMediaError(e,'camera')  (app.js / files.js)
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const btn0 = $('cameraBtn');
  if (!btn0) return;

  const MAX_VID = 2.5 * 1024 * 1024;          // نفس حد رسالة الفيديو
  const MIN_HOLD = 420;                       // ضغطة أطول من كده = فيديو
  const MAX_RECENT = 14;
  const arabic = () => document.documentElement.lang !== 'en';
  const chatOpen = () => { const c = $('chat'); return !!c && !c.classList.contains('hidden'); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nf = (n) => n.toLocaleString(arabic() ? 'ar-EG' : 'en-US');
  const fmtT = (s) => { s = Math.max(0, Math.round(s)); return nf(Math.floor(s / 60)) + ':' + (s % 60 < 10 ? nf(0) : '') + nf(s % 60); };
  const SV = (w, d, f = 'none') => '<svg viewBox="0 0 24 24" width="' + w + '" height="' + w + '" fill="' + f + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    x: SV(26, '<path d="M5 5l14 14M19 5 5 19"/>'),
    flash: SV(26, '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>'),
    flashOff: SV(26, '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/><path d="M3 3l18 18"/>'),
    flip: SV(28, '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
    gallery: SV(26, '<rect width="18" height="18" x="3" y="3" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
    play: SV(34, '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>', 'currentColor'),
    vol: SV(24, '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>'),
    volOff: SV(24, '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>'),
    send: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M2.5 12 21 3.5 17 12l4 8.5z"/></svg>',
  };

  // ---------- رسالة ظاهرة فوق كل حاجة ----------
  let toastEl = null, toastT = 0;
  function toast(msg, ms = 4000) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'lrToast'; document.body.append(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); if (ms) toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  const toastOff = () => { clearTimeout(toastT); toastEl?.classList.remove('show'); };

  // ================= آخر الصور/الفيديوهات (في الذاكرة بس — مفيش تخزين على الجهاز عشان الخصوصية) =================
  const recents = [];
  async function thumbOfImage(blob) {
    const bm = await createImageBitmap(blob), s = Math.min(bm.width, bm.height), c = document.createElement('canvas');
    c.width = c.height = 120; c.getContext('2d').drawImage(bm, (bm.width - s) / 2, (bm.height - s) / 2, s, s, 0, 0, 120, 120); bm.close?.();
    return URL.createObjectURL(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7)));
  }
  async function frameAt(url, t, h = 120) { // لقطة من فيديو (blob url) عند الثانية t
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    try {
      await meta(v);
      await seek(v, Math.min(t, (isFinite(v.duration) ? v.duration : t) - 0.01));
      const w = Math.max(1, Math.round(h * (v.videoWidth || 3) / (v.videoHeight || 4))), c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, w, h); return c;
    } finally { v.removeAttribute('src'); v.load(); }
  }
  async function addRecent(it) {
    try {
      if (it.type === 'image') it.thumb = await thumbOfImage(it.blob);
      else { const u = URL.createObjectURL(it.blob); try { const c = await frameAt(u, 0.1); it.thumb = URL.createObjectURL(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7))); } finally { URL.revokeObjectURL(u); } }
    } catch { it.thumb = ''; }
    recents.unshift(it);
    while (recents.length > MAX_RECENT) { const o = recents.pop(); if (o.thumb) URL.revokeObjectURL(o.thumb); }
    renderStrip();
  }
  function clearRecents() { while (recents.length) { const o = recents.pop(); if (o.thumb) URL.revokeObjectURL(o.thumb); } renderStrip(); }

  // ================= فك duration بتاع webm (MediaRecorder مبيكتبهاش) =================
  const meta = (v) => new Promise((ok) => {
    if (v.readyState >= 1) return ok();
    const d = () => { v.removeEventListener('loadedmetadata', d); v.removeEventListener('error', d); ok(); };
    v.addEventListener('loadedmetadata', d); v.addEventListener('error', d); setTimeout(d, 4000);
  });
  const seek = (v, t) => new Promise((ok) => {
    const d = () => { v.removeEventListener('seeked', d); ok(); };
    v.addEventListener('seeked', d); setTimeout(d, 900);
    try { v.currentTime = Math.max(0, t); } catch { ok(); }
  });
  async function realDuration(v, hint) {
    await meta(v);
    if (!isFinite(v.duration) || v.duration <= 0) {
      await new Promise((ok) => { const d = () => { v.removeEventListener('durationchange', d); v.removeEventListener('timeupdate', d); ok(); }; v.addEventListener('durationchange', d); v.addEventListener('timeupdate', d); setTimeout(d, 2000); try { v.currentTime = 1e7; } catch { ok(); } });
      try { v.currentTime = 0; } catch {}
    }
    return isFinite(v.duration) && v.duration > 0 ? v.duration : (hint || 0);
  }
  const canCapture = !!(HTMLVideoElement.prototype.captureStream || HTMLVideoElement.prototype.mozCaptureStream);
  const pickMime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

  // ================= شاشة الكاميرا =================
  const cam = document.createElement('div');
  cam.className = 'lrcam hidden'; cam.dir = 'rtl'; cam.setAttribute('role', 'dialog'); cam.setAttribute('aria-label', 'الكاميرا');
  cam.innerHTML =
    '<div class="lrcamStage"><video id="lrcamVid" autoplay muted playsinline></video>' +
    '<div class="lrcamTop"><button type="button" class="lrcamBtn" id="lrcamClose" aria-label="إغلاق">' + I.x + '</button><span class="lrcamRec hidden" id="lrcamRec"><i></i><b id="lrcamRecT">0:00</b></span>' +
    '<button type="button" class="lrcamBtn" id="lrcamFlash" aria-label="الفلاش">' + I.flashOff + '<em id="lrcamFlashA" class="hidden">A</em></button></div>' +
    '<div class="lrcamNote" id="lrcamNote"></div></div>' +
    '<div class="lrcamStrip" id="lrcamStrip"></div>' +
    '<div class="lrcamCtl"><button type="button" class="lrcamBtn" id="lrcamGal" aria-label="اختيار صورة من المعرض">' + I.gallery + '</button>' +
    '<button type="button" id="lrcamShutter" aria-label="التقاط صورة أو اضغط مطولاً لتسجيل فيديو"><span></span></button>' +
    '<button type="button" class="lrcamBtn" id="lrcamFlip" aria-label="تبديل الكاميرا">' + I.flip + '</button></div>' +
    '<div class="lrcamModes"><button type="button" data-m="photo" class="on">صورة</button><button type="button" data-m="video">فيديو</button></div>';
  document.body.append(cam);
  // input المعرض برّه الشاشة (زي image-send.js): بعض الـ WebViews بتتجاهل click() على العناصر المخفية، والستايل العام بيظهره جوه الـ flex
  const pick = document.createElement('input');
  pick.type = 'file'; pick.accept = 'image/*,video/*,.heic,.heif,.avif'; pick.id = 'lrcamPick'; pick.setAttribute('aria-hidden', 'true'); pick.tabIndex = -1;
  pick.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(pick);
  const cq = (id) => cam.querySelector('#' + id);
  const vid = cq('lrcamVid'), shutter = cq('lrcamShutter'), strip = cq('lrcamStrip'), note = cq('lrcamNote'), recBadge = cq('lrcamRec'), recT = cq('lrcamRecT');
  const flashBtn = cq('lrcamFlash');

  let stream = null, facing = 'environment', mode = 'photo', isOpen = false, opening = false;

  // ---- الفلاش (إيقاف ← تشغيل ← تلقائي) ----
  let flashMode = 'off', flashTimer = 0;
  const vTrack = () => stream && stream.getVideoTracks()[0];
  async function torch(on) {
    const t = vTrack(); if (!t || !t.applyConstraints) return false;
    try { if (!t.getCapabilities?.().torch) return false; await t.applyConstraints({ advanced: [{ torch: !!on }] }); return true; } catch { return false; }
  }
  function brightness() {
    if (!vid || vid.readyState < 2 || !vid.videoWidth) return 255;
    const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true }); c.width = c.height = 12;
    try { x.drawImage(vid, 0, 0, 12, 12); const d = x.getImageData(0, 0, 12, 12).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return s / (d.length / 4); } catch { return 255; }
  }
  async function applyFlash() {
    clearInterval(flashTimer); flashTimer = 0;
    flashBtn.innerHTML = (flashMode === 'off' ? I.flashOff : I.flash) + '<em id="lrcamFlashA" class="' + (flashMode === 'auto' ? '' : 'hidden') + '">A</em>';
    flashBtn.classList.toggle('on', flashMode !== 'off');
    if (flashMode === 'auto') { const f = async () => { await torch(brightness() < 62); }; await f(); flashTimer = setInterval(f, 1200); }
    else await torch(flashMode === 'on');
  }
  flashBtn.onclick = async () => {
    const t = vTrack(); let can = false; try { can = !!t?.getCapabilities?.().torch; } catch {}
    if (!can) { note.textContent = arabic() ? 'الفلاش غير متاح في هذه الكاميرا' : 'Flash is not available on this camera'; setTimeout(() => { note.textContent = ''; }, 2200); return; }
    flashMode = flashMode === 'off' ? 'on' : flashMode === 'on' ? 'auto' : 'off';
    await applyFlash();
  };

  // ---- فتح/تبديل الكاميرا ----
  let facingExact = '';
  async function getStream(deviceId) {
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facingExact ? { exact: facingExact } : { ideal: facing } }) } });
  }
  function useStream(s) {
    const old = stream; stream = s; vid.srcObject = s; vid.classList.toggle('mirror', (s.getVideoTracks()[0]?.getSettings?.().facingMode || facing) === 'user');
    old && old.getTracks().forEach((t) => t.stop());
    vid.play().catch(() => {});
  }
  async function open() {
    if (isOpen || opening) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast(arabic() ? 'الكاميرا غير مدعومة على هذا الجهاز.' : 'Camera is not supported on this device.'); return; }
    if (!chatOpen()) return;
    opening = true;
    try {
      facing = 'environment';
      const s = await getStream();
      cam.classList.remove('hidden'); isOpen = true; note.textContent = ''; setMode('photo'); renderStrip();
      useStream(s); if (flashMode !== 'off') applyFlash();
    } catch (e) {
      toast(window.lrMediaError ? window.lrMediaError(e, 'camera') : (arabic() ? 'معرفتش أفتح الكاميرا. اتأكد إنك سمحت بالإذن.' : 'Could not open the camera.'), 6000);
    } finally { opening = false; }
  }
  function close() {
    clearTimeout(pressT); pressDown = false;
    if (recorder) { recorder.onstop = null; try { recorder.stop(); } catch {} recorder = null; }
    stopMic(); clearInterval(recTick); clearInterval(flashTimer); flashTimer = 0; recBadge.classList.add('hidden'); shutter.classList.remove('recording');
    if (stream) { torch(false); stream.getTracks().forEach((t) => t.stop()); }
    stream = null; vid.srcObject = null; cam.classList.add('hidden'); isOpen = false; starting = false; pendingStop = false;
  }
  function pauseLive() { try { vid.pause(); } catch {} clearInterval(flashTimer); flashTimer = 0; torch(false); }
  function resumeLive() { if (!isOpen) return; if (!stream || !vTrack() || vTrack().readyState === 'ended') { restart(); return; } vid.play().catch(() => {}); if (flashMode !== 'off') applyFlash(); }
  async function restart() { try { const s = await getStream(); useStream(s); if (flashMode !== 'off') applyFlash(); } catch (e) { toast(window.lrMediaError ? window.lrMediaError(e, 'camera') : 'Camera error', 5000); close(); } }
  cq('lrcamClose').onclick = close;
  // تبديل الكاميرا (أمامية/خلفية): بنقفل الكاميرا الحالية الأول (أغلب الموبايلات مبتفتحش كاميرتين مع بعض)
  // وبعدين نفتح الاتجاه التاني بـ facingMode حقيقي (مش بالترتيب، عشان الموبايلات اللي فيها كذا كاميرا خلفية)،
  // ولو فشلت بنرجّع الكاميرا اللي كانت شغالة.
  let flipping = false;
  cq('lrcamFlip').onclick = async () => {
    if (!stream || recorder || flipping) return;
    flipping = true;
    const t0 = vTrack(), cur = t0?.getSettings?.().facingMode || facing, want = cur === 'user' ? 'environment' : 'user', prev = facing;
    try { torch(false); } catch {}
    clearInterval(flashTimer); flashTimer = 0;
    stream.getTracks().forEach((t) => t.stop());
    let s = null;
    for (const ex of [want, '']) {
      try { facing = want; facingExact = ex; s = await getStream(); if (s) break; } catch {}
    }
    facingExact = '';
    if (!s) { // دوّر بالاسم (front/back) في قايمة الكاميرات
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        const re = want === 'user' ? /front|user|selfie|أمام/i : /back|rear|environment|خلف/i;
        const d = devs.find((x) => re.test(x.label || ''));
        if (d) s = await getStream(d.deviceId);
      } catch {}
    }
    if (!s) { // فشل: رجّع الكاميرا الأولى
      facing = prev;
      try { s = await getStream(); } catch {}
      note.textContent = arabic() ? 'لا توجد كاميرا أخرى متاحة' : 'No other camera is available'; setTimeout(() => { note.textContent = ''; }, 2200);
    }
    if (s) { useStream(s); if (flashMode !== 'off') applyFlash(); }
    else { toast(arabic() ? 'معرفتش أرجّع الكاميرا.' : 'Could not restart the camera.', 4000); close(); }
    flipping = false;
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && isOpen && cam.classList.contains('hidden') === false && (!vTrack() || vTrack().readyState === 'ended') && !recorder) restart(); });

  // ---- تبويب صورة / فيديو ----
  function setMode(m) { mode = m; cam.querySelectorAll('.lrcamModes button').forEach((b) => b.classList.toggle('on', b.dataset.m === m)); shutter.classList.toggle('video', m === 'video'); }
  cam.querySelectorAll('.lrcamModes button').forEach((b) => { b.onclick = () => { if (!recorder) setMode(b.dataset.m); }; });

  // ---- شريط آخر الصور ----
  function renderStrip() {
    strip.textContent = ''; strip.classList.toggle('hidden', !recents.length);
    recents.forEach((it, idx) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lrcamThumb'; b.setAttribute('aria-label', it.type === 'video' ? 'فيديو' : 'صورة');
      if (it.thumb) b.style.backgroundImage = 'url("' + it.thumb + '")';
      if (it.type === 'video') { const s = document.createElement('span'); s.textContent = '▶ ' + (it.dur ? fmtT(it.dur) : ''); b.append(s); }
      b.onclick = () => openRecent(idx);
      strip.append(b);
    });
  }
  async function openRecent(idx) {
    const it = recents[idx]; if (!it || recorder) return;
    pauseLive();
    if (it.type === 'image') {
      try { const c = await window.lrImgToCanvas(new File([it.blob], 'recent.jpg', { type: it.blob.type || 'image/jpeg' })); window.lrOpenPhotoPreview(c, { onCancel: resumeLive, onSend: close }); }
      catch (e) { toast('❌ ' + (e?.message || 'معرفتش أقرأ الصورة دي.')); resumeLive(); }
    } else openEditor(it, { onCancel: resumeLive, onSend: close });
  }

  // ---- صورة ----
  let snapping = false;
  async function snap() {
    if (!stream || !vid.videoWidth || snapping) return;
    snapping = true;
    try {
      let c = null, blob = null;
      // 1) صورة كاملة الدقة من حسّاس الكاميرا (فوكس وتقليل تشويش أحسن بكتير من لقطة الفيديو)
      try {
        const t = vTrack();
        if (window.ImageCapture && t && t.readyState === 'live' && window.lrImgToCanvas) {
          const ic = new ImageCapture(t);
          const b = await Promise.race([ic.takePhoto(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))]);
          if (b && b.size) { c = await window.lrImgToCanvas(new File([b], 'cam.jpg', { type: b.type || 'image/jpeg' })); blob = b; }
        }
      } catch { c = null; }
      // 2) احتياطي: لقطة من الفيديو الحي
      if (!c) {
        c = document.createElement('canvas'); c.width = vid.videoWidth; c.height = vid.videoHeight;
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(vid, 0, 0);
        blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      }
      if (blob) addRecent({ type: 'image', blob });
      pauseLive();
      window.lrOpenPhotoPreview(c, { onCancel: resumeLive, onSend: close });
    } finally { snapping = false; }
  }

  // ---- فيديو (مع صوت لو المايك متاح) ----
  let recorder = null, chunks = [], recT0 = 0, recTick = 0, starting = false, pendingStop = false, micStream = null;
  const stopMic = () => { micStream && micStream.getTracks().forEach((t) => t.stop()); micStream = null; };
  async function recStart() {
    if (recorder || starting || !stream) return;
    starting = true; pendingStop = false;
    let audioTrack = null;
    try { micStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); audioTrack = micStream.getAudioTracks()[0] || null; } catch {}
    if (!stream || !isOpen) { stopMic(); starting = false; return; }
    try {
      const ms = new MediaStream([...stream.getVideoTracks(), ...(audioTrack ? [audioTrack] : [])]), mime = pickMime();
      const rc = new MediaRecorder(ms, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 750000, audioBitsPerSecond: 32000 });
      chunks = []; let size = 0;
      rc.ondataavailable = (e) => { if (e.data && e.data.size) { chunks.push(e.data); size += e.data.size; if (size > MAX_VID * 0.9 && rc.state === 'recording') rc.stop(); } };
      rc.onstop = () => finishRec(rc, mime, !!audioTrack);
      rc.start(300); recorder = rc; recT0 = Date.now();
      shutter.classList.add('recording'); recBadge.classList.remove('hidden'); recT.textContent = fmtT(0);
      recTick = setInterval(() => { recT.textContent = fmtT((Date.now() - recT0) / 1000); }, 250);
      note.textContent = arabic() ? 'جارٍ تسجيل الفيديو…' : 'Recording video…';
    } catch { stopMic(); note.textContent = arabic() ? 'تسجيل الفيديو غير مدعوم على هذا الجهاز.' : 'Video recording is not supported on this device.'; }
    starting = false;
    if (pendingStop) { pendingStop = false; recStop(); }
  }
  function recStop() {
    if (starting) { pendingStop = true; return; }
    if (recorder && recorder.state === 'recording') { try { recorder.stop(); } catch {} }
  }
  async function finishRec(rc, mime, hasAudio) {
    clearInterval(recTick); recBadge.classList.add('hidden'); shutter.classList.remove('recording'); note.textContent = '';
    const dur = (Date.now() - recT0) / 1000; recorder = null; stopMic();
    const blob = new Blob(chunks, { type: rc.mimeType || mime || 'video/webm' }); chunks = [];
    if (dur < 0.6 || !blob.size) return;                                 // لمسة قصيرة جداً: تجاهل
    if (blob.size > MAX_VID) { toast(arabic() ? 'الفيديو طويل أو حجمه أكبر من 2.5 ميجابايت.' : 'Video is too long or larger than 2.5 MB.'); return; }
    const it = { type: 'video', blob, mime: blob.type, dur, audio: hasAudio };
    addRecent(it); pauseLive();
    openEditor(it, { onCancel: resumeLive, onSend: close });
  }

  // ---- الزرار الكبير: ضغطة = صورة، ضغطة مطولة = فيديو ----
  let pressT = 0, pressDown = false, held = false;
  shutter.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { shutter.setPointerCapture(e.pointerId); } catch {}
    if (!isOpen || opening) return;
    pressDown = true; held = false;
    if (!recorder && !starting) pressT = setTimeout(() => { held = true; recStart(); }, MIN_HOLD);
  });
  const shutterUp = (e) => {
    e.preventDefault(); clearTimeout(pressT);
    if (!pressDown) return; pressDown = false;
    if (held || recorder || starting) { recStop(); return; }               // رفع الإصبع بعد ضغطة مطولة، أو لمسة تانية لإنهاء تسجيل شغال
    if (mode === 'video') recStart(); else snap();
  };
  shutter.addEventListener('pointerup', shutterUp);
  shutter.addEventListener('pointercancel', shutterUp);
  shutter.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- المعرض ----
  cq('lrcamGal').onclick = () => { window.lrPickAt = Date.now(); try { pick.value = ''; } catch {} pick.click(); };
  pick.addEventListener('cancel', () => { window.lrPickAt = 0; });
  pick.addEventListener('change', async () => {
    window.lrPickAt = 0;
    const f = pick.files && pick.files[0]; if (!f) return;
    const ft = window.lrfType ? window.lrfType(f.name, f.type) : f.type;
    try { pick.value = ''; } catch {}
    if (ft.startsWith('video/') && f.size <= MAX_VID) {
      const it = { type: 'video', blob: f, mime: f.type || ft, dur: 0, audio: true }; pauseLive(); addRecent(it); openEditor(it, { onCancel: resumeLive, onSend: close }); return;
    }
    if (!ft.startsWith('image/') || /^image\/(gif|svg\+xml)$/.test(ft)) { if (chatOpen()) { close(); window.lrSendAny && window.lrSendAny(f); } return; }
    try {
      pauseLive(); const c = await window.lrImgToCanvas(f); addRecent({ type: 'image', blob: f });
      window.lrOpenPhotoPreview(c, { onCancel: resumeLive, onSend: close });
    } catch (e) { toast('❌ ' + (e?.message || 'معرفتش أقرأ الصورة دي.')); resumeLive(); }
  });

  // ================= محرر الفيديو (زي واتساب): شريط القص فوق + كتم الصوت + شرح + إرسال =================
  const ve = document.createElement('div');
  ve.className = 'lrve hidden'; ve.dir = 'rtl'; ve.setAttribute('role', 'dialog'); ve.setAttribute('aria-label', 'إضافة فيديو');
  ve.innerHTML =
    '<div class="lrveTop"><button type="button" class="lrcamBtn" id="lrveClose" aria-label="إغلاق">' + I.x + '</button></div>' +
    '<div class="lrveStrip" dir="ltr" id="lrveStrip"><div class="lrveFrames" id="lrveFrames"></div><div class="lrveDim" id="lrveDimL"></div><div class="lrveDim" id="lrveDimR"></div>' +
    '<div class="lrveSel" id="lrveSel"><i class="h" data-h="l"></i><i class="h" data-h="r"></i></div><div class="lrvePh" id="lrvePh"></div></div>' +
    '<div class="lrveInfo"><span class="lrvePill" id="lrveTxt"></span><button type="button" class="lrveMute" id="lrveMute" aria-label="كتم الصوت">' + I.vol + '</button></div>' +
    '<div class="lrveStage" id="lrveStage"><video id="lrveVid" playsinline></video><button type="button" class="lrvePlay" id="lrvePlay" aria-label="تشغيل">' + I.play + '</button></div>' +
    '<div class="lrveBottom"><div class="lrpOnceHint" id="lrveOnceHint"></div><div class="lrpCapRow"><div class="lrpCapWrap"><input id="lrveCap" type="text" maxlength="1000" autocomplete="off" placeholder="إضافة شرح توضيحي...">' +
    '<button type="button" id="lrveOnce" class="lrpOnce" role="switch" aria-checked="false" aria-label="عرض مرة واحدة"><span class="onceBadge">1</span></button></div>' +
    '<button type="button" id="lrveSend" class="lrpSend" aria-label="إرسال">' + I.send + '</button></div></div>';
  document.body.append(ve);
  const vq = (id) => ve.querySelector('#' + id);
  const vv = vq('lrveVid'), vStrip = vq('lrveStrip'), vFrames = vq('lrveFrames'), vSel = vq('lrveSel'), vDimL = vq('lrveDimL'), vDimR = vq('lrveDimR'), vPh = vq('lrvePh');
  const vTxt = vq('lrveTxt'), vMute = vq('lrveMute'), vPlay = vq('lrvePlay'), vCap = vq('lrveCap'), vOnce = vq('lrveOnce'), vOnceHint = vq('lrveOnceHint'), vSend = vq('lrveSend');
  let E = null, t0 = 0, t1 = 0, dur = 0, muted = false, wantOnce = false, busy = false, raf = 0, url = '', MINLEN = 0.8;

  function setVOnce(v) { wantOnce = !!v; vOnce.classList.toggle('on', wantOnce); vOnce.setAttribute('aria-checked', wantOnce ? 'true' : 'false'); vOnceHint.textContent = wantOnce ? 'هتتعرض للطرف التاني مرة واحدة بس، وبعدها تتمسح من السيرفر' : ''; }
  vOnce.onclick = () => setVOnce(!wantOnce);
  function setMuted(m) { muted = !!m; vv.muted = muted; vMute.innerHTML = muted ? I.volOff : I.vol; vMute.classList.toggle('on', muted); vMute.setAttribute('aria-pressed', muted ? 'true' : 'false'); }
  vMute.onclick = () => setMuted(!muted);

  function sizeKB() { return Math.max(1, Math.round((E.blob.size * ((t1 - t0) / (dur || 1))) / 1024)); }
  function refresh() {
    const a = dur ? t0 / dur * 100 : 0, b = dur ? t1 / dur * 100 : 100;
    vSel.style.left = a + '%'; vSel.style.width = (b - a) + '%'; vDimL.style.width = a + '%'; vDimR.style.width = (100 - b) + '%';
    vTxt.textContent = fmtT(t1 - t0) + ' • ' + nf(sizeKB()) + (arabic() ? ' كيلوبايت' : ' KB');
  }
  function playing() { return !vv.paused && !vv.ended; }
  function tickPlay() {
    cancelAnimationFrame(raf);
    const f = () => {
      if (ve.classList.contains('hidden')) return;
      if (dur) vPh.style.left = (vv.currentTime / dur * 100) + '%';
      if (playing() && vv.currentTime >= t1 - 0.03) { vv.pause(); try { vv.currentTime = t0; } catch {} vPlay.classList.remove('hidden'); }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
  }
  function togglePlay() {
    if (!E || busy) return;
    if (playing()) { vv.pause(); vPlay.classList.remove('hidden'); return; }
    if (vv.currentTime < t0 || vv.currentTime >= t1 - 0.05) { try { vv.currentTime = t0; } catch {} }
    vv.play().then(() => vPlay.classList.add('hidden')).catch(() => {});
  }
  vq('lrveStage').onclick = togglePlay; vPlay.onclick = (e) => { e.stopPropagation(); togglePlay(); };
  vv.addEventListener('pause', () => vPlay.classList.remove('hidden'));

  // سحب مقبضي القص
  let hdrag = null;
  vSel.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.h'); if (!h || busy || !dur) return;
    hdrag = h.dataset.h; try { vSel.setPointerCapture(e.pointerId); } catch {} vv.pause(); e.preventDefault();
  });
  vSel.addEventListener('pointermove', (e) => {
    if (!hdrag) return;
    const r = vStrip.getBoundingClientRect(), t = Math.min(dur, Math.max(0, (e.clientX - r.left) / r.width * dur));
    if (hdrag === 'l') { t0 = Math.min(t, t1 - MINLEN); t0 = Math.max(0, t0); try { vv.currentTime = t0; } catch {} }
    else { t1 = Math.max(t, t0 + MINLEN); t1 = Math.min(dur, t1); try { vv.currentTime = Math.max(t0, t1 - 0.05); } catch {} }
    refresh(); e.preventDefault();
  });
  const hup = () => { if (hdrag) { hdrag = null; try { vv.currentTime = t0; } catch {} } };
  vSel.addEventListener('pointerup', hup); vSel.addEventListener('pointercancel', hup);

  // لقطات الشريط
  async function buildFrames(token) {
    vFrames.textContent = '';
    const W = vStrip.clientWidth || 300, n = Math.max(6, Math.min(14, Math.round(W / 40))), cells = [];
    for (let i = 0; i < n; i++) { const c = document.createElement('canvas'); c.width = 48; c.height = 64; c.className = 'lrveFr'; vFrames.append(c); cells.push(c); }
    const fv = document.createElement('video'); fv.muted = true; fv.playsInline = true; fv.preload = 'auto'; fv.src = url;
    try {
      await meta(fv);
      for (let i = 0; i < n; i++) {
        if (token !== E?.token) return;
        await seek(fv, Math.min(dur - 0.05, (i + 0.5) * dur / n));
        const c = cells[i], x = c.getContext('2d'), vw = fv.videoWidth || 3, vh = fv.videoHeight || 4, s = Math.max(c.width / vw, c.height / vh);
        x.drawImage(fv, (c.width - vw * s) / 2, (c.height - vh * s) / 2, vw * s, vh * s);
      }
    } catch {} finally { fv.removeAttribute('src'); fv.load(); }
  }

  async function openEditor(it, o) {
    if (!chatOpen()) return;
    busy = false; vSend.disabled = false; vCap.value = ''; setVOnce(false); setMuted(false);
    E = { ...it, opts: o || {}, token: Math.random() };
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(it.blob); vv.src = url; vv.currentTime = 0;
    vMute.classList.toggle('hidden', !it.audio); vPlay.classList.remove('hidden');
    ve.classList.remove('hidden'); vTxt.textContent = '…'; vFrames.textContent = '';
    const token = E.token;
    dur = await realDuration(vv, it.dur); if (token !== E?.token) return;
    E.dur = dur; t0 = 0; t1 = dur; MINLEN = Math.min(0.8, dur / 2);
    vSel.classList.toggle('locked', !canCapture); vStrip.classList.toggle('locked', !canCapture);
    refresh(); tickPlay(); buildFrames(token);
    if (!canCapture) toast(arabic() ? 'القص وكتم الصوت مش مدعومين في المتصفح ده — هيتبعت الفيديو كامل.' : 'Trim and mute are not supported in this browser — the full video will be sent.', 5000);
  }
  function closeEditor(cancelled) {
    const o = E?.opts || {}; E = null; busy = false; cancelAnimationFrame(raf);
    try { vv.pause(); } catch {} vv.removeAttribute('src'); vv.load(); if (url) { URL.revokeObjectURL(url); url = ''; }
    ve.classList.add('hidden'); vFrames.textContent = ''; try { vCap.blur(); } catch {}
    if (cancelled) { try { o.onCancel && o.onCancel(); } catch {} }
  }
  vq('lrveClose').onclick = () => { if (!busy) closeEditor(true); };

  // تصدير المقطع المقصوص/المكتوم: بنعيد تسجيله من عنصر video (في الوقت الحقيقي بطول المقطع)
  async function exportClip(blob, from, to, mute, hasAudio, onProg) {
    const u = URL.createObjectURL(blob), v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto'; v.src = u; v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none';
    document.body.append(v);
    let ac = null, tracksOut = [];
    try {
      await meta(v);
      const cs = v.captureStream ? v.captureStream() : v.mozCaptureStream();
      const out = new MediaStream(cs.getVideoTracks());
      if (!mute && hasAudio) {
        try {
          ac = new (window.AudioContext || window.webkitAudioContext)(); await ac.resume();
          const src = ac.createMediaElementSource(v), dest = ac.createMediaStreamDestination(); src.connect(dest);   // مش متوصل بالسماعة: الصوت بيتسجل من غير ما يتسمع
          dest.stream.getAudioTracks().forEach((t) => out.addTrack(t));
        } catch {}
      }
      if (!ac) v.muted = true;                                  // مفيش تسجيل صوت: متسمعش الصوت وقت التصدير
      await seek(v, from);
      const mime = pickMime(), rc = new MediaRecorder(out, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 800000, audioBitsPerSecond: 32000 }), parts = [];
      rc.ondataavailable = (e) => { e.data && e.data.size && parts.push(e.data); };
      const done = new Promise((ok) => { rc.onstop = ok; });
      rc.start(250);
      await v.play();
      if (!out.getVideoTracks().length) cs.getVideoTracks().forEach((t) => out.addTrack(t));
      const total = Math.max(0.1, to - from), started = Date.now();
      await new Promise((ok) => {
        const iv = setInterval(() => {
          const p = Math.min(1, Math.max(0, (v.currentTime - from) / total)); onProg && onProg(p);
          if (v.currentTime >= to - 0.02 || v.ended || Date.now() - started > (total + 6) * 1000) { clearInterval(iv); ok(); }
        }, 60);
      });
      v.pause(); if (rc.state !== 'inactive') rc.stop(); await done;
      tracksOut = out.getTracks();
      const res = new Blob(parts, { type: rc.mimeType || mime || 'video/webm' });
      if (!res.size) throw Error('تعذر تجهيز الفيديو');
      return res;
    } finally { tracksOut.forEach((t) => t.stop()); try { ac && ac.close(); } catch {} v.remove(); URL.revokeObjectURL(u); }
  }

  vSend.onclick = async () => {
    if (!E || busy) return;
    busy = true; vSend.disabled = true; vv.pause();
    const it = E, trimmed = t0 > 0.05 || t1 < dur - 0.05, needRe = trimmed || (muted && it.audio);
    try {
      let blob = it.blob, type = it.mime || it.blob.type || 'video/webm';
      if (needRe && canCapture) {
        const prog = (p) => toast((arabic() ? '⏳ جاري تجهيز الفيديو… ' : '⏳ Preparing video… ') + nf(Math.round(p * 100)) + (arabic() ? '٪' : '%'), 0);
        prog(0);
        blob = await exportClip(it.blob, t0, t1, muted, it.audio, prog);
        type = blob.type || 'video/webm';
      }
      if (blob.size > MAX_VID) throw Error(arabic() ? 'الفيديو طويل أو حجمه أكبر من 2.5 ميجابايت.' : 'Video is too long or larger than 2.5 MB.');
      toast(arabic() ? '⏳ جاري إرسال الفيديو…' : '⏳ Sending video…', 0);
      await window.lrSendVideo(blob, type, vCap.value, wantOnce);
      toastOff();
      if (E !== it) return;
      const o = it.opts; closeEditor(false); try { o.onSend && o.onSend(); } catch {}
    } catch (e) {
      toast('❌ ' + (e?.message || (arabic() ? 'فشل الإرسال' : 'Send failed')), 6000);
    } finally { busy = false; vSend.disabled = false; }
  };
  vCap.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); vSend.click(); } });

  // ================= زرار الكاميرا في الشات: ضغطة = تفتح الكاميرا، ضغطة مطولة = تفتح وتسجل فيديو =================
  const btn = btn0.cloneNode(true); btn0.replaceWith(btn);       // بيشيل المعالجات القديمة (الكاميرا القديمة اتشالت من الاستخدام)
  let bHold = false, bDown = false, bT = 0;
  const hideAttach = () => { $('attachMenu')?.classList.add('hidden'); $('attachMenuBtn')?.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch {}
    bDown = true; bHold = false;
    bT = setTimeout(async () => { if (!bDown) return; bHold = true; await open(); if (bDown && isOpen && stream) { held = true; recStart(); } }, 450);
  });
  const bUp = (e) => {
    e.preventDefault(); if (!bDown) return; bDown = false; clearTimeout(bT); hideAttach();
    if (!bHold) { open(); return; }
    if (recorder || starting) recStop();
  };
  btn.addEventListener('pointerup', bUp); btn.addEventListener('pointercancel', bUp);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => { if (e.detail === 0) open(); });
  window.lrOpenCamera = open;

  // ---------- أمان ----------
  addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!ve.classList.contains('hidden')) { if (!busy) closeEditor(true); } else if (isOpen && document.querySelector('.lrp.hidden')) close(); });
  setInterval(() => {                                   // لو الشات اتقفل: كل حاجة تتقفل وآخر الصور تتمسح
    if (chatOpen()) return;
    if (!ve.classList.contains('hidden')) closeEditor(false);
    if (isOpen) close();
    if (recents.length) clearRecents();
  }, 500);
})();
