/**
 * Noyau partagé, chargé AVANT les vues et app.js :
 * registre des vues + thèmes + accès API + états vides.
 */
"use strict";

/**
 * Thème unique : charte ENSIA v2 « Encre et laiton », déclinaison nuit
 * (variables CSS sur :root dans style.css). L'API Theme est conservée pour
 * les appelants (app.js) mais ne fait plus que poser data-theme="ensia".
 */
const Theme = (() => {
  const ENSIA = Object.freeze({ id: "ensia", label: "Ensia" });

  function current() {
    return ENSIA;
  }

  function setMode(_themeId) {
    return ENSIA;
  }

  function cycle() {
    return ENSIA;
  }

  /** Applique le thème (identique pour toutes les vues). */
  function applyFor(_view) {
    document.documentElement.dataset.theme = ENSIA.id;
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
