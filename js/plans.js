/* Memberships & Session Packs page. Cards, labels and the join dialog come from plans-core.js. */
(function () {
  const C = window.RS_CONFIG;
  const L = window.RS_I18N;
  const tr = L.t;
  const P = window.RS_PLANS;
  const $ = (id) => document.getElementById(id);

  let tab = location.hash === "#packs" ? "packs" : "memberships";
  const chosen = {}; // tab -> plan id
  const selectedPlan = () => P.plansOf(tab).find((p) => p.id === chosen[tab]);

  function render() {
    const list = P.plansOf(tab);
    if (!list.some((p) => p.id === chosen[tab])) chosen[tab] = P.defaultChoice(list);

    document.querySelectorAll("[data-plan-tab]").forEach((b) => {
      const on = b.dataset.planTab === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $("planPanel").setAttribute("aria-labelledby", "tabBtn-" + tab);
    $("plansTitle").textContent = tr(tab === "memberships" ? "plans.membershipsTitle" : "plans.packsTitle");
    $("plansSub").textContent = tr(tab === "memberships" ? "plans.membershipsSub" : "plans.packsSub");

    const svc = P.service();
    $("plansFor").innerHTML = svc
      ? `${tr("plans.forService", { service: `<strong>${RS.esc(L.field(svc, "name"))}</strong>` })} <span class="muted">(${RS.esc(L.field(svc, "short") || "")})</span>`
      : "";

    $("planList").innerHTML = P.cardsHTML(list, tab, chosen[tab], "plan");
    RS.fillMedia($("planList"));
    $("benefitsTitle").textContent = tr(tab === "memberships" ? "plans.benefitsMemberships" : "plans.benefitsPacks");
    $("benefits").innerHTML = P.benefitsHTML(tab);
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

  document.querySelectorAll("[data-plan-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.planTab)));
  document.querySelector(".seg").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    setTab(tab === "packs" ? "memberships" : "packs", true);
  });
  $("planList").addEventListener("change", (e) => { if (e.target.name === "plan") chosen[tab] = e.target.value; });
  $("planCta").addEventListener("click", () => P.openJoin(selectedPlan(), tab));
  window.addEventListener("hashchange", () => {
    const h = location.hash === "#packs" ? "packs" : location.hash === "#memberships" ? "memberships" : null;
    if (h && h !== tab) { tab = h; render(); }
  });

  render();
  // Plans edited in the admin may be newer than the copy shown first.
  const before = JSON.stringify([C.plans, C.services]);
  window.RS_SITE.then((site) => { if (site && JSON.stringify([C.plans, C.services]) !== before) render(); });
})();
