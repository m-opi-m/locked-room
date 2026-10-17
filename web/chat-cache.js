// تخزين الشات على الجهاز (IndexedDB) زي واتساب/تيليجرام: window.lrDb
// - meta: بيانات خفيفة لكل رسالة (seq, وقت, حالة الاستلام, اتفتحت ولا لأ)
// - body: النص المشفّر (iv + ct). المحتوى بيفضل مشفّر بمفتاح الغرفة، ومفيش حاجة plaintext على الجهاز.
(function () {
  const NAME = 'locked-room-chat', MAXN = Number.MAX_SAFE_INTEGER;
  let dbp = null;
  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    return dbp || (dbp = new Promise((res, rej) => {
      const rq = indexedDB.open(NAME, 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        const m = db.createObjectStore('meta', { keyPath: ['rid', 'mid'] });
        m.createIndex('byAt', ['rid', 'at']);
        m.createIndex('bySeq', ['rid', 'seq']);
        db.createObjectStore('body', { keyPath: ['rid', 'mid'] });
      };
      rq.onsuccess = () => { const db = rq.result; db.onversionchange = () => { db.close(); dbp = null; }; res(db); };
      rq.onerror = () => { dbp = null; rej(rq.error); };
    }));
  }
  const wrap = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  const rank = { sent: 0, delivered: 1, read: 2 };
  const roomRange = (rid) => IDBKeyRange.bound([rid, ''], [rid, '\uffff']);
  const META_KEYS = ['seq', 'at', 'fromSelf', 'once', 'opened', 'receipt', 'kind', 'played'];

  const api = {
    async put(rec) {
      const db = await open(), tx = db.transaction(['meta', 'body'], 'readwrite');
      const meta = { rid: rec.rid, mid: rec.mid };
      for (const k of META_KEYS) if (rec[k] !== undefined) meta[k] = rec[k];
      if (typeof meta.seq !== 'number') delete meta.seq; // null مش مفتاح صالح للـ index
      tx.objectStore('meta').put(meta);
      tx.objectStore('body').put({ rid: rec.rid, mid: rec.mid, iv: rec.iv || '', ct: rec.ct || '' });
      await done(tx);
    },
    async patch(rid, mid, f) {
      const db = await open(), tx = db.transaction(['meta', 'body'], 'readwrite');
      const ms = tx.objectStore('meta'), bs = tx.objectStore('body');
      const meta = await wrap(ms.get([rid, mid]));
      if (!meta) { await done(tx); return false; }
      for (const k of META_KEYS) if (f[k] !== undefined) meta[k] = f[k];
      ms.put(meta);
      if (f.ct !== undefined || f.iv !== undefined) {
        const b = (await wrap(bs.get([rid, mid]))) || { rid, mid, iv: '', ct: '' };
        if (f.ct !== undefined) b.ct = f.ct;
        if (f.iv !== undefined) b.iv = f.iv;
        bs.put(b);
      }
      await done(tx);
      return true;
    },
    // حالة الاستلام بتزيد بس (sent < delivered < read)
    async receipt(rid, mid, state) {
      const db = await open(), tx = db.transaction('meta', 'readwrite'), ms = tx.objectStore('meta');
      const meta = await wrap(ms.get([rid, mid]));
      if (meta && (rank[state] ?? -1) > (rank[meta.receipt] ?? -1)) { meta.receipt = state; ms.put(meta); }
      await done(tx);
    },
    async del(rid, mid) {
      const db = await open(), tx = db.transaction(['meta', 'body'], 'readwrite');
      tx.objectStore('meta').delete([rid, mid]); tx.objectStore('body').delete([rid, mid]);
      await done(tx);
    },
    async clear(rid) {
      const db = await open(), tx = db.transaction(['meta', 'body'], 'readwrite');
      tx.objectStore('meta').delete(roomRange(rid)); tx.objectStore('body').delete(roomRange(rid));
      await done(tx);
    },
    // أعلى رقم تسلسل عند الجهاز للغرفة دي (-1 لو مفيش)
    async maxSeq(rid) {
      const db = await open();
      const c = await wrap(db.transaction('meta').objectStore('meta').index('bySeq').openCursor(IDBKeyRange.bound([rid, 0], [rid, MAXN]), 'prev'));
      return c ? c.value.seq : -1;
    },
    // بيانات خفيفة لكل رسايل الغرفة (من غير المحتوى)
    async metas(rid) {
      const db = await open();
      return wrap(db.transaction('meta').objectStore('meta').getAll(roomRange(rid)));
    },
    // آخر `limit` رسالة أقدم من `beforeAt` (الأقدم الأول)، ومعاها المحتوى المشفّر
    async page(rid, beforeAt, limit) {
      const db = await open(), tx = db.transaction(['meta', 'body']);
      const upper = beforeAt === Infinity ? MAXN : beforeAt;
      const range = IDBKeyRange.bound([rid, 0], [rid, upper], false, beforeAt !== Infinity);
      const metas = [];
      await new Promise((res, rej) => {
        const rq = tx.objectStore('meta').index('byAt').openCursor(range, 'prev');
        rq.onsuccess = () => { const c = rq.result; if (c && metas.length < limit) { metas.push(c.value); c.continue(); } else res(); };
        rq.onerror = () => rej(rq.error);
      });
      const bs = tx.objectStore('body');
      const out = await Promise.all(metas.map(async (m) => { const b = (await wrap(bs.get([rid, m.mid]))) || {}; return { ...m, iv: b.iv || '', ct: b.ct || '' }; }));
      return out.reverse();
    },
    persist() { try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {} },
  };
  window.lrDb = api;
})();
