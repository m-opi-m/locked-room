// release-app.mjs — نشر تحديث تطبيق الأندرويد بأمر واحد.
// حطه في فولدر الموقع (جنب package.json)، وشغّله من هناك:
//   npm run release -- patch                 (1.6.1 -> 1.6.2)
//   npm run release -- minor                 (1.6.1 -> 1.7.0)
//   npm run release -- 1.8.0                 (رقم محدد)
//   npm run release -- patch "ملاحظات التحديث"
//
// بيعمل: يزوّد versionName/versionCode في build.gradle.kts -> يبني ويوقّع الـ APK
//        -> ينسخه لـ app-release/locked-room.apk -> يحدّث app-update.json -> npm run deploy.
// الرقم الأساسي بيتاخد من app-release/app-update.json (آخر إصدار اتنشر).

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.LR_APP_DIR || 'D:\\Projects\\Locked Room App';
const SITE_URL = 'https://locked-room.mm284817.workers.dev';

const GRADLE_FILE = join(APP_DIR, 'app', 'build.gradle.kts');
const APK_BUILT = join(APP_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const REL_DIR = join(SITE_DIR, 'app-release');
const META_FILE = join(REL_DIR, 'app-update.json');
const APK_DEST = join(REL_DIR, 'locked-room.apk');

const die = (m) => { console.error('\n❌ ' + m + '\n'); process.exit(1); };
const run = (cmd, args, cwd, env = process.env) =>
  spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true, env }).status === 0;

// ---------- المدخلات ----------
const [bump = '', ...noteWords] = process.argv.slice(2);
const notes = noteWords.join(' ');
if (!bump) die('اكتب نوع التحديث: patch أو minor أو major أو رقم زي 1.8.0\n   مثال: npm run release -- patch');

// ---------- فحوصات ----------
if (!existsSync(GRADLE_FILE)) die(`مش لاقي ${GRADLE_FILE}\n   لو مشروع التطبيق في مكان تاني، اضبط المتغير LR_APP_DIR.`);
if (!existsSync(join(APP_DIR, 'gradlew.bat'))) die('مفيش gradlew.bat في فولدر مشروع التطبيق.');
if (!existsSync(join(APP_DIR, 'keystore.properties'))) die('مفيش keystore.properties في فولدر مشروع التطبيق (محتاجه عشان التوقيع).');

// ---------- حساب الإصدار الجديد ----------
const base = existsSync(META_FILE)
  ? JSON.parse(readFileSync(META_FILE, 'utf8'))
  : { versionCode: 0, versionName: '1.0.0' };
const [maj, min, pat] = String(base.versionName).split('.').map(Number);
if ([maj, min, pat].some(Number.isNaN)) die(`versionName في app-update.json مش بالشكل 1.2.3: ${base.versionName}`);

let name;
if (bump === 'patch') name = `${maj}.${min}.${pat + 1}`;
else if (bump === 'minor') name = `${maj}.${min + 1}.0`;
else if (bump === 'major') name = `${maj + 1}.0.0`;
else if (/^\d+\.\d+\.\d+$/.test(bump)) name = bump;
else die('النوع لازم يكون patch أو minor أو major أو رقم زي 1.8.0');
if (name === base.versionName) die(`الإصدار ${name} هو نفس المنشور حالياً.`);
const code = Number(base.versionCode) + 1;

// ---------- تعديل build.gradle.kts ----------
const original = readFileSync(GRADLE_FILE, 'utf8');
if (!/versionCode\s*=\s*\d+/.test(original) || !/versionName\s*=\s*"[^"]*"/.test(original)) {
  die('مش لاقي سطر versionCode أو versionName في build.gradle.kts');
}
writeFileSync(
  GRADLE_FILE,
  original
    .replace(/versionCode\s*=\s*\d+/, `versionCode = ${code}`)
    .replace(/versionName\s*=\s*"[^"]*"/, `versionName = "${name}"`)
);

// ---------- بناء وتوقيع الـ APK ----------
const env = { ...process.env };
if (!env.JAVA_HOME) {
  const jbr = 'C:\\Program Files\\Android\\Android Studio\\jbr';
  if (existsSync(jbr)) env.JAVA_HOME = jbr;
}
console.log(`\n🔨 بابني الإصدار ${name} (versionCode ${code})...\n`);
const built = run('gradlew.bat', ['assembleRelease'], APP_DIR, env);
if (!built || !existsSync(APK_BUILT)) {
  writeFileSync(GRADLE_FILE, original);
  die('البناء فشل، ورجّعت build.gradle.kts زي ما كان.\n   لو الـ APK طلع unsigned، راجع إعداد التوقيع (signingConfig) و keystore.properties.');
}

// ---------- النسخ + تحديث الـ JSON ----------
mkdirSync(REL_DIR, { recursive: true });
copyFileSync(APK_BUILT, APK_DEST);
writeFileSync(META_FILE, JSON.stringify({ versionCode: code, versionName: name, notes }) + '\n');

// ---------- النشر ----------
console.log('\n🚀 بنشر على الموقع...\n');
if (!run('npm', ['run', 'deploy'], SITE_DIR)) {
  die('النشر فشل. الـ APK والـ JSON اتجهزوا؛ صلّح المشكلة وشغّل: npm run deploy (من غير release).');
}

// ---------- تأكيد ----------
try {
  const r = await fetch(`${SITE_URL}/app-update.json?t=${Date.now()}`);
  const j = await r.json();
  if (j.versionCode === code) console.log(`\n✅ تم النشر: ${name} (versionCode ${code}) — السيرفر بيرجّعه دلوقتي.\n`);
  else console.log(`\n⚠️ النشر خلص بس السيرفر لسه بيرجّع versionCode ${j.versionCode}. جرّب تفتح الرابط بعد ثواني.\n`);
} catch {
  console.log(`\n✅ النشر خلص. افتح ${SITE_URL}/app-update.json وتأكد من الرقم.\n`);
}
