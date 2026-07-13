/**
 * Vue "Claude Usage" : sessions API Anthropic dans le temps.
 * Données : data/claude_usage.json via /api/data/claude_usage.
 */
"use strict";

(() => {
  const CHART_DAYS = 14;
  const RECENT_SESSIONS = 6;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function dayKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function shortDayLabel(date) {
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  }

  /** Agrège les appels par jour sur les N derniers jours (jours vides = 0). */
  function aggregateCallsPerDay(entries, days) {
    const callsByDay = entries.reduce((acc, entry) => {
      const key = String(entry.timestamp).slice(0, 10);
      return { ...acc, [key]: (acc[key] || 0) + (Number(entry.calls) || 0) };
    }, {});

    const today = new Date();
    return Array.from({ length: days }, (_, offset) => {
      const date = new Date(today.getTime() - (days - 1 - offset) * DAY_MS);
      return { label: shortDayLabel(date), value: callsByDay[dayKey(date)] || 0 };
    });
  }

  function computeStats(entries) {
    const weekAgo = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const callsLast7Days = entries
      .filter((entry) => String(entry.timestamp) >= weekAgo)
      .reduce((sum, entry) => sum + (Number(entry.calls) || 0), 0);
    const last = entries[entries.length - 1];
    const lastDate = last
      ? new Date(last.timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
      : "—";
    return { totalSessions: entries.length, callsLast7Days, lastDate };
  }

  function renderStats(stats) {
    return `
      <div class="stat-row">
        <div class="stat-tile accent">
          <div class="stat-label">Sessions totales</div>
          <div class="stat-value">${stats.totalSessions}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Appels · 7 jours</div>
          <div class="stat-value">${stats.callsLast7Days}<small>appels</small></div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Dernière session</div>
          <div class="stat-value">${stats.lastDate}</div>
        </div>
      </div>`;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  function renderSessionList(entries) {
    const items = [...entries]
      .slice(-RECENT_SESSIONS)
      .reverse()
      .map((entry) => {
        const date = new Date(entry.timestamp).toLocaleString("fr-FR",
          { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `<li>
          <span class="session-date">${date}</span>
          <span class="session-calls">${Number(entry.calls) || 0} appels</span>
          <span class="session-note">${escapeHtml(entry.note || "")}</span>
        </li>`;
      })
      .join("");
    return `<ul class="session-list">${items}</ul>`;
  }

  async function render(container) {
    const result = await fetchCategory("claude_usage");

    if (!result.success) {
      renderEmptyState(container, {
        glyph: "◈", message: result.error,
        hint: "python3 server.py",
      });
      return;
    }

    const entries = result.data.entries || [];
    if (entries.length === 0) {
      renderEmptyState(container, {
        glyph: "◇", message: "Aucune session enregistrée pour l'instant.",
        hint: 'python3 scripts/claude_usage.py add --calls 12 --note "Ma session"',
      });
      return;
    }

    container.innerHTML = `
      <div class="view-title"><em>Claude</em> · Usage API</div>
      ${renderStats(computeStats(entries))}
      <div class="panel">
        <div class="panel-title">Appels par jour · ${CHART_DAYS} derniers jours</div>
        <div id="claude-chart"></div>
      </div>
      <div class="panel">
        <div class="panel-title">Sessions récentes</div>
        ${renderSessionList(entries)}
      </div>`;

    Charts.line(
      document.getElementById("claude-chart"),
      aggregateCallsPerDay(entries, CHART_DAYS),
      { unit: "appels", ariaLabel: "Appels API Claude par jour" }
    );
  }

  Views.register({ id: "claude", label: "Claude", icon: "◆", render });
})();
