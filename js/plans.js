/* Memberships & Session Packs page: pick a plan, send a join request (saved for the studio + WhatsApp). */
(function () {
  const C = window.RS_CONFIG;
  const { ICONS, esc, waLink, toast } = window.RS;
  const L = window.RS_I18N;
  const tr = L.t;
  const $ = (id) => document.getElementById(id);

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

  const plansOf = (tab) => ((C.plans && C.plans[tab]) || []).filter((p) => p.active !== false && p.sessions > 0);
  const perSession = (p) => Math.round((p.price / p.sessions) * 100) / 100;
  const typeOf = (tab) => (tab === "memberships" ? "membership" : "pack");

  function planLabel(p, tab, lang) {
    if (lang === "en") {
      return tab === "memberships"
        ? `${p.sessions} ${p.sessions === 1 ? "Session" : "Sessions"} / Month`
        : `${p.sessions}-Session Pack`;
    }
    return tab === "memberships" ? `${L.sessions(p.sessions)} ${tr("plans.perMonth")}` : `باقة ${L.sessions(p.sessions)}`;
  }
  const localLabel = (p, tab) => planLabel(p, tab, L.isAr ? "ar" : "en");

  /* ---------- state ---------- */
  let tab = location.hash === "#packs" ? "packs" : "memberships";
  const chosen = {}; // tab -> plan id

  function defaultChoice(list) {
    const featured = list.find((p) => p.featured);
    return (featured || list[0] || {}).id;
  }
  const selectedPlan = () => plansOf(tab).find((p) => p.id === chosen[tab]);

  /* ---------- render ---------- */
  function render() {
    const list = plansOf(tab);
    if (!list.some((p) => p.id === chosen[tab])) chosen[tab] = defaultChoice(list);

    document.querySelectorAll("[data-plan-tab]").forEach((b) => {
      const on = b.dataset.planTab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $("planPanel").setAttribute("aria-labelledby", "tabBtn-" + tab);
    $("plansTitle").textContent = tr(tab === "memberships" ? "plans.membershipsTitle" : "plans.packsTitle");
    $("plansSub").textContent = tr(tab === "memberships" ? "plans.membershipsSub" : "plans.packsSub");

    const box = $("planList");
    box.innerHTML = list.length ? list.map((p) => {
      const sub = tab === "memberships" ? tr("plans.perMonth") : (L.field(p, "validity") || "");
      return `
        <input class="sr-only" type="radio" name="plan" id="plan-${esc(p.id)}" value="${esc(p.id)}" ${p.id === chosen[tab] ? "checked" : ""} />
        <label class="plan-card ${p.featured ? "is-featured" : ""}" for="plan-${esc(p.id)}">
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
    }).join("") : `<p class="empty-note">${tr("plans.empty")}</p>`;
    RS.fillMedia(box);

    $("benefitsTitle").textContent = tr(tab === "memberships" ? "plans.benefitsMemberships" : "plans.benefitsPacks");
    $("benefits").innerHTML = BENEFITS[tab].map(([icon, key]) => `<li>${BENEFIT_ICONS[icon]}<span>${tr(key)}</span></li>`).join("");

    $("planCtaLabel").textContent = tr(tab === "memberships" ? "plans.joinMembership" : "plans.buyPack");
    $("planCta").disabled = !list.length;
  }

  function setTab(next, focus) {
    if (next === tab) return;
    tab = next;
    history.replaceState(null, "", "#" + tab);
    render();
    if (focus) $("tabBtn-" + tab).focus();
  }

  /* ---------- join request ---------- */
  const dlg = $("joinDialog");
  const phoneValid = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 7 && d.length <= 12; };
  const emailValid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
  let lastRequest = null;

  function planSummaryHTML(p) {
    return `<img ${RS.imgAttrs(p.image || "assets/img/leaves-wall.jpg")} alt="" />
      <div><strong>${esc(localLabel(p, tab))}</strong>
      <span class="muted small">${esc(tab === "memberships" ? tr("plans.typeMembership") : (L.field(p, "validity") || tr("plans.typePack")))}</span></div>
      <span class="price-pill">${L.money(p.price)}</span>`;
  }

  function openJoin() {
    const p = selectedPlan();
    if (!p) return;
    $("joinFormView").hidden = false;
    $("joinDoneView").hidden = true;
    $("joinPlan").innerHTML = planSummaryHTML(p);
    RS.fillMedia($("joinPlan"));
    $("joinError").textContent = "";
    ["j-name", "j-phone", "j-email"].forEach((id) => $(id).classList.remove("invalid"));
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    setTimeout(() => $("jName").focus(), 50);
  }

  $("jCc").innerHTML = COUNTRIES.map(([code, flag]) => `<option value="${code}" ${code === "971" ? "selected" : ""}>${flag} +${code}</option>`).join("");

  $("joinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p = selectedPlan();
    if (!p) return;
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
        await db.createPlanRequest({
          ref, type: typeOf(tab), planId: p.id, label: planLabel(p, tab, "en"), sessions: p.sessions,
          price: p.price, currency: C.currency, name, phone: fullPhone, email, lang: L.lang
        });
      }
      lastRequest = { ref, p, name, fullPhone };
      const msg = [
        tr("join.msg", { plan: localLabel(p, tab), price: L.money(p.price) }),
        "",
        `${tr("msg.reqRef")}: ${ref}`,
        `${tr("msg.name")}: ${name}`,
        `${tr("msg.phone")}: ${fullPhone}`,
        email ? `${tr("msg.email")}: ${email}` : null
      ].filter((l) => l !== null).join("\n");
      $("joinWa").href = waLink(msg);
      $("joinDonePlan").innerHTML = planSummaryHTML(p);
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

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg || e.target.closest("[data-join-close]")) dlg.close();
  });

  /* ---------- events ---------- */
  document.querySelectorAll("[data-plan-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.planTab)));
  document.querySelector(".seg").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    setTab(tab === "packs" ? "memberships" : "packs", true);
  });
  $("planList").addEventListener("change", (e) => { if (e.target.name === "plan") chosen[tab] = e.target.value; });
  $("planCta").addEventListener("click", openJoin);
  window.addEventListener("hashchange", () => {
    const h = location.hash === "#packs" ? "packs" : location.hash === "#memberships" ? "memberships" : null;
    if (h && h !== tab) { tab = h; render(); }
  });

  render();
  // Plans edited in the admin may be newer than the copy shown first.
  const before = JSON.stringify(C.plans);
  window.RS_SITE.then((site) => { if (site && JSON.stringify(C.plans) !== before) render(); });
})();
