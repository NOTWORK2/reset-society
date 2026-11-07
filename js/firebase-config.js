/*
 * Firebase connection.
 * Paste the web app config from Firebase Console → Project settings → Your apps.
 * While projectId is empty, the site runs without Firebase: bookings are sent by WhatsApp only.
 * A projectId starting with "demo-" connects to the local Firebase emulator (for testing).
 */
window.RS_FIREBASE = {
  apiKey: "AIzaSyCmytsnKpgbd-ZULNfgSCU-e5njWIS5EVU",
  authDomain: "reset-society-9a7f4.firebaseapp.com",
  projectId: "reset-society-9a7f4",
  appId: "1:908758945265:web:b31a5a79c26c48e2340850"
};

/* Loads js/firebase.js in the background. Pages wait on window.RS_DB, which resolves to the
   data API, or to null when Firebase is not configured or could not load. */
(function () {
  let resolve;
  window.RS_DB = new Promise((r) => { resolve = r; });
  window.__rsDbResolve = resolve;
  const cfg = window.RS_FIREBASE;
  if (!cfg || !cfg.projectId) { resolve(null); return; }
  const s = document.createElement("script");
  s.type = "module";
  s.src = "js/firebase.js";
  s.onerror = () => resolve(null);
  document.head.appendChild(s);
  setTimeout(() => resolve(null), 12000); // never leave the page waiting forever
})();
