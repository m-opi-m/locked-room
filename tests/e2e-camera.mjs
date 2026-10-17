// اختبار حقيقي للكاميرا الجديدة (1.27.0): كاميرا وهمية في كروم + A و B في غرفة على wrangler dev.
// تشغيل: node build.mjs && npx wrangler dev --local --port 8787 --ip 127.0.0.1  ثم  node tests/e2e-camera.mjs
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const mk = async (sub, did) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, permissions: ['camera', 'microphone'] });
  await ctx.addCookies([{ name: 'did', value: did, url: BASE }, { name: 'sid', value: await sid(sub, did), url: BASE }]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => sessionStorage.setItem('lr.permLater', '1'));
  await p.goto(BASE); await p.evaluate(() => setInterval(() => { const e = document.getElementById('notificationPrompt'); if (e) e.style.display = 'none'; }, 100)); p.errs = errs; return p;
};
const stamp = Date.now(); let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const A = await mk('ca' + stamp, 'c'.repeat(24)), B = await mk('cb' + stamp, 'd'.repeat(24));
for (const p of [A, B]) { await p.waitForTimeout(800); await p.locator('#permLater').click({ timeout: 2000 }).catch(() => {}); }
const pw = 'Room-pw-' + stamp;
await A.click('#create'); await A.fill('#pw', pw); await A.click('#pwGo');
await A.waitForFunction(() => /[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/.test(document.getElementById('log')?.innerText || ''), null, { timeout: 30000 });
const code = (await A.locator('#log').innerText()).match(/[A-Z0-9]{4}(-[A-Z0-9]{4}){5}/)[0];
await B.click('#joinOpen'); await B.fill('#codeIn', code); await B.click('#join'); await B.fill('#pw', pw); await B.click('#pwGo');
await A.waitForTimeout(4000);

// ---- 1) فتح الكاميرا بضغطة واحدة ----
await A.click('#cameraBtn');
await A.waitForSelector('.lrcam:not(.hidden)', { timeout: 8000 }).catch(() => {});
ok('شاشة الكاميرا الجديدة اتفتحت', await A.locator('.lrcam:not(.hidden)').count() === 1);
await A.waitForTimeout(800);
ok('المعاينة الحية شغالة', await A.evaluate(() => { const v = document.getElementById('lrcamVid'); return v.videoWidth > 0 && !v.paused; }));
ok('زرار الفلاش فوق + X + المعرض + قلب الكاميرا + الزرار الكبير + تبويبات صورة/فيديو',
  (await A.locator('#lrcamFlash').isVisible()) && (await A.locator('#lrcamClose').isVisible()) && (await A.locator('#lrcamGal').isVisible()) &&
  (await A.locator('#lrcamFlip').isVisible()) && (await A.locator('#lrcamShutter').isVisible()) && (await A.locator('.lrcamModes button').count()) === 2);
ok('شريط آخر الصور مخفي لما مفيش حاجة', !(await A.locator('#lrcamStrip').isVisible()));
ok('الكاميرا القديمة ما اتفتحتش', !(await A.locator('#captureDialog:not(.hidden)').count()));

// ---- 2) ضغطة واحدة = صورة → تدخل معاينة الصورة مباشرة ----
await A.click('#lrcamShutter');
await A.waitForSelector('.lrp:not(.hidden)', { timeout: 8000 }).catch(() => {});
ok('أول ما تاخد صورة: دخلت صفحة المعاينة', await A.locator('.lrp:not(.hidden) #lrpCv').isVisible());
ok('أدوات التعديل ظاهرة (رسم/تدوير/قص)', (await A.locator('#lrpPen').isVisible()) && (await A.locator('#lrpRotTop').isVisible()) && (await A.locator('#lrpCrop').isVisible()));
const cb = await A.locator('#lrpCaption').boundingBox(), sb = await A.locator('#lrpSend').boundingBox();
ok('الشرح وزرار الإرسال في نفس الصف', Math.abs((cb.y + cb.height / 2) - (sb.y + sb.height / 2)) < 12);
const cv = await A.locator('#lrpCv').boundingBox();
ok('الصورة بتملا مساحة العرض', cv.width > 360 && cv.height > 400);
// تدوير
const w0 = await A.evaluate(() => [document.getElementById('lrpCv').width, document.getElementById('lrpCv').height]);
await A.click('#lrpRotTop');
const w1 = await A.evaluate(() => [document.getElementById('lrpCv').width, document.getElementById('lrpCv').height]);
ok('التدوير بدّل العرض والطول', w0[0] === w1[1] && w0[1] === w1[0]);
// رسم
await A.click('#lrpPen');
ok('لوحة ألوان الرسم ظهرت', await A.locator('#lrpDraw').isVisible());
const before = await A.evaluate(() => { const c = document.getElementById('lrpCv'); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join(',').length; });
const cb2 = await A.locator('#lrpCv').boundingBox();
await A.mouse.move(cb2.x + 60, cb2.y + 200); await A.mouse.down(); await A.mouse.move(cb2.x + 260, cb2.y + 320, { steps: 10 }); await A.mouse.up();
const drew = await A.evaluate(() => { const c = document.getElementById('lrpCv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] < 90 && d[i + 2] < 90) r++; return r; });
ok('الرسم ظهر على الصورة (بكسلات حمرا: ' + drew + ')', drew > 200);
await A.click('#lrpUndo');
const undone = await A.evaluate(() => { const c = document.getElementById('lrpCv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] < 90 && d[i + 2] < 90) r++; return r; });
ok('التراجع شال الرسم', undone < drew / 4);
await A.click('#lrpPen');
// رجوع بـ X: يرجع للكاميرا
await A.click('#lrpClose');
ok('X في المعاينة بترجّع للكاميرا (لسه مفتوحة)', (await A.locator('.lrcam:not(.hidden)').count()) === 1 && (await A.locator('.lrp:not(.hidden)').count()) === 0);
ok('شريط آخر الصور فيه الصورة اللي اتصورت', await A.locator('#lrcamStrip .lrcamThumb').count() === 1);
// الضغط على صورة من الشريط → معاينة
await A.click('#lrcamStrip .lrcamThumb');
await A.waitForSelector('.lrp:not(.hidden)', { timeout: 8000 }).catch(() => {});
ok('الضغط على صورة من الشريط فتح المعاينة', await A.locator('.lrp:not(.hidden) #lrpCv').isVisible());
const imgs0 = await B.locator('#log img').count();
await A.fill('#lrpCaption', 'صورة من الكاميرا ' + stamp);
await A.click('#lrpSend');
await B.waitForFunction((n) => document.querySelectorAll('#log img').length > n, imgs0, { timeout: 20000 }).catch(() => {});
ok('B استلم الصورة', (await B.locator('#log img').count()) === imgs0 + 1);
ok('الشرح جوه نفس الفقاعة عند B', await B.evaluate((t) => [...document.querySelectorAll('#log .m')].some((x) => x.querySelector('.imgCap img') && x.innerText.includes(t)), 'صورة من الكاميرا ' + stamp));
ok('الكاميرا اتقفلت بعد الإرسال', (await A.locator('.lrcam:not(.hidden)').count()) === 0);

// ---- 3) ضغطة مطولة = فيديو → وضع "إضافة" ----
await A.click('#cameraBtn');
await A.waitForSelector('.lrcam:not(.hidden)'); await A.waitForTimeout(700);
ok('الشريط لسه فيه آخر الصور بعد إعادة الفتح', await A.locator('#lrcamStrip .lrcamThumb').count() === 1);
// المعرض من جوه الكاميرا: صورة → معاينة → X يرجع للكاميرا، وبتتضاف لشريط آخر الصور
ok('input المعرض مش ظاهر على الشاشة', await A.evaluate(() => { const r = document.getElementById('lrcamPick').getBoundingClientRect(); return r.right < 0 || r.left > innerWidth; }));
{
  const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.click('#lrcamGal')]);
  await chooser.setFiles({ name: 'g.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
  await A.waitForSelector('.lrp:not(.hidden)', { timeout: 8000 }).catch(() => {});
  ok('صورة من المعرض فتحت المعاينة', await A.locator('.lrp:not(.hidden) #lrpCv').isVisible());
  await A.click('#lrpClose');
  ok('X يرجع للكاميرا والصورة اتضافت للشريط', (await A.locator('.lrcam:not(.hidden)').count()) === 1 && (await A.locator('#lrcamStrip .lrcamThumb').count()) === 2);
}
const sh = await A.locator('#lrcamShutter').boundingBox();
await A.mouse.move(sh.x + sh.width / 2, sh.y + sh.height / 2); await A.mouse.down();
await A.waitForTimeout(900);
ok('أثناء الضغط المطوّل: بيسجل فيديو (مؤشر التسجيل)', await A.locator('#lrcamRec:not(.hidden)').count() === 1);
await A.waitForTimeout(3200);
await A.mouse.up();
await A.waitForSelector('.lrve:not(.hidden)', { timeout: 10000 }).catch(() => {});
ok('بعد الفيديو: دخل وضع الإضافة (محرر الفيديو)', await A.locator('.lrve:not(.hidden)').count() === 1);
await A.waitForTimeout(2500);
ok('شريط القص فيه لقطات', await A.locator('.lrveFr').count() >= 6);
const dur = await A.evaluate(() => document.getElementById('lrveVid').duration);
ok('مدة الفيديو معروفة (' + dur + ')', isFinite(dur) && dur > 2);
const pill0 = await A.locator('#lrveTxt').innerText();
ok('شريط المعلومات فيه المدة والحجم: ' + pill0, /•/.test(pill0));
ok('زرار مكبر الصوت ظاهر (الفيديو فيه صوت)', await A.locator('#lrveMute').isVisible());
ok('الشرح + الإرسال موجودين', (await A.locator('#lrveCap').isVisible()) && (await A.locator('#lrveSend').isVisible()));
// قص: اسحب المقبض الأيمن لنص الشريط تقريباً
const st = await A.locator('#lrveStrip').boundingBox();
const rh = await A.locator('.lrveSel .h[data-h="r"]').boundingBox();
await A.mouse.move(rh.x + rh.width / 2, rh.y + rh.height / 2); await A.mouse.down();
await A.mouse.move(st.x + st.width * 0.5, rh.y + rh.height / 2, { steps: 10 }); await A.mouse.up();
const pill1 = await A.locator('#lrveTxt').innerText();
ok('القص غيّر المدة/الحجم: ' + pill0 + ' → ' + pill1, pill1 !== pill0);
// كتم الصوت
await A.click('#lrveMute');
ok('زرار الكتم اتفعّل', await A.evaluate(() => document.getElementById('lrveMute').classList.contains('on') && document.getElementById('lrveVid').muted));
await A.fill('#lrveCap', 'مقصوص ومكتوم ' + stamp);
const vids0 = await B.locator('#log video').count();
await A.click('#lrveSend');
await B.waitForFunction((n) => document.querySelectorAll('#log video').length > n, vids0, { timeout: 40000 }).catch(() => {});
ok('B استلم الفيديو', (await B.locator('#log video').count()) === vids0 + 1);
ok('شرح الفيديو جوه نفس الفقاعة', await B.evaluate((t) => [...document.querySelectorAll('#log .m')].some((x) => x.querySelector('.imgCap video') && x.innerText.includes(t)), 'مقصوص ومكتوم ' + stamp));
const info = await B.evaluate(async () => {
  const v = [...document.querySelectorAll('#log video')].pop(); await new Promise((r) => { if (v.readyState >= 1) r(); else v.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 3000); });
  if (!isFinite(v.duration)) { v.currentTime = 1e7; await new Promise((r) => { v.addEventListener('durationchange', r, { once: true }); setTimeout(r, 2000); }); }
  return { d: v.duration, audio: !!(v.webkitAudioDecodedByteCount !== undefined) };
});
ok('الفيديو المبعوت أقصر من الأصلي (' + info.d + ' < ' + dur + ')', info.d > 0.5 && info.d < dur - 0.6);
ok('الكاميرا والمحرر اتقفلوا بعد الإرسال', (await A.locator('.lrcam:not(.hidden)').count()) === 0 && (await A.locator('.lrve:not(.hidden)').count()) === 0);
ok('مفيش أخطاء صفحة', A.errs.length === 0 && B.errs.length === 0);
console.log('errs', A.errs, B.errs);
await browser.close(); process.exit(fails ? 1 : 0);
