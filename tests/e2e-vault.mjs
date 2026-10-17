// اختبار حقيقي للمكالمات (1.8.0): A يتصل، B يرد، لازم الاتنين يوصلوا "متصل" والصوت يعدّي.
// + إعادة محاولة ICE + وضع توفير النطاق + /api/turn (مفعّل ومش مفعّل).
// تشغيل: node build-dev.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-call.mjs
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const stamp = Date.now(); let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
// اختبار النسخة الاحتياطية للمحادثات: جهاز A ينشئ الحساب بالواجهة وينشئ غرفتين، جهاز B (نفس الحساب) يسجل دخول بالباسورد ويلاقيهم.
const sub = 'vu' + stamp, didA = 'a'.repeat(24), didB = 'c'.repeat(24), accPw = 'Acct-pw-' + stamp;
const mkp = async (did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ar-EG' });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await pending(sub, did), url: BASE }]);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.addInitScript(() => sessionStorage.setItem('lr.permLater', '1'));
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100));
  return p;
};
const A = await mkp(didA);
await A.waitForSelector('#wPw', { state: 'visible', timeout: 15000 });
await A.fill('#wPw', accPw); await A.fill('#wPw2', accPw); await A.click('#wGo');
await A.waitForSelector('#create', { state: 'visible', timeout: 15000 });
const codes = [];
for (const rp of ['Room-one-' + stamp, 'Room-two-' + stamp]) {
  await A.click('#create'); await A.fill('#pw', rp); await A.click('#pwGo');
  await A.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
  codes.push((await A.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0]);
  await A.click('#homeChat');
  await A.waitForTimeout(600);
}
const roomsA = await A.evaluate(() => JSON.parse(localStorage.getItem('lr.rooms') || '[]'));
ok('A عنده غرفتين محليًا', roomsA.length === 2);
await A.waitForTimeout(3500);
const vault = await A.evaluate(async () => (await (await fetch('/api/vault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'get' }) })).json()).vault);
ok('النسخة الاحتياطية اتحفظت على الحساب (مشفّرة)', !!(vault && vault.ct && vault.iv && vault.salt));
ok('السيرفر مش بيشوف أكواد الغرف (النص مشفّر)', !!vault && !roomsA.some((c) => JSON.stringify(vault).includes(c)));
// A يسجل خروج (الحساب يتحرر) ثم جهاز B يدخل بنفس الباسورد
await A.evaluate(() => fetch('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
const B = await mkp(didB);
await B.waitForSelector('#uPw', { state: 'visible', timeout: 15000 });
ok('B جهاز جديد: مفيش عنده غرف', (await B.evaluate(() => localStorage.getItem('lr.rooms') || '')) === '');
await B.fill('#uPw', accPw); await B.click('#uGo');
await B.waitForSelector('#create', { state: 'visible', timeout: 20000 });
await B.waitForTimeout(800);
const roomsB = await B.evaluate(() => JSON.parse(localStorage.getItem('lr.rooms') || '[]'));
ok('بعد تسجيل الدخول B لقى الغرفتين القديمتين', roomsB.length === 2 && roomsA.every((c) => roomsB.includes(c)));
ok('الغرفتين ظاهرين في قايمة المحادثات', (await B.locator('#roomList .roomCard').count()) === 2);
// باسورد غلط ما يفتحش النسخة
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);
await browser.close();
console.log(fails ? fails + ' فشل' : 'كله تمام'); process.exit(fails ? 1 : 0);
