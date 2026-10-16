// أول ما الصفحة تتفتح من غير أي ضغطة: لازم يطلب الإشعارات + الكاميرا/المايك. ومع أول لمسة ما يطلبش تاني لو اتمنحوا.
import { createRequire } from 'node:module';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
await ctx.addInitScript(() => {
  window.__calls = { notif: 0, gum: [] };
  let perm = 'default'; const st = { camera: 'prompt', microphone: 'prompt' };
  Object.defineProperty(Notification, 'permission', { get: () => perm });
  Notification.requestPermission = async () => { if (perm === 'default') window.__calls.notif++; perm = 'granted'; return 'granted'; }; // الاستدعاءات بعد المنح مش بتتعد (المتصفح بيرجّعها فوراً)
  navigator.permissions.query = async ({ name }) => ({ state: name === 'notifications' ? (perm === 'default' ? 'prompt' : perm) : st[name] || 'prompt' });
  navigator.mediaDevices.getUserMedia = async (c) => { window.__calls.gum.push(JSON.stringify(c)); if (c.video) st.camera = 'granted'; if (c.audio) st.microphone = 'granted'; return { getTracks: () => [{ stop() {} }] }; };
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:8787/');
await page.waitForTimeout(2500);
let r = await page.evaluate(() => window.__calls);
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
ok(r.notif === 1, 'طلب إذن الإشعارات تلقائياً بدون ضغط (' + r.notif + ')');
ok(r.gum.length === 1 && r.gum[0].includes('"video":true') && r.gum[0].includes('"audio":true'), 'طلب الكاميرا والمايك تلقائياً: ' + r.gum.join(' '));
await page.mouse.click(200, 400); await page.waitForTimeout(1200);
r = await page.evaluate(() => window.__calls);
ok(r.notif === 1 && r.gum.length === 1, 'أول لمسة ما كرّرتش الطلب بعد ما الأذونات اتمنحت');
await b.close(); process.exit(f ? 1 : 0);
