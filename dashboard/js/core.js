/**
 * Noyau partagé, chargé AVANT les vues et app.js :
 * registre des vues + thèmes + accès API + états vides.
 */
"use strict";

/**
 * Thèmes : charte ENSIA v2 « Encre et laiton », deux déclinaisons
 * (variables CSS via data-theme sur <html>, voir style.css) :
 * - "ensia" : nuit, défaut kiosque ;
 * - "ensia-light" : papier / encre.
 * Choix, par priorité : localStorage (choix utilisateur) > ?theme=<id> dans
 * l'URL (défaut kiosque / test, non persisté) > prefers-color-scheme: light >
 * nuit en dernier recours. Le choix stocké prime sur l'URL pour que la bascule
 * tactile survive aux reboots du kiosque (qui repasse ?theme=ensia).
 */
const Theme = (() => {
  const DARK_ID = "ensia";
  const LIGHT_ID = "ensia-light";
  const THEMES = Object.freeze({
    [DARK_ID]: Object.freeze({ id: DARK_ID, label: "Ensia nuit" }),
    [LIGHT_ID]: Object.freeze({ id: LIGHT_ID, label: "Ensia papier" }),
  });
  const STORAGE_KEY = "tracker-theme";

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return null; /* kiosque sans stockage : on retombe sur le défaut */
    }
  }

  function persist(themeId) {
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch (error) {
      /* Stockage indisponible : le choix ne survivra pas au rechargement. */
    }
  }

  function prefersLight() {
    try {
      return window.matchMedia("(prefers-color-scheme: light)").matches;
    } catch (error) {
      return false;
    }
  }

  function initialId() {
    const stored = readStored();
    if (stored && THEMES[stored]) return stored;
    try {
      const requested = new URLSearchParams(window.location.search).get("theme");
      if (requested && THEMES[requested]) return requested;
    } catch (error) {
      /* URL illisible : on continue avec les autres sources. */
    }
    if (prefersLight()) return LIGHT_ID;
    return DARK_ID;
  }

  let activeId = initialId();

  function apply() {
    document.documentElement.dataset.theme = activeId;
  }

  function current() {
    return THEMES[activeId];
  }

  /** Active un thème par id, le persiste et l'applique ; ignore un id inconnu. */
  function setMode(themeId) {
    if (!THEMES[themeId]) return THEMES[activeId];
    activeId = themeId;
    persist(themeId);
    apply();
    return THEMES[activeId];
  }

  /** Bascule nuit <-> papier. */
  function cycle() {
    return setMode(activeId === DARK_ID ? LIGHT_ID : DARK_ID);
  }

  /** Applique le thème courant (identique pour toutes les vues). */
  function applyFor(_view) {
    apply();
  }

  return { current, setMode, cycle, applyFor };
})();

/* Applique le thème avant le premier rendu (évite le flash). */
Theme.applyFor(null);

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
 * (badge laiton) quand les données dépassent maxAgeHours : un indicateur
 * visible vaut mieux qu'un affichage muet de données périmées.
 */
function updatedPill(isoTimestamp, maxAgeHours = 6) {
  const age = dataAgeHours(isoTimestamp);
  const time = isoTimestamp
    ? new Date(isoTimestamp).toLocaleTimeString("fr-FR",
        { hour: "2-digit", minute: "2-digit" })
    : "--";
  const isStale = age !== null && age > maxAgeHours;
  const label = isStale ? `non à jour · ${formatAge(age)}` : `maj ${time}`;
  return `<div class="live-pill${isStale ? " is-stale" : ""}">
      <span class="live-dot"></span>
      <span>${label}</span>
    </div>`;
}
