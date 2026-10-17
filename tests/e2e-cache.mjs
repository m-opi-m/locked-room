// اختبار تخزين الشات على الجهاز (1.14.0): فتح فوري من الجهاز، مزامنة الجديد بس، مسح/تغيير بيوصل، وفتح الشات من غير إنترنت.
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-cache.mjs
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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAhklEQVR42u3QQREAAAgDoG3/zlTCwwcKsMZ3EpAVJUCWgCwBWQKyBGQJyBKQJSBLQJaALAFZArIEZAnIEpAlIEtAloAsAVkCsgRkCcgSkCUgS0CWgCwBWQKyBGQJyBKQJSBLQJaALAFZArIEZAnIEpAlIEtAloAsAVkCsgRkCcgSkCUgS0CWgCwBWQKyBGQJyBKQ5W8L0pYBMeY5gAAAAABJRU5ErkJggg==', 'base64');
writeFileSync('/tmp/t.png', png);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const watch = (p) => { p.frames = []; p.wsUrls = []; p.on('websocket', (ws) => { p.wsUrls.push(ws.url()); ws.on('framereceived', (f) => { if (typeof f.payload === 'string') p.frames.push(f.payload); }); }); };
const mkCtx = async (sub, did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  await ctx.addInitScript(() => sessionStorage.setItem('lr.permLater', '1'));
  return ctx;
};
const open = async (ctx) => {
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); watch(p);
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100));
  return p;
};
const texts = (p) => p.evaluate(() => [...document.querySelectorAll('#log .m')].map((e) => e.querySelector(':scope > p')?.innerText?.trim() || (e.querySelector('img') ? '[img]' : '[other]')));
const hist = (p) => p.frames.filter((f) => f.includes('"history":true')).length;
const send = async (p, txt) => { await p.fill('#msg', txt); await p.click('#sendBtn'); };
const enter = async (p, pw) => { await p.locator('.roomCard').first().click(); await p.fill('#pw', pw); await p.click('#pwGo'); };

const stamp = Date.now(), pw = 'Room-pw-' + stamp;
const cA = await mkCtx('ua' + stamp, 'a'.repeat(24)), cB = await mkCtx('ub' + stamp, 'b'.repeat(24));
const A = await open(cA); let B = await open(cB);
for (const p of [A, B]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
await A.click('#create'); await A.fill('#pw', pw); await A.click('#pwGo');
await A.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
const code = (await A.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0];
await B.click('#joinOpen'); await B.fill('#codeIn', code); await B.click('#join'); await B.fill('#pw', pw); await B.click('#pwGo');
await A.waitForTimeout(3000);

// 1) رسايل ونص وصورة
for (const m of ['m1', 'm2', 'm3']) { await send(A, m); await sleep(300); }
const pngB64 = await A.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#e33'; x.fillRect(0, 0, 64, 64); return c.toDataURL('image/png').split(',')[1]; });
writeFileSync('/tmp/t.png', Buffer.from(pngB64, 'base64'));
await A.setInputFiles('#file', '/tmp/t.png'); await sleep(1500);
await B.waitForFunction(() => document.querySelectorAll('#log .m img').length >= 1, null, { timeout: 10000 }).catch(() => {});
let tb = await texts(B);
ok('B استلم الرسايل والصورة لايف', ['m1', 'm2', 'm3', '[img]'].every((x) => tb.includes(x)));

// 2) B يعمل ريفريش ويدخل تاني: الشات يظهر من الجهاز، والسيرفر مايبعتش التاريخ تاني
await B.reload(); await B.waitForSelector('.roomCard', { timeout: 15000 });
B.frames = []; B.wsUrls = [];
await enter(B, pw);
await B.waitForFunction(() => document.querySelectorAll('#log .m').length >= 4, null, { timeout: 15000 });
await sleep(1500);
tb = await texts(B);
ok('بعد الريفريش الرسايل والصورة ظاهرة (' + tb.join(',') + ')', ['m1', 'm2', 'm3', '[img]'].every((x) => tb.includes(x)));
ok('السيرفر ماعادش يبعت التاريخ (history frames = ' + hist(B) + ')', hist(B) === 0);
ok('الاتصال بيبعت since (' + (B.wsUrls[0] || '').split('?')[1] + ')', /since=[1-9]\d*/.test(B.wsUrls[0] || ''));
ok('مفيش رسايل متكررة', tb.length === new Set(tb.map((x, i) => x + ':' + (x === '[img]' ? i : ''))).size);

// 3) B يخرج للرئيسية، A يبعت m4 ويمسح m2: لما B يرجع يشوف m4 بس والمسح اتطبق
await B.reload(); await B.waitForSelector('.roomCard', { timeout: 15000 });
await send(A, 'm4'); await sleep(800);
const bub = A.locator('#log .m', { hasText: 'm2' }).first(); const bb = await bub.boundingBox();
await A.mouse.move(bb.x + bb.width / 2, bb.y + bb.height - 6); await A.mouse.down(); await A.waitForTimeout(700); await A.mouse.up();
await A.click('#deleteMessageAction'); await sleep(1000);
ok('A: m2 اتمسحت', !(await texts(A)).includes('m2'));
B.frames = []; B.wsUrls = [];
await enter(B, pw);
await B.waitForFunction(() => [...document.querySelectorAll('#log .m')].some((e) => e.innerText.includes('m4')), null, { timeout: 15000 });
await sleep(1500);
tb = await texts(B);
ok('B شاف m4 الجديدة (' + tb.join(',') + ')', tb.includes('m4'));
ok('B: m2 المحذوفة اتشالت من الجهاز كمان', !tb.includes('m2') && tb.includes('m1') && tb.includes('m3'));
ok('السيرفر بعت رسالة واحدة بس (الجديدة) = ' + hist(B), hist(B) === 1);

// 4) من غير إنترنت: التطبيق يفتح والشات يتشاف من الجهاز
await B.waitForTimeout(1500);
await B.evaluate(() => navigator.serviceWorker.ready); await B.reload(); await B.waitForSelector('.roomCard', { timeout: 15000 }); await sleep(1500);
await cB.setOffline(true); await sleep(500);
await B.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await B.waitForSelector('.roomCard', { timeout: 20000 }).catch(() => {});
ok('أوفلاين: التطبيق اتفتح وفيه قايمة المحادثات', (await B.locator('.roomCard').count()) === 1);
ok('أوفلاين: ظهر شريط "غير متصل"', (await B.locator('#lrOfflineBar').count()) === 1);
await B.locator('.roomCard').first().click(); await B.fill('#pw', 'wrong-pass'); await B.click('#pwGo'); await sleep(2500);
ok('أوفلاين: باسورد غلط بيترفض (' + (await B.locator('#pwErr').innerText()) + ')', /غير صحيحة|Incorrect/.test(await B.locator('#pwErr').innerText()));
await B.fill('#pw', pw); await B.click('#pwGo');
await B.waitForFunction(() => document.querySelectorAll('#log .m').length >= 3, null, { timeout: 20000 }).catch(() => {});
tb = await texts(B);
ok('أوفلاين: الرسايل ظاهرة (' + tb.join(',') + ')', ['m1', 'm3', 'm4', '[img]'].every((x) => tb.includes(x)));
ok('أوفلاين: زرار الإرسال مقفول', await B.locator('#sendBtn').isDisabled());

// 5) النت يرجع: يتوصل تاني لوحده وتوصله الرسايل الجديدة
await cB.setOffline(false);
await send(A, 'm5');
await B.waitForFunction(() => [...document.querySelectorAll('#log .m')].some((e) => e.innerText.includes('m5')), null, { timeout: 30000 }).catch(() => {});
tb = await texts(B);
ok('رجع النت: m5 وصلت (' + tb.join(',') + ')', tb.includes('m5'));
ok('رجع النت: شريط "غير متصل" اختفى', (await B.locator('#lrOfflineBar').count()) === 0);
await B.waitForFunction(() => !document.getElementById('sendBtn').disabled, null, { timeout: 15000 }).catch(() => {});
ok('رجع النت: الإرسال اشتغل تاني', !(await B.locator('#sendBtn').isDisabled()));

// 6) تاريخ طويل: جهاز جديد يعرض آخر 40 بس، ولما يطلع لفوق يحمّل الأقدم من الجهاز
const total = 48; // السيرفر بيقفل الاتصال لو عدد الفريمات أكتر من 40 في 10 ثواني (كل رسالة = رسالة + presence)، فنبعت على دفعات
for (let i = 0; i < total; i += 12) { for (let j = i; j < i + 12; j++) await send(A, 'bulk' + j); await sleep(10500); }
await B.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('locked-room-chat'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
await B.reload(); await B.waitForSelector('.roomCard', { timeout: 15000 });
B.frames = [];
await enter(B, pw);
await B.waitForFunction(() => document.querySelectorAll('#log .m').length >= 20, null, { timeout: 30000 });
await sleep(2500);
let n1 = await B.locator('#log .m').count();
ok('أول مزامنة: اتعرض آخر ~40 رسالة بس (' + n1 + ')', n1 >= 38 && n1 <= 45);
await B.waitForTimeout(1200);
await B.evaluate(() => { const l = document.getElementById('log'); l.scrollTop = 200; l.scrollTop = 0; });
await sleep(1500);
let n2 = await B.locator('#log .m').count();
ok('الطلوع لفوق حمّل رسايل أقدم (' + n1 + ' → ' + n2 + ')', n2 > n1);
const order = await B.evaluate(() => [...document.querySelectorAll('#log .m')].map((e) => +e.dataset.at));
ok('الترتيب الزمني سليم', order.every((x, i) => i === 0 || x >= order[i - 1]));
await B.evaluate(() => { const l = document.getElementById('log'); l.scrollTop = 0; }); await sleep(1500);
await B.evaluate(() => { const l = document.getElementById('log'); l.scrollTop = 0; }); await sleep(1500);
const all = await texts(B);
const dbg = await B.evaluate(async (c) => { const m = await lrDb.metas(c); const ats = m.map((x) => x.at); return { total: m.length, dupAt: ats.length - new Set(ats).size, seqs: m.map((x) => x.seq).filter((x) => typeof x === 'number').length, frames: 0 }; }, code.replace(/-/g, ''));
console.log('DB', JSON.stringify(dbg), 'DOM', await B.locator('#log .m').count());
const gotBulk = new Set(all.filter((x) => x.startsWith('bulk'))); const aBulk = new Set((await texts(A)).filter((x) => x.startsWith('bulk')));
console.log('A has', aBulk.size, 'bulk; B has', gotBulk.size, 'missing on B:', [...aBulk].filter((x) => !gotBulk.has(x)).join(','));
ok('كل الرسايل اللي عند A اتحملت عند B بالتدريج من الجهاز (' + gotBulk.size + '/' + aBulk.size + ')', gotBulk.size === aBulk.size && aBulk.size > 0);
ok('مفيش أخطاء صفحة', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log('errors', A.errs, B.errs);
await browser.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
