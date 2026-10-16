/**
 * Page « Course » : séance Kotcha saisie au tactile (footing / sortie longue),
 * analyse locale + boucle à pied depuis la maison, QR code vers Google Maps.
 * Backend : POST /api/run/plan (scripts/run_plan.py) ; dernier plan relu dans
 * /api/data/run_plan au chargement. Carte : Leaflet local + fonds CARTO.
 */
"use strict";

(() => {
  const { escapeHtml, segmented, settle } = UI;

  const KIND_OPTIONS = [
    { id: "footing", label: "Footing" },
    { id: "sortie_longue", label: "Sortie longue" },
  ];
  const MODE_OPTIONS = [
    { id: "duration", label: "Durée" },
    { id: "distance", label: "Distance" },
  ];
  const DEFAULTS = Object.freeze({
    footing: { minutes: 45, km: 8, pace: 360 },
    sortie_longue: { minutes: 90, km: 15, pace: 380 },
  });
  const STEP = { minutes: 5, km: 0.5, pace: 5 };
  const LIMITS = { minutes: [10, 300], km: [1, 45], pace: [180, 600] };
  const REPEAT_DELAY_MS = 420;
  const REPEAT_EVERY_MS = 90;
  /* Tuiles OSM standard (gratuites, sans clé), passées en monochrome par CSS. */
  const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const TILE_ATTRIBUTION = "© OpenStreetMap";
  const PREFS_KEY = "pi-tracker-run";
  const REFRESH_MS = 10 * 60_000;  // kiosque allumé des jours : séances et boucle du jour relues

  const $ = (id) => document.getElementById(id);

  let state = {
    kind: "footing",
    mode: "duration",
    values: { footing: { ...DEFAULTS.footing }, sortie_longue: { ...DEFAULTS.sortie_longue } },
    seed: 0,
    plan: null,
    kotcha: [],          // séances Kotcha lues dans Garmin Connect (garmin_workouts.py)
    garminAuth: false,   // dernière collecte Garmin refusée : jetons à refaire
    autoApplied: "",     // séance du jour déjà recopiée dans la saisie
    busy: false,
    error: "",
  };
  const map = { instance: null, tiles: null, layers: [] };

  /* ------------------------------------------------------------ utils */

  const paceText = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const kmText = (km) => km.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const durationText = (minutes) => (minutes >= 60
    ? `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, "0")}`
    : `${Math.round(minutes)} min`);

  function current() {
    return state.values[state.kind];
  }

  /** Distance et durée déduites de la saisie (même calcul que le backend). */
  function derived() {
    const values = current();
    if (state.mode === "distance") return { km: values.km, minutes: Math.round((values.km * values.pace) / 60) };
    return { km: Math.round((values.minutes * 60 / values.pace) * 100) / 100, minutes: values.minutes };
  }

  function setState(patch) {
    state = { ...state, ...patch };
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ kind: state.kind, mode: state.mode, values: state.values }));
    } catch (error) { /* stockage indisponible : préférences non mémorisées */ }
  }

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (!saved || !saved.values) return;
      const kind = DEFAULTS[saved.kind] ? saved.kind : "footing";
      const mode = saved.mode === "distance" ? "distance" : "duration";
      const values = {
        footing: { ...DEFAULTS.footing, ...saved.values.footing },
        sortie_longue: { ...DEFAULTS.sortie_longue, ...saved.values.sortie_longue },
      };
      setState({ kind, mode, values });
    } catch (error) { /* préférences illisibles : valeurs par défaut */ }
  }

  /* ------------------------------------------- séance Kotcha (Garmin) */

  const LOOP_KINDS = ["footing", "sortie_longue"];
  const STEP_ROUND = { km: 0.1, pace: 5 };

  function localToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  /** Séance du jour, sinon la prochaine. */
  function nextKotcha() {
    const today = localToday();
    return state.kotcha.find((workout) => workout.date >= today) || null;
  }

  function kotchaDay(dateKey) {
    if (dateKey === localToday()) return "Aujourd'hui";
    return new Date(`${dateKey}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" });
  }

  function kotchaBanner() {
    const workout = nextKotcha();
    if (!workout) return "";
    const facts = [
      workout.distance_km ? `${kmText(workout.distance_km)} km` : "",
      workout.duration_min ? durationText(workout.duration_min) : "",
      workout.pace_s ? `${paceText(workout.pace_s)}/km` : "",
    ].filter(Boolean).join(" · ");
    const usable = LOOP_KINDS.includes(workout.kind) && workout.distance_km;
    const action = usable
      ? '<button type="button" class="btn-ghost is-pressable" data-run="use-kotcha">Utiliser pour la séance Kotcha</button>'
      : `<span class="sub">${workout.kind === "fractionne" ? "Au stade" : ""}</span>`;
    return `<div class="kotcha-banner">
      <div class="kotcha-text">
        <span class="label label-accent">Kotcha · ${escapeHtml(kotchaDay(workout.date))}</span>
        <span class="kotcha-title">${escapeHtml(workout.title)}</span>
        <span class="sub">${escapeHtml(facts)}</span>
      </div>
      ${action}
    </div>`;
  }

  /** Recopie la séance Kotcha dans la saisie (mode distance, allure arrondie à 5 s). */
  function applyKotcha(workout) {
    if (!workout || !LOOP_KINDS.includes(workout.kind) || !workout.distance_km) return;
    const values = state.values[workout.kind];
    const km = Math.round(workout.distance_km / STEP_ROUND.km) * STEP_ROUND.km;
    const pace = workout.pace_s ? Math.round(workout.pace_s / STEP_ROUND.pace) * STEP_ROUND.pace : values.pace;
    setState({
      kind: workout.kind,
      mode: "distance",
      values: { ...state.values, [workout.kind]: { ...values, km: Number(km.toFixed(1)), pace } },
    });
  }

  /* -------------------------------------------------------- saisie */

  function stepper(field, display, unit, label) {
    return `<div class="stepper-row">
      <span class="label">${label}</span>
      <div class="stepper">
        <button type="button" class="step-btn is-pressable" data-step="${field}" data-dir="-1" aria-label="Moins">−</button>
        <div class="stepper-value"><span class="num">${display}</span><small>${unit}</small></div>
        <button type="button" class="step-btn is-pressable" data-step="${field}" data-dir="1" aria-label="Plus">+</button>
      </div>
    </div>`;
  }

  function renderSession() {
    const values = current();
    const { km, minutes } = derived();
    const main = state.mode === "distance"
      ? stepper("km", kmText(values.km), "km", "Distance")
      : stepper("minutes", String(values.minutes), "min", "Durée");
    const result = state.mode === "distance" ? `≈ ${durationText(minutes)}` : `≈ ${kmText(km)} km`;
    const button = state.busy ? "Calcul de la boucle…" : "Tracer la boucle";
    $("run-session").innerHTML = `
      <div class="card-head"><span class="label">Séance Kotcha</span>${state.garminAuth
        ? '<span class="stale">Garmin à reconnecter</span>' : ""}</div>
      ${kotchaBanner()}
      <div class="run-segs">
        ${segmented("run-kind", KIND_OPTIONS, state.kind, "run-kind")}
        ${segmented("run-mode", MODE_OPTIONS, state.mode, "run-mode")}
      </div>
      ${main}
      ${stepper("pace", paceText(values.pace), "/km", "Allure")}
      <div class="run-result"><span class="mid num">${result}</span></div>
      ${state.error ? `<p class="run-error">${escapeHtml(state.error)}</p>` : ""}
      <button type="button" class="btn-primary is-pressable" data-run="plan" ${state.busy ? "disabled" : ""}>${button}</button>`;
    settle($("run-session"));
  }

  function step(field, direction) {
    const [low, high] = LIMITS[field];
    const values = current();
    const next = Math.min(high, Math.max(low, values[field] + direction * STEP[field]));
    if (next === values[field]) return false;
    setState({ values: { ...state.values, [state.kind]: { ...values, [field]: next } } });
    savePrefs();
    renderSession();
    return true;
  }

  /** Appui long sur −/+ : la valeur défile. */
  function setupSteppers(root) {
    let timer = null;
    const stop = () => {
      clearTimeout(timer);
      timer = null;
    };
    root.addEventListener("pointerdown", (event) => {
      const button = event.target.closest("[data-step]");
      if (!button) return;
      const { step: field, dir } = button.dataset;
      if (!step(field, Number(dir))) return;
      const repeat = () => {
        if (step(field, Number(dir))) timer = setTimeout(repeat, REPEAT_EVERY_MS);
      };
      timer = setTimeout(repeat, REPEAT_DELAY_MS);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => root.addEventListener(type, stop));
  }

  /* ---------------------------------------------------------- carte */

  function ensureMap() {
    if (map.instance || !window.L) return map.instance;
    const host = $("run-map-canvas");
    if (!host) return null;
    map.instance = L.map(host, { zoomControl: false, attributionControl: true });
    map.tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map.instance);
    map.instance.attributionControl.setPrefix(false);
    return map.instance;
  }

  function drawRoute(plan) {
    const instance = ensureMap();
    if (!instance) return;
    map.layers.forEach((layer) => layer.remove());
    const styles = getComputedStyle(document.documentElement);
    const route = styles.getPropertyValue("--route").trim() || "#0071e3";
    const ink = styles.getPropertyValue("--ink").trim() || "#1d1d1f";
    const home = [plan.home.lat, plan.home.lon];
    const halo = L.polyline(plan.route.coords, { color: route, weight: 10, opacity: 0.18, interactive: false });
    const line = L.polyline(plan.route.coords, { color: route, weight: 4, opacity: 1, lineJoin: "round", interactive: false });
    const start = L.circleMarker(home, { radius: 7, color: "#fff", weight: 3, fillColor: ink, fillOpacity: 1, interactive: false });
    map.layers = [halo, line, start].map((layer) => layer.addTo(instance));
    instance.invalidateSize();
    instance.fitBounds(line.getBounds(), { padding: [28, 28] });
  }

  function renderMap() {
    const plan = state.plan;
    const card = $("run-map");
    if (!plan) {
      card.innerHTML = `<div class="card-head"><span class="label">Boucle</span></div>
        <p class="empty">Règle ta séance puis « Tracer la boucle » : un parcours de la bonne distance,
        au départ de chez toi, s'affichera ici.</p>`;
      map.instance = null;
      return;
    }
    if (!$("run-map-canvas")) {
      card.innerHTML = `<div class="run-map-canvas" id="run-map-canvas"></div>
        <div class="run-map-badge"><span class="label">Boucle</span>
          <span class="mid num">${kmText(plan.route.distance_m / 1000)}<small>km</small></span></div>`;
      map.instance = null;
    } else {
      card.querySelector(".run-map-badge .mid").innerHTML =
        `${kmText(plan.route.distance_m / 1000)}<small>km</small>`;
    }
    drawRoute(plan);
  }

  /* -------------------------------------------------- analyse et QR */

  function renderNotes() {
    const plan = state.plan;
    const items = plan
      ? plan.analysis.map((note) => `<li class="note note-${escapeHtml(note.tone)}">${escapeHtml(note.text)}</li>`).join("")
      : '<li class="note note-info">L\'analyse tient compte de ta récupération WHOOP et de la météo.</li>';
    $("run-notes").innerHTML = `<div class="card-head"><span class="label">Analyse</span></div>
      <ul class="notes">${items}</ul>`;
  }

  function renderQr() {
    const plan = state.plan;
    if (!plan) {
      $("run-qr").innerHTML = `<div class="card-head"><span class="label">Google Maps</span></div>
        <p class="empty">Le QR code de l'itinéraire apparaîtra ici.</p>`;
      return;
    }
    /* qr_svg est produit par notre serveur (segno), pas une saisie externe. */
    $("run-qr").innerHTML = `<div class="card-head"><span class="label">Google Maps</span>
        <button type="button" class="btn-ghost is-pressable" data-run="reroll" ${state.busy ? "disabled" : ""}>Autre boucle</button></div>
      <div class="qr-wrap">
        <div class="qr">${plan.qr_svg}</div>
        <p class="sub">Scanne avec ton téléphone : l'itinéraire s'ouvre en mode piéton.</p>
      </div>`;
  }

  function renderAll() {
    renderSession();
    renderMap();
    renderNotes();
    renderQr();
    const label = state.plan ? state.plan.home.label : "";
    $("run-meta").textContent = label ? `Départ · ${label}` : "Saisie de la séance Kotcha";
  }

  /* ------------------------------------------------------- serveur */

  async function requestPlan(seed) {
    const values = current();
    setState({ busy: true, error: "", seed });
    renderSession();
    renderQr();
    try {
      const response = await fetch("/api/run/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: state.kind, mode: state.mode, seed,
          minutes: values.minutes, km: values.km, pace_s: values.pace,
        }),
      });
      const payload = await response.json();
      if (!payload.success) throw new Error(payload.error || "Erreur inconnue");
      setState({ plan: payload.data, busy: false });
    } catch (error) {
      setState({ busy: false, error: error.message || "Serveur local injoignable" });
    }
    renderAll();
  }

  async function loadKotcha() {
    try {
      const [workouts, sources] = await Promise.all(["kotcha_workouts", "sources_status"].map(
        (category) => fetch(`/api/data/${category}`, { cache: "no-store" }).then((response) => response.json())));
      if (workouts.success) setState({ kotcha: workouts.data.entries || [] });
      const garmin = sources.success && (sources.data.sources || {}).kotcha_workouts;
      setState({ garminAuth: Boolean(garmin && garmin.needs_auth) });
    } catch (error) {
      console.warn("Séances Kotcha illisibles :", error);
    }
  }

  /** Séance du jour importée : la saisie se pré-remplit toute seule, une fois. */
  function applyTodaysKotcha() {
    const today = nextKotcha();
    if (!today || today.date !== localToday()) return;
    const key = `${today.date}|${today.title}`;
    if (key === state.autoApplied) return;
    applyKotcha(today);
    setState({ autoApplied: key });
  }

  async function refresh() {
    if (state.busy) return;
    const snapshot = () => JSON.stringify([state.plan && state.plan.timestamp, state.kotcha,
      state.garminAuth, state.kind, state.mode, state.values]);
    const before = snapshot();
    await Promise.all([loadLastPlan(), loadKotcha()]);
    applyTodaysKotcha();
    if (snapshot() !== before) renderAll();
  }

  async function loadLastPlan() {
    try {
      const response = await fetch("/api/data/run_plan", { cache: "no-store" });
      const payload = await response.json();
      const last = payload.success ? (payload.data.entries || []).at(-1) : null;
      if (last) setState({ plan: last, seed: last.seed || 0 });
    } catch (error) {
      console.warn("Dernier plan de course illisible :", error);
    }
  }

  /* ---------------------------------------------------------- init */

  function onClick(event) {
    const seg = event.target.closest("[data-seg^='run-']");
    if (seg) {
      const { seg: group, value } = seg.dataset;
      if (group === "run-kind" && value !== state.kind) setState({ kind: value });
      if (group === "run-mode" && value !== state.mode) setState({ mode: value });
      savePrefs();
      renderSession();
      return;
    }
    const action = event.target.closest("[data-run]");
    if (!action || state.busy) return;
    if (action.dataset.run === "use-kotcha") {
      applyKotcha(nextKotcha());
      savePrefs();
      renderSession();
      return;
    }
    if (action.dataset.run === "plan") requestPlan(0);
    if (action.dataset.run === "reroll") requestPlan(state.seed + 1);
  }

  function watchTheme() {
    /* Les tuiles suivent le thème en CSS ; seules les couleurs du tracé sont relues. */
    new MutationObserver(() => {
      if (state.plan && map.instance) drawRoute(state.plan);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  async function init() {
    const page = document.querySelector(".page-run");
    if (!page) return;
    loadPrefs();
    page.addEventListener("click", onClick);
    setupSteppers(page);
    watchTheme();
    window.addEventListener("resize", () => {
      if (map.instance && state.plan) drawRoute(state.plan);
    });
    renderAll();
    await Promise.all([loadLastPlan(), loadKotcha()]);
    applyTodaysKotcha();
    renderAll();
    setInterval(refresh, REFRESH_MS);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
