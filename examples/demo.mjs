/**
 * Demo end-to-end contra el paquete compilado.
 *   npm run build && node examples/demo.mjs
 */
import { readFileSync } from "node:fs";
import { compileFarm, locate, formatAddress, parseCoordinate } from "../dist/index.js";

const profile = JSON.parse(readFileSync(new URL("../farms/edenvale.json", import.meta.url), "utf8"));

// Una fila del bloque 5: lado norte, primero de una linea de 3 trackers.
// Las picas van de norte (start) a sur (end); el largo sale del perfil.
const NORTH = { lat: -27.4, lon: 152.7 };
const LEN = 56 * 1.15 + 2 * 1.4; // 67.2 m
const METERS_PER_DEG_LAT = 110946;

const row = {
  id: "05-042-R1",
  block: "05",
  tracker: "05-042",
  row: "R1",
  start: NORTH,
  end: { lat: NORTH.lat - LEN / METERS_PER_DEG_LAT, lon: NORTH.lon },
  side: "north",
  pos: 1,
  posTotal: 3,
  stringNumbers: [1, 2],
};

const farm = compileFarm(profile, [row]);
console.log(`Parque: ${farm.profile.name}`);
console.log(`Filas: ${farm.rows.length} · modulos por fila: ${farm.modulesPerRow}`);
console.log(`Warnings al compilar: ${farm.buildWarnings.length || "ninguno"}\n`);

// Tres puntos de interes a lo largo del tracker.
const probes = [
  ["punta norte (la mas lejana a la caja DC)", 0.6],
  ["justo pasando la mitad", LEN / 2 + 0.5],
  ["punta sur (pegado a la caja DC)", LEN - 0.6],
];

for (const [label, metersFromNorth] of probes) {
  const lat = NORTH.lat - metersFromNorth / METERS_PER_DEG_LAT;
  const res = locate({ lat, lon: NORTH.lon, accuracyM: 2.5 }, farm);

  console.log(`── ${label}`);
  console.log(`   ${formatAddress(res.best)}`);
  console.log(`   confianza ${(res.best.confidence * 100).toFixed(0)} % · a ${res.best.distanceM.toFixed(2)} m del centro del modulo`);
  console.log(`   vecinos: ${res.candidates.slice(0, 5).map((c) => `s${c.stringNumber}m${c.module} ${(c.confidence * 100).toFixed(0)}%`).join("  ")}`);
  const d = res.diagnostics.winner;
  console.log(`   [diag] origen=${d.originEnd} (${d.originStrategy}) · invertido=${d.inverted} (${d.inversionStrategy}) · paso=${d.pitchM} m`);
  for (const w of res.warnings) console.log(`   [aviso] ${w.code}: ${w.message}`);
  console.log();
}

// Coordenada pegada de Google Maps, sin convertir a mano.
const pasted = parseCoordinate(`27°24'0.0"S 152°42'0.0"E`);
console.log(`── coordenada pegada: 27°24'0.0"S 152°42'0.0"E → ${pasted.lat}, ${pasted.lon}`);
const far = locate(pasted, farm);
console.log(`   best: ${far.best ? formatAddress(far.best) : "null"}`);
for (const w of far.warnings) console.log(`   [aviso] ${w.message}`);
