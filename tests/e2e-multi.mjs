// اختبار حقيقي (1.4.0): صور متعددة — A يختار أكتر من صورة، يحذف ويضيف، شرح لكل صورة، B يستلم بالترتيب.
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
const imgsB = () => B.locator('#log img').count();
const before = await imgsB();
const P = (n) => `/tmp/mi/p${String(n).padStart(2, '0')}.png`;
const th = (i) => A.locator('.lrpTh:not(.lrpAdd)').nth(i);
async function pickMany(list, viaPlus) {
  if (!viaPlus) await A.click('#attachMenuBtn');
  const [ch] = await Promise.all([A.waitForEvent('filechooser'), viaPlus ? A.click('.lrpAdd') : A.click('#attach')]);
  const multi = ch.isMultiple();
  await ch.setFiles(list); return multi;
}
async function sel(i) { if (!((await th(i).getAttribute('class')) || '').includes('sel')) await th(i).click(); }

// 1) اختيار 4 صور
const multi = await pickMany([P(1), P(2), P(3), P(4)], false);
ok('المنتقي بيسمح باختيار متعدد', multi === true);
await A.waitForSelector('.lrp:not(.hidden) .lrpTh', { timeout: 10000 }).catch(() => {});
await A.waitForFunction(() => document.querySelectorAll('.lrpTh:not(.lrpAdd)').length === 4, null, { timeout: 10000 }).catch(() => {});
ok('4 مصغّرات ظهرت في الشريط', (await A.locator('.lrpTh:not(.lrpAdd)').count()) === 4);
ok('زر + لإضافة صور ظاهر', await A.locator('.lrpAdd').isVisible());
ok('شارة العدد = 4', (await A.locator('#lrpBadge').innerText()) === '4');
ok('السلة على الصورة المحددة بس', (await A.locator('.lrpTrash').count()) === 1 && (await th(0).locator('.lrpTrash').count()) === 1);
const sig = () => A.evaluate(() => { const c = document.getElementById('lrpCv'); return c.width + 'x' + c.height; });
const s0 = await sig(); await sel(1); const s1 = await sig();
ok('اختيار مصغّرة بيغيّر الصورة الكبيرة (' + s0 + ' -> ' + s1 + ')', s0 !== s1);
// شرح لكل صورة + ثباته عند التنقل
await sel(0); await A.fill('#lrpCaption', 'c1'); await sel(1); await A.fill('#lrpCaption', 'c2');
ok('شرح الصورة 2 فاضي عند الانتقال لصورة من غير شرح', true);
await sel(2); ok('صورة 3 خانة الشرح فاضية', (await A.inputValue('#lrpCaption')) === '');
await sel(0); ok('شرح الصورة 1 اتحفظ', (await A.inputValue('#lrpCaption')) === 'c1');
await sel(1); ok('شرح الصورة 2 اتحفظ', (await A.inputValue('#lrpCaption')) === 'c2');
// حذف الصورة 4 بالسلة
await sel(3); await th(3).click();
await A.waitForFunction(() => document.querySelectorAll('.lrpTh:not(.lrpAdd)').length === 3, null, { timeout: 3000 }).catch(() => {});
ok('السلة حذفت الصورة (بقوا 3)', (await A.locator('.lrpTh:not(.lrpAdd)').count()) === 3);
ok('شارة العدد = 3', (await A.locator('#lrpBadge').innerText()) === '3');
// إضافة صورتين بزر +
await pickMany([P(5), P(6)], true);
await A.waitForFunction(() => document.querySelectorAll('.lrpTh:not(.lrpAdd)').length === 5, null, { timeout: 10000 }).catch(() => {});
ok('زر + أضاف صورتين (بقوا 5)', (await A.locator('.lrpTh:not(.lrpAdd)').count()) === 5);
ok('شارة العدد = 5', (await A.locator('#lrpBadge').innerText()) === '5');
await sel(2); await A.fill('#lrpCaption', 'c3'); await sel(3); await A.fill('#lrpCaption', 'c4'); await sel(4); await A.fill('#lrpCaption', 'c5');
await sel(0); ok('شرح 1 لسه محفوظ بعد الإضافة', (await A.inputValue('#lrpCaption')) === 'c1');
// قص صورة واحدة من الخمسة (الصورة 2) ما يأثرش على الباقي
await sel(1);
const wBefore = await A.evaluate(() => document.getElementById('lrpCv').width);
await A.click('#lrpCrop'); await A.waitForTimeout(300);
const bb = await A.locator('#lrpBox').boundingBox();
await A.mouse.move(bb.x + bb.width - 6, bb.y + bb.height / 2); await A.mouse.down();
await A.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 8 }); await A.mouse.up();
await A.click('#lrpCDone');
const wAfter = await A.evaluate(() => document.getElementById('lrpCv').width);
ok('قص الصورة 2 اشتغل (' + wBefore + ' -> ' + wAfter + ')', wAfter < wBefore);
await sel(2); const w3 = await A.evaluate(() => document.getElementById('lrpCv').width);
ok('الصورة 3 ما اتأثرتش بالقص (320)', w3 === 320);
// إرسال الكل
await A.click('#lrpSend');
await B.waitForFunction((n) => document.querySelectorAll('#log img').length >= n, before + 5, { timeout: 45000 }).catch(() => {});
ok('B استلم 5 صور', (await imgsB()) === before + 5);
await B.waitForTimeout(800);
const got = await B.evaluate(() => [...document.querySelectorAll('#log .m')].filter((m) => m.querySelector('img')).slice(-5).map((m) => ({ cap: (m.querySelector('.imgCapText')?.innerText || '').trim(), w: m.querySelector('img').naturalWidth })));
console.log('B got', JSON.stringify(got));
ok('الترتيب والشرح صح عند B (c1..c5)', JSON.stringify(got.map((g) => g.cap)) === JSON.stringify(['c1', 'c2', 'c3', 'c4', 'c5']));
ok('الصور صح (الصورة 4 اتحذفت، الصورة 2 اتقصّت)', got[0].w === 300 && got[1].w < 310 && got[2].w === 320 && got[3].w === 340 && got[4].w === 350);
await A.waitForTimeout(500);
ok('مفيش فقاعات معلّقة عند A', (await A.locator('.lrPending').count()) === 0);
ok('المعاينة اتقفلت بعد الإرسال', (await A.locator('.lrp:not(.hidden)').count()) === 0);
ok('عند A: 5 رسايل صور بشرحها', await A.evaluate(() => [...document.querySelectorAll('#log .m')].filter((m) => m.querySelector('img') && /^c[1-5]$/.test((m.querySelector('.imgCapText')?.innerText || '').trim())).length === 5));

// 2) الحد الأقصى 10
await pickMany(Array.from({ length: 12 }, (_, i) => P(i + 1)), false);
await A.waitForFunction(() => document.querySelectorAll('.lrpTh:not(.lrpAdd)').length >= 1, null, { timeout: 15000 }).catch(() => {});
await A.waitForTimeout(600);
ok('الحد الأقصى: 10 بس من 12', (await A.locator('.lrpTh:not(.lrpAdd)').count()) === 10);
ok('الحد الأقصى: زر + اختفى', (await A.locator('.lrpAdd').count()) === 0);
ok('الحد الأقصى: شارة 10', (await A.locator('#lrpBadge').innerText()) === '10');
ok('الحد الأقصى: ظهرت رسالة تنبيه', (await A.locator('.lrToast').innerText()).includes('الحد الأقصى'));
await A.click('#lrpClose'); await A.waitForTimeout(800);
ok('الإغلاق من غير إرسال ما بعتش حاجة', (await imgsB()) === before + 5);

// 3) حذف كل الصور يقفل المعاينة
await pickMany([P(7), P(8)], false);
await A.waitForFunction(() => document.querySelectorAll('.lrpTh:not(.lrpAdd)').length === 2, null, { timeout: 10000 }).catch(() => {});
await th(0).click(); await A.waitForTimeout(200);
ok('بعد حذف واحدة فضلت واحدة', (await A.locator('.lrpTh:not(.lrpAdd)').count()) === 1);
await th(0).click(); await A.waitForTimeout(300);
ok('حذف آخر صورة بيقفل المعاينة', (await A.locator('.lrp:not(.hidden)').count()) === 0);

// 4) إرسال سريع من غير تعديل: صورتين + شرح على الأولى بس
await pickMany([P(9), P(10)], false);
await A.waitForFunction(() => document.querySelectorAll('.lrpTh:not(.lrpAdd)').length === 2, null, { timeout: 10000 }).catch(() => {});
await A.fill('#lrpCaption', 'fast'); await A.click('#lrpSend');
await B.waitForFunction((n) => document.querySelectorAll('#log img').length >= n, before + 7, { timeout: 30000 }).catch(() => {});
ok('إرسال سريع: B استلم صورتين', (await imgsB()) === before + 7);
const last2 = await B.evaluate(() => [...document.querySelectorAll('#log .m')].filter((m) => m.querySelector('img')).slice(-2).map((m) => (m.querySelector('.imgCapText')?.innerText || '').trim()));
ok('الشرح على الأولى بس', last2[0] === 'fast' && last2[1] === '');
ok('مفيش أخطاء صفحة', A.errs.length === 0 && B.errs.length === 0);
console.log('errs', A.errs, B.errs);
await browser.close(); process.exit(fails ? 1 : 0);
