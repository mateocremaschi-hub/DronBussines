/**
 * Genera un Excel de ejemplo con la forma de una planilla de picas real:
 * un bloque de 12 trackers a cada lado de una calle, coordenadas en UTM,
 * encabezados desprolijos.
 *
 *   node scripts/make-sample.mjs
 */
import { writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), K0 = 0.9996, RAD = Math.PI / 180;

function toUtm(lat, lon, zone = 56) {
  const phi = lat * RAD, lam = lon * RAD, lam0 = ((zone - 1) * 6 - 180 + 3) * RAD;
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi) ** 2;
  const ep2 = E2 / (1 - E2), n = A / Math.sqrt(1 - E2 * s * s), cc = ep2 * c * c;
  const a1 = c * (lam - lam0);
  const m = A * ((1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * E2 ** 3 / 3072) * Math.sin(6 * phi));
  const easting = K0 * n * (a1 + (1 - t + cc) * a1 ** 3 / 6
    + (5 - 18 * t + t * t + 72 * cc - 58 * ep2) * a1 ** 5 / 120) + 500000;
  let northing = K0 * (m + n * Math.tan(phi) * (a1 * a1 / 2
    + (5 - t + 9 * cc + 4 * cc * cc) * a1 ** 4 / 24
    + (61 - 58 * t + t * t + 600 * cc - 330 * ep2) * a1 ** 6 / 720));
  if (lat < 0) northing += 10000000;
  return { easting, northing };
}

const M_PER_DEG_LAT = 110946;
const mPerDegLon = (lat) => 111320 * Math.cos(lat * RAD);

// Geometria del bloque
// Geometria real de Edenvale: dos strings de 28 modulos, una bahia de motor
// entre ellos, y las picas 1464 mm ADENTRO del recorrido de modulos.
const STRING = 28 * 1.15 - 0.02;           // 32.18 m por string
const MOTOR = 3.713;                       // bahia del motor
const VOLADIZO = 1.464;                    // los modulos sobresalen de la pica
const LEN = 2 * STRING + MOTOR - 2 * VOLADIZO;   // 65.145 m de pica a pica
const ROAD = 8;                            // ancho de la calle del medio
const SPACING = 6;                         // entre trackers vecinos
const LAT0 = -27.4, LON0 = 152.7;          // esquina noroeste

const rows = [];
let n = 0;

for (const side of ["Norte", "Sur"]) {
  for (let i = 0; i < 12; i++) {
    n += 1;
    const lonOffset = i * SPACING;
    // Los del norte arrancan arriba; los del sur, del otro lado de la calle.
    const northTop = side === "Norte" ? 0 : -(LEN + ROAD);
    const latTop = LAT0 + northTop / M_PER_DEG_LAT;
    const latBottom = LAT0 + (northTop - LEN) / M_PER_DEG_LAT;
    const lon = LON0 + lonOffset / mPerDegLon(LAT0);

    const p1 = toUtm(latTop, lon);     // pica del norte
    const p2 = toUtm(latBottom, lon);  // pica del sur

    rows.push({
      "BLOQUE": "05",
      "TRACKER": `05-${String(n).padStart(3, "0")}`,
      "MOTOR ROW": "R1",
      "PICA 1 NORTE (N)": Math.round(p1.northing * 100) / 100,
      "PICA 1 ESTE (E)": Math.round(p1.easting * 100) / 100,
      "PICA 2 NORTE (N)": Math.round(p2.northing * 100) / 100,
      "PICA 2 ESTE (E)": Math.round(p2.easting * 100) / 100,
      "LADO": side,
      "POS": (i % 4) + 1,
      "POS TOTAL": 4,
      "STRINGS": `${i * 2 + 1},${i * 2 + 2}`,
    });
  }
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Planilla de replanteo — portada"]]), "PORTADA");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "DATA");
XLSX.writeFile(wb, "public/ejemplo-picas.xlsx");
console.log(`Escrito public/ejemplo-picas.xlsx con ${rows.length} trackers (bloque 05).`);

// Un segundo archivo con OTRO bloque, como llega en las plantas grandes:
// un Excel por transformador o por etapa de obra.
const rows2 = rows.map((r, i) => ({
  ...r,
  BLOQUE: "06",
  TRACKER: `06-${String((i % 12) + 1).padStart(3, "0")}`,
  // Corrido 200 m al este, para que se vea como un bloque aparte en el mapa.
  "PICA 1 ESTE (E)": Math.round((r["PICA 1 ESTE (E)"] + 200) * 100) / 100,
  "PICA 2 ESTE (E)": Math.round((r["PICA 2 ESTE (E)"] + 200) * 100) / 100,
}));

const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(rows2), "DATA");
XLSX.writeFile(wb2, "public/ejemplo-picas-bloque2.xlsx");
console.log(`Escrito public/ejemplo-picas-bloque2.xlsx con ${rows2.length} trackers (bloque 06).`);


// ---------------------------------------------------------------------------
// Lista de strings de ejemplo, con la forma de las planillas reales:
// dos filas de titulo antes de los encabezados, y la caja DC combinada.
// ---------------------------------------------------------------------------

const filas = [["Planilla de strings — ejemplo"], []];
filas.push(["STRING", "TRACKER", "FILA", "DC BOX No."]);

let caja = 0;
rows.forEach((r, i) => {
  // Cada caja DC alimenta 4 trackers vecinos (en paralelo, uno al lado del otro).
  if (i % 4 === 0) caja += 1;
  const primeroDeLaCaja = i % 4 === 0;
  for (const s of [1, 2]) {
    filas.push([
      `S-5.1.${caja}.${(i % 4) * 2 + s}`,
      r.TRACKER,
      "R1",
      // Combinada: solo aparece en la primera fila de cada bloque.
      primeroDeLaCaja && s === 1 ? `DCB-5.1.${caja}` : null,
    ]);
  }
});

const wb3 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb3, XLSX.utils.aoa_to_sheet(filas), "STRINGS");
XLSX.writeFile(wb3, "public/ejemplo-strings.xlsx");
console.log(`Escrito public/ejemplo-strings.xlsx con ${filas.length - 3} strings.`);
