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

// --- entrar por "Ajustar parametros" y corregirlo ------------------------
//
// PRIMERO se entra y se GUARDA sin tocar nada. Eso reproduce el bug real: esta
// pantalla borraba la zona UTM del parque al guardar, porque su estado de CRS
// arrancaba en "grados decimales". Despues, al querer corregir la zona, no
// habia zona que corregir — la habia borrado ella misma.
await page.getByRole("button", { name: "Ajustar parametros" }).first().click();
await page.getByRole("heading", { name: /Como esta armado/ }).waitFor();

const titulo = await page.locator("h1").first().innerText();
if (!/Ajustar los parametros/i.test(titulo)) {
  mal(`el titulo dice "${titulo}" — tiene que decir en que pantalla estas`);
}

await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("heading", { name: /^4 · Revision$/ }).waitFor();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Guardar los parametros" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();
console.log("Guardado sin tocar nada (aca antes se perdia la zona).");

// Ahora si, corregirlo. Tiene que poder aunque el paso anterior haya tocado el
// perfil: el arreglo no puede depender de un dato que se pueda perder.
await page.getByRole("button", { name: "Ajustar parametros" }).first().click();
await page.getByRole("heading", { name: /Como esta armado/ }).waitFor();

const tarjeta = page.locator(".note", { hasText: /Donde cae el parque/ });
if (!(await tarjeta.count())) {
  mal("no aparece la tarjeta de donde cae el parque");
  await browser.close();
  process.exit(1);
}
console.log("Tarjeta:", (await tarjeta.first().innerText()).replace(/\s+/g, " ").trim().slice(0, 90));

await page.getByRole("button", { name: /Cayo en el lugar equivocado/ }).click();
await page.waitForTimeout(200);

// La zona de origen se PIDE. La apuesta puede errarle por una —pasa cuando el
// este esta lejos del meridiano central— asi que tiene que ser editable.
const origen = page.getByLabel("Zona con la que se importo");
if (!(await origen.count())) mal("no se puede decir con que zona se importo");
console.log("Apuesta de origen:", await origen.inputValue());

await page.getByLabel("Zona correcta").fill("55");
await page.waitForTimeout(300);

const destino = await tarjeta.first().innerText();
console.log("Destino:", destino.replace(/\s+/g, " ").match(/queda en [^.]*/)?.[0] ?? "(no dice)");
if (!/Al guardar, el parque queda en/.test(destino)) mal("no muestra a donde va a quedar");

await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("heading", { name: /^4 · Revision$/ }).waitFor();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Guardar los parametros" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

// La zona guardada tiene que haber seguido al parque: decir 56 con el parque
// dibujado en la 55 es la misma mentira de la que se viene.
await page.getByRole("button", { name: "Ajustar parametros" }).first().click();
await page.getByRole("heading", { name: /Como esta armado/ }).waitFor();
const despues = await page.locator(".note", { hasText: /Donde cae el parque/ }).first().innerText();
console.log("Despues:", despues.replace(/\s+/g, " ").trim().slice(0, 80));

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
