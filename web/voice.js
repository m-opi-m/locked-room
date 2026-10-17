// 1.15.0 — الرسائل الصوتية على طريقة واتساب. بيتضم جوه app.js وقت الـ build (نفس الـ scope).
//  • ضغط مطوّل على الميك = تسجيل، شيل إيدك = إرسال. اسحب لفوق = قفل (التسجيل يكمّل من غير ما تمسك)، اسحب ناحية الشريط = إلغاء.
//  • ضغطة واحدة على الميك = يدخل على وضع القفل (موجة صوت لايف + عداد + إيقاف مؤقت + إرسال + حذف).
//  • الرسالة بتتبعت ومعاها شكل الموجة (w) والمدة (s) جوه الـ payload المشفّر (السيرفر مبيشوفهمش).
//  • الفقاعة: زر تشغيل + موجة + مدة + صورة المرسل؛ وهو شغال الصورة بتتبدل بزر السرعة. علامة التشغيل رمادي، وتبقى زرقا لما الطرف التاني يسمعها
//    (رسالة {k:"played",m:mid} مشفّرة ومتخزّنة، فبتوصل حتى لو المرسل أوفلاين).
// بيستخدم من app.js: t, p, u, w, Pe, Ee, Y, V, ze, ce, pn, tt, Ge, Fe, d, Je, lrDbPatch, lrPutOwn, mediaError, uiIcon, Xe
var lrPlayed = new Set();
var lrVoiceRate = 1;
var lrVoiceNow = null;     // الفقاعة اللي شغالة دلوقتي
var vr = null;             // جلسة التسجيل الحالية
var LR_TAP_MS = 320, LR_LOCK_PX = 70, LR_CANCEL_PX = 95, LR_MIN_MS = 600, LR_VW = 48, LR_MAX_BYTES = 2.35 * 1024 * 1024;

function lrFmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const s = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  return p === 'ar' ? s.replace(/\d/g, (x) => '٠١٢٣٤٥٦٧٨٩'[x]) : s;
}
function lrComposerSync() {
  const c = document.querySelector('.composer'), m = t('msg');
  c && m && c.classList.toggle('hasText', !!m.value.trim());
}

/* ============================ التسجيل ============================ */
function lrVoiceUI(mode) { // 'off' | 'hold' | 'locked'
  const c = document.querySelector('.composer'); if (!c) return;
  c.classList.toggle('vrec', mode !== 'off');
  c.classList.toggle('vlock', mode === 'locked');
  t('voiceBar').classList.toggle('hidden', mode === 'off');
  t('recordBtn').classList.toggle('recording', mode === 'hold');
  if (mode === 'off') {
    t('vbHint').style.transform = ''; t('vbHint').style.opacity = '';
    t('voiceLock').style.transform = ''; t('voiceLock').classList.remove('on', 'locked');
    t('vbPauseLbl').textContent = X('إيقاف مؤقت'); t('vbPause').classList.remove('paused');
    t('vbPause').querySelector('use').setAttribute('href', '#i-pause');
    t('voiceBar').classList.remove('paused');
  }
}
function lrVoiceElapsed(me) { return me.acc + (me.paused || !me.segStart ? 0 : Date.now() - me.segStart); }
function lrVoiceTick() {
  const me = vr; if (!me || !me.rec) return;
  // مستوى الصوت
  if (me.an && !me.paused) {
    me.an.getByteTimeDomainData(me.buf);
    let sum = 0; for (let i = 0; i < me.buf.length; i++) { const v = (me.buf[i] - 128) / 128; sum += v * v; }
    me.samples.push(Math.pow(Math.min(1, Math.sqrt(sum / me.buf.length) * 4.5), 0.7));
  } else if (!me.an && !me.paused) me.samples.push(0.15 + 0.5 * Math.abs(Math.sin(me.samples.length / 3)));
  const txt = lrFmt(lrVoiceElapsed(me) / 1000);
  t('vbTimer').textContent = t('vbTimer2').textContent = txt;
  if (me.mode === 'locked') lrVoiceDraw(me);
}
function lrVoiceDraw(me) {
  const cv = t('vbCanvas'); if (!cv) return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const bw = 3, gap = 2.5, n = Math.max(1, Math.floor(W / (bw + gap))), s = me.samples, from = Math.max(0, s.length - n);
  for (let i = 0; i < n; i++) {
    const x = i * (bw + gap), v = s[from + i];
    if (v === undefined) { g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x, H / 2 - 1, bw, 2); continue; }
    const h = Math.max(3, v * (H - 4));
    g.fillStyle = '#eaf6ff'; g.beginPath(); g.roundRect ? g.roundRect(x, (H - h) / 2, bw, h, 1.5) : g.rect(x, (H - h) / 2, bw, h); g.fill();
  }
}
function lrPeaks(s, n) {
  if (!s.length) return Array(n).fill(2);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * s.length / n), b = Math.max(a + 1, Math.floor((i + 1) * s.length / n));
    let m = 0; for (let j = a; j < b && j < s.length; j++) m = Math.max(m, s[j]);
    out.push(m);
  }
  const mx = Math.max(...out, 0.05);
  return out.map((v) => Math.max(2, Math.round(v / mx * 31)));
}
const lrStopRec = (me) => new Promise((res) => {
  const r = me.rec, mk = () => new Blob(me.chunks, { type: (r && r.mimeType) || me.mime || 'audio/webm' });
  if (!r || r.state === 'inactive') return res(mk());
  r.onstop = () => res(mk());
  try { r.stop(); } catch { res(mk()); }
});
function lrVoiceCleanup(me) {
  clearInterval(me.iv);
  try { me.stream && me.stream.getTracks().forEach((x) => x.stop()); } catch {}
  try { me.ctx && me.ctx.close(); } catch {}
  me.stream = me.ctx = me.an = null;
  if (vr === me) vr = null;
  lrVoiceUI('off');
}
async function lrVoiceStart(e) {
  if (vr || e.button > 0) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { w('التسجيل الصوتي غير مدعوم على هذا الجهاز.'); return; }
  const me = vr = { mode: 'starting', downAt: Date.now(), sx: e.clientX, sy: e.clientY, pid: e.pointerId, chunks: [], samples: [], acc: 0, segStart: 0, paused: false, size: 0, done: false, released: false };
  try { t('recordBtn').setPointerCapture(e.pointerId); } catch {}
  lrVoiceUI('hold');
  t('vbTimer').textContent = t('vbTimer2').textContent = lrFmt(0);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (err) { if (vr === me) { vr = null; lrVoiceUI('off'); } w(mediaError(err, 'microphone')); return; }
  if (vr !== me) { stream.getTracks().forEach((x) => x.stop()); return; }
  me.stream = stream;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; me.ctx = new AC();
    me.an = me.ctx.createAnalyser(); me.an.fftSize = 1024; me.buf = new Uint8Array(me.an.fftSize);
    me.ctx.createMediaStreamSource(stream).connect(me.an);
    me.ctx.state === 'suspended' && me.ctx.resume();
  } catch { me.an = null; }
  try {
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find((x) => MediaRecorder.isTypeSupported(x)) || '';
    me.mime = mime;
    me.rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 });
    me.rec.ondataavailable = (ev) => {
      if (!ev.data?.size) return;
      me.chunks.push(ev.data); me.size += ev.data.size;
      if (me.size > LR_MAX_BYTES && !me.done) { w('وصلت للحد الأقصى لطول الرسالة الصوتية، اتبعتت.'); lrVoiceFinish(); }
    };
    me.rec.start(500);
  } catch (err) { lrVoiceCleanup(me); w(mediaError(err, 'microphone')); return; }
  me.segStart = Date.now(); me.mode = 'hold';
  me.iv = setInterval(lrVoiceTick, 60);
  ce('recording');
  if (me.released) lrVoiceUp(null, me.upCancel); // الإصبع اتشال وإحنا لسه بنفتح الميك
}
function lrVoiceLock() {
  const me = vr; if (!me || me.mode === 'locked') return;
  me.mode = 'locked';
  try { t('recordBtn').releasePointerCapture(me.pid); } catch {}
  lrVoiceUI('locked'); lrVoiceDraw(me);
  try { navigator.vibrate && navigator.vibrate(15); } catch {}
}
function lrVoiceMove(e) {
  const me = vr; if (!me || e.pointerId !== me.pid || (me.mode !== 'hold' && me.mode !== 'starting')) return;
  const rtl = document.documentElement.dir === 'rtl';
  const slide = Math.max(0, (e.clientX - me.sx) * (rtl ? 1 : -1)); // ناحية الشريط
  const up = Math.max(0, me.sy - e.clientY);
  const hint = t('vbHint'), lock = t('voiceLock');
  hint.style.transform = 'translateX(' + (slide * (rtl ? 1 : -1)) + 'px)'; hint.style.opacity = String(Math.max(0, 1 - slide / LR_CANCEL_PX));
  lock.classList.add('on'); lock.style.transform = 'translateY(' + (-Math.min(up, LR_LOCK_PX) * 0.6) + 'px)';
  if (me.mode !== 'hold') return;
  if (up >= LR_LOCK_PX && up > slide) { lrVoiceLock(); return; }
  if (slide >= LR_CANCEL_PX && slide > up) { try { navigator.vibrate && navigator.vibrate(20); } catch {} lrVoiceDiscard(); }
}
function lrVoiceUp(e, cancelEvt) {
  const me = vr; if (!me || me.mode === 'locked') return;
  if (e && e.pointerId !== me.pid) return;
  if (me.mode === 'starting') { me.released = true; me.upAt = Date.now(); me.upCancel = !!cancelEvt; return; }
  const held = (me.upAt || Date.now()) - me.downAt;
  if (cancelEvt || held < LR_TAP_MS) { lrVoiceLock(); return; } // ضغطة قصيرة (أو النظام قطع اللمس) = وضع القفل
  lrVoiceFinish();
}
async function lrVoiceFinish() {
  const me = vr; if (!me || me.done || !me.rec) return;
  if (!u || u.readyState !== 1) { w('مفيش اتصال دلوقتي، جرب تاني بعد لحظة.'); if (me.mode !== 'locked') lrVoiceLock(); return; }
  me.done = true;
  const dur = lrVoiceElapsed(me);
  const blob = await lrStopRec(me), mime = blob.type || me.mime || 'audio/webm', samples = me.samples;
  lrVoiceCleanup(me);
  await ce('');
  if (dur < LR_MIN_MS || !blob.size) return;
  if (blob.size > 2.5 * 1024 * 1024) return w('التسجيل طويل قوي. أقصى حجم للتسجيل 2.5 ميجابايت.');
  const data = Y(await blob.arrayBuffer()), peaks = lrPeaks(samples, LR_VW), secs = Math.round(dur / 100) / 10;
  await Pe({ k: 'audio', t: mime, d: data, w: peaks, s: secs }, hn(data, mime, { w: peaks, s: secs }), 'me', 'sending');
}
async function lrVoiceDiscard() {
  const me = vr; if (!me || me.done) return;
  me.done = true;
  try { me.rec && (me.rec.onstop = null, me.rec.ondataavailable = null, me.rec.state !== 'inactive' && me.rec.stop()); } catch {}
  lrVoiceCleanup(me);
  ce('');
}
function lrVoiceAbort() { if (vr) { const me = vr; me.done = true; try { me.rec && (me.rec.onstop = null, me.rec.state !== 'inactive' && me.rec.stop()); } catch {} lrVoiceCleanup(me); } }
function cancelVoiceRecording() { lrVoiceDiscard(); }
function lrVoicePause() {
  const me = vr; if (!me || !me.rec) return;
  try {
    if (me.paused) { me.rec.resume(); me.paused = false; me.segStart = Date.now(); }
    else { me.rec.pause(); me.acc += Date.now() - me.segStart; me.segStart = 0; me.paused = true; }
  } catch { return; }
  t('vbPause').classList.toggle('paused', me.paused); t('voiceBar').classList.toggle('paused', me.paused);
  t('vbPauseLbl').textContent = X(me.paused ? 'استئناف التسجيل' : 'إيقاف مؤقت');
  t('vbPause').querySelector('use').setAttribute('href', me.paused ? '#i-mic' : '#i-pause');
}

/* ============================ الفقاعة ============================ */
function lrCleanPeaks(w0) {
  if (!Array.isArray(w0) || !w0.length || w0.length > 160) return null;
  const o = w0.map((x) => Math.max(1, Math.min(31, Math.round(+x) || 1)));
  return o;
}
function lrFakePeaks(seed) {
  let h = 2166136261 >>> 0; for (let i = 0; i < Math.min(seed.length, 400); i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const out = []; for (let i = 0; i < LR_VW; i++) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; out.push(5 + (h % 14)); }
  return out;
}
var lrDecQ = Promise.resolve();
function lrDecodeVoice(b64) { // للرسايل القديمة اللي معهاش موجة: نفك الصوت ونحسبها
  lrDecQ = lrDecQ.then(async () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
      const buf = await ctx.decodeAudioData($e(b64).buffer);
      ctx.close();
      const ch = buf.getChannelData(0), step = Math.max(1, Math.floor(ch.length / (LR_VW * 8))), vals = [];
      for (let i = 0; i < ch.length; i += step) { let s = 0, c = 0; for (let j = i; j < Math.min(ch.length, i + step); j++) { s += ch[j] * ch[j]; c++; } vals.push(Math.sqrt(s / c)); }
      return { w: lrPeaks(vals.map((v) => Math.pow(Math.min(1, v * 4.5), 0.7)), LR_VW), s: buf.duration };
    } catch { return null; }
  });
  return lrDecQ;
}
function hn(data, mime, m) {
  m = m || {};
  const root = document.createElement('div');
  root.className = 'voiceMessage';
  let peaks = lrCleanPeaks(m.w), dur = typeof m.s === 'number' && m.s > 0 && m.s < 7200 ? m.s : 0;
  const hasPeaks = !!peaks; if (!peaks) peaks = lrFakePeaks(String(data || ''));
  root.innerHTML =
    '<div class="vmSide"><span class="vmAv"></span><span class="vmMic">' + uiIcon('mic') + '</span><button type="button" class="vmSpeed" aria-label="' + X('سرعة التشغيل') + '">×1</button></div>' +
    '<button type="button" class="vmPlay" aria-label="' + X('تشغيل') + '">' + uiIcon('play') + '</button>' +
    '<div class="vmBody"><div class="vmWave" dir="ltr"><i class="vmDot"></i></div><span class="vmDur"></span></div>';
  const au = new Audio(); au.preload = 'none'; au.src = V(data, mime || 'audio/webm');
  const wave = root.querySelector('.vmWave'), dot = root.querySelector('.vmDot'), durEl = root.querySelector('.vmDur'), playBtn = root.querySelector('.vmPlay'), speed = root.querySelector('.vmSpeed');
  const bars = [];
  const buildBars = () => { bars.forEach((b) => b.remove()); bars.length = 0; peaks.forEach((v) => { const b = document.createElement('i'); b.style.height = (12 + v / 31 * 88) + '%'; wave.insertBefore(b, dot); bars.push(b); }); };
  buildBars();
  const total = () => dur || (isFinite(au.duration) ? au.duration : 0);
  const paint = () => {
    const T = total(), fr = T ? Math.min(1, au.currentTime / T) : 0, busy = !au.paused || au.currentTime > 0;
    const k = Math.round(fr * bars.length);
    bars.forEach((b, i) => b.classList.toggle('on', i < k));
    dot.style.setProperty('--p', fr);
    durEl.textContent = lrFmt(busy ? au.currentTime : T);
  };
  const setState = (s) => { root.classList.toggle('playing', s === 'playing'); playBtn.innerHTML = uiIcon(s === 'playing' ? 'pause' : 'play'); playBtn.setAttribute('aria-label', X(s === 'playing' ? 'إيقاف مؤقت' : 'تشغيل')); };
  let raf = 0;
  const loop = () => { paint(); raf = au.paused ? 0 : requestAnimationFrame(loop); };
  au.addEventListener('play', () => {
    if (lrVoiceNow && lrVoiceNow !== au) { try { lrVoiceNow.pause(); } catch {} }
    lrVoiceNow = au; au.playbackRate = lrVoiceRate; speed.textContent = '×' + lrVoiceRate;
    setState('playing'); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    const row = root.closest('.m'), mid = row && row.dataset.mid;
    if (row && row.classList.contains('them') && mid && !lrPlayed.has(mid)) { lrMarkPlayed(mid); lrSendPlayed(mid); }
  });
  au.addEventListener('pause', () => { setState('paused'); paint(); });
  au.addEventListener('ended', () => { au.currentTime = 0; setState('paused'); paint(); if (lrVoiceNow === au) lrVoiceNow = null; });
  au.addEventListener('loadedmetadata', paint);
  playBtn.onclick = (ev) => { ev.stopPropagation(); au.paused ? au.play().catch(() => w('تعذر تشغيل الصوت.')) : au.pause(); };
  speed.onclick = (ev) => { ev.stopPropagation(); lrVoiceRate = lrVoiceRate === 1 ? 1.5 : lrVoiceRate === 1.5 ? 2 : 1; au.playbackRate = lrVoiceRate; speed.textContent = '×' + lrVoiceRate; };
  // سحب/ضغط على الموجة = تقديم/تأخير (مع منع سحب الرد بتاع الرسالة)
  let scrub = false;
  const seekTo = (ev) => { const r = wave.getBoundingClientRect(), T = total(); if (!T || !r.width) return; try { au.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * T; } catch {} paint(); };
  wave.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); scrub = true; try { wave.setPointerCapture(ev.pointerId); } catch {} seekTo(ev); });
  wave.addEventListener('pointermove', (ev) => { if (scrub) { ev.stopPropagation(); seekTo(ev); } });
  const endScrub = (ev) => { scrub = false; ev.stopPropagation(); };
  wave.addEventListener('pointerup', endScrub); wave.addEventListener('pointercancel', endScrub);
  paint();
  // رسالة قديمة من غير موجة/مدة: نحسبها في الخلفية
  if (!hasPeaks || !dur) lrDecodeVoice(String(data || '')).then((r) => {
    if (!r) return;
    if (!dur && r.s > 0) dur = r.s;
    if (!hasPeaks && r.w) { peaks = r.w; buildBars(); }
    paint();
  });
  return root;
}
// بعد ما الفقاعة تتحط في الشات: نعرف هي بتاعتي ولا لا، فنحط الصورة الصح وحالة "اتسمعت"
function lrVoiceMount(row, side, mid) {
  const v = row.querySelector('.voiceMessage'); if (!v) return;
  const me = side === 'me', av = v.querySelector('.vmAv');
  pn(av, me ? tt : Ge, me ? d.get('n') : Fe);
  v.classList.toggle('played', !!(mid && lrPlayed.has(mid)));
}
function lrMarkPlayed(mid) {
  if (typeof mid !== 'string' || !/^[a-f0-9]{32}$/.test(mid)) return;
  lrPlayed.add(mid); lrDbPatch(mid, { played: true });
  const el = Je.get(mid), v = el && el.querySelector('.voiceMessage'); v && v.classList.add('played');
}
async function lrSendPlayed(mid) {
  if (!u || u.readyState !== 1) return false;
  try {
    const enc = await Ee({ k: 'played', m: mid }), nm = ze(crypto.getRandomValues(new Uint8Array(16)));
    u.send(JSON.stringify({ ...enc, p: 1, mid: nm }));
    lrPutOwn(nm, enc, false, 'played');
    return true;
  } catch { return false; }
}

/* ============================ ربط الأزرار ============================ */
(() => {
  const btn = t('recordBtn'); if (!btn) return;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); lrVoiceStart(e); });
  btn.addEventListener('pointermove', lrVoiceMove);
  btn.addEventListener('pointerup', (e) => lrVoiceUp(e, false));
  btn.addEventListener('pointercancel', (e) => lrVoiceUp(e, true));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !vr) { e.preventDefault(); vr = null; lrVoiceStart({ pointerId: -1, clientX: 0, clientY: 0, button: 0 }).then(() => vr && lrVoiceLock()); } });
  t('vbPause').onclick = lrVoicePause;
  t('vbSend').onclick = lrVoiceFinish;
  // الكاميرا في الشريط (ضغطة = صورة، ضغط مطوّل = فيديو) — اتنقل من قايمة المرفقات
})();
