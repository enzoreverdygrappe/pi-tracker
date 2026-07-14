/**
 * Vue "Crypto" — placeholder V1.
 * Brancher plus tard : scripts/crypto.py -> data/crypto.json -> fetchCategory("crypto").
 */
"use strict";

(() => {
  async function render(container) {
    container.innerHTML = '<div class="view-title"><em>Crypto</em> · Portfolio</div>';
    renderEmptyState(container.appendChild(document.createElement("div")), {
      glyph: "◇",
      message: "Vue à venir — créer scripts/crypto.py et data/crypto.json.",
    });
  }

  Views.register({ id: "crypto", label: "Crypto", icon: "◈", brandTheme: "esnia", render });
})();
