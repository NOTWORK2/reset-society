/* Background music with a SOUND ON / SOUND OFF button for visitors.
 * The track is set in the admin (Settings → Background music): a YouTube link, an audio link or an uploaded file.
 * Browsers only allow sound after the visitor interacts, so music starts when they tap the button
 * (or, if they turned it on before, at their first tap anywhere on the page). */
(function () {
  const L = window.RS_I18N;
  const tr = L.t;
  const KEY = "rs-sound", POS = "rs-music-pos";

  let cfg = null, btn = null, audio = null, yt = null, playing = false, starting = false, srcKey = "";
  const wantOn = () => { try { return localStorage.getItem(KEY) === "on"; } catch (e) { return false; } };
  const remember = (on) => { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* ignore */ } };

  /* ---------- button ---------- */
  function build() {
    btn = document.createElement("button");
    btn.className = "sound-btn";
    btn.type = "button";
    btn.innerHTML = '<span class="bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="sound-label"></span>';
    btn.addEventListener("click", () => (playing ? stop() : start(true)));
    document.body.appendChild(btn);
    render();
  }
  function render() {
    if (!btn) return;
    btn.classList.toggle("is-on", playing);
    btn.classList.toggle("is-loading", starting);
    btn.querySelector(".sound-label").textContent = tr(playing ? "sound.on" : "sound.off");
    btn.setAttribute("aria-pressed", String(playing));
    btn.setAttribute("aria-label", tr(playing ? "sound.turnOff" : "sound.turnOn"));
  }
  function setPlaying(on) { playing = on; starting = false; render(); }

  /* ---------- resume position across pages ---------- */
  function savePos(t) { try { sessionStorage.setItem(POS, JSON.stringify({ k: srcKey, t })); } catch (e) { /* ignore */ } }
  function loadPos() { try { const p = JSON.parse(sessionStorage.getItem(POS)); return p && p.k === srcKey ? p.t : 0; } catch (e) { return 0; } }

  /* ---------- <audio> source (uploaded file or direct link) ---------- */
  async function audioSrc() {
    if (cfg.type === "url") return cfg.url;
    const db = await window.RS_DB;
    return db ? db.getAudioUrl(cfg.fileId) : null;
  }
  async function startAudio() {
    if (!audio) {
      const src = await audioSrc();
      if (!src) throw new Error("no source");
      audio = new Audio(src);
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = (cfg.volume ?? 40) / 100;
      const t = loadPos();
      if (t) audio.currentTime = t;
      let last = 0;
      audio.addEventListener("timeupdate", () => { if (audio.currentTime - last > 2) { last = audio.currentTime; savePos(last); } });
      audio.addEventListener("play", () => setPlaying(true));
      audio.addEventListener("pause", () => setPlaying(false));
    }
    await audio.play();
  }

  /* ---------- YouTube source (hidden player) ----------
     The player is created as soon as the page loads, so that a tap on the button can call
     playVideo() immediately: browsers only let an embedded player start with sound during a tap. */
  let ytReady = false, ytWaiters = [];
  function ytId(url) {
    const m = String(url || "").match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function loadYT() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = reject;
      document.head.appendChild(s);
      setTimeout(() => reject(new Error("youtube timeout")), 15000);
    });
  }
  async function prepareYT() {
    const id = ytId(cfg.url);
    if (!id) return;
    try { await loadYT(); } catch (e) { return; }
    const host = document.createElement("div");
    host.className = "yt-hidden";
    host.innerHTML = '<div id="rsYt"></div>';
    document.body.appendChild(host);
    yt = new YT.Player("rsYt", {
      videoId: id, width: 1, height: 1,
      playerVars: { autoplay: 0, controls: 0, loop: 1, playlist: id, playsinline: 1, rel: 0, disablekb: 1 },
      events: {
        onReady: () => {
          ytReady = true;
          yt.setVolume(cfg.volume ?? 40);
          const t = loadPos(); if (t) yt.seekTo(t, true);
          if (wantOn()) start(false);
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) { setPlaying(true); ytWaiters.splice(0).forEach((w) => w.resolve()); }
          else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) setPlaying(false);
        },
        onError: () => { setPlaying(false); ytWaiters.splice(0).forEach((w) => w.reject(new Error("youtube error"))); }
      }
    });
    setInterval(() => { if (yt && playing && yt.getCurrentTime) savePos(yt.getCurrentTime()); }, 3000);
  }
  function startYT() {
    if (!yt || !ytReady) return Promise.reject(new Error("youtube not ready"));
    yt.playVideo(); // synchronous, still inside the visitor's tap
    return new Promise((resolve, reject) => {
      ytWaiters.push({ resolve, reject });
      setTimeout(() => { const i = ytWaiters.findIndex((w) => w.resolve === resolve); if (i >= 0) { ytWaiters.splice(i, 1); reject(new Error("youtube blocked")); } }, 6000);
    });
  }

  /* ---------- controls ---------- */
  async function start(fromClick) {
    if (playing || starting) return;
    starting = true; render();
    try {
      if (cfg.type === "youtube") await startYT(); else await startAudio();
      if (fromClick) remember(true);
    } catch (e) {
      starting = false; render();
      // Autoplay blocked (no interaction yet): play at the first tap anywhere.
      if (!fromClick) armFirstInteraction();
      else if (window.RS && RS.toast) RS.toast(tr("sound.failed"));
    }
  }
  function stop() {
    if (cfg.type === "youtube") { if (yt) yt.pauseVideo(); } else if (audio) audio.pause();
    setPlaying(false);
    remember(false);
  }
  let armed = false;
  function armFirstInteraction() {
    if (armed) return;
    armed = true;
    const once = () => { ["pointerdown", "keydown", "touchstart"].forEach((ev) => document.removeEventListener(ev, once, true)); armed = false; start(false); };
    ["pointerdown", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, once, true));
  }

  /* ---------- start-up ---------- */
  async function init() {
    await window.RS_SITE;
    const C = window.RS_CONFIG;
    cfg = C.music;
    const hasSource = cfg && cfg.enabled && ((cfg.type === "youtube" && ytId(cfg.url)) || (cfg.type === "url" && cfg.url) || (cfg.type === "file" && cfg.fileId));
    if (!hasSource) return;
    srcKey = cfg.type + ":" + (cfg.url || cfg.fileId);
    build();
    if (cfg.type === "youtube") prepareYT(); // starts itself when ready if the visitor had sound on
    else if (wantOn()) start(false);
    document.addEventListener("visibilitychange", () => { if (document.hidden && playing) { if (audio) savePos(audio.currentTime); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
