/**
 * pi-tracker · frontend kiosque (vanilla JS, aucune dépendance).
 *
 * 3 pages en défilement horizontal natif (scroll-snap) : Accueil, Santé, Claude API.
 * Données : GET /api/data/<catégorie> (backend Flask inchangé), polling léger ;
 * un widget n'est redessiné que si le updated_at de sa catégorie a changé.
 * Thème auto (clair le jour, sombre la nuit), veille après 2 min sans toucher,
 * repli .lite (sans flou) si le Pi descend sous ~40 fps.
 */
"use strict";

(() => {
  /* ------------------------------------------------------------ config */

  const POLL_MS = 60_000;
  const IDLE_MS = 120_000;
  const DAY_START_HOUR = 7;      // thème clair de 7 h…
  const NIGHT_START_HOUR = 20;   // …à 20 h
  const HOUR_MS = 3_600_000;
  const STRAIN_MAX = 21;
  const RECOVERY_MID = 34;
  const RECOVERY_HIGH = 67;
  const LIMIT_WARN_PCT = 90;           // limite du plan presque atteinte : jauge rouge
  const AGENDA_MAX_ITEMS = 5;
  const HEALTH_TREND_DAYS = 14;
  const DRAG_THRESHOLD_PX = 10;

  /* Âge maximal (heures) avant d'afficher « non à jour ». */
  const MAX_AGE_H = { claude_stats: 24, claude_limits: 2, whoop: 6, weather: 3, calendar: 3 };
  const CATEGORIES = Object.keys(MAX_AGE_H);
  const SOURCES_CATEGORY = "sources_status";

  const PERIODS = [
    { id: "day", label: "Jour" },
    { id: "week", label: "Semaine" },
    { id: "month", label: "Mois" },
  ];
  const HEALTH_METRICS = [
    { id: "recovery_pct", label: "Récup.", unit: "%" },
    { id: "sleep_hours", label: "Sommeil", unit: "h" },
    { id: "strain", label: "Effort", unit: "" },
  ];

  const state = {
    data: {},            // catégorie -> document JSON
    stamps: {},          // catégorie -> updated_at déjà rendu
    sources: {},         // catégorie -> dernier résultat de collecte (sources_status)
    claudePeriod: "week",
    healthMetric: "recovery_pct",
    page: 0,
  };

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------- utils */

  const { escapeHtml, isNum, FORMATS, counter, animateCounters, lineChart, ring, settle, meter, segmented } = UI;

  function localKey(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** Date à midi, n jours avant/après `from` (calcul calendaire, sûr aux changements d'heure). */
  function shiftDays(n, from = new Date()) {
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + n, 12);
  }

  const hhmm = (date) => date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  function dayName(dateKey) {
    const today = localKey(new Date());
    if (dateKey === today) return "Aujourd'hui";
    if (dateKey === localKey(shiftDays(-1))) return "Hier";
    return new Date(`${dateKey}T12:00:00`).toLocaleDateString("fr-FR",
      { weekday: "short", day: "numeric", month: "short" });
  }


  function fmtUsd(value) {
    if (!isNum(value)) return "--";
    return `$${value >= 100 ? FORMATS.usd0(value) : FORMATS.usd(value)}`;
  }

  function fmtTokens(count) {
    if (!isNum(count)) return "--";
    if (count >= 1e6) return `${(count / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
    if (count >= 1e3) return `${(count / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
    return String(count);
  }

  /** "claude-fable-5-1" -> "Fable 5.1". */
  function modelLabel(modelId) {
    const parts = String(modelId).replace(/^claude-/, "").replace(/-\d{8}$/, "").split("-");
    const name = parts.filter((part) => !/^\d+$/.test(part));
    const version = parts.filter((part) => /^\d+$/.test(part)).join(".");
    const title = name.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    return version ? `${title} ${version}` : title;
  }

  /** Durée lisible : "45 min", "5 h", "3 j". */
  function formatAge(hours) {
    if (hours >= 48) return `${Math.floor(hours / 24)} j`;
    if (hours >= 1) return `${Math.floor(hours)} h`;
    return `${Math.max(1, Math.floor(hours * 60))} min`;
  }

  function ageHours(iso) {
    const time = new Date(iso).getTime();
    return iso && !Number.isNaN(time) ? (Date.now() - time) / HOUR_MS : null;
  }

  /** Dernière collecte refusée faute de jeton valide : il faut relancer l'auth. */
  const needsAuth = (category) => Boolean(state.sources[category] && state.sources[category].needs_auth);

  /** En-tête de carte : label à gauche, puis « à reconnecter » ou « non à jour » si besoin. */
  function cardHead(label, category, extra = "") {
    const doc = state.data[category];
    const age = doc ? ageHours(doc.updated_at) : null;
    let status = extra;
    if (needsAuth(category)) status = '<span class="stale">à reconnecter</span>';
    else if (age !== null && age > MAX_AGE_H[category]) {
      status = `<span class="stale">non à jour · ${formatAge(age)}</span>`;
    }
    return `<div class="card-head"><span class="label">${label}</span>${status}</div>`;
  }

  function emptyCard(label, message, hint) {
    return `<div class="card-head"><span class="label">${label}</span></div>
      <p class="empty">${message}${hint ? `<code>${escapeHtml(hint)}</code>` : ""}</p>`;
  }

  function paint(id, html) {
    const node = $(id);
    if (!node) return;
    node.innerHTML = html;
    animateCounters(node);
    settle(node);
  }

  /* ------------------------------------------------------- séries data */

  /** N jours se terminant le jour de endDate (défaut : aujourd'hui) ; jours absents = 0. */
  function dailySeries(entries, field, days, labelOf, endDate = new Date()) {
    const byDate = new Map(entries.map((entry) => [entry.date, entry]));
    return Array.from({ length: days }, (_, offset) => {
      const date = shiftDays(offset - (days - 1), endDate);
      const entry = byDate.get(localKey(date));
      return { label: labelOf(date), value: entry && isNum(entry[field]) ? entry[field] : 0 };
    });
  }

  /** 24 dernières heures glissantes, heure locale. */
  function hourlySeries(hourly) {
    const byHour = new Map((hourly || []).map((item) => [new Date(item.hour).getTime(), item]));
    const current = new Date();
    current.setMinutes(0, 0, 0);
    return Array.from({ length: 24 }, (_, offset) => {
      const time = current.getTime() - (23 - offset) * HOUR_MS;
      const item = byHour.get(time);
      return { label: `${new Date(time).getHours()}h`, value: item ? item.cost_usd : 0 };
    });
  }

  function claudeSeries(period) {
    const doc = state.data.claude_stats;
    const entries = doc ? doc.entries || [] : [];
    if (period === "day") return { series: hourlySeries(doc && doc.hourly), tickEvery: 6 };
    if (period === "week") {
      const weekday = (date) => date.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
      return { series: dailySeries(entries, "cost_usd", 7, weekday), tickEvery: 1 };
    }
    const dayMonth = (date) => date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }).replace(".", "");
    return { series: dailySeries(entries, "cost_usd", 30, dayMonth), tickEvery: 7 };
  }

  const sum = (series) => series.reduce((total, point) => total + (point.value || 0), 0);

  /* ---------------------------------------------------- accueil widgets */

  function renderWeather() {
    const doc = state.data.weather;
    const snap = doc && (doc.entries || []).at(-1);
    if (!snap) {
      paint("w-weather", emptyCard("Météo", "Pas encore de météo.", "python3 scripts/weather_sync.py collect"));
      return;
    }
    const current = snap.current || {};
    const now = Date.now();
    const hours = (snap.hourly_3h || [])
      .filter((hour) => new Date(hour.time).getTime() > now - HOUR_MS)
      .slice(0, 4)
      .map((hour) => `<div class="weather-hour">
        <span class="muted">${Number(hour.time.slice(11, 13))}h</span>
        ${WeatherIcons.svg(hour.code)}
        <span class="num">${isNum(hour.temp_c) ? Math.round(hour.temp_c) : "--"}°</span>
      </div>`).join("");
    const feels = isNum(current.feels_c) ? ` · ressenti ${Math.round(current.feels_c)}°` : "";
    paint("w-weather", `${cardHead(escapeHtml(snap.city || "Météo"), "weather")}
      <div class="weather-main">
        <div class="big">${counter("w-temp", isNum(current.temp_c) ? Math.round(current.temp_c) : null)}°</div>
        <div class="weather-icon">${WeatherIcons.svg(current.code)}</div>
      </div>
      <div class="sub">${WeatherIcons.label(current.code)}${feels}</div>
      ${hours ? `<div class="weather-hours">${hours}</div>` : ""}`);
  }

  function latestWith(entries, field) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (isNum(entries[i][field])) return entries[i];
    }
    return null;
  }

  function recoveryShade(pct) {
    if (!isNum(pct)) return "var(--fill)";
    if (pct >= RECOVERY_HIGH) return "var(--recovery-high)";
    if (pct >= RECOVERY_MID) return "var(--recovery-mid)";
    return "var(--recovery-low)";
  }

  function recoveryZone(pct) {
    if (pct >= RECOVERY_HIGH) return "Haute";
    if (pct >= RECOVERY_MID) return "Moyenne";
    return "Basse";
  }

  const WHOOP_HINT = "python3 scripts/whoop.py auth  puis  collect";

  function renderRecoveryHome() {
    const entries = (state.data.whoop && state.data.whoop.entries) || [];
    const entry = latestWith(entries, "recovery_pct");
    if (!entry) {
      paint("w-recovery", emptyCard("Récupération", "WHOOP non connecté.", WHOOP_HINT));
      return;
    }
    const pct = entry.recovery_pct;
    paint("w-recovery", `${cardHead("Récupération", "whoop", `<span class="label">${dayName(entry.date)}</span>`)}
      <div class="recovery-body">
        ${ring(pct / 100, { stroke: 9, color: recoveryShade(pct), key: "r-home" })}
        <div class="ring-center">
          <div class="mid">${counter("r-home", pct)}<small>%</small></div>
          <span class="label">${recoveryZone(pct)}</span>
        </div>
      </div>`);
  }

  function agendaWhen(event, now) {
    const start = new Date(event.start.length === 10 ? `${event.start}T00:00:00` : event.start);
    const key = localKey(start);
    const today = localKey(now);
    const tomorrow = localKey(shiftDays(1, now));
    const day = key === today ? "" : key === tomorrow ? "Demain"
      : start.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
    const time = event.all_day ? "Journée" : hhmm(start);
    return { day, time };
  }

  function upcomingEvents(events, now) {
    return events.filter((event) => {
      const end = event.end || event.start;
      const endTime = new Date(end.length === 10 ? `${end}T00:00:00` : end).getTime();
      return Number.isNaN(endTime) || endTime > now.getTime();
    });
  }

  function renderAgenda() {
    const doc = state.data.calendar;
    if (!doc) {
      paint("w-agenda", emptyCard("À venir", "Agenda Google non connecté.", "python3 scripts/calendar_sync.py auth"));
      return;
    }
    const now = new Date();
    const events = upcomingEvents(doc.entries || [], now).slice(0, AGENDA_MAX_ITEMS);
    if (events.length === 0) {
      paint("w-agenda", `${cardHead("À venir", "calendar")}<p class="empty">Rien de prévu cette semaine.</p>`);
      return;
    }
    const items = events.map((event) => {
      const { day, time } = agendaWhen(event, now);
      const isNow = !event.all_day && new Date(event.start) <= now;
      return `<li class="agenda-item${isNow ? " is-now" : ""}">
        <span class="agenda-time num">${day ? `<small>${escapeHtml(day)}</small>` : ""}${time}</span>
        <span><span class="agenda-title">${escapeHtml(event.title)}</span>
          ${event.location ? `<span class="agenda-loc">${escapeHtml(event.location)}</span>` : ""}</span>
      </li>`;
    }).join("");
    paint("w-agenda", `${cardHead("À venir", "calendar")}<ul class="agenda-list">${items}</ul>`);
    trimOverflow($("w-agenda").querySelector(".agenda-list"));
  }

  /** Retire les lignes qui ne tiennent pas entièrement (pas de ligne coupée). */
  function trimOverflow(list) {
    if (!list) return;
    const limit = list.clientHeight;
    [...list.children].forEach((item) => {
      if (item.offsetTop - list.offsetTop + item.offsetHeight > limit + 1) item.remove();
    });
  }

  const CLAUDE_HINT = "python3 scripts/claude_stats.py collect";

  function renderClaudeCard(id, keyPrefix) {
    const doc = state.data.claude_stats;
    if (!doc || !(doc.entries || []).length) {
      paint(id, emptyCard("Claude API", "Pas encore de statistiques.", CLAUDE_HINT));
      return;
    }
    const { series, tickEvery } = claudeSeries(state.claudePeriod);
    const total = sum(series);
    const periodLabel = { day: "24 dernières heures", week: "7 derniers jours", month: "30 derniers jours" };
    paint(id, `<div class="card-head">
        <span class="label">Claude API · coût</span>
        ${segmented("claude", PERIODS, state.claudePeriod, keyPrefix)}
      </div>
      <div class="chart-summary">
        <div class="mid"><small class="cur">$</small>${counter(`${keyPrefix}-total`, total, total >= 100 ? "usd0" : "usd")}</div>
        <span class="sub">${periodLabel[state.claudePeriod]}</span>
      </div>
      <div class="chart"></div>`);
    lineChart($(id).querySelector(".chart"), series, { tickEvery, format: fmtUsd });
  }

  /* ------------------------------------------------------- page Santé */

  function renderHealth() {
    const doc = state.data.whoop;
    const entries = (doc && doc.entries) || [];
    $("health-meta").textContent = doc ? `WHOOP · maj ${hhmm(new Date(doc.updated_at))}` : "WHOOP";
    if (!entries.length) {
      paint("h-recovery", emptyCard("Récupération", "Aucune donnée WHOOP.", WHOOP_HINT));
      ["h-sleep", "h-strain", "h-trend"].forEach((id) => paint(id, ""));
      return;
    }
    renderHealthRecovery(latestWith(entries, "recovery_pct"));
    renderHealthSleep(latestWith(entries, "sleep_hours"));
    renderHealthStrain(latestWith(entries, "strain"));
    renderHealthTrend(entries);
  }

  function vital(label, key, value, unit, format = "int") {
    return `<div class="vital"><span class="label">${label}</span>
      <div class="mid">${counter(key, value, format)}<small>${unit}</small></div></div>`;
  }

  function renderHealthRecovery(entry) {
    if (!entry) {
      paint("h-recovery", emptyCard("Récupération", "Pas encore de récupération calculée."));
      return;
    }
    const pct = entry.recovery_pct;
    paint("h-recovery", `${cardHead("Récupération", "whoop", `<span class="label">${dayName(entry.date)}</span>`)}
      <div class="recovery-body">
        ${ring(pct / 100, { stroke: 7, color: recoveryShade(pct), key: "r-xl" })}
        <div class="ring-center">
          <div class="big">${counter("r-xl", pct)}<small>%</small></div>
          <span class="label" style="color:${recoveryShade(pct)}">${recoveryZone(pct)}</span>
        </div>
      </div>
      <div class="vitals">
        ${vital("VFC", "v-hrv", entry.hrv_ms, "ms")}
        ${vital("FC repos", "v-rhr", entry.rhr_bpm, "bpm")}
        ${vital("SpO₂", "v-spo2", entry.spo2_pct, "%", "dec1")}
      </div>`);
  }

  function renderHealthSleep(entry) {
    if (!entry) {
      paint("h-sleep", emptyCard("Sommeil", "Pas de nuit enregistrée."));
      return;
    }
    const hours = Math.floor(entry.sleep_hours);
    const minutes = Math.round((entry.sleep_hours - hours) * 60);
    const span = entry.sleep_start && entry.sleep_end
      ? `${hhmm(new Date(entry.sleep_start))} → ${hhmm(new Date(entry.sleep_end))}` : "";
    const pctText = (value) => (isNum(value) ? `${Math.round(value)} %` : "--");
    paint("h-sleep", `${cardHead("Sommeil", "whoop", `<span class="label">${dayName(entry.date)}</span>`)}
      <div class="big" style="margin-top:auto">${counter("s-h", hours)}<small>h</small>
        ${counter("s-m", minutes)}<small>min</small></div>
      <div class="sub">${span}</div>
      <div class="meters" style="margin-top:1.25rem">
        ${meter("Performance", pctText(entry.sleep_performance_pct), entry.sleep_performance_pct / 100, "m-perf", "var(--sleep)")}
        ${meter("Efficacité", pctText(entry.sleep_efficiency_pct), entry.sleep_efficiency_pct / 100, "m-eff", "var(--sleep)")}
      </div>`);
  }

  function renderHealthStrain(entry) {
    if (!entry) {
      paint("h-strain", emptyCard("Effort", "Pas d'effort enregistré."));
      return;
    }
    const kcal = isNum(entry.calories_kcal) ? `${FORMATS.int(entry.calories_kcal)} kcal` : "--";
    const heart = isNum(entry.avg_hr_bpm) ? `${entry.avg_hr_bpm} / ${entry.max_hr_bpm} bpm` : "--";
    paint("h-strain", `${cardHead("Effort", "whoop", `<span class="label">${dayName(entry.date)}</span>`)}
      <div class="big" style="margin-top:auto">${counter("st", entry.strain, "dec1")}<small>/ ${STRAIN_MAX}</small></div>
      <div class="meters" style="margin-top:1.25rem">
        ${meter("Charge", `${Math.round((entry.strain / STRAIN_MAX) * 100)} %`, entry.strain / STRAIN_MAX, "m-strain", "var(--effort)")}
      </div>
      <ul class="rows" style="margin-top:0.75rem">
        <li><span class="name">Calories</span><span class="value">${kcal}</span></li>
        <li><span class="name">FC moy. / max</span><span class="value">${heart}</span></li>
      </ul>`);
  }

  function renderHealthTrend(entries) {
    const metric = HEALTH_METRICS.find((item) => item.id === state.healthMetric) || HEALTH_METRICS[0];
    const label = (date) => date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }).replace(".", "");
    /* Ancrée sur le dernier jour collecté : une collecte en retard garde une courbe lisible. */
    const lastDate = entries.length ? entries[entries.length - 1].date : localKey(new Date());
    const endDate = new Date(Math.min(Date.now(), new Date(`${lastDate}T12:00:00`).getTime()));
    const series = dailySeries(entries, metric.id, HEALTH_TREND_DAYS, label, endDate);
    const until = lastDate === localKey(new Date()) ? "" : ` · jusqu'à ${dayName(lastDate).toLowerCase()}`;
    const known = series.filter((point) => point.value > 0);
    const average = known.length ? sum(known) / known.length : null;
    paint("h-trend", `<div class="card-head">
        <span class="label">${HEALTH_TREND_DAYS} jours</span>
        ${segmented("health", HEALTH_METRICS, metric.id)}
      </div>
      <div class="chart-summary">
        <div class="mid">${counter(`trend-${metric.id}`, average, "dec1")}<small>${metric.unit}</small></div>
        <span class="sub">moyenne${until}</span>
      </div>
      <div class="chart"></div>`);
    lineChart($("h-trend").querySelector(".chart"), series, {
      tickEvery: 4,
      format: (value) => `${FORMATS.dec1(value)}${metric.unit ? ` ${metric.unit}` : ""}`,
    });
  }

  /* ------------------------------------------------- page Claude API */

  function renderClaudePage() {
    const doc = state.data.claude_stats;
    $("claude-meta").textContent = doc
      ? `Équivalent pay-as-you-go · maj ${hhmm(new Date(doc.updated_at))}` : "";
    if (!doc || !(doc.entries || []).length) {
      paint("c-today", emptyCard("Aujourd'hui", "Pas encore de statistiques.", CLAUDE_HINT));
      ["c-models", "c-totals"].forEach((id) => paint(id, ""));
      renderClaudeCard("c-chart", "cp");
      renderLimits();
      return;
    }
    const today = doc.entries.find((entry) => entry.date === localKey(new Date())) || {};
    paint("c-today", `${cardHead("Aujourd'hui", "claude_stats")}
      <div class="big" style="margin-top:auto"><small class="cur">$</small>${counter("ct-cost", today.cost_usd || 0, "usd")}</div>
      <div class="sub" style="margin-top:0.75rem">
        ${counter("ct-msg", today.messages || 0)} messages · ${fmtTokens(today.output_tokens || 0)} tokens générés
      </div>
      <div class="sub muted">cache : ${fmtUsd(today.cache_saved_usd || 0)} économisés</div>`);
    renderClaudeCard("c-chart", "cp");
    renderModels(doc);
    renderTotals(doc.entries);
  }

  function renderModels(doc) {
    const models = Object.entries(doc.today_models || {})
      .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
      .slice(0, 4);
    const rows = models.length
      ? models.map(([model, bucket]) => `<li><span class="name">${escapeHtml(modelLabel(model))}</span>
          <span class="value">${fmtUsd(bucket.cost_usd)}</span></li>`).join("")
      : '<li><span class="name muted">Aucun usage aujourd\'hui</span></li>';
    paint("c-models", `${cardHead("Modèles · aujourd'hui", "claude_stats")}<ul class="rows">${rows}</ul>`);
  }

  function renderTotals(entries) {
    const since = (days) => localKey(shiftDays(1 - days));
    const lastDays = (days) => entries.filter((entry) => entry.date >= since(days));
    const total = (list, field) => list.reduce((acc, entry) => acc + (entry[field] || 0), 0);
    const month = lastDays(30);
    paint("c-totals", `${cardHead("Cumul", "claude_stats")}
      <ul class="rows">
        <li><span class="name">7 jours</span><span class="value">${fmtUsd(total(lastDays(7), "cost_usd"))}</span></li>
        <li><span class="name">30 jours</span><span class="value">${fmtUsd(total(month, "cost_usd"))}</span></li>
        <li><span class="name">Cache économisé · 30 j</span><span class="value">${fmtUsd(total(month, "cache_saved_usd"))}</span></li>
        <li><span class="name">Messages · 30 j</span><span class="value">${FORMATS.int(total(month, "messages"))}</span></li>
      </ul>`);
  }

  function untilText(iso, longForm) {
    const time = new Date(iso).getTime();
    if (!iso || Number.isNaN(time) || time <= Date.now()) return "";
    if (longForm) {
      return new Date(time).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
    }
    const minutes = Math.round((time - Date.now()) / 60000);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
  }

  function renderLimits() {
    const doc = state.data.claude_limits;
    const snap = doc && (doc.entries || []).at(-1);
    if (!snap) {
      paint("c-limits", emptyCard("Limites du plan", "Pas encore collectées.", "python3 scripts/claude_limits.py collect"));
      return;
    }
    const row = (name, bucket, longForm) => {
      if (!bucket || !isNum(bucket.pct)) return "";
      const reset = untilText(bucket.resets_at, longForm);
      return meter(`${escapeHtml(name)}${reset ? ` <span class="muted">· ${reset}</span>` : ""}`,
        `${Math.round(bucket.pct)} %`, bucket.pct / 100, `m-limit-${name}`,
        bucket.pct >= LIMIT_WARN_PCT ? "var(--red)" : "");
    };
    paint("c-limits", `${cardHead("Limites du plan", "claude_limits")}
      <div class="meters">
        ${row("Session", snap.session, false)}
        ${row("Hebdo", snap.weekly, true)}
        ${snap.scoped ? row(snap.scoped.label, snap.scoped, true) : ""}
      </div>`);
  }

  /* ---------------------------------------------- rendu par catégorie */

  const RENDERERS = {
    weather: [renderWeather],
    whoop: [renderRecoveryHome, renderHealth],
    calendar: [renderAgenda],
    claude_stats: [() => renderClaudeCard("w-claude", "home"), renderClaudePage],
    claude_limits: [renderLimits],
  };

  /* Statut « non à jour » affiché par catégorie : revérifié chaque minute. */
  const staleShown = {};

  function isStale(category) {
    const doc = state.data[category];
    const age = doc ? ageHours(doc.updated_at) : null;
    return age !== null && age > MAX_AGE_H[category];
  }

  /** Une collecte arrêtée ne change plus updated_at : on redessine au basculement. */
  function refreshStaleCards() {
    CATEGORIES.forEach((category) => {
      if (category in staleShown && staleShown[category] !== isStale(category)) renderCategory(category);
    });
  }

  function renderCategory(category) {
    staleShown[category] = isStale(category);
    (RENDERERS[category] || []).forEach((render) => {
      try {
        render();
      } catch (error) {
        console.error(`Rendu ${category} échoué :`, error);
      }
    });
  }

  async function fetchCategory(category) {
    try {
      const response = await fetch(`/api/data/${category}`, { cache: "no-store" });
      const payload = await response.json();
      return payload.success ? payload.data : null;
    } catch (error) {
      console.warn(`Collecte ${category} injoignable :`, error);
      return undefined; /* serveur injoignable : on garde l'affichage courant */
    }
  }

  /** Résultats des collectes : un changement redessine toutes les cartes. */
  async function pollSources() {
    const doc = await fetchCategory(SOURCES_CATEGORY);
    if (!doc || state.stamps[SOURCES_CATEGORY] === doc.updated_at) return;
    state.stamps[SOURCES_CATEGORY] = doc.updated_at;
    state.sources = doc.sources || {};
    CATEGORIES.forEach((category) => { if (category in staleShown) renderCategory(category); });
  }

  async function poll() {
    await pollSources();
    const results = await Promise.all(CATEGORIES.map(fetchCategory));
    results.forEach((doc, index) => {
      const category = CATEGORIES[index];
      if (doc === undefined) return;
      const stamp = doc ? doc.updated_at || "?" : "absent";
      if (state.stamps[category] === stamp) return;
      state.stamps[category] = stamp;
      state.data = { ...state.data, [category]: doc };
      renderCategory(category);
    });
  }

  /* --------------------------------------------- contrôles segmentés */

  function onSegment(button) {
    const { seg, value } = button.dataset;
    if (seg === "claude" && value !== state.claudePeriod) {
      state.claudePeriod = value;
      renderCategory("claude_stats");
    }
    if (seg === "health" && value !== state.healthMetric) {
      state.healthMetric = value;
      renderHealthTrend((state.data.whoop && state.data.whoop.entries) || []);
    }
  }

  /* ----------------------------------------------------------- pager */

  const pager = $("pager");
  const dots = [...document.querySelectorAll(".dot")];

  function setActiveDot(index) {
    state.page = index;
    dots.forEach((dot, i) => {
      dot.classList.toggle("is-active", i === index);
      dot.setAttribute("aria-current", i === index ? "page" : "false");
    });
  }

  function goTo(index, behavior = "smooth") {
    const clamped = Math.max(0, Math.min(dots.length - 1, index));
    pager.scrollTo({ left: clamped * pager.clientWidth, behavior });
    setActiveDot(clamped);
  }

  function setupPager() {
    let ticking = false;
    pager.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        setActiveDot(Math.round(pager.scrollLeft / pager.clientWidth));
      });
    }, { passive: true });
    setupMouseDrag();
    setActiveDot(0);
  }

  /**
   * Certains écrans tactiles USB remontent le doigt comme une souris : le
   * défilement natif ne marche alors pas. On reproduit le swipe à la main
   * pour pointerType "mouse" uniquement ; le tactile garde le scroll natif.
   */
  function setupMouseDrag() {
    let drag = null;
    let suppressClick = false;

    pager.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      if (event.target.closest(".leaflet-container, [data-step]")) return;  // carte et -/+ gardent leur geste
      suppressClick = false;
      drag = { x: event.clientX, left: pager.scrollLeft, page: state.page, time: performance.now(), moved: false };
    });
    window.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      if (!drag.moved) pager.style.scrollSnapType = "none";
      drag.moved = true;
      pager.scrollLeft = drag.left - dx;
    });
    window.addEventListener("pointerup", (event) => {
      if (!drag) return;
      const { moved, x, time, page } = drag;
      drag = null;
      if (!moved) return;
      suppressClick = true;
      const dx = event.clientX - x;
      const velocity = dx / Math.max(1, performance.now() - time);
      const flick = Math.abs(velocity) > 0.4 ? -Math.sign(dx) : 0;
      const target = flick ? page + flick : Math.round(pager.scrollLeft / pager.clientWidth);
      pager.style.scrollSnapType = "";
      goTo(target);
    });
    window.addEventListener("click", (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
  }

  /* ------------------------------------------------- horloge et thème */

  function themeFor(date) {
    const forced = new URLSearchParams(location.search).get("theme");
    if (forced === "light" || forced === "dark") return forced;
    const hour = date.getHours();
    return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? "light" : "dark";
  }

  function tick() {
    const now = new Date();
    const time = hhmm(now);
    const date = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    $("clock-time").textContent = time;
    $("clock-date").textContent = date;
    $("standby-time").textContent = time;
    $("standby-date").textContent = date;
    const theme = themeFor(now);
    if (document.documentElement.dataset.theme !== theme) {
      document.documentElement.dataset.theme = theme;
    }
  }

  function startClock() {
    tick();
    const scheduleNext = () => {
      const now = new Date();
      const delay = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50;
      setTimeout(() => {
        tick();
        renderAgenda();   // « en cours », jours relatifs
        renderLimits();   // comptes à rebours
        refreshStaleCards();
        if (standby.isOn) standby.drift();
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  }

  /* ------------------------------------------------------------ veille */

  const standby = (() => {
    const overlay = $("standby");
    const inner = $("standby-inner");
    let timer = null;
    const api = { isOn: false };

    api.drift = () => {
      /* Léger déplacement chaque minute : évite le marquage de l'écran. */
      const dx = (Math.random() - 0.5) * 6;
      const dy = (Math.random() - 0.5) * 4;
      inner.style.transform = `translate(${dx}rem, ${dy}rem)`;
    };

    api.arm = () => {
      clearTimeout(timer);
      timer = setTimeout(api.enter, IDLE_MS);
    };

    api.enter = () => {
      api.isOn = true;
      api.drift();
      overlay.classList.add("is-on");
      goTo(0, "instant");
    };

    api.exit = () => {
      api.isOn = false;
      overlay.classList.remove("is-on");
      api.arm();
    };

    /* Le toucher de réveil est absorbé : il ne déclenche rien dessous. */
    overlay.addEventListener("click", (event) => {
      event.stopPropagation();
      api.exit();
    });
    ["pointerdown", "wheel", "keydown"].forEach((type) => {
      window.addEventListener(type, () => { if (!api.isOn) api.arm(); }, { passive: true });
    });
    pager.addEventListener("scroll", () => { if (!api.isOn) api.arm(); }, { passive: true });
    return api;
  })();

  /* --------------------------------------------------------------- boot */

  function setupEvents() {
    document.addEventListener("click", (event) => {
      const segButton = event.target.closest("[data-seg]");
      if (segButton) {
        onSegment(segButton);
        return;
      }
      const link = event.target.closest("[data-goto]");
      if (link) goTo(Number(link.dataset.goto));
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        goTo(state.page, "instant");
        ["claude_stats", "whoop", "calendar"].forEach(renderCategory);
      }, 200);
    });
  }

  function boot() {
    tick();
    LiteMode.setup();
    setupPager();
    setupEvents();
    startClock();
    standby.arm();
    document.body.classList.add("is-ready");
    poll();
    setInterval(poll, POLL_MS);
    const requested = Number(new URLSearchParams(location.search).get("page"));
    if (requested > 0) goTo(requested, "instant");
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
