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
    $("accUpcomingWrap").hidden = upcoming.length < 2;
    const used = hasPack ? Math.max(0, c.packTotal - (c.balance ?? 0)) : 0;
    $("accUpcoming").innerHTML = upcoming.map((b, i) => `<li><strong>${esc(svcName(b))}</strong><span>${esc(fmtDate(b.date))} · ${esc(L.time(b.time))}</span>${hasPack ? `<span class="acc-num">${tr("sess.num", { i: used + i + 1, total: c.packTotal })}</span>` : ""}<span class="badge st-confirmed">${tr("acc.booked")}</span></li>`).join("");
    const recent = visits.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 10);
    $("accHistory").innerHTML = recent.length
      ? recent.map((b) => `<li><strong>${esc(svcName(b))}</strong><span>${esc(fmtDate(b.date))} · ${esc(L.time(b.time))}</span>${b.status === "completed" ? `<span class="badge st-done">${tr("acc.done")}</span>` : ""}</li>`).join("")
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
      // The owner's account is not a customer account: explain, and offer the admin or a sign-out.
      if (await DB.isAdmin(user)) {
        $("accStatusText").innerHTML = `${tr("acc.ownerNote", { email: esc(user.email || "") })}
          <span class="owner-actions"><button class="btn btn-primary btn-sm" type="button" id="ownerSignOut">${tr("admin.signOut")}</button></span>`;
        $("ownerSignOut").addEventListener("click", () => DB.signOut());
        view("accStatus");
        return;
      }
      renderJourney(user);
    });
  })();
})();
