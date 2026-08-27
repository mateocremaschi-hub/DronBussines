/**
 * Prueba de humo del editor de huecos.
 *
 * Las pruebas unitarias cubren la geometria. Lo que esta agrega es que el
 * boton exista, que lo que se escribe en los campos llegue al cuadre, y —lo
 * que importa— que el cuadre CAMBIE al declarar los huecos. Un editor que
 * guarda en un lugar que nadie lee compila, se ve bien, y no hace nada.
 */
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
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
await page.getByRole("heading", { name: /parametros|Parametros/i }).first().waitFor().catch(() => {});

const cuadre = () => page.locator("table, .cuadre").last().innerText().catch(() => "");
const antes = await cuadre();

// El caso normal no muestra nada de esto.
const abrir = page.getByRole("button", { name: /no están entre strings iguales/i });
if (!(await abrir.count())) { console.error("NO ENCONTRE el boton de huecos"); process.exitCode = 1; }

await abrir.click();
await page.getByRole("button", { name: "Agregar otro hueco" }).waitFor();

// Dos huecos: despues del modulo 1 y del 55, de 900 mm cada uno.
const despues = page.locator('.hueco input[type="number"]');
await despues.nth(0).fill("1");
await despues.nth(1).fill("900");
await page.getByRole("button", { name: "Agregar otro hueco" }).click();
await despues.nth(2).fill("55");
await despues.nth(3).fill("900");
await page.waitForTimeout(600);

const despuesTexto = await cuadre();
console.log("Cuadre con los huecos declarados:");
despuesTexto.split("\n").slice(0, 12).forEach((l) => console.log("   " + l.replace(/\t/g, " · ")));

if (antes === despuesTexto) {
  console.error("EL CUADRE NO CAMBIO: lo que se escribe en el editor no llega a la cuenta");
  process.exitCode = 1;
}
// 56 modulos, 2 huecos grandes -> 53 huequitos, no 54.
if (!/\b53\b/.test(despuesTexto)) {
  console.error("ESPERABA 53 huequitos: cada hueco grande reemplaza a uno");
  process.exitCode = 1;
}

await page.screenshot({ path: "shots/13-huecos.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "HUECOS: FALLO" : "HUECOS: ok");
