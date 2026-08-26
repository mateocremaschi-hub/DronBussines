/**
 * Corre el lector termico contra fotos de verdad.
 *
 * Los tests unitarios usan un JPEG armado a mano; esto verifica contra lo que
 * de verdad escribe un dron. Se le pasa una carpeta:
 *
 *   node scripts/leer-termicas.mjs /ruta/a/las/fotos
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRadiometric, percentil } from "../app/thermal.ts";

const dir = process.argv[2];
if (!dir) { console.error("Falta la carpeta de fotos."); process.exit(1); }

const archivos = readdirSync(dir).filter((f) => /\.(jpe?g)$/i.test(f)).sort();
console.log(`${"archivo".padEnd(26)} ${"px".padEnd(10)} ${"escala".padEnd(16)} ${"min".padStart(7)} ${"mediana".padStart(8)} ${"max".padStart(7)}`);

let termicas = 0, visibles = 0;
for (const f of archivos) {
  const b = readFileSync(join(dir, f));
  const r = readRadiometric(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (!r) { visibles++; continue; }
  termicas++;
  const c = Array.from(r.celsius);
  console.log(`${f.slice(0,25).padEnd(26)} ${`${r.width}x${r.height}`.padEnd(10)} ${r.escala.padEnd(16)} ` +
    `${percentil(c,0).toFixed(1).padStart(6)}C ${percentil(c,50).toFixed(1).padStart(7)}C ${percentil(c,100).toFixed(1).padStart(6)}C`);
}

console.log(`\ntermicas leidas: ${termicas} · sin crudo termico (visibles): ${visibles}`);
if (!termicas) { console.error("FALLO: ninguna foto tenia datos de temperatura"); process.exit(1); }
console.log("OK");
