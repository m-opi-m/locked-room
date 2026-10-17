// خانة "دخول بكود": لو اتكتب فيها إيميل بدل الكود، بنسأل السيرفر. لو هو إيميل الأدمن (وجلستك صح) بنفتح /admin، وغير كده نفس رسالة الكود الغلط (مفيش أي دليل).
async function lrAdminEnter(v) {
  const err = document.getElementById('joinErr');
  err.textContent = '';
  try {
    const r = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'enter', email: String(v).trim() }) });
    if (r.ok) { location.href = '/admin'; return; }
  } catch {}
  err.textContent = 'الكود مش صح. لازم 24 حرف ورقم.';
}
