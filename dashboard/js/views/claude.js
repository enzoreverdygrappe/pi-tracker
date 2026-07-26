/**
 * Vue "Claude" : limites de plan + usage réel de Claude Code
 * (coût équivalent API, tokens, modèles, top projets — données locales
 * agrégées par scripts/claude_stats.py, porté de claude-usage-widget).
 */
"use strict";

(() => {
  const CHART_DAYS = 14;
  const HEATMAP_WEEKS = 52;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HIGH_UTILIZATION_PCT = 80;

  /* ---------------------------------------------------------------- utils */

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

  function fmtTokens(count) {
    if (typeof count !== "number") return "—";
    if (count >= 1_000_000) return `${(count / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M`;
    if (count >= 1_000) return `${(count / 1_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
    return String(count);
  }

  function fmtUsd(value) {
    if (typeof value !== "number") return "—";
    return `$${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`;
  }

  /** "claude-fable-5" -> "Fable 5". */
  function modelLabel(modelId) {
    return modelId
      .replace(/^claude-/, "")
      .replace(/-\d{8}$/, "")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
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

  /* ------------------------------------------------------ limites de plan */

  function formatRemaining(resetsAt) {
    const remaining = new Date(resetsAt).getTime() - Date.now();
    if (!resetsAt || Number.isNaN(remaining) || remaining <= 0) return "";
    const minutes = Math.round(remaining / 60000);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
      : `${minutes}m`;
  }

  function formatResetDay(resetsAt) {
    const date = new Date(resetsAt);
    if (!resetsAt || Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("fr-FR",
      { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }

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
          <div class="limit-fill" style="transform:scaleX(${Math.min(100, Math.max(0, pct)) / 100})"></div>
        </div>
      </div>`;
  }

  function renderLimits(limitsResult) {
    const entries = limitsResult.success ? (limitsResult.data.entries || []) : [];
    const snapshot = entries[entries.length - 1];
    const meta = snapshot ? `maj ${formatUpdateTime(snapshot.timestamp)}` : "";

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
        limitBar("Hebdo", formatResetDay(snapshot.weekly.resets_at),
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

  /* ------------------------------------------------------------ usage réel */

  function todayEntry(entries) {
    const key = new Date().toISOString().slice(0, 10);
    return entries.find((entry) => entry.date === key) || null;
  }

  function renderStats(today) {
    return `
      <div class="stat-row">
        <div class="stat-tile accent">
          <div class="stat-label">Coût · aujourd'hui</div>
          <div class="stat-value">${fmtUsd(today ? today.cost_usd : 0)}</div>
          <div class="stat-sub">cache : ${fmtUsd(today ? today.cache_saved_usd : 0)} économisés</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Messages</div>
          <div class="stat-value">${today ? today.messages.toLocaleString("fr-FR") : 0}</div>
          <div class="stat-sub">aujourd'hui</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Tokens out</div>
          <div class="stat-value">${fmtTokens(today ? today.output_tokens : 0)}</div>
          <div class="stat-sub">aujourd'hui</div>
        </div>
      </div>`;
  }

  function dailySeries(entries, field, days) {
    const byDate = new Map(entries.map((entry) => [entry.date, entry]));
    const today = new Date();
    return Array.from({ length: days }, (_, offset) => {
      const date = new Date(today.getTime() - (days - 1 - offset) * DAY_MS);
      const key = date.toISOString().slice(0, 10);
      const value = byDate.get(key) ? byDate.get(key)[field] : 0;
      return {
        label: date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
        value: typeof value === "number" ? Math.round(value * 100) / 100 : 0,
      };
    });
  }

  function renderModelLedger(todayModels) {
    const models = Object.entries(todayModels || {})
      .sort((a, b) => b[1].cost_usd - a[1].cost_usd);
    if (models.length === 0) return "";
    const items = models.map(([model, bucket], index) => `<li>
        <span class="row-num">${String(index + 1).padStart(2, "0")}</span>
        <span class="row-note">${escapeHtml(modelLabel(model))}</span>
        <span class="row-date">${fmtTokens(bucket.output_tokens)} out</span>
        <span class="leader"></span>
        <span class="row-value">${fmtUsd(bucket.cost_usd)}</span>
      </li>`).join("");
    return `<div class="section">
      ${sectionHeader("04", "Modèles · aujourd'hui", "équivalent pay-as-you-go")}
      <ul class="ledger">${items}</ul>
    </div>`;
  }

  function renderProjectLedger(projects) {
    if (!projects || projects.length === 0) return "";
    const items = projects.map((project, index) => `<li>
        <span class="row-num">${String(index + 1).padStart(2, "0")}</span>
        <span class="row-note">${escapeHtml(project.name)}</span>
        <span class="leader"></span>
        <span class="row-value">${fmtTokens(project.output_tokens)}</span>
      </li>`).join("");
    return `<div class="section">
      ${sectionHeader("05", "Top projets · aujourd'hui", "tokens out")}
      <ul class="ledger">${items}</ul>
    </div>`;
  }

  /* ---------------------------------------------------------------- rendu */

  async function render(container) {
    const [statsResult, limitsResult] = await Promise.all([
      fetchCategory("claude_stats"),
      fetchCategory("claude_limits"),
    ]);

    if (!statsResult.success || (statsResult.data.entries || []).length === 0) {
      renderEmptyState(container, {
        glyph: "✳",
        message: "Pas encore de statistiques d'usage Claude Code.",
        hint: "python3 scripts/claude_stats.py collect",
      });
      return;
    }

    const entries = statsResult.data.entries;
    const today = todayEntry(entries);

    container.innerHTML = `
      <div class="view-header">
        <div class="view-title"><span class="brand-logo logo-claude"></span><em>Claude</em><span class="sep">/</span>Usage</div>
        ${updatedPill(statsResult.data.updated_at, 24)}
      </div>
      ${renderLimits(limitsResult)}
      ${renderStats(today)}
      <div class="section">
        ${sectionHeader("02", "Coût par jour", `${CHART_DAYS} derniers jours · $ équiv. API`)}
        <div id="claude-cost-chart"></div>
      </div>
      <div class="section">
        ${sectionHeader("03", "Calendrier", `${HEATMAP_WEEKS} semaines · messages/jour`)}
        <div id="claude-heatmap"></div>
      </div>
      ${renderModelLedger(statsResult.data.today_models)}
      ${renderProjectLedger(statsResult.data.today_projects)}`;

    Charts.bars(
      document.getElementById("claude-cost-chart"),
      dailySeries(entries, "cost_usd", CHART_DAYS),
      { unit: "$", ariaLabel: "Coût équivalent API par jour" }
    );
    Charts.heatmap(
      document.getElementById("claude-heatmap"),
      new Map(entries.map((entry) => [entry.date, entry.messages || 0])),
      { weeks: HEATMAP_WEEKS, unit: "messages", ariaLabel: "Messages Claude Code par jour" }
    );
  }

  Views.register({
    id: "claude", label: "Claude",
    icon: '<span class="brand-logo logo-claude"></span>',
    brandTheme: "claude", render,
  });
})();
