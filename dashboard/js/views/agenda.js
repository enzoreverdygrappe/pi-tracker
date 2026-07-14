/**
 * Vue "Agenda" : événements Google Agenda des 7 prochains jours,
 * groupés par jour (Aujourd'hui / Demain / date). Les jours sans
 * événement ne sont pas affichés.
 * Données : data/calendar.json (scripts/calendar_sync.py) via /api/data/calendar.
 */
"use strict";

(() => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function dayKeyOf(isoStart) {
    /* Les événements "journée entière" ont déjà une date pure YYYY-MM-DD. */
    if (isoStart.length === 10) return isoStart;
    const date = new Date(isoStart);
    if (Number.isNaN(date.getTime())) return "";
    /* Clé en date LOCALE (pas UTC) pour grouper selon la journée vécue. */
    const offsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
  }

  function localDayKey(offsetDays) {
    const now = new Date(Date.now() + offsetDays * DAY_MS);
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
  }

  function dayTitle(dayKey) {
    if (dayKey === localDayKey(0)) return "Aujourd'hui";
    if (dayKey === localDayKey(1)) return "Demain";
    return new Date(`${dayKey}T12:00:00`).toLocaleDateString("fr-FR",
      { weekday: "long", day: "numeric", month: "long" });
  }

  /** Groupe les événements par jour local, en conservant l'ordre. */
  function groupByDay(events) {
    return events.reduce((groups, event) => {
      const key = dayKeyOf(event.start);
      if (!key) return groups;
      const existing = groups.find((group) => group.key === key);
      if (existing) {
        return groups.map((group) => group.key === key
          ? { ...group, events: [...group.events, event] }
          : group);
      }
      return [...groups, { key, events: [event] }];
    }, []);
  }

  function timeOf(event) {
    if (event.all_day) return "Journée";
    const date = new Date(event.start);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function endTimeOf(event) {
    if (event.all_day || !event.end) return "";
    const date = new Date(event.end);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  function renderEvent(event) {
    const end = endTimeOf(event);
    return `<li class="agenda-row">
      <span class="agenda-time">${timeOf(event)}${end ? `<small>→ ${end}</small>` : ""}</span>
      <span class="agenda-body">
        <span class="agenda-title">${escapeHtml(event.title)}</span>
        ${event.location ? `<span class="agenda-loc">${escapeHtml(event.location)}</span>` : ""}
      </span>
    </li>`;
  }

  function renderDayGroup(group) {
    return `<div class="section">
      <div class="section-title">
        <span class="section-name">${dayTitle(group.key)}</span>
        <span class="leader"></span>
        <span class="section-meta">${group.events.length} évt</span>
      </div>
      <ul class="agenda-list">${group.events.map(renderEvent).join("")}</ul>
    </div>`;
  }

  function formatUpdateTime(isoTimestamp) {
    if (!isoTimestamp) return "";
    return new Date(isoTimestamp).toLocaleTimeString("fr-FR",
      { hour: "2-digit", minute: "2-digit" });
  }

  async function render(container) {
    const result = await fetchCategory("calendar");

    if (!result.success) {
      renderEmptyState(container, {
        glyph: "▤",
        message: "Agenda pas encore synchronisé.",
        hint: "python3 scripts/calendar_sync.py auth  puis  collect",
      });
      return;
    }

    const events = result.data.entries || [];
    if (events.length === 0) {
      renderEmptyState(container, {
        glyph: "▤",
        message: "Aucun événement dans les 7 prochains jours.",
        hint: "python3 scripts/calendar_sync.py collect",
      });
      return;
    }

    const header = `
      <div class="view-header">
        <div class="view-title"><em>Agenda</em><span class="sep">/</span>7 prochains jours</div>
        <div class="live-pill">
          <span class="live-dot"></span>
          <span>maj ${formatUpdateTime(result.data.updated_at)}</span>
        </div>
      </div>`;
    container.innerHTML = header + groupByDay(events).map(renderDayGroup).join("");
  }

  Views.register({ id: "agenda", label: "Agenda", icon: "▤", brandTheme: "onyx", render });
})();
