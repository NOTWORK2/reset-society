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
  const svc = (id, fallbackName) => C.services.find((s) => s.id === id) || { name: fallbackName || id, capacity: 1 };
  const svcName = (id, fallbackName) => L.field(svc(id, fallbackName), "name");

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
  let unsubUpcoming = null, unsubPast = null, unsubDay = null, unsubSettings = null, unsubSite = null;
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
    siteSaved = !!(await window.RS_SITE);
    renderLists();
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
        rows.filter((b) => !knownRefs.has(b.ref)).forEach((b) => toast(tr("admin.newToast", { name: b.name, service: svcName(b.service, b.serviceName), date: fmtDate(b.date), time: fmtTime(b.time) })));
      }
      knownRefs = new Set(rows.map((b) => b.ref));
      firstSnapshot = false;
      upcoming = rows;
      renderStats(); renderList(); renderCustomers();
    }, onWatchError);
    unsubSettings = DB.watchSettings((s) => { settings = s; renderSchedule(); });
    unsubSite = DB.watchSite((site) => {
      if (site) window.RS_applySite(site);
      siteSaved = !!site;
      refreshAll();
    });
    watchScheduleDay();
    watchPlans();
    watchCustomersList();
  }
  function stopWatching() {
    if (unsubPlans) { unsubPlans(); unsubPlans = null; }
    if (unsubCustomers) { unsubCustomers(); unsubCustomers = null; }
    customers = [];
    planRequests = []; prFirst = true;
    [unsubUpcoming, unsubPast, unsubDay, unsubSettings, unsubSite].forEach((u) => u && u());
    unsubUpcoming = unsubPast = unsubDay = unsubSettings = unsubSite = null;
    upcoming = []; past = [];
  }
  function onWatchError(e) { console.error(e); toast(tr("admin.lost")); }

  function watchPast() {
    if (unsubPast) return;
    unsubPast = DB.watchBookings({ to: addDays(today(), -1), max: 200 }, (rows) => { past = rows; renderList(); renderCustomers(); }, onWatchError);
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
      const cust = customerFor(b);
      const member = cust && cust.packTotal ? `<span class="badge member-badge" title="${esc(cust.packName || "")}">${tr("cust.member")} · ${tr("cust.left", { n: cust.balance ?? 0, total: cust.packTotal })}</span>` : "";
      const phoneDigits = String(b.phone || "").replace(/\D/g, "");
      const msg = tr("admin.msgCustomer", { name: b.name, ref: b.ref, service: svcName(b.service, b.serviceName), date: fmtDate(b.date), time: fmtTime(b.time) });
      html += `
        <article class="bk ${b.status === "cancelled" ? "is-cancelled" : ""} ${member ? "is-member" : ""}">
          <div class="bk-time">${fmtTime(b.time)}</div>
          <div class="bk-main">
            <div class="bk-top"><strong>${esc(b.name)}</strong>${member}<span class="badge ${st.cls}">${st.label}</span></div>
            <div class="bk-meta">${esc(svcName(b.service, b.serviceName))} · ${b.pay === "pack" ? tr("pay.pack") : `${esc(L.money(b.price ?? ""))} · ${b.pay === "online" ? tr("pay.paidOnline") : tr("pay.location")}`}${b.source ? " · " + tr("admin.byAdmin") : ""}${b.cancelledBy === "customer" ? ` · <strong class="by-cust">${tr("admin.custCancelled")}</strong>` : ""}${b.movedBy === "customer" && b.status !== "cancelled" ? ` · <strong class="by-cust">${tr("admin.custMoved", { from: esc(b.rescheduledFrom || "") })}</strong>` : ""}</div>
            <div class="bk-meta">
              <a class="ltr" href="tel:${esc(phoneDigits ? "+" + phoneDigits : "")}">${esc(b.phone)}</a>
              ${b.email ? ` · <a class="ltr" href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ""} · <span class="ref">${esc(b.ref)}</span>
            </div>
          </div>
          <div class="bk-actions">
            ${phoneDigits ? `<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}">${tr("act.whatsapp")}</a>` : ""}
            ${b.status === "confirmed" ? `
              <button class="btn btn-outline btn-sm" data-reschedule="${esc(b.ref)}">${tr("admin.reschedule")}</button>
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
    try {
      const cust = customerFor(b);
      await DB.setStatus(b, act, cust ? cust.uid : null);
      toast(act === "cancelled" ? tr("admin.cancelled") : (act === "completed" && cust && cust.packTotal) ? tr("cust.deducted", { name: cust.name, n: Math.max(0, (cust.balance ?? 0) - 1) }) : tr("admin.updated"));
    }
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
    ["bookings", "plans", "customers", "schedule", "settings"].forEach((n) => { $("tab-" + n).hidden = t.dataset.tab !== n; });
    if (t.dataset.tab === "customers") { watchPast(); renderCustomers(); }
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
    const shown = C.services.filter((s) => s.active !== false);
    $("schedule").style.setProperty("--n", shown.length);
    let html = `<div class="sch-row sch-head"><span>${tr("admin.schTime")}</span>${shown.map((s) => `<span>${esc(L.field(s, "name"))}</span>`).join("")}<span></span></div>`;
    C.booking.slots.forEach((t) => {
      const locks = dayLocks.filter((l) => l.time === t);
      const blocked = locks.some((l) => l.bookingId === "blocked");
      html += `<div class="sch-row ${closed || weekdayClosed ? "is-closed" : ""}"><span class="sch-time">${fmtTime(t)}</span>`;
      shown.forEach((s) => {
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
  let nbCust = null;
  // A session of the pack's service for a member with sessions left is paid from the pack.
  const packService = () => (C.plans && C.plans.serviceId) || "full-recovery";
  const fromPack = (cust, serviceId) => !!(cust && cust.packTotal && (cust.balance ?? 0) > 0 && serviceId === packService());
  function openNewBooking(cust) {
    nbCust = cust || null;
    $("nbDate").value = today(); $("nbDate").min = today();
    $("newError").textContent = "";
    $("newForm").reset(); $("nbDate").value = today();
    if (cust) {
      $("nbName").value = cust.name || "";
      $("nbPhone").value = cust.phone || (cust.phoneDigits ? "+" + cust.phoneDigits : "");
      // Default to the service their pack is for.
      const svcId = cust.packTotal ? packService() : null;
      if (svcId && [...$("nbService").options].some((o) => o.value === svcId)) $("nbService").value = svcId;
    }
    dlg.showModal();
    setTimeout(() => $(cust ? "nbDate" : "nbName").focus(), 50);
  }
  $("newBookingBtn").addEventListener("click", () => openNewBooking(null));
  $("newCancel").addEventListener("click", () => dlg.close());
  $("newForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const s = svc($("nbService").value);
    const pack = fromPack(nbCust, s.id);
    const b = {
      service: s.id, serviceName: s.name, price: pack ? 0 : s.price, currency: C.currency,
      date: $("nbDate").value, time: $("nbTime").value,
      name: $("nbName").value.trim(), phone: $("nbPhone").value.trim(), email: "", pay: pack ? "pack" : "location", source: "admin"
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

  /* ---------- settings tab: services, prices, contact, hours, booking times, policy ---------- */
  let siteSaved = false;          // false = still using the defaults from js/config.js
  let draftSlots = [];
  let editing = null, pendingPhoto = null;

  function siteSnapshot() {
    // JSON copy drops undefined values, which Firestore refuses.
    return JSON.parse(JSON.stringify({
      services: C.services,
      hours: C.hours || [],
      whatsapp: C.whatsapp,
      phoneDisplay: C.phoneDisplay,
      instagram: C.instagram,
      mapsQuery: C.mapsQuery,
      booking: {
        slots: C.booking.slots,
        closedWeekdays: C.booking.closedWeekdays,
        daysAhead: C.booking.daysAhead,
        minLeadMinutes: C.booking.minLeadMinutes
      },
      policy: C.policy || null,
      plans: C.plans || { memberships: [], packs: [] },
      music: C.music || null
    }));
  }

  async function saveSite(mutate, btn) {
    const site = siteSnapshot();
    mutate(site);
    if (btn) btn.disabled = true;
    try {
      await DB.saveSite(site);
      window.RS_applySite(site);
      try { localStorage.setItem("rs-site", JSON.stringify(site)); } catch (e) { /* ignore */ }
      siteSaved = true;
      toast(tr("set.saved"));
      refreshAll();
      return true;
    } catch (err) {
      console.error(err);
      toast(tr("set.saveFailed"));
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function refreshAll() {
    renderLists(); renderSchedule(); renderSettings(); renderList(); renderStats();
  }

  function renderLists() {
    $("nbService").innerHTML = C.services.filter((s) => s.active !== false)
      .map((s) => `<option value="${esc(s.id)}">${esc(L.field(s, "name"))} · ${L.money(s.price)}</option>`).join("");
    $("nbTime").innerHTML = C.booking.slots.map((t) => `<option value="${t}">${fmtTime(t)}</option>`).join("");
  }

  function renderSettings() {
    $("siteNote").textContent = tr(siteSaved ? "set.note" : "set.defaultsNote");
    renderServiceAdmin();
    renderPlanEditor();
    renderMusic();

    $("stWhatsapp").value = C.whatsapp || "";
    $("stPhone").value = C.phoneDisplay || "";
    $("stInstagram").value = C.instagram || "";
    $("stMaps").value = C.mapsQuery || "";
    $("contactError").textContent = "";

    $("hoursRows").innerHTML = "";
    (C.hours || []).forEach(addHoursRow);

    draftSlots = C.booking.slots.slice();
    renderSlotChips();
    const dows = tr("cal.dows").split(",");
    $("weekdayChecks").innerHTML = dows.map((d, i) => `<label class="check"><input type="checkbox" value="${i}" ${C.booking.closedWeekdays.includes(i) ? "checked" : ""} /> <span>${esc(d)}</span></label>`).join("");
    $("stDaysAhead").value = C.booking.daysAhead;
    $("stLead").value = C.booking.minLeadMinutes;
    $("bookingSetError").textContent = "";

    const policy = (lang) => (C.policy && C.policy[lang] && C.policy[lang].length)
      ? C.policy[lang] : [1, 2, 3, 4, 5].map((n) => L.tIn(lang, "policy." + n));
    $("stPolicyEn").value = policy("en").join("\n");
    $("stPolicyAr").value = policy("ar").join("\n");
  }

  function renderServiceAdmin() {
    const box = $("serviceAdminList");
    box.innerHTML = C.services.map((s, i) => `
      <div class="svc-row ${s.active === false ? "is-hidden" : ""}">
        <img ${RS.imgAttrs(s.image)} alt="" />
        <div class="svc-info">
          <strong>${esc(L.field(s, "name"))}</strong>
          <span class="muted small">${L.money(s.price)} · ${esc(L.field(s, "duration") || "")} · ${tr("set.capShort", { n: s.capacity || 1 })}</span>
          ${s.active === false ? `<span class="badge st-cancelled">${tr("set.hidden")}</span>` : ""}
          ${s.featured ? `<span class="badge st-done">${tr("services.best")}</span>` : ""}
        </div>
        <div class="svc-actions">
          <button class="btn btn-outline btn-sm" type="button" data-svc-act="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="${tr("set.up")}">↑</button>
          <button class="btn btn-outline btn-sm" type="button" data-svc-act="down" data-i="${i}" ${i === C.services.length - 1 ? "disabled" : ""} aria-label="${tr("set.down")}">↓</button>
          <button class="btn btn-outline btn-sm" type="button" data-svc-act="edit" data-i="${i}">${tr("set.edit")}</button>
          <button class="btn btn-outline btn-sm" type="button" data-svc-act="toggle" data-i="${i}">${tr(s.active === false ? "set.show" : "set.hide")}</button>
          <button class="btn btn-danger btn-sm" type="button" data-svc-act="delete" data-i="${i}">${tr("set.delete")}</button>
        </div>
      </div>`).join("");
    RS.fillMedia(box);
  }

  const mediaId = (src) => (String(src || "").startsWith("media:") ? src.slice(6) : null);

  $("serviceAdminList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-svc-act]"); if (!b) return;
    const i = Number(b.dataset.i), act = b.dataset.svcAct, s = C.services[i];
    if (act === "edit") { openService(i); return; }
    if (act === "delete") {
      if (!confirm(tr("set.confirmDelete", { name: L.field(s, "name") }))) return;
      const ok = await saveSite((site) => { site.services.splice(i, 1); }, b);
      if (ok && mediaId(s.image)) DB.deleteMedia(mediaId(s.image)).catch(() => {});
      return;
    }
    await saveSite((site) => {
      const list = site.services;
      if (act === "toggle") list[i].active = list[i].active === false;
      if (act === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (act === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    }, b);
  });

  /* service dialog */
  function setPreview(src) {
    const img = $("svcPreview");
    const id = mediaId(src);
    if (id) {
      img.src = RS.mediaCache[id] || "";
      img.dataset.media = id;
      RS.fillMedia(img.parentElement);
    } else {
      img.removeAttribute("data-media");
      img.src = src || "";
    }
  }

  function openService(i) {
    editing = i; pendingPhoto = null;
    const s = i === null
      ? { active: true, capacity: 1, minutes: 30, price: 50, image: "assets/img/leaves-wall.jpg" }
      : C.services[i];
    $("svcTitle").textContent = tr(i === null ? "set.svcNew" : "set.svcEdit");
    $("svNameEn").value = s.name || "";
    $("svNameAr").value = s.name_ar || "";
    $("svPrice").value = s.price ?? "";
    $("svMinutes").value = s.minutes ?? "";
    $("svCapacity").value = s.capacity || 1;
    $("svDurEn").value = s.duration || "";
    $("svDurAr").value = s.duration_ar || "";
    $("svShortEn").value = s.short || "";
    $("svShortAr").value = s.short_ar || "";
    $("svLongEn").value = s.long || "";
    $("svLongAr").value = s.long_ar || "";
    $("svActive").checked = s.active !== false;
    $("svFeatured").checked = !!s.featured;
    $("svcError").textContent = "";
    $("svcPhoto").value = "";
    setPreview(s.image);
    $("svcDialog").showModal();
  }

  async function compressPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      let q = 0.82, out = c.toDataURL("image/jpeg", q);
      while (out.length > 700000 && q > 0.4) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
      return out;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  $("svcPhoto").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      pendingPhoto = await compressPhoto(file);
      $("svcPreview").removeAttribute("data-media");
      $("svcPreview").src = pendingPhoto;
      $("svcError").textContent = "";
    } catch (err) {
      pendingPhoto = null;
      $("svcError").textContent = tr("set.photoFailed");
    }
  });

  function makeServiceId(name) {
    let base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "service";
    let id = base;
    while (C.services.some((s) => s.id === id)) id = base + "-" + Math.random().toString(36).slice(2, 6);
    return id;
  }

  $("svcCancel").addEventListener("click", () => $("svcDialog").close());
  $("svcForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameEn = $("svNameEn").value.trim(), nameAr = $("svNameAr").value.trim();
    const price = Number($("svPrice").value);
    if (!nameEn || !nameAr || $("svPrice").value === "" || !(price >= 0)) { $("svcError").textContent = tr("set.errName"); return; }
    const old = editing === null ? null : C.services[editing];
    const btn = $("svcSave");
    btn.disabled = true;
    let image = old ? old.image : "assets/img/leaves-wall.jpg";
    try {
      if (pendingPhoto) {
        $("svcError").textContent = tr("set.uploading");
        image = "media:" + await DB.uploadMedia(pendingPhoto);
        $("svcError").textContent = "";
      }
    } catch (err) {
      console.error(err);
      $("svcError").textContent = tr("set.saveFailed");
      btn.disabled = false;
      return;
    }
    const minutes = Math.max(5, Math.round(Number($("svMinutes").value) || 30));
    const svcData = {
      ...(old || {}),
      id: old ? old.id : makeServiceId(nameEn),
      name: nameEn,
      name_ar: nameAr,
      price: Math.round(price * 100) / 100,
      minutes,
      capacity: Math.min(20, Math.max(1, Math.round(Number($("svCapacity").value) || 1))),
      duration: $("svDurEn").value.trim() || `${minutes} min`,
      duration_ar: $("svDurAr").value.trim() || `${minutes} دقيقة`,
      short: $("svShortEn").value.trim(),
      short_ar: $("svShortAr").value.trim(),
      long: $("svLongEn").value.trim(),
      long_ar: $("svLongAr").value.trim(),
      image,
      featured: $("svFeatured").checked,
      active: $("svActive").checked
    };
    const index = editing;
    const ok = await saveSite((site) => {
      if (index === null) site.services.push(svcData); else site.services[index] = svcData;
    });
    btn.disabled = false;
    if (ok) {
      $("svcDialog").close();
      if (old && pendingPhoto && mediaId(old.image)) DB.deleteMedia(mediaId(old.image)).catch(() => {});
    }
  });
  $("addServiceBtn").addEventListener("click", () => openService(null));

  /* contact */
  $("contactForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const wa = $("stWhatsapp").value.replace(/\D/g, "");
    const ig = $("stInstagram").value.trim();
    if (wa.length < 8 || wa.length > 15) { $("contactError").textContent = tr("set.errWhatsapp"); return; }
    if (ig && !/^https?:\/\//i.test(ig)) { $("contactError").textContent = tr("set.errInstagram"); return; }
    $("contactError").textContent = "";
    await saveSite((site) => {
      site.whatsapp = wa;
      site.phoneDisplay = $("stPhone").value.trim() || "+" + wa;
      site.instagram = ig;
      site.mapsQuery = $("stMaps").value.trim() || C.mapsQuery;
    }, e.submitter);
  });

  /* opening hours */
  function addHoursRow(h) {
    h = h || {};
    const row = document.createElement("div");
    row.className = "hours-edit";
    row.innerHTML = `
      <input class="input" data-k="days" placeholder="${tr("set.daysEn")}" aria-label="${tr("set.daysEn")}" dir="ltr" value="${esc(h.days || "")}" />
      <input class="input" data-k="days_ar" placeholder="${tr("set.daysAr")}" aria-label="${tr("set.daysAr")}" dir="rtl" value="${esc(h.days_ar || "")}" />
      <input class="input" data-k="time" placeholder="${tr("set.timeEn")}" aria-label="${tr("set.timeEn")}" dir="ltr" value="${esc(h.time || "")}" />
      <input class="input" data-k="time_ar" placeholder="${tr("set.timeAr")}" aria-label="${tr("set.timeAr")}" dir="rtl" value="${esc(h.time_ar || "")}" />
      <button class="btn btn-danger btn-sm" type="button" data-remove>${tr("set.removeRow")}</button>`;
    $("hoursRows").appendChild(row);
  }
  $("addHoursRow").addEventListener("click", () => addHoursRow());
  $("hoursRows").addEventListener("click", (e) => { const b = e.target.closest("[data-remove]"); if (b) b.closest(".hours-edit").remove(); });
  $("saveHours").addEventListener("click", async (e) => {
    const rows = [...$("hoursRows").querySelectorAll(".hours-edit")].map((r) => {
      const o = {};
      r.querySelectorAll("[data-k]").forEach((i) => { o[i.dataset.k] = i.value.trim(); });
      return o;
    }).filter((o) => o.days || o.days_ar || o.time || o.time_ar);
    await saveSite((site) => { site.hours = rows; }, e.currentTarget);
  });

  /* booking times */
  function renderSlotChips() {
    draftSlots = [...new Set(draftSlots)].sort();
    $("slotChips").innerHTML = draftSlots.length
      ? draftSlots.map((t) => `<span class="slot-chip">${fmtTime(t)}<button type="button" data-del-slot="${t}" aria-label="${tr("set.removeRow")} ${fmtTime(t)}">×</button></span>`).join("")
      : `<span class="muted small">${tr("set.errSlots")}</span>`;
  }
  $("slotChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del-slot]"); if (!b) return;
    draftSlots = draftSlots.filter((t) => t !== b.dataset.delSlot);
    renderSlotChips();
  });
  $("addSlotBtn").addEventListener("click", () => {
    const v = $("newSlot").value;
    if (!/^\d{2}:\d{2}$/.test(v)) return;
    draftSlots.push(v);
    $("newSlot").value = "";
    renderSlotChips();
  });
  $("saveBookingSet").addEventListener("click", async (e) => {
    const days = Math.round(Number($("stDaysAhead").value));
    const lead = Math.round(Number($("stLead").value));
    if (!draftSlots.length) { $("bookingSetError").textContent = tr("set.errSlots"); return; }
    if (!(days >= 1 && days <= 365) || !(lead >= 0 && lead <= 1440)) { $("bookingSetError").textContent = tr("set.errNumbers"); return; }
    $("bookingSetError").textContent = "";
    const closed = [...$("weekdayChecks").querySelectorAll("input:checked")].map((i) => Number(i.value));
    await saveSite((site) => {
      site.booking = { slots: draftSlots.slice(), closedWeekdays: closed, daysAhead: days, minLeadMinutes: lead };
    }, e.currentTarget);
  });

  /* policy */
  $("savePolicy").addEventListener("click", async (e) => {
    const lines = (id) => $(id).value.split("\n").map((l) => l.trim()).filter(Boolean);
    await saveSite((site) => { site.policy = { en: lines("stPolicyEn"), ar: lines("stPolicyAr") }; }, e.currentTarget);
  });


  /* ---------- background music ---------- */
  let muPending = null, muPreviewAudio = null;
  const ytId = (url) => { const m = String(url || "").match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/); return m ? m[1] : null; };
  function renderMusic() {
    const m = C.music || {};
    $("muSource").value = m.enabled && m.type ? m.type : "none";
    $("muStatus").textContent = tr(m.enabled && m.type ? "set.musicIsOn" : "set.musicIsOff");
    $("muUrl").value = m.type === "file" ? "" : (m.url || "");
    $("muVolume").value = m.volume ?? 40; $("muVolVal").textContent = m.volume ?? 40;
    $("muFileName").textContent = m.type === "file" && m.fileName ? m.fileName : "";
    $("muError").textContent = "";
    muPending = null; $("muFile").value = "";
    updateMusicFields();
  }
  function updateMusicFields() {
    const type = $("muSource").value;
    $("muUrlField").hidden = type === "file" || type === "none";
    $("muFileField").hidden = type !== "file";
    $("muVolume").closest(".field").hidden = type === "none";
    $("muUrlLabel").textContent = tr(type === "youtube" ? "set.musicYoutube" : "set.musicUrl");
    $("muUrl").placeholder = type === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://…/music.mp3";
    $("muPreview").hidden = type === "youtube" || type === "none";
  }
  $("muSource").addEventListener("change", updateMusicFields);
  $("muVolume").addEventListener("input", (e) => { $("muVolVal").textContent = e.target.value; if (muPreviewAudio) muPreviewAudio.volume = e.target.value / 100; });
  $("muFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    $("muError").textContent = "";
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { $("muError").textContent = tr("set.musicTooBig"); e.target.value = ""; return; }
    muPending = f; $("muFileName").textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
  });
  $("muPreview").addEventListener("click", async () => {
    if (muPreviewAudio) { muPreviewAudio.pause(); muPreviewAudio = null; $("muPreview").textContent = tr("set.musicPreview"); return; }
    let src = null;
    if ($("muSource").value === "url") src = $("muUrl").value.trim();
    else if (muPending) src = URL.createObjectURL(muPending);
    else if (C.music && C.music.type === "file" && C.music.fileId) src = await DB.getAudioUrl(C.music.fileId);
    if (!src) { $("muError").textContent = tr("set.musicErrFile"); return; }
    muPreviewAudio = new Audio(src); muPreviewAudio.volume = $("muVolume").value / 100;
    muPreviewAudio.addEventListener("ended", () => { muPreviewAudio = null; $("muPreview").textContent = tr("set.musicPreview"); });
    try { await muPreviewAudio.play(); $("muPreview").textContent = tr("set.musicStop"); }
    catch (err) { muPreviewAudio = null; $("muError").textContent = tr("set.musicErrFile"); }
  });
  $("muSave").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const type = $("muSource").value, url = $("muUrl").value.trim();
    const old = C.music || {};
    const music = { enabled: type !== "none", type: type === "none" ? (old.type || "youtube") : type, volume: Number($("muVolume").value) || 40 };
    $("muError").textContent = "";
    if (type === "none") {
      // Keep the last link/file so switching back on is one click.
      if (old.url) music.url = old.url;
      if (old.fileId) { music.fileId = old.fileId; music.fileName = old.fileName; }
    } else if (type === "youtube") {
      if (!ytId(url)) { $("muError").textContent = tr("set.musicErrYoutube"); return; }
      music.url = url;
    } else if (type === "url") {
      if (!/^https?:\/\//i.test(url)) { $("muError").textContent = tr("set.musicErrUrl"); return; }
      music.url = url;
    } else {
      if (!muPending && !(old.type === "file" && old.fileId)) { $("muError").textContent = tr("set.musicErrFile"); return; }
      music.fileId = old.fileId; music.fileName = old.fileName;
    }
    btn.disabled = true;
    try {
      if (type === "file" && muPending) {
        music.fileId = await DB.uploadAudio(muPending, (p) => { $("muError").textContent = tr("set.musicUploading", { p: Math.round(p * 100) }); });
        music.fileName = muPending.name;
        $("muError").textContent = "";
      }
      const ok = await saveSite((site) => { site.music = music; });
      if (ok && old.fileId && old.fileId !== music.fileId) DB.deleteAudio(old.fileId).catch(() => {});
      if (ok) muPending = null;
    } catch (err) {
      console.error(err);
      $("muError").textContent = tr("set.saveFailed");
    } finally { btn.disabled = false; }
  });


  /* ---------- customers (registered accounts) ---------- */
  let customers = [], unsubCustomers = null, custSearch = "";
  const digitsOf = (p) => DB.phoneDigits(p);
  function customerFor(b) {
    const d = digitsOf(b.phone);
    return customers.find((c) => c.uid === b.uid) || customers.find((c) => c.phoneDigits && c.phoneDigits === d) || null;
  }
  function watchCustomersList() {
    unsubCustomers = DB.watchCustomers((rows) => { customers = rows; renderCustomers(); renderList(); renderPlanRequests(); }, onWatchError);
  }
  function custStats(c) {
    const all = upcoming.concat(past);
    const mine = all.filter((b) => b.uid === c.uid || (c.phoneDigits && digitsOf(b.phone) === c.phoneDigits));
    const t = today();
    const visits = mine.filter((b) => b.status === "completed" || (b.status === "confirmed" && b.date < t)).length;
    const ups = mine.filter((b) => b.status === "confirmed" && b.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return { visits, up: ups.length, next: ups[0] || null };
  }
  function custBookings(c) {
    return upcoming.concat(past).filter((b) => b.uid === c.uid || (c.phoneDigits && digitsOf(b.phone) === c.phoneDigits));
  }
  function renderCustomers() {
    const box = $("customerList"); if (!box) return;
    const q = custSearch.trim().toLowerCase();
    const rows = customers.filter((c) => !q || [c.name, c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => (b.packTotal ? 1 : 0) - (a.packTotal ? 1 : 0));
    if (!rows.length) { box.innerHTML = `<p class="empty">${tr(customers.length ? "admin.emptySearch" : "cust.empty")}</p>`; return; }
    box.innerHTML = rows.map((c) => {
      const st = custStats(c);
      const digits = String(c.phoneDigits || "");
      const when = c.createdAt && c.createdAt.toDate ? new Intl.DateTimeFormat(L.locale, { dateStyle: "medium", timeZone: C.timeZone }).format(c.createdAt.toDate()) : "";
      const pack = c.packTotal
        ? `<span class="badge member-badge">${tr("cust.member")}</span><span class="badge ${c.balance > 0 ? "st-confirmed" : "st-noshow"}">${esc(c.packName || "")} · ${tr("cust.left", { n: c.balance ?? 0, total: c.packTotal })}</span>`
        : `<span class="badge st-done">${tr("cust.noPack")}</span>`;
      return `
        <article class="bk ${c.packTotal ? "is-member" : ""}">
          <div class="bk-time">${st.visits}<small class="muted" style="display:block;font-size:11px">${tr("acc.visits")}</small></div>
          <div class="bk-main">
            <div class="bk-top"><strong>${esc(c.name || "")}</strong>${pack}</div>
            <div class="bk-meta"><a class="ltr" href="tel:+${esc(digits)}">${esc(c.phone || "")}</a>${c.hasEmail && c.email ? ` · <a class="ltr" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""}</div>
            <div class="bk-meta">${tr("cust.upcoming", { n: st.up })}${when ? ` · ${tr("cust.registered", { date: when })}` : ""}</div>
            <div class="bk-meta cust-next">${st.next ? tr("cust.next", { when: `<strong>${esc(fmtDate(st.next.date))} · ${esc(fmtTime(st.next.time))}</strong> · ${esc(svcName(st.next.service, st.next.serviceName))}` }) : tr("cust.noNext")}</div>
          </div>
          <div class="bk-actions">
            ${digits ? `<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(digits)}">${tr("act.whatsapp")}</a>` : ""}
            <button class="btn btn-primary btn-sm" type="button" data-book-for="${esc(c.uid)}">${tr("cust.bookNext")}</button>
            ${c.packTotal && (c.balance ?? 0) > 0 ? `<button class="btn btn-outline btn-sm" type="button" data-sched-for="${esc(c.uid)}">${tr("cust.schedule")}</button>` : ""}
            <button class="btn btn-outline btn-sm" type="button" data-pack="${esc(c.uid)}">${tr(c.packTotal ? "cust.editPack" : "cust.assign")}</button>
            <button class="btn btn-outline btn-sm" type="button" data-sessions="${esc(c.uid)}">${tr("cust.sessions", { n: st.up })}</button>
          </div>
        </article>`;
    }).join("");
    if ($("sessDialog").open) renderSessions();
  }
  $("custSearch").addEventListener("input", (e) => { custSearch = e.target.value; renderCustomers(); });
  $("customerList").addEventListener("click", async (e) => {
    const bf = e.target.closest("[data-book-for]");
    if (bf) { const c = customers.find((x) => x.uid === bf.dataset.bookFor); if (c) openNewBooking(c); return; }
    const sf = e.target.closest("[data-sched-for]");
    if (sf) { const c = customers.find((x) => x.uid === sf.dataset.schedFor); if (c) openSchedule(c); return; }
    const sb = e.target.closest("[data-sessions]");
    if (sb) { const c = customers.find((x) => x.uid === sb.dataset.sessions); if (c) openSessions(c); return; }
  });

  /* ---------- every session of one customer: move, mark done, undo ---------- */
  let sessUid = null;
  function openSessions(c) { sessUid = c.uid; renderSessions(); $("sessDialog").showModal(); }
  function renderSessions() {
    const c = customers.find((x) => x.uid === sessUid); if (!c) return;
    const t = today();
    const asc = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
    const mine = custBookings(c).filter((b) => b.status !== "cancelled");
    const up = mine.filter((b) => b.status === "confirmed" && b.date >= t).sort(asc);
    const rest = mine.filter((b) => !(b.status === "confirmed" && b.date >= t));
    $("sessTitle").textContent = tr("sess.title", { name: c.name || "" });
    $("sessWho").textContent = c.packTotal
      ? `${c.packName || ""} · ${tr("cust.left", { n: c.balance ?? 0, total: c.packTotal })}`
      : tr("cust.noPack");
    const btn = (act, ref, label, cls = "btn-outline") => `<button class="btn ${cls} btn-sm" type="button" data-sact="${act}" data-ref="${esc(ref)}">${label}</button>`;
    const row = (when, label, sub, badge, actions) => `<li class="sess-row">
        <div class="sess-main">
          <span class="cd-when">${when}</span>
          <span class="cd-svc">${label ? `<span class="sess-n">${label}</span>${sub ? " · " : ""}` : ""}${sub}</span>
        </div>
        ${badge}
        <span class="cd-actions">${actions}</span>
      </li>`;
    const bRow = (b, label, actions) => {
      const st = STATUS[b.status] || STATUS.confirmed;
      return row(`${esc(fmtDate(b.date))} · ${esc(fmtTime(b.time))}`, label,
        `${esc(svcName(b.service, b.serviceName))} · <span class="ref">${esc(b.ref)}</span>`,
        `<span class="badge ${st.cls}">${st.label}</span>`, actions);
    };
    const upActions = (b) => `<button class="btn btn-outline btn-sm" type="button" data-reschedule="${esc(b.ref)}">${tr("admin.reschedule")}</button>${btn("completed", b.ref, tr("act.done"))}${btn("cancelled", b.ref, tr("act.cancel"), "btn-danger")}`;
    const pastActions = (b) => b.status === "confirmed"
      ? `${btn("completed", b.ref, tr("act.done"))}${btn("no-show", b.ref, tr("act.noshow"))}`
      : b.status === "completed" && c.packTotal && !b.deducted
        ? `${btn("deduct", b.ref, tr("sess.deduct"))}${btn("confirmed", b.ref, tr("act.undo"))}`
        : btn("confirmed", b.ref, tr("act.undo"));

    let html = "";
    if (c.packTotal) {
      // The whole pack, one line per session: used → scheduled → still to schedule.
      const total = c.packTotal, balance = Math.max(0, c.balance ?? 0), used = Math.max(0, total - balance);
      const done = rest.filter((b) => b.status === "completed" && b.deducted).sort(asc);
      const other = rest.filter((b) => !(b.status === "completed" && b.deducted));
      // Never list more lines than the pack holds, even if the balance was edited by hand.
      const unscheduled = Math.max(0, total - Math.max(done.length, used) - up.length);
      const lines = [];
      let n = 0;
      done.forEach((b) => { n++; lines.push(bRow(b, tr("sess.num", { i: n, total }), pastActions(b))); });
      for (let i = done.length; i < used; i++) { n++; lines.push(row(tr("sess.usedEarlier"), tr("sess.num", { i: n, total }), "", `<span class="badge st-done">${tr("st.completed")}</span>`, "")); }
      up.forEach((b) => { n++; lines.push(bRow(b, tr("sess.num", { i: n, total }), upActions(b))); });
      for (let i = 0; i < unscheduled; i++) { n++; lines.push(row(`<span class="muted">${tr("sess.unscheduled")}</span>`, tr("sess.num", { i: n, total }), "", `<span class="badge">${tr("sess.toSchedule")}</span>`, btn("book", "", tr("sess.setDate"), "btn-primary"))); }
      html += `<h4>${tr("sess.packList")} (${total})</h4><ul class="sess-list">${lines.join("")}</ul>`;
      if (unscheduled > 1) html += `<button class="btn btn-outline btn-block" type="button" data-sact="schedule" style="margin-top:10px">${tr("cust.schedule")} (${unscheduled})</button>`;
      if (other.length) html += `<h4>${tr("sess.other")} (${other.length})</h4><ul class="sess-list">${other.sort((a, b) => asc(b, a)).map((b) => bRow(b, "", pastActions(b))).join("")}</ul>`;
    } else {
      html += `<h4>${tr("cust.upcomingList")} (${up.length})</h4>
        <ul class="sess-list">${up.map((b, i) => bRow(b, String(i + 1), upActions(b))).join("") || `<li class="muted">${tr("acc.noUpcoming")}</li>`}</ul>
        <h4>${tr("cust.history")} (${rest.length})</h4>
        <ul class="sess-list">${rest.sort((a, b) => asc(b, a)).map((b) => bRow(b, "", pastActions(b))).join("") || `<li class="muted">${tr("acc.noHistory")}</li>`}</ul>`;
    }
    $("sessBody").innerHTML = html;
  }
  $("sessClose").addEventListener("click", () => $("sessDialog").close());
  $("sessAdd").addEventListener("click", () => { const c = customers.find((x) => x.uid === sessUid); if (c) openNewBooking(c); });
  $("sessBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-sact]"); if (!btn) return;
    const c = customers.find((x) => x.uid === sessUid);
    let act = btn.dataset.sact;
    if (act === "book") { if (c) openNewBooking(c); return; }
    if (act === "schedule") { if (c) openSchedule(c); return; }
    const b = upcoming.concat(past).find((x) => x.ref === btn.dataset.ref); if (!b) return;
    if (act === "deduct") act = "completed"; // completed before the pack existed: take the session from the pack now
    if (act === "cancelled" && !confirm(tr("admin.confirmCancel", { name: b.name, ref: b.ref }))) return;
    btn.disabled = true;
    try {
      await DB.setStatus(b, act, c ? c.uid : null);
      toast(act === "cancelled" ? tr("admin.cancelled")
        : (act === "completed" && c && c.packTotal && !b.deducted) ? tr("cust.deducted", { name: c.name, n: Math.max(0, (c.balance ?? 0) - 1) })
        : tr("admin.updated"));
    } catch (err) { console.error(err); toast(tr("admin.updateFailed")); btn.disabled = false; }
  });

  /* assign / edit a pack */
  let packUid = null;
  function planOptions() {
    const ms = ((C.plans && C.plans.memberships) || []).filter((p) => p.active !== false && p.sessions > 0);
    return [`<option value="">${tr("cust.custom")}</option>`]
      .concat(ms.map((p) => `<option value="${p.sessions}" data-name="${esc(L.field(C.services.find((s) => s.id === (C.plans.serviceId || "full-recovery")) || {}, "name") || "")} – ${esc(L.sessions(p.sessions))} ${esc(L.period(p.days))}">${esc(L.sessions(p.sessions))} ${esc(L.period(p.days))} · ${L.money(p.price)}</option>`))
      .join("");
  }
  $("customerList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pack]"); if (!b) return;
    const c = customers.find((x) => x.uid === b.dataset.pack); if (!c) return;
    packUid = c.uid;
    $("packWho").textContent = `${c.name || ""} · ${c.phone || ""}`;
    $("pkPlan").innerHTML = planOptions();
    $("pkTotal").value = c.packTotal || "";
    $("pkBalance").value = c.packTotal ? (c.balance ?? 0) : "";
    $("pkName").value = c.packName || "";
    $("packError").textContent = "";
    $("packDialog").showModal();
  });
  $("pkPlan").addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.value) return;
    $("pkTotal").value = opt.value; $("pkBalance").value = opt.value; $("pkName").value = opt.dataset.name || "";
  });
  $("packCancel").addEventListener("click", () => $("packDialog").close());
  $("packForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const total = Math.round(Number($("pkTotal").value)), balance = Math.round(Number($("pkBalance").value));
    const name = $("pkName").value.trim();
    if (!(total >= 1) || !(balance >= 0) || balance > total || !name) { $("packError").textContent = tr("cust.errPack"); return; }
    $("packSave").disabled = true;
    try { await DB.setCustomerPack(packUid, { packName: name, packTotal: total, balance }); $("packDialog").close(); toast(tr("admin.updated")); }
    catch (err) { console.error(err); $("packError").textContent = tr("admin.updateFailed"); }
    finally { $("packSave").disabled = false; }
  });


  /* ---------- schedule all the sessions of a pack ---------- */
  let schedCust = null, schedAvail = { counts: {}, closed: new Set() };
  const dayClosed = (d) => C.booking.closedWeekdays.includes(toUTC(d).getUTCDay()) || (settings.closedDates || []).includes(d) || schedAvail.closed.has(d);
  const slotFree = (d, t, s) => ((schedAvail.counts[`${d}_${t}_${s}`] || 0) < (svc(s).capacity || 1));
  function openSchedule(c) {
    schedCust = c;
    const st = custStats(c);
    const left = Math.max(1, (c.balance ?? 0) - st.up);
    $("schedWho").textContent = `${c.name || ""} · ${c.packName || ""} · ${tr("cust.left", { n: c.balance ?? 0, total: c.packTotal })}${st.up ? ` · ${tr("cust.upcoming", { n: st.up })}` : ""}`;
    $("scCount").value = left; $("scCount").max = Math.max(1, c.balance ?? 1);
    $("scStart").value = addDays(today(), 1); $("scStart").min = today();
    $("scTime").innerHTML = C.booking.slots.map((t) => `<option value="${t}">${fmtTime(t)}</option>`).join("");
    $("scService").innerHTML = $("nbService").innerHTML;
    if ([...$("scService").options].some((o) => o.value === packService())) $("scService").value = packService();
    // Spread the sessions over the plan's validity: 8 sessions in 30 days → every 3 days.
    const plan = ((C.plans && C.plans.memberships) || []).find((p) => p.sessions === c.packTotal);
    const gap = Math.max(1, Math.floor(((plan && plan.days) || 30) / left));
    const opts = [...$("scEvery").options].map((o) => Number(o.value));
    $("scEvery").value = String(opts.reduce((best, v) => (Math.abs(v - gap) < Math.abs(best - gap) ? v : best), opts[0]));
    $("schedRows").innerHTML = ""; $("schedError").textContent = "";
    $("schedDialog").showModal();
  }
  function schedNote(li) {
    const d = li.querySelector("[data-sc-date]").value, t = li.querySelector("[data-sc-time]").value, s = $("scService").value;
    const note = li.querySelector("[data-sc-note]");
    if (!d || d < today()) { note.textContent = tr("sch.errDate"); note.className = "sched-note is-error"; return false; }
    if (dayClosed(d)) { note.textContent = tr("sch.closed"); note.className = "sched-note is-error"; return false; }
    if (!slotFree(d, t, s)) { note.textContent = tr("sch.full"); note.className = "sched-note is-error"; return false; }
    if (!note.classList.contains("is-moved")) { note.textContent = ""; note.className = "sched-note"; }
    return true;
  }
  async function generateSchedule() {
    const n = Math.max(1, Math.min(100, Math.round(Number($("scCount").value) || 0)));
    let d = $("scStart").value || today(); if (d < today()) d = today();
    const t = $("scTime").value, s = $("scService").value, every = Number($("scEvery").value) || 7;
    $("scGen").disabled = true; $("schedError").textContent = "";
    try { schedAvail = await DB.loadAvailability(today(), addDays(d, n * every + 60)); }
    catch (e) { console.error(e); schedAvail = { counts: {}, closed: new Set() }; }
    $("scGen").disabled = false;
    const rows = [];
    for (let i = 0; i < n; i++) {
      let day = d, moved = false;
      for (let k = 0; k < 30 && (dayClosed(day) || !slotFree(day, t, s)); k++) { day = addDays(day, 1); moved = true; }
      rows.push({ date: day, time: t, moved });
      d = addDays(day, every);
    }
    $("schedRows").innerHTML = rows.map((r, i) => `
      <li class="sched-row">
        <span class="sched-n">${i + 1}</span>
        <input class="input" type="date" value="${r.date}" min="${today()}" data-sc-date aria-label="${tr("nb.date")}" />
        <select class="input" style="appearance:auto" data-sc-time aria-label="${tr("nb.time")}">${C.booking.slots.map((x) => `<option value="${x}" ${x === r.time ? "selected" : ""}>${fmtTime(x)}</option>`).join("")}</select>
        <span class="sched-note ${r.moved ? "is-moved" : ""}" data-sc-note>${r.moved ? tr("sch.moved") : ""}</span>
        <button class="btn btn-outline btn-sm sched-del" type="button" data-sc-del aria-label="${tr("sch.remove")}">×</button>
      </li>`).join("");
  }
  $("scGen").addEventListener("click", generateSchedule);
  $("schedCancel").addEventListener("click", () => $("schedDialog").close());
  $("schedRows").addEventListener("click", (e) => {
    const del = e.target.closest("[data-sc-del]"); if (!del) return;
    del.closest("li").remove();
    [...$("schedRows").querySelectorAll(".sched-n")].forEach((el, i) => { el.textContent = i + 1; });
  });
  $("schedRows").addEventListener("change", (e) => {
    const li = e.target.closest("li"); if (!li) return;
    li.querySelector("[data-sc-note]").classList.remove("is-moved");
    schedNote(li);
  });
  $("schedForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const lis = [...$("schedRows").querySelectorAll(".sched-row")];
    if (!lis.length) { $("schedError").textContent = tr("sch.errNone"); return; }
    const s = svc($("scService").value), c = schedCust;
    const pack = fromPack(c, s.id);
    const phone = c.phone || (c.phoneDigits ? "+" + c.phoneDigits : "");
    $("schedSave").disabled = true; $("scGen").disabled = true; $("schedError").textContent = "";
    let ok = 0, failed = 0;
    for (const li of lis) {
      const date = li.querySelector("[data-sc-date]").value, time = li.querySelector("[data-sc-time]").value;
      const note = li.querySelector("[data-sc-note]");
      if (!date || date < today()) { note.textContent = tr("sch.errDate"); note.className = "sched-note is-error"; failed++; continue; }
      try {
        await DB.createBooking({
          service: s.id, serviceName: s.name, price: pack ? 0 : s.price, currency: C.currency, date, time,
          name: c.name || "", phone, email: "", pay: pack ? "pack" : "location", source: "admin"
        }, { asAdmin: true });
        li.remove(); ok++;
      } catch (err) {
        console.error(err); failed++;
        note.textContent = tr(err.code === "slot-full" ? "sch.full" : "nb.errSave"); note.className = "sched-note is-error";
      }
    }
    [...$("schedRows").querySelectorAll(".sched-n")].forEach((el, i) => { el.textContent = i + 1; });
    $("schedSave").disabled = false; $("scGen").disabled = false;
    if (ok) toast(tr("sch.saved", { n: L.sessions(ok) }));
    if (!failed) $("schedDialog").close();
    else $("schedError").textContent = tr("sch.errSome", { n: failed });
  });

  /* ---------- reschedule a booking ---------- */
  let rsBooking = null;
  function openReschedule(b) {
    rsBooking = b;
    $("rsWho").textContent = `${b.name} · ${svcName(b.service, b.serviceName)} · ${fmtDate(b.date)} ${fmtTime(b.time)}`;
    $("rsDate").value = b.date; $("rsDate").min = today();
    $("rsTime").innerHTML = C.booking.slots.map((t) => `<option value="${t}" ${t === b.time ? "selected" : ""}>${fmtTime(t)}</option>`).join("");
    $("rsError").textContent = "";
    $("rsDialog").showModal();
  }
  $("rsCancel").addEventListener("click", () => $("rsDialog").close());
  $("rsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = $("rsDate").value, time = $("rsTime").value;
    if (!date || !time) { $("rsError").textContent = tr("nb.errFill"); return; }
    if (date === rsBooking.date && time === rsBooking.time) { $("rsDialog").close(); return; }
    $("rsSave").disabled = true;
    try {
      await DB.rescheduleBooking(rsBooking, date, time);
      $("rsDialog").close();
      toast(tr("rs.saved", { date: fmtDate(date), time: fmtTime(time) }));
    } catch (err) {
      console.error(err);
      $("rsError").textContent = tr(err.code === "slot-full" ? "rs.errFull" : "admin.updateFailed");
    } finally { $("rsSave").disabled = false; }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-reschedule]"); if (!b) return;
    const bk = upcoming.concat(past).find((x) => x.ref === b.dataset.reschedule);
    if (bk) openReschedule(bk);
  });

  /* ---------- plan requests (memberships & session packs) ---------- */
  let planRequests = [], prFilter = "open", unsubPlans = null, prFirst = true, prKnown = new Set();
  const PR_STATUS = {
    new: "st-noshow", contacted: "st-done", active: "st-confirmed", cancelled: "st-cancelled"
  };
  function planName(r) {
    // Stored label is English (e.g. "Full Recovery – 8 Sessions / Month"); rebuild it in Arabic when needed.
    if (!L.isAr) return r.label;
    const svcLabel = r.label.includes(" – ") ? (C.services.find((s) => r.label.startsWith(s.name + " – ")) || {}).name_ar : "";
    const plan = r.type === "membership" ? `${L.sessions(r.sessions)} ${tr("plans.perMonth")}` : `باقة ${L.sessions(r.sessions)}`;
    return svcLabel ? `${svcLabel} – ${plan}` : plan;
  }
  function watchPlans() {
    unsubPlans = DB.watchPlanRequests((rows) => {
      if (!prFirst) rows.filter((r) => !prKnown.has(r.id)).forEach((r) => toast(tr("pr.newToast", { name: r.name, plan: planName(r) })));
      prKnown = new Set(rows.map((r) => r.id));
      prFirst = false;
      planRequests = rows;
      renderPlanRequests();
    }, onWatchError);
  }
  function renderPlanRequests() {
    const fresh = planRequests.filter((r) => r.status === "new").length;
    $("prCount").hidden = !fresh;
    $("prCount").textContent = fresh;
    const rows = planRequests.filter((r) => prFilter === "all" ? true : prFilter === "active" ? r.status === "active" : (r.status === "new" || r.status === "contacted"));
    const box = $("planRequestList");
    if (!rows.length) { box.innerHTML = `<p class="empty">${tr("pr.empty")}</p>`; return; }
    box.innerHTML = rows.map((r) => {
      const phoneDigits = String(r.phone || "").replace(/\D/g, "");
      const when = r.createdAt && r.createdAt.toDate ? new Intl.DateTimeFormat(L.locale, { dateStyle: "medium", timeStyle: "short", timeZone: C.timeZone }).format(r.createdAt.toDate()) : "";
      const msg = tr("pr.msg", { name: r.name, plan: planName(r) });
      const act = (status, label, cls) => `<button class="btn ${cls || "btn-outline"} btn-sm" data-pr="${esc(r.id)}" data-pr-status="${status}">${label}</button>`;
      const cust = customers.find((c) => c.uid === r.uid) || customers.find((c) => c.phoneDigits && DB && c.phoneDigits === DB.phoneDigits(r.phone));
      return `
        <article class="bk ${r.status === "cancelled" ? "is-cancelled" : ""}">
          <div class="bk-time">${L.money(r.price)}</div>
          <div class="bk-main">
            <div class="bk-top"><strong>${esc(r.name)}</strong><span class="badge ${PR_STATUS[r.status] || ""}">${tr("pr.st." + r.status)}</span></div>
            <div class="bk-meta">${esc(tr(r.type === "membership" ? "plans.typeMembership" : "plans.typePack"))} · ${esc(planName(r))}</div>
            <div class="bk-meta">
              <a class="ltr" href="tel:${esc(phoneDigits ? "+" + phoneDigits : "")}">${esc(r.phone)}</a>
              ${r.email ? ` · <a class="ltr" href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ""} · <span class="ref">${esc(r.ref)}</span>
              ${when ? ` · ${esc(tr("pr.received", { date: when }))}` : ""}
            </div>
          </div>
          <div class="bk-actions">
            ${phoneDigits ? `<a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}">${tr("act.whatsapp")}</a>` : ""}
            ${r.status === "new" ? act("contacted", tr("pr.contacted")) : ""}
            ${r.status === "new" || r.status === "contacted" ? act("active", tr("pr.activate")) + act("cancelled", tr("act.cancel"), "btn-danger") : ""}
            ${r.status === "active" && cust ? `<button class="btn btn-primary btn-sm" type="button" data-pr-sessions="${esc(cust.uid)}">${tr("pr.sessions")}</button>` : ""}
            ${r.status === "active" || r.status === "cancelled" ? act("contacted", tr("pr.reopen")) : ""}
          </div>
        </article>`;
    }).join("");
  }
  $("planRequestList").addEventListener("click", async (e) => {
    const ps = e.target.closest("[data-pr-sessions]");
    if (ps) { const c = customers.find((x) => x.uid === ps.dataset.prSessions); if (c) openSessions(c); return; }
    const b = e.target.closest("[data-pr]"); if (!b) return;
    b.disabled = true;
    try {
      await DB.setPlanRequestStatus(b.dataset.pr, b.dataset.prStatus);
      const r = planRequests.find((x) => x.id === b.dataset.pr);
      if (b.dataset.prStatus === "active" && r) {
        const cust = customers.find((c) => c.uid === r.uid) || customers.find((c) => c.phoneDigits && c.phoneDigits === DB.phoneDigits(r.phone));
        if (cust) {
          const pack = { packName: planName(r), packTotal: r.sessions, balance: r.sessions };
          await DB.setCustomerPack(cust.uid, pack);
          toast(tr("pr.activatedPack", { n: r.sessions, name: cust.name }));
          openSchedule({ ...cust, ...pack }); // set the dates of the sessions straight away
        } else {
          toast(tr("pr.noAccount"));
        }
      } else toast(tr("admin.updated"));
    }
    catch (err) { console.error(err); toast(tr("admin.updateFailed")); b.disabled = false; }
  });
  document.querySelectorAll("[data-pr-filter]").forEach((c) => c.addEventListener("click", () => {
    prFilter = c.dataset.prFilter;
    document.querySelectorAll("[data-pr-filter]").forEach((x) => x.classList.toggle("active", x === c));
    renderPlanRequests();
  }));

  /* plans editor (Settings) */
  function imageOptions(current) {
    const list = [...new Set([current, ...C.services.map((s) => s.image), "assets/img/leaves-wall.jpg", "assets/img/hero-wide.jpg"].filter(Boolean))];
    return list.map((src) => {
      const svc = C.services.find((s) => s.image === src);
      const label = svc ? L.field(svc, "name") : src.startsWith("media:") ? tr("set.image") : src.split("/").pop();
      return `<option value="${esc(src)}" ${src === current ? "selected" : ""}>${esc(label)}</option>`;
    }).join("");
  }
  function planRow(kind, p) {
    p = p || { sessions: "", price: "" };
    const row = document.createElement("div");
    row.className = "plan-edit" + (kind === "packs" ? " is-pack" : "");
    row.dataset.id = p.id || "";
    row.innerHTML = `
      <label><span>${tr("set.sessions")}</span><input class="input" data-k="sessions" type="number" min="1" max="500" value="${esc(p.sessions)}" /></label>
      <label><span>${tr("set.price")}</span><input class="input" data-k="price" type="number" min="0" step="1" value="${esc(p.price)}" /></label>
      ${kind === "memberships" ? `<label><span>${tr("set.days")}</span><input class="input" data-k="days" type="number" min="1" max="365" value="${esc(p.days || 30)}" /></label>` : ""}
      ${kind === "packs" ? `
      <label><span>${tr("set.validityEn")}</span><input class="input" data-k="validity" dir="ltr" value="${esc(p.validity || "")}" placeholder="Valid for 3 months" /></label>
      <label><span>${tr("set.validityAr")}</span><input class="input" data-k="validity_ar" dir="rtl" value="${esc(p.validity_ar || "")}" placeholder="صالحة لمدة 3 أشهر" /></label>` : ""}
      <label><span>${tr("set.image")}</span><select class="input" data-k="image">${imageOptions(p.image || "assets/img/leaves-wall.jpg")}</select></label>
      <div class="plan-edit-flags">
        <label class="check"><input type="checkbox" data-k="featured" ${p.featured ? "checked" : ""} /> <span>${tr("services.best")}</span></label>
        <label class="check"><input type="checkbox" data-k="active" ${p.active === false ? "" : "checked"} /> <span>${tr("set.activeLabel")}</span></label>
        <button class="btn btn-danger btn-sm" type="button" data-remove-plan>${tr("set.removeRow")}</button>
      </div>`;
    return row;
  }
  function renderPlanEditor() {
    const plans = C.plans || { memberships: [], packs: [] };
    const forId = plans.serviceId || "full-recovery";
    $("plansService").innerHTML = C.services.map((sv) => `<option value="${esc(sv.id)}" ${sv.id === forId ? "selected" : ""}>${esc(L.field(sv, "name"))}</option>`).join("");
    $("membershipRows").innerHTML = ""; $("packRows").innerHTML = "";
    (plans.memberships || []).forEach((p) => $("membershipRows").appendChild(planRow("memberships", p)));
    // "Session Packs" on the booking page are the single sessions, so there is no separate pack list.
    $("plansSetError").textContent = "";
  }
  document.querySelectorAll("[data-add-plan]").forEach((b) => b.addEventListener("click", () => {
    const kind = b.dataset.addPlan;
    $(kind === "memberships" ? "membershipRows" : "packRows").appendChild(planRow(kind));
  }));
  ["membershipRows", "packRows"].forEach((id) => $(id).addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-plan]"); if (b) b.closest(".plan-edit").remove();
  }));
  function readPlanRows(id, prefix) {
    return [...$(id).querySelectorAll(".plan-edit")].map((row) => {
      const v = (k) => { const el = row.querySelector(`[data-k="${k}"]`); return el ? (el.type === "checkbox" ? el.checked : el.value.trim()) : undefined; };
      const p = {
        id: row.dataset.id || prefix + Math.random().toString(36).slice(2, 7),
        sessions: Math.round(Number(v("sessions"))),
        price: Math.round(Number(v("price")) * 100) / 100,
        image: v("image"),
        featured: v("featured"),
        active: v("active")
      };
      if (prefix === "m") p.days = Math.min(365, Math.max(1, Math.round(Number(v("days")) || 30)));
      if (prefix === "p") { p.validity = v("validity"); p.validity_ar = v("validity_ar"); }
      return p;
    });
  }
  $("savePlans").addEventListener("click", async (e) => {
    const memberships = readPlanRows("membershipRows", "m");
    const packs = readPlanRows("packRows", "p");
    if ([...memberships, ...packs].some((p) => !(p.sessions >= 1) || !(p.price >= 0) || Number.isNaN(p.price))) {
      $("plansSetError").textContent = tr("set.errPlans"); return;
    }
    $("plansSetError").textContent = "";
    await saveSite((site) => { site.plans = { ...(site.plans || {}), serviceId: $("plansService").value, memberships, packs }; }, e.currentTarget);
  });

  start();
})();
