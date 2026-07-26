/**
 * Noyau partagé, chargé AVANT les vues et app.js :
 * registre des vues + thèmes + accès API + états vides.
 */
"use strict";

/**
 * Thèmes d'affichage, inspirés des explorations claude-usage-widget.
 * Un thème = un bloc de variables CSS sur :root[data-theme="..."].
 */
const Theme = (() => {
  /* "brand" = chaque vue dans l'identité de sa marque (Claude -> claude.ai,
     Whoop -> app WHOOP…) ; les autres modes forcent un thème global. */
  const THEMES = [
    { id: "brand", label: "Brand" },
    { id: "onyx", label: "Onyx" },
    { id: "data", label: "Data" },
    { id: "terminal", label: "Terminal" },
    { id: "hud", label: "HUD" },
    { id: "receipt", label: "Receipt" },
    { id: "brutalist", label: "Brutal" },
  ];
  const STORAGE_KEY = "tracker-theme-v2";
  const DEFAULT_BRAND_THEME = "onyx";

  function find(themeId) {
    return THEMES.find((theme) => theme.id === themeId);
  }

  function current() {
    return find(localStorage.getItem(STORAGE_KEY)) || THEMES[0];
  }

  function setMode(themeId) {
    const theme = find(themeId) || THEMES[0];
    try {
      localStorage.setItem(STORAGE_KEY, theme.id);
    } catch (error) {
      console.error("Persistance du thème impossible :", error);
    }
    return theme;
  }

  function cycle() {
    const index = THEMES.findIndex((theme) => theme.id === current().id);
    return setMode(THEMES[(index + 1) % THEMES.length].id);
  }

  /** Applique le thème effectif pour une vue (résout le mode "brand"). */
  function applyFor(view) {
    const mode = current();
    document.documentElement.dataset.theme = mode.id === "brand"
      ? (view && view.brandTheme) || DEFAULT_BRAND_THEME
      : mode.id;
  }

  return { current, setMode, cycle, applyFor };
})();

/* Applique le thème avant le premier rendu (évite le flash).
   ?theme=<id> dans l'URL force un mode (test/preview). */
(() => {
  const requested = new URLSearchParams(location.search).get("theme");
  if (requested) Theme.setMode(requested);
  Theme.applyFor(null);
})();

const Views = (() => {
  const registered = [];
  return {
    register(view) {
      if (!view || !view.id || typeof view.render !== "function") {
        console.error("Vue invalide ignorée :", view);
        return;
      }
      registered.push(Object.freeze({ ...view }));
    },
    all() { return [...registered]; },
  };
})();

/** Récupère une catégorie de données ; retourne {success, data, error}. */
async function fetchCategory(category) {
  try {
    const response = await fetch(`/api/data/${encodeURIComponent(category)}`);
    const payload = await response.json();
    if (!payload.success) {
      return { success: false, data: null, error: payload.error || "Erreur inconnue" };
    }
    return payload;
  } catch (error) {
    return { success: false, data: null, error: "Serveur local injoignable" };
  }
}

function renderEmptyState(container, { glyph, message, hint }) {
  container.innerHTML = `
    <div class="empty-state">
      <span class="glyph">${glyph}</span>
      <p>${message}</p>
      ${hint ? `<code>${hint}</code>` : ""}
    </div>`;
}

/** Âge des données en heures depuis un timestamp ISO ; null si absent/invalide. */
function dataAgeHours(isoTimestamp) {
  if (!isoTimestamp) return null;
  const ageMs = Date.now() - new Date(isoTimestamp).getTime();
  if (Number.isNaN(ageMs)) return null;
  return ageMs / 3_600_000;
}

/** Âge lisible : "12 min" / "5 h" / "3 j". */
function formatAge(hours) {
  if (hours >= 48) return `${Math.floor(hours / 24)} j`;
  if (hours >= 1) return `${Math.floor(hours)} h`;
  return `${Math.max(1, Math.floor(hours * 60))} min`;
}

/**
 * Pastille "maj HH:MM" pour l'en-tête d'une vue. Passe en état "non à jour"
 * (badge ambre) quand les données dépassent maxAgeHours — un indicateur
 * visible vaut mieux qu'un affichage muet de données périmées.
 */
function updatedPill(isoTimestamp, maxAgeHours = 6) {
  const age = dataAgeHours(isoTimestamp);
  const time = isoTimestamp
    ? new Date(isoTimestamp).toLocaleTimeString("fr-FR",
        { hour: "2-digit", minute: "2-digit" })
    : "—";
  const isStale = age !== null && age > maxAgeHours;
  const label = isStale ? `non à jour · ${formatAge(age)}` : `maj ${time}`;
  return `<div class="live-pill${isStale ? " is-stale" : ""}">
      <span class="live-dot"></span>
      <span>${label}</span>
    </div>`;
}
