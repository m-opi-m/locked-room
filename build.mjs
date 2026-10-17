// npm run build: بيصغّر web/ ويحطه في public/
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync, appendFileSync } from 'node:fs';
// رقم الإصدار اللي بيظهر في الإعدادات مصدره package.json (حقل version). زوّده مع أي تعديل.
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
// السيرفر محتاج يعرف رقم الإصدار عشان يبعت إشعار "فيه تحديث" بعد النشر.
writeFileSync('src/version.js', `export const APP_VERSION = ${JSON.stringify(VERSION)};\n`);
const o = { minify: true, charset: 'utf8', logLevel: 'warning' };
await build({ ...o, entryPoints: ['web/app.js'], outfile: 'public/app.js', target: 'es2020' });
await build({ ...o, entryPoints: ['web/style.css'], outfile: 'public/style.css' });
writeFileSync('public/index.html', readFileSync('web/index.html', 'utf8').replaceAll('{{APP_VERSION}}', VERSION).replace(/>\s+</g, '><').replace(/\s*\n\s*/g, ' ').trim());

copyFileSync('web/logo.png', 'public/logo.png');
copyFileSync('web/sw.js', 'public/sw.js');
copyFileSync('web/icon-192.png', 'public/icon-192.png');
copyFileSync('web/app-icon.png', 'public/app-icon.png');
copyFileSync('web/apple-touch-icon.png', 'public/apple-touch-icon.png');
copyFileSync('web/badge-96.png', 'public/badge-96.png');

// مسار إرسال الصور بيتضم جوه app.js نفسه (مش ملف لوحده) عشان السيرفر ميرجعش 404 عليه.
appendFileSync('public/app.js', '\n' + (await transform(readFileSync('web/call-audio.js', 'utf8'), { minify: true, charset: 'utf8', target: 'es2020' })).code);
appendFileSync('public/app.js', '\n' + (await transform(readFileSync('web/chat-cache.js', 'utf8'), { minify: true, charset: 'utf8', target: 'es2020' })).code);
appendFileSync('public/app.js', '\n' + (await transform(readFileSync('web/image-send.js', 'utf8'), { minify: true, charset: 'utf8', target: 'es2020' })).code);
