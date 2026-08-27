/** Prueba de humo del planificador de vuelo. */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
// El archivo de ejemplo viene en UTM y la zona ya no se hereda de Edenvale:
// hay que decirla, igual que en un parque nuevo de verdad.
await page.getByLabel("Zona").fill("56");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

await page.getByRole("button", { name: "Planificar vuelo" }).first().click();
await page.getByRole("heading", { name: "Planificar el vuelo" }).waitFor();

// El parque de ejemplo tiene dos bloques: tiene que ofrecer el plan por bloque.
const organiza = await page.locator(".card").nth(2).innerText();
console.log("Organizacion:", organiza.split("\n").filter(l => /bloques|horas|baterias|salidas/.test(l)).join(" · "));
// El Excel de ejemplo trae un solo bloque; el reparto en varios lo cubren los
// tests unitarios. Aca alcanza con que la tabla exista y se pueda elegir.
const filasBloque = await page.locator('input[name="bloque"]').count();
console.log(`Bloques en la tabla: ${filasBloque}`);
if (filasBloque < 1) { console.error("ESPERABA al menos 1 bloque"); process.exitCode = 1; }
const sinElegir = (await page.locator(".note").allInnerTexts()).join(" ");
if (!/Elegi una fila/.test(sinElegir)) { console.error("ESPERABA el aviso de elegir una fila"); process.exitCode = 1; }

// Con un solo bloque la casilla de agrupar no cambia nada, pero tiene que estar.
const agrupar = page.getByText("Juntar los bloques que comparten pasada");
if (await agrupar.count()) console.log("Opcion de agrupar: presente");
else { console.error("ESPERABA la opcion de agrupar bloques"); process.exitCode = 1; }

await page.locator('input[name="bloque"]').first().check();
await page.waitForTimeout(400);

const leer = async () => (await page.locator(".stats").allInnerTexts()).slice(1).join(" · ").replace(/\n/g, " ");
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
await page.getByRole("button", { name: "KML para Google Earth" }).click();
const d = await kml;
console.log("Descarga KML:", d.suggestedFilename());

// El KMZ es el que se vuela, asi que se descarga y se abre de verdad: lo que
// decide si el archivo sirve son las rutas que tiene adentro.
const kmzEvt = page.waitForEvent("download");
await page.getByRole("button", { name: "Exportar KMZ para DJI Pilot 2" }).click();
const kmz = await kmzEvt;
const destino = `/tmp/smoke-${kmz.suggestedFilename()}`;
await kmz.saveAs(destino);
const dir = mkdtempSync(join(tmpdir(), "kmz-smoke-"));
execFileSync("unzip", ["-q", destino, "-d", dir]);
const dentro = readdirSync(join(dir, "wpmz")).sort();
console.log("Descarga KMZ:", kmz.suggestedFilename(), "→", dentro.join(", "));
if (dentro.join(",") !== "template.kml,waylines.wpml") {
  console.error("ERROR: el KMZ no trae wpmz/template.kml y wpmz/waylines.wpml");
  process.exitCode = 1;
}
const wpml = readFileSync(join(dir, "wpmz", "waylines.wpml"), "utf8");
const tpl = readFileSync(join(dir, "wpmz", "template.kml"), "utf8");
const puntos = (x) => (x.match(/<coordinates>/g) ?? []).length;
console.log(`Waypoints: ${puntos(tpl)} en template, ${puntos(wpml)} en waylines`);
if (!puntos(tpl) || puntos(tpl) !== puntos(wpml)) {
  console.error("ERROR: los waypoints no coinciden entre los dos archivos");
  process.exitCode = 1;
}
for (const req of ["gimbalPitchRotateAngle>-90", "multipleDistance", "relativeToStartPoint"]) {
  if (!wpml.includes(req)) { console.error(`ERROR: al wpml le falta ${req}`); process.exitCode = 1; }
}

// El aviso de altura tiene que estar en la pantalla, no solo en el archivo.
const antesDeCopiar = await page.locator(".warnbox", { hasText: "Antes de copiarlo" }).innerText();
console.log("Avisos:", antesDeCopiar.split("\n").slice(1).join(" · ").slice(0, 120));

await page.screenshot({ path: "shots/12-vuelo.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
