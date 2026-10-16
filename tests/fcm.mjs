// اختبار FCM: وحدة fcm.js + طرق Account + مساري التسجيل/الإلغاء. من غير شبكة (fetch متزيّف) ومن غير أسرار حقيقية.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { generateKeyPairSync, createVerify } from 'node:crypto';
let fails = 0; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

// مفتاح RSA مؤقت للاختبار بس
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ client_email: 'test@proj.iam.gserviceaccount.com', project_id: 'proj-test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' });
const F = await import('../src/fcm.js');

let calls = [], mode = 'ok', oauthCount = 0;
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
    oauthCount++;
    const jwt = new URLSearchParams(init.body).get('assertion'), [h, c, sig] = jwt.split('.');
    const v = createVerify('RSA-SHA256'); v.update(h + '.' + c);
    globalThis.__jwtOk = v.verify(publicKey, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    globalThis.__claims = JSON.parse(Buffer.from(c.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return new Response(JSON.stringify({ access_token: 'AT' + oauthCount, expires_in: 3600 }), { status: 200 });
  }
  if (mode === 'ok') return new Response('{"name":"x"}', { status: 200 });
  if (mode === 'gone') return new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
  if (mode === 'bad') return new Response('{"error":{"status":"INTERNAL"}}', { status: 500 });
  if (mode === '401once') { mode = 'ok'; return new Response('{}', { status: 401 }); }
};
const env0 = { FCM_SERVICE_ACCOUNT_JSON: SA };
const TOK = 'f'.repeat(30) + ':APA91b' + 'x'.repeat(100);

// ---- fcm.js ----
t('validFcmToken يقبل توكن عادي', F.validFcmToken(TOK));
t('validFcmToken يرفض فاضي/قصير/رموز غريبة/غير نص', !F.validFcmToken('') && !F.validFcmToken('abc') && !F.validFcmToken('a'.repeat(30) + ' <x>') && !F.validFcmToken(12345) && !F.validFcmToken('a'.repeat(5000)));
t('fcmConfigured', F.fcmConfigured(env0) && !F.fcmConfigured({}));
t('fcmData نصوص بس', JSON.stringify(F.fcmData({ title: 'a', body: 'b', lang: 'ar', dir: 'rtl', icon: 'x', n: 5 })) === '{"title":"a","body":"b","lang":"ar"}');
let r = await F.sendFcm(env0, TOK, { title: 'T', body: 'B', lang: 'en' });
t('إرسال ناجح', r.ok && !r.gone);
const send = calls.find((c) => c.url.includes('/messages:send')), msg = JSON.parse(send.init.body).message;
t('URL فيه project_id', send.url === 'https://fcm.googleapis.com/v1/projects/proj-test/messages:send');
t('Bearer من OAuth', send.init.headers.Authorization === 'Bearer AT1');
t('الرسالة data-only بأولوية عالية وبالتوكن', msg.token === TOK && !msg.notification && msg.android.priority === 'HIGH' && msg.data.title === 'T');
t('JWT متوقّع بـ RS256 صح وscope وaud', globalThis.__jwtOk === true && globalThis.__claims.scope.endsWith('firebase.messaging') && globalThis.__claims.iss === 'test@proj.iam.gserviceaccount.com');
await F.sendFcm(env0, TOK, { title: 'T', body: 'B' });
t('الـ access token بيتكاشّى', oauthCount === 1);
mode = 'gone'; r = await F.sendFcm(env0, TOK, { title: 'T', body: 'B' });
t('توكن UNREGISTERED -> gone', !r.ok && r.gone);
mode = 'bad'; r = await F.sendFcm(env0, TOK, { title: 'T', body: 'B' });
t('خطأ سيرفر -> مش gone', !r.ok && !r.gone && r.status === 500);
mode = '401once'; r = await F.sendFcm(env0, TOK, { title: 'T', body: 'B' });
t('401 -> يجدد التوكن ويعيد مرة', r.ok && oauthCount === 2);
let threw = false; F._resetFcmCache(); try { await F.sendFcm({ FCM_SERVICE_ACCOUNT_JSON: '{"a":1}' }, TOK, {}); } catch { threw = true; }
t('Secret ناقص -> exception (بيتلقط في worker)', threw);
F._resetFcmCache();

// ---- Worker / Account ----
let src = readFileSync('./src/worker.js', 'utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}')
  .replace("import { connect } from 'cloudflare:sockets';", 'const connect=()=>{};');
writeFileSync('./src/.w-fcm-test.mjs', src);
let W; try { W = await import('./../src/.w-fcm-test.mjs'); } finally { try { unlinkSync('./src/.w-fcm-test.mjs'); } catch {} }
const SECRET = 'x'.repeat(40), accounts = new Map();
const mkCtx = () => { const m = new Map(); return { _m: m, storage: {
  get: async (k) => Array.isArray(k) ? new Map(k.filter((x) => m.has(x)).map((x) => [x, m.get(x)])) : m.get(k),
  put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, b); else m.set(k, v); },
  delete: async (k) => m.delete(k),
  list: async ({ prefix = '' } = {}) => new Map([...m.entries()].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[0] < b[0] ? -1 : 1)) }, blockConcurrencyWhile: (f) => f() }; };
const env = { SESSION_SECRET: SECRET, FCM_SERVICE_ACCOUNT_JSON: SA,
  ACCOUNT: { idFromName: (n) => n, get: (n) => { if (!accounts.has(n)) accounts.set(n, new W.Account(mkCtx(), env)); return accounts.get(n); } }, ROOM: null, ASSETS: null,
  ROOM_PASSWORDS: { idFromName: (n) => n, get: () => ({ isUsed: async () => false, isActive: async () => true, reserve: async () => true, addPushAccount: async () => {} }) } };
const enc = new TextEncoder(), b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function pending(sub, did) {
  const body = b64u(enc.encode(JSON.stringify({ sub, email: 'a@b.c', name: 'T', did, ok: false, v: '', rs: false, exp: Date.now() + 9e5 })));
  const k = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return body + '.' + b64u(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
}
class Dev { constructor(did) { this.did = did; this.sid = ''; }
  async call(path, body, origin = 'http://localhost') {
    const h = { Cookie: `did=${this.did}; sid=${this.sid}`, 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36', Origin: origin };
    if (body) h['Content-Type'] = 'application/json';
    const r = await W.default.fetch(new Request('http://localhost' + path, { method: body || path.startsWith('/auth/logout') ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    for (const c of r.headers.getSetCookie?.() || []) { const m = c.match(/^sid=([^;]*)/); if (m) this.sid = m[1]; }
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } }
const A = new Dev('a'.repeat(24)); A.sid = await pending('u1', A.did);
t('register قبل الدخول -> 401', (await A.call('/api/fcm/register', { token: TOK })).status === 401);
t('setup', (await A.call('/api/setup', { pw: 'password-1' })).status === 200);
t('register بـ Origin غلط -> 403', (await A.call('/api/fcm/register', { token: TOK }, 'https://evil.example')).status === 403);
t('register توكن غير صالح -> 400', (await A.call('/api/fcm/register', { token: 'bad token!' })).status === 400);
t('register ok', (await A.call('/api/fcm/register', { token: TOK, language: 'ar' })).status === 200);
const acc = env.ACCOUNT.get('u1'), store = acc.ctx._m;
t('التوكن اتخزن لجهاز A', store.get('fcm:' + A.did)?.token === TOK && store.get('fcm:' + A.did)?.language === 'ar');
mode = 'ok'; calls = [];
let res = await acc.pushKnock(A.did, 'ar');
t('pushKnock بيبعت FCM لوحده (من غير VAPID)', res === true && calls.some((c) => c.url.includes('/messages:send')));
const sent = JSON.parse(calls.find((c) => c.url.includes('/messages:send')).init.body).message.data;
t('إشعار الطرق بالعربي', sent.title === 'غرفة مقفولة' && /يطرق/.test(sent.body));
calls = []; res = await acc.pushUpdate('9.9.9');
t('إشعار التحديث مش بيتبعت FCM', res === 'none' && !calls.some((c) => c.url.includes('/messages:send')));
mode = 'bad'; t('فشل مؤقت -> الطرق يرجع false والتوكن يفضل', (await acc.pushKnock(A.did, 'en')) === false && store.has('fcm:' + A.did));
mode = 'gone'; await acc.pushKnock(A.did, 'en');
t('توكن مات -> يتمسح', !store.has('fcm:' + A.did));
mode = 'ok';
await A.call('/api/fcm/register', { token: TOK });
await acc.saveFcm('other-did', { token: TOK, language: 'en' });
t('نفس التوكن لجهاز تاني -> يتشال من القديم', !store.has('fcm:' + A.did) && store.has('fcm:other-did'));
await acc.removeFcm('other-did');
await A.call('/api/fcm/register', { token: TOK });
t('unregister', (await A.call('/api/fcm/unregister', {})).status === 200 && !store.has('fcm:' + A.did));
await A.call('/api/fcm/register', { token: TOK });
await A.call('/auth/logout', {});
t('تسجيل الخروج بيمسح توكن الجهاز', !store.has('fcm:' + A.did));
const envNoFcm = { ...env }; delete envNoFcm.FCM_SERVICE_ACCOUNT_JSON; calls = [];
await acc.saveFcm('d2', { token: TOK, language: 'en' }); const acc2 = new W.Account(acc.ctx, envNoFcm);
t('من غير Secret: مفيش إرسال والرد none', (await acc2.pushKnock('d2', 'en')) === false && !calls.length);
process.exit(fails ? 1 : 0);
