/* Firestore + Auth data layer, shared by the booking page and the admin dashboard.
 *
 * Collections
 *   bookings/{RS-12345}   one document per booking (readable by admins only)
 *   slotLocks/{date_time_service_n}  one per taken place in a slot; public, no personal data.
 *                         Creating it together with the booking is what stops double-booking.
 *   settings/public       { closedDates: ["2026-12-02", ...] }
 *   settings/site         prices, services, hours, contact, booking times, policy (edited in the admin)
 *   media/{id}            service photos uploaded from the admin, stored as small JPEG data URLs
 *   planRequests/{id}     membership / session-pack join requests from the Memberships page
 *   audio/{id}            background music uploaded from the admin: meta + parts/{n} base64 chunks (<1 MB each)
 *   customers/{uid}       customer account profile (name, phone); bookings are matched by phoneDigits
 *   phones/{digits}       one doc per registered phone number, so a number can only be claimed once
 *   admins/{uid}          exists = that signed-in user is an admin (create it in the console)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, query, where, orderBy, limit,
  writeBatch, onSnapshot, serverTimestamp, setDoc, arrayUnion, arrayRemove, addDoc, deleteDoc, updateDoc, runTransaction, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail, createUserWithEmailAndPassword, EmailAuthProvider,
  linkWithCredential, updateProfile
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
// Normalized phone for matching: digits only, international prefix dropped, UAE local numbers
// (05x xxx xxxx) get the 971 code, so "050 123 4567", "+971 50 123 4567" and "971501234567" all match.
function phoneDigits(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("05")) d = "971" + d.slice(1);
  else if (d.length === 9 && d.startsWith("5")) d = "971" + d;
  return d;
}

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
      date: b.date, time: b.time, name: b.name, phone: b.phone, phoneDigits: phoneDigits(b.phone), pay: b.pay,
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

/* customerUid: the registered customer this booking belongs to (matched by phone in the admin).
   Marking a booking Done uses one session from their pack; undoing gives it back. */
async function setStatus(booking, status, customerUid) {
  const batch = writeBatch(db);
  const upd = { status, updatedAt: serverTimestamp() };
  if (customerUid && status === "completed" && !booking.deducted) {
    upd.deducted = true; upd.deductedUid = customerUid;
    batch.update(doc(db, "customers", customerUid), { balance: increment(-1), balanceUpdatedAt: serverTimestamp() });
  } else if (booking.deducted && status !== "completed") {
    upd.deducted = false;
    batch.update(doc(db, "customers", booking.deductedUid || customerUid), { balance: increment(1), balanceUpdatedAt: serverTimestamp() });
  }
  batch.update(doc(db, "bookings", booking.ref), upd);
  // Cancelling frees the place so someone else can book it.
  if (status === "cancelled" && booking.lockId) batch.delete(doc(db, "slotLocks", booking.lockId));
  await batch.commit();
}

/* A customer cancels their own booking (rules allow it up to 24 h before; the place is freed). */
async function cancelBooking(booking, { by = "customer" } = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, "bookings", booking.ref), { status: "cancelled", updatedAt: serverTimestamp(), cancelledBy: by });
  if (booking.lockId) batch.delete(doc(db, "slotLocks", booking.lockId));
  await batch.commit();
}

/* Moves a booking to another date/time: the old place is freed and a new one taken.
   Used by the owner, and by customers for their own bookings (by = "customer"). */
async function rescheduleBooking(booking, date, time, { by = null } = {}) {
  const n = await freePlace(date, time, booking.service);
  if (!n) throw err("slot-full", "That time is full for this service.");
  const lid = lockId(date, time, booking.service, n);
  const batch = writeBatch(db);
  if (booking.lockId) batch.delete(doc(db, "slotLocks", booking.lockId));
  batch.set(doc(db, "slotLocks", lid), { date, time, service: booking.service, n, bookingId: booking.ref });
  const upd = { date, time, lockId: lid, updatedAt: serverTimestamp(), rescheduledFrom: `${booking.date} ${booking.time}` };
  if (by) upd.movedBy = by;
  batch.update(doc(db, "bookings", booking.ref), upd);
  await batch.commit();
}

function watchCustomers(cb, onError) {
  return onSnapshot(query(collection(db, "customers"), orderBy("createdAt", "desc"), limit(500)),
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))), onError);
}

/* Owner assigns a pack / membership to a customer: name, total sessions and remaining sessions. */
async function setCustomerPack(uid, { packName, packTotal, balance }) {
  await updateDoc(doc(db, "customers", uid), { packName, packTotal, balance, packAssignedAt: serverTimestamp(), balanceUpdatedAt: serverTimestamp() });
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

/* ---------- memberships & session packs ---------- */

async function createPlanRequest(r) {
  const user = await ensureSignedIn();
  const data = {
    ref: r.ref, type: r.type, planId: r.planId, label: r.label, sessions: r.sessions,
    price: r.price, currency: r.currency, name: r.name, phone: r.phone,
    status: "new", uid: user.uid, createdAt: serverTimestamp()
  };
  if (r.email) data.email = r.email;
  if (r.lang) data.lang = r.lang;
  await addDoc(collection(db, "planRequests"), data);
}

function watchPlanRequests(cb, onError) {
  return onSnapshot(query(collection(db, "planRequests"), orderBy("createdAt", "desc"), limit(200)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

async function setPlanRequestStatus(id, status) {
  await updateDoc(doc(db, "planRequests", id), { status, updatedAt: serverTimestamp() });
}

/* ---------- customer accounts ----------
   Simple sign-up with phone or email + password (no verification, by the client's choice).
   A phone-only account uses a synthetic email so Firebase Auth can store it. */

const PHONE_DOMAIN = "phone.reset-society.app";
function loginEmail(identifier) {
  const s = String(identifier || "").trim();
  return s.includes("@") ? s.toLowerCase() : `${phoneDigits(s)}@${PHONE_DOMAIN}`;
}

async function customerSignUp({ name, phone, email, password }) {
  const digits = phoneDigits(phone);
  if (digits.length < 8) throw err("bad-phone", "Phone number too short");
  const authEmail = (email && email.trim()) ? email.trim().toLowerCase() : `${digits}@${PHONE_DOMAIN}`;
  await auth.authStateReady();
  const cred = EmailAuthProvider.credential(authEmail, password);
  let user;
  try {
    // Upgrade the anonymous visitor, so bookings made from this browser stay linked.
    if (auth.currentUser && auth.currentUser.isAnonymous) user = (await linkWithCredential(auth.currentUser, cred)).user;
    else user = (await createUserWithEmailAndPassword(auth, authEmail, password)).user;
  } catch (e) {
    if (e.code === "auth/credential-already-in-use" || e.code === "auth/provider-already-linked") user = (await createUserWithEmailAndPassword(auth, authEmail, password)).user;
    else throw e;
  }
  try { await updateProfile(user, { displayName: name }); } catch (e) { /* cosmetic */ }
  // Claim the phone number and create the profile together; fails if the number is taken.
  try {
    await runTransaction(db, async (tx) => {
      const claim = await tx.get(doc(db, "phones", digits));
      if (claim.exists() && claim.data().uid !== user.uid) throw err("phone-taken", "Phone already registered");
      tx.set(doc(db, "phones", digits), { uid: user.uid });
      tx.set(doc(db, "customers", user.uid), {
        name, phone: "+" + digits, phoneDigits: digits, email: email ? email.trim().toLowerCase() : "",
        hasEmail: !!(email && email.trim()), createdAt: serverTimestamp()
      });
    });
  } catch (e) {
    try { await user.delete(); } catch (e2) { /* leave for the owner to clean up */ }
    throw e;
  }
  return user;
}

const customerSignIn = (identifier, password) => signInWithEmailAndPassword(auth, loginEmail(identifier), password);

async function getCustomer(uid) {
  const s = await getDoc(doc(db, "customers", uid));
  return s.exists() ? s.data() : null;
}

/* Bookings matched by phone (any device, walk-ins added by the owner) or by this account's uid. */
async function customerBookings(uid, digits) {
  // No orderBy here: a filter + sort on different fields would need a composite index in Firestore.
  const byPhone = digits ? await getDocs(query(collection(db, "bookings"), where("phoneDigits", "==", digits), limit(400))) : null;
  const byUid = await getDocs(query(collection(db, "bookings"), where("uid", "==", uid), limit(400)));
  const seen = new Map();
  [byPhone, byUid].forEach((snap) => snap && snap.forEach((d) => seen.set(d.id, d.data())));
  return [...seen.values()].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

/* ---------- background music files (stored in Firestore chunks; no Storage plan needed) ---------- */

const AUDIO_CHUNK = 480 * 1024; // bytes per part (~655 KB as base64, under the 1 MiB document limit)

async function uploadAudio(file, onProgress) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const id = doc(collection(db, "audio")).id;
  const total = Math.ceil(buf.length / AUDIO_CHUNK);
  for (let i = 0; i < total; i++) {
    const slice = buf.subarray(i * AUDIO_CHUNK, (i + 1) * AUDIO_CHUNK);
    let bin = "";
    for (let j = 0; j < slice.length; j += 0x8000) bin += String.fromCharCode.apply(null, slice.subarray(j, j + 0x8000));
    await setDoc(doc(db, "audio", id, "parts", String(i).padStart(4, "0")), { n: i, data: btoa(bin) });
    if (onProgress) onProgress((i + 1) / total);
  }
  await setDoc(doc(db, "audio", id), { name: file.name, type: file.type || "audio/mpeg", size: buf.length, chunks: total, createdAt: serverTimestamp() });
  return id;
}

async function getAudioUrl(id) {
  const key = "/rs-audio/" + id;
  let cache = null;
  if (window.caches) { try { cache = await caches.open("rs-audio"); const hit = await cache.match(key); if (hit) return URL.createObjectURL(await hit.blob()); } catch (e) { cache = null; } }
  const meta = await getDoc(doc(db, "audio", id));
  if (!meta.exists()) return null;
  const parts = await getDocs(query(collection(db, "audio", id, "parts"), orderBy("n")));
  const chunks = parts.docs.map((d) => {
    const b = atob(d.data().data); const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  });
  const type = meta.data().type || "audio/mpeg";
  const blob = new Blob(chunks, { type });
  if (cache) { try { await cache.put(key, new Response(blob, { headers: { "Content-Type": type } })); } catch (e) { /* cache full */ } }
  return URL.createObjectURL(blob);
}

async function deleteAudio(id) {
  const parts = await getDocs(collection(db, "audio", id, "parts"));
  const batch = writeBatch(db);
  parts.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "audio", id));
  await batch.commit();
  if (window.caches) { try { const c = await caches.open("rs-audio"); await c.delete("/rs-audio/" + id); } catch (e) { /* ignore */ } }
}

window.__rsDbResolve({
  mode: "firebase",
  slotKey,
  capacity,
  loadAvailability,
  createBooking,
  loadSite,
  getMedia,
  getAudioUrl,
  customerSignUp,
  customerSignIn,
  getCustomer,
  customerBookings,
  cancelBooking,
  phoneDigits,
  createPlanRequest,
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
  deleteMedia,
  watchPlanRequests,
  setPlanRequestStatus,
  watchCustomers,
  setCustomerPack,
  rescheduleBooking,
  uploadAudio,
  deleteAudio
});
