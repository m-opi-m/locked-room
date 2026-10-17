// اختبار حقيقي (1.16.0): كارت الكود + بادج الطرق + ترتيب المحادثات — سحب لليمين، قايمة الضغط المطوّل، شريط الرد، الاقتباس عند الطرفين، والتاريخ بعد إعادة الدخول.
// (1.27.1) تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-reply.mjs
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

const mk = async (sub, did, locale) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs;
  await p.addInitScript(() => { try { sessionStorage.setItem('lr.permLater', '1'); } catch {} });
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { for (const id of ['notificationPrompt','permModal']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } }, 100));
  return p;
};
const A = await mk('la' + stamp, 'a'.repeat(24), 'en-US'), B = await mk('lb' + stamp, 'b'.repeat(24), 'ar-EG'), C = await mk('lc' + stamp, 'c'.repeat(24), 'en-US');
for (const p of [A, B, C]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
const create = async (p, pw) => { await p.click('#create'); await p.fill('#pw', pw); await p.click('#pwGo'); await p.waitForSelector('.codeCard', { timeout: 30000 }); return await p.locator('.codeCard').first().getAttribute('data-code'); };
const join = async (p, code, pw) => { await p.click('#joinOpen'); await p.fill('#codeIn', code); await p.click('#join'); await p.fill('#pw', pw); await p.click('#pwGo'); };
const connected = (p) => p.waitForFunction(() => document.getElementById('status')?.textContent && /^(متصل|Connected)$/.test(document.getElementById('status').textContent), null, { timeout: 15000 }).then(() => true).catch(() => false);
const send = async (p, t) => { await p.fill('#msg', t); await p.press('#msg', 'Enter'); await p.waitForTimeout(500); };
const msgs = (p) => p.evaluate(() => [...document.querySelectorAll('#log .m > p')].map((e) => e.textContent));

const pw = 'Room-pass-' + stamp;
const code = await create(A, pw);
ok('A (English): textarea placeholder translated', (await A.getAttribute('#msg', 'placeholder')) === 'Type a message');
ok('A (English): code card in English', (await A.locator('.codeCardHead span').first().textContent()) === 'Room code' && /never sent/.test(await A.locator('.codeCardNote').first().textContent()));
ok('B (Arabic): placeholder Arabic', (await B.getAttribute('#msg', 'placeholder')) === 'اكتب رسالة');
// Arabic left in English UI?
const arLeft = await A.evaluate(() => { const out = []; for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) for (const a of ['placeholder','aria-label','title']) { const v = el.getAttribute(a); if (v && /[\u0600-\u06FF]/.test(v)) out.push(el.id + ':' + a + ':' + v); } return out; });
console.log('Arabic attrs left in English chat UI:', JSON.stringify(arLeft));

await join(B, code, pw);
ok('both connected', (await connected(A)) && (await connected(B)));
// messages that collide with dictionary words must stay untouched
await send(A, 'نسخ'); await send(A, 'Hello there'); await send(B, 'Copy'); await send(B, 'Cancel');
await A.waitForTimeout(800);
const ma = await msgs(A), mb = await msgs(B);
console.log('A sees', JSON.stringify(ma), 'B sees', JSON.stringify(mb));
ok('English UI: Arabic message not translated', ma.includes('نسخ') && !ma.includes('Copy') || (ma.includes('نسخ') && ma.includes('Copy')));
ok('English UI: other side\'s English message "Copy" stays', ma.includes('Copy') && ma.includes('Cancel'));
ok('Arabic UI: English message "Copy" not turned into Arabic', mb.includes('Copy') && mb.includes('Cancel') && mb.includes('نسخ'));
ok('own message unchanged (A)', ma.includes('نسخ') && ma.includes('Hello there'));
// reply quote text not translated
// share: no native share -> sheet with WhatsApp etc.
await A.evaluate(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch {} });
await A.locator('.codeCardActions button').nth(1).click(); await A.waitForTimeout(500);
const sheet = await A.evaluate(() => { const s = document.querySelector('.lrShareSheet'); return s ? { links: [...s.querySelectorAll('a')].map((a) => a.getAttribute('href')), text: s.textContent } : null; });
ok('no native share -> share sheet shown', !!sheet);
const waHref = sheet && sheet.links.find((h) => h.startsWith('https://wa.me/?text='));
ok('WhatsApp link carries the room link', !!waHref && decodeURIComponent(waHref).includes('/#' + code.replace(/-/g, '')) );
ok('link has no password / dashes', !!waHref && !decodeURIComponent(waHref).includes(pw));
console.log('share links:', JSON.stringify(sheet && sheet.links.map((h) => decodeURIComponent(h).slice(0, 140))));
await A.evaluate(() => document.querySelector('.lrShareClose').click());
ok('sheet closes', (await A.locator('.lrShareSheet').count()) === 0);

// (audit) any Arabic left in the English UI (all text nodes + attributes, hidden screens included; user messages excluded)
const left = await A.evaluate(() => { const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.parentElement && n.parentElement.closest('.m>p,.imgCapText,.replyQuote>span,#replyText,[data-lang-switch],script,style')) continue; if (/[\u0600-\u06FF]/.test(n.nodeValue)) out.add(n.nodeValue.trim().slice(0, 80)); } for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) for (const a of ['placeholder','aria-label','title']) { const v = el.getAttribute(a); if (v && /[\u0600-\u06FF]/.test(v)) out.add(a + ': ' + v.slice(0, 80)); } return [...out]; });
console.log('ARABIC LEFT IN ENGLISH UI (' + left.length + '):', JSON.stringify(left, null, 1));
ok('no Arabic text left in English UI (static DOM)', left.length === 0);
// native share available -> used, no sheet
await A.evaluate(() => { window.__sh = null; Object.defineProperty(navigator, 'share', { value: async (d) => { window.__sh = d; }, configurable: true }); });
await A.locator('.codeCardActions button').nth(1).click(); await A.waitForTimeout(400);
const sh = await A.evaluate(() => window.__sh);
ok('native share sheet used when available', !!sh && /\/#[A-Z0-9]{24}/.test(sh.text || '') && (await A.locator('.lrShareSheet').count()) === 0);
console.log('native share payload:', JSON.stringify(sh));
// menu code sheet has share button
await A.click('#menuBtn'); await A.click('#mCode'); 
ok('menu code sheet has Share button', (await A.locator('#shareLink2').count()) === 1 && /Share/.test(await A.locator('#shareLink2').textContent()));
// deep link: new user opens link -> after sign-in lands on password prompt for that room
await C.goto('about:blank'); await C.goto(BASE + '/#' + code.replace(/-/g, '')); await C.waitForTimeout(3000);
const deep = await C.evaluate(() => ({ pwVisible: !!document.getElementById('pw') && document.getElementById('pw').offsetParent !== null, hash: location.hash }));
ok('deep link (fresh open) lands on the password prompt', deep.pwVisible && deep.hash === '');
const D = await C.context().newPage(); D.errs = []; D.on('pageerror', (e) => D.errs.push(e.message));
await D.goto(BASE); await D.waitForTimeout(2500);
await D.evaluate((h) => { location.hash = '#' + h; }, code.replace(/-/g, '')); await D.waitForTimeout(1200);
ok('deep link while app already open (hashchange) -> password prompt', await D.evaluate(() => !!document.getElementById('pw') && document.getElementById('pw').offsetParent !== null));
for (const [n, p] of [['A', A], ['B', B], ['C', C], ['D', D]]) ok('no page errors ' + n, p.errs.length === 0);
if (fails) console.log('page errors:', JSON.stringify([A.errs, B.errs, C.errs, D.errs]));
await browser.close(); console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
