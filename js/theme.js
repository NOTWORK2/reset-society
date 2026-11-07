/* Light / dark mode.
 * Loaded in <head> so the right colors apply before the page paints.
 * Follows the device setting until the visitor taps the moon/sun button; that choice is remembered.
 */
(function () {
  const KEY = "rs-theme";
  const root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let pref = null;
  try { pref = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }

  const current = () => (pref === "dark" || pref === "light" ? pref : (mq && mq.matches ? "dark" : "light"));

  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>';

  function paint() {
    const theme = current();
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (!meta.dataset.light) meta.dataset.light = meta.content;
      meta.content = theme === "dark" ? "#1c1612" : meta.dataset.light;
    }
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      const dark = theme === "dark";
      b.innerHTML = dark ? SUN : MOON;
      const t = window.RS_I18N ? window.RS_I18N.t : null;
      const label = t ? t(dark ? "theme.light" : "theme.dark") : (dark ? "Switch to light mode" : "Switch to dark mode");
      b.setAttribute("aria-label", label);
      b.title = label;
      b.setAttribute("aria-pressed", String(dark));
    });
  }

  paint();
  if (mq) {
    const onChange = () => { if (!pref) paint(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
  }

  window.RS_THEME = {
    get: current,
    toggle() {
      pref = current() === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, pref); } catch (e) { /* ignore */ }
      paint();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      b.addEventListener("click", (e) => { e.preventDefault(); window.RS_THEME.toggle(); });
    });
    paint();
  });
})();
