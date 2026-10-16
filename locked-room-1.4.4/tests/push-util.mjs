import { peerOf, semverGt, updatePayload } from '../src/push-util.js';
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
// حالة الباج: المرسل (حساب A) عنده جهازين قديم/جديد، والطرف التاني (حساب B)
const members = { a1: { sub: 'A', d: 'a1', t: 1 }, b1: { sub: 'B', d: 'b1', t: 2 }, a2: { sub: 'A', d: 'a2', t: 3 } };
ok(peerOf(members, { sub: 'A', d: 'a2' }).sub === 'B', 'knock من A يروح لـ B (مش جهاز A القديم)');
ok(peerOf(members, { sub: 'B', d: 'b1' }).d === 'a2', 'knock من B يروح لأحدث جهاز عند A');
ok(peerOf({ a1: { sub: 'A', d: 'a1' } }, { sub: 'A' }) === null, 'مفيش طرف تاني = null');
ok(semverGt('1.4.3', '1.4.2') && !semverGt('1.4.2', '1.4.3') && !semverGt('1.4.3', '1.4.3') && semverGt('1.10.0', '1.9.9'), 'semverGt');
const p = updatePayload(true, '1.4.3'); ok(p.kind === 'update' && p.body.includes('1.4.3') && p.tag.endsWith('1.4.3'), 'updatePayload');
process.exit(f ? 1 : 0);
