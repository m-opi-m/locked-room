'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 حرف = 5 bits، والكود 24 حرف = 120 bit
  const enc = new TextEncoder(), dec = new TextDecoder();
  let ws = null, key = null, peers = 0, newCode = '';

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

  // ---------- التشفير ----------
  async function derive(code) {
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'HKDF', false, ['deriveBits', 'deriveKey']);
    const salt = enc.encode('locked-room-v1');
    const idBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('room-id') }, base, 256);
    const k = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('enc-key') }, base,
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
  const show = (id) => { for (const s of ['home', 'chat']) $(s).classList.toggle('hidden', s !== id); };
  const time = () => new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  function addMsg(who, node) {
    const d = document.createElement('div');
    d.className = 'm ' + who;
    d.appendChild(node);
    const t = document.createElement('small');
    t.textContent = time();
    d.appendChild(t);
    $('log').appendChild(d);
    $('log').scrollTop = $('log').scrollHeight;
  }
  const textNode = (s) => { const p = document.createElement('p'); p.textContent = s; return p; };
  const sysNote = (s) => { const d = document.createElement('div'); d.className = 'sys'; d.textContent = s; $('log').appendChild(d); };
  function setStatus() {
    const ok = peers === 2;
    $('status').textContent = ok ? 'مشفّرة، والطرف التاني متصل' : 'مشفّرة، مستني الطرف التاني';
    $('status').classList.toggle('on', ok);
    $('sendBtn').disabled = $('attach').disabled = !ok;
  }
  function imgNode(b64data) {
    const url = URL.createObjectURL(new Blob([unb64(b64data)], { type: 'image/jpeg' })); // النوع بيتحدد عندنا، مش من المرسل
    const i = document.createElement('img');
    i.src = url; i.alt = 'صورة';
    i.addEventListener('load', () => $('log').scrollTop = $('log').scrollHeight);
    return i;
  }

  // ---------- الاتصال ----------
  async function enterRoom(code) {
    const d = await derive(code);
    key = d.key;
    show('chat'); $('log').textContent = ''; peers = 0; setStatus();
    sysNote('الرسايل بتتشفر على جهازك. اقفل الصفحة أو اضغط "إنهاء ومسح" وكل حاجة بتتمسح.');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?r=' + d.roomId);
    ws.onmessage = async (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'joined' || m.t === 'peer') { const was = peers; peers = m.n; setStatus(); if (m.t === 'peer' && was === 2 && peers < 2) sysNote('الطرف التاني خرج.'); }
      else if (m.t === 'full') { leave('الغرفة دي فيها شخصين بالفعل.'); }
      else if (m.t === 'msg') {
        try {
          const p = await open(m);
          if (p.k === 'text' && typeof p.v === 'string') addMsg('them', textNode(p.v));
          else if (p.k === 'img' && typeof p.v === 'string') addMsg('them', imgNode(p.v));
        } catch { sysNote('وصلت رسالة مش قادر يفك تشفيرها، اتجاهلت.'); }
      }
    };
    ws.onclose = () => { if (key) { peers = 0; setStatus(); $('status').textContent = 'الاتصال اتقطع'; } };
  }
  function leave(err) {
    const w = ws; ws = null; key = null;
    if (w) w.close();
    $('log').textContent = ''; $('msg').value = ''; newCode = '';
    $('created').classList.add('hidden'); $('codeBox').textContent = ''; $('codeIn').value = '';
    $('homeErr').textContent = err || '';
    show('home');
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
  // بنصغّر الصورة ونعيد رسمها: ده بيشيل بيانات الموقع (EXIF) كمان
  async function sendImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (blob.size > 3 * 1024 * 1024) return sysNote('الصورة كبيرة قوي.');
      const data = b64(await blob.arrayBuffer());
      await sendObj({ k: 'img', v: data }, imgNode(data), 'me');
    } catch { sysNote('معرفتش أقرأ الصورة دي.'); }
  }

  // ---------- أحداث ----------
  $('create').onclick = () => {
    newCode = genCode();
    $('codeBox').textContent = fmt(newCode);
    $('created').classList.remove('hidden');
    $('homeErr').textContent = '';
  };
  const copy = (t, btn) => navigator.clipboard.writeText(t).then(() => { const o = btn.textContent; btn.textContent = 'اتنسخ'; setTimeout(() => btn.textContent = o, 1200); });
  $('copyCode').onclick = (e) => copy(fmt(newCode), e.target);
  $('copyLink').onclick = (e) => copy(location.origin + '/#' + newCode, e.target); // الجزء بعد # مبيتبعتش للسيرفر
  $('enter').onclick = () => newCode && enterRoom(newCode);
  $('join').onclick = () => {
    const c = norm($('codeIn').value);
    if (!valid(c)) { $('homeErr').textContent = 'الكود مش صح. لازم 24 حرف ورقم.'; return; }
    enterRoom(c);
  };
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });
  $('sendBtn').onclick = sendText;
  $('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
  $('attach').onclick = () => $('file').click();
  $('file').onchange = (e) => { sendImage(e.target.files[0]); e.target.value = ''; };
  $('leave').onclick = () => leave();

  // دخول من رابط فيه الكود، وبنمسحه من شريط العنوان فوراً
  const h = norm(location.hash.slice(1));
  if (h) { history.replaceState(null, '', location.pathname); if (valid(h)) enterRoom(h); }
})();
