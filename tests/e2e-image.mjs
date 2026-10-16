// اختبار حقيقي: مستخدمين A و B في غرفة على wrangler dev، A يبعت صورة من "الصور".
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

async function pick(page, hideMs) {
  await page.click('#attachMenuBtn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#attach')]);
  if (hideMs) {
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(hideMs);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  }
  await chooser.setFiles('/tmp/t.png');
}
// 1) معاينة -> قص -> تدوير -> شرح -> إرسال
await pick(A, 0);
await A.waitForSelector('.lrp:not(.hidden)', { timeout: 8000 }).catch(() => {});
ok('صفحة المعاينة ظهرت', await A.locator('.lrp:not(.hidden) #lrpCv').isVisible());
ok('زر القص فوق ظاهر', await A.locator('#lrpCrop').isVisible());
const w0 = await A.evaluate(() => document.getElementById('lrpCv').width);
await A.click('#lrpCrop');
ok('وضع القص ظهر (تم/إلغاء/تدوير)', await A.locator('#lrpCDone').isVisible() && await A.locator('#lrpCCancel').isVisible() && await A.locator('#lrpRot').isVisible());
await A.waitForTimeout(300);
const bb = await A.locator('#lrpBox').boundingBox();
// اسحب مقبض الجنب الأيمن لجوه (يصغّر العرض للنص تقريباً)
await A.mouse.move(bb.x + bb.width - 6, bb.y + bb.height / 2); await A.mouse.down();
await A.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 8 }); await A.mouse.up();
const bb2 = await A.locator('#lrpBox').boundingBox();
ok('القص اتحرك (الصندوق صغر)', bb2.width < bb.width - 20);
await A.click('#lrpCDone');
ok('رجع للمعاينة بعد تم', !(await A.locator('#lrpCropUI').isVisible()) && await A.locator('#lrpCv').isVisible());
const w1 = await A.evaluate(() => document.getElementById('lrpCv').width);
ok('الصورة اتقصّت فعلاً (' + w0 + ' -> ' + w1 + ')', w1 < w0);
await A.fill('#lrpCaption', 'شرح تجريبي ' + stamp);
await A.click('#lrpSend');
await B.waitForFunction((n) => document.querySelectorAll('#log img').length > n, before, { timeout: 20000 }).catch(() => {});
ok('B استلم الصورة', (await imgsB()) === before + 1);
await B.waitForFunction((t) => document.getElementById('log').innerText.includes(t), 'شرح تجريبي ' + stamp, { timeout: 10000 }).catch(() => {});
ok('B استلم الشرح', (await B.locator('#log').innerText()).includes('شرح تجريبي ' + stamp));
ok('المعاينة اتقفلت بعد الإرسال', !(await A.locator('.lrp:not(.hidden)').count()));
// 2) تدوير + إلغاء + إغلاق من غير إرسال
await pick(A, 0); await A.waitForSelector('.lrp:not(.hidden)');
await A.click('#lrpCrop'); await A.click('#lrpRot'); await A.click('#lrpCCancel');
ok('إلغاء القص يرجع للمعاينة', await A.locator('#lrpCv').isVisible());
await A.click('#lrpClose');
await A.waitForTimeout(1500);
ok('الإغلاق ما بعتش حاجة', (await imgsB()) === before + 1);
// 2b) إخفاء 7 ثواني أثناء المعرض ثم معاينة وإرسال
await pick(A, 7000); await A.waitForSelector('.lrp:not(.hidden)', { timeout: 8000 }).catch(() => {});
ok('إخفاء 7ث: المعاينة ظهرت والشات لسه مفتوح', await A.locator('.lrp:not(.hidden)').count() === 1);
await A.click('#lrpSend');
await B.waitForFunction((n) => document.querySelectorAll('#log img').length > n, before + 1, { timeout: 20000 }).catch(() => {});
ok('إخفاء 7ث: B استلم الصورة', (await imgsB()) === before + 2);
// 4) من غير معرض: القفل الأمني لسه شغال
await A.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await A.waitForTimeout(7000);
await A.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
await A.waitForTimeout(1000);
ok('القفل الأمني لسه بيقفل بدون معرض', !(await A.locator('#chat').isVisible()));
ok('مفيش أخطاء صفحة', A.errs.length === 0 && B.errs.length === 0);
console.log('errs', A.errs, B.errs);
await browser.close(); process.exit(fails ? 1 : 0);
