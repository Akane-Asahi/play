// Browser entry point: connects the app to Firebase (anonymous sign-in + Realtime Database).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, get, set, update, remove, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { startApp } from './app.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const clean = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const net = {
  // uid of the already signed-in user, or null
  async ready() { await auth.authStateReady(); return auth.currentUser ? auth.currentUser.uid : null; },
  async signIn() { await auth.authStateReady(); return (auth.currentUser || (await signInAnonymously(auth)).user).uid; },
  async get(path) { return (await get(ref(db, path))).val(); },
  set: (path, value) => set(ref(db, path), value),
  update: (path, values) => update(ref(db, path), values),
  remove: (path) => remove(ref(db, path)),
  on: (path, cb, onErr) => onValue(ref(db, path), (snap) => cb(snap.val()), onErr),
  // fn(current) returns the new value, or undefined to leave things as they are. Resolves to true if written.
  async tx(path, fn) {
    const res = await runTransaction(ref(db, path), (cur) => (cur === null ? null : clean(fn(cur))));
    return res.committed && res.snapshot.exists();
  },
};

// The 3D game mode loads the 3D board on demand, so rooms that never use it do not download three.js.
startApp({ net, doc: document, win: window, load3d: () => import('../Clue3D/js/embed.js') });
