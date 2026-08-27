/**
 * Prueba de humo del paquete de garantias.
 *
 * Es la pantalla que convierte el informe en plata, asi que lo que se prueba
 * aca no es que se dibuje: es que el criterio llegue vivo hasta el CSV.
 *
 *   1. Que un vuelo analizado quede guardado y aparezca en garantias.
 *   2. Que clasificar un hallazgo lo mueva de bolsillo.
 *   3. Que sin irradiancia avise, y que al cargarla se destrabe.
 *   4. Que la clasificacion sobreviva a recargar la pagina — son horas de
 *      trabajo y perderlas seria inaceptable.
 */
import { chromium } from "playwright";
import { readdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:4173";
const fallar = (m) => { console.error("ERROR:", m); process.exitCode = 1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
page.on("pageerror", (e) => fallar(`pagina: ${e.message}`));

// --- Un parque y un vuelo -------------------------------------------------
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

await page.getByRole("button", { name: "Analizar un vuelo" }).first().click();
const nombres = readdirSync("public/termicas").filter((f) => f.endsWith(".jpg")).sort();
const files = [];
for (const n of nombres) {
  const r = await page.request.get(`${BASE}/termicas/${n}`);
  files.push({ name: n, mimeType: "image/jpeg", buffer: Buffer.from(await r.body()) });
}
await page.locator('.drop input[type="file"]').setInputFiles(files);
await page.getByRole("heading", { name: "Que encontro" }).waitFor({ timeout: 60000 });

// --- A garantias ----------------------------------------------------------
await page.getByRole("button", { name: /Armar los reclamos/ }).click();
await page.getByRole("heading", { name: "Paquete de garantias" }).waitFor();

const stat = async (etiqueta) => {
  const t = await page.locator(".stats div", { hasText: etiqueta }).first().innerText();
  return Number(t.split("\n")[0]);
};

const sinClasificarAlPrincipio = await stat("sin clasificar");
console.log(`Sin clasificar al abrir: ${sinClasificarAlPrincipio}`);
if (!sinClasificarAlPrincipio) fallar("esperaba que todo arranque sin clasificar");

const filas = page.locator("table").last().locator("tbody tr");
const cuantas = await filas.count();
console.log(`Reclamos en la lista: ${cuantas}`);
if (!cuantas) fallar("no hay ningun reclamo listado");

// --- Clasificar mueve de bolsillo ----------------------------------------
await filas.nth(0).locator("select").selectOption("Diodo de bypass activado");
await filas.nth(1).locator("select").selectOption("Modulos mal inclinados");
await page.waitForTimeout(300);

const modulos = await stat("fabricante de modulos");
const trackers = await stat("fabricante de trackers");
console.log(`Modulos: ${modulos} · Trackers: ${trackers}`);
if (trackers !== 1) fallar(`esperaba 1 reclamo de trackers, hay ${trackers}`);
// Un tracker mal inclinado NO puede caer en el bolsillo de modulos: es la
// separacion que hace que el reclamo prospere.
if (modulos > 1) fallar(`el tracker se filtro al bolsillo de modulos (${modulos})`);

// --- Sin irradiancia el paquete no se presenta ---------------------------
const arreglar = await page.locator(".card", { hasText: "Que arreglar primero" }).innerText();
if (!/irradiancia/i.test(arreglar)) fallar("no avisa que falta la irradiancia");
console.log("Avisa lo que falta:", arreglar.split("\n").slice(-2).join(" · "));

await page.getByLabel("Puesta en marcha").fill("2021-06-01");
await page.getByLabel(/modulos$/).fill("12");
await page.getByLabel(/trackers$/).fill("10");
await page.getByLabel("Fecha del vuelo").fill("2026-03-25");
await page.getByLabel(/Irradiancia/).fill("820");
await page.waitForTimeout(300);

const bajo = await page.locator(".alert").count();
if (bajo) fallar("marca irradiancia baja con 820 W/m2");

// Marcar la foto visible tiene que bajar en uno el reclamo que la pedia.
const cuentaDe = async (texto) => {
  const t = await page.locator(".card", { hasText: "Que arreglar primero" })
    .locator("tbody tr", { hasText: texto }).first().innerText();
  return Number(t.split("\t")[0]);
};
const rgbAntes = await cuentaDe("foto visible");
await filas.nth(0).locator('input[type="checkbox"]').check();
await page.waitForTimeout(300);
const rgbDespues = await cuentaDe("foto visible");
console.log(`Reclamos sin foto visible: ${rgbAntes} → ${rgbDespues}`);
if (rgbDespues !== rgbAntes - 1) fallar("marcar la foto RGB no descuenta el faltante");

/**
 * Y sin la lista de strings del cliente, NINGUNO queda listo.
 *
 * Es lo que tiene que pasar. Un reclamo que no nombra el activo con la
 * nomenclatura del cliente no lo puede ejecutar su propio equipo de O&M: el
 * fabricante lo acepta y despues nadie encuentra el modulo. La app prefiere
 * decir que falta antes que dar por bueno un paquete que no lo esta.
 */
const resumen = await page.locator(".muted.small").first().innerText();
console.log("Resumen:", resumen.replace(/\n/g, " "));
if (!/0 de \d+ listos/.test(resumen)) {
  fallar("dio reclamos por listos sin la lista de strings del cliente");
}
const faltaString = await cuentaDe("etiqueta de string");
if (faltaString !== cuantas) fallar("no reclama la lista de strings en todos");
console.log(`Bloqueados por falta de lista de strings: ${faltaString} de ${cuantas} — correcto`);

// --- La regla del string entero ------------------------------------------
const detalle = await page.locator(".warnbox", { hasText: "Por que rebotarian" }).count();
console.log(`Detalle de los que rebotarian: ${detalle ? "presente" : "no hace falta"}`);

// --- Sobrevive a recargar -------------------------------------------------
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Parques" }).waitFor();
await page.getByRole("button", { name: "Garantias" }).first().click();
await page.getByRole("heading", { name: "Paquete de garantias" }).waitFor();

const trasRecarga = await stat("fabricante de trackers");
const irradiancia = await page.getByLabel(/Irradiancia/).inputValue();
console.log(`Tras recargar → trackers: ${trasRecarga} · irradiancia: ${irradiancia}`);
if (trasRecarga !== 1) fallar("se perdio la clasificacion al recargar");
if (irradiancia !== "820") fallar("se perdieron las condiciones del vuelo al recargar");

// --- El archivo que se entrega -------------------------------------------
const [descarga] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Exportar el paquete" }).click(),
]);
const csv = (await (await descarga.createReadStream()).toArray()).join("");
const cabecera = csv.split("\n")[0];
for (const col of ["canal", "que_le_falta", "por_que_este_canal", "irradiancia_wm2"]) {
  if (!cabecera.includes(col)) fallar(`al CSV le falta la columna ${col}`);
}
if (!/Garantia del fabricante de trackers/.test(csv)) fallar("el CSV no lleva el reclamo de trackers");
console.log(`CSV: ${csv.split("\n").length - 1} filas · ${cabecera.split(",").length} columnas`);

await browser.close();
console.log(process.exitCode ? "\nCON ERRORES" : "\nOK");
