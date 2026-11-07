/* Admin dashboard: sign in, see and manage bookings, block times and close days. */
(function () {
  const C = window.RS_CONFIG;
  const { esc, toast, waLink } = window.RS;
  const L = window.RS_I18N;
  const tr = L.t;
  const $ = (id) => document.getElementById(id);

  /* ---------- date helpers (studio time zone) ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  function today() {
    const p = {};
    new Intl.DateTimeFormat("en-CA", { timeZone: C.timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}`;
  }
  const toUTC = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (s, n) => { const t = toUTC(s); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const fmtDate = (s) => new Intl.DateTimeFormat(L.locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(toUTC(s));
  const fmtLong = (s) => new Intl.DateTimeFormat(L.locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(toUTC(s));
  const fmtTime = (hhmm) => L.time(hhmm);
  const svc = (id) => C.services.find((s) => s.id === id) || { name: id, capacity: 1 };
  const svcName = (id) => L.field(svc(id), "name");

  const STATUS = {
    confirmed: { label: tr("st.confirmed"), cls: "st-confirmed" },
    completed: { label: tr("st.completed"), cls: "st-done" },
    "no-show": { label: tr("st.no-show"), cls: "st-noshow" },
    cancelled: { label: tr("st.cancelled"), cls: "st-cancelled" }
  };
  function showUser(user) {
    $("userEmail").hidden = !user; $("signOutBtn").hidden = !user;
    $("userEmail").textContent = (user && user.email) || "";
  }

  let DB = null;
  let upcoming = [], past = [], filter = "today", search = "";
  let unsubUpcoming = null, unsubPast = null, unsubDay = null, unsubSettings = null;
  let firstSnapshot = true, knownRefs = new Set();
  let settings = {}, dayLocks = [], scheduleDay = today();

  function view(name) {
    ["statusView", "loginView", "dashView"].forEach((v) => { $(v).hidden = v !== name; });
  }
  function status(text) { $("statusText").innerHTML = text; view("statusView"); }

  /* ---------- auth ---------- */
  async function start() {
    DB = await window.RS_DB;
    if (!DB) {
      status(tr("admin.notConfigured"));
      return;
    }
    DB.onAuth(async (user) => {
      stopWatching();
      if (!user || user.isAnonymous) { showUser(null); view("loginView"); return; }
      status(tr("admin.checking"));
      if (!(await DB.isAdmin(user))) {
        showUser(user);
        status(`${tr("admin.notAdmin", { email: esc(user.email || tr("admin.thisAccount")) })}<br><small class="muted ltr">UID: ${esc(user.uid)}</small>`);
        return;
      }
      showUser(user);
      view("dashView");
      startWatching();
    });
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("email").value.trim(), pw = $("password").value;
    $("loginError").textContent = "";
    if (!email || !pw) { $("loginError").textContent = tr("admin.errBoth"); return; }
    $("loginBtn").disabled = true;
    try { await DB.signIn(email, pw); $("password").value = ""; }
    catch (err) {
      $("loginError").textContent = /invalid|wrong|not-found|credential/.test(err.code || "") ? tr("admin.errWrong") :
        err.code === "auth/too-many-requests" ? tr("admin.errMany") : tr("admin.errConn");
    } finally { $("loginBtn").disabled = false; }
  });
  $("forgotBtn").addEventListener("click", async () => {
    const email = $("email").value.trim();
    if (!email) { $("loginError").textContent = tr("admin.errEmailFirst"); return; }
    try { await DB.resetPassword(email); toast(tr("admin.resetSent")); }
    catch (e) { $("loginError").textContent = tr("admin.resetFailed"); }
  });
  $("signOutBtn").addEventListener("click", () => DB && DB.signOut());

  /* ---------- live data ---------- */
  function startWatching() {
    const t = today();
    $("todayLabel").textContent = fmtLong(t);
    firstSnapshot = true;
    unsubUpcoming = DB.watchBookings({ from: t }, (rows) => {
      if (!firstSnapshot) {
        rows.filter((b) => !knownRefs.has(b.ref)).forEach((b) => toast(tr("admin.newToast", { name: b.name, service: svcName(b.service), date: fmtDate(b.date), time: fmtTime(b.time) })));
      }
      knownRefs = new Set(rows.map((b) => b.ref));
      firstSnapshot = false;
      upcoming = rows;
      renderStats(); renderList();
    }, onWatchError);
    unsubSettings = DB.watchSettings((s) => { settings = s; renderSchedule(); });
    watchScheduleDay();
  }
  function stopWatching() {
    [unsubUpcoming, unsubPast, unsubDay, unsubSettings].forEach((u) => u && u());
    unsubUpcoming = unsubPast = unsubDay = unsubSettings = null;
    upcoming = []; past = [];
  }
  function onWatchError(e) { console.error(e); toast(tr("admin.lost")); }

  function watchPast() {
    if (unsubPast) return;
    unsubPast = DB.watchBookings({ to: addDays(today(), -1), max: 200 }, (rows) => { past = rows; renderList(); }, onWatchError);
  }

  /* ---------- bookings tab ---------- */
  function renderStats() {
    const t = today(), week = addDays(t, 6);
    const active = upcoming.filter((b) => b.status !== "cancelled");
    const todays = active.filter((b) => b.date === t);
    $("statToday").textContent = todays.length;
    $("statWeek").textContent = active.filter((b) => b.date <= week).length;
    $("statRevenue").textContent = L.money(todays.filter((b) => b.status !== "no-show").reduce((sum, b) => sum + (b.price || 0), 0));
    document.title = (todays.length ? `(${todays.length}) ` : "") + tr("admin.pageTitle") + " | Reset Society";
  }

  function rowsForFilter() {
    const t = today();
    let rows = filter === "past" ? past : upcoming.filter((b) => (filter === "today" ? b.date === t : true));
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((b) => [b.name, b.phone, b.ref, b.email].some((v) => String(v || "").toLowerCase().includes(q)));
    const dir = filter === "past" ? -1 : 1;
    return rows.slice().sort((a, b) => dir * ((a.date + a.time).localeCompare(b.date + b.time)));
  }

  function renderList() {
    const rows = rowsForFilter();
    const box = $("bookingList");
    if (!rows.length) {
      box.innerHTML = `<p class="empty">${tr(search ? "admin.emptySearch" : filter === "today" ? "admin.emptyToday" : filter === "past" ? "admin.emptyPast" : "admin.emptyUpcoming")}</p>`;
      return;
    }
    let html = "", lastDate = null;
    rows.forEach((b) => {
      if (b.date !== lastDate) { html += `<h2 class="day-title">${fmtLong(b.date)}</h2>`; lastDate = b.date; }
      const st = STATUS[b.status] || STATUS.confirmed;
      const phoneDigits = String(b.phone || "").replace(/\D/g, "");
      const msg = tr("admin.msgCustomer", { name: b.name, ref: b.ref, service: svcName(b.service), date: fmtDate(b.date), time: fmtTime(b.time) });
      html += `
        <article class="bk ${b.status === "cancelled" ? "is-cancelled" : ""}">
          <div class="bk-time">${fmtTime(b.time)}</div>
          <div class="bk-main">
            <div class="bk-top"><strong>${esc(b.name)}</strong><span class="badge ${st.cls}">${st.label}</span></div>
            <div class="bk-meta">${esc(svcName(b.service))} · ${esc(L.money(b.price ?? ""))} · ${b.pay === "online" ? tr("pay.paidOnline") : tr("pay.location")}${b.source ? " · " + tr("admin.byAdmin") : ""}</div>
            <div class="bk-meta">
              <a class="ltr" href="tel:${esc(phoneDigits ? "+" + phoneDigits : "")}">${esc(b.phone)}</a>
              ${b.email ? ` · <a class="ltr" href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ""} · <span class="ref">${esc(b.ref)}</span>
            </div>
          </div>
          <div class="bk-actions">
            ${phoneDigits ? `<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}">${tr("act.whatsapp")}</a>` : ""}
            ${b.status === "confirmed" ? `
              <button class="btn btn-outline btn-sm" data-act="completed" data-ref="${esc(b.ref)}">${tr("act.done")}</button>
              <button class="btn btn-outline btn-sm" data-act="no-show" data-ref="${esc(b.ref)}">${tr("act.noshow")}</button>
              <button class="btn btn-danger btn-sm" data-act="cancelled" data-ref="${esc(b.ref)}">${tr("act.cancel")}</button>`
              : b.status !== "cancelled" ? `<button class="btn btn-outline btn-sm" data-act="confirmed" data-ref="${esc(b.ref)}">${tr("act.undo")}</button>` : ""}
          </div>
        </article>`;
    });
    box.innerHTML = html;
  }

  $("bookingList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const b = upcoming.concat(past).find((x) => x.ref === btn.dataset.ref); if (!b) return;
    const act = btn.dataset.act;
    if (act === "cancelled" && !confirm(tr("admin.confirmCancel", { name: b.name, ref: b.ref }))) return;
    btn.disabled = true;
    try { await DB.setStatus(b, act); toast(tr(act === "cancelled" ? "admin.cancelled" : "admin.updated")); }
    catch (err) { console.error(err); toast(tr("admin.updateFailed")); btn.disabled = false; }
  });

  document.querySelectorAll("[data-filter]").forEach((c) => c.addEventListener("click", () => {
    filter = c.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("active", x === c));
    if (filter === "past") watchPast();
    renderList();
  }));
  $("search").addEventListener("input", (e) => { search = e.target.value; renderList(); });

  /* ---------- tabs ---------- */
  document.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach((x) => { x.classList.toggle("active", x === t); x.setAttribute("aria-selected", x === t); });
    $("tab-bookings").hidden = t.dataset.tab !== "bookings";
    $("tab-schedule").hidden = t.dataset.tab !== "schedule";
  }));

  /* ---------- schedule tab ---------- */
  function watchScheduleDay() {
    if (unsubDay) unsubDay();
    $("dayPicker").value = scheduleDay;
    dayLocks = [];
    renderSchedule();
    unsubDay = DB.watchDay(scheduleDay, (locks) => { dayLocks = locks; renderSchedule(); }, onWatchError);
  }

  function renderSchedule() {
    const closed = (settings.closedDates || []).includes(scheduleDay);
    $("dayClosed").checked = closed;
    const weekdayClosed = C.booking.closedWeekdays.includes(toUTC(scheduleDay).getUTCDay());
    const byRef = new Map(upcoming.concat(past).map((b) => [b.ref, b]));
    let html = `<div class="sch-row sch-head"><span>${tr("admin.schTime")}</span>${C.services.map((s) => `<span>${esc(L.field(s, "name"))}</span>`).join("")}<span></span></div>`;
    C.booking.slots.forEach((t) => {
      const locks = dayLocks.filter((l) => l.time === t);
      const blocked = locks.some((l) => l.bookingId === "blocked");
      html += `<div class="sch-row ${closed || weekdayClosed ? "is-closed" : ""}"><span class="sch-time">${fmtTime(t)}</span>`;
      C.services.forEach((s) => {
        const taken = locks.filter((l) => l.service === s.id);
        const names = taken.filter((l) => l.bookingId !== "blocked").map((l) => (byRef.get(l.bookingId) || {}).name || l.bookingId);
        const cell = names.length ? `<span class="cell booked">${names.map(esc).join(", ")}</span>`
          : taken.length ? `<span class="cell blocked">${tr("admin.blocked")}</span>`
          : `<span class="cell free">${tr("admin.free")}${s.capacity > 1 ? ` · ${s.capacity}` : ""}</span>`;
        html += `<span data-label="${esc(L.field(s, "name"))}">${cell}</span>`;
      });
      html += `<span class="sch-act"><button class="btn btn-outline btn-sm" data-slot="${t}" data-block="${blocked ? "0" : "1"}">${tr(blocked ? "admin.unblock" : "admin.block")}</button></span></div>`;
    });
    if (weekdayClosed) html = `<p class="muted small">${tr("admin.weekdayClosed")}</p>` + html;
    $("schedule").innerHTML = html;
  }

  $("schedule").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-slot]"); if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.block === "1") await DB.blockSlot(scheduleDay, b.dataset.slot, dayLocks);
      else await DB.unblockSlot(b.dataset.slot, dayLocks);
    } catch (err) { console.error(err); toast(tr("admin.slotFailed")); b.disabled = false; }
  });
  $("dayClosed").addEventListener("change", async (e) => {
    try { await DB.setDayClosed(scheduleDay, e.target.checked); toast(tr(e.target.checked ? "admin.dayClosedToast" : "admin.dayOpenedToast")); }
    catch (err) { console.error(err); toast(tr("admin.dayFailed")); e.target.checked = !e.target.checked; }
  });
  $("dayPicker").addEventListener("change", (e) => { if (e.target.value) { scheduleDay = e.target.value; watchScheduleDay(); } });
  $("dayPrev").addEventListener("click", () => { scheduleDay = addDays(scheduleDay, -1); watchScheduleDay(); });
  $("dayNext").addEventListener("click", () => { scheduleDay = addDays(scheduleDay, 1); watchScheduleDay(); });

  /* ---------- new booking (phone / walk-in) ---------- */
  const dlg = $("newDialog");
  $("nbService").innerHTML = C.services.map((s) => `<option value="${esc(s.id)}">${esc(L.field(s, "name"))} · ${L.money(s.price)}</option>`).join("");
  $("nbTime").innerHTML = C.booking.slots.map((t) => `<option value="${t}">${fmtTime(t)}</option>`).join("");
  $("newBookingBtn").addEventListener("click", () => {
    $("nbDate").value = today(); $("nbDate").min = today();
    $("newError").textContent = "";
    dlg.showModal();
  });
  $("newCancel").addEventListener("click", () => dlg.close());
  $("newForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const s = svc($("nbService").value);
    const b = {
      service: s.id, serviceName: s.name, price: s.price, currency: C.currency,
      date: $("nbDate").value, time: $("nbTime").value,
      name: $("nbName").value.trim(), phone: $("nbPhone").value.trim(), email: "", pay: "location", source: "admin"
    };
    if (!b.date || !b.name || b.phone.replace(/\D/g, "").length < 7) { $("newError").textContent = tr("nb.errFill"); return; }
    $("newSave").disabled = true;
    try {
      const ref = await DB.createBooking(b, { asAdmin: true });
      dlg.close(); $("newForm").reset();
      toast(tr("nb.saved", { ref }));
    } catch (err) {
      $("newError").textContent = tr(err.code === "slot-full" ? "nb.errFull" : "nb.errSave");
      console.error(err);
    } finally { $("newSave").disabled = false; }
  });

  start();
})();
