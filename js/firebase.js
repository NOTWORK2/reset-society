/* Firestore + Auth data layer, shared by the booking page and the admin dashboard.
 *
 * Collections
 *   bookings/{RS-12345}   one document per booking (readable by admins only)
 *   slotLocks/{date_time_service_n}  one per taken place in a slot; public, no personal data.
 *                         Creating it together with the booking is what stops double-booking.
 *   settings/public       { closedDates: ["2026-12-02", ...] }
 *   settings/site         prices, services, hours, contact, booking times, policy (edited in the admin)
 *   media/{id}            service photos uploaded from the admin, stored as small JPEG data URLs
 *   admins/{uid}          exists = that signed-in user is an admin (create it in the console)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  writeBatch, onSnapshot, serverTimestamp, setDoc, arrayUnion, arrayRemove, addDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const C = window.RS_CONFIG;
const cfg = window.RS_FIREBASE;
const app = initializeApp(cfg);
const db = getFirestore(app);
const auth = getAuth(app);

if (cfg.projectId.startsWith("demo-")) {
  connectFirestoreEmulator(db, location.hostname, 8085);
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
}

const capacity = (serviceId) => (C.services.find((s) => s.id === serviceId) || {}).capacity || 1;
const lockId = (date, time, service, n) => `${date}_${time}_${service}_${n}`;
const slotKey = (date, time, service) => `${date}_${time}_${service}`;

function err(code, message) { const e = new Error(message); e.code = code; return e; }

async function ensureSignedIn() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser;
}

/* ---------- public ---------- */

async function loadAvailability(from, to) {
  const [locks, settings] = await Promise.all([
    getDocs(query(collection(db, "slotLocks"), where("date", ">=", from), where("date", "<=", to))),
    getDoc(doc(db, "settings", "public"))
  ]);
  const counts = {};
  locks.forEach((d) => {
    const l = d.data();
    const k = slotKey(l.date, l.time, l.service);
    counts[k] = (counts[k] || 0) + 1;
  });
  const closed = new Set((settings.exists() && settings.data().closedDates) || []);
  return { counts, closed };
}

async function freePlace(date, time, service) {
  const snap = await getDocs(query(collection(db, "slotLocks"), where("date", "==", date)));
  const taken = new Set();
  snap.forEach((d) => { const l = d.data(); if (l.time === time && l.service === service) taken.add(l.n); });
  for (let n = 1; n <= capacity(service); n++) if (!taken.has(n)) return n;
  return 0;
}

const newRef = () => "RS-" + String(Math.floor(10000 + Math.random() * 90000));

/* Saves the booking and its slot lock in one batch. Security rules reject the batch when the
   place is already taken, so two people can never hold the same place. */
async function createBooking(b, { asAdmin = false } = {}) {
  const user = asAdmin ? auth.currentUser : await ensureSignedIn();
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = await freePlace(b.date, b.time, b.service);
    if (!n) throw err("slot-full", "This time was just booked by someone else.");
    const ref = newRef();
    const lid = lockId(b.date, b.time, b.service, n);
    const data = {
      ref, service: b.service, serviceName: b.serviceName, price: b.price, currency: b.currency,
      date: b.date, time: b.time, name: b.name, phone: b.phone, pay: b.pay,
      status: "confirmed", lockId: lid, uid: user.uid, createdAt: serverTimestamp()
    };
    if (b.email) data.email = b.email;
    if (asAdmin) data.source = b.source || "admin";
    const batch = writeBatch(db);
    batch.set(doc(db, "slotLocks", lid), { date: b.date, time: b.time, service: b.service, n, bookingId: ref });
    batch.set(doc(db, "bookings", ref), data);
    try {
      await batch.commit();
      return ref;
    } catch (e) {
      // Either the place was taken a moment ago or the reference already exists: try again.
      if (e.code !== "permission-denied") throw e;
    }
  }
  throw err("slot-full", "This time is no longer available.");
}

/* ---------- admin ---------- */

async function isAdmin(user) {
  if (!user || user.isAnonymous) return false;
  try { return (await getDoc(doc(db, "admins", user.uid))).exists(); } catch (e) { return false; }
}

function watchBookings({ from, to, max = 300 }, cb, onError) {
  const parts = [collection(db, "bookings")];
  if (from) parts.push(where("date", ">=", from));
  if (to) parts.push(where("date", "<=", to));
  parts.push(orderBy("date", to && !from ? "desc" : "asc"), limit(max));
  return onSnapshot(query(...parts), (snap) => cb(snap.docs.map((d) => d.data())), onError);
}

async function setStatus(booking, status) {
  const batch = writeBatch(db);
  batch.update(doc(db, "bookings", booking.ref), { status, updatedAt: serverTimestamp() });
  // Cancelling frees the place so someone else can book it.
  if (status === "cancelled" && booking.lockId) batch.delete(doc(db, "slotLocks", booking.lockId));
  await batch.commit();
}

function watchDay(date, cb, onError) {
  return onSnapshot(query(collection(db, "slotLocks"), where("date", "==", date)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

function watchSettings(cb) {
  return onSnapshot(doc(db, "settings", "public"), (s) => cb(s.exists() ? s.data() : {}));
}

async function setDayClosed(date, closed) {
  await setDoc(doc(db, "settings", "public"),
    { closedDates: closed ? arrayUnion(date) : arrayRemove(date) }, { merge: true });
}

/* Blocking a time fills every free place of every service with a "blocked" lock. */
async function blockSlot(date, time, existingLocks) {
  const batch = writeBatch(db);
  C.services.forEach((s) => {
    for (let n = 1; n <= capacity(s.id); n++) {
      const id = lockId(date, time, s.id, n);
      if (!existingLocks.some((l) => l.id === id)) batch.set(doc(db, "slotLocks", id), { date, time, service: s.id, n, bookingId: "blocked" });
    }
  });
  await batch.commit();
}

async function unblockSlot(time, existingLocks) {
  const batch = writeBatch(db);
  existingLocks.filter((l) => l.time === time && l.bookingId === "blocked").forEach((l) => batch.delete(doc(db, "slotLocks", l.id)));
  await batch.commit();
}

/* ---------- editable site settings ---------- */

function cleanSite(data) {
  if (!data) return null;
  const { updatedAt, capacity, ...rest } = data;
  return rest;
}

async function loadSite() {
  const snap = await getDoc(doc(db, "settings", "site"));
  return snap.exists() ? cleanSite(snap.data()) : null;
}

function watchSite(cb) {
  return onSnapshot(doc(db, "settings", "site"), (s) => cb(s.exists() ? cleanSite(s.data()) : null));
}

/* The capacity map is what the security rules read to know which services can be booked
   and how many guests fit in one time slot. Hidden services get 0, so they can't be booked. */
async function saveSite(site) {
  const capacityMap = {};
  site.services.forEach((s) => { capacityMap[s.id] = s.active === false ? 0 : Math.max(1, Math.round(Number(s.capacity) || 1)); });
  await setDoc(doc(db, "settings", "site"), { ...site, capacity: capacityMap, updatedAt: serverTimestamp() });
}

const mediaMemo = {};
async function getMedia(id) {
  if (mediaMemo[id]) return mediaMemo[id];
  const snap = await getDoc(doc(db, "media", id));
  return (mediaMemo[id] = snap.exists() ? snap.data().data : null);
}

async function uploadMedia(dataUrl) {
  const ref = await addDoc(collection(db, "media"), { data: dataUrl, createdAt: serverTimestamp() });
  mediaMemo[ref.id] = dataUrl;
  return ref.id;
}

async function deleteMedia(id) {
  await deleteDoc(doc(db, "media", id));
}

window.__rsDbResolve({
  mode: "firebase",
  slotKey,
  capacity,
  loadAvailability,
  createBooking,
  loadSite,
  getMedia,
  // admin
  auth,
  onAuth: (cb) => onAuthStateChanged(auth, cb),
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: () => signOut(auth),
  resetPassword: (email) => sendPasswordResetEmail(auth, email),
  isAdmin,
  watchBookings,
  setStatus,
  watchDay,
  watchSettings,
  setDayClosed,
  blockSlot,
  unblockSlot,
  watchSite,
  saveSite,
  uploadMedia,
  deleteMedia
});
