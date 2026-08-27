/**
 * La pregunta que decide si el vuelo sirve: a que hora ir.
 *
 * Los trackers giran de -55 a +55 grados siguiendo al sol. Desde arriba, un
 * modulo inclinado 55 grados se ve un 43 % mas angosto, y la celda se achica
 * igual: un vuelo que a mediodia resuelve una celda, a las siete de la manana
 * no. Las pruebas unitarias verifican la astronomia contra valores publicados;
 * lo que esta prueba agrega es que ese calculo llegue a la pantalla, con el
 * parque cargado de verdad y sus coordenadas reales.
 */
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4173";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1200 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });

await page.goto(BASE, { waitUntil: "networkidle" });

// Un parque con geometria, igual que en el resto de las pruebas.
await page.getByRole("button", { name: "Cargar el primero" }).click();
const x = await page.request.get(`${BASE}/ejemplo-picas.xlsx`);
await page.setInputFiles('input[type="file"]', {
  name: "ejemplo-picas.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: Buffer.from(await x.body()),
});
await page.getByRole("heading", { name: /Que es cada columna/ }).waitFor();
await page.getByLabel("Zona").fill("56");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

await page.getByRole("button", { name: "Planificar vuelo" }).click();
await page.getByRole("heading", { name: "A que hora volar" }).waitFor();

// Un dia de verano austral, para que la diferencia entre las 7 y el mediodia
// sea grande y se vea si el calculo esta vivo.
await page.locator('input[type="date"]').fill("2025-12-21");
await page.waitForTimeout(300);

const tarjeta = page.locator(".card", { hasText: "A que hora volar" });
const texto = await tarjeta.innerText();
console.log(texto.split("\n").slice(0, 12).map((l) => "   " + l).join("\n"));

// El huso tiene que haber salido de la longitud del parque, no de un default.
const huso = await tarjeta.getByLabel(/Huso/).inputValue();
console.log("Huso deducido de la longitud:", huso);
if (huso !== "10") { console.error("ESPERABA UTC+10 para Queensland, salio", huso); process.exitCode = 1; }

// Las filas de la tabla: hora, sol, tracker, acortamiento, pixeles.
const filas = await tarjeta.locator("tbody tr").evaluateAll((trs) =>
  trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())));

if (filas.length < 5) {
  console.error("ESPERABA una tabla de horas, salieron", filas.length, "filas");
  process.exitCode = 1;
}

const porHora = new Map(filas.map((f) => [f[0], f]));
const temprano = porHora.get("07:00");
const mediodia = porHora.get("12:00");
console.log("A las 07:00:", temprano?.join(" · "));
console.log("A las 12:00:", mediodia?.join(" · "));

const pct = (s) => Number(String(s).match(/(\d+)\s*%/)?.[1] ?? NaN);
if (!(pct(temprano?.[3]) < 70)) {
  console.error("ESPERABA que a las 07:00 el modulo se viera bastante mas angosto");
  process.exitCode = 1;
}
if (!(pct(mediodia?.[3]) > 95)) {
  console.error("ESPERABA que al mediodia el modulo se viera casi entero");
  process.exitCode = 1;
}

/*
  Lo que de verdad decide el viaje: a las 07:00 la celda NO entra en pixeles
  suficientes y al mediodia si. Si las dos horas dieran lo mismo, toda esta
  tarjeta seria decorado.
*/
const px = (s) => Number(s);
console.log(`Pixeles por celda: ${temprano?.[4]} a las 07:00 contra ${mediodia?.[4]} al mediodia`);
if (!(px(temprano?.[4]) < px(mediodia?.[4]))) {
  console.error("ESPERABA menos pixeles por celda temprano que al mediodia");
  process.exitCode = 1;
}
if (!(px(temprano?.[4]) < 4 && px(mediodia?.[4]) >= 4)) {
  console.error(
    "ESPERABA que la celda cruzara el minimo de 4 pixeles entre las 07:00 y el mediodia; " +
    "salio " + temprano?.[4] + " y " + mediodia?.[4],
  );
  process.exitCode = 1;
}

// Y la conclusion practica: la hora mas plana y la ventana util.
if (!/1[12]:\d\d|1[23]:\d\d/.test(texto)) {
  console.error("ESPERABA que la hora mas plana cayera cerca del mediodia");
  process.exitCode = 1;
}

await page.screenshot({ path: "shots/13-hora-de-vuelo.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "HORA DE VUELO: FALLO" : "HORA DE VUELO: ok");
