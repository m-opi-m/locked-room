// npm run build: بيصغّر web/ ويحطه في public/
import { build } from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
const o = { minify: true, charset: 'utf8', logLevel: 'warning' };
await build({ ...o, entryPoints: ['web/app.js'], outfile: 'public/app.js', target: 'es2020' });
await build({ ...o, entryPoints: ['web/style.css'], outfile: 'public/style.css' });
writeFileSync('public/index.html', readFileSync('web/index.html', 'utf8').replace(/>\s+</g, '><').replace(/\s*\n\s*/g, ' ').trim());

copyFileSync('web/logo.png', 'public/logo.png');
