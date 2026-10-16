// أدوات صغيرة نقية (من غير cloudflare) عشان تتختبر لوحدها.

// الطرف التاني = حساب مختلف (مش جهاز مختلف). الأحدث دخولاً لو فيه أكتر من واحد.
export function peerOf(members, me) {
  const list = Object.values(members || {}).filter((x) => x && x.sub && x.sub !== (me && me.sub));
  list.sort((a, b) => (b.t || 0) - (a.t || 0));
  return list[0] || null;
}

export function semverGt(a, b) {
  const x = String(a).split('.').map(Number), y = String(b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

export const updatePayload = (ar, ver) => ({
  title: ar ? 'غرفة مقفولة' : 'Locked Room',
  body: ar ? 'فيه تحديث جديد (' + ver + '). اضغط لفتح التطبيق.' : 'A new update is available (' + ver + '). Tap to open the app.',
  lang: ar ? 'ar' : 'en', dir: ar ? 'rtl' : 'ltr', icon: '/icon-192.png', badge: '/badge-96.png',
  tag: 'locked-room-update-' + ver, url: '/', kind: 'update',
});
