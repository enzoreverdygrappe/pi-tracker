/**
 * Tests de bout en bout du dashboard (Playwright + node:test, sans dépendance ajoutée).
 *
 * Lance un serveur Flask sur un port libre, simule les séances Kotcha, WHOOP et
 * l'état des collectes (le reste vient de data/), coupe les tuiles de carte.
 *   npm install --no-save playwright && npx playwright install chromium   (une fois)
 *   node --test tests/e2e/*.test.mjs
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 8399;
const BASE = `http://127.0.0.1:${PORT}`;
const PYTHON = process.env.PYTHON
  || (existsSync(path.join(ROOT, ".venv/bin/python")) ? path.join(ROOT, ".venv/bin/python") : "python3");
const TODAY = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ local
const NOW = new Date().toISOString();

const envelope = (data) => ({ success: true, data, error: null });
const FIXTURES = {
  kotcha_workouts: { updated_at: NOW, entries: [{ date: TODAY, title: "30' Race Pace", kind: "footing",
    description: "", duration_min: 65, distance_km: 8.68, pace_s: 449 }] },
  whoop: { updated_at: NOW, entries: [{ date: TODAY, recovery_pct: 72, hrv_ms: 90, rhr_bpm: 52,
    spo2_pct: 96, sleep_hours: 7.5, strain: 12.3 }] },
  sources_status: { updated_at: NOW, entries: [], sources: {} },
};

let server;
let browser;

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Serveur Flask injoignable");
}

before(async () => {
  server = spawn(PYTHON, ["-c", `from server import app; app.run(host="127.0.0.1", port=${PORT})`],
    { cwd: ROOT, stdio: "ignore" });
  await waitForServer();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

/** Ouvre le dashboard avec les données simulées ; renvoie la page et ses erreurs JS. */
async function open(query = "", overrides = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("**/api/data/*", (route) => {
    const category = new URL(route.request().url()).pathname.split("/").pop();
    const fixture = { ...FIXTURES, ...overrides }[category];
    return fixture ? route.fulfill({ json: envelope(fixture) }) : route.continue();
  });
  await page.goto(`${BASE}/${query}`);
  await page.waitForTimeout(1200);
  return { page, errors };
}

const activeDot = (page) => page.$eval(".dot.is-active", (dot) => dot.dataset.goto);

test("les 4 pages s'affichent sans erreur JavaScript", async () => {
  const { page, errors } = await open();
  for (const index of ["0", "1", "2", "3"]) {
    await page.click(`.dot[data-goto="${index}"]`);
    await page.waitForTimeout(700);
    assert.equal(await activeDot(page), index);
  }
  assert.match(await page.textContent("#w-recovery"), /72/);
  assert.match(await page.textContent("#run-session"), /30' Race Pace/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("un glissé vers la gauche passe à la page suivante", async () => {
  const { page } = await open();
  await page.mouse.move(1000, 420);
  await page.mouse.down();
  await page.mouse.move(300, 420, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  assert.equal(await activeDot(page), "1");
  await page.close();
});

test("la séance Kotcha du jour pré-remplit distance et allure", async () => {
  const { page } = await open("?page=3");
  // Saisie modifiée à la main, puis « Utiliser » remet la séance Kotcha.
  await page.click('[data-step="km"][data-dir="1"]');
  await page.click('[data-run="use-kotcha"]');
  await page.waitForTimeout(300);
  const card = await page.textContent("#run-session");
  assert.match(card, /8,7\s*km/);
  assert.match(card, /7:30\s*\/km/);
  await page.close();
});

test("une source sans jeton valide affiche « à reconnecter »", async () => {
  const sources = { updated_at: NOW, entries: [], sources: {
    whoop: { ok_at: null, error_at: NOW, error: "HTTP 401", needs_auth: true },
    kotcha_workouts: { ok_at: null, error_at: NOW, error: "401", needs_auth: true },
  } };
  const { page } = await open("?page=3", { sources_status: sources });
  assert.match(await page.textContent("#w-recovery"), /à reconnecter/);
  assert.match(await page.textContent("#run-session"), /Garmin à reconnecter/);
  await page.close();
});
