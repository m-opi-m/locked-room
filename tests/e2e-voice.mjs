// اختبار حقيقي (1.15.0): تسجيل الصوت بالضغط المطوّل / القفل / الإلغاء، الفقاعة بالموجة، السرعة، وعلامة "اتسمعت" الزرقا.
// ميك وهمي في Chromium (--use-fake-device-for-media-stream).
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1 --var SESSION_SECRET:<40×x>  ثم  node tests/e2e-voice.mjs
import { createRequire } from 'node:module';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8787', SECRET = 'x'.repeat(40), enc = new TextEncoder();
const SHOTS = process.env.SHOTS || '';
const b64u = (b) => Buffer.from(b).toString('base64url');
async function pending(sub, did) {
  const body = b64u(enc.encode(JSON.stringify({ sub, email: sub + '@t.c', name: sub, did, ok: false, v: '', rs: false, exp: Date.now() + 9e5 })));
  const k = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return body + '.' + b64u(await crypto.subtle.sign('HMAC', k, enc.encode(body)));
}
async function sid(sub, did) {
  const s = await pending(sub, did);
  const r = await fetch(BASE + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `did=${did}; sid=${s}`, Origin: BASE }, body: JSON.stringify({ pw: 'Passw0rd!acct' }) });
  const c = (r.headers.getSetCookie?.() || []).map((x) => x.match(/^sid=([^;]*)/)?.[1]).find(Boolean);
  if (!c) throw Error('setup failed ' + r.status + ' ' + await r.text());
  return c;
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const stamp = Date.now(); let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const mk = async (sub, did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ar-EG', permissions: ['microphone'] });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs;
  await p.addInitScript(() => { sessionStorage.setItem('lr.permLater', '1'); const A0 = window.Audio; window.__aud = []; window.Audio = function (...a) { const x = new A0(...a); window.__aud.push(x); return x; }; });
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
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const vis = (p, sel) => p.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && r.width > 0 && r.height > 0; });
const voices = (p) => p.locator('.voiceMessage').count();
const micBox = async (p) => (await p.locator('#recordBtn').boundingBox());
const rtl = (await A.evaluate(() => document.documentElement.dir)) === 'rtl';

// ---- 0) شريط الكتابة ----
ok('زر الإيموجي اتشال', (await A.locator('#emojiBtn').count()) === 0);
ok('زر الكاميرا ظاهر في الشريط', await vis(A, '#cameraBtn'));
ok('الميك ظاهر والإرسال مخفي (الشريط فاضي)', (await vis(A, '#recordBtn')) && !(await vis(A, '#sendBtn')));
await A.fill('#msg', 'x');
ok('لما أكتب: الإرسال يظهر والميك يختفي', (await vis(A, '#sendBtn')) && !(await vis(A, '#recordBtn')));
await A.fill('#msg', '');
ok('بعد المسح: الميك يرجع', (await vis(A, '#recordBtn')) && !(await vis(A, '#sendBtn')));
await shot(A, '0-bar');

// ---- 1) ضغطة واحدة = وضع القفل ----
await A.click('#recordBtn');
await A.waitForTimeout(300);
ok('ضغطة وحدة: دخل وضع القفل', await A.locator('.composer').evaluate((e) => e.classList.contains('vlock')));
ok('أزرار القفل ظاهرة (حذف/إيقاف مؤقت/إرسال)', (await vis(A, '#cancelRecord')) && (await vis(A, '#vbPause')) && (await vis(A, '#vbSend')));
await A.waitForTimeout(1800);
const t1 = await A.locator('#vbTimer2').innerText();
ok('العداد شغال (' + t1 + ')', !/^[0٠]:[0٠][0٠]$/.test(t1));
ok('الطرف التاني بيشوف "بيسجل..."', /بيسجل/.test(await B.locator('#activity').innerText()));
await shot(A, '1-locked');
const nz = await A.locator('#vbCanvas').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n; });
ok('موجة الصوت اتحسمت على الكانفس', nz > 20);
await A.click('#vbPause'); await A.waitForTimeout(300);
const tp = await A.locator('#vbTimer2').innerText(); await A.waitForTimeout(900);
ok('إيقاف مؤقت: العداد وقف', tp === await A.locator('#vbTimer2').innerText());
ok('الزر بقى "استئناف"', /استئناف/.test(await A.locator('#vbPauseLbl').innerText()));
await shot(A, '1b-paused');
await A.click('#vbPause'); await A.waitForTimeout(900);
ok('استئناف: العداد كمّل', tp !== await A.locator('#vbTimer2').innerText());
await A.click('#vbSend');
await B.waitForFunction(() => document.querySelectorAll('.voiceMessage').length >= 1, null, { timeout: 15000 }).catch(() => {});
ok('الرسالة وصلت للطرف التاني', (await voices(B)) === 1);
ok('الرسالة ظهرت عندي كمان', (await voices(A)) === 1);
ok('وضع التسجيل اتقفل بعد الإرسال', !(await A.locator('.composer').evaluate((e) => e.classList.contains('vrec'))));
const bars = await B.locator('.voiceMessage .vmWave > i:not(.vmDot)').count();
ok('الموجة 48 عمود (' + bars + ')', bars === 48);
const heights = await B.locator('.voiceMessage .vmWave > i:not(.vmDot)').evaluateAll((l) => l.map((x) => parseFloat(x.style.height)));
ok('الموجة مختلفة الارتفاعات (من الصوت الحقيقي)', Math.max(...heights) > Math.min(...heights) * 3);
const dur1 = await B.locator('.voiceMessage .vmDur').first().innerText();
ok('المدة ظاهرة (' + dur1 + ')', /[1-9١-٩]/.test(dur1));
await shot(B, '2-bubble-received');

// ---- 2) ضغط مطوّل ثم شيل الإيد = إرسال ----
let bx = await micBox(A); const mx = bx.x + bx.width / 2, my = bx.y + bx.height / 2;
await A.mouse.move(mx, my); await A.mouse.down();
await A.waitForTimeout(900);
ok('أثناء الضغط: شريط التسجيل + "اسحب للإلغاء" + القفل ظاهرين', (await vis(A, '#vbHint')) && (await vis(A, '#voiceLock')) && !(await A.locator('.composer').evaluate((e) => e.classList.contains('vlock'))));
await shot(A, '3-hold');
await A.waitForTimeout(500);
await A.mouse.up();
await B.waitForFunction(() => document.querySelectorAll('.voiceMessage').length >= 2, null, { timeout: 15000 }).catch(() => {});
ok('ضغط مطوّل ثم شيل: اتبعتت', (await voices(B)) === 2);

// ---- 3) ضغط مطوّل + سحب لفوق = قفل (يكمّل من غير إيد) ----
await A.mouse.move(mx, my); await A.mouse.down(); await A.waitForTimeout(700);
await A.mouse.move(mx, my - 40, { steps: 4 }); await A.mouse.move(mx, my - 110, { steps: 6 });
await A.waitForTimeout(250);
ok('سحب لفوق: دخل القفل', await A.locator('.composer').evaluate((e) => e.classList.contains('vlock')));
await A.mouse.up(); await A.waitForTimeout(1200);
ok('بعد شيل الإيد لسه بيسجّل', await A.locator('.composer').evaluate((e) => e.classList.contains('vlock')));
// حذف
await A.click('#cancelRecord'); await A.waitForTimeout(500);
ok('الحذف: وضع التسجيل اتقفل', !(await A.locator('.composer').evaluate((e) => e.classList.contains('vrec'))));
await B.waitForTimeout(700);
ok('الحذف: مفيش رسالة اتبعتت', (await voices(B)) === 2 && (await voices(A)) === 2);
ok('الطرف التاني مبقاش بيشوف "بيسجل"', !(/بيسجل/.test(await B.locator('#activity').innerText())));

// ---- 4) ضغط مطوّل + سحب ناحية الشريط = إلغاء ----
await A.mouse.move(mx, my); await A.mouse.down(); await A.waitForTimeout(700);
await A.mouse.move(mx + (rtl ? 1 : -1) * 50, my, { steps: 4 });
await shot(A, '4-slide-cancel');
await A.mouse.move(mx + (rtl ? 1 : -1) * 140, my, { steps: 6 });
await A.waitForTimeout(300);
ok('سحب للإلغاء: وضع التسجيل اتقفل', !(await A.locator('.composer').evaluate((e) => e.classList.contains('vrec'))));
await A.mouse.up(); await B.waitForTimeout(700);
ok('سحب للإلغاء: مفيش رسالة اتبعتت', (await voices(B)) === 2);

// ---- 5) التشغيل والسرعة وعلامة "اتسمعت" ----
const playedA = (i) => A.locator('.voiceMessage').nth(i).evaluate((e) => e.classList.contains('played'));
ok('عند المرسل: العلامة رمادي (لسه مسمعتش)', !(await playedA(0)));
const col = (p, i) => p.locator('.voiceMessage .vmPlay').nth(i).evaluate((e) => getComputedStyle(e).color);
const grey = await col(A, 0);
await B.locator('.voiceMessage .vmPlay').first().click(); await B.waitForTimeout(500);
ok('التشغيل: الفقاعة بقت playing + زر السرعة ظاهر', (await B.locator('.voiceMessage').first().evaluate((e) => e.classList.contains('playing'))) && (await vis(B, '.voiceMessage.playing .vmSpeed')));
await shot(B, '5-playing');
await B.locator('.voiceMessage.playing .vmSpeed').click(); await B.waitForTimeout(200);
ok('السرعة ×1.5', (await B.locator('.voiceMessage.playing .vmSpeed').innerText()) === '×1.5');
ok('playbackRate اتغيّر فعلاً', 1.5 === (await B.evaluate(() => (window.__aud.find((x) => !x.paused) || {}).playbackRate)));
await B.locator('.voiceMessage.playing .vmSpeed').click(); await B.waitForTimeout(100);
ok('السرعة ×2', (await B.locator('.voiceMessage.playing .vmSpeed').innerText()) === '×2');
await B.waitForTimeout(300);
const prog = await B.locator('.voiceMessage').first().evaluate((e) => e.querySelectorAll('.vmWave > i.on').length);
ok('التقدم بيتلوّن على الموجة (' + prog + ')', prog > 0);
await B.locator('.voiceMessage.playing .vmSpeed').click(); await B.waitForTimeout(80);
ok('السرعة رجعت ×1 (الدورة ×1 ← ×1.5 ← ×2 ← ×1)', (await B.locator('.voiceMessage.playing .vmSpeed').innerText()) === '×1');
await B.locator('.voiceMessage .vmPlay').first().click(); await B.waitForTimeout(250);
ok('إيقاف مؤقت للتشغيل: الصورة رجعت', !(await B.locator('.voiceMessage').first().evaluate((e) => e.classList.contains('playing'))));
await A.waitForFunction(() => document.querySelector('.voiceMessage').classList.contains('played'), null, { timeout: 8000 }).catch(() => {});
ok('عند المرسل: العلامة بقت زرقا بعد ما التاني سمع', await playedA(0));
const blue = await col(A, 0);
ok('اللون فعلاً اتغيّر من الرمادي للأزرق (' + grey + ' → ' + blue + ')', grey !== blue && /rgb\(83, 189, 235\)/.test(blue));
ok('الرسالة التانية لسه رمادي عند المرسل', !(await playedA(1)));
await shot(A, '6-played-blue');
// تقديم بالضغط على الموجة
const wb = await B.locator('.voiceMessage .vmWave').first().boundingBox();
await B.mouse.click(wb.x + wb.width * 0.7, wb.y + wb.height / 2); await B.waitForTimeout(300);
const ct = await B.evaluate(() => [...document.querySelectorAll('.voiceMessage')].length);
ok('الضغط على الموجة مبيكسرش حاجة', ct === 2 && B.errs.length === 0);

// ---- 6) بعد الريفريش: العلامة الزرقا ترجع من التاريخ ----
await A.reload(); await A.waitForTimeout(1200);
await A.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100));
await A.locator('#permLater').click({ timeout: 1500 }).catch(() => {});
const room = A.locator('.roomRow, .roomItem, [data-code], #roomList button, #roomList li').first();
const inChat = await A.locator('#chat:not(.hidden)').count();
if (!inChat) {
  await room.click({ timeout: 4000 }).catch(() => {});
  await A.fill('#pw', pw).catch(() => {}); await A.click('#pwGo').catch(() => {});
}
await A.waitForFunction(() => document.querySelectorAll('.voiceMessage').length >= 2, null, { timeout: 15000 }).catch(() => {});
await A.waitForTimeout(800);
ok('بعد الريفريش: الرسايل الصوتية ظاهرة', (await voices(A)) === 2);
ok('بعد الريفريش: العلامة الزرقا لسه موجودة', (await A.locator('.voiceMessage').first().evaluate((e) => e.classList.contains('played'))) && !(await A.locator('.voiceMessage').nth(1).evaluate((e) => e.classList.contains('played'))));
await shot(A, '7-after-reload');

ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log(A.errs, B.errs);
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
