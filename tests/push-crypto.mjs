// يختبر تشفير Web Push الحقيقي: بيشفّر بنفس دالة السيرفر، وبيفك التشفير بنفس طريقة المتصفح (RFC 8291/8188)
// ويتأكد إن توقيع VAPID سليم. لو فشل = المتصفح كان بيرمي الإشعار بصمت.
import { readFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
const src = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const a = src.indexOf('const b64u'), b = src.indexOf('async function sendWebPush');
const lib = 'const enc=new TextEncoder();\n' + src.slice(a, b) + '\nreturn {webPushPayload,b64u,unb64u,concatBytes,hmacBytes,hkdfExpand};';
const L = new Function('crypto', 'btoa', 'atob', lib)(crypto, btoa, atob);
const { webPushPayload, b64u, unb64u, concatBytes, hmacBytes, hkdfExpand } = L;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

// "المتصفح": مفتاح استقبال + auth
const rx = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const rxPub = new Uint8Array(await crypto.subtle.exportKey('raw', rx.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
// مفاتيح VAPID
const vp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vpub = new Uint8Array(await crypto.subtle.exportKey('raw', vp.publicKey));
const vjwk = await crypto.subtle.exportKey('jwk', vp.privateKey);
const env = { VAPID_PUBLIC_KEY: b64u(vpub), VAPID_PRIVATE_KEY: vjwk.d };
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', origin: 'https://locked-room.example.workers.dev', keys: { p256dh: b64u(rxPub), auth: b64u(auth) } };
const payload = { title: 'غرفة مقفولة', body: 'هناك من يطرق الباب', tag: 't' };
const { body, headers } = await webPushPayload(env, sub, payload);

// فك التشفير زي المتصفح
const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), idlen = body[20];
const sender = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
const sp = await crypto.subtle.importKey('raw', sender, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: sp }, rx.privateKey, 256));
const enc = new TextEncoder();
const ikm = await hkdfExpand(await hmacBytes(auth, shared), concatBytes(enc.encode('WebPush: info\0'), rxPub, sender), 32);
const prk = await hmacBytes(salt, ikm);
const cek = await hkdfExpand(prk, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdfExpand(prk, enc.encode('Content-Encoding: nonce\0'), 12);
const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
let plain; try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ct)); } catch { plain = null; }
ok(!!plain, 'AES-GCM decrypt');
ok(rs === 4096 && idlen === 65, 'header (rs=4096, keyid=65)');
if (plain) {
  let i = plain.length - 1; while (i >= 0 && plain[i] === 0) i--;      // RFC 8188: الفاصل في آخر السجل
  const delim = plain[i];
  ok(delim === 2, 'delimiter byte 0x02 at END of record (got 0x' + (delim ?? 0).toString(16) + ')');
  let txt = ''; try { txt = new TextDecoder('utf-8', { fatal: true }).decode(plain.slice(0, i)); } catch {}
  let obj = null; try { obj = JSON.parse(txt); } catch {}
  ok(obj && obj.body === payload.body, 'payload JSON survives round-trip');
}
// VAPID
const m = /^vapid t=([^,]+), k=(.+)$/.exec(headers.Authorization);
const [h, c, s] = m[1].split('.');
const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vp.publicKey, unb64u(s), enc.encode(h + '.' + c));
ok(good, 'VAPID JWT signature verifies');
const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
ok(claims.aud === 'https://fcm.googleapis.com' && /^https:\/\//.test(claims.sub), 'VAPID aud/sub');
process.exit(fail ? 1 : 0);
