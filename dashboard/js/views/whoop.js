/**
 * Vue "Whoop" : récupération, sommeil et strain quotidiens.
 * Données : data/whoop.json (scripts/whoop.py collect) via /api/data/whoop.
 */
"use strict";

(() => {
  const CHART_DAYS = 14;
  const RECENT_DAYS = 6;
  const DAY_MS = 24 * 60 * 60 * 1000;

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

  function latestEntry(entries) {
    return entries[entries.length - 1];
  }

  function renderStats(last) {
    return `
      <div class="stat-row">
        <div class="stat-tile accent">
          <div class="stat-label">Récupération</div>
          <div class="stat-value">${fmt(last.recovery_pct, "%")}</div>
          <div class="stat-sub">${last.date}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">HRV</div>
          <div class="stat-value">${fmt(last.hrv_ms)}<small>ms</small></div>
          <div class="stat-sub">RHR ${fmt(last.rhr_bpm, " bpm")}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Sommeil</div>
          <div class="stat-value">${fmt(last.sleep_hours)}<small>h</small></div>
          <div class="stat-sub">perf ${fmt(last.sleep_performance_pct, "%")}</div>
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
          `sommeil ${fmt(entry.sleep_hours, "h")} · strain ${fmt(entry.strain)}`;
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
    const last = latestEntry(entries);

    container.innerHTML = `
      <div class="view-header">
        <div class="view-title"><em>Whoop</em><span class="sep">/</span>Récupération</div>
        <div class="live-pill">
          <span class="live-dot"></span>
          <span>maj ${formatUpdateTime(result.data.updated_at)}</span>
        </div>
      </div>
      ${renderStats(last)}
      <div class="section">
        ${sectionHeader("01", "Récupération", `${CHART_DAYS} derniers jours · %`)}
        <div id="whoop-recovery-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("02", "Sommeil", `${CHART_DAYS} derniers jours · heures`)}
        <div id="whoop-sleep-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("03", "Strain", `${CHART_DAYS} derniers jours · échelle 0-21`)}
        <div id="whoop-strain-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("04", "Derniers jours", `${Math.min(entries.length, RECENT_DAYS)} / ${entries.length}`)}
        ${renderDayLedger(entries)}
      </div>`;

    Charts.bars(document.getElementById("whoop-recovery-chart"),
      dailySeries(entries, "recovery_pct", CHART_DAYS),
      { unit: "%", ariaLabel: "Récupération WHOOP par jour" });
    Charts.bars(document.getElementById("whoop-sleep-chart"),
      dailySeries(entries, "sleep_hours", CHART_DAYS),
      { unit: "h", ariaLabel: "Heures de sommeil par jour" });
    Charts.bars(document.getElementById("whoop-strain-chart"),
      dailySeries(entries, "strain", CHART_DAYS),
      { unit: "", ariaLabel: "Strain par jour" });
  }

  Views.register({ id: "whoop", label: "Whoop", icon: "◉", render });
})();
