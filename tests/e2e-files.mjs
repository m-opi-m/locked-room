// (نسخة ملفات)  (1.8.0): A يتصل، B يرد، لازم الاتنين يوصلوا "متصل" والصوت يعدّي.
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
const mk = async (sub, did, turnMode) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ar-EG', permissions: ['microphone', 'camera'] });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs; p.turnCalls = 0;
  if (turnMode === 'mock') await p.route('**/api/turn', (r) => { p.turnCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }] }) }); });
  await p.addInitScript(() => { sessionStorage.setItem('lr.permLater', '1'); window.__pcs = []; const O = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); window.__cfg = a[0]; return pc; }; window.RTCPeerConnection.prototype = O.prototype; window.__pc = () => window.__pcs[window.__pcs.length - 1]; });
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100));
  return p;
};

import { readFileSync } from 'node:fs';
import { createHash as H } from 'node:crypto';
const FX = process.env.FX || '/tmp/fx';
const sha = (b) => H('sha256').update(b).digest('hex');
const A = await mk('fa' + stamp, 'a'.repeat(24)), B = await mk('fb' + stamp, 'b'.repeat(24));
for (const p of [A, B]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
const pw = 'Room-pw-' + stamp;
await A.click('#create'); await A.fill('#pw', pw); await A.click('#pwGo');
await A.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
const code = (await A.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0];
await B.click('#joinOpen'); await B.fill('#codeIn', code); await B.click('#join'); await B.fill('#pw', pw); await B.click('#pwGo');
await A.waitForFunction(() => document.getElementById('status')?.textContent === 'متصل', null, { timeout: 15000 }).catch(() => {});
ok('الطرفين دخلوا الغرفة', (await A.locator('#status').innerText()) === 'متصل');

// 1) ملف كبير 5.3MB (3 أجزاء) من قايمة الملفات — لازم يوصل بنفس البايتات
const big = readFileSync(FX + '/big.bin');
await A.setInputFiles('#docFile', FX + '/big.bin');
await B.waitForSelector('.lrfCard a[download]', { timeout: 60000 });
ok('B شاف كارت الملف الكبير باسمه', (await B.locator('.lrfCard strong').first().innerText()) === 'big.bin');
const [dl] = await Promise.all([B.waitForEvent('download'), B.locator('.lrfCard a[download]').first().click()]);
const p1 = await dl.path();
ok('الملف الكبير وصل بنفس البايتات (sha256)', sha(readFileSync(p1)) === sha(big));
ok('عند المرسل اتحول لكارت مكتمل (مش شريط تقدم)', await A.locator('.lrfCard a[download]').count() >= 1 && await A.locator('.lrfBusy').count() === 0);

// 2) فيديو mp4 — لازم يظهر <video> قابل للتشغيل عند B
await A.setInputFiles('#imgPick', FX + '/t.webm');
await B.waitForSelector('video.lrfVid', { timeout: 30000 });
const vw = await B.evaluate(async () => { const v = document.querySelector('video.lrfVid'); await new Promise((r) => v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })); return v.videoWidth; });
ok('فيديو webm اتعرض عند B (width=320)', vw === 320);

// 3) صوت mp3 و m4a
await A.setInputFiles('#imgPick', FX + '/t.mp3');
await B.waitForSelector('audio.lrfAud', { timeout: 30000 });
const ad = await B.evaluate(async () => { const a = document.querySelector('audio.lrfAud'); await new Promise((r) => a.readyState >= 1 ? r() : a.addEventListener('loadedmetadata', r, { once: true })); return a.duration; });
ok('صوت mp3 اتعرض (المدة ~2 ثانية)', ad > 1.5 && ad < 2.6);
await A.setInputFiles('#imgPick', FX + '/t.mp4'); // صيغة المتصفح ده مش بيشغّلها: لازم يتحول لكارت تحميل بدل ما يفضل مكسور
await B.waitForFunction(() => [...document.querySelectorAll('.lrfCard strong')].some((e) => e.textContent === 't.mp4'), null, { timeout: 30000 });
ok('فيديو mp4 (كودك مش مدعوم في المتصفح ده) بيتحول لكارت تحميل', true);

// 4) PDF: كارت + زر فتح
await A.setInputFiles('#docFile', FX + '/t.pdf');
await B.waitForFunction(() => [...document.querySelectorAll('.lrfCard strong')].some((e) => e.textContent === 't.pdf'), null, { timeout: 30000 });
ok('PDF اتعرض ككارت', true);

// 5) HEIC من المعرض: لازم يفتح المعاينة (بدل رسالة "مش مدعوم") ويتبعت كصورة
await A.setInputFiles('#imgPick', FX + '/t.heic');
await A.waitForSelector('.lrp:not(.hidden)', { timeout: 40000 });
const pvW = await A.evaluate(() => document.getElementById('lrpCv').width);
ok('HEIC اتفك وظهر في المعاينة (width=1024)', pvW === 1024);
const before = await B.locator('#log img').count();
await A.click('#lrpSend');
await B.waitForFunction((n) => document.querySelectorAll('#log img').length > n, before, { timeout: 30000 });
ok('صورة HEIC وصلت لـ B كصورة', true);

// 6) HEIC كملف (بيتحوّل للعرض عند المستلم)
await A.setInputFiles('#docFile', FX + '/t.heic');
await B.waitForFunction(() => [...document.querySelectorAll('.lrfImg')].some((i) => i.naturalWidth === 1024), null, { timeout: 40000 });
ok('HEIC المرسل كملف اتعرض كصورة عند B', true);

// 7) إعادة تحميل B: كل حاجة ترجع من السجل
await B.reload(); await B.waitForTimeout(800); await B.locator('#permLater').click({ timeout: 1500 }).catch(() => {});
await B.waitForSelector('.roomCard', { timeout: 15000 }); await B.locator('.roomCard').first().click(); await B.fill('#pw', pw); await B.click('#pwGo');
await B.waitForSelector('video.lrfVid', { timeout: 30000 });
ok('بعد إعادة التحميل: الفيديو والصوت والملف الكبير رجعوا من السجل', await B.locator('audio.lrfAud').count() >= 1 && await B.locator('.lrfCard a[download]').count() >= 1);
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);
await browser.close();
console.log(fails ? fails + ' فشل' : 'كله تمام'); process.exit(fails ? 1 : 0);
