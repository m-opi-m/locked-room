// اختبار زر مكبر الصوت/سماعة الأذن (setSinkId متزيّف لأن Chromium headless مفيهوش سماعة أذن).
// تشغيل: node build.mjs && node tests/e2e-speaker.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire('/home/claude/.npm-global/lib/node_modules/');
const { chromium } = require('playwright');
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png' };
const srv = createServer((q, r) => {
  const u = q.url.split('?')[0], p = 'public' + (u === '/' ? '/index.html' : u);
  let body; try { body = readFileSync(p); } catch { r.writeHead(404); return r.end(); }
  r.writeHead(200, { connection: 'close', 'content-length': body.length, 'content-type': (MIME[p.split('.').pop()] || 'application/octet-stream') + '; charset=utf-8' }); r.end(body);
}).listen(8766, '127.0.0.1');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
async function run(devices, supported) {
  const pg = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'ar-EG' });
  await pg.route('**/api/**', (r) => r.abort());
  await pg.addInitScript(([devs, sup]) => {
    window.__sinks = [];
    if (sup) HTMLMediaElement.prototype.setSinkId = async function (id) { window.__sinks.push(id); };
    else delete HTMLMediaElement.prototype.setSinkId;
    navigator.mediaDevices.enumerateDevices = async () => devs;
  }, [devices, supported]);
  await pg.goto('http://127.0.0.1:8766/');
  await pg.waitForTimeout(800);
  await pg.addStyleTag({ content: '#notificationPrompt,#permPrompt{display:none!important}' });
  await pg.evaluate(() => { document.querySelectorAll('.screen').forEach((e) => e.classList.add('hidden')); const c = document.getElementById('call'); c.classList.remove('hidden'); c.classList.add('audio'); });
  return pg;
}
const devs = [{ kind: 'audiooutput', deviceId: 'default', label: 'Default' }, { kind: 'audiooutput', deviceId: 'spk1', label: 'Speakerphone' }, { kind: 'audiooutput', deviceId: 'ear1', label: 'Earpiece' }, { kind: 'audioinput', deviceId: 'mic', label: 'Mic' }];
let pg = await run(devs, true);
const state = () => pg.evaluate(() => ({ on: speakerBtn.classList.contains('isOn'), label: speakerLabel.textContent, pressed: speakerBtn.getAttribute('aria-pressed'), href: speakerIcon.querySelector('use').getAttribute('href'), sinks: window.__sinks }));
let s = await state(); ok(s.on && s.label === 'مكبر الصوت' && s.href === '#i-volume', 'البداية: مكبر الصوت شغّال');
await pg.click('#speakerBtn'); await pg.waitForTimeout(150); s = await state();
ok(!s.on && s.label === 'سماعة الأذن' && s.pressed === 'false' && s.href === '#i-phone', 'ضغطة: اتحوّل لسماعة الأذن (الزر والأيقونة)');
ok(s.sinks.at(-1) === 'ear1', 'setSinkId اتنادى بسماعة الأذن: ' + s.sinks.at(-1));
await pg.click('#speakerBtn'); await pg.waitForTimeout(150); s = await state();
ok(s.on && s.sinks.at(-1) === 'spk1', 'ضغطة تانية: رجع للمكبر بالجهاز الصح: ' + s.sinks.at(-1));
await pg.click('#speakerBtn'); await pg.waitForTimeout(150);
await pg.evaluate(() => document.getElementById('call').classList.add('hidden')); await pg.waitForTimeout(150); s = await state();
ok(s.on && s.sinks.at(-1) === '', 'نهاية المكالمة: رجوع للمكبر والمخرج الافتراضي');
mkdirSync('/home/claude/shots/sp', { recursive: true });
await pg.evaluate(() => { const c = document.getElementById('call'); c.classList.remove('hidden', 'audio'); switchCamBtn.hidden = false; callFlash.hidden = false; });
await pg.waitForTimeout(300); await pg.screenshot({ path: '/home/claude/shots/sp/video-all-buttons.png' });
await pg.evaluate(() => { const c = document.getElementById('call'); c.classList.add('audio'); switchCamBtn.hidden = true; callFlash.hidden = true; });
await pg.waitForTimeout(300); await pg.screenshot({ path: '/home/claude/shots/sp/audio.png' });
await pg.close();
// جهاز من غير سماعة أذن كمخرج: لازم يقول بصراحة إنه ما اتحوّلش
pg = await run(devs.filter((d) => d.label !== 'Earpiece'), true);
await pg.click('#speakerBtn'); await pg.waitForTimeout(200); s = await state();
const toast = await pg.evaluate(() => document.querySelector('.lrToast.show')?.textContent || '');
ok(s.on && s.sinks.length === 0 && toast.length > 10, 'مفيش سماعة أذن: الحالة ما اتغيّرتش ورسالة توضيح ظهرت');
await pg.close();
pg = await run(devs, false);
await pg.click('#speakerBtn'); await pg.waitForTimeout(200); s = await state();
ok(s.on && (await pg.evaluate(() => !!document.querySelector('.lrToast.show'))), 'متصفح من غير setSinkId: رسالة توضيح من غير تغيير حالة');
await pg.close(); await b.close(); srv.close();
process.exit(fail ? 1 : 0);
