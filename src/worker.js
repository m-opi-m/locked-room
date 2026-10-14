import { DurableObject } from 'cloudflare:workers';

const PAGES = new Set(['/', '/app.js', '/style.css']);
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
    'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src ${conn}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
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
  if (/Edg\//.test(ua)) br = 'Edge';
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
  if (t.length > 2048) return null;
  try { return JSON.parse(t); } catch { return null; }
}
const account = (env, sub) => env.ACCOUNT.get(env.ACCOUNT.idFromName(sub));

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
    // الجهاز المحظور من الحساب ده مش بياخد جلسة أصلاً
    if ((await account(env, p.sub).state('', did)).blocked) return redirect(url, '/?e=blocked', [clear]);
    const name = typeof p.name === 'string' ? p.name.slice(0, 60) : '';
    const sess = await sessionCookie(url, env, { sub: p.sub, email: p.email.slice(0, 120), name, did });
    return redirect(url, '/', [clear, sess]);
  } catch {
    return redirect(url, '/?e=failed', [clear]);
  }
}

// ---------- الراوتر ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
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
    // بنبعت للغرفة هوية الجلسة عشان تقدر تقفل الاتصال فوراً لما الحساب يتاخد من جهاز تاني (وبنمسح أي هيدرز جاية من العميل)
    const h = new Headers(req.headers);
    h.set('X-Acc-Sub', s.sub); h.set('X-Acc-V', s.v); h.set('X-Acc-Did', did);
    return env.ROOM.get(env.ROOM.idFromName(r)).fetch(new Request(req, { headers: h })); // كل غرفة = Durable Object لوحدها
  }

  if (path === '/auth/google' && req.method === 'GET') return googleStart(url, env);
  if (path === '/auth/callback' && req.method === 'GET') return googleCallback(req, url, env, did);

  if (path === '/api/me' && req.method === 'GET') {
    const s = await readSession(req, url, env);
    if (!s) return json(url, { s: 'anon' });
    const who = { name: s.name, email: s.email };
    const st = await account(env, s.sub).state(s.ok ? s.v : '', did);
    if (st.blocked) return json(url, { s: 'blocked', ...who }, 200, [dead]);
    const mine = s.ok && s.v && s.did === did;
    if (mine && st.ok) return json(url, { s: 'ok', ...who });
    // دخلت بجهازك قبل كده، بس الحساب اتفتح من جهاز تاني بعدك
    if (mine && st.has && st.by) return json(url, { s: s.rs ? 'reset' : 'kicked', by: st.by, ...who });
    return json(url, { s: st.has ? 'unlock' : 'new', ...who });
  }

  const POSTS = ['/api/setup', '/api/login', '/api/reset', '/api/ack', '/api/notme', '/auth/logout'];
  if (req.method === 'POST' && POSTS.includes(path)) {
    if (req.headers.get('Origin') !== url.origin) return json(url, { e: 'forbidden' }, 403);
    if (path === '/auth/logout') return json(url, { ok: true }, 200, [dead]);

    const s = await readSession(req, url, env);
    if (!s) return json(url, { e: 'session' }, 401);
    const acc = account(env, s.sub);
    const mine = s.ok && s.v && s.did === did;
    const st = await acc.state(mine ? s.v : '', did);
    if (st.blocked) return json(url, { e: 'blocked' }, 403, [dead]);

    // "كان أنا" / "مش أنا" من شاشة التنبيه (لازم تكون فعلاً اتاخدت منك الجلسة)
    if (path === '/api/ack' || path === '/api/notme') {
      if (!mine) return json(url, { e: 'session' }, 401);
      if (st.ok) return json(url, { ok: true });
      if (!st.by) return json(url, { e: 'session' }, 401);
      const base = { sub: s.sub, email: s.email, name: s.name, did };
      // كان أنا: يرجع لشاشة الباسورد | مش أنا: الجلسة بتفضل "مستنية باسورد جديد" حتى لو قفل وفتح تاني
      return json(url, { ok: true }, 200, [await sessionCookie(url, env, base, path === '/api/notme' ? { full: true, v: s.v, rs: true } : {})]);
    }

    if (mine && st.ok && path !== '/api/reset') return json(url, { ok: true }); // داخل فعلاً

    const body = await readBody(req);
    const pw = body && typeof body.pw === 'string' ? body.pw : '';
    if (pw.length < PW_MIN || pw.length > PW_MAX) return json(url, { e: 'short' }, 400);
    const dn = deviceName(req), loc = deviceLoc(req);
    const base = { sub: s.sub, email: s.email, name: s.name, did };

    if (path === '/api/setup') {
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
  return new Response(res.body, { status: res.status, headers: secHeaders(url, res.headers.get('Content-Type') || 'text/plain') });
}

// ---------- الحساب: كل مستخدم Durable Object لوحده (هاش الباسورد + الجهاز الحالي + الأجهزة المحظورة) ----------
// cur = الجهاز اللي معاه الحساب دلوقتي { v: رقم الجلسة, d: معرّف الجهاز, n: اسمه, l: مكانه, t: وقت الدخول }
// blocked = [{ d, n, t }] أجهزة ممنوعة نهائياً من الحساب ده
async function claim(storage, did, n, l) {
  const v = rand(18);
  await storage.put('cur', { v, d: did, n, l, t: Date.now() });
  return v;
}

export class Account extends DurableObject {
  async hash(pw, salt, iter) {
    const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256));
  }

  async has() { return !!(await this.ctx.storage.get('pw')); }

  // حالة جلسة معينة: has = في حساب | blocked = الجهاز محظور | ok = الجلسة لسه هي الحالية | by = الجهاز التاني اللي أخد الحساب
  async state(v, did) {
    const m = await this.ctx.storage.get(['pw', 'cur', 'blocked']);
    const rec = m.get('pw'), cur = m.get('cur'), bl = m.get('blocked') || [];
    return {
      has: !!rec,
      blocked: bl.some((b) => b.d === did),
      ok: !!(rec && cur && v && cur.v === v),
      by: cur && cur.d !== did ? { n: cur.n, t: cur.t, l: cur.l } : null,
    };
  }

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
      const m = await this.ctx.storage.get(['pw', 'blocked', 'fail']);
      const rec = m.get('pw');
      if (!rec) return { ok: false, left: 0 };
      if ((m.get('blocked') || []).some((b) => b.d === did)) return { ok: false, blocked: true };
      const now = Date.now();
      const f = m.get('fail') || { n: 0, until: 0 };
      if (f.until > now) return { ok: false, wait: Math.ceil((f.until - now) / 1000) };
      const h = await this.hash(pw, unb64u(rec.s), rec.i);
      if (same(h, unb64u(rec.h))) {
        await this.ctx.storage.delete('fail');
        return { ok: true, v: await claim(this.ctx.storage, did, n, l) }; // الدخول الناجح بياخد الحساب، والجهاز القديم بيتقفل
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

// ---------- الغرفة: بتحوّل رسايل مشفرة بين اتنين بس، ومفيش تخزين ولا لوج ----------
export class Room extends DurableObject {
  // نتأكد إن جلسة كل طرف لسه هي الحالية. اللي اتاخدت منه الجلسة أو اتحظر بنقفله فوراً (كاش 3 ثواني عشان منسألش الحساب كل رسالة)
  async alive(ws, a) {
    const now = Date.now();
    if (a.ok && now < a.until) return true;
    let st;
    try { st = await this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(a.sub)).state(a.v, a.d); } catch { return true; } // لو السؤال فشل منقفلش على الغلط
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
    const { 0: client, 1: server } = new WebSocketPair();

    if (this.ctx.getWebSockets().length >= 2) {
      server.accept();
      server.send(JSON.stringify({ t: 'full' }));
      server.close(1008, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ c: 0, reset: Date.now() + 10000, sub, v, d, ok: true, until: Date.now() + 3000 });
    const all = this.ctx.getWebSockets();
    server.send(JSON.stringify({ t: 'joined', n: all.length }));
    for (const p of all) if (p !== server) p.send(JSON.stringify({ t: 'peer', n: all.length }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return ws.close(1009, 'bad');
    const a = ws.deserializeAttachment() || { c: 0, reset: 0 };
    const now = Date.now();
    if (now > a.reset) { a.c = 0; a.reset = now + 10000; }
    if (++a.c > 40) return ws.close(1008, 'flood');
    ws.serializeAttachment(a);
    if (!(await this.alive(ws, a))) return; // المرسل نفسه جلسته اتاخدت

    let m;
    try { m = JSON.parse(data); } catch { return ws.close(1003, 'bad'); }
    if (!m || m.t !== 'msg' || typeof m.iv !== 'string' || m.iv.length > 64 || typeof m.ct !== 'string') return;
    const out = JSON.stringify({ t: 'msg', iv: m.iv, ct: m.ct });
    for (const p of this.ctx.getWebSockets()) {
      if (p === ws) continue;
      const pa = p.deserializeAttachment();
      if (pa && pa.sub && !(await this.alive(p, pa))) continue; // المستقبِل اتقفل، مبنبعتلوش
      p.send(out);
    }
  }

  webSocketClose(ws) { this.left(ws); }
  webSocketError(ws) { this.left(ws); }

  left(ws) {
    try { ws.close(1000, 'bye'); } catch {}
    const rest = this.ctx.getWebSockets().filter((s) => s !== ws);
    for (const p of rest) p.send(JSON.stringify({ t: 'peer', n: rest.length }));
  }
}
