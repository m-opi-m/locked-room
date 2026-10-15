// npm run build: بيصغّر web/ ويحطه في public/
import { build } from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync, appendFileSync } from 'node:fs';
// رقم الإصدار اللي بيظهر في الإعدادات مصدره package.json (حقل version). زوّده مع أي تعديل.
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
const o = { minify: true, charset: 'utf8', logLevel: 'warning' };
await build({ ...o, entryPoints: ['web/app.js'], outfile: 'public/app.js', target: 'es2020' });
await build({ ...o, entryPoints: ['web/style.css'], outfile: 'public/style.css' });
writeFileSync('public/index.html', readFileSync('web/index.html', 'utf8').replace('{{APP_VERSION}}', VERSION).replace(/>\s+</g, '><').replace(/\s*\n\s*/g, ' ').trim());

copyFileSync('web/logo.png', 'public/logo.png');
copyFileSync('web/sw.js', 'public/sw.js');
copyFileSync('web/icon-192.png', 'public/icon-192.png');
copyFileSync('web/badge-96.png', 'public/badge-96.png');

// محرر الصور بيتضم جوه app.js نفسه (مش ملف لوحده) عشان السيرفر ميرجعش 404 عليه.
appendFileSync('public/app.js', '\n' + readFileSync('web/gallery-editor.js', 'utf8'));
