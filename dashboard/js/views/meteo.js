/**
 * Vue "Météo" : conditions actuelles en héro, 24 h par tranches de 3 h
 * (scroll tactile horizontal), prévisions 3 jours.
 * Données : data/weather.json (scripts/weather_sync.py) via /api/data/weather.
 */
"use strict";

(() => {
  const WARM_THRESHOLD_C = 20;
  const COLD_THRESHOLD_C = 8;

  /** Classe de couleur selon la température (chaud gold, froid bleu). */
  function tempClass(tempC) {
    if (typeof tempC !== "number") return "";
    if (tempC >= WARM_THRESHOLD_C) return "temp-warm";
    if (tempC <= COLD_THRESHOLD_C) return "temp-cold";
    return "";
  }

  function fmtTemp(tempC) {
    return typeof tempC === "number" ? `${Math.round(tempC)}°` : "—";
  }

  function renderHero(snapshot) {
    const current = snapshot.current || {};
    const details = [
      typeof current.feels_c === "number" ? `ressenti ${fmtTemp(current.feels_c)}` : "",
      typeof current.wind_kmh === "number" ? `vent ${Math.round(current.wind_kmh)} km/h` : "",
      typeof current.humidity_pct === "number" ? `humidité ${current.humidity_pct}%` : "",
    ].filter(Boolean).join(" · ");

    return `
      <div class="weather-hero">
        <div class="weather-hero-icon">${WeatherIcons.svg(current.code)}</div>
        <div class="weather-hero-main">
          <div class="weather-temp ${tempClass(current.temp_c)}">${fmtTemp(current.temp_c)}</div>
          <div class="weather-cond">${WeatherIcons.label(current.code)}</div>
          <div class="weather-details">${details}</div>
        </div>
      </div>`;
  }

  function hourLabel(isoLocal) {
    return `${isoLocal.slice(11, 13)}h`;
  }

  function renderHourly(hours) {
    const items = hours.map((hour) => `
      <div class="hour-cell">
        <span class="hour-label">${hourLabel(hour.time)}</span>
        ${WeatherIcons.svg(hour.code)}
        <span class="hour-temp ${tempClass(hour.temp_c)}">${fmtTemp(hour.temp_c)}</span>
      </div>`).join("");
    return `<div class="hour-strip">${items}</div>`;
  }

  function dayName(dateKey) {
    return new Date(`${dateKey}T12:00:00`).toLocaleDateString("fr-FR",
      { weekday: "short", day: "numeric" });
  }

  function renderDaily(days) {
    const cells = days.map((day) => `
      <div class="stat-tile day-cell">
        <div class="stat-label">${dayName(day.date)}</div>
        ${WeatherIcons.svg(day.code)}
        <div class="day-range">
          <span class="hour-temp ${tempClass(day.tmax_c)}">${fmtTemp(day.tmax_c)}</span>
          <span class="day-min">${fmtTemp(day.tmin_c)}</span>
        </div>
      </div>`).join("");
    return `<div class="stat-row">${cells}</div>`;
  }

  function sectionHeader(name, meta) {
    return `
      <div class="section-title">
        <span class="section-name">${name}</span>
        <span class="leader"></span>
        ${meta ? `<span class="section-meta">${meta}</span>` : ""}
      </div>`;
  }

  function formatUpdateTime(isoTimestamp) {
    if (!isoTimestamp) return "";
    return new Date(isoTimestamp).toLocaleTimeString("fr-FR",
      { hour: "2-digit", minute: "2-digit" });
  }

  async function render(container) {
    const result = await fetchCategory("weather");
    const entries = result.success ? (result.data.entries || []) : [];

    if (!result.success || entries.length === 0) {
      renderEmptyState(container, {
        glyph: "◌",
        message: result.success
          ? "Aucune donnée météo pour l'instant."
          : result.error,
        hint: "python3 scripts/weather_sync.py collect",
      });
      return;
    }

    const snapshot = entries[entries.length - 1];
    container.innerHTML = `
      <div class="view-header">
        <div class="view-title"><em>Météo</em><span class="sep">/</span>${snapshot.city || ""}</div>
        <div class="live-pill">
          <span class="live-dot"></span>
          <span>maj ${formatUpdateTime(snapshot.timestamp)}</span>
        </div>
      </div>
      <div class="section">${renderHero(snapshot)}</div>
      <div class="section">
        ${sectionHeader("Prochaines heures", "24 h · pas de 3 h")}
        ${renderHourly(snapshot.hourly_3h || [])}
      </div>
      ${(snapshot.daily || []).length
        ? `<div class="section">
             ${sectionHeader("3 prochains jours", "min / max")}
             ${renderDaily(snapshot.daily)}
           </div>`
        : ""}`;
  }

  Views.register({ id: "meteo", label: "Météo", icon: "◌", brandTheme: "onyx", render });
})();
