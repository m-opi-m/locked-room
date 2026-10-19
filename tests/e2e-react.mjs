// اختبار 1.28.0: تفاعلات الإيموجي + إصلاح كروت المكالمات + شيل "المكالمة انتهت"
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-react.mjs
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
await A.waitForFunction(() => document.getElementById('status')?.textContent === 'متصل', null, { timeout: 15000 }).catch(() => {});
ok('الطرفين دخلوا الغرفة', (await A.locator('#status').innerText()) === 'متصل');

const send = async (p, txt) => { await p.fill('#msg', txt); await p.click('#sendBtn'); await p.waitForTimeout(700); };
const bubble = (p, txt) => p.locator('.m', { has: p.locator(':scope > p', { hasText: txt }) }).last();
const hold = async (p, loc) => { const b = await loc.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up(); await p.waitForTimeout(250); };
const picker = (p) => p.locator('.rxPicker:not(.hidden)');
const badge = (p, txt) => bubble(p, txt).locator(':scope > .rxBadge');
const badgeText = async (p, txt) => (await badge(p, txt).count()) ? (await badge(p, txt).innerText()).replace(/\s+/g, '') : '';

await send(B, 'hello-react');
await A.waitForTimeout(500);
// 1) ضغطة مطولة => شريط الإيموجي فوق الرسالة
await hold(A, bubble(A, 'hello-react'));
ok('شريط الإيموجي ظهر', await picker(A).count() === 1);
const pb = await picker(A).boundingBox(), mb = await bubble(A, 'hello-react').boundingBox();
ok('الشريط فوق الرسالة (' + Math.round(pb.y + pb.height) + ' <= ' + Math.round(mb.y) + ')', pb.y + pb.height <= mb.y + 2);
ok('فيه زرار + و6 إيموجي على الأقل', await picker(A).locator('.rxPlus').count() === 1 && await picker(A).locator('.rxStrip button').count() >= 6);
ok('الضغط المطوّل: شريط الإيموجي بس من غير قايمة (رد/نسخ/مسح)', await A.locator('#messageActionMenu:not(.hidden)').count() === 0);
// 2) اختيار ❤️
await picker(A).locator('.rxStrip button', { hasText: '❤️' }).click();
await A.waitForTimeout(600);
ok('عند A: ظهرت شارة ❤️ على الرسالة', (await badgeText(A, 'hello-react')).includes('❤️'));
ok('الشريط اتقفل بعد الاختيار', await picker(A).count() === 0);
await B.waitForFunction(() => document.querySelector('.rxBadge'), null, { timeout: 8000 }).catch(() => {});
ok('عند B: وصلت الشارة ❤️', (await badgeText(B, 'hello-react')).includes('❤️'));
// 3) B يضيف 👍 => الاتنين ظاهرين
await hold(B, bubble(B, 'hello-react'));
await picker(B).locator('.rxStrip button', { hasText: '👍' }).click();
await B.waitForTimeout(600); await A.waitForTimeout(600);
const ta = await badgeText(A, 'hello-react'), tb = await badgeText(B, 'hello-react');
ok('عند A: ❤️ و👍 مع بعض (' + ta + ')', ta.includes('❤️') && ta.includes('👍'));
ok('عند B: ❤️ و👍 مع بعض (' + tb + ')', tb.includes('❤️') && tb.includes('👍'));
// 4) نفس الإيموجي تاني = شيله
await hold(B, bubble(B, 'hello-react'));
await picker(B).locator('.rxStrip button.on').click();
await B.waitForTimeout(600); await A.waitForTimeout(600);
ok('بعد شيل 👍: A فيها ❤️ بس', (await badgeText(A, 'hello-react')) === '❤️');
// 5) زرار + : إيموجي جديد بيتحفظ في الشريط
await hold(A, bubble(A, 'hello-react'));
await picker(A).locator('.rxPlus').click(); await A.waitForTimeout(300);
ok('شاشة كل الإيموجي ظهرت', await A.locator('.rxSheet:not(.hidden)').count() === 1);
await A.locator('.rxGrid button', { hasText: '🔥' }).first().click().catch(async () => { await A.locator('.rxTabs button').nth(2).click(); await A.locator('.rxGrid button', { hasText: '🔥' }).first().click(); });
await A.waitForTimeout(600);
ok('الشارة بقت 🔥 (بدل ❤️، تفاعل واحد لكل شخص)', (await badgeText(A, 'hello-react')) === '🔥');
await hold(A, bubble(A, 'hello-react'));
const strip = (await picker(A).locator('.rxStrip').innerText()).replace(/\s+/g, '');
ok('🔥 اتحفظ في الشريط مع الباقي', strip.includes('🔥') && strip.includes('❤️'));
await A.keyboard.press('Escape'); await A.mouse.click(5, 300);
// 6) بعد إعادة التحميل (سجل/كاش)
await B.reload(); await B.waitForTimeout(1500);
await B.click('.room, .roomCard, #rooms > *').catch(() => {});
await B.fill('#pw', pw).catch(() => {}); await B.click('#pwGo').catch(() => {});
await B.waitForFunction(() => document.querySelector('.rxBadge'), null, { timeout: 15000 }).catch(() => {});
ok('بعد إعادة التحميل: الشارة 🔥 ما زالت عند B', (await badgeText(B, 'hello-react')) === '🔥');

// ===== المكالمات =====
const cards = (p) => p.locator('.callLog');
const sysTxt = async (p) => (await p.locator('.sys').allInnerTexts()).join('|');
// أ) B يتصل، A يرفض
await B.click('#callA'); await A.waitForSelector('#incoming:not(.hidden)', { timeout: 10000 });
await A.click('#declineBtn'); await A.waitForTimeout(1500); await B.waitForTimeout(500);
ok('رفض المكالمة: مفيش "المكالمة انتهت" عند B', !(await sysTxt(B)).includes('المكالمة انتهت'));
ok('كارت واحد عند كل طرف', await cards(A).count() === 1 && await cards(B).count() === 1);
ok('عند A (اللي اترنّ عليه): "مكالمة فايتة"', (await cards(A).first().getAttribute('class')).includes('missed'));
ok('عند B (المتصل): "محدش رد" مش فايتة', !(await cards(B).first().getAttribute('class')).includes('missed') && (await cards(B).first().innerText()).includes('محدش رد'));
// ب) A يتصل (وB كان متصل قبل كده) ثم A يلغي قبل ما B يرد
await A.click('#callA'); await B.waitForSelector('#incoming:not(.hidden)', { timeout: 10000 });
await A.waitForTimeout(800); await A.click('#hangBtn'); await B.waitForTimeout(1800); await A.waitForTimeout(500);
ok('B ماعملش كارت "محدش رد" لمكالمة مش بتاعته (B=' + await cards(B).count() + ')', await cards(B).count() === 2);
ok('A=2 كروت بالظبط (' + await cards(A).count() + ')', await cards(A).count() === 2);
const bLast = cards(B).last();
ok('عند B آخر كارت "مكالمة فايتة + اتصل بيه"', (await bLast.getAttribute('class')).includes('missed') && (await bLast.innerText()).includes('اتصل بيه'));
ok('مفيش "المكالمة انتهت" عند أي طرف', !(await sysTxt(A)).includes('المكالمة انتهت') && !(await sysTxt(B)).includes('المكالمة انتهت'));
ok('مفيش أخطاء JS', A.errs.length === 0 && B.errs.length === 0);
if (A.errs.length || B.errs.length) console.log('   errs:', A.errs, B.errs);
console.log(fails ? `\n${fails} فشل` : '\nكله تمام'); await browser.close(); process.exit(fails ? 1 : 0);
