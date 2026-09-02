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
await page.getByRole("heading", { name: "Qué vas a poder ver con este vuelo" }).waitFor();

/*
  Esta prueba miraba una tabla de diez renglones —hora, altura del sol, angulo
  del tracker, ancho aparente, pixeles por celda— que ya no existe: no cambiaba
  ninguna decision y se podo junto con el resto de la pantalla.

  La FISICA de esos renglones se prueba donde corresponde, sin navegador, en
  test/sol.test.ts: que temprano el tracker este contra el tope, que al mediodia
  quede plano, que a la mañana miren al este. Lo que le queda a esta prueba es
  lo otro, que un test unitario no puede ver: que la pantalla muestre la ventana
  util y que reaccione al dia que se elija.
*/
const tarjeta = page.locator(".card", { hasText: "Qué vas a poder ver con este vuelo" });

const leer = async () => {
  const t = (await tarjeta.locator(".stats").last().innerText()).replace(/\n/g, " ");
  return {
    texto: t,
    ventana: t.match(/(\d\d:\d\d)[–-](\d\d:\d\d)/)?.[0] ?? null,
    px: Number(t.match(/([\d.]+)\s+p[ií]xeles por celda/)?.[1] ?? NaN),
  };
};

// Un dia de verano austral: ventana larga y trackers planos buena parte del dia.
await page.locator('input[type="date"]').fill("2025-12-21");
await page.waitForTimeout(400);
const verano = await leer();
console.log("21 de diciembre:", verano.texto);
if (!verano.ventana) { console.error("ESPERABA una ventana de vuelo en verano"); process.exitCode = 1; }

// Y uno de invierno: el sol nunca sube tanto, asi que la ventana se achica.
await page.locator('input[type="date"]').fill("2025-06-21");
await page.waitForTimeout(400);
const invierno = await leer();
console.log("21 de junio:   ", invierno.texto);

const minutos = (r) => {
  if (!r.ventana) return 0;
  const [a, b] = r.ventana.split(/[–-]/).map((h) => { const [hh, mm] = h.split(":").map(Number); return hh * 60 + mm; });
  return b - a;
};
console.log(`Ventana: ${minutos(verano)} min en verano contra ${minutos(invierno)} en invierno.`);
if (!(minutos(verano) > minutos(invierno))) {
  console.error("ESPERABA que la ventana de verano fuera mas larga que la de invierno");
  process.exitCode = 1;
}

/*
  Y que los pixeles por celda de la ventana sean los del vuelo que la app
  eligio, no un numero suelto: la altura la decide la app para que la celda
  entre justo, asi que este numero tiene que dar por encima del minimo.
*/
console.log(`Pixeles por celda en la ventana: ${verano.px}`);
if (!(verano.px >= 2)) {
  console.error("ESPERABA que en la ventana la celda entrara en al menos 2 pixeles de lado");
  process.exitCode = 1;
}

await page.screenshot({ path: "shots/13-hora-de-vuelo.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "HORA DE VUELO: FALLO" : "HORA DE VUELO: ok");
