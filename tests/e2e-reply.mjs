// اختبار حقيقي (1.11.0): الرد على رسالة — سحب لليمين، قايمة الضغط المطوّل، شريط الرد، الاقتباس عند الطرفين، والتاريخ بعد إعادة الدخول.
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-reply.mjs
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const stamp = Date.now(); let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const mk = async (sub, did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ar-EG' });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs;
  await p.addInitScript(() => sessionStorage.setItem('lr.permLater', '1'));
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100));
  p.cdp = await ctx.newCDPSession(p);
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

const send = async (p, txt) => { await p.fill('#msg', txt); await p.click('#sendBtn'); await p.waitForTimeout(700); };
const bubble = (p, txt) => p.locator('.m', { has: p.locator(':scope > p', { hasText: txt }) }).last();
const swipe = async (p, loc, dx, dy = 0) => {
  const b = await loc.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 10, y: y + dy * i / 10 }] });
  await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
};
const barShown = (p) => p.locator('#replyBar').evaluate((e) => !e.classList.contains('hidden'));

await send(B, 'hello-original');
await A.waitForTimeout(500);
// 1) سحب قصير: مفيش رد
await swipe(A, bubble(A, 'hello-original'), 30);
ok('سحب قصير (30px) مبيعملش رد', !(await barShown(A)));
// 2) سحب لمسافة كافية لليمين
await swipe(A, bubble(A, 'hello-original'), 110);
ok('سحب لليمين: شريط الرد ظهر', await barShown(A));
ok('الشريط فيه نص الرسالة الأصلية', (await A.locator('#replyText').innerText()).includes('hello-original'));
ok('واسم صاحبها (الطرف التاني)', (await A.locator('#replyWho').innerText()).length > 0 && (await A.locator('#replyWho').innerText()) !== 'أنت');
ok('والبابل رجعت لمكانها بعد السحب', (await bubble(A, 'hello-original').evaluate((e) => e.style.translate)) === '');
const sb = await A.locator('#replyBar').boundingBox(); const cb = await A.locator('.composer').boundingBox();
ok('الشريط فوق صندوق الكتابة مباشرة (' + Math.round(sb.y + sb.height) + ' ≈ ' + Math.round(cb.y) + ')', sb.y + sb.height <= cb.y + 14 && sb.y + sb.height >= cb.y - 4);
// 3) إرسال الرد
await send(A, 'my-answer');
ok('بعد الإرسال الشريط اتقفل', !(await barShown(A)));
const aQ = bubble(A, 'my-answer').locator('.replyQuote');
ok('عند A: رسالة الرد فيها اقتباس بالنص الأصلي', (await aQ.count()) === 1 && (await aQ.innerText()).includes('hello-original'));
const bQ = bubble(B, 'my-answer').locator('.replyQuote');
ok('عند B: وصل الاقتباس كمان', (await bQ.count()) === 1 && (await bQ.innerText()).includes('hello-original'));
ok('عند B الاقتباس بيقول "أنت" (لأنه رد على رسالته هو)', (await bQ.locator('strong').innerText()) === 'أنت');
ok('عند A الاقتباس باسم الطرف التاني', (await aQ.locator('strong').innerText()) !== 'أنت');
// 4) قايمة الضغط المطوّل: رد + نسخ + مسح
const target = bubble(B, 'my-answer'); const tb = await target.boundingBox();
await B.mouse.move(tb.x + tb.width / 2, tb.y + tb.height - 6); await B.mouse.down(); await B.waitForTimeout(700); await B.mouse.up();
const items = await B.locator('#messageActionMenu button:visible span').allInnerTexts();
ok('القايمة فيها: رد، نسخ، مسح (بالترتيب): ' + items.join(' | '), items.length === 3 && items[0] === 'رد' && items[1] === 'نسخ' && items[2].includes('مسح'));
await B.click('#replyMessageAction'); await B.waitForTimeout(300);
ok('"رد" من القايمة بيفتح شريط الرد', await barShown(B) && (await B.locator('#replyText').innerText()).includes('my-answer'));
ok('وده رد على رسالة الطرف التاني: الاسم مش "أنت"', (await B.locator('#replyWho').innerText()) !== 'أنت');
await B.click('#replyClose'); await B.waitForTimeout(200);
ok('زرار X بيلغي الرد', !(await barShown(B)));
// 5) الرد على رسالتي أنا
await swipe(A, bubble(A, 'my-answer'), 110);
ok('رد على رسالتي: الاسم "أنت"', await barShown(A) && (await A.locator('#replyWho').innerText()) === 'أنت');
await A.keyboard.press('Escape'); await A.waitForTimeout(200);
ok('Escape بيلغي الرد', !(await barShown(A)));
// 6) رد بملف
await swipe(B, bubble(B, 'hello-original'), 110);
await B.setInputFiles('#docFile', { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hi there') });
await A.waitForSelector('.fileMessage', { timeout: 8000 }).catch(() => {}); await A.waitForTimeout(500);
const fq = A.locator('.m', { has: A.locator('.fileMessage') }).last().locator('.replyQuote');
ok('رد بملف: الاقتباس وصل عند A', (await fq.count()) === 1 && (await fq.innerText()).includes('hello-original'));
// 7) الضغط على الاقتباس يروح للأصلية
await bubble(A, 'my-answer').locator('.replyQuote').click(); await A.waitForTimeout(300);
ok('الضغط على الاقتباس بيعمل تمييز للرسالة الأصلية', await bubble(A, 'hello-original').evaluate((e) => e.classList.contains('flash')));
// 8) التاريخ: B يقفل ويفتح تاني
await B.reload(); await B.waitForTimeout(1500);
await B.locator('#permLater').click({ timeout: 2000 }).catch(() => {});
await B.locator('.roomCard').first().click(); await B.fill('#pw', pw); await B.click('#pwGo');
await B.waitForFunction(() => document.querySelectorAll('.replyQuote').length >= 2, null, { timeout: 15000 }).catch(() => {});
ok('بعد إعادة الدخول: الاقتباسات ظاهرة من التاريخ (' + await B.locator('.replyQuote').count() + ')', (await B.locator('.replyQuote').count()) >= 2);
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log('   errs:', A.errs, B.errs);
console.log(fails ? `\n${fails} فشل` : '\nكله تمام'); await browser.close(); process.exit(fails ? 1 : 0);
