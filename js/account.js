/* Customer account: sign up / log in (phone or email + password) and "Your Reset Journey" stats. */
(function () {
  const C = window.RS_CONFIG;
  const { esc, toast, waLink } = window.RS;
  const L = window.RS_I18N;
  const tr = L.t;
  const $ = (id) => document.getElementById(id);

  const COUNTRIES = [["971", "🇦🇪"], ["966", "🇸🇦"], ["968", "🇴🇲"], ["974", "🇶🇦"], ["965", "🇰🇼"], ["973", "🇧🇭"],
    ["20", "🇪🇬"], ["962", "🇯🇴"], ["961", "🇱🇧"], ["91", "🇮🇳"], ["92", "🇵🇰"], ["63", "🇵🇭"], ["44", "🇬🇧"], ["1", "🇺🇸"]];
  $("liCc").innerHTML = COUNTRIES.map(([code, flag]) => `<option value="${code}" ${code === "971" ? "selected" : ""}>${flag} +${code}</option>`).join("");
  $("suCc").innerHTML = COUNTRIES.map(([code, flag]) => `<option value="${code}" ${code === "971" ? "selected" : ""}>${flag} +${code}</option>`).join("");

  function today() {
    const p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: C.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}`;
  }
  const toUTC = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmtDate = (s) => new Intl.DateTimeFormat(L.locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(toUTC(s));
  const svcName = (b) => { const s = C.services.find((x) => x.id === b.service); return s ? L.field(s, "name") : (b.serviceName || b.service); };

  let DB = null;
  function view(name) { ["accStatus", "accAuth", "accJourney"].forEach((v) => { $(v).hidden = v !== name; }); }
  function setMode(mode) {
    $("loginForm").hidden = mode !== "login";
    $("signupForm").hidden = mode !== "signup";
    document.querySelectorAll("[data-auth-tab]").forEach((b) => { const on = b.dataset.authTab === mode; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
  }
  document.querySelectorAll("[data-auth-tab]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.authTab)));

  const authMessage = (e) => {
    const c = (e && e.code) || "";
    if (c === "auth/email-already-in-use") return tr("acc.errTaken");
    if (c === "phone-taken") return tr("acc.errPhoneTaken");
    if (c === "bad-phone") return tr("acc.errPhone");
    if (c === "auth/weak-password") return tr("acc.errWeak");
    if (c === "auth/invalid-email") return tr("acc.errEmail");
    if (/invalid|wrong|not-found|credential/.test(c)) return tr("acc.errLogin");
    if (c === "auth/too-many-requests") return tr("admin.errMany");
    return tr("acc.errGeneric");
  };

  /* ---------- sign up ---------- */
  $("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("suName").value.trim(), phone = $("suPhone").value.trim(), email = $("suEmail").value.trim(), pw = $("suPassword").value;
    const err = $("suError"); err.textContent = "";
    const digits = DB.phoneDigits("+" + $("suCc").value + phone.replace(/^0+/, ""));
    if (name.length < 2) { err.textContent = tr("f.nameErr"); return; }
    if (digits.length < 8 || digits.length > 15) { err.textContent = tr("acc.errPhone"); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = tr("acc.errEmail"); return; }
    if (pw.length < 6) { err.textContent = tr("acc.errWeak"); return; }
    const btn = $("suSubmit"); btn.disabled = true;
    try {
      await DB.customerSignUp({ name, phone: "+" + digits, email, password: pw });
      toast(tr("acc.welcome", { name }));
    } catch (ex) { console.error(ex); err.textContent = authMessage(ex); }
    finally { btn.disabled = false; }
  });

  /* ---------- log in ---------- */
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("liId").value.trim(), pw = $("liPassword").value;
    const err = $("liError"); err.textContent = "";
    if (!id || !pw) { err.textContent = tr("admin.errBoth"); return; }
    const ident = id.includes("@") ? id : "+" + DB.phoneDigits(id.startsWith("+") || id.startsWith("00") ? id : $("liCc").value + id.replace(/^0+/, ""));
    const btn = $("liSubmit"); btn.disabled = true;
    try { await DB.customerSignIn(ident, pw); $("liPassword").value = ""; }
    catch (ex) { err.textContent = authMessage(ex); }
    finally { btn.disabled = false; }
  });
  $("liId").addEventListener("input", () => { $("liCcWrap").hidden = $("liId").value.includes("@"); });
  $("liForgot").addEventListener("click", async () => {
    const id = $("liId").value.trim();
    if (id.includes("@")) {
      try { await DB.resetPassword(id); toast(tr("admin.resetSent")); } catch (ex) { $("liError").textContent = tr("admin.resetFailed"); }
    } else {
      $("liError").textContent = tr("acc.forgotPhone");
    }
  });
  $("accSignOut").addEventListener("click", () => DB.signOut());

  /* ---------- journey ---------- */
  function monthKey(d) { return d.slice(0, 7); }
  async function renderJourney(user) {
    view("accStatus"); $("accStatusText").textContent = tr("acc.loading");
    const c = await DB.getCustomer(user.uid).catch(() => null);
    const name = (c && c.name) || user.displayName || "";
    $("accName").textContent = name;
    $("accPhone").textContent = c ? c.phone : "";
    let rows = [];
    try { rows = await DB.customerBookings(user.uid, c && c.phoneDigits); }
    catch (e) { console.error(e); toast(tr("acc.errGeneric")); }
    const t = today();
    const visits = rows.filter((b) => b.status === "completed" || (b.status === "confirmed" && b.date < t));
    const upcoming = rows.filter((b) => b.status === "confirmed" && b.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const thisMonth = visits.filter((b) => monthKey(b.date) === monthKey(t)).length;
    const counts = {};
    visits.forEach((b) => { counts[b.service] = (counts[b.service] || 0) + 1; });
    const favId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const fav = favId ? svcName({ service: favId }) : "—";
    const first = visits.length ? visits.map((b) => b.date).sort()[0] : null;

    $("statVisits").textContent = visits.length;
    $("statMonth").textContent = thisMonth;
    $("statFav").textContent = fav;
    $("statSince").textContent = first ? new Intl.DateTimeFormat(L.locale, { timeZone: "UTC", month: "short", year: "numeric" }).format(toUTC(first)) : "—";

    const line = visits.length === 0 ? tr("acc.msgNew") : thisMonth >= 4 ? tr("acc.msgStrong", { sessions: L.sessions(thisMonth) }) : thisMonth > 0 ? tr("acc.msgGood", { sessions: L.sessions(thisMonth) }) : tr("acc.msgBack");
    $("accLine").textContent = line;

    $("accUpcoming").innerHTML = upcoming.length
      ? upcoming.slice(0, 5).map((b) => `<li><strong>${esc(svcName(b))}</strong><span>${esc(fmtDate(b.date))} · ${esc(L.time(b.time))}</span><span class="ref">${esc(b.ref)}</span></li>`).join("")
      : `<li class="muted">${tr("acc.noUpcoming")}</li>`;
    const recent = visits.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 8);
    $("accHistory").innerHTML = recent.length
      ? recent.map((b) => `<li><strong>${esc(svcName(b))}</strong><span>${esc(fmtDate(b.date))}</span></li>`).join("")
      : `<li class="muted">${tr("acc.noHistory")}</li>`;
    $("accWa").href = waLink(tr("acc.waMsg", { name }));
    view("accJourney");
  }

  /* ---------- start ---------- */
  (async () => {
    DB = await window.RS_DB;
    if (!DB) { $("accStatusText").textContent = tr("admin.notConfigured"); return; }
    const pre = new URLSearchParams(location.search).get("mode");
    setMode(pre === "signup" ? "signup" : "login");
    DB.onAuth(async (user) => {
      if (!user || user.isAnonymous) { view("accAuth"); return; }
      // Owners land in the admin instead.
      if (await DB.isAdmin(user)) { location.replace("admin.html"); return; }
      renderJourney(user);
    });
  })();
})();
