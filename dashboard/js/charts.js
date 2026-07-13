/**
 * Mini bibliothèque de graphiques SVG — zéro dépendance.
 * Une seule série par graphique (une mesure = un graphique, jamais de double axe).
 * Tactile : chaque point a une zone de tap large qui affiche un tooltip.
 */
"use strict";

const Charts = (() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const WIDTH = 920;
  const HEIGHT = 260;
  const PAD = { top: 24, right: 56, bottom: 30, left: 44 };
  const GRID_LINES = 4;
  const DOT_RADIUS = 4;
  const TAP_RADIUS = 22;
  const TOOLTIP_HIDE_DELAY_MS = 2500;

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
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  function buildScales(points) {
    const innerWidth = WIDTH - PAD.left - PAD.right;
    const innerHeight = HEIGHT - PAD.top - PAD.bottom;
    const maxValue = niceMax(Math.max(...points.map((p) => p.value)));
    const stepX = points.length > 1 ? innerWidth / (points.length - 1) : 0;
    return {
      maxValue,
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

  function appendXLabels(svg, points, scales) {
    const maxLabels = 8;
    const step = Math.max(1, Math.ceil(points.length / maxLabels));
    points.forEach((point, index) => {
      const isLast = index === points.length - 1;
      if (index % step !== 0 && !isLast) return;
      svg.appendChild(el("text", {
        class: "chart-axis-label",
        x: scales.x(index), y: HEIGHT - 8, "text-anchor": "middle",
      }, point.label));
    });
  }

  function showTooltip(anchorRect, point, unit) {
    const tooltip = document.getElementById("chart-tooltip");
    if (!tooltip) return;
    tooltip.innerHTML =
      `<span class="tip-label">${point.label}</span>` +
      `<span class="tip-value">${point.value}${unit ? " " + unit : ""}</span>`;
    tooltip.style.left = `${anchorRect.left + anchorRect.width / 2}px`;
    tooltip.style.top = `${anchorRect.top}px`;
    tooltip.hidden = false;
    clearTimeout(showTooltip.timer);
    showTooltip.timer = setTimeout(() => { tooltip.hidden = true; }, TOOLTIP_HIDE_DELAY_MS);
  }

  function appendDots(svg, points, scales, unit) {
    points.forEach((point, index) => {
      const cx = scales.x(index);
      const cy = scales.y(point.value);
      const dot = el("circle", { class: "chart-dot", cx, cy, r: DOT_RADIUS });
      const hit = el("circle", { class: "chart-hit", cx, cy, r: TAP_RADIUS });
      hit.addEventListener("pointerdown", () => {
        svg.querySelectorAll(".chart-dot.is-active")
          .forEach((node) => node.classList.remove("is-active"));
        dot.classList.add("is-active");
        showTooltip(hit.getBoundingClientRect(), point, unit);
      });
      svg.appendChild(dot);
      svg.appendChild(hit);
    });
  }

  function appendLastValueLabel(svg, points, scales) {
    const lastIndex = points.length - 1;
    const last = points[lastIndex];
    svg.appendChild(el("text", {
      class: "chart-last-label",
      x: scales.x(lastIndex) + 10,
      y: scales.y(last.value) + 4,
    }, String(last.value)));
  }

  /**
   * Graphique en ligne, série unique.
   * @param {HTMLElement} container
   * @param {{label: string, value: number}[]} points ordonnés dans le temps
   * @param {{unit?: string}} options
   */
  function line(container, points, options = {}) {
    container.textContent = "";
    if (!Array.isArray(points) || points.length === 0) return;

    const svg = el("svg", {
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      role: "img",
      "aria-label": options.ariaLabel || "Graphique en ligne",
    });
    const scales = buildScales(points);

    appendGrid(svg, scales);
    appendXLabels(svg, points, scales);

    const pathData = points
      .map((point, index) =>
        `${index === 0 ? "M" : "L"}${scales.x(index)},${scales.y(point.value)}`)
      .join(" ");
    svg.appendChild(el("path", { class: "chart-line", d: pathData }));

    appendDots(svg, points, scales, options.unit || "");
    appendLastValueLabel(svg, points, scales);

    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    wrap.appendChild(svg);
    container.appendChild(wrap);
  }

  return { line };
})();
