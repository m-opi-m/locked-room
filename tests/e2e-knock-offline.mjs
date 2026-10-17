// اختبار الطرق وB أوفلاين (1.13.0): A يطرق وB مفصول، لما B يرجع الإشعار يوصله بوقت الطرق الحقيقي.
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-image.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
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
// صورة PNG حقيقية صغيرة
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAhklEQVR42u3QQREAAAgDoG3/zlTCwwcKsMZ3EpAVJUCWgCwBWQKyBGQJyBKQJSBLQJaALAFZArIEZAnIEpAlIEtAloAsAVkCsgRkCcgSkCUgS0CWgCwBWQKyBGQJyBKQJSBLQJaALAFZArIEZAnIEpAlIEtAloAsAVkCsgRkCcgSkCUgS0CWgCwBWQKyBGQJyBKQ5W8L0pYBMeY5gAAAAABJRU5ErkJggg==', 'base64');
writeFileSync('/tmp/t.png', png);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const mk = async (sub, did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => sessionStorage.setItem('lr.permLater', '1'));
  await p.addInitScript(() => { try { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }); } catch {} window.__notes = []; ServiceWorkerRegistration.prototype.showNotification = function (t, o) { window.__notes.push({ t, body: o && o.body, ts: o && o.timestamp }); return Promise.resolve(); }; });
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100)); p.errs = errs; return p;
};
const stamp = Date.now(); let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const A = await mk('ua' + stamp, 'a'.repeat(24)), B = await mk('ub' + stamp, 'b'.repeat(24));
for (const p of [A, B]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
const pw = 'Room-pw-' + stamp;
await A.click('#create'); await A.fill('#pw', pw); await A.click('#pwGo');
await A.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
const code = (await A.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0];
await B.click('#joinOpen'); await B.fill('#codeIn', code); await B.click('#join'); await B.fill('#pw', pw); await B.click('#pwGo');
await A.waitForTimeout(4000);

const notes = () => B.evaluate(() => window.__notes);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 1) طرق عادي وB أونلاين: إشعار فوري من غير وقت، والسيرفر ميحتفظش بنسخة (إيصال الاستلام)
await A.click('#wakeBtn');
await B.waitForFunction(() => window.__notes.length >= 1, null, { timeout: 10000 }).catch(() => {});
let n = await notes();
ok('طرق لايف: إشعار فوري بالنص العادي', n.length === 1 && n[0].body === 'Someone is knocking at the door');
await sleep(1500);
ok('طرق لايف: B بعت إيصال والسيرفر مسح النسخة المحفوظة', (await B.evaluate(async () => (await (await fetch('/api/me')).json()).notices.length)) === 0);
// 2) B يفصل، A يطرق مرتين
await B.context().setOffline(true);
await sleep(1500);
const t1 = Date.now();
await A.click('#wakeBtn'); await sleep(1500);
await A.click('#wakeBtn');
const t2 = Date.now();
console.log('knocked twice while B offline; waiting 34s...');
await sleep(34000);
n = await notes();
ok('B أوفلاين: مفيش إشعارات جديدة لسه', n.length === 1);
const tBack = Date.now();
await B.context().setOffline(false);
await B.waitForFunction(() => window.__notes.length >= 3, null, { timeout: 25000 }).catch(() => {});
n = await notes();
ok('لما B رجع النت وصله إشعارين (الطرقتين اللي فاتوا)', n.length === 3);
ok('الإشعار بيقول "Someone knocked at the door at <الساعة>"', n.slice(1).every((x) => /^Someone knocked at the door at \d{1,2}:\d{2}/.test(x.body)));
console.log('notes', JSON.stringify(n.slice(1)));
ok('الوقت المسجل = وقت الطرق الحقيقي مش وقت الرجوع', n.slice(1).every((x) => x.ts >= t1 - 3000 && x.ts <= t2 + 3000 && x.ts < tBack - 25000));
const expected = new Date(n[1].ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
ok('الساعة اللي في النص هي ساعة وقت الطرق (' + expected + ')', n[1].body.includes(expected));
await sleep(1500);
ok('المحفوظات اتمسحت بعد ما اتسلمت', (await B.evaluate(async () => (await (await fetch('/api/me')).json()).notices.length)) === 0);
ok('مفيش أخطاء صفحة', A.errs.length === 0 && B.errs.length === 0);
console.log('errs', A.errs, B.errs);
await browser.close(); process.exit(fails ? 1 : 0);
