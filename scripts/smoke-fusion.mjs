/** Prueba de humo de la fusion: cargar un segundo Excel suma bloques al parque. */
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });

async function cargar(archivo) {
  const r = await page.request.get(`${BASE}/${archivo}`);
  await page.locator('.drop input[type="file"]').setInputFiles({
    name: archivo, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await r.body()),
  });
  await page.getByRole("heading", { name: /Que es cada columna/ }).waitFor();
// El archivo de ejemplo viene en UTM y la zona ya no se hereda de Edenvale:
// hay que decirla, igual que en un parque nuevo de verdad.
await page.getByLabel("Zona").fill("56");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("heading", { name: /Revision/ }).waitFor();
  await page.waitForTimeout(500);
}

await page.goto(BASE, { waitUntil: "networkidle" });

// Primer Excel: bloque 05.
await page.getByRole("button", { name: "Cargar el primero" }).click();
await cargar("ejemplo-picas.xlsx");
await page.getByRole("button", { name: /Guardar el parque/ }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

/*
  El tablero de la tarjeta de parque, leido por su rotulo.

  Los datos eran tres renglones de texto mono seguidos y ahora son casillas con
  rotulo. Se leen por el rotulo y no por posicion: si manana se agrega una
  casilla al tablero, esto sigue andando.
*/
const datoDelParque = async (rotulo) => {
  const casillas = await page.locator(".farm-datos div").allInnerTexts();
  const c = casillas.find((t) => t.toLowerCase().includes(rotulo.toLowerCase()));
  return c ? c.split("\n")[0].trim() : null;
};

console.log(`Despues del primer Excel: ${await datoDelParque("filas")} filas en ${await datoDelParque("bloques")} bloques.`);

// Segundo Excel: bloque 06, agregado al mismo parque.
await page.getByRole("button", { name: "Agregar geometria" }).first().click();
await page.getByRole("heading", { name: /Agregar mas geometria/ }).waitFor();
const aviso = await page.locator(".note.ok").first().innerText();
console.log("Aviso al entrar:", aviso.replace(/\s+/g, " ").trim());

await cargar("ejemplo-picas-bloque2.xlsx");
const resumen = await page.locator(".note.ok").first().innerText();
console.log("Resumen de la fusion:", resumen.replace(/\s+/g, " ").trim());
await page.screenshot({ path: "shots/9-fusion.png", fullPage: true });

await page.getByRole("button", { name: /Agregar al parque/ }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

const filas = await datoDelParque("filas");
const bloques = await datoDelParque("bloques");
console.log(`Despues del segundo Excel: ${filas} filas en ${bloques} bloques.`);
if (filas !== "48" || bloques !== "2") {
  console.error("ESPERABA 48 filas en 2 bloques"); process.exitCode = 1;
}
const parques = await page.locator(".farms > li").count();
if (parques !== 1) { console.error("ESPERABA UN solo parque, hay " + parques); process.exitCode = 1; }
else console.log("Sigue habiendo un solo parque  ✓");

await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
