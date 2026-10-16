// ⚠️ أي تعديل في المشروع (هنا أو في web/ أو build.mjs) لازم يتبعه زيادة "version" في package.json — هو اللي بيظهر في الإعدادات.
import { DurableObject } from 'cloudflare:workers';
import { connect } from 'cloudflare:sockets';
import { APP_VERSION } from './version.js';
import { peerOf, semverGt, updatePayload } from './push-util.js';

const PAGES = new Set(['/', '/app.js', '/style.css', '/logo.png', '/app-icon.png', '/apple-touch-icon.png', '/icon-192.png', '/badge-96.png', '/sw.js', '/gallery-editor.js']);
const knockPayload = (ar) => ({ title: ar ? 'غرفة مقفولة' : 'Locked Room', body: ar ? 'هناك من يطرق الباب' : 'Someone is knocking at the door', lang: ar ? 'ar' : 'en', dir: ar ? 'rtl' : 'ltr', icon: '/icon-192.png', badge: '/badge-96.png', tag: 'locked-room-knock-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url: '/' });
const MAX_MSG = 6 * 1024 * 1024;
const SESSION_DAYS = 7;          // مدة بقاء المستخدم داخل بعد ما يكتب الباسورد
const PENDING_MIN = 15;          // المهلة بين جوجل وكتابة الباسورد
const PW_MIN = 8, PW_MAX = 200;
const PBKDF2_ITER = 100000;      // أقصى رقم بيسمح بيه Cloudflare Workers
const MAX_BLOCKED = 50;         // أقصى عدد أجهزة محظورة بنحتفظ بيها لكل حساب
const DEV_COOKIE_AGE = 400 * 86400; // كوكي معرّف الجهاز (أقصى مدة بيسمح بيها المتصفح)

const enc = new TextEncoder();
const isLocal = (url) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

function secHeaders(url, type) {
  const conn = `'self' wss://${url.host}` + (isLocal(url) ? ` ws://${url.host}` : '');
  return {
    'Content-Type': type,
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src ${conn}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
    'Accept-CH': 'Sec-CH-UA-Model, Sec-CH-UA-Platform', // عشان اسم موبايل الأندرويد يظهر بدل "Android" بس
  };
}

// ---------- أدوات ----------
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
function concatBytes(...items) { const size=items.reduce((n,x)=>n+x.length,0),out=new Uint8Array(size);let at=0;for(const x of items){out.set(x,at);at+=x.length;}return out; }
async function hmacBytes(rawKey, data) { const key=await crypto.subtle.importKey('raw',rawKey,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,data)); }
async function hkdfExpand(prk, info, length) { let out=new Uint8Array(0),previous=new Uint8Array(0),counter=1;while(out.length<length){previous=await hmacBytes(prk,concatBytes(previous,info,new Uint8Array([counter++])));out=concatBytes(out,previous);}return out.slice(0,length); }
async function webPushPayload(env, subscription, payload) {
  if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)throw new Error('VAPID keys are not configured');
  const endpoint=new URL(subscription.endpoint);if(endpoint.protocol!=='https:')throw new Error('invalid push endpoint');
  const publicKey=unb64u(env.VAPID_PUBLIC_KEY), receiver=unb64u(subscription.keys.p256dh), auth=unb64u(subscription.keys.auth);
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']), sender=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
  const ua=await crypto.subtle.importKey('raw',receiver,{name:'ECDH',namedCurve:'P-256'},false,[]), shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:ua},pair.privateKey,256));
  const prkKey=await hmacBytes(auth,shared), ikm=await hkdfExpand(prkKey,concatBytes(enc.encode('WebPush: info\0'),receiver,sender),32), salt=crypto.getRandomValues(new Uint8Array(16)), prk=await hmacBytes(salt,ikm);
  const cek=await hkdfExpand(prk,enc.encode('Content-Encoding: aes128gcm\0'),16), nonce=await hkdfExpand(prk,enc.encode('Content-Encoding: nonce\0'),12);
  const plain=concatBytes(enc.encode(JSON.stringify(payload)),new Uint8Array([2])), aes=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']), encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},aes,plain));
  const head=new Uint8Array(5);new DataView(head.buffer).setUint32(0,4096);head[4]=sender.length;
  const body=concatBytes(salt,head,sender,encrypted);
  const pub=publicKey, jwk={kty:'EC',crv:'P-256',x:b64u(pub.slice(1,33)),y:b64u(pub.slice(33,65)),d:env.VAPID_PRIVATE_KEY,ext:true,key_ops:['sign']};
  const vapidKey=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const encPart=value=>b64u(enc.encode(JSON.stringify(value))), header=encPart({typ:'JWT',alg:'ES256'}), claims=encPart({aud:endpoint.origin,exp:Math.floor(Date.now()/1000)+12*60*60,sub:env.VAPID_SUBJECT||subscription.origin||endpoint.origin}), unsigned=header+'.'+claims;
  const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},vapidKey,enc.encode(unsigned))), jwt=unsigned+'.'+b64u(signature);
  return {body,headers:{Authorization:'vapid t='+jwt+', k='+env.VAPID_PUBLIC_KEY,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'86400',Urgency:'high'}};
}
async function sendWebPush(env, subscription, payload) { const encrypted=await webPushPayload(env,subscription,payload);return fetch(subscription.endpoint,{method:'POST',headers:encrypted.headers,body:encrypted.body}); }

function same(a, b) { // مقارنة ثابتة الوقت
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const cname = (url, n) => (isLocal(url) ? n : '__Host-' + n);
function setCookie(url, n, v, maxAge) {
  return `${cname(url, n)}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (isLocal(url) ? '' : '; Secure');
}
function getCookie(req, url, n) {
  const want = cname(url, n) + '=';
  for (const p of (req.headers.get('Cookie') || '').split(';')) {
    const s = p.trim();
    if (s.startsWith(want)) return s.slice(want.length);
  }
  return '';
}

async function hmacKey(env, usage) {
  return crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
// ---------- الجهاز ----------
// اسم الجهاز بيتحسب من الـ User-Agent (المتصفحات الحديثة بتخبي موديل الموبايل غالباً، فممكن يظهر "Android · Chrome" بس)
function deviceName(req) {
  const ua = req.headers.get('User-Agent') || '';
  let os = 'جهاز غير معروف', model = '', br = '';
  if (/Android/i.test(ua)) {
    os = 'Android';
    const m = ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\sBuild|[;)])/);
    if (m && m[1].trim().length > 1) model = m[1].trim();
    const hint = (req.headers.get('Sec-CH-UA-Model') || '').replace(/[\\"]/g, '').trim(); // الموديل الحقيقي لو المتصفح بعته
    if (hint.length > 1) model = hint.slice(0, 30);
  }
  else if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac';
  else if (/CrOS/.test(ua)) os = 'Chromebook';
  else if (/Linux/.test(ua)) os = 'Linux';
  if (/LockedRoomApp/.test(ua)) br = 'التطبيق';
  else if (/Edg\//.test(ua)) br = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) br = 'Opera';
  else if (/SamsungBrowser/.test(ua)) br = 'Samsung Internet';
  else if (/Firefox|FxiOS/.test(ua)) br = 'Firefox';
  else if (/Chrome|CriOS/.test(ua)) br = 'Chrome';
  else if (/Safari/.test(ua)) br = 'Safari';
  return (os + (model ? ' ' + model : '') + (br ? ' · ' + br : '')).slice(0, 60);
}
function deviceLoc(req) {
  const cf = req.cf || {};
  return [cf.city, cf.country].filter((x) => typeof x === 'string').join('، ').slice(0, 60);
}
const validDid = (d) => /^[A-Za-z0-9_-]{20,40}$/.test(d);

// ---------- الجلسة ----------
// الجلسة بتحمل: sub (حساب جوجل)، did (معرّف الجهاز)، v (رقم الجلسة الحالية)، rs (اختار "مش أنا" وناقصه باسورد جديد)
async function signSession(env, data) {
  const body = b64u(enc.encode(JSON.stringify(data)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env, 'sign'), enc.encode(body));
  return body + '.' + b64u(sig);
}
async function readSession(req, url, env) {
  const tok = getCookie(req, url, 'sid');
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env, 'verify'), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return s && s.exp > Date.now() && typeof s.sub === 'string' ? s : null;
  } catch { return null; }
}
// opt.full = جلسة كاملة (7 أيام) | opt.v = رقم الجلسة | opt.rs = مستني باسورد جديد
async function sessionCookie(url, env, s, opt = {}) {
  const ms = (opt.full ? SESSION_DAYS * 1440 : PENDING_MIN) * 60000;
  const tok = await signSession(env, {
    sub: s.sub, email: s.email, name: s.name, did: s.did,
    ok: !!opt.full, v: opt.full ? String(opt.v || '') : '', rs: !!(opt.full && opt.rs),
    exp: Date.now() + ms,
  });
  return setCookie(url, 'sid', tok, Math.floor(ms / 1000));
}

function json(url, obj, status = 200, cookies = []) {
  const h = new Headers(secHeaders(url, 'application/json; charset=utf-8'));
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(JSON.stringify(obj), { status, headers: h });
}
function redirect(url, to, cookies = []) {
  const h = new Headers({ Location: to, 'Cache-Control': 'no-store' });
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
}
async function readBody(req) {
  const t = await req.text();
  if (t.length > 8192) return null;
  try { return JSON.parse(t); } catch { return null; }
}
const account = (env, sub) => env.ACCOUNT.get(env.ACCOUNT.idFromName(sub));
function hexBytes(buf) { return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''); }
async function roomHexFromCode(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'HKDF', false, ['deriveBits']);
  return hexBytes(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('locked-room-v2'), info: enc.encode('room-id') }, base, 256));
}
async function roomObjectName(env, code) { return env.ROOM.idFromName(await roomHexFromCode(code)).toString(); }
async function roomPasswordFingerprint(env, pw) {
  const fpKey = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', fpKey, enc.encode('room-password:' + pw)));
}

// ---------- جوجل ----------
function googleReady(env) {
  return env.GOOGLE_CLIENT_ID && !String(env.GOOGLE_CLIENT_ID).startsWith('PUT_') && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET && String(env.SESSION_SECRET).length >= 32;
}

async function googleStart(url, env) {
  if (!googleReady(env)) return redirect(url, '/?e=config');
  const state = rand(24), verifier = rand(48), nonce = rand(24);
  const challenge = b64u(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: url.origin + '/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state, nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return redirect(url, 'https://accounts.google.com/o/oauth2/v2/auth?' + q, [setCookie(url, 'os', `${state}.${verifier}.${nonce}`, 600)]);
}

async function googleCallback(req, url, env, did) {
  const clear = setCookie(url, 'os', '', 0);
  if (!googleReady(env)) return redirect(url, '/?e=config', [clear]);
  if (url.searchParams.get('error')) return redirect(url, '/?e=denied', [clear]);
  const [state, verifier, nonce] = getCookie(req, url, 'os').split('.');
  const code = url.searchParams.get('code') || '';
  if (!state || !verifier || !nonce || !code || url.searchParams.get('state') !== state) return redirect(url, '/?e=failed', [clear]);
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: url.origin + '/auth/callback', grant_type: 'authorization_code', code_verifier: verifier,
      }),
    });
    if (!r.ok) return redirect(url, '/?e=failed', [clear]);
    const { id_token } = await r.json();
    // التوكن جاي من جوجل مباشرة عبر TLS في خطوة server-to-server، فبنتحقق من محتواه بس
    const p = JSON.parse(new TextDecoder().decode(unb64u(String(id_token).split('.')[1])));
    const okIss = p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com';
    if (!okIss || p.aud !== env.GOOGLE_CLIENT_ID || p.nonce !== nonce || !(p.exp * 1000 > Date.now()) || typeof p.sub !== 'string') return redirect(url, '/?e=failed', [clear]);
    if (p.email_verified !== true || typeof p.email !== 'string') return redirect(url, '/?e=unverified', [clear]);
    const name = typeof p.name === 'string' ? p.name.slice(0, 60) : '';
    const acc = account(env, p.sub);
    // الجهاز المحظور لا يبدأ جلسة، والجهاز الحالي يطلب تأكيد أي دخول جديد فور نجاح Google.
    const access = await acc.beginLogin(did, deviceName(req), deviceLoc(req));
    if (access.blocked) return redirect(url, '/?e=blocked', [clear]);
    const sess = await sessionCookie(url, env, { sub: p.sub, email: p.email.slice(0, 120), name, did });
    return redirect(url, '/', [clear, sess]);
  } catch {
    return redirect(url, '/?e=failed', [clear]);
  }
}

// ---------- استعادة الحساب بكود على الإيميل ----------
function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '';
  return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d;
}
const b64text = (str) => { const b = enc.encode(str); let r = ''; for (let i = 0; i < b.length; i += 0x8000) r += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(r); };
const wrap76 = (x) => x.replace(/(.{76})/g, '$1\r\n');

// إرسال إيميل عن طريق SMTP (جيميل بـ App Password): من غير دومين، وبيبعت لأي إيميل
async function smtpSend(env, to, subject, text, html, connectFn = connect) {
  const user = String(env.GMAIL_USER || '').trim(), pass = String(env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const sock = connectFn({ hostname: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT) || 465 }, { secureTransport: 'on', allowHalfOpen: false });
  const reader = sock.readable.getReader(), writer = sock.writable.getWriter(), dec = new TextDecoder();
  let buf = '';
  const read = async () => {
    const lines = [];
    for (;;) {
      let i;
      while ((i = buf.indexOf('\r\n')) < 0) {
        const { value, done } = await reader.read();
        if (done) throw new Error('smtp closed');
        buf += dec.decode(value, { stream: true });
      }
      const line = buf.slice(0, i); buf = buf.slice(i + 2); lines.push(line);
      if (/^\d{3}( |$)/.test(line)) return { code: +line.slice(0, 3), text: lines.join('\n') };
    }
  };
  const cmd = async (c, ok) => {
    if (c !== null) await writer.write(enc.encode(c + '\r\n'));
    const r = await read();
    if (!ok.includes(r.code)) throw new Error('smtp ' + r.text);
    return r;
  };
  try {
    await cmd(null, [220]);
    await cmd('EHLO locked-room', [250]);
    await cmd('AUTH PLAIN ' + b64text('\0' + user + '\0' + pass), [235]);
    await cmd('MAIL FROM:<' + user + '>', [250]);
    await cmd('RCPT TO:<' + to + '>', [250, 251]);
    await cmd('DATA', [354]);
    const bd = 'lr' + rand(12).replace(/[^A-Za-z0-9]/g, '');
    const msg = [
      'From: Locked Room <' + user + '>', 'To: <' + to + '>',
      'Subject: =?UTF-8?B?' + b64text(subject) + '?=',
      'Date: ' + new Date().toUTCString(), 'Message-ID: <' + rand(12).replace(/[^A-Za-z0-9]/g, '') + '@locked-room>',
      'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="' + bd + '"', '',
      '--' + bd, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64text(text)),
      '--' + bd, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64text(html)),
      '--' + bd + '--', '',
    ].join('\r\n');
    await writer.write(enc.encode(msg + '\r\n.\r\n'));
    await cmd(null, [250]);
    try { await writer.write(enc.encode('QUIT\r\n')); } catch {}
    return true;
  } finally {
    try { await writer.close(); } catch {}
    try { await sock.close(); } catch {}
  }
}

// بيبعت الكود: لو GMAIL_USER + GMAIL_APP_PASSWORD موجودين بيبعت من جيميلك، وإلا بيستخدم Resend (RESEND_API_KEY)
const mailReady = (env) => !!((env.GMAIL_USER && env.GMAIL_APP_PASSWORD) || env.RESEND_API_KEY);
async function sendRecoveryMail(env, to, code, device, loc, connectFn) {
  const esc = (x) => String(x || '').replace(/[<>&"]/g, '');
  const subject = 'كود استعادة الحساب - غرفة مقفولة';
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:16px">
<h2>غرفة مقفولة 🔒</h2>
<p>كود استعادة الحساب:</p>
<p style="font-size:34px;letter-spacing:8px;font-weight:bold;direction:ltr;text-align:center;background:#f1f5f4;border-radius:12px;padding:12px">${code}</p>
<p>صالح 10 دقايق. بعد ما تكتبه هتقدر تدخل بالباسورد، أو تمسح بيانات الحساب وتعمل باسورد جديد.</p>
<p style="color:#666;font-size:13px">الجهاز اللي طلب الكود: ${esc(device)}${loc ? ' · ' + esc(loc) : ''}<br>لو مش أنت اللي طلبته، تجاهل الرسالة دي ولا تدّي الكود لأي حد.</p></div>`;
  const text = `كود استعادة الحساب: ${code}\nصالح 10 دقايق. الجهاز الطالب: ${device}${loc ? ' · ' + loc : ''}\nلو مش أنت، تجاهل الرسالة.`;
  try {
    if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) return await smtpSend(env, to, subject, text, html, connectFn);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'Locked Room <onboarding@resend.dev>', to: [to], subject, html, text }),
    });
    return r.ok;
  } catch { return false; }
}

// ---------- الراوتر ----------
// أول طلب بعد أي نشر بإصدار جديد بيبعت إشعار "فيه تحديث" لكل الحسابات اللي مفعّلة الإشعارات.
async function announceUpdate(env) {
  try {
    const reg = env.ROOM_PASSWORDS.get(env.ROOM_PASSWORDS.idFromName('global'));
    const subs = await reg.versionCheck(APP_VERSION);
    if (!subs || !subs.length) return;
    for (let i = 0; i < subs.length; i += 10) {
      await Promise.all(subs.slice(i, i + 10).map(async (sub) => {
        try { if ((await account(env, sub).pushUpdate(APP_VERSION)) === 'none') await reg.removePushAccount(sub); } catch (e) { console.log('update push error', String(e)); }
      }));
    }
  } catch (e) { console.log('announceUpdate failed', String(e)); }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (globalThis.__lrAnnounced !== APP_VERSION) { globalThis.__lrAnnounced = APP_VERSION; ctx.waitUntil(announceUpdate(env)); }
    // معرّف الجهاز: كوكي عشوائي طويل المدى بيتعمل أول زيارة
    let did = getCookie(req, url, 'did'), fresh = '';
    if (!validDid(did)) { did = rand(24); fresh = setCookie(url, 'did', did, DEV_COOKIE_AGE); }
    const res = await handle(req, url, env, did);
    if (!fresh || res.status === 101) return res;
    const h = new Headers(res.headers);
    h.append('Set-Cookie', fresh);
    return new Response(res.body, { status: res.status, headers: h });
  },
};

async function handle(req, url, env, did) {
  const path = url.pathname;
  const dead = setCookie(url, 'sid', '', 0);

  if (path === '/ws') {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    if (req.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403 });
    const s = await readSession(req, url, env);
    if (!s || !s.ok || !s.v || s.did !== did) return new Response('Unauthorized', { status: 401 }); // لازم يكون دخل بجوجل وكتب الباسورد من الجهاز ده
    const st = await account(env, s.sub).state(s.v, did);
    if (!st.ok || st.blocked) return new Response('Unauthorized', { status: 401 }); // الجلسة اتاخدت من جهاز تاني أو الجهاز محظور
    const r = url.searchParams.get('r') || '';
    if (!/^[0-9a-f]{64}$/.test(r)) return new Response('Bad request', { status: 400 });
    const roomKey = env.ROOM.idFromName(r).toString();
    if (!(await env.ROOM_PASSWORDS.get(env.ROOM_PASSWORDS.idFromName('global')).isActive(roomKey))) return new Response('Gone', { status: 410 });
    // بنبعت للغرفة هوية الجلسة عشان تقدر تقفل الاتصال فوراً لما الحساب يتاخد من جهاز تاني (وبنمسح أي هيدرز جاية من العميل)
    const h = new Headers(req.headers);
    h.set('X-Acc-Sub', s.sub); h.set('X-Acc-V', s.v); h.set('X-Acc-Did', did);
    return env.ROOM.get(env.ROOM.idFromName(r)).fetch(new Request(req, { headers: h })); // كل غرفة = Durable Object لوحدها
  }

  // ---------- تسجيل الدخول بجوجل من تطبيق الأندرويد (من غير متصفح) ----------
  if (path === '/auth/native/nonce' && req.method === 'GET') {
    if (!googleReady(env)) return json(url, { e: 'config' }, 503);
    const n = rand(24);
    return json(url, { nonce: n, t: await signSession(env, { n, exp: Date.now() + 5 * 60000 }) });
  }
  if (path === '/auth/native' && req.method === 'POST') {
    if (req.headers.get('Origin') !== url.origin) return json(url, { e: 'forbidden' }, 403);
    if (!googleReady(env)) return json(url, { e: 'config' }, 503);
    const b = await readBody(req);
    if (!b || typeof b.idToken !== 'string' || typeof b.t !== 'string') return json(url, { e: 'bad' }, 400);
    try {
      const [tb, ts] = b.t.split('.');
      if (!tb || !ts || !(await crypto.subtle.verify('HMAC', await hmacKey(env, 'verify'), unb64u(ts), enc.encode(tb)))) return json(url, { e: 'failed' }, 400);
      const nn = JSON.parse(new TextDecoder().decode(unb64u(tb)));
      if (!(nn.exp > Date.now())) return json(url, { e: 'failed' }, 400);
      // جوجل نفسها بتتحقق من توقيع التوكن
      const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(b.idToken));
      if (!r.ok) return json(url, { e: 'failed' }, 400);
      const p = await r.json();
      const okIss = p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com';
      if (!okIss || p.aud !== env.GOOGLE_CLIENT_ID || p.nonce !== nn.n || !(Number(p.exp) * 1000 > Date.now()) || typeof p.sub !== 'string') return json(url, { e: 'failed' }, 400);
      if (String(p.email_verified) !== 'true' || typeof p.email !== 'string') return json(url, { e: 'unverified' }, 400);
      const name = typeof p.name === 'string' ? p.name.slice(0, 60) : '';
      const access = await account(env, p.sub).beginLogin(did, deviceName(req), deviceLoc(req));
      if (access.blocked) return json(url, { e: 'blocked' }, 403);
      const sess = await sessionCookie(url, env, { sub: p.sub, email: p.email.slice(0, 120), name, did });
      return json(url, { ok: true }, 200, [sess]);
    } catch { return json(url, { e: 'failed' }, 400); }
  }

  if (path === '/auth/google' && req.method === 'GET') return googleStart(url, env);
  if (path === '/auth/callback' && req.method === 'GET') return googleCallback(req, url, env, did);

  if (path === '/api/push/key' && req.method === 'GET') return env.VAPID_PUBLIC_KEY ? json(url,{key:env.VAPID_PUBLIC_KEY}) : json(url,{e:'push_not_configured'},503);

  if (path === '/api/me' && req.method === 'GET') {
    const s = await readSession(req, url, env);
    if (!s) return json(url, { s: 'anon' });
    const who = { name: s.name, email: s.email };
    const st = await account(env, s.sub).state(s.ok ? s.v : '', did);
    if (st.blocked) return json(url, { s: 'blocked', ...who }, 200, [dead]);
    const mine = s.ok && s.v && s.did === did;
    if (mine && st.ok) {
      const acc = account(env, s.sub);
      await acc.touch(s.v, did);
      const notices = await acc.takeNotices(did);
      return json(url, { s: 'ok', requests: st.requests, notices, created: await acc.createdAt(), ...who });
    }
    if (!mine && st.has && st.requestStatus === 'pending') return json(url, { s: 'waiting', ...who });
    if (!mine && st.has && st.requestStatus === 'expired') return json(url, { s: 'request-expired', ...who });
    if (!mine && st.has && st.requestStatus === 'rejected') return json(url, { s: 'blocked', ...who }, 200, [dead]);
    if (mine && st.has && st.by) return json(url, { s: s.rs ? 'reset' : 'kicked', by: st.by, ...who });
    return json(url, { s: st.has ? 'unlock' : 'new', rec: !!st.rec, ...who });
  }

  if (path === '/api/sessions' && req.method === 'GET') {
    const s = await readSession(req, url, env);
    if (!s || !s.ok || s.did !== did) return json(url, { e: 'session' }, 401);
    const st = await account(env, s.sub).state(s.v, did);
    if (!st.ok || st.blocked) return json(url, { e: 'session' }, 401);
    return json(url, { sessions: await account(env, s.sub).sessionLog() });
  }

  const POSTS = ['/api/setup', '/api/recover/send', '/api/recover/verify', '/api/recover/wipe', '/api/login', '/api/reset', '/api/ack', '/api/notme', '/api/login-request/respond', '/api/change-password', '/api/room-password/check', '/api/room/status', '/api/room/delete', '/api/push/subscribe', '/api/push/unsubscribe', '/auth/logout'];
  if (req.method === 'POST' && POSTS.includes(path)) {
    if (req.headers.get('Origin') !== url.origin) return json(url, { e: 'forbidden' }, 403);
    if (path === '/auth/logout') {
      const s = await readSession(req, url, env);
      if (s && s.ok && s.did === did) await account(env, s.sub).endSession(s.v, did);
      return json(url, { ok: true }, 200, [dead]);
    }

    const s = await readSession(req, url, env);
    if (!s) return json(url, { e: 'session' }, 401);
    const acc = account(env, s.sub);
    const mine = s.ok && s.v && s.did === did;
    const st = await acc.state(mine ? s.v : '', did);
    if (st.blocked) return json(url, { e: 'blocked' }, 403, [dead]);

    // استعادة الحساب بكود على الإيميل (من شاشة "في انتظار الموافقة")
    if (path === '/api/recover/send' || path === '/api/recover/verify' || path === '/api/recover/wipe') {
      if (!st.has || (mine && st.ok)) return json(url, { e: 'state' }, 409);
      const dn = deviceName(req), loc = deviceLoc(req);
      if (path === '/api/recover/send') {
        if (!mailReady(env)) return json(url, { e: 'mail_not_configured' }, 503);
        const r = await acc.startRecovery(did);
        if (r.blocked) return json(url, { e: 'blocked' }, 403, [dead]);
        if (r.wait) return json(url, { e: 'wait', wait: r.wait }, 429);
        if (!r.ok) return json(url, { e: 'state' }, 409);
        if (!(await sendRecoveryMail(env, s.email, r.code, dn, loc))) return json(url, { e: 'mail_failed' }, 502);
        return json(url, { ok: true, mail: maskEmail(s.email) });
      }
      if (path === '/api/recover/wipe') {
        // مسح كل بيانات الحساب (الباسورد والأجهزة والسجل) وحظر الأجهزة التانية، بعد ما الإيميل اتأكد
        const r = await acc.wipeAccount(did);
        if (r.blocked) return json(url, { e: 'blocked' }, 403, [dead]);
        if (!r.ok) return json(url, { e: 'state' }, 409);
        return json(url, { ok: true });
      }
      const body = await readBody(req);
      const code = body && typeof body.code === 'string' ? body.code.trim() : '';
      if (!/^\d{6}$/.test(code)) return json(url, { e: 'invalid' }, 400);
      const r = await acc.confirmRecovery(did, code);
      if (r.blocked) return json(url, { e: 'blocked' }, 403, [dead]);
      if (r.locked) return json(url, { e: 'locked' }, 429);
      if (!r.ok) return json(url, { e: 'wrong', left: r.left || 0 }, 401);
      return json(url, { ok: true });
    }

    if (path === '/api/push/subscribe' || path === '/api/push/unsubscribe') {
      if (!mine || !st.ok) return json(url,{e:'session'},401);
      if (path === '/api/push/unsubscribe') { await acc.removePush(did); return json(url,{ok:true}); }
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return json(url,{e:'push_not_configured'},503);
      const body=await readBody(req), sub=body?.subscription;
      if (!sub || typeof sub.endpoint!=='string' || sub.endpoint.length>2048 || typeof sub.keys?.p256dh!=='string' || typeof sub.keys?.auth!=='string') return json(url,{e:'invalid'},400);
      let endpoint; try { endpoint=new URL(sub.endpoint); } catch { return json(url,{e:'invalid'},400); }
      if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(endpoint.hostname)) return json(url,{e:'invalid'},400);
      const pushHost=endpoint.hostname==='fcm.googleapis.com'||endpoint.hostname==='web.push.apple.com'||endpoint.hostname==='updates.push.services.mozilla.com'||endpoint.hostname.endsWith('.push.services.mozilla.com')||endpoint.hostname.endsWith('.notify.windows.com');
      if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || !pushHost || sub.keys.p256dh.length>256 || sub.keys.auth.length>128) return json(url,{e:'invalid'},400);
      await acc.savePush(did,{endpoint:endpoint.href,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth},origin:url.origin,language:typeof body.language==='string'&&/^[A-Za-z-]{2,32}$/.test(body.language)?body.language:'en'});
      try { await env.ROOM_PASSWORDS.get(env.ROOM_PASSWORDS.idFromName('global')).addPushAccount(s.sub); } catch {}
      return json(url,{ok:true});
    }
    if (path === '/api/room/status') {
      if (!mine || !st.ok) return json(url, { e: 'session' }, 401);
      const body = await readBody(req);
      if (!body || !Array.isArray(body.codes) || body.codes.length > 100 || body.codes.some((c) => typeof c !== 'string' || !/^[A-HJ-NP-Z2-9]{24}$/.test(c))) return json(url, { e: 'invalid' }, 400);
      const registry = env.ROOM_PASSWORDS.get(env.ROOM_PASSWORDS.idFromName('global'));
      const deleted = [];
      for (const code of body.codes) if (!(await registry.isActive(await roomObjectName(env, code)))) deleted.push(code);
      return json(url, { deleted });
    }
    if (path === '/api/room/delete') {
      if (!mine || !st.ok) return json(url, { e: 'session' }, 401);
      const body = await readBody(req);
      if (!body || typeof body.code !== 'string' || !/^[A-HJ-NP-Z2-9]{24}$/.test(body.code) || typeof body.pw !== 'string') return json(url, { e: 'invalid' }, 400);
      if (await acc.matchesPassword(s.v, did, body.pw)) return json(url, { e: 'account_password' }, 409);
      const fp = await roomPasswordFingerprint(env, body.pw);
      const roomId = await roomObjectName(env, body.code);
      const registry = env.ROOM_PASSWORDS.get(env.ROOM_PASSWORDS.idFromName('global'));
      if (!(await registry.ownsRoom(fp, roomId))) return json(url, { e: 'deleted' }, 410);
      await env.ROOM.get(env.ROOM.idFromName(await roomHexFromCode(body.code))).deleteRoom();
      if (!(await registry.deleteRoom(fp, roomId))) return json(url, { e: 'state' }, 409);
      return json(url, { ok: true });
    }
    if (path === '/api/room-password/check') {
      if (!mine || !st.ok) return json(url, { e: 'session' }, 401);
      const body = await readBody(req);
      if (!body || typeof body.pw !== 'string' || body.pw.length < 6 || body.pw.length > PW_MAX || typeof body.code !== 'string' || !/^[A-HJ-NP-Z2-9]{24}$/.test(body.code)) return json(url, { e: 'invalid' }, 400);
      if (await acc.matchesPassword(s.v, did, body.pw)) return json(url, { e: 'account_password' }, 409);
      const fp = await roomPasswordFingerprint(env, body.pw);
      const roomId = await roomObjectName(env, body.code);
      const unique = await env.ROOM_PASSWORDS.get(env.ROOM_PASSWORDS.idFromName('global')).reserve(fp, roomId);
      if (unique === 'deleted') return json(url, { e: 'deleted' }, 410);
      if (unique === 'wrong') return json(url, { e: 'room_password' }, 401);
      if (unique === 'duplicate') return json(url, { e: 'duplicate_password' }, 409);
      return json(url, { ok: true });
    }
    if (path === '/api/change-password') {
      if (!mine || !st.ok) return json(url, { e: 'session' }, 401);
      const body = await readBody(req);
      if (!body || typeof body.current !== 'string' || typeof body.next !== 'string' || body.next.length < PW_MIN || body.next.length > PW_MAX) return json(url, { e: 'invalid' }, 400);
      if (await env.ROOM_PASSWORDS.get(env.ROOM_PASSWORDS.idFromName('global')).isUsed(await roomPasswordFingerprint(env, body.next))) return json(url, { e: 'duplicate_room' }, 409);
      const changed = await acc.changePassword(s.v, did, body.current, body.next);
      if (!changed) return json(url, { e: 'wrong' }, 401);
      return json(url, { ok: true });
    }
    // قرار طلب تسجيل جهاز جديد: لا يقبل إلا من الجلسة النشطة الحالية.
    if (path === '/api/login-request/respond') {
      if (!mine || !st.ok) return json(url, { e: 'session' }, 401);
      const body = await readBody(req);
      if (!body || !validDid(body.did) || body.did === did || typeof body.allow !== 'boolean') return json(url, { e: 'bad_request' }, 400);
      const result = await acc.respondLogin(s.v, did, body.did, body.allow);
      if (!result.ok) return json(url, { e: 'state' }, 409);
      return json(url, { ok: true });
    }

    // "كان أنا" / "مش أنا" من شاشة التنبيه (لازم تكون فعلاً اتاخدت منك الجلسة)
    if (path === '/api/ack' || path === '/api/notme') {
      if (!mine) return json(url, { e: 'session' }, 401);
      if (st.ok) return json(url, { ok: true });
      if (!st.by) return json(url, { e: 'session' }, 401);
      const base = { sub: s.sub, email: s.email, name: s.name, did };
      // كان أنا: يرجع لشاشة الباسورد | مش أنا: الجلسة بتفضل "مستنية باسورد جديد" حتى لو قفل وفتح تاني
      return json(url, { ok: true }, 200, [await sessionCookie(url, env, base, path === '/api/notme' ? { full: true, v: s.v, rs: true } : {})]);
    }

    if (path === '/api/login' && st.has && !mine && st.by && st.requestStatus !== 'approved') {
      return json(url, { e: 'approval' }, 403);
    }

    if (mine && st.ok && path !== '/api/reset') return json(url, { ok: true }); // داخل فعلاً

    const body = await readBody(req);
    const pw = body && typeof body.pw === 'string' ? body.pw : '';
    if (pw.length < PW_MIN || pw.length > PW_MAX) return json(url, { e: 'short' }, 400);
    const dn = deviceName(req), loc = deviceLoc(req);
    const base = { sub: s.sub, email: s.email, name: s.name, did };

    if (path === '/api/setup') {
      if (await env.ROOM_PASSWORDS.get(env.ROOM_PASSWORDS.idFromName('global')).isUsed(await roomPasswordFingerprint(env, pw))) return json(url, { e: 'duplicate_room' }, 409);
      const r = await acc.create(s.email, pw, did, dn, loc);
      if (!r) return json(url, { e: 'exists' }, 409); // عنده حساب بالفعل، لازم يكتب الباسورد القديم
      return json(url, { ok: true }, 200, [await sessionCookie(url, env, base, { full: true, v: r.v })]);
    }

    if (path === '/api/reset') {
      // باسورد جديد: بس لو الجلسة اتاخدت منك واخترت "مش أنا". بيحظر الجهاز اللي أخدها نهائياً
      if (!mine || !s.rs) return json(url, { e: 'state' }, 409);
      const r = await acc.reset(pw, s.v, did, dn, loc);
      if (r.blocked) return json(url, { e: 'blocked' }, 403, [dead]);
      if (!r.ok) return json(url, { e: 'state' }, 409);
      return json(url, { ok: true }, 200, [await sessionCookie(url, env, base, { full: true, v: r.v })]);
    }

    const r = await acc.verify(pw, did, dn, loc);
    if (r.blocked) return json(url, { e: 'blocked' }, 403, [dead]);
    if (r.ok) return json(url, { ok: true }, 200, [await sessionCookie(url, env, base, { full: true, v: r.v })]);
    if (r.wait) return json(url, { e: 'locked', wait: r.wait }, 429);
    return json(url, { e: 'wrong', left: r.left }, 401);
  }

  if (req.method !== 'GET' || !PAGES.has(path)) return new Response('Not found', { status: 404 });
  const res = await env.ASSETS.fetch(new Request(new URL(path, url)));
  const headers = secHeaders(url, res.headers.get('Content-Type') || 'text/plain');
  if (path === '/app.js' || path === '/style.css' || path === '/gallery-editor.js') headers['Cache-Control'] = 'no-cache';
  else if (path !== '/' && path !== '/sw.js') headers['Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=86400';
  return new Response(res.body, { status: res.status, headers });
}

// ---------- الحساب: كل مستخدم Durable Object لوحده (هاش الباسورد + الجهاز الحالي + الأجهزة المحظورة) ----------
// cur = الجهاز اللي معاه الحساب دلوقتي { v: رقم الجلسة, d: معرّف الجهاز, n: اسمه, l: مكانه, t: وقت الدخول }
// blocked = [{ d, n, t }] أجهزة ممنوعة نهائياً من الحساب ده
async function claim(storage, did, n, l) {
  const now = Date.now(), v = rand(18), id = rand(12);
  const cur = await storage.get('cur');
  const sessions = await storage.get('sessions') || [];
  if (cur?.d && cur.d !== did) await storage.delete('push:' + cur.d);
  if (cur && cur.logId) {
    const previous = sessions.find((x) => x.id === cur.logId);
    if (previous && !previous.ended) { previous.ended = cur.lastSeen || now; previous.reason = 'replaced'; }
  }
  sessions.push({ id, d: did, n, l, started: now, lastSeen: now, ended: 0, reason: '' });
  const notices = await storage.get('notices') || [];
  for (const notice of notices) notice.did = did;
  await storage.put({ sessions: sessions.slice(-100), cur: { v, d: did, n, l, t: now, logId: id, lastSeen: now }, notices });
  return v;
}

export class Account extends DurableObject {
  async hash(pw, salt, iter) {
    const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256));
  }

  async has() { return !!(await this.ctx.storage.get('pw')); }

  async touch(v, did) {
    const cur = await this.ctx.storage.get('cur');
    if (!cur || cur.v !== v || cur.d !== did || Date.now() - (cur.lastSeen || 0) < 10000) return;
    const now = Date.now(), sessions = await this.ctx.storage.get('sessions') || [];
    cur.lastSeen = now;
    const record = sessions.find((x) => x.id === cur.logId);
    if (record && !record.ended) record.lastSeen = now;
    await this.ctx.storage.put({ cur, sessions });
  }

  async isOnline(did) {
    const cur = await this.ctx.storage.get('cur');
    return !!(cur && cur.d === did && Date.now() - (cur.lastSeen || 0) < 35000);
  }

  async endSession(v, did) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const cur = await this.ctx.storage.get('cur');
      if (!cur || cur.v !== v || cur.d !== did) return false;
      const now = Date.now(), sessions = await this.ctx.storage.get('sessions') || [];
      const record = sessions.find((x) => x.id === cur.logId);
      if (record && !record.ended) { record.lastSeen = now; record.ended = now; record.reason = 'logout'; }
      await this.ctx.storage.put('sessions', sessions);
      await this.ctx.storage.delete('cur');
      await this.ctx.storage.delete('push:' + did);
      return true;
    });
  }

  async sessionLog() {
    const [sessions, cur] = await Promise.all([this.ctx.storage.get('sessions'), this.ctx.storage.get('cur')]);
    return (sessions || []).slice().reverse().map((x) => ({
      device: x.n || 'Unknown device', location: x.l || '', started: x.started,
      lastSeen: x.lastSeen, ended: x.ended || 0, reason: x.reason || '', active: !!(cur && cur.logId === x.id),
      duration: Math.max(0, ((x.ended || (cur && cur.logId === x.id ? Date.now() : x.lastSeen) || x.started) - x.started) / 1000),
    }));
  }

  async savePush(did, subscription) { await this.ctx.storage.put('push:' + did, subscription); return true; }
  async removePush(did) { await this.ctx.storage.delete('push:' + did); return true; }
  async queueNotice(did, language) {
    await this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now(), notices = (await this.ctx.storage.get('notices') || []).filter((x) => x.created > now - 86400000);
      const cur = await this.ctx.storage.get('cur'), targetDid = cur && cur.d || did, ar = /^ar/i.test(language || '');
      notices.push({id:rand(10),did:targetDid,created:now,title:ar?'غرفة مقفولة':'Locked Room',body:ar?'هناك من يطرق الباب':'Someone is knocking at the door'});
      await this.ctx.storage.put('notices',notices.slice(-100));
    });
    return true;
  }

  // بيبعت إشعار لكل أجهزة الحساب المشتركة (الجهاز الحالي الأول). بيرجّع 'ok' | 'none' | 'fail'
  async sendPushAll(build, fallbackLang) {
    if (!this.env.VAPID_PUBLIC_KEY || !this.env.VAPID_PRIVATE_KEY) return 'none';
    const cur = await this.ctx.storage.get('cur'), first = cur && cur.d ? 'push:' + cur.d : '';
    const entries = [...(await this.ctx.storage.list({ prefix: 'push:' })).entries()].sort((x, y) => (y[0] === first) - (x[0] === first));
    if (!entries.length) return 'none';
    let ok = false;
    for (const [key, sub] of entries) {
      try {
        const r = await sendWebPush(this.env, sub, build(/^ar/i.test(sub.language || fallbackLang || '')));
        if (r.status === 404 || r.status === 410) await this.ctx.storage.delete(key);
        else if (r.ok) ok = true;
        else console.log('push rejected', r.status, (await r.text().catch(() => '')).slice(0, 200));
      } catch (e) { console.log('push error', String(e)); }
    }
    return ok ? 'ok' : 'fail';
  }

  async pushKnock(did, language) { return (await this.sendPushAll(knockPayload, language)) === 'ok'; }
  async pushUpdate(ver) { return this.sendPushAll((ar) => updatePayload(ar, ver)); }

  async takeNotices(did) {
    const now = Date.now();
    return this.ctx.blockConcurrencyWhile(async () => {
      const notices = (await this.ctx.storage.get('notices') || []).filter((x) => x.created > now - 86400000);
      const ready = notices.filter((x) => x.did === did);
      const remaining = notices.filter((x) => x.did !== did);
      if (remaining.length !== notices.length) await this.ctx.storage.put('notices', remaining);
      return ready;
    });
  }

  // حالة الحساب والجهاز. طلبات الموافقة لا تكشف تفاصيلها إلا للجلسة النشطة.
  async state(v, did) {
    const m = await this.ctx.storage.get(['pw', 'cur', 'blocked', 'requests', 'recOk']);
    const rec = m.get('pw'), cur = m.get('cur'), bl = m.get('blocked') || [];
    const requests = m.get('requests') || [];
    const now = Date.now();
    const recOk = m.get('recOk');
    const current = !!(rec && cur && v && cur.v === v && cur.d === did);
    const ownRequest = requests.find((r) => r.d === did);
    let requestStatus = ownRequest && ownRequest.status;
    if (requestStatus === 'pending' && ownRequest.expires <= now) {
      ownRequest.status = 'expired';
      requestStatus = 'expired';

    }
    return {
      has: !!rec,
      blocked: bl.some((b) => b.d === did),
      ok: current,
      requestStatus: requestStatus || '',
      rec: !!(recOk && recOk.d === did && recOk.exp > now),
      requests: current ? requests.filter((r) => r.status === 'pending' && r.expires > now).map((r) => ({ did: r.d, n: r.n, t: r.t, l: r.l })) : [],
      by: cur && cur.d !== did ? { n: cur.n, t: cur.t, l: cur.l } : null,
    };
  }

  async beginLogin(did, n, l) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.ctx.storage.get(['pw', 'cur', 'blocked', 'requests']);
      const rec = m.get('pw'), cur = m.get('cur'), blocked = m.get('blocked') || [];
      let requests = m.get('requests') || [];
      const now = Date.now();
      if (blocked.some((b) => b.d === did)) return { blocked: true };
      requests = requests.filter((r) => r.expires > now);
      const existing = requests.find((r) => r.d === did);
      if (existing) return { required: existing.status === 'pending', status: existing.status };
      if (!rec || !cur || cur.d === did) {
  
        return { required: false, status: 'approved' };
      }
      requests.push({ d: did, n, l, t: now, expires: now + PENDING_MIN * 60000, status: 'pending' });
      await this.ctx.storage.put('requests', requests.slice(-50));
      return { required: true, status: 'pending' };
    });
  }

  async respondLogin(v, ownerDid, targetDid, allow) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.ctx.storage.get(['cur', 'blocked', 'requests']);
      const cur = m.get('cur'), requests = m.get('requests') || [];
      const now = Date.now();
      if (!cur || cur.v !== v || cur.d !== ownerDid) return { ok: false };
      const request = requests.find((r) => r.d === targetDid && r.status === 'pending' && r.expires > now);
      if (!request) return { ok: false };
      if (allow) request.status = 'approved';
      else {
        request.status = 'rejected';
        const blocked = m.get('blocked') || [];
        if (!blocked.some((b) => b.d === targetDid)) {
          blocked.push({ d: targetDid, n: request.n, t: now });
          await this.ctx.storage.put('blocked', blocked.slice(-MAX_BLOCKED));
        }
      }
      await this.ctx.storage.put('requests', requests);
      return { ok: true };
    });
  }

  async matchesPassword(v, did, candidate) {
    const m = await this.ctx.storage.get(['pw', 'cur']);
    const rec = m.get('pw'), cur = m.get('cur');
    if (!rec || !cur || cur.v !== v || cur.d !== did) return false;
    return same(await this.hash(candidate, unb64u(rec.s), rec.i), unb64u(rec.h));
  }
  async changePassword(v, did, currentPw, nextPw) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.ctx.storage.get(['pw', 'cur']);
      const rec = m.get('pw'), cur = m.get('cur');
      if (!rec || !cur || cur.v !== v || cur.d !== did) return false;
      const oldHash = await this.hash(currentPw, unb64u(rec.s), rec.i);
      if (!same(oldHash, unb64u(rec.h))) return false;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const h = await this.hash(nextPw, salt, PBKDF2_ITER);
      await this.ctx.storage.put('pw', { s: b64u(salt), h: b64u(h), i: PBKDF2_ITER });
      return true;
    });
  }
  async codeHash(code, salt, did) {
    return b64u(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${did}:${code}:${this.env.SESSION_SECRET}`)));
  }

  // يطلب كود استعادة: كود واحد كل دقيقة، وأقصى 5 في الساعة
  async startRecovery(did) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.ctx.storage.get(['pw', 'blocked', 'recLog']);
      if (!m.get('pw')) return { ok: false, state: true };
      if ((m.get('blocked') || []).some((b) => b.d === did)) return { ok: false, blocked: true };
      const now = Date.now();
      const log = (m.get('recLog') || []).filter((t) => t > now - 3600000);
      const last = log[log.length - 1] || 0;
      if (now - last < 60000) return { ok: false, wait: Math.ceil((60000 - (now - last)) / 1000) };
      if (log.length >= 5) return { ok: false, wait: Math.ceil((log[0] + 3600000 - now) / 1000) };
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
      const salt = b64u(crypto.getRandomValues(new Uint8Array(12)));
      log.push(now);
      await this.ctx.storage.put({ rec: { d: did, s: salt, h: await this.codeHash(code, salt, did), exp: now + 10 * 60000, tries: 0 }, recLog: log });
      return { ok: true, code };
    });
  }

  // الكود صح: الجهاز ده بيتعتبر موافَق عليه (من غير ما يحتاج موافقة الجهاز القديم)، وبيروح لشاشة الباسورد
  async confirmRecovery(did, code) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.ctx.storage.get(['rec', 'blocked', 'requests']);
      const rec = m.get('rec'), now = Date.now();
      if ((m.get('blocked') || []).some((b) => b.d === did)) return { blocked: true };
      if (!rec || rec.d !== did || rec.exp <= now) return { ok: false };
      if (rec.tries >= 5) { await this.ctx.storage.delete('rec'); return { locked: true }; }
      if (!same(unb64u(await this.codeHash(code, rec.s, did)), unb64u(rec.h))) {
        rec.tries++;
        if (rec.tries >= 5) { await this.ctx.storage.delete('rec'); return { locked: true }; }
        await this.ctx.storage.put('rec', rec);
        return { ok: false, left: 5 - rec.tries };
      }
      const requests = (m.get('requests') || []).filter((r) => r.d !== did && r.expires > now);
      requests.push({ d: did, n: 'recovery', l: '', t: now, expires: now + 30 * 60000, status: 'approved' });
      await this.ctx.storage.put({ requests: requests.slice(-50), recOk: { d: did, exp: now + 30 * 60000 } });
      await this.ctx.storage.delete('rec');
      return { ok: true };
    });
  }

  // مسح كل بيانات الحساب بعد تأكيد الإيميل. الأجهزة التانية بتتحظر عشان متقدرش تاخد الحساب الجديد
  async wipeAccount(did) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.ctx.storage.get(['recOk', 'blocked', 'cur', 'requests', 'pw']);
      const ok = m.get('recOk'), now = Date.now();
      let bl = m.get('blocked') || [];
      if (bl.some((b) => b.d === did)) return { blocked: true };
      if (!m.get('pw') || !ok || ok.d !== did || ok.exp <= now) return { ok: false };
      const cur = m.get('cur'), others = new Map();
      if (cur && cur.d && cur.d !== did) others.set(cur.d, cur.n);
      for (const r of (m.get('requests') || [])) if (r.d !== did) others.set(r.d, r.n);
      for (const [d, dn] of others) { bl = bl.filter((b) => b.d !== d); bl.push({ d, n: dn, t: now }); }
      const all = await this.ctx.storage.list();
      const keep = new Set(['recLog']);
      const gone = [...all.keys()].filter((k) => k !== 'blocked' && !keep.has(k));
      for (let i = 0; i < gone.length; i += 120) await this.ctx.storage.delete(gone.slice(i, i + 120));
      await this.ctx.storage.put('blocked', bl.slice(-MAX_BLOCKED));
      return { ok: true };
    });
  }

  async createdAt() { return await this.ctx.storage.get('created') || 0; }

  async create(email, pw, did, n, l) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get('pw')) return null;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const h = await this.hash(pw, salt, PBKDF2_ITER);
      await this.ctx.storage.put({ pw: { s: b64u(salt), h: b64u(h), i: PBKDF2_ITER }, email, created: Date.now() });
      return { v: await claim(this.ctx.storage, did, n, l) };
    });
  }

  // 5 غلطات = قفل 15 دقيقة. blockConcurrencyWhile عشان محاولات متوازية متتخطاش العداد
  async verify(pw, did, n, l) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.ctx.storage.get(['pw', 'blocked', 'fail', 'requests']);
      const rec = m.get('pw');
      if (!rec) return { ok: false, left: 0 };
      if ((m.get('blocked') || []).some((b) => b.d === did)) return { ok: false, blocked: true };
      const now = Date.now();
      const f = m.get('fail') || { n: 0, until: 0 };
      if (f.until > now) return { ok: false, wait: Math.ceil((f.until - now) / 1000) };
      const h = await this.hash(pw, unb64u(rec.s), rec.i);
      if (same(h, unb64u(rec.h))) {
        await this.ctx.storage.delete('fail');
        const requests = m.get('requests') || [];
        await this.ctx.storage.put('requests', requests.filter((r) => r.d !== did));
        return { ok: true, v: await claim(this.ctx.storage, did, n, l) }; // بعد الموافقة وكلمة المرور، الجهاز الجديد يأخذ الحساب.
      }
      f.n++;
      if (f.n >= 5) { f.until = now + 15 * 60000; f.n = 0; }
      await this.ctx.storage.put('fail', f);
      return f.until > now ? { ok: false, wait: 900 } : { ok: false, left: 5 - f.n };
    });
  }

  // باسورد جديد بعد "مش أنا": بيغيّر الباسورد، بيحظر الجهاز اللي أخد الحساب، وبياخد الحساب لجهازك
  async reset(pw, v, did, n, l) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.ctx.storage.get(['pw', 'cur', 'blocked']);
      const rec = m.get('pw'), cur = m.get('cur');
      let bl = m.get('blocked') || [];
      if (bl.some((b) => b.d === did)) return { blocked: true };
      // مسموح بس لو جلستك فعلاً اتاخدت منك بجهاز تاني
      if (!rec || !cur || !v || cur.v === v || cur.d === did) return { state: true };
      bl = bl.filter((b) => b.d !== cur.d);
      bl.push({ d: cur.d, n: cur.n, t: Date.now() });
      bl = bl.slice(-MAX_BLOCKED);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const h = await this.hash(pw, salt, PBKDF2_ITER);
      await this.ctx.storage.put({ pw: { s: b64u(salt), h: b64u(h), i: PBKDF2_ITER }, blocked: bl, pwChanged: Date.now() });
      await this.ctx.storage.delete('fail');
      return { ok: true, v: await claim(this.ctx.storage, did, n, l) };
    });
  }
}

// ---------- الغرفة: ترحّل الرسائل المشفرة وتخزّنها مؤقتاً حتى حذف الغرفة ----------
export class Room extends DurableObject {
  async alive(ws, a) {
    const now = Date.now();
    if (a.ok && now < a.until) return true;
    let st;
    try { st = await this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(a.sub)).state(a.v, a.d); } catch { return true; }
    if (!st.ok || st.blocked) {
      try { ws.send(JSON.stringify({ t: 'kicked' })); ws.close(4001, 'kicked'); } catch {}
      return false;
    }
    a.ok = true; a.until = now + 3000;
    ws.serializeAttachment(a);
    return true;
  }

  async fetch(req) {
    const sub = req.headers.get('X-Acc-Sub') || '', v = req.headers.get('X-Acc-V') || '', d = req.headers.get('X-Acc-Did') || '';
    if (!sub || !v || !d) return new Response('Unauthorized', { status: 401 });
    if (await this.ctx.storage.get('deleted')) return new Response('Gone', { status: 410 });
    const { 0: client, 1: server } = new WebSocketPair();
    if (this.ctx.getWebSockets().length >= 2) {
      server.accept(); server.send(JSON.stringify({ t: 'full' })); server.close(1008, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    const language = req.headers.get('Accept-Language') || 'en';
    server.serializeAttachment({ c: 0, reset: Date.now() + 10000, sub, v, d, language, ok: true, until: Date.now() + 3000 });
    const members = await this.ctx.storage.get('members') || {};
    members[d] = { sub, d, language, t: Date.now() };
    await this.ctx.storage.put('members', members);
    const all = this.ctx.getWebSockets();
    server.send(JSON.stringify({ t: 'joined', n: all.length }));
    const count = await this.ctx.storage.get('historyCount') || 0;
    for (let i = 0; i < count; i++) {
      const item = await this.ctx.storage.get('history:' + i);
      if (!item) continue;
      let ct = item.ct || '';
      if (item.parts) {
        ct = '';
        for (let part = 0; part < item.parts; part++) ct += await this.ctx.storage.get('history:' + i + ':' + part) || '';
      }
      const state = item.read ? 'read' : item.delivered ? 'delivered' : 'sent';
      server.send(JSON.stringify({ t: 'msg', iv: item.iv, ct, sentAt: item.sentAt, history: true, once: !!item.once, mid: item.mid || '', fromSelf: item.fromDid === d, receipt: item.fromDid === d ? state : 'sent' }));
      if (item.mid && item.fromDid !== d && !item.delivered) {
        const updated = await this.setReceipt(item.mid, 'delivered');
        if (updated) this.notifyReceipt(updated, item.mid, 'delivered');
      }
    }
    const profiles = await this.ctx.storage.get('profiles') || {};
    for (const [did, profile] of Object.entries(profiles)) if (did !== d && profile && profile.iv && profile.ct) server.send(JSON.stringify({ t: 'profile', iv: profile.iv, ct: profile.ct }));
    for (const peer of all) if (peer !== server) peer.send(JSON.stringify({ t: 'peer', n: all.length }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return ws.close(1009, 'bad');
    const a = ws.deserializeAttachment() || { c: 0, reset: 0 };
    const now = Date.now();
    if (now > a.reset) { a.c = 0; a.reset = now + 10000; }
    if (++a.c > 40) return ws.close(1008, 'flood');
    ws.serializeAttachment(a);
    if (!(await this.alive(ws, a))) return;
    let m;
    try { m = JSON.parse(data); } catch { return ws.close(1003, 'bad'); }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'profile') {
      if (typeof m.iv !== 'string' || m.iv.length > 64 || typeof m.ct !== 'string' || m.ct.length > 120000) return;
      const profiles = await this.ctx.storage.get('profiles') || {};
      profiles[a.d] = { iv: m.iv, ct: m.ct }; await this.ctx.storage.put('profiles', profiles);
      const out = JSON.stringify({ t: 'profile', iv: m.iv, ct: m.ct });
      for (const peer of this.ctx.getWebSockets()) { if (peer === ws) continue; const pa = peer.deserializeAttachment(); if (pa && pa.sub && !(await this.alive(peer, pa))) continue; try { peer.send(out); } catch {} }
      return;
    }
    if (m.t === 'sync') { await this.syncReceipts(a.d); return; }
    if (m.t === 'deleteMessage') {
      if (typeof m.mid !== 'string' || !/^[a-f0-9]{32}$/.test(m.mid)) return;
      const item = await this.deleteMessage(m.mid);
      if (!item) { try { ws.send(JSON.stringify({ t: 'messageDeleteFailed', mid: m.mid })); } catch {} return; }
      const out = JSON.stringify({ t: 'messageDeleted', mid: m.mid });
      for (const peer of this.ctx.getWebSockets()) { try { peer.send(out); } catch {} }
      return;
    }
    if (m.t === 'deleteMessage') {
      if (typeof m.mid !== 'string' || !/^[a-f0-9]{32}$/.test(m.mid)) return;
      const item = await this.deleteMessage(m.mid);
      if (!item) { try { ws.send(JSON.stringify({ t: 'messageDeleteFailed', mid: m.mid })); } catch {} return; }
      const out = JSON.stringify({ t: 'messageDeleted', mid: m.mid });
      for (const peer of this.ctx.getWebSockets()) { try { peer.send(out); } catch {} }
      return;
    }
    if (m.t === 'onceOpen') {
      if (typeof m.mid !== 'string' || !/^[a-f0-9]{32}$/.test(m.mid)) return;
      const item = await this.deleteOnce(m.mid, a.d);
      if (!item) { try { ws.send(JSON.stringify({ t: 'onceUnavailable', mid: m.mid })); } catch {} return; }
      try { ws.send(JSON.stringify({ t: 'onceReady', mid: m.mid })); } catch {}
      for (const peer of this.ctx.getWebSockets()) {
        const pa = peer.deserializeAttachment(); if (!pa) continue;
        try {
          if (pa.d === item.fromDid) peer.send(JSON.stringify({ t: 'receipt', mid: m.mid, state: 'read' }));
          peer.send(JSON.stringify({ t: 'onceDeleted', mid: m.mid }));
        } catch {}
      }
      return;
    }
    if (m.t === 'knock') {
      if (now - (a.lastKnock || 0) < 350) return;
      a.lastKnock = now; ws.serializeAttachment(a);
      const members = await this.ctx.storage.get('members') || {};
      let delivered = false;
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === ws) continue;
        const pa = peer.deserializeAttachment();
        if (!pa || pa.d === a.d || (pa.sub && pa.sub === a.sub)) continue;
        if (pa.sub && !(await this.alive(peer, pa))) continue;
        try { peer.send(JSON.stringify({ t: 'knock', id: rand(10) })); delivered = true; } catch {}
      }
      const recipient = peerOf(members, a);
      if (recipient) {
        try { const acc=this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(recipient.sub)); const pushed=await acc.pushKnock(recipient.d,recipient.language); if(!pushed&&!delivered)await acc.queueNotice(recipient.d,recipient.language); } catch {}
      }
      return;
    }
    if (m.t === 'read') {
      if (typeof m.mid !== 'string' || !/^[a-f0-9]{32}$/.test(m.mid)) return;
      const item = await this.setReceipt(m.mid, 'read', a.d);
      if (item) this.notifyReceipt(item, m.mid, 'read');
      return;
    }
    if (m.t !== 'msg' || typeof m.iv !== 'string' || m.iv.length > 64 || typeof m.ct !== 'string') return;
    if (await this.ctx.storage.get('deleted')) {
      try { ws.send(JSON.stringify({ t: 'deleted' })); ws.close(4002, 'deleted'); } catch {}
      return;
    }
    if (m.p === 1) {
      const stored = await this.ctx.blockConcurrencyWhile(async () => {
        if (await this.ctx.storage.get('deleted')) return false;
        const count = await this.ctx.storage.get('historyCount') || 0;
        const mid = typeof m.mid === 'string' && /^[a-f0-9]{32}$/.test(m.mid) ? m.mid : hexBytes(crypto.getRandomValues(new Uint8Array(16)));
        const parts = Math.ceil(m.ct.length / 100000), values = { ['history:' + count]: { iv: m.iv, sentAt: Date.now(), parts, mid, fromDid: a.d, delivered: false, read: false, once: m.once === true }, ['mid:' + mid]: count };
        for (let part = 0; part < parts; part++) values['history:' + count + ':' + part] = m.ct.slice(part * 100000, (part + 1) * 100000);
        await this.ctx.storage.put(values);
        await this.ctx.storage.put('historyCount', count + 1);
        return true;
      });
      if (!stored) return;
    }
    if (await this.ctx.storage.get('deleted')) return;
    const mid = typeof m.mid === 'string' && /^[a-f0-9]{32}$/.test(m.mid) ? m.mid : '';
    const out = JSON.stringify({ t: 'msg', iv: m.iv, ct: m.ct, sentAt: Date.now(), mid, fromSelf: false });
    let delivered = false;
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue;
      const pa = peer.deserializeAttachment();
      if (pa && (pa.d === a.d || (pa.sub && !(await this.alive(peer, pa))))) continue;
      try { peer.send(out); delivered = true; } catch { continue; }
      if (mid) { const item = await this.setReceipt(mid, 'delivered'); if (item) this.notifyReceipt(item, mid, 'delivered'); }
    }
    if (mid && !delivered) {
      const members = await this.ctx.storage.get('members') || {};
      const recipient = peerOf(members, a);
      if (recipient) {
        try {
          const online = await this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(recipient.sub)).isOnline(recipient.d);
          if (online) { const item = await this.setReceipt(mid, 'delivered'); if (item) this.notifyReceipt(item, mid, 'delivered'); }
        } catch {}
      }
    }
  }

  async syncReceipts(senderDid) {
    const members = await this.ctx.storage.get('members') || {};
    const recipient = peerOf(members, members[senderDid] || {});
    if (!recipient) return;
    try { if (!(await this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(recipient.sub)).isOnline(recipient.d))) return; } catch { return; }
    const count = await this.ctx.storage.get('historyCount') || 0;
    for (let i = 0; i < count; i++) {
      const item = await this.ctx.storage.get('history:' + i);
      if (item && item.fromDid === senderDid && item.mid && !item.delivered) {
        const updated = await this.setReceipt(item.mid, 'delivered');
        if (updated) this.notifyReceipt(updated, item.mid, 'delivered');
      }
    }
  }

  async deleteMessage(mid) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const index = await this.ctx.storage.get('mid:' + mid);
      if (!Number.isInteger(index)) return null;
      const item = await this.ctx.storage.get('history:' + index);
      if (!item) return null;
      await this.ctx.storage.delete('history:' + index);
      await this.ctx.storage.delete('mid:' + mid);
      for (let part = 0; part < (item.parts || 0); part++) await this.ctx.storage.delete('history:' + index + ':' + part);
      return item;
    });
  }

  async deleteMessage(mid) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const index = await this.ctx.storage.get('mid:' + mid);
      if (!Number.isInteger(index)) return null;
      const item = await this.ctx.storage.get('history:' + index);
      if (!item) return null;
      await this.ctx.storage.delete('history:' + index);
      await this.ctx.storage.delete('mid:' + mid);
      for (let part = 0; part < (item.parts || 0); part++) await this.ctx.storage.delete('history:' + index + ':' + part);
      return item;
    });
  }

  async deleteOnce(mid, readerDid) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const index = await this.ctx.storage.get('mid:' + mid);
      if (!Number.isInteger(index)) return null;
      const item = await this.ctx.storage.get('history:' + index);
      if (!item || item.once !== true || !readerDid || readerDid === item.fromDid) return null;
      await this.ctx.storage.delete('history:' + index);
      await this.ctx.storage.delete('mid:' + mid);
      for (let part = 0; part < (item.parts || 0); part++) await this.ctx.storage.delete('history:' + index + ':' + part);
      return item;
    });
  }

  async setReceipt(mid, state, readerDid = '') {
    return this.ctx.blockConcurrencyWhile(async () => {
      const index = await this.ctx.storage.get('mid:' + mid);
      if (!Number.isInteger(index)) return null;
      const item = await this.ctx.storage.get('history:' + index);
      if (!item || (state === 'read' && (!readerDid || readerDid === item.fromDid))) return null;
      item.delivered = true;
      if (state === 'read') item.read = true;
      await this.ctx.storage.put('history:' + index, item);
      return item;
    });
  }

  notifyReceipt(item, mid, state) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment && attachment.d === item.fromDid) {
        try { socket.send(JSON.stringify({ t: 'receipt', mid, state: item.read ? 'read' : state })); } catch {}
      }
    }
  }

  async deleteRoom() {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.put('deleted', true);
    });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ t: 'deleted' })); ws.close(4002, 'deleted'); } catch {}
    }
    return true;
  }

  webSocketClose(ws) { this.left(ws); }
  webSocketError(ws) { this.left(ws); }
  left(ws) {
    try { ws.close(1000, 'bye'); } catch {}
    const rest = this.ctx.getWebSockets().filter((socket) => socket !== ws);
    for (const peer of rest) peer.send(JSON.stringify({ t: 'peer', n: rest.length }));
  }
}

export class RoomPasswords extends DurableObject {
  // سجل الحسابات اللي مفعّلة الإشعارات + آخر إصدار اتبلّغ للناس بيه
  async addPushAccount(sub) {
    await this.ctx.blockConcurrencyWhile(async () => {
      const list = await this.ctx.storage.get('pushSubs') || [];
      if (!list.includes(sub)) { list.push(sub); await this.ctx.storage.put('pushSubs', list.slice(-2000)); }
    });
  }
  async removePushAccount(sub) {
    await this.ctx.blockConcurrencyWhile(async () => {
      const list = (await this.ctx.storage.get('pushSubs') || []).filter((x) => x !== sub);
      await this.ctx.storage.put('pushSubs', list);
    });
  }
  // null = مفيش إصدار جديد. غير كده بيرجّع قايمة الحسابات اللي لازم تتبلّغ (مرة واحدة بس لكل إصدار).
  async versionCheck(ver) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const last = await this.ctx.storage.get('appVersion');
      if (last === ver) return null;
      await this.ctx.storage.put('appVersion', ver);
      if (last && !semverGt(ver, last)) return null; // رجوع لإصدار أقدم: ما نبلّغش
      return await this.ctx.storage.get('pushSubs') || [];
    });
  }
  async isUsed(fingerprint) { return !!(await this.ctx.storage.get('pw:' + fingerprint)); }
  async isActive(roomId) {
    return !(await this.ctx.storage.get('deleted:' + roomId)) && !!(await this.ctx.storage.get('room:' + roomId));
  }
  async ownsRoom(fingerprint, roomId) {
    return !(await this.ctx.storage.get('deleted:' + roomId)) &&
      (await this.ctx.storage.get('room:' + roomId)) === fingerprint &&
      (await this.ctx.storage.get('pw:' + fingerprint)) === roomId;
  }
  async reserve(fingerprint, roomId) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get('deleted:' + roomId)) return 'deleted';
      const owner = await this.ctx.storage.get('room:' + roomId);
      if (owner && owner !== fingerprint) return 'wrong';
      const usedBy = await this.ctx.storage.get('pw:' + fingerprint);
      if (usedBy && usedBy !== roomId) return 'duplicate';
      await this.ctx.storage.put({ ['pw:' + fingerprint]: roomId, ['room:' + roomId]: fingerprint });
      return 'ok';
    });
  }
  async deleteRoom(fingerprint, roomId) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get('deleted:' + roomId)) return true;
      if ((await this.ctx.storage.get('room:' + roomId)) !== fingerprint || (await this.ctx.storage.get('pw:' + fingerprint)) !== roomId) return false;
      await this.ctx.storage.delete('pw:' + fingerprint);
      await this.ctx.storage.delete('room:' + roomId);
      await this.ctx.storage.put('deleted:' + roomId, true);
      return true;
    });
  }
}
