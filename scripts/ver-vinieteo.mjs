/**
 * Mide el vinieteo de fotos de verdad.
 *
 * El borde del cuadro de una termica lee mas caliente que el centro, y eso
 * inventa defectos: los hermanos de un string casi nunca caen a la misma
 * distancia del centro. Esto lo mide sobre los propios paneles de cada foto y
 * dice cuanto queda despues de corregir.
 *
 *   node scripts/ver-vinieteo.mjs /ruta/a/las/fotos
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRadiometric } from "../app/thermal.ts";
import { desvioLocal, LISO_C } from "../app/encaje.ts";
import { correccion, medirVinieta, radioNormalizado } from "../app/vinieta.ts";

const dir = process.argv[2];
if (!dir) { console.error("Falta la carpeta de fotos."); process.exit(1); }

for (const f of readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort()) {
  const b = readFileSync(join(dir, f));
  const r = readRadiometric(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (!r) continue;
  const sd = desvioLocal(r);

  // En vez de la rejilla del parque, se usan parches lisos de la propia foto:
  // son los paneles, que es lo mismo que mide el motor.
  const puntos = [];
  for (let cy = 8; cy < r.height - 8; cy += 8) {
    for (let cx = 8; cx < r.width - 8; cx += 8) {
      if (sd[cy * r.width + cx] > LISO_C) continue;
      puntos.push({
        r: radioNormalizado(cx, cy, r.width, r.height),
        celsius: r.celsius[cy * r.width + cx],
      });
    }
  }
  const v = medirVinieta(puntos);
  const anillos = (lista) => {
    const paso = Math.SQRT2 / 6;
    return Array.from({ length: 6 }, (_, i) => {
      const s = lista.filter((p) => p.r >= i * paso && p.r < (i + 1) * paso).map((p) => p.celsius).sort((a, b) => a - b);
      return s.length ? s[s.length >> 1].toFixed(1) : "  — ";
    }).join("  ");
  };
  console.log(`${f}  (${puntos.length} parches de panel)`);
  console.log(`   sin corregir, del centro al borde:  ${anillos(puntos)}`);
  if (!v) { console.log("   sin vinieteo medible: no se corrige nada\n"); continue; }
  const corregidos = puntos.map((p) => ({ r: p.r, celsius: p.celsius - correccion(v, p.r) }));
  console.log(`   corregido:                          ${anillos(corregidos)}`);
  console.log(`   correccion maxima: ${v.maximoC.toFixed(1)} °C\n`);
}
