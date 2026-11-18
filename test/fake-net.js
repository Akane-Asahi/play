// In-memory stand-in for the Firebase adapter in clue/main.js, with the same access rules
// as database.rules.json so a client that reads something private fails the test.
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
function prune(v) {                      // like the Realtime Database: no nulls, no empty objects/arrays
  if (v == null) return null;
  if (typeof v !== 'object') return v;
  const out = Array.isArray(v) ? [] : {};
  let any = false;
  for (const k of Object.keys(v)) { const x = prune(v[k]); if (x != null) { out[k] = x; any = true; } }
  return any ? out : null;
}

export class FakeDb {
  constructor() { this.root = {}; this.subs = []; }
  read(path) { let n = this.root; for (const k of path.split('/')) { if (n == null) return null; n = n[k]; } return n == null ? null : clone(n); }
  write(path, value) {
    const ks = path.split('/'); let n = this.root;
    for (let i = 0; i < ks.length - 1; i++) { if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {}; n = n[ks[i]]; }
    const v = prune(clone(value));
    if (v == null) delete n[ks[ks.length - 1]]; else n[ks[ks.length - 1]] = v;
    this.root = prune(this.root) || {};
  }
  notify() {
    for (const s of this.subs.slice()) {
      const v = this.read(s.path), j = JSON.stringify(v);
      if (j !== s.last) { s.last = j; s.cb(v); }
    }
  }
  client(uid) {
    const db = this;
    const host = (code) => db.read('rooms/' + code + '/meta/host') === uid;
    const member = (code) => db.read('rooms/' + code + '/players/' + uid) != null;
    const DAY = 24 * 3600 * 1000, expired = (code) => { const t = db.read('roomIndex/' + code); return t != null && t < Date.now() - DAY; };
    const canRead = (path) => {
      const [r, code, area, who] = path.split('/');
      if (r === 'roomIndex') return true;
      if (r !== 'rooms' || !area) return false;
      if (area === 'hands') return who === uid || host(code);
      if (area === 'secret') return host(code);
      if (area === 'shown') return who === uid || (!!who && who.startsWith('bot-') && host(code));
      return true;
    };
    const canWrite = (path, value) => {
      const [r, code, area, who, n] = path.split('/');
      if (r === 'roomIndex') return code ? (value == null ? host(code) || expired(code) : db.read(path) == null && typeof value === 'number' && value <= Date.now() + 300000 && value >= Date.now() - 600000) : false;
      if (r === 'rooms' && code && !area) return value == null && (host(code) || expired(code));   // the host, or anyone once it is a day old
      if (r !== 'rooms' || !area) return false;
      if (area === 'meta') return who === 'host' ? (db.read(path) == null ? value === uid : host(code)) : (host(code) || pendingHost === uid);
      if (area === 'players') return who === uid || host(code) || pendingHost === uid;
      if (area === 'hands' || area === 'secret') return host(code);
      if (area === 'game') return member(code);
      if (area === 'shown') return n != null ? member(code) : host(code);
      return false;
    };
    let pendingHost = null;
    const need = (ok, what, path) => { if (!ok) throw new Error('permission denied: ' + what + ' ' + path + ' by ' + uid); };
    return {
      ready: async () => uid,
      signIn: async () => uid,
      get: async (path) => { need(canRead(path), 'read', path); return db.read(path); },
      set: async (path, value) => { need(canWrite(path, value), 'write', path); db.write(path, value); db.notify(); },
      remove: async (path) => { need(canWrite(path, null), 'write', path); db.write(path, null); db.notify(); },
      update: async (path, values) => {
        pendingHost = values['meta/host'] || null;       // creating a room: the new host may write the rest
        try { for (const k of Object.keys(values)) need(canWrite(path + '/' + k, values[k]), 'write', path + '/' + k); } finally { pendingHost = null; }
        for (const k of Object.keys(values)) db.write(path + '/' + k, values[k]);
        db.notify();
      },
      on: (path, cb) => {
        need(canRead(path), 'listen', path);
        const s = { path, cb, last: undefined };
        db.subs.push(s);
        Promise.resolve().then(() => { const v = db.read(path); s.last = JSON.stringify(v); cb(v); });
        return () => { db.subs = db.subs.filter((x) => x !== s); };
      },
      tx: async (path, fn) => {
        need(canWrite(path, {}), 'write', path);
        const cur = db.read(path);
        if (cur === null) return false;
        const next = fn(cur);
        if (next === undefined) return false;
        db.write(path, next); db.notify();
        return true;
      },
    };
  }
}
