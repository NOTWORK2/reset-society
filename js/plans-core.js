/* Shared by the Memberships page and the booking page (Full Recovery → Membership):
 * plan cards, benefits, labels and the join-request dialog. Exposes window.RS_PLANS. */
(function () {
  const C = window.RS_CONFIG;
  const { ICONS, esc, waLink } = window.RS;
  const L = window.RS_I18N;
  const tr = L.t;

  const COUNTRIES = [
    ["971", "🇦🇪"], ["966", "🇸🇦"], ["968", "🇴🇲"], ["974", "🇶🇦"], ["965", "🇰🇼"], ["973", "🇧🇭"],
    ["20", "🇪🇬"], ["962", "🇯🇴"], ["961", "🇱🇧"], ["91", "🇮🇳"], ["92", "🇵🇰"], ["63", "🇵🇭"], ["44", "🇬🇧"], ["1", "🇺🇸"]
  ];

  const BENEFIT_ICONS = {
    calendar: ICONS.calendar,
    infinity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7.5 15.5c-2 0-3.5-1.6-3.5-3.5s1.5-3.5 3.5-3.5c3.5 0 5.5 7 9 7 2 0 3.5-1.6 3.5-3.5s-1.5-3.5-3.5-3.5c-3.5 0-5.5 7-9 7z"/></svg>',
    percent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M18.5 5.5l-13 13"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 4.8-9 4.8-9-4.8z"/><path d="M3 12.2l9 4.8 9-4.8"/><path d="M3 16.4l9 4.8 9-4.8"/></svg>',
    clock: ICONS.clock,
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.7-5"/></svg>'
  };
  const BENEFITS = {
    memberships: [["calendar", "b.priority"], ["infinity", "b.ongoing"], ["percent", "b.rates"], ["layers", "b.flexible"]],
    packs: [["percent", "b.save"], ["calendar", "b.anytime"], ["check", "b.noCommit"], ["clock", "b.track"]]
  };

  /* ---------- data helpers ---------- */
  const plansOf = (tab) => ((C.plans && C.plans[tab]) || []).filter((p) => p.active !== false && p.sessions > 0);
  const perSession = (p) => Math.round((p.price / p.sessions) * 100) / 100;
  const serviceId = () => (C.plans && C.plans.serviceId) || "full-recovery";
  const service = () => C.services.find((s) => s.id === serviceId());
  const serviceName = (lang) => { const s = service(); return s ? (lang === "ar" ? s.name_ar || s.name : s.name) : ""; };
  const defaultChoice = (list) => ((list.find((p) => p.featured) || list[0] || {}).id);

  // Short label shown on cards: "8 Sessions / Month" or "10-Session Pack".
  function shortLabel(p, tab, lang) {
    const days = Number(p.days) || 30;
    if (lang === "en") {
      const per = days === 30 ? "/ Month" : `/ ${days} days`;
      return tab === "memberships" ? `${p.sessions} ${p.sessions === 1 ? "Session" : "Sessions"} ${per}` : `${p.sessions}-Session Pack`;
    }
    return tab === "memberships" ? `${L.sessions(p.sessions)} ${L.period(days)}` : `باقة ${L.sessions(p.sessions)}`;
  }
  // Full label for requests and WhatsApp: "Full Recovery – 8 Sessions / Month".
  function fullLabel(p, tab, lang) {
    const name = serviceName(lang);
    return name ? `${name} – ${shortLabel(p, tab, lang)}` : shortLabel(p, tab, lang);
  }
  const here = () => (L.isAr ? "ar" : "en");

  /* ---------- markup ---------- */
  function cardsHTML(list, tab, chosenId, group) {
    if (!list.length) return `<p class="empty-note">${tr("plans.empty")}</p>`;
    return list.map((p) => {
      const sub = tab === "memberships" ? L.period(p.days) : (L.field(p, "validity") || tr("plans.oneTime"));
      const id = `${group}-${esc(p.id)}`;
      return `
        <input class="sr-only" type="radio" name="${group}" id="${id}" value="${esc(p.id)}" ${p.id === chosenId ? "checked" : ""} />
        <label class="plan-card ${p.featured ? "is-featured" : ""}" for="${id}">
          ${p.featured ? `<span class="plan-tag">${tr("services.best")}</span>` : ""}
          <img ${RS.imgAttrs(p.image || "assets/img/leaves-wall.jpg")} alt="" />
          <span class="plan-divider" aria-hidden="true"></span>
          <span class="plan-main">
            <strong class="plan-count">${esc(L.sessions(p.sessions))}</strong>
            <span class="plan-sub">${esc(sub)}</span>
          </span>
          <span class="plan-price">
            <span class="price-pill">${L.money(p.price)}</span>
            <span class="plan-per">${tr("plans.perSession", { price: `<bdi>${L.money(perSession(p))}</bdi>` })}</span>
          </span>
        </label>`;
    }).join("");
  }
  const benefitsHTML = (tab) => BENEFITS[tab].map(([icon, key]) => `<li>${BENEFIT_ICONS[icon]}<span>${tr(key)}</span></li>`).join("");

  function summaryHTML(p, tab) {
    return `<img ${RS.imgAttrs(p.image || "assets/img/leaves-wall.jpg")} alt="" />
      <div><strong>${esc(fullLabel(p, tab, here()))}</strong>
      <span class="muted small">${esc(tab === "memberships" ? tr("plans.typeMembership") : (L.field(p, "validity") || tr("plans.typePack")))}</span></div>
      <span class="price-pill">${L.money(p.price)}</span>`;
  }

  /* ---------- signed-in customer: details come from the account ---------- */
  let account = null;
  const accountReady = (async () => {
    const db = await window.RS_DB; if (!db) return;
    await db.auth.authStateReady();
    const u = db.auth.currentUser; if (!u || u.isAnonymous) return;
    const c = await db.getCustomer(u.uid).catch(() => null); if (!c) return;
    account = { name: c.name || u.displayName || "", digits: c.phoneDigits || "", email: c.hasEmail ? c.email : "" };
  })();
  const ccFor = (digits) => COUNTRIES.map((x) => x[0]).sort((a, b) => b.length - a.length).find((code) => digits.startsWith(code));
  function fillFromAccount() {
    if (!account) return false;
    $("jName").value = account.name;
    if (account.digits) {
      const cc = ccFor(account.digits);
      if (cc) { $("jCc").value = cc; $("jPhone").value = account.digits.slice(cc.length); } else $("jPhone").value = account.digits;
    }
    $("jEmail").value = account.email || "";
    $("joinAs").innerHTML = `${tr("join.as", { name: `<strong>${esc(account.name)}</strong>` })} · <span class="ltr">+${esc(account.digits)}</span> · <a href="#" data-join-edit>${tr("book.edit")}</a>`;
    return true;
  }

  /* ---------- join dialog (created once, on first use) ---------- */
  let dlg = null, current = null;
  const $ = (id) => document.getElementById(id);
  const phoneValid = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length >= 7 && d.length <= 12; };
  const emailValid = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

  function buildDialog() {
    dlg = document.createElement("dialog");
    dlg.className = "policy join-dialog";
    dlg.id = "joinDialog";
    dlg.setAttribute("aria-labelledby", "joinTitle");
    dlg.innerHTML = `
      <form class="policy-inner" id="joinForm" novalidate>
        <div id="joinFormView">
          <h2 id="joinTitle">${tr("details.title")}</h2>
          <div class="join-plan" id="joinPlan"></div>
          <p class="pay-as join-as" id="joinAs" hidden></p>
          <div class="field" id="j-name">
            <label for="jName">${tr("f.name")}</label>
            <input class="input" id="jName" autocomplete="name" maxlength="100" required />
            <div class="error-msg">${tr("f.nameErr")}</div>
          </div>
          <div class="field" id="j-phone">
            <label for="jPhone">${tr("f.phone")}</label>
            <div class="phone-wrap">
              <select id="jCc" aria-label="${tr("f.cc")}" autocomplete="tel-country-code">
                ${COUNTRIES.map(([code, flag]) => `<option value="${code}" ${code === "971" ? "selected" : ""}>${flag} +${code}</option>`).join("")}
              </select>
              <input id="jPhone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="50 123 4567" required />
            </div>
            <div class="error-msg">${tr("f.phoneErr")}</div>
          </div>
          <div class="field" id="j-email">
            <label for="jEmail">${tr("f.email")}</label>
            <input class="input" id="jEmail" type="email" autocomplete="email" inputmode="email" dir="ltr" maxlength="120" />
            <div class="error-msg">${tr("f.emailErr")}</div>
          </div>
          <p class="form-error" id="joinError" role="alert"></p>
          <div class="grid-2">
            <button class="btn btn-outline" type="button" data-join-close>${tr("nb.cancel")}</button>
            <button class="btn btn-primary" type="submit" id="joinSubmit">${tr("join.submit")}</button>
          </div>
        </div>
        <div id="joinDoneView" hidden>
          <div class="check-ring join-check">${ICONS.check}</div>
          <h2>${tr("join.doneTitle")}</h2>
          <div class="join-plan" id="joinDonePlan"></div>
          <p class="muted">${tr("join.doneText")}</p>
          <div class="join-done-actions">
            <a class="btn btn-primary btn-block" id="joinWa" target="_blank" rel="noopener">${ICONS.whatsapp} <span>${tr("join.wa")}</span></a>
            <button class="btn btn-outline btn-block" type="button" data-join-close>${tr("join.close")}</button>
          </div>
        </div>
      </form>`;
    document.body.appendChild(dlg);

    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.closest("[data-join-close]")) dlg.close();
      if (e.target.closest("[data-join-edit]")) { e.preventDefault(); $("joinFormView").classList.remove("as-account"); $("jName").focus(); }
    });

    $("joinForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!current) return;
      const { p, tab } = current;
      const name = $("jName").value.trim(), phone = $("jPhone").value.trim(), email = $("jEmail").value.trim();
      const checks = { "j-name": name.length >= 2, "j-phone": phoneValid(phone), "j-email": !email || emailValid(email) };
      Object.entries(checks).forEach(([id, ok]) => $(id).classList.toggle("invalid", !ok));
      const bad = Object.keys(checks).find((k) => !checks[k]);
      if (bad) { $(bad).querySelector("input").focus(); return; }

      const fullPhone = "+" + $("jCc").value + " " + phone.replace(/^0+/, "");
      const ref = "MB-" + String(Math.floor(10000 + Math.random() * 90000));
      const btn = $("joinSubmit");
      btn.disabled = true; btn.textContent = tr("join.sending"); $("joinError").textContent = "";
      try {
        const db = await window.RS_DB;
        if (db) {
          // The request's name + phone become the customer's account (or log in to it).
          if (db.ensureAccount) await db.ensureAccount({ name, phone: fullPhone, email });
          await db.createPlanRequest({
            ref, type: tab === "memberships" ? "membership" : "pack", planId: p.id,
            label: fullLabel(p, tab, "en").slice(0, 80), sessions: p.sessions,
            price: p.price, currency: C.currency, name, phone: fullPhone, email, lang: L.lang
          });
        }
        const msg = [
          tr("join.msg", { plan: fullLabel(p, tab, here()), price: L.money(p.price) }),
          "",
          `${tr("msg.reqRef")}: ${ref}`,
          `${tr("msg.name")}: ${name}`,
          `${tr("msg.phone")}: ${fullPhone}`,
          email ? `${tr("msg.email")}: ${email}` : null
        ].filter((l) => l !== null).join("\n");
        $("joinWa").href = waLink(msg);
        $("joinDonePlan").innerHTML = summaryHTML(p, tab);
        RS.fillMedia($("joinDonePlan"));
        $("joinFormView").hidden = true;
        $("joinDoneView").hidden = false;
        $("joinWa").focus();
      } catch (err) {
        console.error(err);
        $("joinError").textContent = tr("join.failed");
      } finally {
        btn.disabled = false; btn.textContent = tr("join.submit");
      }
    });
  }

  async function openJoin(p, tab) {
    if (!p) return;
    if (!dlg) buildDialog();
    current = { p, tab };
    $("joinFormView").hidden = false;
    $("joinDoneView").hidden = true;
    $("joinPlan").innerHTML = summaryHTML(p, tab);
    RS.fillMedia($("joinPlan"));
    $("joinError").textContent = "";
    ["j-name", "j-phone", "j-email"].forEach((id) => $(id).classList.remove("invalid"));
    // Registered customer: show "Requesting as …" instead of the empty form.
    await Promise.race([accountReady, new Promise((r) => setTimeout(r, 1500))]);
    const compact = fillFromAccount();
    $("joinFormView").classList.toggle("as-account", compact);
    $("joinAs").hidden = !compact;
    $("joinTitle").textContent = tr(compact ? "join.confirmTitle" : "details.title");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    setTimeout(() => (compact ? $("joinSubmit") : $("jName")).focus(), 50);
  }

  window.RS_PLANS = {
    plansOf, perSession, serviceId, service, serviceName, defaultChoice,
    shortLabel, fullLabel, cardsHTML, benefitsHTML, openJoin
  };
})();
