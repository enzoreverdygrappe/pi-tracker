/**
 * Bootstrap du dashboard : navigation tactile entre onglets + horloge.
 *
 * Ajouter une vue = créer js/views/<nom>.js qui appelle Views.register({...})
 * (défini dans core.js) et référencer le script dans index.html AVANT app.js.
 */
"use strict";

(() => {
  const container = document.getElementById("view-container");
  const tabBar = document.getElementById("tab-bar");
  let activeViewId = null;

  function activateView(view) {
    if (view.id === activeViewId) return;
    activeViewId = view.id;

    tabBar.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.viewId === view.id);
    });

    container.textContent = "";
    container.scrollTop = 0;
    view.render(container).catch((error) => {
      console.error(`Rendu de la vue ${view.id} échoué :`, error);
      renderEmptyState(container, {
        glyph: "◈",
        message: "Impossible d'afficher cette vue.",
        hint: String(error),
      });
    });
  }

  function buildTabBar(views) {
    views.forEach((view) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab-button";
      button.dataset.viewId = view.id;
      button.innerHTML =
        `<span class="tab-icon">${view.icon}</span><span>${view.label}</span>`;
      button.addEventListener("pointerdown", () => activateView(view));
      tabBar.appendChild(button);
    });
  }

  function startClock() {
    const timeNode = document.getElementById("clock-time");
    const dateNode = document.getElementById("clock-date");
    const update = () => {
      const now = new Date();
      timeNode.textContent = now.toLocaleTimeString("fr-FR",
        { hour: "2-digit", minute: "2-digit" });
      dateNode.textContent = now.toLocaleDateString("fr-FR",
        { weekday: "short", day: "numeric", month: "short" });
    };
    update();
    setInterval(update, 30_000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const views = Views.all();
    if (views.length === 0) {
      renderEmptyState(container, { glyph: "◈", message: "Aucune vue enregistrée." });
      return;
    }
    buildTabBar(views);
    startClock();
    activateView(views[0]);
  });
})();
