/**
 * Vue "Whoop" : reprend les codes de l'app WHOOP — navigation par jour,
 * anneaux Sommeil / Récupération / Effort, tuiles métriques, historique.
 * Chaque jour affiche SES données (pas de mélange entre jours) ; le cycle
 * du jour en cours est signalé tant que WHOOP ne l'a pas clôturé.
 * Données : data/whoop.json (scripts/whoop.py collect) via /api/data/whoop.
 */
"use strict";

(() => {
  const CHART_DAYS = 14;
  const RECENT_DAYS = 6;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const STRAIN_SCALE_MAX = 21;
  const RECOVERY_GREEN_MIN = 67;
  const RECOVERY_YELLOW_MIN = 34;

  /* État de navigation : jeu de données + index du jour sélectionné. */
  const state = { entries: [], updatedAt: "", index: -1 };

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /** Série des N derniers jours pour un champ (jours absents = 0). */
  function dailySeries(entries, field, days) {
    const byDate = new Map(entries.map((entry) => [entry.date, entry]));
    const today = new Date();
    return Array.from({ length: days }, (_, offset) => {
      const date = new Date(today.getTime() - (days - 1 - offset) * DAY_MS);
      const key = date.toISOString().slice(0, 10);
      const value = byDate.get(key) ? byDate.get(key)[field] : null;
      return {
        label: date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        value: typeof value === "number" ? value : 0,
      };
    });
  }

  function fmt(value, suffix = "") {
    return (value === null || value === undefined) ? "—" : `${value}${suffix}`;
  }

  /** Couleur de l'anneau récupération par zone, comme dans l'app WHOOP. */
  function recoveryColor(pct) {
    if (typeof pct !== "number") return "var(--track)";
    if (pct >= RECOVERY_GREEN_MIN) return "var(--status-good)";
    if (pct >= RECOVERY_YELLOW_MIN) return "var(--status-warn)";
    return "var(--status-bad)";
  }

  function hourOf(isoTimestamp) {
    const date = new Date(isoTimestamp);
    if (!isoTimestamp || Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  /** "22:52 → 08:58 · 9,8 h" pour la nuit du jour sélectionné. */
  function nightMeta(entry) {
    const start = hourOf(entry.sleep_start);
    const end = hourOf(entry.sleep_end);
    const hours = typeof entry.sleep_hours === "number"
      ? `${entry.sleep_hours.toLocaleString("fr-FR")} h` : "";
    if (!start || !end) return hours;
    return `${start} → ${end}${hours ? " · " + hours : ""}`;
  }

  function dayLabel(dateKey) {
    if (dateKey === todayKey()) return "Aujourd'hui";
    return new Date(`${dateKey}T12:00:00`).toLocaleDateString("fr-FR",
      { weekday: "short", day: "numeric", month: "short" });
  }

  /** Le cycle WHOOP du jour courant n'est clos qu'en fin de journée. */
  function isPendingCycle(entry) {
    return entry.date === todayKey()
      && (entry.strain === null || entry.strain === undefined);
  }

  function renderDayNav(entry) {
    const pending = isPendingCycle(entry) ? " · cycle en cours" : "";
    const atStart = state.index <= 0;
    const atEnd = state.index >= state.entries.length - 1;
    return `
      <div class="day-nav">
        <button type="button" class="nav-arrow" data-nav="-1"
          ${atStart ? "disabled" : ""} aria-label="Jour précédent">‹</button>
        <span class="day-label">${dayLabel(entry.date)}${pending}</span>
        <button type="button" class="nav-arrow" data-nav="1"
          ${atEnd ? "disabled" : ""} aria-label="Jour suivant">›</button>
      </div>`;
  }

  function renderMetricTiles(entry) {
    return `
      <div class="stat-row duo">
        <div class="stat-tile">
          <div class="stat-label">Calories</div>
          <div class="stat-value">${fmt(entry.calories_kcal)}<small>kcal</small></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">FC repos</div>
          <div class="stat-value">${fmt(entry.rhr_bpm)}<small>bpm</small></div>
        </div>
      </div>`;
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

  function renderDayLedger(entries) {
    const items = [...entries]
      .slice(-RECENT_DAYS)
      .reverse()
      .map((entry, index) => {
        const date = new Date(`${entry.date}T12:00:00`).toLocaleDateString("fr-FR",
          { weekday: "short", day: "2-digit", month: "2-digit" });
        const summary = `récup ${fmt(entry.recovery_pct, "%")} · ` +
          `sommeil ${fmt(entry.sleep_hours, "h")} · effort ${fmt(entry.strain)}`;
        return `<li>
          <span class="row-num">${String(index + 1).padStart(2, "0")}</span>
          <span class="row-date">${date}</span>
          <span class="row-note">${summary}</span>
          <span class="leader"></span>
          <span class="row-value">${fmt(entry.calories_kcal, " kcal")}</span>
        </li>`;
      })
      .join("");
    return `<ul class="ledger">${items}</ul>`;
  }

  function drawRings(entry) {
    const rings = document.getElementById("whoop-rings");
    Charts.ring(rings, {
      value: entry.sleep_performance_pct, maxValue: 100,
      display: fmt(entry.sleep_performance_pct, "%"),
      label: "Sommeil", color: "var(--metric-sleep)",
    });
    Charts.ring(rings, {
      value: entry.recovery_pct, maxValue: 100,
      display: fmt(entry.recovery_pct, "%"),
      label: "Récupération", color: recoveryColor(entry.recovery_pct),
    });
    Charts.ring(rings, {
      value: entry.strain, maxValue: STRAIN_SCALE_MAX,
      display: typeof entry.strain === "number"
        ? entry.strain.toLocaleString("fr-FR",
            { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        : "—",
      label: "Effort", color: "var(--metric-strain)",
    });
  }

  function renderMain(container) {
    const entries = state.entries;
    const entry = entries[state.index];

    container.innerHTML = `
      <div class="view-header">
        <div class="view-title"><span class="brand-logo logo-whoop"></span><em>Whoop</em><span class="sep">/</span>Journal</div>
        ${updatedPill(state.updatedAt, 6)}
      </div>
      ${renderDayNav(entry)}
      <div class="ring-row" id="whoop-rings"></div>
      ${renderMetricTiles(entry)}
      <div class="section">
        ${sectionHeader("01", "Sommeil de la nuit", nightMeta(entry) || "pas de nuit enregistrée")}
        <div id="whoop-sleep-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("02", "Récupération", `${CHART_DAYS} derniers jours · %`)}
        <div id="whoop-recovery-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("03", "Effort", `${CHART_DAYS} derniers jours · échelle 0-21`)}
        <div id="whoop-strain-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("04", "Derniers jours", `${Math.min(entries.length, RECENT_DAYS)} / ${entries.length}`)}
        ${renderDayLedger(entries)}
      </div>`;

    container.querySelectorAll(".nav-arrow").forEach((button) => {
      button.addEventListener("pointerdown", () => {
        const nextIndex = state.index + Number(button.dataset.nav);
        if (nextIndex < 0 || nextIndex >= entries.length) return;
        state.index = nextIndex;
        renderMain(container);
        container.scrollTop = 0;
      });
    });

    drawRings(entry);
    Charts.bars(document.getElementById("whoop-sleep-chart"),
      dailySeries(entries, "sleep_hours", CHART_DAYS),
      { unit: "h", ariaLabel: "Heures de sommeil par jour" });
    Charts.bars(document.getElementById("whoop-recovery-chart"),
      dailySeries(entries, "recovery_pct", CHART_DAYS),
      { unit: "%", ariaLabel: "Récupération WHOOP par jour" });
    Charts.bars(document.getElementById("whoop-strain-chart"),
      dailySeries(entries, "strain", CHART_DAYS),
      { unit: "", ariaLabel: "Effort par jour" });
  }

  async function render(container) {
    const result = await fetchCategory("whoop");

    if (!result.success || (result.data.entries || []).length === 0) {
      renderEmptyState(container, {
        glyph: "◉",
        message: result.success
          ? "Aucune donnée WHOOP pour l'instant."
          : result.error,
        hint: "python3 scripts/whoop.py auth  puis  python3 scripts/whoop.py collect",
      });
      return;
    }

    state.entries = result.data.entries;
    state.updatedAt = result.data.updated_at;
    state.index = state.entries.length - 1;
    renderMain(container);
  }

  Views.register({
    id: "whoop", label: "Whoop",
    icon: '<span class="brand-logo logo-whoop"></span>',
    brandTheme: "whoop", render,
  });
})();
