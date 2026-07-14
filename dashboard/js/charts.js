/**
 * Mini bibliothèque de graphiques SVG — zéro dépendance.
 * Une seule série par graphique (une mesure = un graphique, jamais de double axe).
 * Tactile : chaque marque a une zone de tap large qui affiche un tooltip.
 *
 * Formes : Charts.line, Charts.bars (activité quotidienne),
 *          Charts.heatmap (calendrier semaines x jours).
 */
"use strict";

const Charts = (() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const WIDTH = 920;
  const HEIGHT = 240;
  const PAD = { top: 22, right: 52, bottom: 28, left: 42 };
  const GRID_LINES = 4;
  const DOT_RADIUS = 4;
  const TAP_RADIUS = 22;
  const BAR_GAP = 2;
  const TOOLTIP_HIDE_DELAY_MS = 2500;

  /* Rampe séquentielle du thème courant (--heat-1..5), fallback or ESNIA. */
  const HEAT_FALLBACK = ["#2b2310", "#4e3d13", "#755c1a", "#9c7a20", "#c9a227"];

  function heatRamp() {
    const styles = getComputedStyle(document.documentElement);
    const ramp = [1, 2, 3, 4, 5]
      .map((step) => styles.getPropertyValue(`--heat-${step}`).trim())
      .filter(Boolean);
    return ramp.length === HEAT_FALLBACK.length ? ramp : HEAT_FALLBACK;
  }

  function el(name, attrs, textContent) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  function niceMax(rawMax) {
    if (rawMax <= 0) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const normalized = rawMax / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2
      : normalized <= 4 ? 4 : normalized <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  function buildScales(points) {
    const innerWidth = WIDTH - PAD.left - PAD.right;
    const innerHeight = HEIGHT - PAD.top - PAD.bottom;
    const maxValue = niceMax(Math.max(...points.map((p) => p.value)));
    const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;
    return {
      maxValue,
      innerWidth,
      innerHeight,
      x: (index) => PAD.left + (points.length > 1 ? index * stepX : innerWidth / 2),
      y: (value) => PAD.top + innerHeight * (1 - value / maxValue),
    };
  }

  function appendGrid(svg, scales) {
    for (let i = 0; i <= GRID_LINES; i += 1) {
      const value = (scales.maxValue / GRID_LINES) * i;
      const y = scales.y(value);
      svg.appendChild(el("line", {
        class: "chart-grid-line",
        x1: PAD.left, x2: WIDTH - PAD.right, y1: y, y2: y,
      }));
      svg.appendChild(el("text", {
        class: "chart-axis-label", x: PAD.left - 8, y: y + 4, "text-anchor": "end",
      }, String(Math.round(value))));
    }
  }

  function appendXLabels(svg, points, positionOf) {
    const maxLabels = 8;
    const step = Math.max(1, Math.ceil(points.length / maxLabels));
    points.forEach((point, index) => {
      const isLast = index === points.length - 1;
      if (index % step !== 0 && !isLast) return;
      svg.appendChild(el("text", {
        class: "chart-axis-label",
        x: positionOf(index), y: HEIGHT - 6, "text-anchor": "middle",
      }, point.label));
    });
  }

  function showTooltip(anchorRect, label, valueText) {
    const tooltip = document.getElementById("chart-tooltip");
    if (!tooltip) return;
    tooltip.innerHTML =
      `<span class="tip-label">${label}</span><span class="tip-value">${valueText}</span>`;
    tooltip.style.left = `${anchorRect.left + anchorRect.width / 2}px`;
    tooltip.style.top = `${anchorRect.top}px`;
    tooltip.hidden = false;
    clearTimeout(showTooltip.timer);
    showTooltip.timer = setTimeout(() => { tooltip.hidden = true; }, TOOLTIP_HIDE_DELAY_MS);
  }

  function activateMark(svg, mark, activeClass) {
    svg.querySelectorAll(`.${activeClass}.is-active`)
      .forEach((node) => node.classList.remove("is-active"));
    mark.classList.add("is-active");
  }

  function finalize(container, svg) {
    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    wrap.appendChild(svg);
    container.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ line */

  function line(container, points, options = {}) {
    container.textContent = "";
    if (!Array.isArray(points) || points.length === 0) return;

    const svg = el("svg", {
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      role: "img",
      "aria-label": options.ariaLabel || "Graphique en ligne",
    });
    const scales = buildScales(points);
    const unit = options.unit || "";

    appendGrid(svg, scales);
    appendXLabels(svg, points, scales.x);

    const pathData = points
      .map((point, index) =>
        `${index === 0 ? "M" : "L"}${scales.x(index)},${scales.y(point.value)}`)
      .join(" ");
    svg.appendChild(el("path", { class: "chart-line", d: pathData }));

    points.forEach((point, index) => {
      const cx = scales.x(index);
      const cy = scales.y(point.value);
      const dot = el("circle", { class: "chart-dot", cx, cy, r: DOT_RADIUS });
      const hit = el("circle", { class: "chart-hit", cx, cy, r: TAP_RADIUS });
      hit.addEventListener("pointerdown", () => {
        activateMark(svg, dot, "chart-dot");
        showTooltip(hit.getBoundingClientRect(), point.label,
          `${point.value}${unit ? " " + unit : ""}`);
      });
      svg.appendChild(dot);
      svg.appendChild(hit);
    });

    const last = points[points.length - 1];
    svg.appendChild(el("text", {
      class: "chart-last-label",
      x: scales.x(points.length - 1) + 10,
      y: scales.y(last.value) + 4,
    }, String(last.value)));

    finalize(container, svg);
  }

  /* ------------------------------------------------------------------ bars */

  function bars(container, points, options = {}) {
    container.textContent = "";
    if (!Array.isArray(points) || points.length === 0) return;

    const svg = el("svg", {
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      role: "img",
      "aria-label": options.ariaLabel || "Graphique en barres",
    });
    const scales = buildScales(points);
    const unit = options.unit || "";

    const slot = scales.innerWidth / points.length;
    const barWidth = Math.max(4, slot - BAR_GAP * 2);
    const baseline = scales.y(0);
    const centerOf = (index) => PAD.left + slot * index + slot / 2;
    const MIN_ZERO_BAR = 2;

    appendGrid(svg, scales);
    appendXLabels(svg, points, centerOf);

    points.forEach((point, index) => {
      const x = centerOf(index) - barWidth / 2;
      const height = point.value > 0
        ? Math.max(3, baseline - scales.y(point.value))
        : MIN_ZERO_BAR;
      const bar = el("rect", {
        class: `chart-bar${point.value > 0 ? "" : " is-zero"}`,
        x, y: baseline - height, width: barWidth, height, rx: 2,
      });
      const hit = el("rect", {
        class: "chart-hit",
        x: PAD.left + slot * index, y: PAD.top, width: slot,
        height: scales.innerHeight,
      });
      hit.addEventListener("pointerdown", () => {
        activateMark(svg, bar, "chart-bar");
        showTooltip(bar.getBoundingClientRect(), point.label,
          `${point.value}${unit ? " " + unit : ""}`);
      });
      svg.appendChild(bar);
      svg.appendChild(hit);
    });

    finalize(container, svg);
  }

  /* --------------------------------------------------------------- heatmap */

  function heatColor(ramp, value, maxValue) {
    const step = Math.min(
      ramp.length - 1,
      Math.floor((value / maxValue) * ramp.length));
    return ramp[step];
  }

  /**
   * Calendrier semaines x 7 jours (colonnes = semaines, lignes = lun -> dim).
   * @param {HTMLElement} container
   * @param {Map<string, number>} valueByDay clés "YYYY-MM-DD"
   * @param {{weeks?: number, unit?: string}} options
   */
  function heatmap(container, valueByDay, options = {}) {
    container.textContent = "";
    const weeks = options.weeks || 52;
    const unit = options.unit || "";
    const CELL = 12;
    const GAP = 3;
    const TOP = 6;
    const LABEL_H = 18;
    const MIN_WEEKS_BETWEEN_LABELS = 3;

    const width = weeks * (CELL + GAP) - GAP;
    const height = TOP + 7 * (CELL + GAP) - GAP + LABEL_H;
    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": options.ariaLabel || "Calendrier d'activité",
    });

    const DAY_MS = 24 * 60 * 60 * 1000;
    const today = new Date();
    /* Lundi de la semaine courante (getDay: 0 = dimanche). */
    const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY_MS);
    const maxValue = Math.max(1, ...valueByDay.values());
    const ramp = heatRamp();
    let lastMonth = -1;
    let lastLabelWeek = -MIN_WEEKS_BETWEEN_LABELS;

    for (let week = 0; week < weeks; week += 1) {
      const weekStart = new Date(monday.getTime() - (weeks - 1 - week) * 7 * DAY_MS);
      const x = week * (CELL + GAP);

      /* Étiquette de mois sous la première semaine de chaque mois,
         en sautant celles trop proches pour éviter les collisions. */
      if (weekStart.getMonth() !== lastMonth) {
        if (week - lastLabelWeek >= MIN_WEEKS_BETWEEN_LABELS) {
          svg.appendChild(el("text", {
            class: "chart-axis-label", x, y: height - 4,
          }, weekStart.toLocaleDateString("fr-FR", { month: "short" })));
          lastLabelWeek = week;
        }
        lastMonth = weekStart.getMonth();
      }

      for (let day = 0; day < 7; day += 1) {
        const date = new Date(weekStart.getTime() + day * DAY_MS);
        if (date > today) continue;
        const key = date.toISOString().slice(0, 10);
        const value = valueByDay.get(key) || 0;
        const cell = el("rect", {
          class: "heatmap-cell",
          x, y: TOP + day * (CELL + GAP), width: CELL, height: CELL, rx: 3,
        });
        /* style inline : prioritaire sur la règle CSS .heatmap-cell */
        if (value > 0) cell.style.fill = heatColor(ramp, value, maxValue);
        cell.addEventListener("pointerdown", () => {
          activateMark(svg, cell, "heatmap-cell");
          showTooltip(cell.getBoundingClientRect(),
            date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }),
            `${value}${unit ? " " + unit : ""}`);
        });
        svg.appendChild(cell);
      }
    }

    finalize(container, svg);
  }

  return { line, bars, heatmap };
})();
