/**
 * Corregir la zona UTM de un parque ya cargado, en el navegador de verdad.
 *
 * Esta prueba existe por un error mio de proceso, no de codigo. Le dije al
 * operador que cambiara la zona en "Ajustar parametros" sin abrir esa pantalla
 * para ver si la opcion estaba. No estaba. Y el parque —Wellington North,
 * cargado con la zona 56 en vez de la 55, con los planos y la lista de strings
 * ya aplicados encima— solo se podia arreglar volviendo a importar las
 * coordenadas, o sea tirando todo ese trabajo.
 *
 * Un test unitario no lo hubiera cazado: la funcion de conversion siempre
 * estuvo bien. Lo que faltaba era el camino en la pantalla. Por eso esto se
 * prueba clickeando, de punta a punta:
 *
 *   cargar un parque en UTM  ->  guardarlo  ->  volver a entrar por
 *   "Ajustar parametros"  ->  cambiar la zona  ->  guardar  ->
 *   comprobar que las coordenadas SE MOVIERON
 *
 * El ultimo paso es el que importa. Cambiar el numero del perfil y dejar las
 * filas donde estaban seria peor que el error original: el parque diria una
 * zona y estaria dibujado en otra.
 *
 *   npm run build:app && npx vite preview --port 4173 &
 *   node scripts/smoke-zona.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:4173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });
page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLA:", m.text()); });

function mal(msg) { console.error("FALLO:", msg); process.exitCode = 1; }

await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Parques" }).waitFor();

// --- cargar un parque en UTM, con la zona EQUIVOCADA a proposito -----------
await page.getByRole("button", { name: "Cargar el primero" }).click();
await page.getByRole("heading", { name: /El archivo de coordenadas/ }).waitFor();
const res = await page.request.get(`${BASE}/ejemplo-picas.xlsx`);
await page.setInputFiles('input[type="file"]', {
  name: "ejemplo-picas.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await res.body()),
});
await page.getByRole("heading", { name: /Que es cada columna/ }).waitFor();
await page.getByLabel("Zona").fill("56");
await page.waitForTimeout(300);

// Donde dice la app que cae el parque con la zona 56.
const antes = await page.locator(".note", { hasText: /El parque cae ac/ }).first().innerText();
const mAntes = /(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(antes);
if (!mAntes) mal("no encontre el punto del parque con la zona 56");
const lonAntes = Number(mAntes[2]);
console.log(`Con la zona 56 el parque cae en ${mAntes[1]}, ${mAntes[2]}`);

// La ayuda de las zonas vecinas: es lo que convierte "cayo en el mar" en algo
// accionable. Si desaparece, el operador vuelve a quedar sin saber que tocar.
const vecinas = await page.locator(".help", { hasText: /zona de al lado/ }).count();
if (!vecinas) mal("no aparece la ayuda de las zonas vecinas");

await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("heading", { name: /Como esta armado/ }).waitFor();
await page.getByPlaceholder(/Edenvale/).fill("Parque zona equivocada");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("heading", { name: /^4 · Revision$/ }).waitFor();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();
console.log("Parque guardado con la zona 56.");

// --- entrar por "Ajustar parametros" y corregirla --------------------------
// El paso que no existia.
await page.getByRole("button", { name: "Ajustar parametros" }).first().click();
await page.getByRole("heading", { name: /Como esta armado/ }).waitFor();

const selector = page.getByLabel("Zona UTM");
if (!(await selector.count())) {
  mal('no hay selector de "Zona UTM" en Ajustar parametros — el parque no se puede corregir');
  await browser.close();
  process.exit(1);
}
const zonaGuardada = await selector.inputValue();
if (zonaGuardada !== "56") mal(`el selector arranca en ${zonaGuardada}, tenia que arrancar en la zona guardada (56)`);

await selector.selectOption("55");
await page.waitForTimeout(300);

// El aviso de a donde se va a mover, ANTES de guardar.
const aviso = await page.locator(".note.bad", { hasText: /se mueve/ }).first().innerText();
console.log("Aviso:", aviso.replace(/\s+/g, " ").trim().slice(0, 160));
if (!/6° de longitud/.test(aviso)) mal("el aviso no dice cuanto se mueve");
if (!/oeste/.test(aviso)) mal("el aviso no dice para que lado");
if (!(await page.locator("a", { hasText: /ver en el mapa/ }).count())) mal("falta el link al mapa");

await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("heading", { name: /^4 · Revision$/ }).waitFor();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Guardar los parametros" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

// --- lo unico que prueba algo: ¿se movieron las filas? ---------------------
// Se lee del parque guardado, no de la pantalla: la pantalla puede mostrar
// bien un dato que no se guardo.
await page.getByRole("button", { name: "Ajustar parametros" }).first().click();
await page.getByRole("heading", { name: /Como esta armado/ }).waitFor();
const zonaAhora = await page.getByLabel("Zona UTM").inputValue();
if (zonaAhora !== "55") mal(`la zona guardada quedo en ${zonaAhora}, esperaba 55`);

await page.getByRole("banner").getByRole("button", { name: "Cancelar" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

// Sin acceso directo a la base, se comprueba por el camino del operador: la
// pantalla de localizar. Con el parque movido 6 grados al oeste, la coordenada
// que antes caia adentro ahora tiene que caer lejos.
await page.locator(".farm-open").first().click();
await page.getByRole("heading", { name: "Localizar" }).waitFor();
await page.locator("textarea").fill("27 24 0.6 S, 152 42 0.0 E");
await page.getByRole("button", { name: "Localizar" }).click();
await page.waitForTimeout(400);
const r1 = (await page.locator(".answer").count()) ? await page.locator(".answer").first().innerText() : "(sin respuesta)";
console.log("Con la coordenada vieja:", r1.replace(/\s+/g, " ").trim().slice(0, 120));

await page.locator("textarea").fill("27 24 0.6 S, 146 42 0.0 E");
await page.getByRole("button", { name: "Localizar" }).click();
await page.waitForTimeout(400);
const r2 = (await page.locator(".answer").count()) ? await page.locator(".answer").first().innerText() : "(sin respuesta)";
console.log("Con la coordenada movida 6° al oeste:", r2.replace(/\s+/g, " ").trim().slice(0, 120));

if (!/Bloque/.test(r2)) {
  mal("despues de corregir la zona, la coordenada 6° al oeste NO cae en el parque: las filas no se movieron");
}
if (/Bloque/.test(r1)) {
  mal("la coordenada vieja sigue cayendo en el parque: la zona cambio pero las filas quedaron donde estaban");
}

if (lonAntes < 150) mal("esperaba que la zona 56 pusiera el parque al este de 150°");

await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
