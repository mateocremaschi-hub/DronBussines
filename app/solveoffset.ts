/**
 * Despejar el offset con un conteo de campo, en vez de discutirlo.
 *
 * De donde sale esto. En Edenvale hay un numero que no se puede medir con
 * cinta ni deducir de la aritmetica: a que distancia del PUNTO QUE TRAE EL
 * ARCHIVO empieza el primer modulo.
 *
 * Parece que se puede. Mateo midio con cinta que la pila de punta esta 1464 mm
 * adentro del borde del primer panel, y que no hay ninguna pila mas afuera.
 * Con eso el offset seria -1464 y listo. Pero entonces las dos coordenadas de
 * una fila tendrian que estar a 62,27 m, y el archivo dice 65,145 — que da casi
 * exacto el largo del recorrido de modulos, o sea offset cero.
 *
 * Las dos cosas no pueden ser. Y el archivo es el unico dato de todo el modelo
 * que nadie verifico nunca parado en el parque.
 *
 * Los dos candidatos ponen cada modulo con mas de un modulo de diferencia, asi
 * que UN conteo en el campo los separa. Este modulo hace exactamente eso: toma
 * un conteo ya registrado y devuelve que offsets lo habrian acertado.
 *
 * No resuelve por regla ni por formula: PRUEBA. Recompila la fila con cada
 * offset y mira cual habria dado el modulo que la persona conto. Es fuerza
 * bruta sobre un rango de dos metros, cuesta milisegundos, y no tiene forma de
 * equivocarse con un signo — que es justo el error que se comete despejando
 * esto a mano.
 */

import { compileFarm, locate } from "@locator";
import type { FarmProfile, TrackerRow } from "@locator";
import type { FieldCheck } from "./checks";

export interface OffsetCompatible {
  /** El rango de offsets que habrian acertado el conteo, en mm. */
  desdeMm: number;
  hastaMm: number;
  /** El del medio: el mas defendible de ese rango. */
  centroMm: number;
}

export interface Veredicto {
  /** Cuantos conteos se pudieron usar. */
  usados: number;
  /** Los rangos de cada conteo, en el orden en que se registraron. */
  porConteo: Array<{ check: FieldCheck; rango: OffsetCompatible | null }>;
  /** La interseccion de todos: el offset que explica TODOS los conteos. */
  comun: OffsetCompatible | null;
  /** El que tiene el perfil ahora. */
  actualMm: number;
  /** Si el offset actual sobrevive a los conteos. */
  actualSirve: boolean;
  notas: string[];
}

/** Hasta donde se busca, en mm. Dos modulos para cada lado alcanza y sobra. */
const RANGO_MM = 2400;
const PASO_MM = 5;

/**
 * Que offsets habrian acertado este conteo.
 *
 * Se recompila SOLO la fila del conteo: el resto del parque no cambia nada y
 * compilar 3182 filas mil veces seria absurdo.
 */
export function offsetsQueCuadran(
  check: FieldCheck,
  profile: FarmProfile,
  rows: TrackerRow[],
): OffsetCompatible | null {
  const contado = check.outcome === "match" ? check.module : check.countedModule;
  if (contado == null) return null;

  const fila = rows.find((r) => r.id === check.rowId);
  if (!fila) return null;

  const aciertos: number[] = [];
  for (let off = -RANGO_MM; off <= RANGO_MM; off += PASO_MM) {
    // Se prueba con el offset declarado a mano aunque el parque este en modo
    // centrado: si no, mover el numero no cambiaria nada y el barrido daria
    // siempre lo mismo. En un parque centrado el resultado no es un parametro
    // para copiar — es el diagnostico de cuanto se corrio el centrado.
    const p: FarmProfile = {
      ...profile,
      geometry: { ...profile.geometry, endpointOffsetMm: off, endpointOffsetMode: "both" },
    };
    let farm;
    try { farm = compileFarm(p, [fila]); } catch { continue; }

    const res = locate(
      { lat: check.coord.lat, lon: check.coord.lon, ...(check.accuracyM != null ? { accuracyM: check.accuracyM } : {}) },
      farm,
    );
    // Tiene que dar el mismo string, no solo el mismo numero de modulo: el
    // modulo 5 de un string y el 5 del otro son paneles distintos.
    const b = res.best;
    if (!b || b.module !== contado) continue;
    if (check.stringNumber != null && b.stringNumber !== check.stringNumber) continue;
    aciertos.push(off);
  }

  if (!aciertos.length) return null;
  const desdeMm = aciertos[0]!;
  const hastaMm = aciertos[aciertos.length - 1]!;
  return { desdeMm, hastaMm, centroMm: Math.round((desdeMm + hastaMm) / 2) };
}

/**
 * El veredicto de todos los conteos juntos.
 *
 * Un conteo solo deja un rango de casi un modulo de ancho, porque adentro de un
 * modulo cualquier offset da el mismo resultado. Dos conteos en puntas
 * distintas de la fila lo achican mucho: es la misma razon por la que las tres
 * reglas de cobertura piden puntos distintos y no tres veces el mismo.
 */
export function veredictoDeOffset(
  checks: FieldCheck[],
  profile: FarmProfile,
  rows: TrackerRow[],
): Veredicto {
  const porConteo = checks.map((check) => ({
    check,
    rango: offsetsQueCuadran(check, profile, rows),
  }));

  const validos = porConteo.filter((x) => x.rango).map((x) => x.rango!);
  let comun: OffsetCompatible | null = null;
  if (validos.length) {
    const desdeMm = Math.max(...validos.map((r) => r.desdeMm));
    const hastaMm = Math.min(...validos.map((r) => r.hastaMm));
    comun = desdeMm <= hastaMm
      ? { desdeMm, hastaMm, centroMm: Math.round((desdeMm + hastaMm) / 2) }
      : null;
  }

  // Con que numero se compara. En modo centrado el offset declarado no se usa
  // para nada, asi que compararlo seria mentir: lo que corresponde es el
  // centrado efectivo que aplica el motor, que sale del largo de las filas.
  const centrado = profile.geometry.endpointOffsetMode === "centered";
  const actualMm = centrado ? centradoEfectivoMm(profile, rows) : profile.geometry.endpointOffsetMm;
  const actualSirve = !!comun && actualMm >= comun.desdeMm && actualMm <= comun.hastaMm;

  return {
    usados: validos.length,
    porConteo,
    comun,
    actualMm,
    actualSirve,
    notas: notasDe({
      usados: validos.length, comun, actualMm, actualSirve, total: checks.length, centrado,
    }),
  };
}

/**
 * Cuanto offset aplica de hecho el modo centrado, en mm.
 *
 * Se mide sobre la mediana de los largos, que es lo que usa el resto de la app
 * para hablar del parque.
 */
function centradoEfectivoMm(profile: FarmProfile, rows: TrackerRow[]): number {
  if (!rows.length) return 0;
  const farm = compileFarm(profile, rows);
  const largos = farm.rows.map((r) => r.lengthM).sort((a, b) => a - b);
  const mediana = largos[Math.floor(largos.length / 2)]!;
  const n = profile.topology.modulesPerString * profile.topology.stringsPerRow;
  const paso = (profile.module.widthMm + profile.module.gapMm) / 1000;
  const ocupan =
    n * paso -
    profile.topology.stringsPerRow * (profile.module.gapMm / 1000) +
    (profile.topology.stringsPerRow - 1) * ((profile.topology.stringGapMm ?? 0) / 1000);
  return Math.round(((mediana - ocupan) / 2) * 1000);
}

function notasDe(x: {
  usados: number; comun: OffsetCompatible | null;
  actualMm: number; actualSirve: boolean; total: number; centrado?: boolean;
}): string[] {
  const notas: string[] = [];

  if (!x.total) {
    notas.push("Todavia no hay ningun conteo de campo. Es lo unico que puede decidir este numero.");
    return notas;
  }
  if (!x.usados) {
    notas.push(
      "Ninguno de los conteos registrados sirve para esto: hace falta uno donde se haya contado el " +
      "numero de modulo, no solo el bloque y el tracker.",
    );
    return notas;
  }

  if (!x.comun) {
    notas.push(
      `Los ${x.usados} conteos no se explican con un solo offset. O uno se conto mal, o hay algo ` +
      "distinto entre esas dos filas — el paso, la cantidad de modulos, el sentido del conteo. " +
      "Antes de tocar el offset hay que mirar eso.",
    );
    return notas;
  }

  const ancho = x.comun.hastaMm - x.comun.desdeMm;
  notas.push(
    `Con ${x.usados} conteo(s), el offset tiene que estar entre ${x.comun.desdeMm} y ` +
    `${x.comun.hastaMm} mm. El del medio es ${x.comun.centroMm}.`,
  );

  if (x.usados === 1) {
    notas.push(
      `El rango es de ${ancho} mm porque un solo conteo no puede achicarlo mas: adentro de un ` +
      "modulo, cualquier offset da el mismo resultado. Con un segundo conteo en la otra punta de " +
      "la fila se achica bastante.",
    );
  }

  const comoSeLlama = x.centrado ? "que aplica el centrado" : "que tiene el perfil";
  notas.push(
    x.actualSirve
      ? `El ${x.actualMm} mm ${comoSeLlama} cae adentro del rango: los conteos lo respaldan.`
      : `El ${x.actualMm} mm ${comoSeLlama} queda AFUERA del rango. Los conteos lo desmienten.`,
  );
  if (x.centrado && !x.actualSirve) {
    notas.push(
      "Este parque centra los modulos en cada fila, asi que el offset no es un numero que se pueda " +
      "corregir: si el centrado no cuadra con los conteos, lo que esta mal es el paso, la cantidad " +
      "de modulos por string o el hueco entre strings.",
    );
  }
  return notas;
}
