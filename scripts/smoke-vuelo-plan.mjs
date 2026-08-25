/** Prueba de humo del planificador de vuelo. */
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Cargar el primero" }).click();
const x = await page.request.get(`${BASE}/ejemplo-picas.xlsx`);
await page.setInputFiles('input[type="file"]', {
  name: "ejemplo-picas.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await x.body()),
});
await page.getByRole("heading", { name: /Que es cada columna/ }).waitFor();
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

await page.getByRole("button", { name: "Planificar vuelo" }).first().click();
await page.getByRole("heading", { name: "Planificar el vuelo" }).waitFor();

const leer = async () => (await page.locator(".stats").allInnerTexts()).join(" · ").replace(/\n/g, " ");
console.log("Con los valores por defecto:");
console.log("  " + await leer());

// Bajar la altura tiene que dar mas pasadas y mas pixeles por modulo.
const antes = await leer();
await page.getByLabel("Altura sobre el terreno (m)").fill("20");
await page.waitForTimeout(400);
const despues = await leer();
console.log("A 20 m de altura:");
console.log("  " + despues);
if (antes === despues) { console.error("ERROR: cambiar la altura no cambio el plan"); process.exitCode = 1; }

// Volar muy alto tiene que disparar el aviso de pixeles por modulo.
await page.getByLabel("Altura sobre el terreno (m)").fill("120");
await page.waitForTimeout(400);
const aviso = await page.locator(".warnbox").first().innerText().catch(() => "");
console.log("A 120 m:", aviso.split("\n")[0]?.slice(0, 100) ?? "(sin aviso)");
if (!/pixeles/.test(aviso)) { console.error("ERROR: esperaba el aviso de pixeles por modulo"); process.exitCode = 1; }

await page.getByLabel("Altura sobre el terreno (m)").fill("35");
await page.waitForTimeout(500);

const kml = page.waitForEvent("download");
await page.getByRole("button", { name: "Exportar KML" }).click();
const d = await kml;
console.log("Descarga:", d.suggestedFilename());

await page.screenshot({ path: "shots/12-vuelo.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
