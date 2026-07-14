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
  let activeView = null;

  function activateView(view, { force = false } = {}) {
    if (activeView && view.id === activeView.id && !force) return;
    activeView = view;

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

  function setupThemeButton() {
    const button = document.getElementById("theme-button");
    const label = document.getElementById("theme-label");
    label.textContent = Theme.current().label;
    button.addEventListener("pointerdown", () => {
      label.textContent = Theme.cycle().label;
      /* Re-rendu : les couleurs inline (heatmap) suivent le nouveau thème. */
      if (activeView) activateView(activeView, { force: true });
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
    setupThemeButton();
    startClock();
    /* ?view=<id> dans l'URL choisit la vue initiale (deep-link kiosque/test). */
    const requested = new URLSearchParams(location.search).get("view");
    activateView(views.find((view) => view.id === requested) || views[0]);
  });
})();
