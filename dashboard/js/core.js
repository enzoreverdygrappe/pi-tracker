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
  const THEMES = [
    { id: "esnia", label: "Esnia" },
    { id: "data", label: "Data" },
    { id: "terminal", label: "Terminal" },
    { id: "hud", label: "HUD" },
    { id: "receipt", label: "Receipt" },
    { id: "brutalist", label: "Brutal" },
  ];
  const STORAGE_KEY = "tracker-theme";

  function current() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.find((theme) => theme.id === saved) || THEMES[0];
  }

  function apply(themeId) {
    const theme = THEMES.find((entry) => entry.id === themeId) || THEMES[0];
    document.documentElement.dataset.theme = theme.id;
    try {
      localStorage.setItem(STORAGE_KEY, theme.id);
    } catch (error) {
      console.error("Persistance du thème impossible :", error);
    }
    return theme;
  }

  function cycle() {
    const index = THEMES.findIndex((theme) => theme.id === current().id);
    return apply(THEMES[(index + 1) % THEMES.length].id);
  }

  return { current, apply, cycle };
})();

/* Applique le thème avant le premier rendu (évite le flash).
   ?theme=<id> dans l'URL force un thème (test/preview). */
Theme.apply(new URLSearchParams(location.search).get("theme") || Theme.current().id);

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
