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
  const svcName = (b) => { const s = C.services.find((x) => x.id === b.service); return RS.withChoices(s ? L.field(s, "name") : (b.serviceName || b.service), b.choices); };
  const addDays = (s, n) => { const t = toUTC(s); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const slotMinutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  function studioNow() {
    const p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: C.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
  }
  // Minutes from now until a session starts (studio time).
  const minutesUntil = (b) => { const n = studioNow(); return (toUTC(b.date) - toUTC(n.date)) / 60000 + slotMinutes(b.time) - n.minutes; };
  const canChange = (b) => b.status === "confirmed" && minutesUntil(b) >= (C.booking.changeHours || 24) * 60;

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

  /* ---------- sign up: name + phone (+ optional email), no password ---------- */
  function showPassword(msg) {
    setMode("login");
    $("liPwWrap").hidden = false; $("liForgot").hidden = false;
    $("liError").textContent = msg || "";
    $("liPassword").focus();
  }
  $("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("suName").value.trim(), phone = $("suPhone").value.trim(), email = $("suEmail").value.trim();
    const err = $("suError"); err.textContent = "";
    const digits = DB.phoneDigits("+" + $("suCc").value + phone.replace(/^0+/, ""));
    if (name.length < 2) { err.textContent = tr("f.nameErr"); return; }
    if (digits.length < 8 || digits.length > 15) { err.textContent = tr("acc.errPhone"); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = tr("acc.errEmail"); return; }
    const btn = $("suSubmit"); btn.disabled = true;
    try {
      const r = await DB.customerSignUp({ name, phone: "+" + digits, email });
      toast(tr(r.created ? "acc.welcome" : "acc.welcomeBack", { name }));
    } catch (ex) {
      console.error(ex);
      if (ex.code === "needs-password" || ex.code === "phone-taken") {
        $("liCc").value = $("suCc").value; $("liId").value = phone;
        showPassword(tr("acc.needsPassword"));
      } else err.textContent = authMessage(ex);
    }
    finally { btn.disabled = false; }
  });

  /* ---------- log in: the phone number is enough ---------- */
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("liId").value.trim(), pw = $("liPassword").value;
    const err = $("liError"); err.textContent = "";
    if (!id) { err.textContent = tr("acc.errPhone"); return; }
    const isEmail = id.includes("@");
    const ident = isEmail ? id : "+" + DB.phoneDigits(id.startsWith("+") || id.startsWith("00") ? id : $("liCc").value + id.replace(/^0+/, ""));
    if (!isEmail && ident.length < 9) { err.textContent = tr("acc.errPhone"); return; }
    const btn = $("liSubmit"); btn.disabled = true;
    try {
      if (isEmail || (!$("liPwWrap").hidden && pw)) {
        // Older account with a password.
        if (!pw) { showPassword(tr("acc.needsPassword")); return; }
        await DB.customerSignIn(ident, pw); $("liPassword").value = "";
        return;
      }
      try { await DB.phoneSignIn(ident); return; }
      catch (ex) {
        if (ex.code === "auth/too-many-requests") { err.textContent = tr("admin.errMany"); return; }
        // Not a passwordless account: either an older one with a password, or no account yet.
        let known = false;
        try { known = await DB.phoneRegistered(ident); } catch (e2) { console.error(e2); }
        if (known) { showPassword(tr("acc.needsPassword")); return; }
        setMode("signup");
        $("suCc").value = $("liCc").value; $("suPhone").value = id;
        $("suError").textContent = tr("acc.errNoAccount");
        $("suName").focus();
      }
    }
    catch (ex) { err.textContent = authMessage(ex); }
    finally { btn.disabled = false; }
  });
  $("liId").addEventListener("input", () => {
    const isEmail = $("liId").value.includes("@");
    if (isEmail) { $("liPwWrap").hidden = false; $("liForgot").hidden = false; }
  });
  $("liForgot").addEventListener("click", async () => {
    const id = $("liId").value.trim();
    if (id.includes("@")) {
      try { await DB.resetPassword(id); toast(tr("admin.resetSent")); } catch (ex) { $("liError").textContent = tr("admin.resetFailed"); }
    } else {
      $("liError").textContent = tr("acc.forgotPhone");
    }
  });
  $("accSignOut").addEventListener("click", () => DB.signOut());

  /* ---------- member dashboard ---------- */
  function monthKey(d) { return d.slice(0, 7); }
  const svcOf = (b) => C.services.find((x) => x.id === b.service);
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

    // Pack / membership card
    const hasPack = !!(c && c.packTotal > 0);
    $("mcNums").hidden = !hasPack; $("mcBar").hidden = !hasPack; $("mcNoPack").hidden = hasPack;
    $("mcMember").hidden = !hasPack; $("memberCard").classList.toggle("is-member", hasPack);
    if (hasPack) {
      const total = c.packTotal, left = Math.max(0, Math.min(total, c.balance ?? 0)), used = total - left;
      $("mcPack").textContent = c.packName || L.sessions(total);
      $("mcRemaining").textContent = String(left).padStart(2, "0");
      $("mcUsed").textContent = String(used).padStart(2, "0");
      $("mcTotal").textContent = String(total).padStart(2, "0");
      const pct = Math.round((left / total) * 100);
      $("mcBar").querySelector("span").style.width = pct + "%";
      $("mcBar").setAttribute("aria-valuenow", String(pct));
    } else {
      $("mcPack").textContent = tr("acc.noPack");
    }
    const since = c && c.createdAt && c.createdAt.toDate ? c.createdAt.toDate() : null;
    $("mcSince").textContent = since ? tr("acc.memberSince", { date: new Intl.DateTimeFormat(L.locale, { month: "short", year: "numeric", timeZone: C.timeZone }).format(since) }) : "";

    $("statVisits").textContent = String(visits.length).padStart(2, "0");
    $("statUpcoming").textContent = String(upcoming.length).padStart(2, "0");
    $("accLine").textContent = visits.length === 0 ? tr("acc.msgNew") : thisMonth >= 4 ? tr("acc.msgStrong", { sessions: L.sessions(thisMonth) }) : thisMonth > 0 ? tr("acc.msgGood", { sessions: L.sessions(thisMonth) }) : tr("acc.msgBack");

    const next = upcoming[0];
    if (next) {
      const s = svcOf(next);
      $("accNext").innerHTML = `
        <div class="next-card">
          <img ${RS.imgAttrs(s ? s.image : "assets/img/leaves-wall.jpg")} alt="" />
          <div class="next-main">
            <strong>${esc(svcName(next))}</strong>
            <span>${esc(fmtDate(next.date))} · ${esc(L.time(next.time))}</span>
            <small class="muted">${esc(s ? (L.field(s, "short") || "") : "")}</small>
          </div>
          <span class="badge st-confirmed">${tr("acc.booked")}</span>
        </div>`;
      RS.fillMedia($("accNext"));
    } else {
      $("accNext").innerHTML = `<p class="empty-note" style="padding:8px 4px">${tr("acc.noNext")}</p>`;
    }
    // Every scheduled session (the owner can plan a whole pack ahead).
    const unscheduled = hasPack ? Math.max(0, (c.balance ?? 0) - upcoming.length) : 0;
    $("accUpcomingWrap").hidden = !upcoming.length && !unscheduled;
    $("accUnsched").hidden = !unscheduled;
    $("accUnsched").textContent = unscheduled ? tr("acc.unscheduled", { n: L.sessions(unscheduled) }) : "";
    const used = hasPack ? Math.max(0, c.packTotal - (c.balance ?? 0)) : 0;
    lastRows = rows;
    $("accUpcoming").innerHTML = upcoming.map((b, i) => `<li>
        <strong>${esc(svcName(b))}</strong><span>${esc(fmtDate(b.date))} · ${esc(L.time(b.time))}</span>
        ${hasPack ? `<span class="acc-num">${tr("sess.num", { i: used + i + 1, total: c.packTotal })}</span>` : ""}
        <span class="badge st-confirmed">${tr("acc.booked")}</span>
        <span class="acc-actions">${canChange(b)
          ? `<button class="btn btn-outline btn-sm" type="button" data-move="${esc(b.ref)}">${tr("acc.move")}</button><button class="btn btn-outline btn-sm" type="button" data-cancel="${esc(b.ref)}">${tr("acc.cancel")}</button>`
          : `<a class="acc-late" target="_blank" rel="noopener" href="${waLink(tr("acc.lateMsg", { service: svcName(b), date: fmtDate(b.date), time: L.time(b.time) }))}">${tr("acc.changeLate")}</a>`}</span>
      </li>`).join("");
    const recent = visits.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 10);
    $("accHistory").innerHTML = recent.length
      ? recent.map((b) => `<li><strong>${esc(svcName(b))}</strong><span>${esc(fmtDate(b.date))} · ${esc(L.time(b.time))}</span>${b.status === "completed" ? `<span class="badge st-done">${tr("acc.done")}</span>` : ""}</li>`).join("")
      : `<li class="muted">${tr("acc.noHistory")}</li>`;
    $("accWa").href = waLink(tr("acc.waMsg", { name }));
    view("accJourney");
  }

  /* ---------- change or cancel one of my sessions ---------- */
  let lastRows = [], lastUser = null, mvBooking = null, mvAvail = { counts: {}, closed: new Set() };
  const bookingByRef = (ref) => lastRows.find((b) => b.ref === ref);
  function mvSlots(dateStr) {
    const b = mvBooking; if (!b) return [];
    const dow = toUTC(dateStr).getUTCDay();
    if (C.booking.closedWeekdays.includes(dow) || mvAvail.closed.has(dateStr)) return [];
    const s = C.services.find((x) => x.id === b.service);
    const cap = (s && s.capacity) || 1, now = studioNow();
    return C.booking.slots.filter((t) => {
      const future = dateStr > now.date || (dateStr === now.date && slotMinutes(t) >= now.minutes + C.booking.minLeadMinutes);
      const taken = mvAvail.counts[`${dateStr}_${t}_${b.service}`] || 0;
      const same = dateStr === b.date && t === b.time;
      return future && (taken < cap || same);
    });
  }
  function mvFillTimes() {
    const d = $("mvDate").value;
    const slots = d ? mvSlots(d) : [];
    $("mvTime").innerHTML = slots.length
      ? slots.map((t) => `<option value="${t}" ${mvBooking && d === mvBooking.date && t === mvBooking.time ? "selected" : ""}>${L.time(t)}</option>`).join("")
      : `<option value="">${tr("acc.noSlots")}</option>`;
    $("mvSave").disabled = !slots.length;
  }
  async function openMove(b) {
    mvBooking = b;
    $("mvWho").textContent = `${svcName(b)} · ${fmtDate(b.date)} · ${L.time(b.time)}`;
    $("mvError").textContent = "";
    const t = today();
    $("mvDate").min = t; $("mvDate").max = addDays(t, C.booking.daysAhead); $("mvDate").value = b.date;
    $("mvTime").innerHTML = `<option value="">…</option>`; $("mvSave").disabled = true;
    $("mvDialog").showModal();
    try { mvAvail = await DB.loadAvailability(t, addDays(t, C.booking.daysAhead)); }
    catch (e) { console.error(e); mvAvail = { counts: {}, closed: new Set() }; }
    mvFillTimes();
  }
  $("mvDate").addEventListener("change", mvFillTimes);
  $("mvCancel").addEventListener("click", () => $("mvDialog").close());
  $("mvForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = $("mvDate").value, time = $("mvTime").value;
    if (!date || !time) { $("mvError").textContent = tr("acc.noSlots"); return; }
    if (date === mvBooking.date && time === mvBooking.time) { $("mvDialog").close(); return; }
    $("mvSave").disabled = true;
    try {
      await DB.rescheduleBooking(mvBooking, date, time, { by: "customer" });
      $("mvDialog").close();
      toast(tr("acc.moved", { date: fmtDate(date), time: L.time(time) }));
      if (lastUser) renderJourney(lastUser);
    } catch (err) {
      console.error(err);
      $("mvError").textContent = tr(err.code === "slot-full" ? "acc.errFull" : "acc.errChange");
    } finally { $("mvSave").disabled = false; }
  });
  $("accUpcoming").addEventListener("click", async (e) => {
    const mv = e.target.closest("[data-move]");
    if (mv) { const b = bookingByRef(mv.dataset.move); if (b) openMove(b); return; }
    const cn = e.target.closest("[data-cancel]"); if (!cn) return;
    const b = bookingByRef(cn.dataset.cancel); if (!b) return;
    if (!confirm(tr("acc.confirmCancel", { service: svcName(b), date: fmtDate(b.date), time: L.time(b.time) }))) return;
    cn.disabled = true;
    try { await DB.cancelBooking(b); toast(tr("acc.cancelled")); if (lastUser) renderJourney(lastUser); }
    catch (err) { console.error(err); toast(tr("acc.errChange")); cn.disabled = false; }
  });

  /* ---------- start ---------- */
  (async () => {
    DB = await window.RS_DB;
    if (!DB) { $("accStatusText").textContent = tr("admin.notConfigured"); return; }
    const pre = new URLSearchParams(location.search).get("mode");
    setMode(pre === "signup" ? "signup" : "login");
    DB.onAuth(async (user) => {
      if (!user || user.isAnonymous) { view("accAuth"); return; }
      // The owner signs in on the admin page only (its session is separate). An owner session found
      // here is a leftover from before that: close it and show the customer login.
      if (await DB.isAdmin(user)) { await DB.signOut(); return; }
      lastUser = user;
      renderJourney(user);
    });
  })();
})();
