// بيتأكد إن أي تعديل في الكود اتبعه زيادة في رقم الإصدار (package.json -> "version").
// الرقم ده هو اللي بيظهر في الإعدادات (V : x.y.z) ومصدره الوحيد package.json.
//   node check-version.mjs           -> تحذير بس (بيشتغل مع npm run build)
//   node check-version.mjs --strict  -> بيفشل لو الإصدار ماتزودش (بيشتغل مع npm run deploy)
//   node check-version.mjs --stamp   -> بيسجل الحالة الحالية كآخر إصدار منشور (بيشتغل بعد النشر)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const mode = process.argv[2] || '';
const LOCK = 'version.lock.json';
const TRACKED = ['src', 'web', 'build.mjs', 'wrangler.toml'];

const files = (p) => statSync(p).isDirectory() ? readdirSync(p).sort().flatMap((f) => files(join(p, f))) : [p];
const hash = createHash('sha256');
for (const f of TRACKED.filter(existsSync).flatMap(files)) hash.update(f + '\0').update(readFileSync(f));
const current = hash.digest('hex');

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('❌ حقل "version" في package.json لازم يبقى بالشكل 1.0.1'); process.exit(1); }
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : { version: '0.0.0', hash: '' };
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

if (mode === '--stamp') {
  writeFileSync(LOCK, JSON.stringify({ version, hash: current }, null, 2) + '\n');
  console.log(`✅ اتسجل الإصدار ${version} كآخر إصدار منشور.`);
  process.exit(0);
}

if (current === lock.hash) process.exit(0); // مفيش تعديلات من آخر نشر
if (cmp(version, lock.version) > 0) { console.log(`✅ الإصدار اتزود: ${lock.version} → ${version}`); process.exit(0); }

console.error(`\n⚠️  في تعديلات في الكود، بس رقم الإصدار لسه ${version} (هو نفسه آخر إصدار منشور).\n   زوّد "version" في package.json (مثلاً 1.0.1 → 1.0.2)، وهو اللي بيظهر في الإعدادات.\n`);
process.exit(mode === '--strict' ? 1 : 0);
