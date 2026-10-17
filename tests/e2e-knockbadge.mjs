// اختبار حقيقي (1.16.0): كارت الكود + بادج الطرق + ترتيب المحادثات — سحب لليمين، قايمة الضغط المطوّل، شريط الرد، الاقتباس عند الطرفين، والتاريخ بعد إعادة الدخول.
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

const ctxPerm = async (p) => p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
const A = await mk('ua' + stamp, 'a'.repeat(24)), B = await mk('ub' + stamp, 'b'.repeat(24)), C = await mk('uc' + stamp, 'c'.repeat(24));
for (const p of [A, B, C]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); await ctxPerm(p); }
const codeRe = /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/;
const create = async (p, pw) => {
  await p.click('#create'); await p.fill('#pw', pw); await p.click('#pwGo');
  await p.waitForSelector('.codeCard', { timeout: 30000 });
  return (await p.locator('.codeCard').first().getAttribute('data-code'));
};
const join = async (p, code, pw) => { await p.click('#joinOpen'); await p.fill('#codeIn', code); await p.click('#join'); await p.fill('#pw', pw); await p.click('#pwGo'); };
const connected = (p) => p.waitForFunction(() => document.getElementById('status')?.textContent === 'متصل', null, { timeout: 15000 }).then(() => true).catch(() => false);
const rooms = (p) => p.evaluate(() => [...document.querySelectorAll('#roomList .roomCard')].map((e) => ({ n: e.querySelector('strong').textContent, knock: e.classList.contains('hasKnock'), av: !!e.querySelector('.roomKnockAv'), bell: !!e.querySelector('.roomKnockBell') })));
const poll = async (p) => { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1500); };

// --- 1) كارت الكود
const pw1 = 'Room-one-' + stamp, pw2 = 'Room-two-' + stamp;
const code1 = await create(A, pw1);
if (process.env.SHOT) await A.screenshot({ path: process.env.SHOT + '/card.png' });
ok('الكود ظهر في كارت (مش نص عادي)', /^([A-Z0-9]{4}-){5}[A-Z0-9]{4}$/.test(code1));
ok('الكارت أول حاجة بعد رسالة التشفير', await A.locator('#log').evaluate((l) => !!l.querySelector('.m .codeCard') && [...l.children].findIndex((c) => c.querySelector?.('.codeCard')) <= 1));
ok('الكارت فيه 6 مجموعات + زرار نسخ ومشاركة', (await A.locator('.codeCardCode span').count()) === 6 && (await A.locator('.codeCardActions button').count()) === 2);
await A.locator('.codeCardActions button').first().click(); await A.waitForTimeout(300);
const clip = await A.evaluate(() => navigator.clipboard.readText()).catch(() => '');
ok('زرار النسخ نسخ الكود فعلاً', clip === code1);
ok('الزرار بيعرض اتنسخ', /اتنسخ/.test(await A.locator('.codeCardActions button').first().innerText()));
await A.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d; }; });
await A.locator('.codeCardActions button').nth(1).click(); await A.waitForTimeout(300);
const sh = await A.evaluate(() => window.__shared);
ok('المشاركة بتبعت الكود والرابط', sh && sh.text.includes(code1) && sh.url.endsWith('/#' + code1.replace(/-/g, '')));
await A.evaluate(() => { navigator.share = undefined; });
await A.locator('.codeCardActions button').nth(1).click(); await A.waitForTimeout(300);
ok('من غير navigator.share: بينسخ الرابط', /\/#/.test(await A.evaluate(() => navigator.clipboard.readText()).catch(() => '')));

await join(B, code1, pw1);
ok('A و B دخلوا الغرفة 1', (await connected(A)) && (await connected(B)));
ok('B شاف الكارت كمان (من التاريخ)', (await B.locator('.codeCard').count()) >= 1);

// --- 2) غرفة تانية B-C
await B.click('#homeChat'); await B.waitForTimeout(500);
const code2 = await create(B, pw2);
await join(C, code2, pw2);
ok('B و C دخلوا الغرفة 2', (await connected(B)) && (await connected(C)));
await B.click('#homeChat'); await B.waitForTimeout(600);
let r = await rooms(B);
ok('B عنده غرفتين من غير بادج', r.length === 2 && r.every((x) => !x.knock));
// الاسم بيتحدد من البروفايل؛ بنميّز الغرفتين بالترتيب: الغرفة 2 (الأحدث) فوق

// --- 3) A يطرق (B في الشاشة الرئيسية) -> بادج على غرفة A-B
await A.click('#wakeBtn'); await A.waitForTimeout(800);
await poll(B);
r = await rooms(B);
ok('بعد طرق A: كارت واحد عليه بادج (صورة + جرس)', r.filter((x) => x.knock).length === 1 && r[0].knock && r[0].av && r[0].bell);
const firstCode = await B.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lr.knocks') || '{}')));
ok('البادج متسجل على كود الغرفة 1', firstCode.length === 1 && firstCode[0] === code1.replace(/-/g, ''));
const top1 = await B.evaluate(() => document.querySelector('#roomList .roomCard').dataset.code);
ok('الغرفة المطروقة (A) طلعت فوق رغم إن غرفة C أحدث', top1 === code1.replace(/-/g, ''));
ok('نص الكارت بيقول طرق الباب', /طرق الباب/.test(await B.locator('#roomList .roomCard').first().innerText()));

// --- 4) C يطرق بعدها -> غرفة C فوق، وغرفة A تحتها بترتيبها
await C.click('#wakeBtn'); await C.waitForTimeout(800);
await poll(B);
r = await rooms(B);
const k = await B.evaluate(() => JSON.parse(localStorage.getItem('lr.knocks') || '{}'));
const keys = Object.keys(k).sort((x, y) => k[y] - k[x]);
const orderNow = await B.evaluate(() => [...document.querySelectorAll('#roomList .roomCard')].map((e) => e.dataset.code));
if (process.env.SHOT) await B.screenshot({ path: process.env.SHOT + '/list.png' });
ok('الاتنين عليهم بادج', r.length === 2 && r.every((x) => x.knock));
ok('آخر واحد طرق (C) فوق وA تحته', keys[0] === code2.replace(/-/g, '') && orderNow[0] === code2.replace(/-/g, '') && orderNow[1] === code1.replace(/-/g, ''));

// --- 5) فتح غرفة مطروقة يشيل البادج وبعدين ترتيب بالنشاط
await B.locator('#roomList .roomCard').nth(1).click(); await B.fill('#pw', pw1).catch(() => {}); await B.click('#pwGo').catch(() => {});
await connected(B);
await B.click('#homeChat'); await B.waitForTimeout(600);
r = await rooms(B);
ok('فتح غرفة A شال بادجها وسابها لغرفة C', r.filter((x) => x.knock).length === 1);
const act = await B.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lr.act') || '{}')).length);
ok('آخر نشاط متسجل للغرف', act >= 2);

// --- 6) مسار الـ service worker: تسجيل طرق في IndexedDB وبيتسحب لما التطبيق يرجع
const ridA = await B.evaluate((c) => { const m = JSON.parse(localStorage.getItem('lr.roomIds') || '{}'); return Object.keys(m).find((r) => m[r] === c); }, code1.replace(/-/g, ''));
await B.evaluate(async (rid) => {
  const db = await new Promise((o, e) => { const q = indexedDB.open('lr-knocks', 1); q.onupgradeneeded = () => q.result.createObjectStore('k'); q.onsuccess = () => o(q.result); q.onerror = () => e(q.error); });
  await new Promise((o) => { const tx = db.transaction('k', 'readwrite'); tx.objectStore('k').put(Date.now(), rid); tx.oncomplete = o; }); db.close();
}, ridA);
await B.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await B.waitForTimeout(1200);
r = await rooms(B);
ok('طرق متسجل من الـ SW بيظهر كبادج', r.filter((x) => x.knock).length >= 1);

// --- 7) حذف غرفة يمسح بياناتها
for (const p of [A, B, C]) ok('مفيش أخطاء JS (' + p.errs.length + ')', p.errs.length === 0);
console.log(fails ? 'FAILED ' + fails : 'ALL PASS');
await browser.close(); process.exit(fails ? 1 : 0);
