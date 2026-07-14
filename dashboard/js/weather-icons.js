/**
 * Icônes météo minimalistes line-art (SVG inline, stroke: currentColor).
 * Mapping des codes WMO d'Open-Meteo vers 8 pictos + libellés français.
 */
"use strict";

const WeatherIcons = (() => {
  const S = 'fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round"';

  const SUN_RAYS = "M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22" +
    "M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7";
  const CLOUD = "M7 18a4.2 4.2 0 1 1 .6-8.4 5 5 0 0 1 9.6 1.4A3.5 3.5 0 0 1 17 18z";
  const SMALL_CLOUD = "M9.5 19a3.6 3.6 0 1 1 .5-7.2 4.3 4.3 0 0 1 8.3 1.2" +
    "A3 3 0 0 1 18 19z";

  const ICONS = {
    sun: `<circle cx="12" cy="12" r="4.4" ${S}/><path d="${SUN_RAYS}" ${S}/>`,
    partly: `<circle cx="8.5" cy="8" r="3.4" ${S}/>` +
      `<path d="M8.5 1.6v1.7M1.9 8h1.7M3.8 3.3l1.2 1.2M13.2 3.3 12 4.5" ${S}/>` +
      `<path d="${SMALL_CLOUD}" ${S}/>`,
    cloud: `<path d="${CLOUD}" ${S}/>`,
    fog: `<path d="M7 14a4.2 4.2 0 1 1 .6-8.4 5 5 0 0 1 9.6 1.4A3.5 3.5 0 0 1 17 14z" ${S}/>` +
      `<path d="M5 17.5h14M7 20.5h10" ${S}/>`,
    rain: `<path d="${CLOUD}" ${S}/>` +
      `<path d="M9 20l-.8 2M13 20l-.8 2M17 20l-.8 2" ${S}/>`,
    snow: `<path d="${CLOUD}" ${S}/>` +
      `<path d="M9 20.8h.01M13 21.8h.01M17 20.8h.01" ${S} stroke-width="2.4"/>`,
    thunder: `<path d="${CLOUD}" ${S}/><path d="M12.5 17.5 10 21h3l-1.5 3" ${S}/>`,
    drizzle: `<path d="${CLOUD}" ${S}/>` +
      `<path d="M9 20v.01M13 21v.01M17 20v.01" ${S} stroke-width="2"/>`,
  };

  /* Codes WMO -> [icône, libellé] */
  const WMO = [
    [[0], ["sun", "Ensoleillé"]],
    [[1], ["sun", "Plutôt dégagé"]],
    [[2], ["partly", "Éclaircies"]],
    [[3], ["cloud", "Nuageux"]],
    [[45, 48], ["fog", "Brouillard"]],
    [[51, 53, 55, 56, 57], ["drizzle", "Bruine"]],
    [[61, 63, 65, 66, 67], ["rain", "Pluie"]],
    [[71, 73, 75, 77], ["snow", "Neige"]],
    [[80, 81, 82], ["rain", "Averses"]],
    [[85, 86], ["snow", "Averses de neige"]],
    [[95, 96, 99], ["thunder", "Orage"]],
  ];

  function lookup(code) {
    const match = WMO.find(([codes]) => codes.includes(Number(code)));
    return match ? match[1] : ["cloud", "Couvert"];
  }

  /** SVG inline de l'icône du code WMO ; la taille se règle en CSS. */
  function svg(code, className = "") {
    return `<svg class="weather-icon ${className}" viewBox="0 0 24 24" ` +
      `role="img" aria-label="${lookup(code)[1]}">${ICONS[lookup(code)[0]]}</svg>`;
  }

  /** Libellé français de la condition. */
  function label(code) {
    return lookup(code)[1];
  }

  return { svg, label };
})();
