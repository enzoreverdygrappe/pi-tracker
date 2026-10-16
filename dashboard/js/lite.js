/* pi-tracker · repli performance : sans flou (classe .lite) si le Pi rame.
 * ?lite=1 force durablement, ?lite=0 annule ; sinon mesure au chargement. */
const LiteMode = (() => {
  "use strict";

  const FPS_PROBE_DELAY_MS = 300;
  const FPS_PROBE_MS = 1500;
  const FPS_MIN = 40;
  const LITE_KEY = "pi-tracker-lite";

  function setup() {
    const param = new URLSearchParams(location.search).get("lite");
    try {
      if (param === "0") localStorage.removeItem(LITE_KEY);
      if (param === "1") localStorage.setItem(LITE_KEY, "1");
    } catch (error) { /* stockage indisponible : réglage non persisté */ }
    let stored = null;
    try { stored = localStorage.getItem(LITE_KEY); } catch (error) { stored = null; }
    if (param === "1" || stored === "1") {
      document.documentElement.classList.add("lite");
      return;
    }
    if (param === "0") return;
    probeFps();
  }

  /**
   * Mesure le débit d'images pendant l'animation d'entrée ; trop bas -> .lite
   * pour cette session seulement (une mesure ratée au boot ne doit pas
   * condamner le flou à vie). Pour forcer durablement : ?lite=1.
   */
  function probeFps() {
    setTimeout(() => {
      let frames = 0;
      const start = performance.now();
      const count = (now) => {
        frames += 1;
        if (now - start < FPS_PROBE_MS) {
          requestAnimationFrame(count);
          return;
        }
        const fps = (frames * 1000) / (now - start);
        if (fps >= FPS_MIN) return;
        console.info(`pi-tracker : ${fps.toFixed(0)} fps mesurés, passage en mode lite (sans flou).`);
        document.documentElement.classList.add("lite");
      };
      requestAnimationFrame(count);
    }, FPS_PROBE_DELAY_MS);
  }

  return { setup };
})();
