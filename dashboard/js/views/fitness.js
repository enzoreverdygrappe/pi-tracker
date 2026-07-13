/**
 * Vue "Fitness" — placeholder V1.
 * Brancher plus tard : scripts/fitness.py -> data/fitness.json -> fetchCategory("fitness").
 */
"use strict";

(() => {
  async function render(container) {
    container.innerHTML = '<div class="view-title"><em>Fitness</em> · Suivi</div>';
    renderEmptyState(container.appendChild(document.createElement("div")), {
      glyph: "◇",
      message: "Vue à venir — créer scripts/fitness.py et data/fitness.json.",
    });
  }

  Views.register({ id: "fitness", label: "Fitness", icon: "◉", render });
})();
