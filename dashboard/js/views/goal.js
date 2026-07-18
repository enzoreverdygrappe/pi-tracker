/**
 * Vue "Goal" : objectif financier — porté de money-mission-terminal.
 * Progression, rythme/jour, projection, et ajout de revenus au doigt
 * (numpad tactile -> POST /api/goal/add).
 */
"use strict";

(() => {
  function fmtMoney(value, currency) {
    if (typeof value !== "number") return "—";
    return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${currency}`;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  function formatUpdateTime(isoTimestamp) {
    if (!isoTimestamp) return "";
    return new Date(isoTimestamp).toLocaleTimeString("fr-FR",
      { hour: "2-digit", minute: "2-digit" });
  }

  function sectionHeader(num, name, meta) {
    return `
      <div class="section-title">
        <span class="section-num">[${num}]</span>
        <span class="section-name">${name}</span>
        <span class="leader"></span>
        ${meta ? `<span class="section-meta">${meta}</span>` : ""}
      </div>`;
  }

  function renderHero(summary) {
    const { stats, config } = summary;
    return `
      <div class="section">
        <div class="goal-hero">
          <div class="goal-pct">${stats.progress_pct.toLocaleString("fr-FR")}%</div>
          <div class="goal-hero-body">
            <div class="goal-amounts">
              <b>${fmtMoney(stats.total, config.currency)}</b>
              <span class="goal-target">/ ${fmtMoney(config.amount, config.currency)}
                · ${config.goal_date}</span>
            </div>
            <div class="limit-track goal-bar">
              <div class="limit-fill" style="width:${Math.min(100, stats.progress_pct)}%"></div>
            </div>
          </div>
          <button type="button" id="goal-add-btn" class="goal-add-btn">+ Ajouter</button>
        </div>
      </div>`;
  }

  function renderStats(summary) {
    const { stats, config } = summary;
    const projectionClass = stats.is_on_track ? "temp-warm" : "";
    return `
      <div class="stat-row">
        <div class="stat-tile accent">
          <div class="stat-label">Aujourd'hui</div>
          <div class="stat-value">${fmtMoney(stats.today, config.currency)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Restant</div>
          <div class="stat-value">${fmtMoney(stats.remaining, config.currency)}</div>
          <div class="stat-sub">${stats.days_left} jours restants</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Rythme</div>
          <div class="stat-value">${fmtMoney(stats.pace_per_day, config.currency)}<small>/jour</small></div>
          <div class="stat-sub ${projectionClass}">projection ${fmtMoney(stats.projected_end, config.currency)}</div>
        </div>
      </div>`;
  }

  function renderEntries(summary) {
    if (!summary.recent.length) {
      return `<div class="section">
        ${sectionHeader("02", "Dernières entrées", "")}
        <div class="limit-hint">Aucune entrée — le bouton + Ajouter, ou
        <code>python3 scripts/goal.py add --amount 150 --note "..."</code></div>
      </div>`;
    }
    const items = [...summary.recent].reverse().map((entry, index) => {
      const date = new Date(entry.timestamp).toLocaleString("fr-FR",
        { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      return `<li>
        <span class="row-num">${String(index + 1).padStart(2, "0")}</span>
        <span class="row-date">${date}</span>
        <span class="row-note">${escapeHtml(entry.note || "—")}</span>
        <span class="leader"></span>
        <span class="row-value">+${fmtMoney(entry.amount, summary.config.currency)}</span>
      </li>`;
    }).join("");
    return `<div class="section">
      ${sectionHeader("02", "Dernières entrées",
        `${summary.recent.length} / ${summary.count}`)}
      <ul class="ledger">${items}</ul>
    </div>`;
  }

  /* ------------------------------------------------------- numpad tactile */

  function openNumpad(onSubmit) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="numpad">
        <div class="numpad-display" id="numpad-display">0</div>
        <div class="numpad-grid">
          ${[7, 8, 9, 4, 5, 6, 1, 2, 3].map((digit) =>
            `<button type="button" data-key="${digit}">${digit}</button>`).join("")}
          <button type="button" data-key=".">,</button>
          <button type="button" data-key="0">0</button>
          <button type="button" data-key="back">⌫</button>
        </div>
        <div class="numpad-actions">
          <button type="button" class="numpad-cancel" data-key="cancel">Annuler</button>
          <button type="button" class="numpad-ok" data-key="ok">Valider</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const display = overlay.querySelector("#numpad-display");
    let value = "";

    function refresh() {
      display.textContent = value || "0";
    }

    overlay.addEventListener("pointerdown", (event) => {
      const key = event.target.dataset ? event.target.dataset.key : null;
      if (event.target === overlay || key === "cancel") {
        overlay.remove();
        return;
      }
      if (!key) return;
      if (key === "back") {
        value = value.slice(0, -1);
      } else if (key === "ok") {
        const amount = parseFloat(value);
        if (!Number.isNaN(amount) && amount > 0) {
          overlay.remove();
          onSubmit(amount);
        }
        return;
      } else if (key === ".") {
        if (!value.includes(".")) value = (value || "0") + ".";
      } else if (value.replace(".", "").length < 7) {
        value += key;
      }
      refresh();
    });
  }

  async function submitAmount(container, amount) {
    try {
      const response = await fetch("/api/goal/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, note: "" }),
      });
      const payload = await response.json();
      if (!payload.success) {
        console.error("Ajout refusé :", payload.error);
        return;
      }
    } catch (error) {
      console.error("Ajout impossible :", error);
      return;
    }
    render(container);
  }

  /* ---------------------------------------------------------------- rendu */

  async function render(container) {
    let payload;
    try {
      const response = await fetch("/api/goal/summary");
      payload = await response.json();
    } catch (error) {
      payload = { success: false, error: "Serveur local injoignable" };
    }

    if (!payload.success) {
      renderEmptyState(container, {
        glyph: "◎", message: payload.error, hint: "python3 server.py",
      });
      return;
    }

    const summary = payload.data;
    container.innerHTML = `
      <div class="view-header">
        <div class="view-title"><em>Goal</em><span class="sep">/</span>Mission</div>
        <div class="live-pill">
          <span class="live-dot"></span>
          <span>maj ${formatUpdateTime(summary.updated_at) || "—"}</span>
        </div>
      </div>
      ${renderHero(summary)}
      ${renderStats(summary)}
      ${renderEntries(summary)}`;

    container.querySelector("#goal-add-btn").addEventListener("pointerdown",
      () => openNumpad((amount) => submitAmount(container, amount)));
  }

  Views.register({ id: "goal", label: "Goal", icon: "◎", brandTheme: "terminal", render });
})();
