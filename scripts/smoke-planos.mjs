/**
 * Prueba de humo del paso que borra el dia de campo: arrastrar los PDF de
 * interconexion y que el parque quede con el lado de cada bloque resuelto.
 *
 * Las pruebas unitarias cubren la geometria con etiquetas inventadas. Lo que
 * esta prueba agrega es lo unico que ellas no pueden: que pdf.js abra un PDF
 * de verdad adentro del navegador, que el worker levante desde el build, y que
 * las coordenadas que devuelve caigan donde las reglas esperan. Si eso falla,
 * falla en silencio y el parque queda igual que antes.
 */
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:4173";

// ---------------------------------------------------------------------------
// Un PDF con texto de verdad, escrito a mano.
//
// Nada de librerias: el objetivo es un archivo que pdf.js tenga que parsear en
// serio, y para eso alcanzan cuarenta lineas. Cada rotulo se posiciona con Tm,
// asi que la coordenada que sale del otro lado es la que se puso aca.
// ---------------------------------------------------------------------------
function pdfConEtiquetas(etiquetas) {
  const contenido = etiquetas
    .map((e) => `BT /F1 5 Tf 1 0 0 1 ${e.x} ${e.y} Tm (${e.t}) Tj ET`)
    .join("\n");

  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]" +
      "/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${contenido.length}>>\nstream\n${contenido}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/**
 * El bloque 05, que es el del archivo de ejemplo: 24 trackers en dos alas con
 * la calle en el medio. Los numeros bajos van a la izquierda, asi que esa ala
 * tiene que salir North.
 */
function planoDelBloque05() {
  const e = [];
  for (let n = 1; n <= 24; n++) {
    const izq = n <= 12;
    const i = izq ? n - 1 : n - 13;
    e.push({ x: (izq ? 60 : 400) + i * 12, y: 400, t: `05-${String(n).padStart(3, "0")}-R1` });
  }
  // Las cajas de continua viven sobre la calle, entre las dos alas.
  for (let k = 1; k <= 3; k++) e.push({ x: 300, y: 380 + k * 15, t: `DCB-5.1.${k}` });
  // Un segmento de string por ala, que es lo que ancla el inversor.
  e.push({ x: 64, y: 400, t: "S-5.1.2.1.1" });
  e.push({ x: 404, y: 400, t: "S-5.1.2.3.1" });
  // Y el resto del rotulado de la lamina, que tiene que ignorar sin quejarse.
  e.push({ x: 30, y: 750, t: "INTERCONNECTION LAYOUT" });
  e.push({ x: 30, y: 740, t: "REV. C" });
  return e;
}

// ---------------------------------------------------------------------------

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1100 } });
page.on("pageerror", (e) => { console.error("ERROR DE PAGINA:", e.message); process.exitCode = 1; });

/**
 * El navegador de la Mac, no el del que programa.
 *
 * La primera version de esto usaba la compilacion moderna de pdf.js, que llama
 * a `Iterator.prototype` sin preguntar si existe. En un Safari de un par de
 * anios atras eso no es una funcion que falta: el modulo entero se muere al
 * cargarse, ANTES de tocar un archivo, y los 36 planos fallan con un
 * "Can't find variable: Iterator" que no se parece en nada al problema.
 *
 * Correr siempre con los dos globales borrados es lo unico que impide que
 * vuelva a pasar. Chrome de escritorio los tiene, y por eso no avisaba nada.
 */
await page.addInitScript(() => {
  try { delete globalThis.Iterator; } catch {}
  try { delete Promise.withResolvers; } catch {}
});

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
// El archivo de ejemplo viene en UTM y la zona ya no se hereda de Edenvale:
// hay que decirla, igual que en un parque nuevo de verdad.
await page.getByLabel("Zona").fill("56");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await page.getByRole("button", { name: "Siguiente" }).click();
await page.getByRole("button", { name: "Guardar el parque" }).click();
await page.getByRole("heading", { name: "Parques" }).waitFor();

// El plano, en PDF, como sale del proyecto.
await page.locator('.farm-actions input[type="file"]').first().setInputFiles({
  name: "05-interconnection.pdf",
  mimeType: "application/pdf",
  buffer: pdfConEtiquetas(planoDelBloque05()),
});

await page.getByRole("heading", { name: /El plano de/ }).waitFor({ timeout: 60_000 });
const texto = await page.locator(".card", { hasText: "El plano de" }).innerText();
console.log(texto.split("\n").map((l) => "   " + l).join("\n"));

if (!/24 trackers/.test(texto)) {
  console.error("ESPERABA que leyera los 24 trackers del bloque 05");
  process.exitCode = 1;
}
if (!/resolvio el lado de 24 de 24/.test(texto)) {
  console.error("ESPERABA que el plano resolviera el lado de las 24 filas");
  process.exitCode = 1;
}
if (!/3 cajas de continua/.test(texto)) {
  console.error("ESPERABA las 3 cajas de continua");
  process.exitCode = 1;
}
// Un plano que entro entero no tiene nada que reportar. Si aparece la seccion
// de avisos con una corrida limpia, es que algo se esta contando como problema
// sin serlo — y despues nadie mira los avisos de verdad.
if (/no salió redondo/i.test(texto)) {
  console.error("NO ESPERABA avisos con un plano que entro completo");
  process.exitCode = 1;
}

// Y que haya quedado guardado, no solo mostrado en pantalla.
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Parques" }).waitFor();
const resumen = await page.locator(".farm-open").first().innerText();
console.log("Despues de recargar:", resumen.split("\n").filter((l) => l.includes("%")).join(" "));

await page.screenshot({ path: "shots/12-planos.png", fullPage: true });

// ---------------------------------------------------------------------------
// Un plano de OTRO parque, que nombra sus trackers de una forma que el lector
// no puede adivinar.
//
// Paso en el campo: se cargaron los planos de otra farm y la app contesto "el
// archivo no tiene ningun bloque". El lector tenia UN formato adentro —el de
// Edenvale— y ahi se terminaba el camino. Ahora tiene que (1) mostrar que SI
// vio, y (2) dejar que se le enseñe el formato.
// ---------------------------------------------------------------------------

function planoRaro() {
  const e = [];
  for (let n = 1; n <= 24; n++) {
    const izq = n <= 12;
    const i = izq ? n - 1 : n - 13;
    e.push({ x: (izq ? 60 : 400) + i * 12, y: 400, t: `TRK/B7/M${String(n).padStart(2, "0")}/W1` });
  }
  for (let k = 1; k <= 3; k++) e.push({ x: 300, y: 380 + k * 15, t: `CB-7.1.${k}` });
  return e;
}

await page.locator('.farm-actions input[type="file"]').first().setInputFiles({
  name: "07-otro-parque.pdf",
  mimeType: "application/pdf",
  buffer: pdfConEtiquetas(planoRaro()),
});

await page.getByRole("heading", { name: /El plano no entro/ }).waitFor({ timeout: 60_000 });
const malo = await page.locator(".card", { hasText: "El plano no entro" }).innerText();
console.log("\n   --- con un plano que no reconoce ---");
console.log(malo.split("\n").filter((l) => l.trim()).slice(0, 8).map((l) => "   " + l).join("\n"));

// Lo que faltaba: decir QUE vio, en vez de solo que no reconocio nada.
if (!/24 veces con la forma/.test(malo)) {
  console.error("ESPERABA que dijera que formas de etiqueta trae el PDF");
  process.exitCode = 1;
}
if (!/TRK\/B7\/M01\/W1/.test(malo)) {
  console.error("ESPERABA un ejemplo concreto de las etiquetas del archivo");
  process.exitCode = 1;
}

// Y que se le pueda enseñar el formato sin volver a elegir los archivos.
await page.getByLabel(/copiá una etiqueta de tracker/i).fill("TRK/B7/M01/W1");
await page.getByRole("button", { name: /Volver a leer con ese formato/ }).click();
await page.getByRole("heading", { name: /El plano de/ }).waitFor({ timeout: 60_000 });
const bueno = await page.locator(".card", { hasText: "El plano de" }).innerText();
console.log("\n   --- despues de enseñarle el formato ---");
console.log(bueno.split("\n").filter((l) => l.trim()).slice(0, 4).map((l) => "   " + l).join("\n"));

if (!/24 etiquetas de tracker/.test(bueno)) {
  console.error("ESPERABA que leyera los 24 trackers con el formato enseñado");
  process.exitCode = 1;
}
if (!/3 (cajas de continua|de caja de)/.test(bueno)) {
  console.error("ESPERABA que reconociera las 3 cajas CB-7.1.x");
  process.exitCode = 1;
}

await page.screenshot({ path: "shots/14-plano-otro-formato.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "PLANOS: FALLO" : "PLANOS: ok");
