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
// El archivo de ejemplo viene en UTM y la zona ya no se hereda de Edenvale:
// hay que decirla, igual que en un parque nuevo de verdad.
await page.getByLabel("Zona").fill("56");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

/*
  Antes habia dos entradas —"Analizar un vuelo" e "Inspecciones"— que cargaban
  las mismas fotos por caminos que no se cruzaban. Ahora hay una sola: "Vuelos",
  y adentro se crea el vuelo y se le cargan las fotos. La deteccion corre sola
  al cargarlas.
*/
await page.getByRole("button", { name: "Vuelos" }).first().click();
await page.getByRole("heading", { name: "Vuelos" }).waitFor();
await page.getByRole("button", { name: /Crear el primero|Nuevo vuelo/ }).first().click();

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

/*
  La linea de la camara. Se la busca POR SU TEXTO y no por su clase: al unificar
  las dos pantallas aparecieron otros parrafos `.muted.small` antes que este
  —las condiciones del vuelo— y `.first()` empezo a leer el equivocado. El texto
  "campo horizontal" solo lo escribe esta linea.
*/
const camara = await page.getByText(/campo horizontal/).first().innerText();
console.log("Camara deducida:", camara.replace(/\n/g, " ").slice(0, 110));
if (!/45\.8/.test(camara)) { console.error("ESPERABA que dedujera 45.8 grados de la foto"); process.exitCode = 1; }

/*
  La lista de hallazgos, que ahora vive en la misma pantalla que la revision.

  Antes esto miraba una tabla en "Analizar un vuelo", una pantalla aparte que
  guardaba en su propio lugar y no se cruzaba con la revision. Al unificarlas,
  el hallazgo dejo de ser una fila de tabla y paso a ser la tarjeta que se
  revisa — con su foto, su medicion y sus botones. Se busca por el texto de la
  direccion, que es lo que el operador lee.
*/
await page.getByRole("heading", { name: "Resumen" }).scrollIntoViewIfNeeded();
const resumen = (await page.locator(".stats").last().innerText()).replace(/\n/g, " ");
console.log("Resumen del vuelo:", resumen);
/*
  Las direcciones de los hallazgos. Cada tarjeta escribe la suya con
  `formatAddress` en el parrafo `.answer`: "Bloque 05, tracker 05-004 R1,
  string 3, modulo 12 (contando desde la punta norte)". Antes esto miraba una
  tabla y partia por tabuladores; la tabla ya no existe, asi que se saca el
  tracker del propio texto.
*/
const filas = await page.locator(".hallazgo .answer").allInnerTexts();
console.log(`Hallazgos listados: ${filas.length}`);
filas.slice(0, 5).forEach((f) => console.log("   " + f.replace(/\s+/g, " ").trim()));

const trackerDe = (t) => t.match(/tracker\s+(\S+)/)?.[1] ?? null;

if (!filas.length) { console.error("ERROR: no encontro ningun hallazgo"); process.exitCode = 1; }
else {
  const tracker = trackerDe(filas[0]);
  console.log(`Tracker mas caliente: ${tracker}  (esperado ${TRACKER_CALIENTE})`);
  if (tracker !== TRACKER_CALIENTE) {
    console.error(`ERROR: el parche estaba en ${TRACKER_CALIENTE}`); process.exitCode = 1;
  }
  const otros = new Set(filas.map(trackerDe).filter(Boolean));
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
