// اختبار 1.29.2: "نسمع معًا" لما الاتصال يتقطع وإنت في قايمة اختيار الملفات (اللي بيحصل على الموبايل لما التطبيق يروح للخلفية).
// المتوقع: بعد اختيار الأغنية التطبيق يستنى رجوع الاتصال ويكمّل الإرسال، من غير رسالة "لازم الطرف التاني يكون متصل".
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-music-reconnect.mjs
import { createRequire } from 'node:module';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8787', SECRET = 'x'.repeat(40), enc = new TextEncoder();
const b64u = (b) => Buffer.from(b).toString('base64url');
async function pending(sub, did) {
  const body = b64u(enc.encode(JSON.stringify({ sub, email: sub + '@t.c', name: sub, did, ok: false, v: '', rs: false, exp: Date.now() + 9e5 })));
  const k = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return body + '.' + b64u(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
}
async function sid(sub, did) {
  const s = await pending(sub, did);
  const r = await fetch(BASE + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `did=${did}; sid=${s}`, Origin: BASE }, body: JSON.stringify({ pw: 'Passw0rd!acct' + sub }) });
  const c = (r.headers.getSetCookie?.() || []).map((x) => x.match(/^sid=([^;]*)/)?.[1]).find(Boolean);
  if (!c) throw Error('setup failed ' + r.status + ' ' + await r.text());
  return c;
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const stamp = Date.now(); let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const mk = async (sub, did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ar-EG' });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs;
  await p.addInitScript(() => {
    sessionStorage.setItem('lr.permLater', '1');
    const W = window.WebSocket; window.__wss = [];
    window.WebSocket = function (...a) { const w = new W(...a); window.__wss.push(w); return w; };
    window.WebSocket.prototype = W.prototype; for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[k] = W[k];
  });
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100));
  return p;
};
const A = await mk('ua' + stamp, 'a'.repeat(24)), B = await mk('ub' + stamp, 'b'.repeat(24));
for (const p of [A, B]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
const pw = 'Room-pw-' + stamp;
await A.click('#create'); await A.fill('#pw', pw); await A.click('#pwGo');
await A.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
const code = (await A.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0];
await B.click('#joinOpen'); await B.fill('#codeIn', code); await B.click('#join'); await B.fill('#pw', pw); await B.click('#pwGo');
await A.waitForTimeout(2500);

// ملف صوتي صغير (WAV ~0.3 ثانية)
const wav = (() => { const n = 8000 * 0.3 | 0, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2); return b; })();
const file = { name: 'test-song.wav', mimeType: 'audio/wav', buffer: wav };
const musicShown = (p) => p.locator('#musicBar:not(.hidden)').count();
const toastText = (p) => p.evaluate(() => document.body.innerText);

// 1) الحالة العادية
await A.click('#menuBtn'); await A.click('#listenTogether'); await A.waitForTimeout(200);
await A.locator('body > input[type=file][accept*=".flac"]').setInputFiles(file);
await A.waitForTimeout(6000);
ok('العادي: شريط الأغنية ظهر عند A', await musicShown(A) === 1);
ok('العادي: شريط الأغنية ظهر عند B', await musicShown(B) === 1);
await A.click('#musicClose'); await A.waitForTimeout(1500);

// 2) الاتصال بيتقطع وإنت في قايمة الاختيار (زي الموبايل)
await A.click('#menuBtn'); await A.click('#listenTogether'); await A.waitForTimeout(200);
await A.evaluate(() => window.__wss.forEach((w) => { try { w.close(); } catch {} }));
await A.locator('body > input[type=file][accept*=".flac"]').setInputFiles(file);   // الاختيار بيحصل والاتصال لسه مقطوع
await A.waitForTimeout(12000);
const txt = await toastText(A);
ok('بعد قطع الاتصال: مفيش رسالة "لازم الطرف التاني يكون متصل"', !/must be online|لازم الطرف التاني يكون متصل/.test(txt));
ok('بعد قطع الاتصال: شريط الأغنية ظهر عند A', await musicShown(A) === 1);
ok('بعد قطع الاتصال: شريط الأغنية ظهر عند B', await musicShown(B) === 1);
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);
await browser.close();
console.log(fails ? '\nفي ' + fails + ' فشل' : '\nكله تمام'); process.exit(fails ? 1 : 0);
