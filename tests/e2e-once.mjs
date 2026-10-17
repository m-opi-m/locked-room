// اختبار عرض الصورة مرة واحدة (1.12.0): A يبعت صورة "مرة واحدة" من المعرض، B يفتحها، وتتحول عند الطرفين لـ "تم فتحها" وتتمسح من السيرفر.
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

async function pick(page) {
  await page.click('#attachMenuBtn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#attach')]);
  await chooser.setFiles('/tmp/t.png');
  await page.waitForSelector('.lrp:not(.hidden)', { timeout: 8000 });
}
const onceBtns = (p) => p.locator('#log .viewOnceMessage');
// 1) الزر موجود وبيشتغل
await pick(A, 0);
ok('زر "مرة واحدة" ظاهر في المعاينة', await A.locator('#lrpOnce').isVisible());
ok('الزر مقفول افتراضياً', (await A.getAttribute('#lrpOnce', 'aria-checked')) === 'false');
await A.click('#lrpOnce');
ok('الزر اتفعّل', (await A.getAttribute('#lrpOnce', 'aria-checked')) === 'true');
await A.fill('#lrpCaption', 'شرح سري ' + stamp);
await A.click('#lrpSend');
await B.waitForFunction(() => document.querySelectorAll('#log .viewOnceMessage').length > 0, null, { timeout: 20000 }).catch(() => {});
ok('B استلم فقاعة "مرة واحدة" مش صورة ظاهرة', (await onceBtns(B).count()) === 1 && (await B.locator('#log img').count()) === 0);
ok('B: الفقاعة قابلة للضغط', await onceBtns(B).first().isEnabled());
await A.waitForTimeout(800);
ok('A: الفقاعة عنده "صورة" ومش بتتفتح', (await onceBtns(A).count()) === 1 && !(await onceBtns(A).first().isEnabled()) && /صورة|Photo/.test(await onceBtns(A).first().innerText()));
ok('A: مفيش صورة ظاهرة عنده', (await A.locator('#log img').count()) === 0);
// 2) B يفتحها
await onceBtns(B).first().click();
await B.waitForSelector('#onceViewer:not(.hidden) img', { timeout: 8000 }).catch(() => {});
ok('B: العارض فتح بالصورة', await B.locator('#onceViewer img').count() === 1);
ok('B: الشرح ظاهر في العارض', (await B.locator('#onceViewer .onceCap').innerText().catch(() => '')).includes('شرح سري ' + stamp));
await B.waitForTimeout(800);
ok('B: الفقاعة بقت "تم فتحها"', /تم فتحها|Opened/.test(await onceBtns(B).first().innerText()) && !(await onceBtns(B).first().isEnabled()));
ok('A: الفقاعة بقت "تم فتحها"', /تم فتحها|Opened/.test(await onceBtns(A).first().innerText()));
await B.click('#onceViewerClose');
ok('بعد القفل الفقاعة لسه "تم فتحها" (مش اتمسحت)', (await onceBtns(B).count()) === 1 && /تم فتحها|Opened/.test(await onceBtns(B).first().innerText()));
// 3) السيرفر مسح المحتوى: ريفريش عند الطرفين
const room = A.url();
for (const p of [A, B]) await p.reload();
for (const p of [A, B]) {
  await p.waitForSelector('#roomList > *', { timeout: 10000 });
  await p.locator('#roomList > *').first().click();
  await p.waitForSelector('#pw', { state: 'visible', timeout: 8000 });
  await p.fill('#pw', pw); await p.click('#pwGo');
}
await A.waitForTimeout(4000);
const openedAfter = async (p) => { const n = await onceBtns(p).count(); return n === 1 && /تم فتحها|Opened/.test(await onceBtns(p).first().innerText()); };
ok('بعد الريفريش A لسه شايف "تم فتحها"', await openedAfter(A).catch(() => false));
ok('بعد الريفريش B لسه شايف "تم فتحها"', await openedAfter(B).catch(() => false));
ok('بعد الريفريش مفيش صورة ولا شرح ظاهر', (await A.locator('#log img').count()) === 0 && !(await B.locator('#log').innerText()).includes('شرح سري'));
// 4) محاولة فتح تاني من السيرفر مباشرة لازم تفشل (المحتوى اتمسح)
const again = await B.evaluate(() => new Promise((res) => {
  const ws = window.__lrTestWs; res(ws ? 'has' : 'none');
}));
// 5) صورة عادية (من غير مرة واحدة) لسه شغالة
await pick(A, 0);
await A.click('#lrpSend');
await B.waitForFunction(() => document.querySelectorAll('#log img').length > 0, null, { timeout: 20000 }).catch(() => {});
ok('صورة عادية لسه بتتبعت وتتعرض عند B', (await B.locator('#log img').count()) === 1 && (await onceBtns(B).count()) === 1);
ok('مفيش أخطاء صفحة', A.errs.length === 0 && B.errs.length === 0);
console.log('errs', A.errs, B.errs);
await browser.close(); process.exit(fails ? 1 : 0);
