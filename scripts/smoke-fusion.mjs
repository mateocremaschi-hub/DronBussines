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
const antes = await page.locator(".farm-open .mono").first().innerText();
console.log("Despues del primer Excel:", antes.trim());

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

const despues = await page.locator(".farm-open .mono").first().innerText();
console.log("Despues del segundo Excel:", despues.trim());
if (!/48 filas en 2 bloques/.test(despues)) {
  console.error("ESPERABA 48 filas en 2 bloques"); process.exitCode = 1;
}
const parques = await page.locator(".farms > li").count();
if (parques !== 1) { console.error("ESPERABA UN solo parque, hay " + parques); process.exitCode = 1; }
else console.log("Sigue habiendo un solo parque  ✓");

await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
