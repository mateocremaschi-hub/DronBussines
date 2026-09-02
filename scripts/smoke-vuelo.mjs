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

/*
  La lista abre filtrada por LA MUESTRA, no por todo.

  Es el cambio de fondo: el motor clasifica los hallazgos por la forma de la
  mancha y la persona revisa un porcentaje de cada tipo, no los tres mil. Asi
  que al abrir un vuelo se ven los que hay que mirar, y el boton dice cuantos
  son. "Todos" sigue estando al lado.
*/
const botonMuestra = page.getByRole("button", { name: /Lo que hay que revisar \((\d+)\)/ });
const cuantos = Number((await botonMuestra.innerText()).match(/\((\d+)\)/)?.[1]);
const enMuestra = await page.locator(".revisor-lista li").count();
console.log(`La muestra a revisar son ${cuantos} de ${antes.hallazgos} hallazgos.`);
if (!(cuantos > 0 && cuantos < antes.hallazgos)) {
  console.error("ESPERABA una muestra menor que el total y mayor que cero"); process.exitCode = 1;
}
if (enMuestra !== cuantos) { console.error("ESPERABA que la lista mostrara la muestra"); process.exitCode = 1; }

// Y que la maquina ya haya clasificado, con el motivo escrito al lado.
const veredicto = await page.locator(".revisor-detalle .note").first().innerText();
console.log("La maquina dice:", veredicto.replace(/\s+/g, " ").slice(0, 120));
if (!/módulo|celda|franja|zona/i.test(veredicto)) {
  console.error("ESPERABA que el hallazgo viniera clasificado y con el motivo"); process.exitCode = 1;
}

await page.getByRole("button", { name: "Todos", exact: true }).click();
await page.waitForTimeout(300);
const enLista = await page.locator(".revisor-lista li").count();
if (enLista !== antes.hallazgos) { console.error("ESPERABA que 'Todos' mostrara los 12"); process.exitCode = 1; }

const primera = await page.locator(".revisor-detalle .answer").innerText();
console.log("El elegido:", primera.replace(/\s+/g, " ").trim());

// Las condiciones no se pierden cuando entra la deteccion.
const irr = await page.getByLabel("Irradiancia (W/m²)").inputValue();
if (irr !== "820") { console.error(`ESPERABA que la irradiancia siguiera en 820, quedo en "${irr}"`); process.exitCode = 1; }
else console.log("Las condiciones sobrevivieron a la deteccion  ✓");

/*
  El teclado, que es el motivo de esta pantalla.

  Sentado en la computadora, clasificar un hallazgo son tres teclas: la letra de
  la anomalia, el numero de la clase, y Enter para confirmar y saltar al
  siguiente. Que eso ande es lo unico que hace distinto revisar cuatrocientos
  modulos de revisar cuarenta.
*/
await page.locator("body").click({ position: { x: 2, y: 2 } });
await page.keyboard.press("q");   // anomalia: punto caliente
await page.keyboard.press("3");   // clase 3
await page.waitForTimeout(200);
const anomalia = await page.getByLabel("Anomalia").inputValue();
console.log(`Con Q y 3: anomalia "${anomalia}"`);
if (anomalia !== "Punto caliente") { console.error("ESPERABA que Q pusiera 'Punto caliente'"); process.exitCode = 1; }

await page.keyboard.press("Enter");   // confirmar y pasar al siguiente
await page.waitForTimeout(400);
const segunda = await page.locator(".revisor-detalle .answer").innerText();
console.log("Tras Enter, el elegido:", segunda.replace(/\s+/g, " ").trim());
if (segunda === primera) { console.error("ESPERABA que Enter pasara al siguiente"); process.exitCode = 1; }

const despues = await leerStats();
console.log("Tras clasificar con el teclado:", JSON.stringify(despues));
if (despues.confirmados !== 1) { console.error("ESPERABA 1 confirmado"); process.exitCode = 1; }
if (despues.pendientes !== antes.pendientes - 1) { console.error("ESPERABA un pendiente menos"); process.exitCode = 1; }
if (despues["clase 3"] !== 1) { console.error("ESPERABA 1 de clase 3"); process.exitCode = 1; }

// Con el foco en un campo de texto las letras se escriben, no clasifican.
const nota = page.locator("#revisor-nota");
await nota.click();
await nota.type("xq3");
await page.waitForTimeout(250);
console.log(`Escribiendo en la nota quedo "${await nota.inputValue()}"`);
if ((await nota.inputValue()) !== "xq3") { console.error("ESPERABA que las letras se escribieran en la nota"); process.exitCode = 1; }
const trasEscribir = await leerStats();
if (trasEscribir.confirmados !== despues.confirmados) {
  console.error("ESCRIBIR en la nota clasifico hallazgos: los atajos no se apagaron"); process.exitCode = 1;
} else console.log("Los atajos se apagan adentro del campo de texto  ✓");
await page.keyboard.press("Escape");

/*
  El mapa como navegacion: del parque al bloque.
*/
const mapa = page.locator(".mapa canvas");
const cajaMapa = await mapa.boundingBox();
await mapa.click({ position: { x: cajaMapa.width / 2, y: cajaMapa.height / 2 } });
await page.waitForTimeout(300);
const barra = await page.locator(".mapa-barra").innerText();
console.log("Al entrar a un bloque:", barra.replace(/\n/g, " · "));
if (!/Bloque /.test(barra)) { console.error("ESPERABA entrar al bloque desde el mapa"); process.exitCode = 1; }
await page.getByRole("button", { name: /Todo el parque/ }).click();
await page.waitForTimeout(200);

/*
  El filtro: revisar cientos de hallazgos sin poder esconder los hechos no se hace.

  Se lo agarra por la fila que tiene el boton "Sin ubicar", que es solo de los
  filtros: "Confirmado" suelto agarra tambien otros botones que dicen lo mismo.
*/
const filtros = page.locator(".row").filter({ has: page.getByRole("button", { name: "Sin ubicar" }) });
await filtros.getByRole("button", { name: "Confirmado", exact: true }).click();
await page.waitForTimeout(300);
const visibles = await page.locator(".revisor-lista li").count();
console.log(`Filtrando por confirmados quedan ${visibles} tarjetas.`);
if (visibles !== 1) { console.error("ESPERABA que el filtro dejara solo la confirmada"); process.exitCode = 1; }
await filtros.getByRole("button", { name: "Todos", exact: true }).click();
await page.waitForTimeout(300);
if (await page.locator(".revisor-lista li").count() !== antes.hallazgos) {
  console.error("ESPERABA que 'Todos' devolviera la lista entera"); process.exitCode = 1;
}

await page.screenshot({ path: "shots/8-vuelo.png", fullPage: true });

await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
