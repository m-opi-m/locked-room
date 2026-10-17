// npm run build: بيصغّر web/ ويحطه في public/
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync, appendFileSync, mkdirSync } from 'node:fs';
// رقم الإصدار اللي بيظهر في الإعدادات مصدره package.json (حقل version). زوّده مع أي تعديل.
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
// السيرفر محتاج يعرف رقم الإصدار عشان يبعت إشعار "فيه تحديث" بعد النشر.
writeFileSync('src/version.js', `export const APP_VERSION = ${JSON.stringify(VERSION)};\n`);
const o = { minify: true, charset: 'utf8', logLevel: 'warning' };
// voice.js بيتحط جوه نفس الـ closure بتاع app.js (قبل قفلته) عشان يشوف متغيراته (t, u, Pe, Ee, ...).
const APP_SRC = readFileSync('web/app.js', 'utf8'), APP_END = '\n})();})();\n';
if (APP_SRC.split(APP_END).length !== 2) throw new Error('build: مش لاقي نهاية app.js الوحيدة اللي هيتحط قبلها voice.js');
const APP_MERGED = APP_SRC.replace(APP_END, () => '\n' + readFileSync('web/voice.js', 'utf8') + '\n' + readFileSync('web/call-ui.js', 'utf8') + '\n' + readFileSync('web/inbox.js', 'utf8') + '\n' + readFileSync('web/vault.js', 'utf8') + '\n' + readFileSync('web/files.js', 'utf8') + '\n' + readFileSync('web/music.js', 'utf8') + '\n' + readFileSync('web/ludo.js', 'utf8') + APP_END);
await build({ ...o, stdin: { contents: APP_MERGED, loader: 'js', sourcefile: 'web/app.js' }, outfile: 'public/app.js', target: 'es2020' });
// فك HEIC (wasm) كملف لوحده بيتحمّل عند الحاجة بس
await build({ ...o, entryPoints: ['web/heic-entry.js'], bundle: true, format: 'iife', platform: 'browser', outfile: 'public/heic.js', target: 'es2020' });
await build({ ...o, entryPoints: ['web/style.css'], outfile: 'public/style.css' });
writeFileSync('public/index.html', readFileSync('web/index.html', 'utf8').replaceAll('{{APP_VERSION}}', VERSION).replace(/>\s+</g, '><').replace(/\s*\n\s*/g, ' ').trim());

// صفحة الأدمن (/admin): ملفات لوحدها (مش جوه app.js)
mkdirSync('public/admin', { recursive: true });
writeFileSync('public/admin/index.html', readFileSync('web/admin.html', 'utf8').replaceAll('{{APP_VERSION}}', VERSION).replace(/>\s+</g, '><').replace(/\s*\n\s*/g, ' ').trim());
await build({ ...o, entryPoints: ['web/admin.js'], outfile: 'public/admin.js', target: 'es2020' });
await build({ ...o, entryPoints: ['web/admin.css'], outfile: 'public/admin.css' });

copyFileSync('web/logo.png', 'public/logo.png');
copyFileSync('web/sw.js', 'public/sw.js');
copyFileSync('web/icon-192.png', 'public/icon-192.png');
copyFileSync('web/app-icon.png', 'public/app-icon.png');
copyFileSync('web/apple-touch-icon.png', 'public/apple-touch-icon.png');
copyFileSync('web/badge-96.png', 'public/badge-96.png');

// مسار إرسال الصور بيتضم جوه app.js نفسه (مش ملف لوحده) عشان السيرفر ميرجعش 404 عليه.
appendFileSync('public/app.js', '\n' + (await transform(readFileSync('web/call-audio.js', 'utf8'), { minify: true, charset: 'utf8', target: 'es2020' })).code);
appendFileSync('public/app.js', '\n' + (await transform(readFileSync('web/days.js', 'utf8'), { minify: true, charset: 'utf8', target: 'es2020' })).code);
appendFileSync('public/app.js', '\n' + (await transform(readFileSync('web/admin-enter.js', 'utf8'), { minify: true, charset: 'utf8', target: 'es2020' })).code);
appendFileSync('public/app.js', '\n' + (await transform(readFileSync('web/chat-cache.js', 'utf8'), { minify: true, charset: 'utf8', target: 'es2020' })).code);
appendFileSync('public/app.js', '\n' + (await transform(readFileSync('web/image-send.js', 'utf8'), { minify: true, charset: 'utf8', target: 'es2020' })).code);
