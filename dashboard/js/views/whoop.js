/**
 * Vue "Whoop" : reprend les codes de l'app WHOOP — anneaux Sommeil /
 * Récupération / Effort, tuiles métriques, historique en barres.
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

  /** "22:52 → 08:58 · 9,8 h" pour la dernière nuit connue. */
  function lastNightMeta(last) {
    const start = hourOf(last.sleep_start);
    const end = hourOf(last.sleep_end);
    const hours = typeof last.sleep_hours === "number"
      ? `${last.sleep_hours.toLocaleString("fr-FR")} h` : "";
    if (!start || !end) return hours;
    return `${start} → ${end}${hours ? " · " + hours : ""}`;
  }

  function renderMetricTiles(last) {
    return `
      <div class="stat-row quad">
        <div class="stat-tile">
          <div class="stat-label">Calories</div>
          <div class="stat-value">${fmt(last.calories_kcal)}<small>kcal</small></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">RHR</div>
          <div class="stat-value">${fmt(last.rhr_bpm)}<small>bpm</small></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">HRV</div>
          <div class="stat-value">${fmt(last.hrv_ms)}<small>ms</small></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">SpO2</div>
          <div class="stat-value">${fmt(last.spo2_pct)}<small>%</small></div>
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

  function formatUpdateTime(isoTimestamp) {
    if (!isoTimestamp) return "";
    return new Date(isoTimestamp).toLocaleTimeString("fr-FR",
      { hour: "2-digit", minute: "2-digit" });
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

    const entries = result.data.entries;
    const last = entries[entries.length - 1];

    container.innerHTML = `
      <div class="view-header">
        <div class="view-title"><em>Whoop</em><span class="sep">/</span>Aujourd'hui</div>
        <div class="live-pill">
          <span class="live-dot"></span>
          <span>maj ${formatUpdateTime(result.data.updated_at)}</span>
        </div>
      </div>
      <div class="ring-row" id="whoop-rings"></div>
      ${renderMetricTiles(last)}
      <div class="section">
        ${sectionHeader("01", "Récupération", `${CHART_DAYS} derniers jours · %`)}
        <div id="whoop-recovery-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("02", "Sommeil", lastNightMeta(last) || `${CHART_DAYS} derniers jours`)}
        <div id="whoop-sleep-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("03", "Effort", `${CHART_DAYS} derniers jours · échelle 0-21`)}
        <div id="whoop-strain-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("04", "Derniers jours", `${Math.min(entries.length, RECENT_DAYS)} / ${entries.length}`)}
        ${renderDayLedger(entries)}
      </div>`;

    const rings = document.getElementById("whoop-rings");
    Charts.ring(rings, {
      value: last.sleep_performance_pct, maxValue: 100,
      display: fmt(last.sleep_performance_pct, "%"),
      label: "Sommeil", color: "var(--metric-sleep)",
    });
    Charts.ring(rings, {
      value: last.recovery_pct, maxValue: 100,
      display: fmt(last.recovery_pct, "%"),
      label: "Récupération", color: recoveryColor(last.recovery_pct),
    });
    Charts.ring(rings, {
      value: last.strain, maxValue: STRAIN_SCALE_MAX,
      display: typeof last.strain === "number"
        ? last.strain.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        : "—",
      label: "Effort", color: "var(--metric-strain)",
    });

    Charts.bars(document.getElementById("whoop-recovery-chart"),
      dailySeries(entries, "recovery_pct", CHART_DAYS),
      { unit: "%", ariaLabel: "Récupération WHOOP par jour" });
    Charts.bars(document.getElementById("whoop-sleep-chart"),
      dailySeries(entries, "sleep_hours", CHART_DAYS),
      { unit: "h", ariaLabel: "Heures de sommeil par jour" });
    Charts.bars(document.getElementById("whoop-strain-chart"),
      dailySeries(entries, "strain", CHART_DAYS),
      { unit: "", ariaLabel: "Effort par jour" });
  }

  Views.register({ id: "whoop", label: "Whoop", icon: "◉", brandTheme: "whoop", render });
})();
