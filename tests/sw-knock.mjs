// يختبر sw.js مباشرة: لو الطرق وصل متأخر الإشعار لازم يكتب وقت الطرق الحقيقي، ولو وصل فوراً يفضل النص العادي.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
function run(payload) {
  const shown = [], handlers = {};
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {}, matchAll: async () => [] }, location: { origin: 'http://x' },
    registration: { showNotification: async (title, o) => { shown.push({ title, ...o }); }, getNotifications: async () => [], update() {} } };
  vm.runInNewContext(readFileSync('web/sw.js', 'utf8'), { self, URL, Date, console });
  let p; handlers.push({ data: { json: () => payload }, waitUntil: (x) => { p = x; } });
  return p.then(() => shown[0]);
}
const H = 3600e3;
let n = await run({ lang: 'ar', body: 'هناك من يطرق الباب', at: Date.now() - 2 * H });
ok('متأخر ساعتين (عربي): بيكتب الساعة', /هناك من طرق الباب/.test(n.body) && /الساعة/.test(n.body));
ok('timestamp الإشعار = وقت الطرق مش وقت الوصول', Math.abs(n.timestamp - (Date.now() - 2 * H)) < 5000);
n = await run({ lang: 'en', body: 'Someone is knocking at the door', at: Date.now() - 2 * H });
ok('متأخر (إنجليزي): Someone knocked ... at', /^Someone knocked at the door /.test(n.body) && / at /.test(n.body));
n = await run({ lang: 'ar', body: 'هناك من يطرق الباب', at: Date.now() - 3 * 24 * H });
ok('من 3 أيام: بيكتب التاريخ مع الساعة', /الساعة/.test(n.body) && n.body.length > 25);
n = await run({ lang: 'en', body: 'Someone is knocking at the door', at: Date.now() - 26 * H });
ok('من إمبارح/قبله: بيذكر اليوم', /yesterday|[A-Z][a-z]{2}/.test(n.body));
n = await run({ lang: 'ar', body: 'هناك من يطرق الباب', at: Date.now() - 2000 });
ok('وصل فوراً: النص العادي من غير وقت', n.body === 'هناك من يطرق الباب');
n = await run({ lang: 'ar', body: 'هناك من يطرق الباب' });
ok('من غير at (إصدار قديم): النص العادي', n.body === 'هناك من يطرق الباب');
n = await run({ lang: 'ar', body: 'فيه تحديث جديد', kind: 'update', at: Date.now() - 5 * H });
ok('إشعار التحديث مبيتغيرش', n.body === 'فيه تحديث جديد');
process.exit(fails ? 1 : 0);
