(() => {
  const $ = (id) => document.getElementById(id);
  let rooms = [], next = '', total = 0, timer = 0;
  const show = (id) => { for (const s of ['login', 'reset', 'panel', 'denied']) $(s).hidden = s !== id; };
  const wait = (j) => Math.ceil((j.wait || 900) / 60) + ' دقيقة';

  const call = async (body) => {
    const r = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) { show('denied'); throw new Error('404'); }
    if (r.status === 401 && j.e === 'auth') { show('login'); throw new Error('auth'); }
    j.status = r.status;
    return j;
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const note = (t) => { const m = $('msg'); m.textContent = t; m.hidden = !t; };
  const ago = (t) => { if (!t) return '—'; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + ' ث' : s < 3600 ? Math.floor(s / 60) + ' د' : Math.floor(s / 3600) + ' س'; };

  async function leave() { clearInterval(timer); try { await call({ op: 'exit' }); } catch {} location.href = '/'; }

  function card(r) {
    const c = el('div', 'room');
    const top = el('div', 'top');
    top.append(el('span', 'key', r.key.slice(0, 16) + '…'));
    const n = (r.sockets || []).length;
    const pills = el('span');
    pills.append(el('span', 'pill ' + (n >= 2 ? 'bad' : n ? 'ok' : ''), n + ' متصل'));
    pills.append(el('span', 'pill', (r.messages || 0) + ' رسالة'));
    if (r.deleted) pills.append(el('span', 'pill bad', 'ممسوحة'));
    if (r.error) pills.append(el('span', 'pill bad', 'خطأ'));
    top.append(pills); c.append(top);
    if (n) {
      const ul = el('ul', 'socks');
      for (const s of r.sockets) {
        const li = el('li');
        li.append(el('span', 'd', s.d + (s.lang ? ' · ' + s.lang : '') + ' · من ' + ago(s.at)));
        const b = el('button', 'warn', 'فصل'); b.onclick = () => act(b, { op: 'kick', key: r.key, d: s.d }, 'اتفصل الاتصال.');
        li.append(b); ul.append(li);
      }
      c.append(ul);
    }
    const acts = el('div', 'acts');
    const k = el('button', 'warn', 'فصل كل الاتصالات (حل "الغرفة فيها شخصين")');
    k.disabled = !n; k.onclick = () => act(k, { op: 'kick', key: r.key }, 'اتفصلت كل الاتصالات، التطبيق بيرجع يتصل لوحده.');
    const d = el('button', 'danger', 'مسح الغرفة نهائياً');
    d.onclick = () => { if (confirm('تمسح الغرفة دي نهائياً لكل الأطراف؟ مفيش رجوع.\n' + r.key.slice(0, 16) + '…')) act(d, { op: 'delete', key: r.key }, 'اتمسحت الغرفة.', true); };
    acts.append(k, d); c.append(acts);
    return c;
  }

  function draw() {
    const q = $('q').value.trim().toLowerCase();
    const list = $('list'); list.replaceChildren();
    const shown = rooms.filter((r) => !q || r.key.startsWith(q));
    for (const r of shown) list.append(card(r));
    const live = rooms.reduce((a, r) => a + (r.sockets || []).length, 0);
    $('sum').textContent = 'إجمالي الغرف: ' + total + ' · معروض: ' + shown.length + ' · اتصالات مفتوحة (في المعروض): ' + live;
    $('more').hidden = !next;
  }

  async function act(btn, body, done, remove) {
    btn.disabled = true;
    try {
      const j = await call(body);
      if (!j.ok) { note('حصل خطأ: ' + (j.e || j.status)); btn.disabled = false; return; }
      if (remove) { rooms = rooms.filter((r) => r.key !== body.key); total = Math.max(0, total - 1); }
      else if (j.room) rooms = rooms.map((r) => (r.key === body.key ? j.room : r));
      note(done + (j.kicked != null ? ' (' + j.kicked + ')' : '')); draw();
    } catch (e) { if (!/^(404|auth)$/.test(e.message)) note('حصل خطأ: ' + e.message); btn.disabled = false; }
  }

  async function load(more) {
    try {
      const j = await call({ op: 'rooms', cursor: more ? next : '' });
      if (!j.ok) return;
      $('ver').textContent = 'V : ' + j.version;
      rooms = more ? rooms.concat(j.rooms) : j.rooms; next = j.next || ''; total = j.total || 0;
      show('panel'); draw();
    } catch (e) { if (!/^(404|auth)$/.test(e.message)) note('حصل خطأ: ' + e.message); }
  }

  async function login() {
    const pw = $('pw').value; $('loginErr').textContent = '';
    if (!pw) return;
    $('go').disabled = true;
    try {
      const j = await call({ op: 'login', pw });
      if (j.ok) { $('pw').value = ''; await load(false); }
      else $('loginErr').textContent = j.status === 429 ? 'محاولات كتير غلط. استنى ' + wait(j) + '.' : 'الرقم السري غلط.';
    } catch {}
    $('go').disabled = false;
  }

  function openReset(from) {
    $('resetMsg').textContent = ''; for (const i of ['code', 'npw', 'npw2']) $(i).value = '';
    $('cancelReset').onclick = () => (from === 'panel' ? show('panel') : show('login'));
    show('reset');
  }
  async function sendCode() {
    $('send').disabled = true; $('resetMsg').textContent = '';
    try {
      const j = await call({ op: 'sendcode' });
      $('resetMsg').textContent = j.ok ? 'اتبعت الكود على إيميلك.' : j.e === 'wait' ? 'استنى ' + j.wait + ' ثانية وجرب تاني.' : j.e === 'mail_not_configured' ? 'الإيميل مش متظبط على السيرفر.' : 'تعذر إرسال الكود.';
    } catch {}
    $('send').disabled = false;
  }
  async function savePw() {
    const pw = $('npw').value, m = $('resetMsg'); m.textContent = '';
    if (pw.length < 8) { m.textContent = 'الرقم السري لازم 8 حروف على الأقل.'; return; }
    if (pw !== $('npw2').value) { m.textContent = 'الرقمين مش متطابقين.'; return; }
    $('save').disabled = true;
    try {
      const j = await call({ op: 'setpw', code: $('code').value, pw });
      if (j.ok) { for (const i of ['code', 'npw', 'npw2']) $(i).value = ''; await load(false); note('اتغيّر الرقم السري.'); }
      else m.textContent = j.e === 'weak' ? 'الرقم السري ضعيف.' : 'الكود غلط أو منتهي.';
    } catch {}
    $('save').disabled = false;
  }

  $('go').onclick = login;
  $('pw').onkeydown = (e) => { if (e.key === 'Enter') login(); };
  $('forgot').onclick = () => openReset('login');
  $('chpw').onclick = () => openReset('panel');
  $('send').onclick = sendCode;
  $('save').onclick = savePw;
  $('back1').onclick = $('back2').onclick = () => { location.href = '/'; };
  $('refresh').onclick = () => load(false);
  $('more').onclick = () => load(true);
  $('q').oninput = draw;
  $('out').onclick = leave;
  $('auto').onchange = () => { clearInterval(timer); if ($('auto').checked) timer = setInterval(() => { if (!document.hidden) load(false); }, 10000); };
  (async () => {
    try { const j = await call({ op: 'status' }); $('ver').textContent = 'V : ' + j.version; if (j.authed) await load(false); else { show('login'); if (!j.hasPw) openReset('login'); } } catch {}
  })();
})();
