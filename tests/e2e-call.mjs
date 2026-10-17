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
const mk = async (sub, did, turnMode) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ar-EG', permissions: ['microphone', 'camera'] });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs; p.turnCalls = 0;
  if (turnMode === 'mock') await p.route('**/api/turn', (r) => { p.turnCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }] }) }); });
  await p.addInitScript(() => { sessionStorage.setItem('lr.permLater', '1'); window.__pcs = []; const O = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); window.__cfg = a[0]; return pc; }; window.RTCPeerConnection.prototype = O.prototype; window.__pc = () => window.__pcs[window.__pcs.length - 1]; });
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100));
  return p;
};
// 0) /api/turn بدون إعداد = 503 (والتطبيق بيكمل بـ STUN)
{ const A0 = await mk('u0' + stamp, '0'.repeat(24));
  const r = await A0.evaluate(async () => { const r = await fetch('/api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); return { s: r.status, d: await r.json() }; });
  ok('/api/turn بدون TURN_KEY_ID بيرجّع 503 turn_not_configured (من غير ما يكسر حاجة)', r.s === 503 && r.d.e === 'turn_not_configured');
  const anon = await fetch(BASE + '/api/turn', { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: '{}' });
  ok('/api/turn من غير جلسة = 401', anon.status === 401);
  await A0.context().close(); }
const A = await mk('ua' + stamp, 'a'.repeat(24), 'mock'), B = await mk('ub' + stamp, 'b'.repeat(24), 'mock');
for (const p of [A, B]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
const pw = 'Room-pw-' + stamp;
await A.click('#create'); await A.fill('#pw', pw); await A.click('#pwGo');
await A.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
const code = (await A.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0];
await B.click('#joinOpen'); await B.fill('#codeIn', code); await B.click('#join'); await B.fill('#pw', pw); await B.click('#pwGo');
await A.waitForFunction(() => document.getElementById('status')?.textContent === 'متصل', null, { timeout: 15000 }).catch(() => {});
ok('الطرفين دخلوا الغرفة', (await A.locator('#status').innerText()) === 'متصل');
ok('اتجاب TURN/ICE من السيرفر عند دخول الغرفة (prefetch)', A.turnCalls >= 1 && B.turnCalls >= 1);

// 1) مكالمة صوت
await A.click('#callA');
await B.waitForSelector('#incoming:not(.hidden)', { timeout: 15000 }).catch(() => {});
ok('B شاف المكالمة الجاية', await B.locator('#incoming').isVisible());
await B.click('#acceptBtn');
const connected = (p) => p.waitForFunction(() => document.getElementById('callStatus')?.textContent === 'متصل', null, { timeout: 20000 }).then(() => true).catch(() => false);
const [ca, cb] = await Promise.all([connected(A), connected(B)]);
ok('A وصل لحالة "متصل"', ca); ok('B وصل لحالة "متصل"', cb);
const t0 = Date.now();
const stats = (p) => p.evaluate(async () => { const s = await __pc().getStats(); let r = 0, bytes = 0, pairs = []; s.forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'audio') { r += x.packetsReceived || 0; bytes += x.bytesReceived || 0; } if (x.type === 'candidate-pair' && x.nominated) pairs.push(x.state); }); return { r, bytes, st: __pc().connectionState }; });
await A.waitForTimeout(2500);
const sa = await stats(A), sb = await stats(B);
ok('الصوت بيعدّي فعلاً الاتجاهين (packets > 0): A=' + sa.r + ' B=' + sb.r, sa.r > 20 && sb.r > 20);
const sdpA = await A.evaluate(() => __pc().localDescription.sdp), sdpB = await B.evaluate(() => __pc().localDescription.sdp);
ok('Opus مضبوط: FEC + DTX + mono + سقف بيت-ريت', /useinbandfec=1/.test(sdpA) && /usedtx=1/.test(sdpA) && /maxaveragebitrate=\d+/.test(sdpA) && /stereo=0/.test(sdpB));
console.log('   fmtp: ' + (sdpA.match(/a=fmtp:\d+ [^\r\n]*useinbandfec[^\r\n]*/) || [''])[0].slice(0, 200));
ok('لسه ما اتسجلش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log('   errs:', A.errs, B.errs);

// 2) ICE restart: نحاكي "disconnected" على A (الطرف المتصل) فيعيد المحاولة فعلاً بكود التطبيق
const before = await stats(B);
await A.evaluate(() => { const pc = __pc(); Object.defineProperty(pc, 'connectionState', { get: () => 'disconnected', configurable: true }); pc.onconnectionstatechange(); });
await A.waitForTimeout(800);
ok('عند الانقطاع بيظهر "الاتصال ضعيف"', (await A.locator('#callStatus').innerText()).includes('ضعيف'));
await A.waitForFunction(() => document.getElementById('callStatus').textContent.includes('يعيد'), null, { timeout: 9000 }).catch(() => {});
ok('بعد ~4 ثواني بيبدأ إعادة الاتصال تلقائياً ("بيعيد الاتصال")', (await A.locator('#callStatus').innerText()).includes('يعيد'));
await A.evaluate(() => { const pc = __pc(); delete pc.connectionState; pc.onconnectionstatechange(); });
await A.waitForTimeout(3500);
const rA = await A.evaluate(() => __pc().connectionState), rB = await B.evaluate(() => __pc().connectionState);
const after = await stats(B);
ok('بعد إعادة محاولة ICE الاتنين لسه connected', rA === 'connected' && rB === 'connected');
ok('الصوت كمّل بعد إعادة المحاولة (packets زادت): ' + before.r + ' → ' + after.r, after.r > before.r + 20);
ok('الحالة رجعت "متصل"', (await A.locator('#callStatus').innerText()) === 'متصل');
const ufrag = (sd) => (sd.match(/a=ice-ufrag:(\S+)/) || [])[1];
ok('إعادة المحاولة غيّرت ice-ufrag (restart حقيقي)', ufrag(sdpA) !== ufrag(await A.evaluate(() => __pc().localDescription.sdp)));
await A.click('#hangBtn'); await A.waitForTimeout(1200);
ok('إنهاء المكالمة بيقفل عند الطرفين', await A.locator('#call').evaluate((e) => e.classList.contains('hidden')) && await B.locator('#call').evaluate((e) => e.classList.contains('hidden')));

// 3) مكالمة فيديو + وضع التوفير: نحاكي شبكة وحشة بإحصائيات مزيّفة، التطبيق لازم يخفّض ثم يوقف الفيديو ويحافظ على الصوت ثم يرجّعه
await A.click('#callV'); await B.waitForSelector('#incoming:not(.hidden)', { timeout: 15000 }).catch(() => {}); await B.click('#acceptBtn');
const [va, vb] = await Promise.all([connected(A), connected(B)]);
ok('مكالمة فيديو: الاتنين وصلوا', va && vb);
await A.waitForTimeout(2000);
const vv = await B.evaluate(async () => { const s = await __pc().getStats(); let f = 0; s.forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'video') f += x.framesDecoded || 0; }); return f; });
ok('الفيديو بيوصل (frames=' + vv + ')', vv > 5);
const encP = () => A.evaluate(() => { const g = (k) => __pc().getSenders().find((s) => s.track?.kind === k).getParameters().encodings[0]; return { a: g('audio').maxBitrate, v: g('video').maxBitrate, act: g('video').active, sc: g('video').scaleResolutionDownBy }; });
const e0 = await encP(); ok('البداية: صوت 32kbps / فيديو 600kbps: ' + JSON.stringify(e0), e0.a === 32000 && e0.v === 600000 && e0.act !== false);
await A.evaluate(() => { const pc = __pc(), real = pc.getStats.bind(pc); window.__realStats = real; let n = 0; pc.getStats = async () => new Map([['a', { type: 'inbound-rtp', isRemote: false, packetsReceived: (n += 40), packetsLost: n }], ['b', { type: 'candidate-pair', selected: true, currentRoundTripTime: 0.9 }]]); });
await A.waitForTimeout(5500);
const e1 = await encP(); ok('شبكة ضعيفة (4 ثواني): بيخفّض الفيديو (150kbps) والصوت 16kbps: ' + JSON.stringify(e1), e1.a === 16000 && e1.v === 150000 && e1.sc === 2);
await A.waitForTimeout(5000);
const e2 = await encP(); const st2 = await A.locator('#callStatus').innerText();
ok('شبكة سيئة جداً (8 ثواني): الفيديو بيقف والصوت يكمل — "' + st2 + '"', e2.act === false && st2.includes('الصوت'));
await A.evaluate(() => { __pc().getStats = window.__realStats; });
await A.waitForTimeout(12000);
const e3 = await encP(); ok('الشبكة رجعت: كل حاجة رجعت طبيعي: ' + JSON.stringify(e3), e3.act === true && e3.v === 600000 && e3.a === 32000);
await A.click('#hangBtn'); await A.waitForTimeout(800);
ok('مفيش أخطاء JS في الاختبار كله', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log('   errs:', A.errs, B.errs);
console.log(fails ? `\n${fails} فشل` : '\nكله تمام'); await browser.close(); process.exit(fails ? 1 : 0);
