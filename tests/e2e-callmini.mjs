// اختبار حقيقي (1.10.0): المكالمة المصغّرة + عدم طلب الباسورد تاني + الكاميرتين مقفولين = مكالمة عادية.
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-callmini.mjs
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
  await p.addInitScript(() => { sessionStorage.setItem('lr.permLater', '1'); window.__pcs = []; const O = window.RTCPeerConnection; window.RTCPeerConnection = function (...a) { const pc = new O(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = O.prototype; window.__pc = () => window.__pcs[window.__pcs.length - 1]; });
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100));
  return p;
};
const until = async (p, fn, arg, ms = 8000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true).catch(() => false);
const A = await mk('ua' + stamp, 'a'.repeat(24)), B = await mk('ub' + stamp, 'b'.repeat(24));
for (const p of [A, B]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
const pw = 'Room-pw-' + stamp;
const mkRoom = async (p, password) => {
  await p.click('#create'); await p.fill('#pw', password); await p.click('#pwGo');
  await p.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
  return (await p.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0];
};
const code = await mkRoom(A, pw);
await B.click('#joinOpen'); await B.fill('#codeIn', code); await B.click('#join'); await B.fill('#pw', pw); await B.click('#pwGo');
await A.waitForFunction(() => document.getElementById('status')?.textContent === 'متصل', null, { timeout: 15000 }).catch(() => {});
ok('الطرفين دخلوا الغرفة', (await A.locator('#status').innerText()) === 'متصل');
const connected = (p) => until(p, () => document.getElementById('callStatus')?.textContent === 'متصل', null, 20000);
const hidden = (p, sel) => p.locator(sel).evaluate((e) => e.classList.contains('hidden'));
const isAudio = (p) => p.locator('#call').evaluate((e) => e.classList.contains('audio'));
const isMini = (p) => p.locator('#call').evaluate((e) => e.classList.contains('mini'));
const audioPk = (p) => p.evaluate(async () => { const s = await __pc().getStats(); let r = 0; s.forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'audio') r += x.packetsReceived || 0; }); return r; });

// 1) مكالمة صوت
await A.click('#callA'); await B.waitForSelector('#incoming:not(.hidden)', { timeout: 15000 }).catch(() => {}); await B.click('#acceptBtn');
const [ca, cb] = await Promise.all([connected(A), connected(B)]); ok('مكالمة صوت اتوصلت', ca && cb);

// 2) تصغير: شريط علوي + عداد
await A.click('#callMin'); await A.waitForTimeout(400);
ok('بعد التصغير: شريط المكالمة ظاهر', await isMini(A) && await A.locator('#miniOpen').isVisible());
const bar = await A.locator('#call').boundingBox();
ok('الشريط فوق الشاشة وارتفاعه ~52px (' + Math.round(bar.height) + ')', bar.y === 0 && bar.height >= 50 && bar.height <= 60 && bar.width >= 380);
const t1 = await A.locator('#miniTime').innerText(); await A.waitForTimeout(2200); const t2 = await A.locator('#miniTime').innerText();
ok('العداد شغال: ' + t1 + ' → ' + t2, /^\d\d:\d\d$/.test(t1) && t1 !== t2);
const hb = await A.locator('#chat > header').boundingBox();
ok('هيدر الشات نزل تحت الشريط (y=' + Math.round(hb.y) + ')', hb.y >= bar.height - 1);
ok('الشات لسه ظاهر وقابل للاستخدام (الكومبوزر جوه الشاشة)', (await A.locator('#msg').boundingBox()).y + 10 < 800);

// 3) كتم من الشريط
const mic = (p) => p.evaluate(() => document.getElementById('localVid').srcObject.getAudioTracks()[0].enabled);
await A.click('#miniMute'); await A.waitForTimeout(300);
ok('كتم من الشريط: الميك اتقفل', (await mic(A)) === false);
await A.click('#miniMute'); await A.waitForTimeout(300);
ok('وإلغاء الكتم', (await mic(A)) === true);

// 4) الرجوع للقايمة والمكالمة شغالة
await A.click('#homeChat'); await A.waitForTimeout(600);
ok('رجعت للقايمة', !(await hidden(A, '#home')));
ok('الشريط لسه ظاهر فوق القايمة', await isMini(A) && await A.locator('#miniOpen').isVisible());
ok('المكالمة لسه شغالة عند B', !(await hidden(B, '#call')) && (await B.locator('#callStatus').innerText()) === 'متصل');
const p1 = await audioPk(B); await A.waitForTimeout(1500); const p2 = await audioPk(B);
ok('الصوت لسه بيوصل B وA في القايمة (' + p1 + ' → ' + p2 + ')', p2 > p1 + 10);
await B.click('#callMin'); await B.fill('#msg', 'hello-from-B'); await B.click('#sendBtn'); await B.waitForTimeout(800); await B.click('#miniOpen'); await B.waitForTimeout(300);

// 5) الدخول للشات تاني من غير باسورد، والمكالمة لسه شغالة
await A.locator('.roomCard').first().click(); await A.waitForTimeout(1500);
ok('دخل الشات من غير ما يطلب باسورد', !(await hidden(A, '#chat')) && (await hidden(A, '#lock')));
ok('الرسالة اللي اتبعتت وهو برا ظهرت', (await A.locator('#log').innerText()).includes('hello-from-B'));
ok('الشريط لسه ظاهر والمكالمة شغالة', await isMini(A) && (await A.locator('#miniTime').innerText()).length === 5);
ok('أزرار الاتصال متقفلة وقت المكالمة', await A.locator('#callA').isDisabled() && await A.locator('#callV').isDisabled());
ok('الشات اتوصل تاني (متصل)', (await A.locator('#status').innerText()) === 'متصل');
await A.fill('#msg', 'reply-from-A'); await A.click('#sendBtn'); await B.waitForTimeout(800);
ok('الرسايل بتتبعت بعد الرجوع والمكالمة شغالة', (await B.locator('#log').innerText()).includes('reply-from-A'));
const q1 = await audioPk(B); await A.waitForTimeout(1200); const q2 = await audioPk(B);
ok('الصوت كمّل (' + q1 + ' → ' + q2 + ')', q2 > q1 + 10);

// 6) فتح المكالمة من الشريط وتصغيرها
await A.click('#miniOpen'); await A.waitForTimeout(400);
ok('فتح المكالمة بيرجعها لكامل الشاشة', !(await isMini(A)) && (await A.locator('#call').boundingBox()).height > 700);
await A.click('#callMin'); await A.waitForTimeout(300);
ok('وتصغير تاني', await isMini(A));
await A.click('#miniOpen'); await A.waitForTimeout(300);

// 7) كاميرا + الكاميرتين مقفولين = مكالمة عادية
await A.click('#camBtn'); const vA = await until(B, () => !document.getElementById('call').classList.contains('audio') && document.getElementById('remoteVid').srcObject?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted), null, 15000);
ok('A شغّل الكاميرا: B شايف الفيديو', vA);
await B.click('#camBtn'); const vB = await until(A, () => !document.getElementById('call').classList.contains('audio') && document.getElementById('remoteVid').srcObject?.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted), null, 15000);
ok('B شغّل الكاميرا: A شايف الفيديو', vB);
await A.click('#camBtn'); await B.waitForTimeout(1500);
ok('A قفل كاميرته: B رجع شاشة مكالمة عادية (ومش شايف فريمات سودا)', await isAudio(B));
ok('A لسه شايف فيديو B', !(await isAudio(A)));
await B.click('#camBtn'); await A.waitForTimeout(1500);
ok('الاتنين قفلوا: A بقت مكالمة عادية', await isAudio(A));
ok('الاتنين قفلوا: B كمان مكالمة عادية', await isAudio(B));
ok('وعداد المكالمة لسه ماشي', /^\d\d:\d\d$/.test(await A.locator('#callElapsed').innerText()));
await A.click('#camBtn'); const again = await until(B, () => !document.getElementById('call').classList.contains('audio'), null, 8000);
ok('A شغّل كاميرته تاني: B رجع يشوف فيديو', again);

// 8) مربع الفيديو العايم عند B (A كاميرته شغالة)
await B.click('#camBtn'); await B.waitForTimeout(600);       // B يشغّل كاميرته: A لسه شايفه
await B.click('#callMin'); await B.waitForTimeout(500);
const sq = await B.locator('#call').boundingBox();
ok('B صغّر: بقى مربع عايم ~112×150 (' + Math.round(sq.width) + '×' + Math.round(sq.height) + ')', await isMini(B) && !(await isAudio(B)) && Math.abs(sq.width - 112) < 4 && Math.abs(sq.height - 150) < 4);
ok('المربع بيعرض كاميرا A (فيديو شغال)', await B.evaluate(() => { const v = document.getElementById('remoteVid'); return v.videoWidth > 0 && getComputedStyle(v).opacity === '1'; }));
ok('وA لسه شايف B (B بيبعت كاميرته وهو مصغّر)', !(await isAudio(A)) && await A.evaluate(() => document.getElementById('remoteVid').srcObject.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted)));
const cx = sq.x + sq.width / 2, cy = sq.y + sq.height / 2;
await B.mouse.move(cx, cy); await B.mouse.down(); await B.mouse.move(cx - 150, cy + 250, { steps: 8 }); await B.mouse.up(); await B.waitForTimeout(300);
const sq2 = await B.locator('#call').boundingBox();
ok('سحب المربع العايم: اتحرك (' + Math.round(sq.x) + ',' + Math.round(sq.y) + ' → ' + Math.round(sq2.x) + ',' + Math.round(sq2.y) + ') وفضل مصغّر', Math.abs(sq2.x - (sq.x - 150)) < 8 && Math.abs(sq2.y - (sq.y + 250)) < 8 && await isMini(B));
await B.mouse.move(sq2.x + 20, sq2.y + 20); await B.mouse.down(); await B.mouse.move(-800, 3000, { steps: 6 }); await B.mouse.up();
const sq3 = await B.locator('#call').boundingBox();
ok('المربع بيتقيّد جوه الشاشة', sq3.x >= 0 && sq3.y >= 0 && sq3.x + sq3.width <= 391 && sq3.y + sq3.height <= 801);
await B.click('#homeChat'); await B.waitForTimeout(500);
ok('B رجع للقايمة والمربع لسه عايم والمكالمة شغالة', await isMini(B) && !(await hidden(B, '#home')) && !(await hidden(A, '#call')));
await B.locator('.roomCard').first().click(); await B.waitForTimeout(1200);
ok('B دخل الشات من غير باسورد', (await hidden(B, '#lock')) && !(await hidden(B, '#chat')));
await B.mouse.click(sq3.x + 40, sq3.y + 40); await B.waitForTimeout(400);
ok('لمسة على المربع بتفتح المكالمة كاملة', !(await isMini(B)) && (await B.locator('#call').boundingBox()).height > 700);

// 9) الاتنين قفلوا الكاميرا -> شريط، وقفل من الشريط عند A
await B.click('#camBtn'); await A.click('#camBtn'); await A.waitForTimeout(1500);
await A.click('#callMin'); await A.waitForTimeout(500);
ok('كاميرتين مقفولين + تصغير = شريط (مش مربع)', await isAudio(A) && await A.locator('#miniHang').isVisible());
await A.click('#miniHang'); await B.waitForTimeout(1500);
ok('قفل من الشريط: المكالمة خلصت عند الطرفين', (await hidden(A, '#call')) && (await hidden(B, '#call')));
ok('والشريط اختفى والمحتوى رجع مكانه', await A.evaluate(() => !document.body.classList.contains('callBarOn')) && (await A.locator('#chat > header').boundingBox()).y < 5);

// 10) مكالمة شغالة + فتح غرفة تانية
await A.click('#callA'); await B.waitForSelector('#incoming:not(.hidden)', { timeout: 15000 }).catch(() => {}); await B.click('#acceptBtn');
const [c2a, c2b] = await Promise.all([connected(A), connected(B)]); ok('مكالمة جديدة اتوصلت', c2a && c2b);
await A.click('#callMin'); await A.click('#homeChat'); await A.waitForTimeout(500);
const code2 = await mkRoom(A, pw + '-second');
ok('فتح غرفة تانية والمكالمة (بتاعة الغرفة الأولى) لسه شغالة', !(await hidden(B, '#call')) && await isMini(A) && await A.locator('#miniOpen').isVisible());
ok('الغرفة الجديدة مش بتنهي المكالمة (B لسه متصل)', (await B.locator('#callStatus').innerText()) === 'متصل');
ok('أزرار الاتصال متقفلة في الغرفة التانية', await A.locator('#callA').isDisabled());
await A.click('#miniHang'); await B.waitForTimeout(1500);
ok('قفل المكالمة من الغرفة التانية بيقفلها عند B', (await hidden(A, '#call')) && (await hidden(B, '#call')));
ok('والغرفة التانية لسه شغالة (متصل بالسيرفر)', !(await hidden(A, '#chat')) && (await A.evaluate(() => !!document.getElementById('status'))));

// 11) الباسورد: مفيش قفل لو التطبيق اتخبّى فترة
await A.click('#homeChat'); await A.waitForTimeout(500);
await A.locator('.roomCard').first().click(); await A.waitForTimeout(1500);
ok('رجوع لغرفة من غير باسورد (من غير مكالمة)', (await hidden(A, '#lock')) && !(await hidden(A, '#chat')));
await A.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await A.waitForTimeout(7000);
await A.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await A.waitForTimeout(1200);
ok('بعد ما التطبيق اتخبّى 7 ثواني ورجع: الشات لسه مفتوح من غير باسورد', (await hidden(A, '#lock')) && !(await hidden(A, '#chat')));
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log('   errs:', A.errs, B.errs);
console.log(fails ? `\n${fails} فشل` : '\nكله تمام'); await browser.close(); process.exit(fails ? 1 : 0);
