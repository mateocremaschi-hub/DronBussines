/**
 * Prueba de humo de la MITAD DE REVISION del vuelo.
 *
 * `smoke-analisis.mjs` cubre la deteccion: leer el crudo, proyectar cada foto
 * sobre el parque y medir modulo por modulo. Esta cubre lo que viene despues,
 * que es donde el operador pasa el tiempo: clasificar, confirmar, descartar,
 * filtrar y que los contadores digan la verdad.
 *
 * Antes esta prueba miraba otra cosa —un hallazgo por foto, con el ΔT escrito
 * a mano— porque habia dos pantallas y esta cargaba la carpeta por su cuenta.
 * Ese modelo ya no existe: un hallazgo es un MODULO medido. Lo unico que se
 * conserva tal cual es la pregunta de fondo, que sigue siendo la buena: que un
 * archivo raro en la carpeta no voltee el lote entero.
 */
import { chromium } from "playwright";
import { readdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:4173";

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
// El archivo de ejemplo viene en UTM y la zona ya no se hereda de Edenvale:
// hay que decirla, igual que en un parque nuevo de verdad.
await page.getByLabel("Zona").fill("56");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

// Al vuelo. Una sola entrada despues de volar: ver el comentario en smoke-analisis.mjs.
await page.getByRole("button", { name: "Vuelos" }).first().click();
await page.getByRole("heading", { name: "Vuelos" }).waitFor();
await page.getByRole("button", { name: /Crear el primero|Nuevo vuelo/ }).first().click();
await page.getByRole("heading", { name: "Condiciones del vuelo" }).waitFor();

// Las condiciones se cargan antes de las fotos, que es el orden real: el piloto
// las anota al aterrizar. Tienen que sobrevivir a la deteccion.
await page.getByLabel("Irradiancia (W/m²)").fill("820");
await page.getByLabel("Viento (m/s)").fill("2.5");

/*
  La carpeta como sale del dron: las termicas mas las visibles del par.

  Las visibles no traen temperatura adentro y se saltean; lo que se prueba es
  que saltearlas no rompa nada ni cambie la cuenta de hallazgos.
*/
const files = [];
for (const n of readdirSync("public/termicas").filter((f) => f.endsWith(".jpg")).sort()) {
  const r = await page.request.get(`${BASE}/termicas/${n}`);
  files.push({ name: n, mimeType: "image/jpeg", buffer: Buffer.from(await r.body()) });
}
const termicas = files.length;
for (const n of ["PICA_0001", "SIN_GPS"]) {
  const r = await page.request.get(`${BASE}/fotos-ejemplo/${n}.JPG`);
  files.push({ name: `${n}.JPG`, mimeType: "image/jpeg", buffer: Buffer.from(await r.body()) });
}
console.log(`Cargando ${termicas} termicas + ${files.length - termicas} fotos sin temperatura.`);
await page.locator('.drop input[type="file"]').setInputFiles(files);

await page.getByRole("heading", { name: "Resumen" }).waitFor({ timeout: 60000 });
await page.waitForTimeout(500);

const leerStats = async () =>
  Object.fromEntries(
    (await page.locator(".stats").last().locator("div").allInnerTexts()).map((t) => {
      const [n, ...resto] = t.split("\n");
      return [resto.join(" ").trim(), Number(n)];
    }),
  );

const antes = await leerStats();
console.log("Resumen:", JSON.stringify(antes));
if (!antes.hallazgos) { console.error("ERROR: el lote se volteo, no hay hallazgos"); process.exitCode = 1; }
if (antes.pendientes !== antes.hallazgos) { console.error("ESPERABA todos pendientes al empezar"); process.exitCode = 1; }
if (antes["sin ubicar"]) { console.error("ALGUN hallazgo quedo sin ubicar"); process.exitCode = 1; }

const direcciones = await page.locator(".hallazgo .answer").allInnerTexts();
console.log("Primeras ubicaciones:");
for (const d of direcciones.slice(0, 3)) console.log("   " + d.replace(/\s+/g, " ").trim());

// Las condiciones no se pierden cuando entra la deteccion.
const irr = await page.getByLabel("Irradiancia (W/m²)").inputValue();
if (irr !== "820") { console.error(`ESPERABA que la irradiancia siguiera en 820, quedo en "${irr}"`); process.exitCode = 1; }
else console.log("Las condiciones sobrevivieron a la deteccion  ✓");

// Clasificar una y confirmarla: el gesto que se repite cientos de veces.
const primera = page.locator(".hallazgo").first();
await primera.getByLabel("Anomalia").selectOption("Punto caliente");
await primera.getByLabel("Clase").selectOption("3");
await primera.getByRole("button", { name: "Confirmar" }).click();
await page.waitForTimeout(400);

const despues = await leerStats();
console.log("Tras clasificar:", JSON.stringify(despues));
if (despues.confirmados !== 1) { console.error("ESPERABA 1 confirmado"); process.exitCode = 1; }
if (despues.pendientes !== antes.pendientes - 1) { console.error("ESPERABA un pendiente menos"); process.exitCode = 1; }
if (despues["clase 3"] !== 1) { console.error("ESPERABA 1 de clase 3"); process.exitCode = 1; }

/*
  El filtro: revisar cientos de hallazgos sin poder esconder los hechos no se hace.

  Se lo agarra por la fila que tiene el boton "Sin ubicar", que es solo de los
  filtros. Buscar "Confirmado" suelto agarra tambien el boton de la tarjeta que
  se acaba de confirmar — dice exactamente lo mismo.
*/
const filtros = page.locator(".row").filter({ has: page.getByRole("button", { name: "Sin ubicar" }) });
await filtros.getByRole("button", { name: "Confirmado", exact: true }).click();
await page.waitForTimeout(300);
const visibles = await page.locator(".hallazgo").count();
console.log(`Filtrando por confirmados quedan ${visibles} tarjetas.`);
if (visibles !== 1) { console.error("ESPERABA que el filtro dejara solo la confirmada"); process.exitCode = 1; }
await filtros.getByRole("button", { name: "Todos", exact: true }).click();
await page.waitForTimeout(300);
if (await page.locator(".hallazgo").count() !== antes.hallazgos) {
  console.error("ESPERABA que 'Todos' devolviera la lista entera"); process.exitCode = 1;
}

await page.screenshot({ path: "shots/8-vuelo.png", fullPage: true });

await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
