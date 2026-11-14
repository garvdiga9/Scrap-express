// The staff app's outbox: when there's no signal at a site, a step ("on the
// way", "arrived", the weighing with its photo, "paid") is kept on the phone
// and sent as soon as the connection comes back, in the order it was done.
// The server still checks each one; anything it refuses (say, the owner
// reassigned the pickup meanwhile) is dropped and the staff member is told.
// Kept in IndexedDB, which can hold the photo.
window.SEOutbox = (() => {
  const DB = 'se-staff';
  const STORE = 'outbox';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function tx(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = work(t.objectStore(STORE));
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }

  // item: { url, label, pickupId, json?: object, form?: { field: value | Blob } }
  const add = (item) => tx('readwrite', (store) => store.add({ ...item, savedAt: Date.now() }));
  const all = () => tx('readonly', (store) => store.getAll());
  const remove = (id) => tx('readwrite', (store) => store.delete(id));

  // A network failure (no signal), as opposed to the server saying no.
  const isOffline = (err) => !navigator.onLine || err instanceof TypeError;

  async function send(item) {
    let body;
    let headers;
    if (item.form) {
      body = new FormData();
      Object.entries(item.form).forEach(([key, value]) => {
        if (value instanceof Blob) body.append(key, value, key === 'file' ? 'weighing.jpg' : key);
        else if (value != null) body.append(key, value);
      });
    } else {
      body = JSON.stringify(item.json || {});
      headers = { 'Content-Type': 'application/json' };
    }
    return fetch(item.url, { method: 'POST', headers, body });
  }

  let flushing = false;
  // Send what's waiting, oldest first. Returns { sent, dropped: [messages] }.
  async function flush() {
    if (flushing || !navigator.onLine) return { sent: 0, dropped: [] };
    flushing = true;
    const result = { sent: 0, dropped: [] };
    try {
      const items = (await all()).sort((a, b) => a.id - b.id);
      for (const item of items) {
        let res;
        try {
          res = await send(item);
        } catch (err) {
          break; // still no signal: try again later, keeping the order
        }
        if (res.status === 401) break; // signed out: send after signing in
        if (res.ok) {
          result.sent += 1;
          await remove(item.id);
          continue;
        }
        if (res.status >= 500) break;
        const data = await res.json().catch(() => ({}));
        result.dropped.push(`${item.label} (#${item.pickupId}) was not saved: ${data.error || 'refused'}`);
        await remove(item.id);
      }
    } finally {
      flushing = false;
    }
    return result;
  }

  async function count() {
    try {
      return (await all()).length;
    } catch (err) {
      return 0;
    }
  }

  return {
    add, all, flush, count, isOffline,
  };
})();
