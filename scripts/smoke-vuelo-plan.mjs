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

/*
  La eleccion de bloques.

  Antes era UNA fila a la vez —un radio `name="bloque"`— y ahora son casillas:
  se marcan los que se van a volar de una salida, que es como se vuela de
  verdad. La prueba sigue el mismo camino: que la tabla exista, que sin marcar
  nada avise, y que marcar cambie el plan.
*/
/*
  El dron por defecto.

  No es un detalle de presentacion: el que no toca nada vuela con lo que diga
  esta lista, y estaba encabezada por un Mavic 3T — un dron que no existe en
  esta operacion. Un default equivocado es una decision tomada por omision.
*/
const dron = await page.locator("#f-cam option:checked").innerText();
console.log("Dron por defecto:", dron);
if (!/Matrice 4T/.test(dron)) { console.error("ESPERABA que viniera elegido el Matrice 4T"); process.exitCode = 1; }

// La velocidad se calcula sola y se dice de donde sale.
const comoVuela = await page.locator("section.card", { hasText: "Cómo vas a volar" }).innerText();
const vel = comoVuela.match(/son ([\d.]+) m\/s/)?.[1];
console.log("Velocidad que calcula la app:", vel, "m/s");
if (!vel || Number(vel) > 5) { console.error("ESPERABA una velocidad calculada y por debajo del techo del M4T"); process.exitCode = 1; }

// Y las dos figuras que contestan si el vuelo sirve, antes de elegir bloques.
const figuras = await page.locator(".loqueve .figura").count();
console.log(`Figuras de "que vas a poder ver": ${figuras}`);
if (figuras !== 2) { console.error("ESPERABA las dos figuras dibujadas"); process.exitCode = 1; }

const tabla = page.locator("section.card", { hasText: "Que bloques vas a volar" });
console.log("Organizacion:", (await tabla.locator(".stats div").allInnerTexts()).map((t) => t.replace(/\n/g, " ")).join(" · "));

const casillas = page.locator('input[type="checkbox"][aria-label^="Bloque "]');
const filasBloque = await casillas.count();
console.log(`Bloques en la tabla: ${filasBloque}`);
if (filasBloque < 1) { console.error("ESPERABA al menos 1 bloque"); process.exitCode = 1; }

const sinElegir = (await page.locator(".note").allInnerTexts()).join(" ");
if (!/Todavia no marcaste ningun bloque/.test(sinElegir)) {
  console.error("ESPERABA el aviso de que no hay ningun bloque marcado"); process.exitCode = 1;
}

// Los atajos de la seleccion multiple, que es lo que se pidio: marcar varios
// sin ir tildando uno por uno.
for (const b of ["Seleccionar todo", "Limpiar", /Sumar los que comparten pasada/]) {
  if (!(await page.getByRole("button", { name: b }).count())) {
    console.error(`ESPERABA el boton ${b}`); process.exitCode = 1;
  }
}

const agrupar = page.getByText("Contar el parque juntando los bloques que comparten pasada");
if (await agrupar.count()) console.log("Opcion de agrupar: presente");
else { console.error("ESPERABA la opcion de agrupar bloques"); process.exitCode = 1; }

await page.getByRole("button", { name: "Seleccionar todo" }).click();
await page.waitForTimeout(400);
const marcadas = await casillas.evaluateAll((els) => els.filter((e) => e.checked).length);
console.log(`Tras "Seleccionar todo" quedan ${marcadas} de ${filasBloque} marcados.`);
if (marcadas !== filasBloque) { console.error("ESPERABA todos los bloques marcados"); process.exitCode = 1; }

const leer = async () => (await page.locator(".stats").allInnerTexts()).slice(1).join(" · ").replace(/\n/g, " ");
console.log("Con los valores por defecto:");
console.log("  " + await leer());

/*
  La altura, que ahora es un deslizador y no un campo con jerga.

  El control cambio porque la pantalla se reescribio para alguien que no hizo
  fotogrametria: se eligen el dron y la altura, y todo lo demas se calcula y se
  dibuja. Lo que se prueba sigue siendo lo mismo — que mover la altura cambie el
  plan de verdad y no solo el numero de la pantalla.
*/
const altura = page.locator("#f-alt");
const antes = await leer();
await altura.fill("20");
await page.waitForTimeout(400);
const despues = await leer();
console.log("A 20 m de altura:");
console.log("  " + despues);
if (antes === despues) { console.error("ERROR: cambiar la altura no cambio el plan"); process.exitCode = 1; }

// Volar muy alto tiene que disparar el aviso de pixeles por modulo.
await altura.fill("120");
await page.waitForTimeout(400);
const aviso = await page.locator(".warnbox").first().innerText().catch(() => "");
console.log("A 120 m:", aviso.split("\n")[0]?.slice(0, 100) ?? "(sin aviso)");
if (!/pixeles/.test(aviso)) { console.error("ERROR: esperaba el aviso de pixeles por modulo"); process.exitCode = 1; }

await altura.fill("35");
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
