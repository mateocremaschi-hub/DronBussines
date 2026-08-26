/**
 * Prueba de humo del registro de verificaciones de campo.
 *
 * Lo que importa que funcione: que lo que se toca parado en el tracker quede
 * guardado, y que el parque NO pase a verificado hasta que las tres reglas
 * esten probadas.
 */
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });

await page.goto(BASE, { waitUntil: "networkidle" });

// Parque con geometria de los dos lados de la calle.
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

await page.locator(".farm-open").first().click();
await page.getByRole("heading", { name: "Localizar" }).waitFor();

const estado = async () => (await page.locator(".rules").innerText()).split("\n")
  .filter((l) => l.trim()).map((l) => l.trim());

console.log("Al abrir el parque:");
console.log("  " + (await page.locator(".note").first().innerText()).slice(0, 90) + "…");
for (const l of await estado()) console.log("   ○ " + l);

// Un punto sobre una fila del norte.
async function localizarYConfirmar(coord, etiqueta) {
  await page.locator("textarea").fill(coord);
  await page.getByRole("button", { name: "Localizar", exact: true }).click();
  await page.locator(".verify").waitFor();
  const dijo = await page.locator(".answer").innerText();
  await page.getByRole("button", { name: "Conte y coincide" }).click();
  await page.locator(".verify .note").waitFor();
  console.log(`${etiqueta}: ${dijo}`);
}

// Las coordenadas salen de la geometria de scripts/make-sample.mjs:
// bloque 05 arranca en -27.4, 152.7; el lado sur esta 73 m mas abajo.
await localizarYConfirmar("-27.4001, 152.7", "Punto 1 (norte)");
const trasUno = await page.locator(".card").last().innerText();
if (/se puede reportar/.test(trasUno)) {
  console.error("ERROR: con un solo punto ya se declaro verificado"); process.exitCode = 1;
}
console.log("Tras un punto, sigue sin poder reportarse  ✓");

// Un punto del otro lado de la calle.
await localizarYConfirmar("-27.40075, 152.7", "Punto 2 (sur)");

const cubiertas = (await page.locator(".rules li.ok").count());
console.log(`Reglas cubiertas: ${cubiertas} de 3`);

// Y un desacuerdo, que tiene que frenar todo.
await page.locator("textarea").fill("-27.4001, 152.70012");
await page.getByRole("button", { name: "Localizar", exact: true }).click();
await page.locator(".verify").waitFor();
await page.locator('.verify input[type="number"]').fill("22");
await page.getByRole("button", { name: "Anotar el desacuerdo" }).click();
await page.locator(".verify .note").waitFor();

const final = await page.locator(".card").last().innerText();
console.log("Tras el desacuerdo:", final.split("\n").find((l) => /desacuerdo/.test(l)) ?? "");
if (/se puede reportar/.test(final)) {
  console.error("ERROR: un desacuerdo sin explicar no debe dejar reportar"); process.exitCode = 1;
}

// Y que sobreviva a recargar: es una app de campo, sin senal.
await page.reload({ waitUntil: "networkidle" });
await page.locator(".farm-open").first().click();
await page.locator(".rules").waitFor();
const persistidas = await page.locator(".rules li.ok").count();
console.log(`Tras recargar, reglas cubiertas: ${persistidas} de 3`);
if (persistidas !== cubiertas) {
  console.error("ERROR: las verificaciones no sobrevivieron la recarga"); process.exitCode = 1;
}

// El veredicto del offset: es lo que convierte un conteo en un parametro.
// Por el titulo y no por la clase: ahora hay dos recuadros de diagnostico
// en la pantalla y el de las reglas viene primero.
const panel = await page.locator(".cuadre", { hasText: "arranque de la fila" }).innerText().catch(() => "");
console.log("Offset segun los conteos:\n   " + panel.split("\n").slice(2).join("\n   "));
if (!/arranque de la fila/i.test(panel)) {
  console.error("ERROR: no aparecio el veredicto del offset");
  process.exitCode = 1;
}
if (!/Entre .* y .* mm|conteos registrados sirve|numero de modulo/.test(panel)) {
  console.error("ERROR: el veredicto no dice nada util");
  process.exitCode = 1;
}

await page.screenshot({ path: "shots/11-verificacion.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "FALLO" : "OK");
