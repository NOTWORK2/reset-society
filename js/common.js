/* Shared helpers: icons, menu, header state, WhatsApp links, reveal-on-scroll. */
(function () {
  const C = window.RS_CONFIG;

  const ICONS = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12H4M10 6l-6 6 6 6"/></svg>',
    chevL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01M16 16.5h.01" stroke-width="2"/></svg>',
    calendarPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4M12 12.5v5M9.5 15h5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h2"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5V18a2 2 0 002 2h13a1 1 0 001-1v-3"/><path d="M20 12v-2.5a1 1 0 00-1-1H6A2 2 0 014 6.5 2 2 0 016 4.5h10"/><path d="M20 12h-3.5a2 2 0 000 4H20z"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a1 1 0 011-1h15a1 1 0 011 1V10a2 2 0 000 4v2.5a1 1 0 01-1 1h-15a1 1 0 01-1-1V14a2 2 0 000-4z"/><path d="M14 6.5v11" stroke-dasharray="1.5 2"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 005.5 5.5l1.5-2 4 1.5V18a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".9" fill="currentColor"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 004.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0012.04 2zm0 18.15h-.01a8.23 8.23 0 01-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 01-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.24 8.24 0 018.24 8.25c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.76-1.84-.2-.48-.41-.42-.56-.43h-.48a.92.92 0 00-.66.31c-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.29z"/></svg>'
  };

  function waLink(text) {
    return "https://wa.me/" + C.whatsapp + (text ? "?text=" + encodeURIComponent(text) : "");
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Fill [data-icon] placeholders and config-driven text/links.
  function hydrate(root) {
    root.querySelectorAll("[data-icon]").forEach((el) => {
      if (!el.dataset.iconDone) { el.insertAdjacentHTML("afterbegin", ICONS[el.dataset.icon] || ""); el.dataset.iconDone = "1"; }
    });
    root.querySelectorAll("[data-wa]").forEach((el) => {
      el.href = waLink(el.dataset.wa || (window.RS_I18N ? window.RS_I18N.t("wa.hello") : "Hello Reset Society, I'd like to ask about a session."));
      el.target = "_blank"; el.rel = "noopener";
    });
    root.querySelectorAll("[data-ig]").forEach((el) => { el.href = C.instagram; el.target = "_blank"; el.rel = "noopener"; });
    root.querySelectorAll("[data-tel]").forEach((el) => { el.href = "tel:+" + C.whatsapp; el.textContent = C.phoneDisplay; });
    root.querySelectorAll("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });
  }

  function initMenu() {
    const menu = document.getElementById("menu");
    if (!menu) return;
    const openBtn = document.querySelector(".menu-btn");
    const closeBtn = menu.querySelector(".menu-close");
    const open = () => { menu.classList.add("open"); menu.setAttribute("aria-hidden", "false"); openBtn.setAttribute("aria-expanded", "true"); document.body.style.overflow = "hidden"; closeBtn.focus(); };
    const close = () => { menu.classList.remove("open"); menu.setAttribute("aria-hidden", "true"); openBtn.setAttribute("aria-expanded", "false"); document.body.style.overflow = ""; };
    openBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", () => { close(); openBtn.focus(); });
    menu.querySelectorAll("nav a").forEach((a) => a.addEventListener("click", close));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.classList.contains("open")) { close(); openBtn.focus(); } });
  }

  function initHeader() {
    const header = document.querySelector(".site-header[data-transparent]");
    if (!header) return;
    const update = () => {
      const solid = window.scrollY > 40;
      header.classList.toggle("is-solid", solid);
      header.classList.toggle("is-transparent", !solid);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  function initReveal() {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach((e) => io.observe(e));
  }

  let toastTimer;
  function toast(msg) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  /* Service photos uploaded from the admin are stored in Firestore as "media:<id>".
     imgAttrs() writes a placeholder for them and fillMedia() swaps in the real image. */
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const mediaCache = {};
  function imgAttrs(src) {
    src = String(src || "");
    return src.startsWith("media:")
      ? `src="${mediaCache[src.slice(6)] || BLANK}" data-media="${esc(src.slice(6))}"`
      : `src="${esc(src)}"`;
  }
  async function fillMedia(root) {
    root = root || document;
    const pending = () => [...root.querySelectorAll("img[data-media]")];
    const apply = () => pending().forEach((img) => {
      const url = mediaCache[img.dataset.media];
      if (url) { img.src = url; img.removeAttribute("data-media"); }
    });
    pending().forEach((img) => {
      const id = img.dataset.media;
      if (!mediaCache[id]) { try { const s = sessionStorage.getItem("rs-media-" + id); if (s) mediaCache[id] = s; } catch (e) { /* ignore */ } }
    });
    apply();
    const ids = [...new Set(pending().map((img) => img.dataset.media))];
    if (!ids.length) return;
    const db = await window.RS_DB;
    if (!db) return;
    await Promise.all(ids.map(async (id) => {
      try {
        const url = await db.getMedia(id);
        if (url) { mediaCache[id] = url; try { sessionStorage.setItem("rs-media-" + id, url); } catch (e) { /* full */ } }
      } catch (e) { /* missing photo */ }
    }));
    apply();
  }

  window.RS = { ICONS, waLink, esc, hydrate, toast, imgAttrs, fillMedia, mediaCache };

  document.addEventListener("DOMContentLoaded", () => {
    hydrate(document);
    initMenu();
    initHeader();
    initReveal();
  });
})();
