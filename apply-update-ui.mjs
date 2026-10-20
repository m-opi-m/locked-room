// apply-update-ui.mjs — بيطبّق نافذة التحديث الجديدة (جوه الصفحة) على الموقع والتطبيق مرة واحدة.
// الاستخدام (من فولدر الموقع):  node apply-update-ui.mjs
// بيعدّل: web/app-update.js, web/index.html, web/style.css, package.json (يزوّد الإصدار) + MainActivity.kt في مشروع التطبيق.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APP_DIR = process.env.LR_APP_DIR || 'D:\\Projects\\Locked Room App';
const KT = join(APP_DIR, 'app', 'src', 'main', 'java', 'com', 'lockedroom', 'app', 'MainActivity.kt');
const JS = "// \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0645\u0646 \u062c\u0648\u0651\u0627\u0647 (\u062c\u0648\u0647 \u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0623\u0646\u062f\u0631\u0648\u064a\u062f \u0628\u0633). \u0627\u0644\u062a\u0637\u0628\u064a\u0642 (MainActivity) \u0628\u064a\u0628\u0639\u062a \u0627\u0644\u062d\u0627\u0644\u0629 \u0639\u0646 \u0637\u0631\u064a\u0642 window.lrAppUpdate\u060c\n// \u0648\u0627\u0644\u0636\u063a\u0637 \u0628\u064a\u0646\u0627\u062f\u064a window.AndroidUpdate.start() \u0627\u0644\u0644\u064a \u0628\u064a\u0646\u0632\u0651\u0644 \u0627\u0644\u0640 APK \u0644\u0648\u062d\u062f\u0647 \u0648\u064a\u0641\u062a\u062d \u0634\u0627\u0634\u0629 \u0627\u0644\u062a\u062b\u0628\u064a\u062a. \u0628\u064a\u062a\u0636\u0645 \u062c\u0648\u0647 public/app.js \u0648\u0642\u062a \u0627\u0644\u0640 build.\n// \u0645\u0646 \u0625\u0635\u062f\u0627\u0631 \u0627\u0644\u062a\u0637\u0628\u064a\u0642 1.6.3: \u0631\u0633\u0627\u0644\u0629 \u0627\u0644\u062a\u062d\u062f\u064a\u062b \u0628\u062a\u062a\u0639\u0631\u0636 \u0647\u0646\u0627 (\u0646\u0627\u0641\u0630\u0629 \u062c\u0648\u0647 \u0627\u0644\u0635\u0641\u062d\u0629) \u0628\u062f\u0644 \u0646\u0627\u0641\u0630\u0629 \u0623\u0646\u062f\u0631\u0648\u064a\u062f \u0627\u0644\u0623\u0635\u0644\u064a\u0629 \u0627\u0644\u0644\u064a \u0643\u0627\u0646\u062a \u0628\u062a\u0639\u0644\u0651\u0642 \u0627\u0644\u062a\u0637\u0628\u064a\u0642.\n(() => {\n  const btn = document.getElementById('appUpdateBtn');\n  if (!btn) return;\n  const sheet = document.getElementById('updPrompt');\n  const en = () => document.documentElement.lang === 'en';\n  const ua = (navigator.userAgent || '').match(/LockedRoomApp\\/(\\d+)\\.(\\d+)\\.(\\d+)/);\n  // \u0627\u0644\u0646\u0633\u062e \u0627\u0644\u0623\u0642\u062f\u0645 \u0645\u0646 1.6.3 \u0644\u0633\u0647 \u0639\u0646\u062f\u0647\u0627 \u0646\u0627\u0641\u0630\u0629 \u0623\u0635\u0644\u064a\u0629\u060c \u0641\u0645\u0646\u0639\u0631\u0636\u0634 \u0627\u0644\u0646\u0627\u0641\u0630\u0629 \u062f\u064a \u0645\u0639\u0627\u0647\u0627 \u0639\u0634\u0627\u0646 \u0645\u0627\u062a\u062a\u0643\u0631\u0631\u0634.\n  const sheetOk = !!(sheet && ua && (+ua[1]) * 1e6 + (+ua[2]) * 1e3 + (+ua[3]) >= 1006003);\n  const $ = (id) => document.getElementById(id);\n  let s = null, dismissed = '', fromSheet = false, toastT = 0;\n\n  function renderBtn() {\n    if (!s || !s.available || !window.AndroidUpdate) { btn.hidden = true; return; }\n    const busy = s.phase === 'downloading';\n    btn.hidden = false;\n    btn.disabled = busy;\n    btn.classList.toggle('blink', !busy);\n    btn.textContent = busy ? (en() ? 'Downloading\u2026 ' : '\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0645\u064a\u0644\u2026 ') + (s.pct || 0) + '%' : (en() ? 'Update' : '\u062a\u062d\u062f\u064a\u062b');\n  }\n\n  const homeVisible = () => { const h = $('home'); return !!h && !h.classList.contains('hidden'); };\n\n  function hideSheet() { if (sheet) sheet.classList.add('hidden'); }\n\n  function renderSheet() {\n    if (!sheetOk) return;\n    if (!s || !s.available || !window.AndroidUpdate) { fromSheet = false; return hideSheet(); }\n    const ver = s.name ? ' ' + s.name : '';\n    const title = $('updTitle'), msg = $('updMsg'), bar = $('updBar'), fill = $('updFill'), go = $('updGo'), later = $('updLater');\n    const busy = s.phase === 'downloading', ready = s.phase === 'ready';\n    if (!busy && !ready) fromSheet = false;             // \u0641\u0634\u0644 \u0627\u0644\u062a\u062d\u0645\u064a\u0644 \u0623\u0648 \u0627\u062a\u0644\u063a\u0649: \u0627\u0631\u062c\u0639 \u0644\u0644\u0633\u0624\u0627\u0644 \u0627\u0644\u0623\u0648\u0644\n    const show = fromSheet || (s.name !== dismissed && homeVisible());\n    if (!show) return hideSheet();\n    bar.classList.toggle('hidden', !busy);\n    go.classList.toggle('hidden', busy);\n    later.classList.toggle('hidden', busy);\n    if (busy) {\n      title.textContent = en() ? 'Downloading update' : '\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u062a\u062d\u062f\u064a\u062b';\n      msg.textContent = (s.pct || 0) + '%';\n      fill.style.width = Math.max(3, s.pct || 0) + '%';\n    } else if (ready) {\n      title.textContent = en() ? 'Ready to install' : '\u0627\u0644\u062a\u062d\u062f\u064a\u062b \u062c\u0627\u0647\u0632 \u0644\u0644\u062a\u062b\u0628\u064a\u062a';\n      msg.textContent = en() ? 'Tap Install and confirm on the Android screen.' : '\u0627\u0636\u063a\u0637 \u00ab\u062a\u062b\u0628\u064a\u062a\u00bb \u0648\u0643\u0645\u0651\u0644 \u0645\u0646 \u0634\u0627\u0634\u0629 \u0623\u0646\u062f\u0631\u0648\u064a\u062f.';\n      go.textContent = en() ? 'Install' : '\u062a\u062b\u0628\u064a\u062a';\n      later.textContent = en() ? 'Close' : '\u0625\u063a\u0644\u0627\u0642';\n    } else {\n      title.textContent = en() ? 'New update available' : '\u062a\u062d\u062f\u064a\u062b \u062c\u062f\u064a\u062f \u0645\u062a\u0627\u062d';\n      msg.textContent = en() ? 'Version' + ver + ' is ready. It only takes a few seconds.' : '\u0627\u0644\u0625\u0635\u062f\u0627\u0631' + ver + ' \u062c\u0627\u0647\u0632. \u0627\u0644\u062a\u062d\u062f\u064a\u062b \u0628\u064a\u0627\u062e\u062f \u062b\u0648\u0627\u0646\u064a.';\n      go.textContent = en() ? 'Update now' : '\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0622\u0646';\n      later.textContent = en() ? 'Later' : '\u0644\u0627\u062d\u0642\u0627\u064b';\n    }\n    sheet.classList.remove('hidden');\n  }\n\n  function render() { renderBtn(); renderSheet(); }\n\n  function toast(text) {\n    clearTimeout(toastT);\n    let t = $('updToast');\n    if (!t) { t = document.createElement('div'); t.id = 'updToast'; t.className = 'updToast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }\n    t.textContent = text;\n    t.classList.add('on');\n    toastT = setTimeout(() => t.classList.remove('on'), 3200);\n  }\n\n  window.lrAppUpdate = (o) => { s = o; render(); };\n  btn.addEventListener('click', () => { try { window.AndroidUpdate.start(); } catch {} });\n  if (sheetOk) {\n    $('updGo').addEventListener('click', () => { fromSheet = true; try { window.AndroidUpdate.start(); } catch {} });\n    $('updLater').addEventListener('click', () => {\n      fromSheet = false; dismissed = (s && s.name) || '';\n      hideSheet();\n      toast(en() ? 'You can update anytime from Settings.' : '\u062a\u0642\u062f\u0631 \u062a\u062d\u062f\u0651\u062b \u0641\u064a \u0623\u064a \u0648\u0642\u062a \u0645\u0646 \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a.');\n    });\n    setInterval(() => { if (s && s.available && sheet.classList.contains('hidden')) renderSheet(); }, 2500);   // \u0644\u0648 \u0643\u0627\u0646 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u062c\u0648\u0647 \u0645\u062d\u0627\u062f\u062b\u0629\u060c \u0627\u0633\u062a\u0646\u0649 \u0644\u062d\u062f \u0645\u0627 \u064a\u0631\u062c\u0639 \u0644\u0644\u0631\u0626\u064a\u0633\u064a\u0629\n  }\n  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });\n  try { if (window.AndroidUpdate) { s = JSON.parse(window.AndroidUpdate.state()); render(); } } catch {}\n})();\n";
const HTML = "<div id=\"updPrompt\" class=\"updPrompt hidden\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"updTitle\"><div class=\"updCard\"><span class=\"updIcon\"><svg class=\"uiIcon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><use href=\"#i-chev-up\"/></svg></span><h2 id=\"updTitle\">\u062a\u062d\u062f\u064a\u062b \u062c\u062f\u064a\u062f \u0645\u062a\u0627\u062d</h2><p id=\"updMsg\" class=\"lead\"></p><div id=\"updBar\" class=\"updBar hidden\"><i id=\"updFill\"></i></div><div class=\"updRow\"><button id=\"updLater\" type=\"button\">\u0644\u0627\u062d\u0642\u0627\u064b</button><button id=\"updGo\" class=\"primary\" type=\"button\">\u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0622\u0646</button></div></div></div>";
const CSS = "\n/* ===== \u0646\u0627\u0641\u0630\u0629 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u062a\u0637\u0628\u064a\u0642 (\u062c\u0648\u0647 \u0627\u0644\u0635\u0641\u062d\u0629\u060c \u0645\u0646 \u0625\u0635\u062f\u0627\u0631 \u0627\u0644\u062a\u0637\u0628\u064a\u0642 1.6.3) ===== */\n.updPrompt{position:fixed;inset:0;z-index:85;display:grid;place-items:center;padding:1rem;background:#02060de0;backdrop-filter:blur(6px)}\n.updPrompt.hidden{display:none}\n.updCard{width:min(100%,380px);display:grid;gap:.85rem;text-align:center;background:linear-gradient(165deg,#112548,#0a1932);border:1px solid var(--gline);border-radius:var(--r3);padding:1.6rem 1.4rem 1.3rem;box-shadow:var(--shadow);animation:sheetEnter .28s ease both}\n.updIcon{width:64px;height:64px;margin:0 auto;border-radius:22px;display:grid;place-items:center;background:linear-gradient(145deg,#14406a,#0d6560);border:1px solid #2fe1b73d;box-shadow:0 10px 34px #22d8ae2e}\n.updIcon .uiIcon{width:32px;height:32px;margin:0}\n.updCard h2{font-size:1.2rem;margin:0}\n.updCard .lead{margin:0;color:var(--mute);font-size:.98rem;line-height:1.6}\n.updBar{height:8px;border-radius:99px;background:var(--line);overflow:hidden}\n.updBar.hidden{display:none}\n.updBar i{display:block;height:100%;width:3%;border-radius:99px;background:linear-gradient(90deg,var(--g2),var(--g));transition:width .25s ease}\n.updRow{display:flex;gap:.6rem;margin-top:.2rem}\n.updRow button{flex:1;min-height:46px;border-radius:14px}\n.updRow button.hidden{display:none}\n.updToast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 28px);transform:translate(-50%,16px);z-index:90;max-width:min(92vw,420px);padding:.7rem 1.1rem;border-radius:14px;background:var(--panel2);border:1px solid var(--line2);color:var(--text);font-size:.92rem;text-align:center;box-shadow:var(--shadow-s);opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease}\n.updToast.on{opacity:1;transform:translate(-50%,0)}\n";

const read = (p) => { const raw = readFileSync(p, 'utf8'); const crlf = raw.includes('\r\n'); return { text: raw.replace(/\r\n/g, '\n'), crlf }; };
const write = (p, text, crlf) => writeFileSync(p, crlf ? text.replace(/\n/g, '\r\n') : text, 'utf8');
const fail = (m) => { console.error('❌ ' + m); process.exit(1); };

for (const f of ['web/app-update.js', 'web/index.html', 'web/style.css', 'package.json']) if (!existsSync(f)) fail('شغّل السكريبت من فولدر الموقع (مش لاقي ' + f + ')');
if (!existsSync(KT)) fail('مش لاقي MainActivity.kt في: ' + KT + '\nلو مشروع التطبيق في مكان تاني: set LR_APP_DIR=المسار');

// ---- حضّر كل التعديلات في الذاكرة الأول (لو حاجة فشلت مفيش ملف يتغيّر) ----
const out = [];
let firstTime = false;

// 1) index.html
{
  const { text, crlf } = read('web/index.html');
  if (text.includes('id="updPrompt"')) console.log('• index.html: متطبّق قبل كده');
  else {
    const marker = '<div id="shield">';
    if (text.split(marker).length !== 2) fail('index.html: مش لاقي <div id="shield"> الوحيد');
    out.push(['web/index.html', text.replace(marker, () => HTML + '\n' + marker), crlf]); firstTime = true;
  }
}
// 2) style.css
{
  const { text, crlf } = read('web/style.css');
  if (text.includes('.updPrompt{')) console.log('• style.css: متطبّق قبل كده');
  else { out.push(['web/style.css', text.replace(/\s*$/, '\n') + CSS, crlf]); firstTime = true; }
}
// 3) app-update.js (استبدال كامل)
{
  const { text, crlf } = read('web/app-update.js');
  if (text === JS) console.log('• app-update.js: متطبّق قبل كده'); else { out.push(['web/app-update.js', JS, crlf]); firstTime = true; }
}
// 4) MainActivity.kt: شيل النافذة الأصلية (دي اللي كانت بتعلّق التطبيق)
{
  const { text, crlf } = read(KT);
  if (!text.includes('showUpdateDialog')) console.log('• MainActivity.kt: متطبّق قبل كده');
  else {
    let t = text;
    t = t.replace(/^[ \t]*private var updateDialogFor\b.*\n/m, '');
    t = t.replace(/^[ \t]*private var updateDialog\b.*\n/m, '');
    const a = t.indexOf('            val has = updater.check()');
    const b = t.indexOf('showUpdateDialog()\n            }\n', a);
    if (a < 0 || b < 0) fail('MainActivity.kt: شكل checkForUpdate مختلف عن المتوقع، ابعتلي الملف.');
    const bEnd = b + 'showUpdateDialog()\n            }\n'.length;
    t = t.slice(0, a) + '            updater.check()\n            pushUpdateState()   // الموقع هو اللي بيعرض رسالة التحديث (من غير نافذة أندرويد)\n' + t.slice(bEnd);
    const f = t.search(/\n    private fun showUpdateDialog\(\) \{/);
    const fEnd = f < 0 ? -1 : t.indexOf('\n    }\n', f + 1);
    if (f < 0 || fEnd < 0) fail('MainActivity.kt: مش لاقي دالة showUpdateDialog.');
    t = t.slice(0, f) + t.slice(fEnd + '\n    }\n'.length - 1);
    if (/showUpdateDialog|updateDialog/.test(t)) fail('MainActivity.kt: لسه فيه بقايا للنافذة القديمة، ابعتلي الملف.');
    out.push([KT, t, crlf]);
  }
}
// 5) زوّد إصدار الموقع (قاعدة المشروع) — مرة واحدة بس
if (firstTime) {
  const { text, crlf } = read('package.json');
  const m = text.match(/"version":\s*"(\d+)\.(\d+)\.(\d+)"/);
  if (!m) fail('package.json: مش لاقي version');
  const next = `${m[1]}.${m[2]}.${+m[3] + 1}`;
  out.push(['package.json', text.replace(m[0], `"version": "${next}"`), crlf]);
  console.log('• إصدار الموقع: ' + m[1] + '.' + m[2] + '.' + m[3] + ' → ' + next);
}

for (const [p, t, crlf] of out) { write(p, t, crlf); console.log('✔ اتعدّل: ' + p); }
console.log(out.length ? '\n✅ تمام. الخطوة الجاية: npm run release -- 1.6.3' : '\nمفيش جديد — كله متطبّق.');
