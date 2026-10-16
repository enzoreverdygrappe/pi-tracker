/**
 * Primitives d'interface partagées (aucune dépendance) : formats fr-FR,
 * compteurs animés, courbe SVG, anneau, jauge, contrôle segmenté.
 * Chargé AVANT app.js, exposé en global `UI`.
 */
"use strict";

const UI = (() => {
  const COUNT_MS = 900;
  const counters = new Map();  // clé de compteur -> dernière valeur affichée

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  const isNum = (value) => typeof value === "number" && Number.isFinite(value);

  const FORMATS = {
    int: (value) => Math.round(value).toLocaleString("fr-FR"),
    dec1: (value) => value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    usd: (value) => value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    usd0: (value) => Math.round(value).toLocaleString("fr-FR"),
  };

  /* ------------------------------------------------- compteurs animés */

  /** Balise d'un nombre qui s'animera en comptant jusqu'à `value`. */
  function counter(key, value, format = "int") {
    if (!isNum(value)) return '<span class="num">--</span>';
    return `<span class="num" data-count="${key}" data-to="${value}" data-fmt="${format}">${
      FORMATS[format](counters.get(key) ?? 0)}</span>`;
  }

  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

  function animateCounters(root) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.querySelectorAll("[data-count]").forEach((node) => {
      const key = node.dataset.count;
      const to = Number(node.dataset.to);
      const from = counters.get(key) ?? 0;
      const format = FORMATS[node.dataset.fmt] || FORMATS.int;
      counters.set(key, to);
      if (reduced || from === to) {
        node.textContent = format(to);
        return;
      }
      const start = performance.now();
      const step = (now) => {
        const progress = easeOutExpo(Math.min(1, (now - start) / COUNT_MS));
        node.textContent = format(from + (to - from) * progress);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------------------ charts */

  /** Chemin SVG lissé, monotone (Fritsch-Carlson) : jamais de dépassement sous 0. */
  function monotonePath(points) {
    const n = points.length;
    if (n === 0) return "";
    if (n === 1) return `M${points[0][0]},${points[0][1]}`;
    const dx = [], slope = [];
    for (let i = 0; i < n - 1; i += 1) {
      dx.push(points[i + 1][0] - points[i][0]);
      slope.push((points[i + 1][1] - points[i][1]) / dx[i]);
    }
    const tangent = points.map((_, i) => {
      if (i === 0) return slope[0];
      if (i === n - 1) return slope[n - 2];
      if (slope[i - 1] * slope[i] <= 0) return 0;
      return (3 * (dx[i - 1] + dx[i])) /
        ((2 * dx[i] + dx[i - 1]) / slope[i - 1] + (dx[i] + 2 * dx[i - 1]) / slope[i]);
    });
    let path = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const h = dx[i] / 3;
      path += `C${(x0 + h).toFixed(1)},${(y0 + h * tangent[i]).toFixed(1)} ` +
        `${(x1 - h).toFixed(1)},${(y1 - h * tangent[i + 1]).toFixed(1)} ` +
        `${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return path;
  }

  let chartSeq = 0;

  /**
   * Courbe fine + dégradé, sans grille. series = [{label, value}].
   * Dimensions lues sur le conteneur : le viewBox est en pixels réels.
   */
  function lineChart(host, series, { tickEvery = 1, format = (v) => v } = {}) {
    if (!host) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width < 40 || height < 40 || series.length < 2) {
      host.innerHTML = "";
      return;
    }
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const top = 1.6 * rem;
    const bottom = height - 1.5 * rem;
    const inset = 0.4 * rem;
    const values = series.map((point) => (isNum(point.value) ? point.value : 0));
    const max = Math.max(...values) || 1;
    const x = (i) => inset + (i * (width - 2 * inset)) / (series.length - 1);
    const y = (v) => bottom - (v / max) * (bottom - top);
    const points = values.map((v, i) => [x(i), y(v)]);
    const line = monotonePath(points);
    const area = `${line}L${x(series.length - 1).toFixed(1)},${bottom}L${x(0).toFixed(1)},${bottom}Z`;
    const id = `g${(chartSeq += 1)}`;

    const maxIndex = values.indexOf(Math.max(...values));
    const [mx, my] = points[maxIndex];
    const anchor = maxIndex < series.length * 0.15 ? "start"
      : maxIndex > series.length * 0.85 ? "end" : "middle";
    const peak = Math.max(...values) > 0
      ? `<circle class="chart-halo" cx="${mx}" cy="${my}" r="9"/>
         <circle class="chart-dot" cx="${mx}" cy="${my}" r="3.5"/>
         <text class="chart-axis" x="${mx}" y="${my - 0.75 * rem}" text-anchor="${anchor}">${escapeHtml(format(values[maxIndex]))}</text>`
      : "";
    const ticks = series.map((point, i) => {
      const isEdge = i === 0 || i === series.length - 1;
      if (!isEdge && i % tickEvery !== 0) return "";
      if (!isEdge && series.length - 1 - i < tickEvery / 2) return "";
      const textAnchor = i === 0 ? "start" : i === series.length - 1 ? "end" : "middle";
      return `<text class="chart-axis" x="${x(i)}" y="${height - 0.2 * rem}" text-anchor="${textAnchor}">${escapeHtml(point.label)}</text>`;
    }).join("");

    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--chart);stop-opacity:.14"/>
        <stop offset="1" style="stop-color:var(--chart);stop-opacity:0"/>
      </linearGradient></defs>
      <path class="chart-area" d="${area}" fill="url(#${id})"/>
      <path class="chart-line" d="${line}" pathLength="1"/>
      ${peak}${ticks}
    </svg>`;
  }

  /*
   * Mémoire des dernières positions (anneaux, jauges, pastilles) : un nouveau
   * rendu repart de l'état affiché au lieu de zéro, donc rien ne « rejoue »
   * quand la donnée n'a pas bougé (re-rendu chaque minute des comptes à rebours).
   */
  const lastPositions = new Map();
  const clamp01 = (value) => Math.max(0, Math.min(1, isNum(value) ? value : 0));

  function remember(key, value, fallback = 0) {
    const previous = key && lastPositions.has(key) ? lastPositions.get(key) : fallback;
    if (key) lastPositions.set(key, value);
    return previous;
  }

  /** Anneau de progression (0..1). L'arc part de sa dernière position et glisse en ressort. */
  function ring(ratio, { stroke = 10, color = "var(--ink)", key = "" } = {}) {
    const size = 120;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = clamp01(ratio);
    const from = remember(key, clamped);
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-track" cx="60" cy="60" r="${radius}" stroke-width="${stroke}"/>
      <circle class="ring-arc" cx="60" cy="60" r="${radius}" stroke-width="${stroke}"
        stroke="${color}" stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference * (1 - from)}"
        data-offset="${circumference * (1 - clamped)}" transform="rotate(-90 60 60)"/>
    </svg>`;
  }

  function meter(name, valueText, ratio, key = "", color = "") {
    const clamped = clamp01(ratio);
    const from = remember(key, clamped);
    return `<div class="meter">
      <div class="meter-head"><span>${name}</span><b>${valueText}</b></div>
      <div class="meter-track"><div class="meter-fill" style="transform:scaleX(${from})${color ? `;--meter-color:${color}` : ""}"
        data-ratio="${clamped}"></div></div>
    </div>`;
  }

  /** Contrôle segmenté iOS : la pastille glisse en ressort vers le choix actif. */
  function segmented(group, options, activeId, key = group) {
    const index = Math.max(0, options.findIndex((option) => option.id === activeId));
    const from = remember(`seg-${key}`, index, index);
    const buttons = options.map((option) => `<button type="button" data-seg="${group}"
      data-value="${option.id}" aria-pressed="${option.id === activeId}">${option.label}</button>`).join("");
    return `<div class="seg" style="--n:${options.length};--k:${from}" data-k="${index}" role="group">
      <span class="seg-thumb"></span>${buttons}</div>`;
  }

  /** Lance les transitions (anneaux, jauges, pastilles) deux frames après l'insertion. */
  function settle(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll(".ring-arc[data-offset]").forEach((arc) => {
        arc.style.strokeDashoffset = arc.dataset.offset;
      });
      root.querySelectorAll(".meter-fill[data-ratio]").forEach((bar) => {
        bar.style.transform = `scaleX(${bar.dataset.ratio})`;
      });
      root.querySelectorAll(".seg[data-k]").forEach((seg) => {
        seg.style.setProperty("--k", seg.dataset.k);
      });
    }));
  }

  return Object.freeze({
    escapeHtml, isNum, FORMATS, counter, animateCounters, lineChart, ring, settle, meter, segmented,
  });
})();
