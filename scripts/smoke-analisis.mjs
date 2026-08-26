/**
 * Prueba de humo del analisis termico completo, en el navegador.
 *
 * Carga un parque, le mete las fotos termicas sinteticas y verifica que
 * encuentre el parche caliente EN EL TRACKER CORRECTO. Es la prueba que
 * cubre la cadena entera: leer el crudo, proyectar la foto sobre el parque,
 * medir cada modulo y compararlo con sus vecinos del mismo string.
 */
import { chromium } from "playwright";
import { readdirSync } from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:4173";
const TRACKER_CALIENTE = "05-004";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1500 } });
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

await page.getByRole("button", { name: "Analizar un vuelo" }).first().click();
await page.getByRole("heading", { name: "Analizar un vuelo" }).waitFor();

// Todas las termicas de una.
const nombres = readdirSync("public/termicas").filter((f) => f.endsWith(".jpg")).sort();
const files = [];
for (const n of nombres) {
  const r = await page.request.get(`${BASE}/termicas/${n}`);
  files.push({ name: n, mimeType: "image/jpeg", buffer: Buffer.from(await r.body()) });
}
await page.locator('.drop input[type="file"]').setInputFiles(files);
console.log(`Cargadas ${files.length} fotos termicas.`);

await page.getByRole("heading", { name: "Que encontro" }).waitFor({ timeout: 60000 });
const stats = (await page.locator(".stats").first().innerText()).replace(/\n/g, " ");
console.log("Resumen:", stats);

const camara = await page.locator(".muted.small").first().innerText();
console.log("Camara deducida:", camara.replace(/\n/g, " ").slice(0, 110));
if (!/45\.8/.test(camara)) { console.error("ESPERABA que dedujera 45.8 grados de la foto"); process.exitCode = 1; }

// La tabla de hallazgos: el mas caliente tiene que ser del tracker esperado.
await page.getByRole("heading", { name: "Los hallazgos" }).scrollIntoViewIfNeeded();
const filas = await page.locator("table").last().locator("tbody tr").allInnerTexts();
console.log(`Hallazgos listados: ${filas.length}`);
filas.slice(0, 5).forEach((f) => console.log("   " + f.replace(/\t/g, " · ")));

if (!filas.length) { console.error("ERROR: no encontro ningun hallazgo"); process.exitCode = 1; }
else {
  const tracker = filas[0].split("\t")[1];
  console.log(`Tracker mas caliente: ${tracker}  (esperado ${TRACKER_CALIENTE})`);
  if (tracker !== TRACKER_CALIENTE) {
    console.error(`ERROR: el parche estaba en ${TRACKER_CALIENTE}`); process.exitCode = 1;
  }
  const otros = new Set(filas.map((f) => f.split("\t")[1]));
  console.log(`Trackers marcados: ${[...otros].join(", ")}`);
}

// El mapa tiene que estar dibujado y responder al toque.
const canvas = page.locator(".plot canvas").first();
await canvas.waitFor();
// El vuelo no cubre el bloque entero, asi que el centro del lienzo puede caer
// en una zona sin modulos medidos. Se prueban varios puntos.
const box = await canvas.boundingBox();
let detalle = "";
for (const [fx, fy] of [[0.5,0.5],[0.25,0.3],[0.75,0.3],[0.25,0.7],[0.5,0.2]]) {
  await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
  detalle = await page.locator(".note").first().innerText({ timeout: 2000 }).catch(() => "");
  if (/modulo/.test(detalle)) break;
}
console.log("Al tocar el mapa:", detalle.replace(/\n/g, " ").slice(0, 130));
if (!/modulo/.test(detalle)) { console.error("ESPERABA el detalle del modulo tocado"); process.exitCode = 1; }

await page.screenshot({ path: "shots/13-analisis.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
