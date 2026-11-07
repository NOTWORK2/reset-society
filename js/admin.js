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
      renderStats(); renderList();
    }, onWatchError);
    unsubSettings = DB.watchSettings((s) => { settings = s; renderSchedule(); });
    unsubSite = DB.watchSite((site) => {
      if (site) window.RS_applySite(site);
      siteSaved = !!site;
      refreshAll();
    });
    watchScheduleDay();
    watchPlans();
  }
  function stopWatching() {
    if (unsubPlans) { unsubPlans(); unsubPlans = null; }
    planRequests = []; prFirst = true;
    [unsubUpcoming, unsubPast, unsubDay, unsubSettings, unsubSite].forEach((u) => u && u());
    unsubUpcoming = unsubPast = unsubDay = unsubSettings = unsubSite = null;
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
      const msg = tr("admin.msgCustomer", { name: b.name, ref: b.ref, service: svcName(b.service, b.serviceName), date: fmtDate(b.date), time: fmtTime(b.time) });
      html += `
        <article class="bk ${b.status === "cancelled" ? "is-cancelled" : ""}">
          <div class="bk-time">${fmtTime(b.time)}</div>
          <div class="bk-main">
            <div class="bk-top"><strong>${esc(b.name)}</strong><span class="badge ${st.cls}">${st.label}</span></div>
            <div class="bk-meta">${esc(svcName(b.service, b.serviceName))} · ${esc(L.money(b.price ?? ""))} · ${b.pay === "online" ? tr("pay.paidOnline") : tr("pay.location")}${b.source ? " · " + tr("admin.byAdmin") : ""}</div>
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
    ["bookings", "plans", "schedule", "settings"].forEach((n) => { $("tab-" + n).hidden = t.dataset.tab !== n; });
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
      plans: C.plans || { memberships: [], packs: [] }
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

  /* ---------- plan requests (memberships & session packs) ---------- */
  let planRequests = [], prFilter = "open", unsubPlans = null, prFirst = true, prKnown = new Set();
  const PR_STATUS = {
    new: "st-noshow", contacted: "st-done", active: "st-confirmed", cancelled: "st-cancelled"
  };
  function planName(r) {
    // Stored label is English; rebuild it in the admin's language.
    if (!L.isAr) return r.label;
    return r.type === "membership" ? `${L.sessions(r.sessions)} ${tr("plans.perMonth")}` : `باقة ${L.sessions(r.sessions)}`;
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
            ${r.status === "active" || r.status === "cancelled" ? act("contacted", tr("pr.reopen")) : ""}
          </div>
        </article>`;
    }).join("");
  }
  $("planRequestList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-pr]"); if (!b) return;
    b.disabled = true;
    try { await DB.setPlanRequestStatus(b.dataset.pr, b.dataset.prStatus); toast(tr("admin.updated")); }
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
    $("membershipRows").innerHTML = ""; $("packRows").innerHTML = "";
    (plans.memberships || []).forEach((p) => $("membershipRows").appendChild(planRow("memberships", p)));
    (plans.packs || []).forEach((p) => $("packRows").appendChild(planRow("packs", p)));
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
    await saveSite((site) => { site.plans = { memberships, packs }; }, e.currentTarget);
  });

  start();
})();
