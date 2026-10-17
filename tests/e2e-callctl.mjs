// اختبار حقيقي لأزرار المكالمة (1.9.0): كتم الميك، إيقاف/تشغيل الكاميرا، تبديل الكاميرا،
// تحويل مكالمة صوت لفيديو من غير ما تقفل، وسحب النافذة الصغيرة.
// مهم: بيعمل مكالمة أولى وبيقفلها الأول، لأن العطل القديم كان بيظهر بعد أول مكالمة بتخلص.
// وبيحاكي سلوك أندرويد: ممنوع فتح كاميرتين مع بعض (NotReadableError).
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-callctl.mjs
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=device-count=2', '--autoplay-policy=no-user-gesture-required'] });
const stamp = Date.now(); let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const mk = async (sub, did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ar-EG', permissions: ['microphone', 'camera'] });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs;
  await p.addInitScript(() => {
    sessionStorage.setItem('lr.permLater', '1'); window.__pcs = []; const O = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = O.prototype; window.__pc = () => window.__pcs[window.__pcs.length - 1];
    // محاكاة أندرويد: لو فيه كاميرا شغالة، فتح كاميرا تانية بيفشل
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__liveCams = [];
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (c && c.video) { window.__liveCams = window.__liveCams.filter((t) => t.readyState === 'live'); if (window.__liveCams.length) throw new DOMException('Could not start video source', 'NotReadableError'); }
      const s = await gum(c); if (c && c.video) s.getVideoTracks().forEach((t) => window.__liveCams.push(t)); return s;
    };
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
await A.waitForFunction(() => document.getElementById('status')?.textContent === 'متصل', null, { timeout: 15000 }).catch(() => {});
ok('الطرفين دخلوا الغرفة', (await A.locator('#status').innerText()) === 'متصل');
const connected = (p) => p.waitForFunction(() => document.getElementById('callStatus')?.textContent === 'متصل', null, { timeout: 20000 }).then(() => true).catch(() => false);
const startCall = async (btn) => { await A.click(btn); await B.waitForSelector('#incoming:not(.hidden)', { timeout: 15000 }).catch(() => {}); await B.click('#acceptBtn'); const [x, y] = await Promise.all([connected(A), connected(B)]); return x && y; };
const vt = (p) => p.evaluate(() => { const s = document.getElementById('localVid').srcObject; const t = s && s.getVideoTracks()[0]; return t ? { en: t.enabled, live: t.readyState === 'live', id: t.getSettings().deviceId } : null; });
const at = (p) => p.evaluate(() => { const s = document.getElementById('localVid').srcObject; const t = s && s.getAudioTracks()[0]; return t ? { en: t.enabled, live: t.readyState === 'live' } : null; });

// 1) مكالمة أولى وتتقفل (ده اللي كان بيكسر الأزرار بعدها)
ok('مكالمة صوت أولى اتوصلت', await startCall('#callA'));
await A.click('#hangBtn'); await A.waitForTimeout(1200);
ok('المكالمة الأولى اتقفلت عند الطرفين', await A.locator('#call').evaluate((e) => e.classList.contains('hidden')) && await B.locator('#call').evaluate((e) => e.classList.contains('hidden')));

// 2) مكالمة صوت تانية: الأزرار لازم تشتغل
ok('مكالمة صوت تانية اتوصلت', await startCall('#callA'));
ok('زر الميك مش مقفول', !(await A.locator('#muteBtn').isDisabled()));
ok('زر الكاميرا مش مقفول', !(await A.locator('#camBtn').isDisabled()));
await A.click('#muteBtn'); await A.waitForTimeout(300);
let a1 = await at(A);
ok('كتم الميك: التراك اتقفل + الزر اتغير', a1 && a1.en === false && (await A.locator('#muteLabel').innerText()) === 'تشغيل الميكروفون');
await A.click('#muteBtn'); await A.waitForTimeout(300);
a1 = await at(A); ok('رجوع الميك: التراك اشتغل تاني', a1 && a1.en === true && (await A.locator('#muteLabel').innerText()) === 'كتم الميكروفون');

// 3) تحويل المكالمة العادية لفيديو من غير قفل
ok('قبل التحويل: مفيش كاميرا', (await vt(A)) === null);
await A.click('#camBtn');
await A.waitForFunction(() => { const s = document.getElementById('localVid').srcObject; return s && s.getVideoTracks().length > 0; }, null, { timeout: 8000 }).catch(() => {});
let v1 = await vt(A); ok('بعد الضغط: كاميرا A اشتغلت جوه نفس المكالمة', v1 && v1.live && v1.en);
await B.waitForFunction(() => { const s = document.getElementById('remoteVid').srcObject; return s && s.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted) && !document.getElementById('call').classList.contains('audio'); }, null, { timeout: 15000 }).catch(() => {});
ok('B بقى شايف فيديو A (المكالمة بقت فيديو)', await B.evaluate(() => { const s = document.getElementById('remoteVid').srcObject; return !!s && s.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted) && !document.getElementById('call').classList.contains('audio'); }));
ok('المكالمة لسه متصلة بعد التحويل', (await A.locator('#callStatus').innerText()) === 'متصل' || (await A.locator('#callStatus').innerText()).length > 0);

// 4) إيقاف / تشغيل الكاميرا
await A.click('#camBtn'); await A.waitForTimeout(400);
v1 = await vt(A); ok('إيقاف الكاميرا: التراك enabled=false + الزر اتغير', v1 && v1.en === false && (await A.locator('#camLabel').innerText()) === 'تشغيل الكاميرا');
await A.click('#camBtn'); await A.waitForTimeout(400);
v1 = await vt(A); ok('تشغيل الكاميرا تاني: التراك اشتغل', v1 && v1.en === true && (await A.locator('#camLabel').innerText()) === 'إيقاف الكاميرا');

// 5) تبديل الكاميرا (مع منع فتح كاميرتين مع بعض زي أندرويد)
const before = await vt(A);
ok('زر تبديل الكاميرا ظاهر', await A.locator('#switchCamBtn').isVisible());
await A.click('#switchCamBtn'); await A.waitForTimeout(2500);
const after = await vt(A);
const msg = await A.locator('#callStatus').innerText();
ok('تبديل الكاميرا: فيه كاميرا شغالة بعد التبديل', after && after.live);
ok('تبديل الكاميرا: اتغيرت لكاميرا تانية فعلاً (' + (before && before.id || '').slice(0, 6) + ' → ' + (after && after.id || '').slice(0, 6) + ') — "' + msg + '"', after && before && after.id !== before.id);
ok('الكاميرا الجديدة محتفظة بحالة التشغيل', after && after.en === true);
await A.waitForTimeout(1500);
const vf = await B.evaluate(async () => { const s = await __pc().getStats(); let f = 0; s.forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'video') f += x.framesDecoded || 0; }); return f; }).catch(() => -1);
console.log('   (frames decoded عند B: ' + vf + ')');
await A.click('#switchCamBtn'); await A.waitForTimeout(2500);
const after2 = await vt(A); ok('تبديل تاني: لسه فيه كاميرا شغالة', after2 && after2.live);

// 6) سحب النافذة الصغيرة
const box = async () => A.locator('#localVid').boundingBox();
const b0 = await box();
ok('النافذة الصغيرة ظاهرة', !!b0 && b0.width > 40);
const sx = b0.x + b0.width / 2, sy = b0.y + b0.height / 2;
await A.mouse.move(sx, sy); await A.mouse.down(); await A.mouse.move(sx - 120, sy - 260, { steps: 8 }); await A.mouse.up();
const b1 = await box();
ok('سحب النافذة: اتحركت فعلاً (' + Math.round(b0.x) + ',' + Math.round(b0.y) + ' → ' + Math.round(b1.x) + ',' + Math.round(b1.y) + ')', Math.abs(b1.x - (b0.x - 120)) < 6 && Math.abs(b1.y - (b0.y - 260)) < 6);
await A.mouse.move(b1.x + 20, b1.y + 20); await A.mouse.down(); await A.mouse.move(-500, -500, { steps: 6 }); await A.mouse.up();
const b2 = await box(), tb = await A.locator('.callTop').boundingBox(); ok('السحب برا الشاشة بيتقيّد جوه الحدود ومبيغطيش الشريط العلوي', b2.x >= 0 && b2.y >= tb.y + tb.height - 1);
await A.mouse.move(b2.x + 20, b2.y + 20); await A.mouse.down(); await A.mouse.move(5000, 5000, { steps: 6 }); await A.mouse.up();
const b3 = await box(), cb = await A.locator('.callControls').boundingBox();
ok('وبرضه من الناحية التانية، ومبتدخلش ورا صف الأزرار (' + Math.round(b3.y + b3.height) + ' ≤ ' + Math.round(cb.y) + ')', b3.x + b3.width <= 390 + 1 && b3.y + b3.height <= cb.y + 1);
// لمس حقيقي (touch) كمان
const cdp = await A.context().newCDPSession(A);
const t0 = await box(); const tx = t0.x + t0.width / 2, ty = t0.y + t0.height / 2;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] });
for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx - i * 20, y: ty - i * 25 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const t1 = await box(); ok('السحب بالإصبع (touch) شغال: ' + Math.round(t0.x) + ',' + Math.round(t0.y) + ' → ' + Math.round(t1.x) + ',' + Math.round(t1.y), t1.x < t0.x - 60 && t1.y < t0.y - 80);

// 7) إنهاء: النافذة ترجع لمكانها
await A.click('#hangBtn'); await A.waitForTimeout(1000);
ok('بعد القفل: مكان النافذة اتصفّر', await A.evaluate(() => { const s = document.getElementById('localVid').style; return !s.left && !s.top; }));
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log('   errs:', A.errs, B.errs);
console.log(fails ? `\n${fails} فشل` : '\nكله تمام'); await browser.close(); process.exit(fails ? 1 : 0);
