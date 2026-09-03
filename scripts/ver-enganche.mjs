/**
 * Corre el enganche contra fotos de verdad.
 *
 * Le arma a cada foto una rejilla de cajas del tamaño real de un modulo, la
 * corre a proposito la cantidad de pixeles que se le pida —el error de GPS que
 * se quiere simular— y mira si el enganche la vuelve a poner donde estaba.
 *
 *   node scripts/ver-enganche.mjs /ruta/a/las/fotos [pixelesDeError]
 *
 * Es la unica forma de probar esto sin salir a volar: el error de GPS no se
 * puede pedir a mano.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readRadiometric } from "../app/thermal.ts";
import { desvioLocal, engancharFoto, sondearCaja, confianzaDeFoto, LISO_C } from "../app/encaje.ts";

const dir = process.argv[2];
const errorPx = Number(process.argv[3] ?? 25);
if (!dir) { console.error("Falta la carpeta de fotos."); process.exit(1); }

/** Parte un perfil de lisura en tramos de banda de modulo. */
function tramosDe(perfil) {
  const out = [];
  let ini = null;
  for (let i = 0; i < perfil.length; i++) {
    const liso = perfil[i] < LISO_C;
    if (liso && ini == null) ini = i;
    if (!liso && ini != null) { if (i - ini > 15) out.push([ini, i]); ini = null; }
  }
  if (ini != null && perfil.length - ini > 15) out.push([ini, perfil.length]);
  return out;
}

/**
 * Encuentra las bandas de modulo de la foto, en el sentido que corresponda.
 *
 * Las filas pueden salir horizontales o verticales en el cuadro segun el rumbo
 * del dron, asi que se prueban los dos y se queda con el que encuentra mas
 * bandas.
 */
function bandas(r) {
  const sd = desvioLocal(r);
  const porFila = [], porColumna = [];
  for (let y = 0; y < r.height; y++) {
    let s = 0;
    for (let x = 0; x < r.width; x++) s += sd[y * r.width + x];
    porFila.push(s / r.width);
  }
  for (let x = 0; x < r.width; x++) {
    let s = 0;
    for (let y = 0; y < r.height; y++) s += sd[y * r.width + x];
    porColumna.push(s / r.height);
  }
  const h = tramosDe(porFila), v = tramosDe(porColumna);
  return h.length >= v.length
    ? { sd, tramos: h, horizontal: true }
    : { sd, tramos: v, horizontal: false };
}

let probadas = 0, recuperadas = 0;
for (const f of readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort()) {
  const b = readFileSync(join(dir, f));
  const r = readRadiometric(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (!r) continue;
  const { sd, tramos, horizontal } = bandas(r);
  if (tramos.length < 2) {
    console.log(`${f}: las filas no salen ni horizontales ni verticales en el cuadro (vuelo en diagonal). Esta prueba arma la rejilla a mano y no cubre ese caso; el motor si, porque cada caja lleva su angulo.`);
    continue;
  }

  // Una caja por modulo: 25 px a lo largo de la fila, el alto de la banda.
  const cajas = [];
  const largoDe = horizontal ? r.width : r.height;
  for (const [a0, a1] of tramos) {
    for (let t = 40; t < largoDe - 40; t += 26) {
      const centro = (a0 + a1) / 2;
      cajas.push(
        horizontal
          ? { cx: t, cy: centro, largo: 24, cruzado: (a1 - a0) * 0.6, rotRad: 0 }
          : { cx: centro, cy: t, largo: 24, cruzado: (a1 - a0) * 0.6, rotRad: Math.PI / 2 },
      );
    }
  }
  const bien = confianzaDeFoto(cajas.map((c) => sondearCaja(r, sd, c)));
  // Ahora se la corre a proposito, como la corre un GPS sin RTK.
  // El error se mete CRUZADO a la fila, que es el que rompe la medicion.
  const corridas = cajas.map((c) =>
    horizontal ? { ...c, cy: c.cy + errorPx } : { ...c, cx: c.cx + errorPx },
  );
  const mal = confianzaDeFoto(corridas.map((c) => sondearCaja(r, sd, c)));
  const enc = engancharFoto(r, sd, corridas, 40, 0.045);
  // Solo se juzga lo cruzado: a lo largo de una fila lisa no hay nada que ver,
  // y el enganche a proposito no lo toca.
  const cruzado = enc ? (horizontal ? enc.dy : enc.dx) : 0;
  /*
    Lo que se exige no es que vuelva al pixel exacto, sino que las cajas
    queden otra vez sobre panel. Una banda de modulos es mas ancha que la caja
    —43 px contra 26— asi que hay varios corrimientos igual de buenos y pedir
    uno solo seria pedir de mas.
  */
  const nadaQueArreglar = mal.fraccionLisa >= bien.fraccionLisa - 0.02;
  const recupero = nadaQueArreglar || (enc ? enc.despues >= bien.fraccionLisa - 0.02 : false);
  probadas++;
  if (recupero) recuperadas++;
  console.log(
    `${f.padEnd(24)} ${cajas.length} cajas · bien puesta ${(bien.fraccionLisa * 100).toFixed(0)}% ` +
    `· corrida ${errorPx}px ${(mal.fraccionLisa * 100).toFixed(0)}% (${mal.sirve ? "la habria medido igual" : "DESCARTADA"})` +
    ` · enganche ${enc ? `dx ${enc.dx} dy ${enc.dy} -> ${(enc.despues * 100).toFixed(0)}%` : "no engancho"}` +
    ` ${recupero ? "OK" : "NO RECUPERO"}`,
  );
}
console.log(`\n${recuperadas} de ${probadas} fotos volvieron a su lugar.`);
if (probadas && recuperadas < probadas) process.exit(1);
