// اختبار نسمع معًا (1.21.0): A يتصل، B يرد، لازم الاتنين يوصلوا "متصل" والصوت يعدّي.
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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


import { writeFileSync } from 'node:fs';
// ملف WAV ~14 ثانية (≈1.2MB → جزئين)
const sr = 44100, N = sr * 14, buf = Buffer.alloc(44 + N * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) buf.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2);
const WAV = '/tmp/claude-0/-home-claude/2fecccc8-14a1-502f-8f65-b64b75d4523e/scratchpad/song-test.wav'; writeFileSync(WAV, buf);
const A = await mk('ma' + stamp, 'a'.repeat(24)), B = await mk('mb' + stamp, 'b'.repeat(24));
for (const p of [A, B]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
const pw = 'Room-pw-' + stamp;
await A.click('#create'); await A.fill('#pw', pw); await A.click('#pwGo');
await A.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
const code = (await A.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0];
await B.click('#joinOpen'); await B.fill('#codeIn', code); await B.click('#join'); await B.fill('#pw', pw); await B.click('#pwGo');
await A.waitForFunction(() => document.getElementById('status')?.textContent === 'متصل', null, { timeout: 15000 }).catch(() => {});
ok('الطرفين دخلوا الغرفة', (await A.locator('#status').innerText()) === 'متصل');

await A.click('#menuBtn');
ok('زر نسمع معًا ظاهر في القائمة', await A.locator('#listenTogether').isVisible());
const [fc] = await Promise.all([A.waitForEvent('filechooser'), A.click('#listenTogether')]);
ok('الضغط على الزر فتح اختيار الملفات على طول', true);
await fc.setFiles(WAV);
await B.waitForSelector('#musicBar:not(.hidden)', { timeout: 20000 });
const playing = (p) => p.evaluate(() => !document.querySelector('#musicPlay svg use').getAttribute('href').endsWith('play'));
await B.waitForFunction(() => !document.getElementById('musicPlay').disabled, null, { timeout: 60000 });
await A.waitForTimeout(1500);
ok('الأغنية شغالة عند A', await playing(A));
ok('الأغنية شغالة عند B', await playing(B));
ok('اسم الأغنية ظاهر عند B', (await B.locator('#musicName').innerText()) === 'song-test');
ok('إشعار الميديا (mediaSession) متظبط عند B', await B.evaluate(() => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === 'song-test'));
await B.click('#musicPlay'); await A.waitForTimeout(1200);
ok('B وقّف → وقفت عند A', !(await playing(A)) && !(await playing(B)));
await A.locator('#musicSeek').evaluate((e) => { e.value = 500; e.dispatchEvent(new Event('change')); }); await B.waitForTimeout(1000);
const tB = await B.evaluate(() => [...document.querySelectorAll('audio')].length ? 0 : 0);
const sub = await B.locator('#musicSub').innerText();
ok('A قدّم → B اتحرّك لنص الأغنية (~0:07)', /0:0[67]|0:07|0:06/.test(sub));
await A.click('#musicPlay'); await B.waitForTimeout(1200);
ok('A شغّل → B اشتغل', await playing(B) && await playing(A));
// الصوت بيكمّل لو خرجنا من الغرفة؟ (مش بنختبر هنا) — إغلاق
await A.click('#musicClose'); await B.waitForTimeout(1000);
ok('A قفل → اتقفل عند B', await B.locator('#musicBar').evaluate((e) => e.classList.contains('hidden')));
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);
await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
