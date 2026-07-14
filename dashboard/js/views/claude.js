/**
 * Vue "Claude Usage" : sessions API Anthropic dans le temps.
 * Données : data/claude_usage.json via /api/data/claude_usage.
 * Mise en page façon rapport : sections numérotées [01]..[03].
 */
"use strict";

(() => {
  const CHART_DAYS = 14;
  const HEATMAP_WEEKS = 52;
  const RECENT_SESSIONS = 6;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function dayKey(date) {
    return date.toISOString().slice(0, 10);
  }

  /** Total des appels par jour : Map "YYYY-MM-DD" -> nombre. */
  function callsByDay(entries) {
    return entries.reduce((map, entry) => {
      const key = String(entry.timestamp).slice(0, 10);
      return new Map(map).set(key, (map.get(key) || 0) + (Number(entry.calls) || 0));
    }, new Map());
  }

  /** Série quotidienne des N derniers jours (jours vides = 0). */
  function dailySeries(byDay, days) {
    const today = new Date();
    return Array.from({ length: days }, (_, offset) => {
      const date = new Date(today.getTime() - (days - 1 - offset) * DAY_MS);
      return {
        label: date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        value: byDay.get(dayKey(date)) || 0,
      };
    });
  }

  function computeStats(entries) {
    const weekAgo = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const callsLast7Days = entries
      .filter((entry) => String(entry.timestamp) >= weekAgo)
      .reduce((sum, entry) => sum + (Number(entry.calls) || 0), 0);
    const totalCalls = entries
      .reduce((sum, entry) => sum + (Number(entry.calls) || 0), 0);
    const last = entries[entries.length - 1];
    return {
      totalSessions: entries.length,
      totalCalls,
      callsLast7Days,
      lastDate: last
        ? new Date(last.timestamp).toLocaleDateString("fr-FR",
            { day: "numeric", month: "short" })
        : "—",
      lastTime: last
        ? new Date(last.timestamp).toLocaleTimeString("fr-FR",
            { hour: "2-digit", minute: "2-digit" })
        : "",
    };
  }

  function renderStats(stats) {
    return `
      <div class="stat-row">
        <div class="stat-tile accent">
          <div class="stat-label">Sessions</div>
          <div class="stat-value">${stats.totalSessions}</div>
          <div class="stat-sub">${stats.totalCalls} appels au total</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Appels · 7 jours</div>
          <div class="stat-value">${stats.callsLast7Days}<small>appels</small></div>
          <div class="stat-sub">semaine glissante</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Dernière session</div>
          <div class="stat-value">${stats.lastDate}</div>
          <div class="stat-sub">${stats.lastTime}</div>
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

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  function renderSessionLedger(entries) {
    const items = [...entries]
      .slice(-RECENT_SESSIONS)
      .reverse()
      .map((entry, index) => {
        const date = new Date(entry.timestamp).toLocaleString("fr-FR",
          { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        return `<li>
          <span class="row-num">${String(index + 1).padStart(2, "0")}</span>
          <span class="row-date">${date}</span>
          <span class="row-note">${escapeHtml(entry.note || "—")}</span>
          <span class="leader"></span>
          <span class="row-value">${Number(entry.calls) || 0}</span>
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

  /** Temps restant avant reset : "4h 36m" / "12m" ; vide si passé/invalide. */
  function formatRemaining(resetsAt) {
    const remaining = new Date(resetsAt).getTime() - Date.now();
    if (!resetsAt || Number.isNaN(remaining) || remaining <= 0) return "";
    const minutes = Math.round(remaining / 60000);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
      : `${minutes}m`;
  }

  /** Échéance de reset hebdo : "lun. 12:00" ; vide si invalide. */
  function formatResetDay(resetsAt) {
    const date = new Date(resetsAt);
    if (!resetsAt || Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("fr-FR",
      { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }

  const HIGH_UTILIZATION_PCT = 80;

  function limitBar(name, meta, pct) {
    const rounded = Math.round(pct);
    const highClass = rounded >= HIGH_UTILIZATION_PCT ? " is-high" : "";
    return `
      <div class="limit-row${highClass}">
        <div class="limit-head">
          <span class="limit-name">${name}</span>
          <span class="limit-meta">${meta}<b>${rounded}%</b></span>
        </div>
        <div class="limit-track">
          <div class="limit-fill" style="width:${Math.min(100, Math.max(0, pct))}%"></div>
        </div>
      </div>`;
  }

  /** Section barres de limites ; snapshot = dernière entrée de claude_limits. */
  function renderLimits(limitsResult) {
    const entries = limitsResult.success ? (limitsResult.data.entries || []) : [];
    const snapshot = entries[entries.length - 1];
    const meta = snapshot
      ? `maj ${formatUpdateTime(snapshot.timestamp)}`
      : "";

    let body;
    if (!snapshot) {
      body = `<div class="limit-hint">Pas encore de données —
        lancer <code>python3 scripts/claude_limits.py collect</code>
        sur la machine connectée à Claude Code.</div>`;
    } else {
      const scoped = snapshot.scoped;
      body = [
        limitBar("Session", formatRemaining(snapshot.session.resets_at),
          snapshot.session.pct),
        limitBar("Weekly", formatResetDay(snapshot.weekly.resets_at),
          snapshot.weekly.pct),
        scoped ? limitBar(escapeHtml(scoped.label),
          formatResetDay(scoped.resets_at), scoped.pct) : "",
      ].join("");
    }

    return `<div class="section">
      ${sectionHeader("01", "Limites du plan", meta)}
      ${body}
    </div>`;
  }

  async function render(container) {
    const [result, limitsResult] = await Promise.all([
      fetchCategory("claude_usage"),
      fetchCategory("claude_limits"),
    ]);

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
      <div class="view-header">
        <div class="view-title"><em>Claude</em><span class="sep">/</span>Usage API</div>
        <div class="live-pill">
          <span class="live-dot"></span>
          <span>maj ${formatUpdateTime(result.data.updated_at)}</span>
        </div>
      </div>
      ${renderLimits(limitsResult)}
      ${renderStats(computeStats(entries))}
      <div class="section">
        ${sectionHeader("02", "Activité", `${CHART_DAYS} derniers jours · appels/jour`)}
        <div id="claude-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("03", "Calendrier", `${HEATMAP_WEEKS} semaines`)}
        <div id="claude-heatmap"></div>
      </div>
      <div class="section">
        ${sectionHeader("04", "Sessions récentes", `${Math.min(entries.length, RECENT_SESSIONS)} / ${entries.length}`)}
        ${renderSessionLedger(entries)}
      </div>`;

    const byDay = callsByDay(entries);
    Charts.bars(
      document.getElementById("claude-chart"),
      dailySeries(byDay, CHART_DAYS),
      { unit: "appels", ariaLabel: "Appels API Claude par jour" }
    );
    Charts.heatmap(
      document.getElementById("claude-heatmap"),
      byDay,
      { weeks: HEATMAP_WEEKS, unit: "appels", ariaLabel: "Calendrier des appels API Claude" }
    );
  }

  Views.register({ id: "claude", label: "Claude", icon: "◆", brandTheme: "claude", render });
})();
