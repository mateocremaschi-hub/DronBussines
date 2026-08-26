/**
 * Que la app abra sin internet.
 *
 * Es la premisa entera: se usa parado en una fila de paneles donde no hay
 * señal. Sin service worker el navegador no tiene de donde levantar el HTML y
 * abre en blanco — los datos ya vivian offline en IndexedDB, pero la app no.
 *
 * La prueba corta la red de verdad y recarga.
 */
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4173";
const fallar = (m) => { console.error("ERROR:", m); process.exitCode = 1; };

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
p.on("pageerror", (e) => fallar(`pagina: ${e.message}`));

await p.goto(BASE, { waitUntil: "networkidle" });

// Cargar un parque, para probar que tambien sobreviven los datos.
await p.getByRole("button", { name: "Cargar el primero" }).click();
const x = await p.request.get(`${BASE}/ejemplo-picas.xlsx`);
await p.setInputFiles('input[type="file"]', { name: "e.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await x.body()) });
await p.getByRole("heading", { name: /Que es cada columna/ }).waitFor();
await p.getByRole("button", { name: "Siguiente" }).click();
await p.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await p.getByRole("button", { name: "Siguiente" }).click();
await p.getByRole("button", { name: "Guardar el parque" }).click();
await p.getByRole("heading", { name: "Parques" }).waitFor();

// Esperar a que el service worker tome el control de la pestaña.
await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
  .catch(() => fallar("el service worker nunca tomo el control"));
await p.waitForTimeout(1500);
const pie = await p.locator(".app-foot").innerText();
console.log("Pie:", pie.split("\n")[0]);
if (!/lista para el campo/i.test(pie)) fallar("no avisa que quedo lista para el campo");

// --- Y ahora, sin red ------------------------------------------------------
await ctx.setOffline(true);
console.log("\nRed cortada. Recargando…");
await p.reload({ waitUntil: "domcontentloaded" });
await p.getByRole("heading", { name: "Parques" }).waitFor({ timeout: 15000 })
  .catch(() => fallar("la app NO abrio sin internet"));

const parque = await p.locator(".farm-open").first().innerText().catch(() => "");
console.log("Abrio sin internet y el parque sigue:", parque.split("\n")[0] || "(vacio)");
if (!/Parque de prueba/.test(parque)) fallar("el parque no sobrevivio");

const pieOff = await p.locator(".app-foot").innerText();
console.log("Pie sin red:", pieOff.split("\n")[0]);
if (!/sin internet/i.test(pieOff)) fallar("no reconoce que esta sin red");

// Navegar adentro tiene que seguir andando.
await p.locator(".farm-open").first().click();
await p.getByRole("heading", { name: /Localizar|Donde estoy/i }).waitFor({ timeout: 8000 })
  .catch(() => fallar("no se puede navegar sin internet"));
console.log("Navegacion interna sin red: OK");

await b.close();
console.log(process.exitCode ? "\nFALLO" : "\nOK");
