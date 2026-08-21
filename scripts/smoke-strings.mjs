/** Prueba de humo de la lista de strings, con dos filas de titulo y caja combinada. */
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1100 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });

await page.goto(BASE, { waitUntil: "networkidle" });

// Parque con geometria.
await page.getByRole("button", { name: "Cargar el primero" }).click();
const x = await page.request.get(`${BASE}/ejemplo-picas.xlsx`);
await page.setInputFiles('input[type="file"]', {
  name: "ejemplo-picas.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await x.body()),
});
await page.getByRole("heading", { name: /Que es cada columna/ }).waitFor();
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

const antes = await page.locator(".farm-open").first().innerText();
console.log("Antes:", antes.split("\n").filter(l => l.includes("%")).join(" "));

// Lista de strings.
await page.getByRole("button", { name: "Lista de strings" }).first().click();
await page.getByRole("heading", { name: "Lista de strings" }).waitFor();

const s = await page.request.get(`${BASE}/ejemplo-strings.xlsx`);
await page.locator('.drop input[type="file"]').setInputFiles({
  name: "ejemplo-strings.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await s.body()),
});
await page.waitForTimeout(800);

// El archivo tiene dos filas de titulo: hay que subir la fila de encabezados a 3.
let cruzados = await page.locator(".stats").first().innerText().catch(() => "");
console.log("Con encabezados en la fila 1:", cruzados.replace(/\n/g, " ") || "(no reconocio columnas)");

await page.getByLabel("Fila de encabezados").fill("3");
await page.waitForTimeout(900);

cruzados = await page.locator(".stats").first().innerText();
console.log("Con encabezados en la fila 3:", cruzados.replace(/\n/g, " "));
if (!/48/.test(cruzados)) { console.error("ESPERABA 48 strings leidos"); process.exitCode = 1; }

const lineas = await page.locator(".stats").nth(1).innerText().catch(() => "");
console.log("Lineas electricas:", lineas.replace(/\n/g, " "));

const tabla = await page.locator("table").last().innerText();
console.log("Primeras cajas:");
tabla.split("\n").slice(1, 4).forEach((l) => console.log("   " + l.replace(/\t/g, " · ")));

await page.screenshot({ path: "shots/10-strings.png", fullPage: true });
await page.getByRole("button", { name: "Aplicar al parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

const despues = await page.locator(".farm-open").first().innerText();
const linea = despues.split("\n").find((l) => l.includes("%")) ?? "";
console.log("Despues:", linea);
if (!/100 % con numero de string/.test(linea)) {
  console.error("ESPERABA 100 % con numero de string"); process.exitCode = 1;
}

await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
