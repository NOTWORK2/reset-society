/* Booking flow: service → date & time → details → payment → confirmed. */
(function () {
  const C = window.RS_CONFIG;
  const { ICONS, esc, waLink, toast } = window.RS;
  const L = window.RS_I18N;
  const tr = L.t;
  const nm = (s) => L.field(s, "name");
  const P = window.RS_PLANS;

  /* First step: "Session Packs" (book one of the services) | "Memberships" (join a monthly plan). */
  let bookTab = location.hash === "#memberships" ? "memberships" : "sessions";
  let chosenPlan = null;
  const selectedPlan = () => P.plansOf("memberships").find((p) => p.id === chosenPlan);

  function renderMemberships() {
    const list = P.plansOf("memberships");
    if (!list.some((p) => p.id === chosenPlan)) chosenPlan = P.defaultChoice(list);
    const svc = P.service();
    $("plansFor").innerHTML = svc
      ? `${tr("plans.forService", { service: `<strong>${esc(L.field(svc, "name"))}</strong>` })} <span class="muted">(${esc(L.field(svc, "short") || "")})</span>`
      : "";
    $("planList").innerHTML = P.cardsHTML(list, "memberships", chosenPlan, "plan");
    $("benefits").innerHTML = P.benefitsHTML("memberships");
    $("planCta").disabled = !list.length;
    $("bookTab-memberships").hidden = !list.length;
    RS.fillMedia($("planList"));
  }

  function showBookTab(tab, focus) {
    if (tab === "memberships" && !P.plansOf("memberships").length) tab = "sessions";
    bookTab = tab;
    document.querySelectorAll("[data-book-tab]").forEach((b) => {
      const on = b.dataset.bookTab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $("bookPanel-sessions").hidden = tab !== "sessions";
    $("bookPanel-memberships").hidden = tab !== "memberships";
    if (focus) $("bookTab-" + tab).focus();
  }
  const STEPS = ["service", "datetime", "details", "payment", "confirmed"];
  const STORE_KEY = "rs-booking";
  const $ = (id) => document.getElementById(id);

  const COUNTRIES = [
    ["AE", "971", "🇦🇪"], ["SA", "966", "🇸🇦"], ["OM", "968", "🇴🇲"], ["QA", "974", "🇶🇦"],
    ["KW", "965", "🇰🇼"], ["BH", "973", "🇧🇭"], ["EG", "20", "🇪🇬"], ["JO", "962", "🇯🇴"],
    ["LB", "961", "🇱🇧"], ["IN", "91", "🇮🇳"], ["PK", "92", "🇵🇰"], ["PH", "63", "🇵🇭"],
    ["GB", "44", "🇬🇧"], ["US", "1", "🇺🇸"]
  ];

  /* ---------- state ---------- */
  let state = load() || {};
  if (!state.cc) state.cc = "971";
  if (!state.pay) state.pay = "location";

  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: state lives in memory */ }
  }
  const activeServices = () => C.services.filter((s) => s.active !== false);
  const service = () => activeServices().find((s) => s.id === state.serviceId);

  /* ---------- Firebase availability ---------- */
  let DB = null, dbState = "pending"; // pending → on (Firebase) | off (WhatsApp only)
  let avail = { counts: {}, closed: new Set(), loaded: false, loading: false };
  const availKnown = () => dbState === "off" || (dbState === "on" && avail.loaded && !avail.loading);

  window.RS_DB.then((d) => {
    DB = d; dbState = d ? "on" : "off";
    if (current() === "datetime") refreshAvailability(); else if (dbState === "on") refreshAvailability(true);
  });

  async function refreshAvailability(quiet) {
    if (dbState !== "on") { if (!quiet) { renderCalendar(); renderSlots(); } return; }
    avail.loading = true;
    if (!quiet) renderSlots();
    try {
      const a = await DB.loadAvailability(studioNow().date, lastDay());
      avail = { ...a, loaded: true, loading: false };
    } catch (e) {
      console.warn("Could not load availability", e);
      avail = { counts: {}, closed: new Set(), loaded: true, loading: false }; // confirm still checks the slot
    }
    if (current() === "datetime") { fixSelection(); renderCalendar(); renderSlots(); renderBindings(); }
  }

  function fixSelection() {
    if (!state.date || !dayOpen(state.date)) { state.date = firstOpenDay(); state.time = null; view = null; }
    if (state.time && !slotStillOpen()) state.time = null;
    save();
  }

  /* ---------- time helpers (all in the studio's time zone) ---------- */
  function studioNow() {
    const parts = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: C.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: +parts.hour * 60 + +parts.minute };
  }
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return { y, m: m - 1, d }; };
  const toUTC = (s) => { const { y, m, d } = parseYmd(s); return new Date(Date.UTC(y, m, d)); };
  const addDays = (s, n) => { const t = toUTC(s); t.setUTCDate(t.getUTCDate() + n); return ymd(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()); };
  const slotMinutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

  function fmtDate(s) {
    const out = new Intl.DateTimeFormat(L.locale, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })
      .format(toUTC(s));
    return L.isAr ? out : out.replace(/^(\w+)/, "$1,").replace(",,", ",");
  }
  const fmtTime = (hhmm) => L.time(hhmm);

  function slotsFor(dateStr) {
    const now = studioNow();
    const dow = toUTC(dateStr).getUTCDay();
    if (C.booking.closedWeekdays.includes(dow) || avail.closed.has(dateStr)) return [];
    const s = service();
    const cap = (s && s.capacity) || 1;
    return C.booking.slots.map((t) => {
      const future = dateStr > now.date || (dateStr === now.date && slotMinutes(t) >= now.minutes + C.booking.minLeadMinutes);
      const taken = s ? avail.counts[`${dateStr}_${t}_${s.id}`] || 0 : 0;
      return { time: t, available: future && taken < cap, full: future && taken >= cap };
    });
  }
  const dayOpen = (dateStr) => slotsFor(dateStr).some((s) => s.available);
  const lastDay = () => addDays(studioNow().date, C.booking.daysAhead);
  function firstOpenDay() {
    let d = studioNow().date;
    for (let i = 0; i <= C.booking.daysAhead; i++, d = addDays(d, 1)) if (dayOpen(d)) return d;
    return null;
  }

  /* ---------- step guards ---------- */
  function detailsValid() {
    return state.name && state.name.trim().length >= 2 && phoneValid(state.phone) &&
      (!state.email || emailValid(state.email)) && state.agree;
  }
  const phoneValid = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 7 && d.length <= 12; };
  const emailValid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

  function slotStillOpen() {
    return state.date && state.time && slotsFor(state.date).some((s) => s.time === state.time && s.available);
  }
  function firstIncomplete(target) {
    const idx = STEPS.indexOf(target);
    if (idx >= 1 && !service()) return "service";
    if (target === "confirmed") return state.ref ? null : "payment";
    if (idx >= 2 && !slotStillOpen()) return "datetime";
    if (idx >= 3 && !detailsValid()) return "details";
    return null;
  }

  /* ---------- rendering ---------- */
  function renderServices() {
    const list = $("serviceList");
    list.querySelectorAll("input, label").forEach((el) => el.remove());
    list.insertAdjacentHTML("beforeend", activeServices().map((s) => `
      <input class="sr-only" type="radio" name="service" id="svc-${esc(s.id)}" value="${esc(s.id)}" ${state.serviceId === s.id ? "checked" : ""} />
      <label class="service-opt" for="svc-${esc(s.id)}">
        <img ${RS.imgAttrs(s.image)} alt="" />
        <div>
          <h3>${esc(nm(s))}</h3>
          <div class="meta"><span>${L.money(s.price)}</span><span class="sep"></span><span>${esc(L.field(s, "duration"))}</span></div>
          <p>${esc(L.field(s, "short"))}</p>
        </div>
        <span class="radio">${ICONS.check}</span>
      </label>`).join(""));
    RS.fillMedia(list);
    renderMemberships();
    showBookTab(bookTab);
  }

  function renderPolicy() {
    const lines = C.policy && C.policy[L.lang];
    if (!lines || !lines.length) return; // keep the default text from js/i18n.js
    $("policyList").innerHTML = lines.map((l) => `<li>${esc(l)}</li>`).join("");
  }

  let view = null; // {y, m} month shown in the calendar
  function renderCalendar() {
    const today = studioNow().date, max = lastDay();
    if (!view) { const p = parseYmd(state.date || today); view = { y: p.y, m: p.m }; }
    const first = new Date(Date.UTC(view.y, view.m, 1));
    const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    $("calTitle").textContent = new Intl.DateTimeFormat(L.locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(first);

    const t = parseYmd(today), mx = parseYmd(max);
    $("calPrev").disabled = view.y < t.y || (view.y === t.y && view.m <= t.m);
    $("calNext").disabled = view.y > mx.y || (view.y === mx.y && view.m >= mx.m);

    let html = tr("cal.dows").split(",").map((d) => `<div class="cal-dow" role="columnheader">${d}</div>`).join("");
    for (let i = 0; i < first.getUTCDay(); i++) html += "<div></div>";
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = ymd(view.y, view.m, d);
      const disabled = ds < today || ds > max || !dayOpen(ds);
      const cls = ["cal-day", ds === today ? "today" : "", ds === state.date ? "selected" : ""].join(" ");
      html += `<button type="button" class="${cls}" data-date="${ds}" ${disabled ? "disabled" : ""}
        aria-label="${fmtDate(ds)}${disabled ? " – " + tr("cal.unavailable") : ""}" aria-pressed="${ds === state.date}">${d}</button>`;
    }
    $("calGrid").innerHTML = html;
  }

  function renderSlots() {
    const box = $("slots");
    if (!availKnown()) { box.innerHTML = `<p class="empty-note" style="grid-column:1/-1">${tr("slots.checking")}</p>`; return; }
    if (!state.date) { box.innerHTML = `<p class="empty-note" style="grid-column:1/-1">${tr("slots.none", { days: C.booking.daysAhead })}</p>`; return; }
    const slots = slotsFor(state.date);
    box.innerHTML = slots.length
      ? slots.map((s) => `<button type="button" class="slot ${s.time === state.time ? "selected" : ""}" data-time="${s.time}"
          ${s.available ? "" : "disabled"} aria-pressed="${s.time === state.time}"
          ${s.full ? `title="${tr("slots.full")}"` : ""}>${fmtTime(s.time)}${s.full ? `<span class="sr-only"> (${tr("slots.full")})</span>` : ""}</button>`).join("")
      : `<p class="empty-note" style="grid-column:1/-1">${tr("slots.closed")}</p>`;
  }

  function summaryHTML(kind) {
    const s = service();
    if (!s) return `<p class="side-empty">${tr("side.empty")}</p>`;
    const row = (icon, label, value) => `<div class="summary-row">${ICONS[icon]}<span>${label}</span><span class="v">${value}</span></div>`;
    let html = `<div class="summary-top">
        <img ${RS.imgAttrs(s.image)} alt="" />
        <div><h3>${esc(nm(s))}</h3><small>${tr("sum.single")}</small></div>
        <span class="price">${kind === "full" ? "" : L.money(s.price)}</span>
      </div>`;
    html += row("calendar", tr("sum.date"), state.date ? fmtDate(state.date) : "—");
    html += row("clock", tr("sum.time"), state.time ? fmtTime(state.time) : "—");
    if (kind === "full") {
      html += row("pin", tr("sum.location"), `<span class="caps">Reset Society</span><small>${esc(L.field(C, "city"))}</small>`);
      html += row("card", tr("sum.payment"), state.pay === "online" ? tr("pay.paidOnline") : tr("pay.location"));
      html += row("ticket", tr("sum.ref"), `<span class="ltr">${esc(state.ref || "")}</span>`);
    }
    return html;
  }

  function renderSide() {
    const s = service();
    $("sideSummary").innerHTML = summaryHTML("basic") +
      (s ? `<div class="side-total"><span>${tr("total")}</span><strong>${L.money(s.price)}</strong></div>` : "");
  }

  function renderBindings() {
    const s = service();
    document.querySelectorAll('[data-bind="serviceName"]').forEach((el) => { el.textContent = s ? nm(s) : tr("dt.pick"); });
    document.querySelectorAll('[data-bind="price"]').forEach((el) => { el.textContent = s ? L.money(s.price) : ""; });
    document.querySelectorAll('[data-summary="basic"]').forEach((el) => { el.innerHTML = summaryHTML("basic"); });
    document.querySelectorAll('[data-summary="full"]').forEach((el) => { el.innerHTML = summaryHTML("full"); });
    if (state.ref && s) $("waBtn").href = waLink(state.mode === "firebase" ? manageMessage() : bookingMessage());
    renderSide();
    RS.fillMedia(document);
  }

  function resetBooking() {
    // Keep the guest's contact details, clear the session choice.
    state = { cc: state.cc, name: state.name, phone: state.phone, email: state.email, agree: state.agree, pay: "location" };
    view = null;
    save();
    document.querySelectorAll('input[name="service"]').forEach((i) => { i.checked = false; });
  }

  function renderPayment() {
    const opts = [
      { id: "online", icon: "card", title: tr("pay.online"), sub: tr("pay.onlineSub"), enabled: !!C.payment.online },
      { id: "location", icon: "wallet", title: tr("pay.location"), sub: tr("pay.locationSub"), enabled: true }
    ];
    if (!C.payment.online && state.pay === "online") state.pay = "location";
    $("payOptions").innerHTML = opts.map((o) => `
      <input class="sr-only" type="radio" name="pay" id="pay-${o.id}" value="${o.id}" ${state.pay === o.id ? "checked" : ""} ${o.enabled ? "" : "disabled"} />
      <label class="pay-opt" for="pay-${o.id}">
        ${ICONS[o.icon].replace("<svg", '<svg class="ico"')}
        <div><strong>${o.title}${o.enabled ? "" : `<span class="soon">${tr("pay.soon")}</span>`}</strong><span>${o.sub}</span></div>
        <span class="pay-dot"></span>
      </label>`).join("");
  }

  function fillDetails() {
    $("cc").innerHTML = COUNTRIES.map(([iso, code, flag]) =>
      `<option value="${code}" ${state.cc === code ? "selected" : ""}>${flag} +${code}</option>`).join("");
    $("name").value = state.name || "";
    $("phone").value = state.phone || "";
    $("email").value = state.email || "";
    $("agree").checked = !!state.agree;
    prefillFromAccount();
  }
  /* Signed-in customer: their account fills the booking details, so the "Your details" step is skipped
     (they can still open it from the payment step to change something for this booking). */
  let account = null;
  const ccFor = (digits) => COUNTRIES.map((x) => x[1]).sort((a, b) => b.length - a.length).find((code) => digits.startsWith(code));
  function applyAccount() {
    if (!account) return;
    if (!state.name) state.name = account.name;
    if (!state.phone && account.digits) {
      const cc = ccFor(account.digits);
      state.cc = cc || "971";
      state.phone = cc ? account.digits.slice(cc.length) : account.digits;
    }
    if (!state.email && account.email) state.email = account.email;
    state.agree = true; // accepted the policy when creating the account
    save();
  }
  async function loadAccount() {
    const db = await window.RS_DB; if (!db) return;
    await db.auth.authStateReady();
    const u = db.auth.currentUser;
    if (!u || u.isAnonymous) { account = null; $("loginHint").hidden = false; renderPayAs(); return; }
    $("loginHint").hidden = true;
    const c = await db.getCustomer(u.uid).catch(() => null);
    if (!c) return;
    account = { uid: u.uid, name: c.name || u.displayName || "", digits: c.phoneDigits || "", email: c.hasEmail ? c.email : "" };
    applyAccount();
    if (current() === "details") fillDetails();
    renderPayAs();
  }
  const accountReady = loadAccount();
  function renderPayAs() {
    const el = $("payAs"); if (!el) return;
    el.hidden = !account;
    if (account) el.innerHTML = `${tr("book.as", { name: `<strong>${esc(state.name || account.name)}</strong>` })} · <span class="ltr">${esc(fullPhone())}</span> · <a href="#details" data-edit-details>${tr("book.edit")}</a>`;
  }
  function prefillFromAccount() { /* kept for callers; details now come from applyAccount() */ }

  /* ---------- navigation ---------- */
  function current() { const h = location.hash.slice(1); return STEPS.includes(h) ? h : "service"; }
  window.addEventListener("hashchange", () => { if (location.hash === "#memberships") showBookTab("memberships"); });

  function show(step) {
    const missing = firstIncomplete(step);
    if (missing && missing !== step) { location.replace("#" + missing); return; }

    if (step === "datetime") {
      fixSelection();
      renderCalendar(); renderSlots();
      refreshAvailability();
    }
    if (step === "confirmed") renderConfirmMode();
    if (step === "details") fillDetails();
    if (step === "payment") { renderPayment(); renderPayAs(); }
    renderBindings();

    document.querySelectorAll(".step").forEach((el) => el.classList.toggle("active", el.dataset.step === step));
    $("flow").classList.toggle("no-side", step === "confirmed");
    $("progressBar").style.width = ((STEPS.indexOf(step) + 1) / STEPS.length * 100) + "%";
    if (step !== "confirmed") document.title = tr(({ service: "book.pageTitle", datetime: "dt.pageTitle", details: "details.pageTitle", payment: "pay.pageTitle" })[step]) + " | Reset Society";
    window.scrollTo(0, 0);
    const h = document.querySelector(`.step[data-step="${step}"] h1`);
    if (h && document.activeElement && document.activeElement !== document.body) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }

  function go(step) { if (location.hash.slice(1) === step) show(step); else location.hash = step; }
  function next() {
    const i = STEPS.indexOf(current());
    const step = current();
    if (step === "service" && !service()) { toast(tr("toast.chooseSession")); return; }
    if (step === "datetime" && !state.time) { toast(tr("toast.chooseTime")); return; }
    if (step === "datetime" && account) {
      applyAccount();
      if (detailsValid()) { go("payment"); return; }
    }
    go(STEPS[i + 1]);
  }

  /* ---------- details form ---------- */
  function validateDetails(showErrors) {
    const name = $("name").value.trim(), phone = $("phone").value.trim(), email = $("email").value.trim();
    const checks = {
      "f-name": name.length >= 2,
      "f-phone": phoneValid(phone),
      "f-email": !email || emailValid(email),
      "f-agree": $("agree").checked
    };
    if (showErrors) Object.entries(checks).forEach(([id, ok]) => $(id).classList.toggle("invalid", !ok));
    return checks;
  }

  function saveDetails() {
    state.name = $("name").value.trim();
    state.cc = $("cc").value;
    state.phone = $("phone").value.trim();
    state.email = $("email").value.trim();
    state.agree = $("agree").checked;
    save();
  }

  /* ---------- confirm ---------- */
  function fullPhone() { return "+" + state.cc + " " + state.phone.replace(/^0+/, ""); }

  function bookingMessage() {
    const s = service();
    return [
      tr("msg.book"),
      "",
      `${tr("msg.ref")}: ${state.ref}`,
      `${tr("msg.service")}: ${nm(s)} (${L.money(s.price)})`,
      `${tr("msg.date")}: ${fmtDate(state.date)}`,
      `${tr("msg.time")}: ${fmtTime(state.time)}`,
      `${tr("msg.name")}: ${state.name}`,
      `${tr("msg.phone")}: ${fullPhone()}`,
      state.email ? `${tr("msg.email")}: ${state.email}` : null,
      `${tr("msg.payment")}: ${state.pay === "online" ? tr("pay.paidOnline") : tr("pay.location")}`
    ].filter((l) => l !== null).join("\n");
  }

  function manageMessage() {
    const s = service();
    return tr("msg.manage", { ref: state.ref, service: nm(s), date: fmtDate(state.date), time: fmtTime(state.time) });
  }

  let confirming = false;
  async function confirmBooking() {
    if (confirming) return;
    if (firstIncomplete("payment")) { show("payment"); return; }
    const picked = document.querySelector('input[name="pay"]:checked');
    state.pay = picked ? picked.value : "location";
    const btn = $("confirmBtn");
    const label = btn.innerHTML;

    // Before Firebase answers, Confirm waits for it (shows "Saving…").
    confirming = true; btn.disabled = true; btn.textContent = tr("saving");
    try {
      const db = await window.RS_DB;
      if (!db) {
        // No database: the studio receives the booking through WhatsApp.
        state.ref = "RS-" + String(Math.floor(10000 + Math.random() * 90000));
        state.mode = "whatsapp";
        save();
        window.open(waLink(bookingMessage()), "_blank", "noopener");
        go("confirmed");
        return;
      }
      const s = service();
      state.ref = await db.createBooking({
        service: s.id, serviceName: s.name, price: s.price, currency: C.currency,
        date: state.date, time: state.time, name: state.name, phone: fullPhone(),
        email: state.email || "", pay: state.pay
      });
      state.mode = "firebase";
      save();
      go("confirmed");
    } catch (e) {
      state.ref = null; save();
      if (e.code === "slot-full") {
        toast(tr("toast.slotTaken"));
        state.time = null; save();
        go("datetime");
      } else {
        console.error(e);
        toast(tr("toast.saveFailed"));
      }
    } finally {
      confirming = false; btn.disabled = false; btn.innerHTML = label;
    }
  }

  function renderConfirmMode() {
    const fb = state.mode === "firebase";
    $("h-confirmed").textContent = tr(fb ? "done.fbTitle" : "done.waTitle");
    $("confirmSub").textContent = tr(fb ? "done.fbSub" : "done.waSub");
    $("waLabel").textContent = tr(fb ? "done.fbWa" : "done.waWa");
    $("confirmNote").innerHTML = tr(fb ? "done.fbNote" : "done.waNote");
    document.title = tr(fb ? "done.fbTitle" : "done.waTitle") + " | Reset Society";
  }

  function downloadICS() {
    const s = service(); if (!s || !state.date || !state.time) return;
    const { y, m, d } = parseYmd(state.date);
    const mins = slotMinutes(state.time);
    const start = new Date(Date.UTC(y, m, d, 0, mins - C.utcOffsetHours * 60));
    const end = new Date(start.getTime() + s.minutes * 60000);
    const f = (dt) => dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Reset Society//Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${state.ref}@resetsociety`,
      `DTSTAMP:${f(new Date())}`,
      `DTSTART:${f(start)}`,
      `DTEND:${f(end)}`,
      `SUMMARY:${nm(s)} – Reset Society`,
      `LOCATION:Reset Society\\, ${L.field(C, "city")}\\, ${L.field(C, "country")}`,
      `DESCRIPTION:${tr("ics.desc", { ref: state.ref })}`,
      "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${tr("ics.alarm")}`, "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `reset-society-${state.ref}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- events ---------- */
  function bind() {
    $("serviceList").addEventListener("change", (e) => {
      if (e.target.name !== "service") return;
      state.serviceId = e.target.value;
      save(); renderBindings();
    });
    document.querySelectorAll("[data-book-tab]").forEach((b) => b.addEventListener("click", () => {
      showBookTab(b.dataset.bookTab);
      if (current() === "service") history.replaceState(null, "", b.dataset.bookTab === "memberships" ? "#memberships" : "book.html");
    }));
    document.querySelector(".seg").addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      showBookTab(bookTab === "sessions" ? "memberships" : "sessions", true);
    });
    $("planList").addEventListener("change", (e) => { if (e.target.name === "plan") chosenPlan = e.target.value; });
    $("planCta").addEventListener("click", () => P.openJoin(selectedPlan(), "memberships"));
    document.querySelectorAll("[data-next]").forEach((b) => b.addEventListener("click", next));
    document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => {
      const i = STEPS.indexOf(current());
      if (current() === "payment" && account) { go("datetime"); return; }
      go(STEPS[Math.max(0, i - 1)]);
    }));
    document.addEventListener("click", (e) => { if (e.target.closest("[data-edit-details]")) { e.preventDefault(); go("details"); } });

    $("calGrid").addEventListener("click", (e) => {
      const b = e.target.closest(".cal-day"); if (!b || b.disabled) return;
      if (state.date !== b.dataset.date) { state.date = b.dataset.date; state.time = null; }
      save(); renderCalendar(); renderSlots(); renderBindings();
    });
    $("calPrev").addEventListener("click", () => { view.m--; if (view.m < 0) { view.m = 11; view.y--; } renderCalendar(); });
    $("calNext").addEventListener("click", () => { view.m++; if (view.m > 11) { view.m = 0; view.y++; } renderCalendar(); });
    $("slots").addEventListener("click", (e) => {
      const b = e.target.closest(".slot"); if (!b || b.disabled) return;
      state.time = b.dataset.time; save(); renderSlots(); renderBindings();
    });

    const form = $("detailsForm");
    form.addEventListener("input", (e) => {
      const f = e.target.closest(".field");
      if (f && f.classList.contains("invalid")) validateDetails(true);
    });
    form.addEventListener("change", saveDetails);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const checks = validateDetails(true);
      saveDetails();
      const bad = Object.keys(checks).find((k) => !checks[k]);
      if (bad) { const el = $(bad).querySelector("input"); if (el) el.focus(); return; }
      go("payment");
    });

    $("payOptions").addEventListener("change", (e) => { if (e.target.name === "pay") { state.pay = e.target.value; save(); } });
    $("confirmBtn").addEventListener("click", confirmBooking);
    $("icsBtn").addEventListener("click", downloadICS);
    $("newBooking").addEventListener("click", (e) => {
      e.preventDefault();
      resetBooking();
      go("service");
    });

    const dlg = $("policyDialog");
    document.querySelectorAll("[data-policy]").forEach((b) => b.addEventListener("click", () => {
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    }));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

    window.addEventListener("hashchange", () => show(current()));
  }

  /* ---------- start ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    // A finished booking isn't resumed on a fresh visit; start a new one.
    if (state.ref && current() !== "confirmed") resetBooking();

    // Coming from a "Book Cold Plunge" link: preselect it and go straight to date & time.
    const pre = new URLSearchParams(location.search).get("service");
    if (pre && activeServices().some((s) => s.id === pre) && !location.hash) {
      if (state.serviceId !== pre) { state.serviceId = pre; state.date = null; state.time = null; }
      save();
      history.replaceState(null, "", "book.html#datetime");
    }
    renderServices();
    renderPolicy();
    bind();
    show(current());

    // Prices and services edited in the admin may be newer than the copy shown first.
    const before = JSON.stringify([C.services, C.booking, C.plans]);
    window.RS_SITE.then((site) => {
      if (!site || JSON.stringify([C.services, C.booking, C.plans]) === before) return;
      renderServices();
      renderPolicy();
      if (current() !== "confirmed") show(current()); else renderBindings();
    });
  });
})();
