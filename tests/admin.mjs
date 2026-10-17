// الأدمن: إيميل جوجل (ADMIN_EMAIL) + جلسة كاملة + "enter" + رقم سري (مؤقت ثم متغيّر بكود إيميل) + كوكي adm + خروج (unit بـ mocks)
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
const src = readFileSync('./src/worker.js', 'utf8').replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}').replace("import { connect } from 'cloudflare:sockets';", 'const connect=()=>{};');
writeFileSync('./src/.w-admin.mjs', src);
const W = await import('../src/.w-admin.mjs');
const mk = (sockets = []) => { const m = new Map(); return { m, ctx: { getWebSockets: () => sockets, storage: {
  get: async (k) => Array.isArray(k) ? new Map(k.filter((x) => m.has(x)).map((x) => [x, m.get(x)])) : m.get(k),
  put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
  delete: async (k) => { if (Array.isArray(k)) k.forEach((x) => m.delete(x)); else m.delete(k); },
  deleteAll: async () => m.clear(),
  list: async (o = {}) => new Map([...m].filter(([k]) => (!o.prefix || k.startsWith(o.prefix)) && (!o.startAfter || k > o.startAfter)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, o.limit || 1e9)) },
  blockConcurrencyWhile: (f) => f() } }; };
const sock = (d, lang) => ({ closed: null, att: { d, language: lang, at: Date.now() - 5000 }, deserializeAttachment() { return this.att; }, close(c) { this.closed = c; }, send() {} });
let fails = 0; const t = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n); if (!c) fails++; };
const K1 = '1'.repeat(64), K2 = '2'.repeat(64), K3 = '3'.repeat(64);
const reg = new W.RoomPasswords(mk().ctx, {});
await reg.reserve('fp1', K1); await reg.reserve('fp2', K2); await reg.reserve('fp3', K3);
const s1 = sock('abcdef123456', 'ar'), s2 = sock('zzzzzz999999', 'en');
const rooms = { [K1]: new W.Room(mk([s1, s2]).ctx, {}), [K2]: new W.Room(mk([]).ctx, {}), [K3]: new W.Room(mk([]).ctx, {}) };
rooms[K1].ctx.storage.put('historyCount', 7);
let deleted3 = false; const od = rooms[K3].deleteRoom.bind(rooms[K3]); rooms[K3].deleteRoom = async () => { deleted3 = true; return od(); };
const SECRET = 'x'.repeat(40), DID = 'd'.repeat(24), TEMP = 'temp-pass-123';
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sid = async (o) => { const body = b64u(new TextEncoder().encode(JSON.stringify({ sub: 'u1', email: 'Me@Gmail.com', did: DID, ok: true, v: '1', exp: Date.now() + 1e6, ...o }))); const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return body + '.' + b64u(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body))); };
let accState = { ok: true, blocked: false }, mails = [];
const env = { ADMIN_TOKEN: TEMP, ADMIN_EMAIL: 'me@gmail.com', SESSION_SECRET: SECRET, RESEND_API_KEY: 'k',
  ACCOUNT: { idFromName: (n) => n, get: () => ({ state: async () => accState }) },
  ROOM_PASSWORDS: { idFromName: () => 'g', get: () => reg }, ROOM: { idFromString: (k) => k, get: (k) => rooms[k] } };
const realFetch = globalThis.fetch; globalThis.fetch = async (u, o) => { if (String(u).includes('resend.com')) { mails.push(JSON.parse(o.body)); return new Response('{}', { status: 200 }); } return realFetch(u, o); };
let SID = await sid({}), DIDC = DID, ADM = '';
const hdr = (extra = {}) => ({ Origin: 'http://localhost', Cookie: `did=${DIDC}; sid=${SID}` + (ADM ? `; adm=${ADM}` : ''), 'Content-Type': 'application/json', ...extra });
const call = async (body, e = env, origin) => { const r = await W.default.fetch(new Request('http://localhost/api/admin', { method: 'POST', headers: hdr(origin ? { Origin: origin } : {}), body: JSON.stringify(body) }), e, { waitUntil() {} }); const sc = r.headers.getSetCookie?.() || []; const m = sc.map((c) => c.match(/^adm=([^;]*)/)).find(Boolean); if (m) ADM = m[1]; r.j = await r.clone().json().catch(() => ({})); return r; };
const page = async (path, e = env) => W.default.fetch(new Request('http://localhost' + path, { headers: hdr() }), { ...e, ASSETS: { fetch: async () => new Response('x', { headers: { 'Content-Type': 'text/html' } }) } }, { waitUntil() {} });

// --- البوابة (طبقة 1) ---
t('الصفحات للأدمن: 200', (await page('/admin')).status === 200 && (await page('/admin.js')).status === 200);
const good = SID;
SID = await sid({ email: 'other@gmail.com' }); t('إيميل تاني: الصفحة والـ API = 404', (await page('/admin')).status === 404 && (await call({ op: 'status' })).status === 404);
SID = await sid({ ok: false, v: '' }); t('جلسة مش كاملة: 404', (await call({ op: 'status' })).status === 404);
SID = ''; t('من غير جلسة: 404', (await call({ op: 'status' })).status === 404 && (await page('/admin.css')).status === 404);
SID = good; DIDC = 'e'.repeat(24); t('جهاز تاني (did مختلف): 404', (await call({ op: 'status' })).status === 404); DIDC = DID;
accState = { ok: false }; t('الحساب اتاخد من جهاز تاني: 404', (await call({ op: 'status' })).status === 404); accState = { ok: true, blocked: false };
t('بدون ADMIN_EMAIL مقفول بالكامل', (await page('/admin', { ...env, ADMIN_EMAIL: '' })).status === 404);
t('Origin غلط: 403', (await call({ op: 'status' }, env, 'http://evil.dev')).status === 403);

// --- خانة "دخول بكود" ---
t('enter بإيميل الأدمن (حروف كبيرة/صغيرة): 200', (await call({ op: 'enter', email: ' ME@gmail.COM ' })).status === 200);
t('enter بإيميل تاني: 404 (نفس رد أي كود غلط)', (await call({ op: 'enter', email: 'x@y.com' })).status === 404);

// --- الرقم السري (طبقة 2) ---
let st = (await call({ op: 'status' })).j; t('status: مش داخل + فيه رقم مؤقت', st.authed === false && st.hasPw === true && st.mail === true);
t('عمليات الغرف قبل الدخول: 401', (await call({ op: 'rooms' })).status === 401);
t('رقم غلط: 401 وبدون كوكي', (await call({ op: 'login', pw: 'nope' })).status === 401 && !ADM);
t('الرقم المؤقت صح: 200 + كوكي adm', (await call({ op: 'login', pw: TEMP })).status === 200 && !!ADM);
const r = (await call({ op: 'rooms' })).j;
t('قايمة الغرف: 3', r.rooms.length === 3 && r.total === 3);
const a = r.rooms.find((x) => x.key === K1);
t('الغرفة 1: اتصالين و7 رسايل + device مقصوص', a.sockets.length === 2 && a.messages === 7 && a.sockets[0].d === 'abcdef12');
t('مفيش بصمة باسورد في الرد', !JSON.stringify(r).includes('fp1'));
t('cursor', (await call({ op: 'rooms', cursor: K1 })).j.rooms.length === 2);
t('kick جهاز واحد', (await call({ op: 'kick', key: K1, d: 'abcdef12' })).j.kicked === 1 && s1.closed === 1012 && s2.closed === null);
t('kick الكل', (await call({ op: 'kick', key: K1 })).j.kicked === 2);
t('key/op غلط: 400', (await call({ op: 'kick', key: 'bad' })).status === 400 && (await call({ op: 'zzz', key: K1 })).status === 400);
t('مسح غرفة', (await call({ op: 'delete', key: K3 })).status === 200 && deleted3 && !(await reg.isActive(K3)));
t('كوكي adm من جهاز تاني مش بيفتح', await (async () => { const keep = ADM; DIDC = 'e'.repeat(24); SID = await sid({ did: DIDC }); const x = await call({ op: 'rooms' }); DIDC = DID; SID = good; ADM = keep; return x.status === 401; })());

// --- كود الإيميل وتغيير الرقم ---
const old = ADM;
t('sendcode: 200 والإيميل لإيميل الجلسة', (await call({ op: 'sendcode' })).status === 200 && mails.length === 1 && mails[0].to[0] === 'Me@Gmail.com' && /^\d{6}$/.test(mails[0].text.match(/\d{6}/)[0]));
t('إعادة الإرسال قبل 60 ثانية: 429', (await call({ op: 'sendcode' })).status === 429);
const code = mails[0].text.match(/\d{6}/)[0];
t('رقم جديد ضعيف: 400', (await call({ op: 'setpw', code, pw: 'short' })).status === 400);
t('كود غلط: 400', (await call({ op: 'setpw', code: code === '000000' ? '111111' : '000000', pw: 'new-password-1' })).status === 400);
t('كود صح: بيغيّر الرقم', (await call({ op: 'setpw', code, pw: 'new-password-1' })).status === 200);
t('نفس الكود مش بيشتغل تاني', (await call({ op: 'setpw', code, pw: 'another-pass-2' })).status === 400);
ADM = '';
t('الرقم المؤقت القديم بطل يشتغل', (await call({ op: 'login', pw: TEMP })).status === 401);
t('الرقم الجديد بيشتغل', (await call({ op: 'login', pw: 'new-password-1' })).status === 200 && !!ADM);
t('وبعد 5 كودات غلط الكود بيتلغي', await (async () => { await reg.adminCodeSet('H'); await reg.adminFailed; for (let i = 0; i < 5; i++) await reg.adminCodeCheck('X'); return !(await reg.adminCodeCheck('H')); })());

// --- الخروج ---
const ex = await call({ op: 'exit' }); const sc = ex.headers.getSetCookie().join(';');
t('خروج: بيمسح كوكي adm (Max-Age=0)', ex.status === 200 && /adm=;/.test(sc) && /Max-Age=0/.test(sc));
ADM = ''; t('بعد الخروج الغرف تتقفل تاني: 401', (await call({ op: 'rooms' })).status === 401);

// --- قفل المحاولات ---
for (let i = 0; i < 5; i++) await call({ op: 'login', pw: 'wrong' + i });
t('بعد 5 محاولات غلط: قفل 429 حتى للرقم الصح', (await call({ op: 'login', pw: 'new-password-1' })).status === 429);
console.log(fails ? fails + ' FAILED' : 'ALL OK');
unlinkSync('./src/.w-admin.mjs'); process.exit(fails ? 1 : 0);
