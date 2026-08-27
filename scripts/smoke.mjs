/**
 * Prueba de humo del navegador: recorre el asistente entero con el Excel de
 * ejemplo y saca capturas de cada paso.
 *
 *   npm run build:app && npx vite preview --port 4173 &
 *   node scripts/smoke.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:4173";
const shots = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });
page.on("console", (m) => { if (m.type() === "error") console.error("CONSOLA:", m.text()); });

async function shot(name) {
  await page.screenshot({ path: `shots/${name}.png`, fullPage: true });
  shots.push(name);
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Parques" }).waitFor();
await shot("1-parques-vacio");

await page.getByRole("button", { name: "Cargar el primero" }).click();
await page.getByRole("heading", { name: /El archivo de coordenadas/ }).waitFor();
await shot("2-archivo");

// Sube el Excel de ejemplo servido por la propia app.
const res = await page.request.get(`${BASE}/ejemplo-picas.xlsx`);
await page.setInputFiles('input[type="file"]', {
  name: "ejemplo-picas.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await res.body()),
});

await page.getByRole("heading", { name: /Que es cada columna/ }).waitFor();
// El archivo de ejemplo viene en UTM y la zona ya no se hereda de Edenvale:
// hay que decirla, igual que en un parque nuevo de verdad.
await page.getByLabel("Zona").fill("56");
await page.waitForTimeout(300);
await shot("3-columnas");

// Por contenido y no por "el primer .note": la tarjeta de importacion no es
// siempre la primera, y una prueba que depende del orden de los carteles se
// rompe cada vez que se agrega uno.
const note = await page.locator(".note", { hasText: /filas/ }).first().innerText();
console.log("Resumen de importacion:", note.replace(/\s+/g, " ").trim());
if (!/24 filas/.test(note)) { console.error("ESPERABA 24 filas"); process.exitCode = 1; }

await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("heading", { name: /Como esta armado/ }).waitFor();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await shot("4-parametros");

await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("heading", { name: /^4 · Revision$/ }).waitFor();
await page.waitForTimeout(500);
await shot("5-revision");

const caps = await page.locator(".caps li").allInnerTexts();
console.log(`Informe de capacidad: ${caps.length} lineas`);
const disponibles = await page.locator(".caps li:not(.no)").count();
console.log(`  disponibles: ${disponibles} de ${caps.length}`);

await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();
await shot("6-parque-guardado");

// Modo campo: una coordenada en el medio del primer tracker.
await page.locator(".farm-open").first().click();
await page.getByRole("heading", { name: "Localizar" }).waitFor();
await page.locator("textarea").fill("27 24 0.6 S, 152 42 0.0 E");
await page.getByRole("button", { name: "Localizar" }).click();
await page.waitForTimeout(300);

const answer = await page.locator(".answer").first().innerText();
console.log("Resultado:", answer);
if (!/Bloque/.test(answer)) { console.error("ESPERABA una direccion"); process.exitCode = 1; }

await page.getByRole("button", { name: /Ver el detalle/ }).click();
await page.waitForTimeout(200);
await shot("7-localizar");

await browser.close();
console.log(`\nCapturas: ${shots.join(", ")}`);
console.log(process.exitCode ? "FALLO" : "OK");
