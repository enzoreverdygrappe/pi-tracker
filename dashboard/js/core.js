/**
 * Noyau partagé, chargé AVANT les vues et app.js :
 * registre des vues + accès API + états vides.
 */
"use strict";

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
