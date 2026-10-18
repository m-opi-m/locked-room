// اختبار 1.29.0: تعديل الرسايل — زرار الثلاث نقط، قايمة (تعديل)، السحب لشمال، شريط التعديل، "تم تعديلها" عند الطرفين، والاستمرار بعد إعادة التحميل.
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-edit.mjs  (محتاج .dev.vars فيه SESSION_SECRET من 40 حرف x)
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
const stamp = Date.now(); let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const mk = async (sub, did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ar-EG', permissions: ['microphone','camera'] });
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

const send = async (p, txt) => { await p.fill('#msg', txt); await p.click('#sendBtn'); await p.waitForTimeout(700); };
const bubble = (p, txt) => p.locator('.m', { has: p.locator(':scope > p', { hasText: txt }) }).last();
const more = (p, txt) => bubble(p, txt).locator(':scope > .messageMeta .msgMore');
const tagN = (p, txt) => bubble(p, txt).locator(':scope > .messageMeta .editedTag').count();
const menuOpen = (p) => p.locator('#messageActionMenu:not(.hidden)').count();
const editVisible = (p) => p.locator('#editMessageAction:not(.hidden)').count();
const closeMenu = async (p) => { await p.waitForTimeout(600); await p.mouse.click(5, 300); await p.waitForTimeout(200); };
const swipeLeft = async (p, loc) => { const b = await loc.boundingBox(); const y = b.y + b.height / 2, x0 = b.x + b.width * 0.7; await p.mouse.move(x0, y); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(x0 - i * 12, y); await p.mouse.up(); await p.waitForTimeout(300); };
const editing = (p) => p.locator('#replyBar.editBar:not(.hidden)').count();

await send(A, 'orig-one'); await send(B, 'from-b');
await A.waitForTimeout(500);
// 1) زرار الثلاث نقط
ok('زرار ⋯ ظاهر على رسالتي', await more(A, 'orig-one').count() === 1);
ok('زرار ⋯ ظاهر على رسالة الطرف التاني', await more(A, 'from-b').count() === 1);
await more(A, 'orig-one').click(); await A.waitForTimeout(300);
ok('الضغط على ⋯ بيفتح القايمة', await menuOpen(A) === 1);
ok('رسالتي: زرار "تعديل" ظاهر', await editVisible(A) === 1);
ok('القايمة فيها رد/نسخ/مسح كمان', await A.locator('#replyMessageAction,#copyMessageAction,#deleteMessageAction').count() === 3);
await closeMenu(A);
await more(A, 'from-b').click(); await A.waitForTimeout(300);
ok('رسالة الطرف التاني: القايمة بتفتح من غير "تعديل"', await menuOpen(A) === 1 && await editVisible(A) === 0);
await closeMenu(A);
// 2) تعديل من القايمة + شريط التعديل
await more(A, 'orig-one').click(); await A.locator('#editMessageAction').click(); await A.waitForTimeout(300);
ok('اتفتح وضع التعديل (شريط + نص الرسالة الأصلية)', await editing(A) === 1 && (await A.locator('#replyText').innerText()) === 'orig-one');
ok('خانة الكتابة فيها نص الرسالة', (await A.inputValue('#msg')) === 'orig-one');
ok('الرسالة متعلّم عليها (editing)', await A.locator('.m.editing').count() === 1);
// 3) إلغاء
await A.click('#replyClose'); await A.waitForTimeout(200);
ok('الإلغاء: الشريط اتقفل والخانة اتفضّت', await editing(A) === 0 && (await A.inputValue('#msg')) === '' && await A.locator('.m.editing').count() === 0);
ok('الإلغاء: الرسالة زي ما هي من غير "تم تعديلها"', await tagN(A, 'orig-one') === 0);
// 4) فاضي / نفس النص
await more(A, 'orig-one').click(); await A.locator('#editMessageAction').click(); await A.waitForTimeout(200);
await A.fill('#msg', ''); await A.click('#sendBtn'); await A.waitForTimeout(400);
ok('نص فاضي: لسه في التعديل والرسالة ما اتمسحتش', await editing(A) === 1 && await bubble(A, 'orig-one').count() === 1);
await A.fill('#msg', 'orig-one'); await A.click('#sendBtn'); await A.waitForTimeout(500);
ok('نفس النص: بيقفل التعديل من غير "تم تعديلها"', await editing(A) === 0 && await tagN(A, 'orig-one') === 0);
// 5) تعديل حقيقي
await more(A, 'orig-one').click(); await A.locator('#editMessageAction').click(); await A.waitForTimeout(200);
await A.fill('#msg', 'edited-one'); await A.click('#sendBtn'); await A.waitForTimeout(800);
ok('عند A: النص اتغيّر + "تم تعديلها"', await bubble(A, 'edited-one').count() === 1 && await tagN(A, 'edited-one') === 1);
ok('عند A: وضع التعديل اتقفل والخانة فاضية', await editing(A) === 0 && (await A.inputValue('#msg')) === '');
await B.waitForTimeout(500);
ok('عند B: النص الجديد وصل + "تم تعديلها"', await bubble(B, 'edited-one').count() === 1 && await tagN(B, 'edited-one') === 1);
ok('عند B: النص القديم اختفى', await B.locator('.m > p', { hasText: 'orig-one' }).count() === 0);
ok('مفيش رسالة جديدة ظهرت (التعديل مش رسالة)', await A.locator('.m > p').count() === await B.locator('.m > p').count());
const tm = await bubble(A, 'edited-one').locator(':scope > .messageMeta').innerText();
ok('الوقت لسه ظاهر جنب "تم تعديلها" (' + tm.replace(/\s+/g, ' ').trim() + ')', /تم تعديلها/.test(tm) && /[0-9٠-٩]/.test(tm));
// 6) السحب لشمال
await swipeLeft(A, bubble(A, 'edited-one'));
ok('سحب رسالتي لشمال بيفتح التعديل', await editing(A) === 1 && (await A.inputValue('#msg')) === 'edited-one');
await A.fill('#msg', 'edited-two'); await A.click('#sendBtn'); await A.waitForTimeout(800); await B.waitForTimeout(400);
ok('تعديل تاني: النص الجديد + تاج واحد بس عند الطرفين', await bubble(A, 'edited-two').count() === 1 && await tagN(A, 'edited-two') === 1 && await bubble(B, 'edited-two').count() === 1 && await tagN(B, 'edited-two') === 1);
await swipeLeft(A, bubble(A, 'from-b'));
ok('سحب رسالة الطرف التاني لشمال مبيفتحش تعديل', await editing(A) === 0);
// 7) ⋯ عند B على رسالة A: مفيش تعديل
await more(B, 'edited-two').click(); await B.waitForTimeout(300);
ok('عند B: رسالة A القايمة بدون "تعديل"', await menuOpen(B) === 1 && await editVisible(B) === 0);
await closeMenu(B);
// 8) الرد على رسالة معدّلة بيقتبس النص الجديد
await more(B, 'edited-two').click(); await B.locator('#replyMessageAction').click(); await B.waitForTimeout(300);
ok('الرد بيقتبس النص المعدّل', (await B.locator('#replyText').innerText()) === 'edited-two');
await B.click('#replyClose');
// 9) بعد إعادة التحميل (سجل/كاش)
await B.reload(); await B.waitForTimeout(1500);
await B.click('.room, .roomCard, #rooms > *').catch(() => {});
await B.fill('#pw', pw).catch(() => {}); await B.click('#pwGo').catch(() => {});
await B.waitForFunction(() => [...document.querySelectorAll('.m > p')].some((p) => p.textContent === 'edited-two'), null, { timeout: 15000 }).catch(() => {});
ok('بعد إعادة التحميل: النص المعدّل + "تم تعديلها" عند B', await bubble(B, 'edited-two').count() === 1 && await tagN(B, 'edited-two') === 1);
ok('بعد إعادة التحميل: النص الأصلي مش ظاهر', await B.locator('.m > p', { hasText: /^orig-one$|^edited-one$/ }).count() === 0);
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log('   errs:', A.errs, B.errs);
console.log(fails ? `\n${fails} فشل` : '\nكله تمام'); await browser.close(); process.exit(fails ? 1 : 0);
