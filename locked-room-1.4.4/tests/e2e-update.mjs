// يجرّب على wrangler dev الحقيقي: اشتراك إشعارات (وهمي) يتسجّل، وبعد إصدار جديد السيرفر يحاول يبعت "فيه تحديث".
import { webcrypto as crypto } from 'node:crypto';
const BASE = 'http://127.0.0.1:8787', SECRET = 'x'.repeat(40), enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');
const mode = process.argv[2];
async function sid(sub, did) {
  const body = b64u(enc.encode(JSON.stringify({ sub, email: sub + '@t.c', name: sub, did, ok: false, v: '', rs: false, exp: Date.now() + 9e5 })));
  const k = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = body + '.' + b64u(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
  const H = { 'Content-Type': 'application/json', Origin: BASE };
  const r = await fetch(BASE + '/api/setup', { method: 'POST', headers: { ...H, Cookie: `did=${did}; sid=${s}` }, body: JSON.stringify({ pw: 'Passw0rd!acct' + sub }) });
  const c = (r.headers.getSetCookie?.() || []).map((x) => x.match(/^sid=([^;]*)/)?.[1]).find(Boolean);
  if (!c) throw Error('setup failed ' + r.status + ' ' + await r.text());
  return { cookie: `did=${did}; sid=${c}`, H };
}
if (mode === 'subscribe') {
  const did = 'd'.repeat(24), u = await sid('upd' + Date.now(), did);
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const r = await fetch(BASE + '/api/push/subscribe', { method: 'POST', headers: { ...u.H, Cookie: u.cookie }, body: JSON.stringify({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/fake-' + Date.now(), keys: { p256dh: pub, auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } }, language: 'ar' }) });
  console.log('subscribe status', r.status, await r.text());
  process.exit(r.status === 200 ? 0 : 1);
}
