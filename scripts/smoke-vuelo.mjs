/**
 * Prueba de humo del lote de vuelo: carga las 7 fotos de ejemplo, revisa que
 * las 6 con GPS se ubiquen y que la que no tiene se reporte sin voltear el lote.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:4173";
const FOTOS = ["PICA_0001","PICA_0002","PICA_0003","PICA_0004","PICA_0005","PICA_0006","SIN_GPS"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });

await page.goto(BASE, { waitUntil: "networkidle" });

// Alta del parque con el Excel de ejemplo.
await page.getByRole("button", { name: "Cargar el primero" }).click();
const xlsx = await page.request.get(`${BASE}/ejemplo-picas.xlsx`);
await page.setInputFiles('input[type="file"]', {
  name: "ejemplo-picas.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await xlsx.body()),
});
await page.getByRole("heading", { name: /Que es cada columna/ }).waitFor();
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

// Al lote de vuelo.
await page.getByRole("button", { name: "Inspecciones" }).first().click();
await page.getByRole("button", { name: "Crear el primero" }).click();
await page.getByRole("heading", { name: "Condiciones del vuelo" }).waitFor();

await page.getByLabel("Irradiancia (W/m²)").fill("820");
await page.getByLabel("Viento (m/s)").fill("2.5");

const files = [];
for (const n of FOTOS) {
  const r = await page.request.get(`${BASE}/fotos-ejemplo/${n}.JPG`);
  files.push({ name: `${n}.JPG`, mimeType: "image/jpeg", buffer: Buffer.from(await r.body()) });
}
await page.locator('.drop input[type="file"]').setInputFiles(files);

await page.getByRole("heading", { name: "Resumen" }).waitFor({ timeout: 30000 });
await page.waitForTimeout(800);

const stats = await page.locator(".stats div").allInnerTexts();
console.log("Resumen:", stats.map((s) => s.replace(/\n/g, " ")).join(" · "));

const hallazgos = await page.locator(".hallazgo").count();
console.log("Hallazgos en pantalla:", hallazgos);
if (hallazgos !== 6) { console.error("ESPERABA 6 hallazgos (la septima no tiene GPS)"); process.exitCode = 1; }

const sinGps = await page.locator(".warnbox", { hasText: "sin coordenada" }).count();
if (!sinGps) { console.error("ESPERABA el aviso de la foto sin GPS"); process.exitCode = 1; }
else console.log("La foto sin GPS se reporto sin voltear el lote  ✓");

const direcciones = await page.locator(".hallazgo .answer").allInnerTexts();
console.log("Ubicaciones:");
for (const d of direcciones) console.log("   " + d.replace(/\s+/g, " ").trim());
if (direcciones.some((d) => /Sin ubicar/.test(d))) {
  console.error("ALGUNA foto con GPS no se pudo ubicar"); process.exitCode = 1;
}

const thumbs = await page.locator(".hallazgo-top img").count();
console.log("Miniaturas generadas:", thumbs);

// Clasificar una y confirmarla.
const primera = page.locator(".hallazgo").first();
await primera.getByLabel("Anomalia").selectOption("Punto caliente");
await primera.getByLabel("Clase").selectOption("3");
await primera.getByRole("button", { name: "Confirmar" }).click();
await page.waitForTimeout(400);

await page.screenshot({ path: "shots/8-vuelo.png", fullPage: true });

const stats2 = await page.locator(".stats div").allInnerTexts();
console.log("Tras clasificar:", stats2.map((s) => s.replace(/\n/g, " ")).join(" · "));

await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
