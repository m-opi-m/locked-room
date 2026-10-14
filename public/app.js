'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const enc = new TextEncoder(), dec = new TextDecoder();
  let ws = null, key = null, peers = 0, newCode = '', curCode = '', pendingCode = '', badShown = false;
  let callState = 'idle', callId = '', pc = null, stream = null, pendingOffer = null, callTimer = null;
  let peerName = '', peerUrl = '', tmpAv = null, tmpBg = null;

  // ---------- أدوات ----------
  const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (x) => ALPHA[x & 31]).join('');
  const fmt = (c) => c.match(/.{1,4}/g).join('-');
  const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const valid = (c) => c.length === 24 && [...c].every((ch) => ALPHA.includes(ch));
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  function b64(buf) {
    const u = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const blobUrl = (b) => URL.createObjectURL(new Blob([unb64(b)], { type: 'image/jpeg' }));
  const store = {
    get: (k) => { try { return localStorage.getItem('lr.' + k) || ''; } catch { return ''; } },
    set: (k, v) => { try { v ? localStorage.setItem('lr.' + k, v) : localStorage.removeItem('lr.' + k); } catch {} },
  };
  // تصغير الصورة وإعادة رسمها (بيشيل بيانات الموقع EXIF). square = قص مربع للصورة الشخصية
  async function shrink(file, max, q, square) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'), x = c.getContext('2d');
    if (square) {
      const m = Math.min(bmp.width, bmp.height);
      c.width = c.height = max;
      x.drawImage(bmp, (bmp.width - m) / 2, (bmp.height - m) / 2, m, m, 0, 0, max, max);
    } else {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      x.drawImage(bmp, 0, 0, c.width, c.height);
    }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    return b64(await blob.arrayBuffer());
  }

  // ---------- التشفير ----------
  // رقم الغرفة من الكود بس. مفتاح التشفير من الكود + الباسورد (PBKDF2 ثم HKDF)
  async function derive(code, pw) {
    const salt = enc.encode('locked-room-v2');
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'HKDF', false, ['deriveBits']);
    const idBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('room-id') }, base, 256);
    const pwKey = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const pwBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('pw:' + code), iterations: 310000 }, pwKey, 256));
    const ikm = new Uint8Array([...enc.encode(code), ...pwBits]);
    const base2 = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    const k = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('enc-key') }, base2,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { roomId: hex(idBits), key: k };
  }
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { t: 'msg', iv: b64(iv), ct: b64(ct) };
  }
  async function open(m) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, key, unb64(m.ct));
    return JSON.parse(dec.decode(pt));
  }

  // ---------- الواجهة ----------
  const show = (id) => { for (const s of ['login', 'welcome', 'unlock', 'kicked', 'reset', 'blocked', 'home', 'lock', 'chat']) $(s).classList.toggle('hidden', s !== id); closeAll(); };
  const time = () => new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const scrollDown = () => { $('log').scrollTop = $('log').scrollHeight; };
  function addMsg(who, node) {
    const d = document.createElement('div');
    d.className = 'm ' + who;
    d.appendChild(node);
    const t = document.createElement('small');
    t.textContent = time() + (who === 'me' ? ' ✓' : '');
    d.appendChild(t);
    $('log').appendChild(d);
    scrollDown();
  }
  const textNode = (s) => { const p = document.createElement('p'); p.textContent = s; return p; };
  const sysNote = (s) => { const d = document.createElement('div'); d.className = 'sys'; d.textContent = s; $('log').appendChild(d); scrollDown(); };
  function setStatus() {
    const ok = peers === 2;
    $('status').textContent = ok ? 'متصل' : 'مستني الطرف التاني';
    $('status').classList.toggle('on', ok);
    $('sendBtn').disabled = $('attach').disabled = !ok;
    $('callA').disabled = $('callV').disabled = !ok || callState !== 'idle';
  }
  function imgNode(data) {
    const i = document.createElement('img');
    i.src = blobUrl(data); i.alt = 'صورة'; i.draggable = false;
    i.addEventListener('load', scrollDown);
    return i;
  }
  function setAv(el, url, name) {
    el.style.backgroundImage = url ? `url(${url})` : '';
    el.textContent = url ? '' : ((name || '').trim()[0] || '👤');
  }

  // ---------- البروفايل والخلفية ----------
  const BGS = ['', 'linear-gradient(160deg,#0f2027,#2c5364)', 'linear-gradient(160deg,#1a1a2e,#3a1c71)',
    'linear-gradient(160deg,#134e5e,#3d7a58)', 'linear-gradient(160deg,#42275a,#734b6d)', '#000'];
  let bgUrl = '';
  function applyBg() {
    const v = store.get('b'); let css = '';
    if (v.startsWith('i:')) { if (bgUrl) URL.revokeObjectURL(bgUrl); bgUrl = blobUrl(v.slice(2)); css = `url(${bgUrl})`; }
    else if (v.startsWith('p:')) css = BGS[+v.slice(2)] || '';
    document.documentElement.style.setProperty('--bgimg', css || '#0b141a');
  }
  let myUrl = '';
  function applyMine() {
    const a = store.get('a'); if (myUrl) URL.revokeObjectURL(myUrl);
    myUrl = a ? blobUrl(a) : '';
    setAv($('myAv'), myUrl, store.get('n'));
  }
  function openSettings() {
    closeAll(); tmpAv = null; tmpBg = null;
    $('nameIn').value = store.get('n'); applyMine();
    $('swatches').textContent = '';
    BGS.forEach((css, i) => {
      const b = document.createElement('button');
      b.style.background = css || '#0b141a'; b.setAttribute('aria-label', 'خلفية ' + (i + 1));
      b.onclick = () => { tmpBg = 'p:' + i; document.querySelectorAll('#swatches button').forEach((x) => x.classList.toggle('on', x === b)); };
      $('swatches').appendChild(b);
    });
    $('setSheet').classList.remove('hidden');
  }
  async function saveSettings() {
    store.set('n', $('nameIn').value.trim());
    if (tmpAv !== null) store.set('a', tmpAv);
    if (tmpBg !== null) store.set('b', tmpBg === 'p:0' ? '' : tmpBg);
    applyMine(); applyBg(); closeAll(); sendProfile();
  }
  async function sendProfile() {
    if (!ws || ws.readyState !== 1 || peers !== 2) return;
    ws.send(JSON.stringify(await seal({ k: 'prof', n: store.get('n'), a: store.get('a') })));
  }
  function onProfile(p) {
    const n = typeof p.n === 'string' ? p.n.slice(0, 30) : '';
    peerName = n; $('peerName').textContent = n || 'الطرف التاني';
    if (peerUrl) URL.revokeObjectURL(peerUrl);
    peerUrl = typeof p.a === 'string' && p.a.length > 0 && p.a.length < 60000 ? blobUrl(p.a) : '';
    setAv($('peerAv'), peerUrl, n);
  }

  // ---------- إيموجي ----------
  const EMO = {
    '😀': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😍 🥰 😘 😗 😋 😛 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🙄 😬 😴 🤤 😷 🤒 🤕 🤢 🤮 🥴 😈 💀 👻 🤡',
    '👍': '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🖐️ 🖖 👋 🤝 🙏 ✍️ 💪 👏 🙌 👐 🤲 🫶 🫡 🤌 👀 👅 👄 🧠',
    '❤️': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 ✨ 🔥 ⭐ 🌟 💥 💫 🎉 🎊 🎁 🏆',
    '🐶': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦅 🦉 🐴 🦄 🐝 🦋 🐢 🐍 🐬 🐳 🐟 🌹 🌸 🌻 🌴 🌍 🌙 ☀️ ⛅ ⚡ ❄️ 🌈',
    '🍕': '🍎 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥑 🍅 🥕 🌽 🍞 🧀 🍗 🍖 🍔 🍟 🍕 🌭 🌮 🥙 🍝 🍜 🍣 🍩 🍪 🎂 🍰 🍫 🍬 🍦 ☕ 🍵 🥤 🍺',
    '⚽': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🥊 🎯 🎮 🎲 🎵 🎶 🎤 🎧 🎬 📷 📱 💻 ⌚ 💡 📚 ✏️ 💰 🔑 🔒 🚗 ✈️ 🚀 🏠 ⏰ 🕌',
  };
  function emojiTab(k) {
    document.querySelectorAll('#eTabs button').forEach((b) => b.classList.toggle('on', b.textContent === k));
    $('eGrid').textContent = '';
    EMO[k].split(' ').forEach((e) => {
      const b = document.createElement('button'); b.textContent = e;
      b.onclick = () => {
        const i = $('msg'), s = i.selectionStart ?? i.value.length, t = i.selectionEnd ?? s;
        i.value = i.value.slice(0, s) + e + i.value.slice(t);
        i.selectionStart = i.selectionEnd = s + e.length; i.focus();
      };
      $('eGrid').appendChild(b);
    });
  }
  Object.keys(EMO).forEach((k) => { const b = document.createElement('button'); b.textContent = k; b.onclick = () => emojiTab(k); $('eTabs').appendChild(b); });

  // ---------- القوائم ----------
  function closeAll() { for (const i of ['menu', 'emoji', 'codeSheet', 'setSheet']) $(i).classList.add('hidden'); }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#menu,#menuBtn')) $('menu').classList.add('hidden');
    if (e.target.classList.contains('sheet') || e.target.classList.contains('close')) closeAll();
  });

  // ---------- حماية الشاشة (أقصى ما يقدر المتصفح يعمله) ----------
  let hold = 0;
  const shieldCheck = () => document.body.classList.toggle('shield', document.hidden || !document.hasFocus() || Date.now() < hold);
  const shieldFor = (ms) => { hold = Date.now() + ms; shieldCheck(); setTimeout(shieldCheck, ms + 50); };
  ['visibilitychange', 'blur', 'focus', 'pagehide', 'pageshow', 'resize'].forEach((ev) => addEventListener(ev, shieldCheck));
  setInterval(shieldCheck, 400);
  $('shield').onclick = () => { window.focus(); shieldCheck(); };
  addEventListener('keyup', (e) => {
    if (e.key === 'PrintScreen') { shieldFor(3000); try { navigator.clipboard.writeText(''); } catch {} }
  });
  addEventListener('keydown', (e) => {
    const k = (e.key || '').toLowerCase();
    if (((e.ctrlKey || e.metaKey) && ['p', 's', 'u'].includes(k)) || (e.metaKey && e.shiftKey) || (e.key === 'Meta' || e.key === 'OS')) { shieldFor(2500); if (k.length === 1) e.preventDefault(); }
  });
  ['contextmenu', 'dragstart', 'copy', 'cut'].forEach((ev) => addEventListener(ev, (e) => { if (!e.target.closest('input')) e.preventDefault(); }));

  // ---------- الاتصال ----------
  async function enterRoom(code, pw) {
    const d = await derive(code, pw);
    key = d.key; curCode = code; badShown = false;
    show('chat'); $('log').textContent = ''; peers = 0; setStatus();
    onProfile({}); peerName = '';
    sysNote('الرسايل والصور متشفرة بالباسورد على جهازك. المتصفح مبيقدرش يمنع سكرين شوت بالكامل، النسخة بتاعة التطبيق هي اللي بتمنعه فعلاً.');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?r=' + d.roomId);
    ws.onmessage = async (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'joined' || m.t === 'peer') {
        const was = peers; peers = m.n;
        if (peers < 2 && callState !== 'idle') endCall(null, false);
        setStatus();
        if (peers === 2) sendProfile();
        if (m.t === 'peer' && was === 2 && peers < 2) sysNote('الطرف التاني خرج.');
      } else if (m.t === 'full') { leave('الغرفة دي فيها شخصين بالفعل.'); }
      else if (m.t === 'kicked') { watch(); }
      else if (m.t === 'msg') {
        try {
          const p = await open(m);
          if (p.k === 'call') { await onCall(p); return; }
          if (p.k === 'prof') onProfile(p);
          else if (p.k === 'text' && typeof p.v === 'string') addMsg('them', textNode(p.v));
          else if (p.k === 'img' && typeof p.v === 'string') addMsg('them', imgNode(p.v));
        } catch {
          if (!badShown) { badShown = true; sysNote('وصلت رسالة مش قادر يفك تشفيرها. غالباً الباسورد مش نفس باسورد الطرف التاني.'); }
        }
      }
    };
    ws.onclose = (ev) => { endCall(null, false); if (ev && ev.code === 4001) watch(); if (key) { peers = 0; setStatus(); $('status').textContent = 'الاتصال اتقطع'; } };
  }
  function leave(err) {
    endCall(null, true);
    const w = ws; ws = null; key = null; curCode = '';
    if (w) w.close();
    $('log').textContent = ''; $('msg').value = ''; newCode = ''; pendingCode = ''; $('pw').value = '';
    $('created').classList.add('hidden'); $('codeBox').textContent = ''; $('codeIn').value = '';
    $('homeErr').textContent = err || '';
    show('home');
  }
  function askPw(code) {
    pendingCode = code; $('pw').value = ''; $('pwErr').textContent = '';
    show('lock'); $('pw').focus();
  }
  async function submitPw() {
    const pw = $('pw').value;
    if (pw.length < 6) { $('pwErr').textContent = 'الباسورد لازم 6 حروف على الأقل.'; return; }
    $('pwGo').disabled = true; $('pwErr').textContent = 'جاري التحقق...';
    try { await enterRoom(pendingCode, pw); $('pw').value = ''; }
    catch { $('pwErr').textContent = 'حصل خطأ، جرب تاني.'; }
    $('pwGo').disabled = false;
  }

  async function sendObj(o, node, who) {
    if (!ws || ws.readyState !== 1 || peers !== 2) return;
    ws.send(JSON.stringify(await seal(o)));
    addMsg(who, node);
  }
  async function sendText() {
    const v = $('msg').value.trim();
    if (!v) return;
    $('msg').value = '';
    await sendObj({ k: 'text', v }, textNode(v), 'me');
  }
  async function sendImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const data = await shrink(file, 1600, 0.85);
      if (data.length > 4e6) return sysNote('الصورة كبيرة قوي.');
      await sendObj({ k: 'img', v: data }, imgNode(data), 'me');
    } catch { sysNote('معرفتش أقرأ الصورة دي.'); }
  }

  // ---------- المكالمات (WebRTC مباشر بين الجهازين) ----------
  const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  async function sendSig(o, id) {
    const w = ws; if (!w || w.readyState !== 1) return;
    try { w.send(JSON.stringify(await seal({ k: 'call', id: id || callId, ts: Date.now(), ...o }))); } catch {}
  }
  const getMedia = (video) => navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false });
  function gathered() {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const f = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', f); res(); } };
      pc.addEventListener('icegatheringstatechange', f);
      setTimeout(res, 4000);
    });
  }
  function newPc() {
    const me = pc = new RTCPeerConnection({ iceServers: ICE });
    stream.getTracks().forEach((t) => me.addTrack(t, stream));
    me.ontrack = (e) => { $('remoteVid').srcObject = e.streams[0]; };
    me.onconnectionstatechange = () => {
      if (pc !== me) return;
      if (me.connectionState === 'connected') { callState = 'active'; $('callStatus').textContent = 'متصل'; }
      else if (me.connectionState === 'failed') endCall('المكالمة معرفتش تتوصل. ممكن الشبكة مش بتسمح بالاتصال المباشر.', true);
    };
  }
  function showCall(video, status) {
    $('call').classList.toggle('audio', !video);
    $('camBtn').classList.toggle('hidden', !video);
    $('localVid').srcObject = stream;
    $('callStatus').textContent = status;
    $('muteBtn').textContent = '🎤 كتم'; $('camBtn').textContent = '📷 إيقاف';
    $('call').classList.remove('hidden');
    setStatus();
  }
  async function startCall(video) {
    if (callState !== 'idle' || peers !== 2) return;
    callState = 'calling'; callId = hex(crypto.getRandomValues(new Uint8Array(8))); setStatus();
    try { stream = await getMedia(video); }
    catch { callState = 'idle'; callId = ''; setStatus(); return sysNote('معرفتش أفتح المايك أو الكاميرا. اتأكد إنك سمحت بالإذن.'); }
    showCall(video, 'بيرن...');
    try {
      newPc();
      await pc.setLocalDescription(await pc.createOffer());
      await gathered();
      if (callState !== 'calling') return;
      await sendSig({ a: 'offer', video, sdp: pc.localDescription.sdp });
      callTimer = setTimeout(() => endCall('محدش رد.', true), 45000);
    } catch { endCall('معرفتش أبدأ المكالمة.', true); }
  }
  async function acceptCall() {
    const p = pendingOffer; pendingOffer = null; $('incoming').classList.add('hidden');
    if (!p || callState !== 'ringing') return;
    try { stream = await getMedia(p.video); }
    catch { await sendSig({ a: 'end' }); callState = 'idle'; callId = ''; setStatus(); return sysNote('معرفتش أفتح المايك أو الكاميرا. اتأكد إنك سمحت بالإذن.'); }
    showCall(p.video, 'بيتصل...');
    try {
      newPc();
      await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered();
      await sendSig({ a: 'answer', sdp: pc.localDescription.sdp });
    } catch { endCall('معرفتش أرد على المكالمة.', true); }
  }
  async function onCall(p) {
    if (typeof p.id !== 'string' || p.id.length > 32 || typeof p.ts !== 'number') return;
    if (p.a === 'offer') {
      if (Math.abs(Date.now() - p.ts) > 60000 || typeof p.sdp !== 'string' || p.sdp.length > 60000) return;
      if (callState !== 'idle') return sendSig({ a: 'end', why: 'busy' }, p.id);
      callState = 'ringing'; callId = p.id; pendingOffer = { video: !!p.video, sdp: p.sdp }; setStatus();
      $('incomingText').textContent = p.video ? '🎥 مكالمة فيديو جاية' : '📞 مكالمة صوت جاية';
      $('incoming').classList.remove('hidden');
    } else if (p.id !== callId) {
      return;
    } else if (p.a === 'answer' && callState === 'calling' && pc && !pc.currentRemoteDescription && typeof p.sdp === 'string' && p.sdp.length <= 60000) {
      clearTimeout(callTimer);
      try { await pc.setRemoteDescription({ type: 'answer', sdp: p.sdp }); } catch { endCall('معرفتش أوصل المكالمة.', true); }
    } else if (p.a === 'end') {
      endCall(p.why === 'busy' ? 'الطرف التاني في مكالمة تانية.' : 'المكالمة انتهت.', false);
    }
  }
  function endCall(msg, notify) {
    if (callState === 'idle') return;
    if (notify) sendSig({ a: 'end' });
    clearTimeout(callTimer);
    const c = pc; pc = null;
    if (c) c.close();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; pendingOffer = null; callState = 'idle'; callId = '';
    $('remoteVid').srcObject = null; $('localVid').srcObject = null;
    $('call').classList.add('hidden'); $('incoming').classList.add('hidden');
    if (msg) sysNote(msg);
    setStatus();
  }
  const toggleTracks = (kind, btn, on, off) => {
    if (!stream) return;
    const ts = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
    const en = !ts.every((t) => t.enabled);
    ts.forEach((t) => t.enabled = en);
    btn.textContent = en ? on : off;
  };

  // ---------- أحداث ----------
  const copy = (t, btn) => navigator.clipboard.writeText(t).then(() => { const o = btn.textContent; btn.textContent = 'اتنسخ ✓'; setTimeout(() => btn.textContent = o, 1200); });
  $('create').onclick = () => {
    newCode = genCode();
    $('codeBox').textContent = fmt(newCode);
    $('created').classList.remove('hidden');
    $('homeErr').textContent = '';
  };
  $('copyCode').onclick = (e) => copy(fmt(newCode), e.target);
  $('copyLink').onclick = (e) => copy(location.origin + '/#' + newCode, e.target); // الجزء بعد # مبيتبعتش للسيرفر
  $('enter').onclick = () => newCode && askPw(newCode);
  $('join').onclick = () => {
    const c = norm($('codeIn').value);
    if (!valid(c)) { $('homeErr').textContent = 'الكود مش صح. لازم 24 حرف ورقم.'; return; }
    askPw(c);
  };
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });
  $('pwGo').onclick = submitPw;
  $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPw(); });
  $('pwBack').onclick = () => show('home');
  $('sendBtn').onclick = sendText;
  $('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
  $('attach').onclick = () => $('file').click();
  $('file').onchange = (e) => { sendImage(e.target.files[0]); e.target.value = ''; };
  $('emojiBtn').onclick = () => { const h = $('emoji').classList.toggle('hidden'); if (!h) emojiTab(Object.keys(EMO)[0]); };
  $('menuBtn').onclick = () => $('menu').classList.toggle('hidden');
  $('mCode').onclick = () => { closeAll(); $('curCode').textContent = fmt(curCode); $('codeSheet').classList.remove('hidden'); };
  $('copyCode2').onclick = (e) => copy(fmt(curCode), e.target);
  $('copyLink2').onclick = (e) => copy(location.origin + '/#' + curCode, e.target);
  $('mSet').onclick = openSettings;
  $('setHome').onclick = openSettings;
  $('avBtn').onclick = () => $('avFile').click();
  $('avFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { tmpAv = await shrink(f, 128, 0.8, true); setAv($('myAv'), blobUrl(tmpAv), $('nameIn').value); } catch {}
  };
  $('avDel').onclick = () => { tmpAv = ''; setAv($('myAv'), '', $('nameIn').value); };
  $('bgBtn').onclick = () => $('bgFile').click();
  $('bgFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { tmpBg = 'i:' + await shrink(f, 1080, 0.7); document.querySelectorAll('#swatches button').forEach((x) => x.classList.remove('on')); } catch {}
  };
  $('saveSet').onclick = saveSettings;
  $('leave').onclick = () => leave();
  $('callA').onclick = () => startCall(false);
  $('callV').onclick = () => startCall(true);
  $('acceptBtn').onclick = acceptCall;
  $('declineBtn').onclick = () => { sendSig({ a: 'end' }); endCall(null, false); };
  $('hangBtn').onclick = () => endCall('المكالمة انتهت.', true);
  $('muteBtn').onclick = (e) => toggleTracks('audio', e.target, '🎤 كتم', '🎤 تشغيل');
  $('camBtn').onclick = (e) => toggleTracks('video', e.target, '📷 إيقاف', '📷 تشغيل');

  // ---------- الحساب: جوجل ثم الباسورد ----------
  let loggedIn = false; // true لما الجلسة كاملة وصالحة على الجهاز ده
  let pendingRoom = ''; // كود غرفة جاي من رابط دعوة، بنحتفظ بيه لحد ما المستخدم يخلص دخول
  const MSG = {
    denied: 'لازم توافق على تسجيل الدخول بجوجل عشان تكمل.',
    failed: 'تسجيل الدخول فشل، جرب تاني.',
    unverified: 'إيميل جوجل ده مش متأكد منه. استخدم حساب تاني.',
    config: 'تسجيل الدخول بجوجل لسه مش متظبط على السيرفر.',
    blocked: 'الجهاز ده محظور من الحساب ده.',
  };
  async function api(path, body) {
    try {
      const r = await fetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    } catch { return { status: 0, data: {} }; }
  }
  function enterApp() {
    $('homeErr').textContent = '';
    let c = pendingRoom;
    if (!c) { try { c = sessionStorage.getItem('lr.pc') || ''; } catch {} }
    pendingRoom = '';
    try { sessionStorage.removeItem('lr.pc'); } catch {}
    if (c && valid(c)) askPw(c); else show('home');
  }
  function route(me, err) {
    for (const id of ['wPw', 'wPw2', 'uPw', 'rPw', 'rPw2']) $(id).value = '';
    for (const id of ['wErr', 'uErr', 'kErr', 'rErr']) $(id).textContent = '';
    loggedIn = me.s === 'ok';
    if (me.s === 'ok') return enterApp();
    if (me.s === 'blocked') return show('blocked');
    if (me.s === 'kicked' || me.s === 'reset') {
      const by = me.by || {};
      const when = by.t ? new Date(by.t).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      if (me.s === 'kicked') {
        $('kDev').textContent = by.n || 'جهاز غير معروف'; $('kTime').textContent = when;
        $('kLoc').textContent = by.l || ''; $('kLocRow').classList.toggle('hidden', !by.l);
        show('kicked'); $('kMe').focus();
      } else {
        $('rDev').textContent = by.n || 'جهاز غير معروف'; $('rTime').textContent = when;
        show('reset'); $('rPw').focus();
      }
      return;
    }
    if (me.s === 'new' || me.s === 'unlock') {
      const first = (me.name || '').split(' ')[0];
      if (me.s === 'new') {
        $('wName').textContent = first ? 'أهلاً بيك يا ' + first : 'أهلاً بيك';
        $('wMail').textContent = me.email || '';
        show('welcome'); $('wPw').focus();
      } else {
        $('uName').textContent = first ? 'أهلاً بيك تاني يا ' + first : 'أهلاً بيك تاني';
        $('uMail').textContent = me.email || '';
        show('unlock'); $('uPw').focus();
      }
      return;
    }
    $('loginErr').textContent = err || '';
    show('login');
  }
  async function boot(err) {
    const { data } = await api('/api/me');
    route(data && data.s ? data : { s: 'anon' }, err);
  }
  async function submitWelcome() {
    const a = $('wPw').value, b = $('wPw2').value;
    if (a.length < 8) { $('wErr').textContent = 'الباسورد لازم 8 حروف على الأقل.'; return; }
    if (a !== b) { $('wErr').textContent = 'الباسورد مش متطابق في الخانتين.'; return; }
    $('wGo').disabled = true; $('wErr').textContent = 'جاري الإنشاء...';
    const { status, data } = await api('/api/setup', { pw: a });
    $('wGo').disabled = false;
    if (status === 200) { $('wPw').value = $('wPw2').value = ''; return boot(); }
    if (status === 409 || status === 403) return boot(); // الحساب اتعمل قبل كده، أو الجهاز محظور
    if (status === 401) return boot('الجلسة خلصت، سجل دخولك تاني.');
    $('wErr').textContent = status === 400 ? 'الباسورد لازم يكون من 8 لـ 200 حرف.' : 'حصل خطأ، جرب تاني.';
  }
  async function submitUnlock() {
    const pw = $('uPw').value;
    if (!pw) { $('uErr').textContent = 'اكتب الباسورد.'; return; }
    $('uGo').disabled = true; $('uErr').textContent = 'جاري التحقق...';
    const { status, data } = await api('/api/login', { pw });
    $('uGo').disabled = false;
    if (status === 200) { $('uPw').value = ''; return boot(); }
    if (status === 401 && data.e === 'session') return boot('الجلسة خلصت، سجل دخولك تاني.');
    if (status === 403) return boot();
    $('uPw').value = '';
    if (status === 429) $('uErr').textContent = 'محاولات كتير غلط. استنى ' + Math.ceil((data.wait || 900) / 60) + ' دقيقة وجرب تاني.';
    else if (status === 401) $('uErr').textContent = 'الباسورد غلط' + (data.left ? ` (باقي ${data.left} محاولات).` : '.');
    else $('uErr').textContent = 'حصل خطأ، جرب تاني.';
  }
  async function signOut() {
    await api('/auth/logout', {});
    leave(); // بيقفل أي غرفة ويمسح الشاشة
    boot();
  }
  $('gBtn').addEventListener('click', () => { // الرابط بيخرج من الصفحة، فبنحفظ كود الدعوة مؤقتاً في التبويب ده بس
    if (pendingRoom) { try { sessionStorage.setItem('lr.pc', pendingRoom); } catch {} }
  });
  async function chooseDevice(path, btn) { // كان أنا / مش أنا
    $('kMe').disabled = $('kNot').disabled = true; $('kErr').textContent = '';
    const { status } = await api(path, {});
    $('kMe').disabled = $('kNot').disabled = false;
    if (status === 200) return boot();
    if (status === 401) return boot('الجلسة خلصت، سجل دخولك تاني.');
    if (status === 403) return boot();
    $('kErr').textContent = 'حصل خطأ، جرب تاني.';
  }
  async function submitReset() {
    const a = $('rPw').value, b = $('rPw2').value;
    if (a.length < 8) { $('rErr').textContent = 'الباسورد لازم 8 حروف على الأقل.'; return; }
    if (a !== b) { $('rErr').textContent = 'الباسورد مش متطابق في الخانتين.'; return; }
    $('rGo').disabled = true; $('rErr').textContent = 'جاري التغيير...';
    const { status } = await api('/api/reset', { pw: a });
    $('rGo').disabled = false;
    if (status === 200) { $('rPw').value = $('rPw2').value = ''; return boot(); }
    if (status === 401) return boot('الجلسة خلصت، سجل دخولك تاني.');
    if (status === 409 || status === 403) return boot(); // الحالة اتغيرت
    $('rErr').textContent = status === 400 ? 'الباسورد لازم يكون من 8 لـ 200 حرف.' : 'حصل خطأ، جرب تاني.';
  }
  // لو الحساب اتاخد من جهاز تاني وانت جوه التطبيق: بنقفل الغرفة ونعرض شاشة التنبيه
  let watching = false;
  async function watch() {
    if (!loggedIn || watching) return;
    watching = true;
    try {
      const { status, data } = await api('/api/me');
      if (status === 200 && data && data.s && data.s !== 'ok') { leave(); route(data); }
    } finally { watching = false; }
  }
  setInterval(watch, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) watch(); });
  window.addEventListener('focus', watch);
  $('kMe').onclick = () => chooseDevice('/api/ack');
  $('kNot').onclick = () => chooseDevice('/api/notme');
  $('rGo').onclick = submitReset;
  $('rPw2').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitReset(); });
  $('bOut').onclick = signOut;
  $('wGo').onclick = submitWelcome;
  $('wPw2').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitWelcome(); });
  $('uGo').onclick = submitUnlock;
  $('uPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitUnlock(); });
  $('wOut').onclick = $('uOut').onclick = $('logout').onclick = signOut;

  applyBg(); applyMine(); shieldCheck();
  // رابط فيه كود الغرفة: بنمسحه من شريط العنوان فوراً ونحتفظ بيه لحد ما يخلص تسجيل الدخول
  const h = norm(location.hash.slice(1));
  if (h) { history.replaceState(null, '', location.pathname); if (valid(h)) pendingRoom = h; }
  // رسالة خطأ راجعة من جوجل (?e=...)
  const qe = new URLSearchParams(location.search).get('e');
  if (qe) history.replaceState(null, '', location.pathname);
  boot(MSG[qe] || '');
})();
