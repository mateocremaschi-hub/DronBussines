/**
 * El motor.
 *
 * Funcion pura: sin red, sin base de datos, sin UI, sin reloj. Toda la
 * variabilidad entre parques ya quedo resuelta al compilar el perfil, asi que
 * lo que queda aca es geometria mas una busqueda en tabla — y por eso cada
 * punto verificado en el campo se puede congelar como test de regresion.
 */

import { makeFrame, toGeo, toLocal } from "./geo/frame.js";
import { projectOnSegment } from "./geo/segment.js";
import {
  distanceAtPosition,
  makeRowLayout,
  positionAtDistance,
  type RowLayout,
} from "./geo/rowLayout.js";
import { chunkOf, splitPosition } from "./strategies/inversion.js";
import type {
  Address,
  CompiledFarm,
  CompiledRow,
  Diagnostics,
  Fix,
  LocateResult,
  Warning,
} from "./types.js";

/** Tope de vecinos por fila: con GPS muy malo, la lista deja de ser util. */
const MAX_NEIGHBOURHOOD = 12;

/** La fila mas cercana de todo el parque, sin filtrar por distancia. */
function filaMasCercana(
  p: { x: number; y: number },
  farm: CompiledFarm,
): { rowId: string; distanceM: number } | null {
  let mejor: { rowId: string; distanceM: number } | null = null;
  for (const row of farm.rows) {
    const proj = projectOnSegment(p, row.a, row.b);
    const along = Math.min(Math.max(proj.alongM, 0), row.lengthM);
    const d = Math.hypot(p.x - (row.a.x + row.ux * along), p.y - (row.a.y + row.uy * along));
    if (!mejor || d < mejor.distanceM) mejor = { rowId: row.source.id, distanceM: d };
  }
  return mejor;
}

/**
 * Que significa esa distancia, en castellano.
 *
 * Un numero suelto no ayuda parado en el campo con el celular en la mano. Cada
 * orden de magnitud es un problema distinto y se arregla de una forma distinta.
 *
 * Los cortes no son arbitrarios. Una zona UTM mide 6 grados, o sea unos 600 km
 * de ancho: importar con la zona equivocada tira el parque a esa distancia, y
 * con el hemisferio al reves lo tira al otro lado del planeta. Por debajo de
 * eso, estar lejos solo significa estar lejos.
 *
 * Y antes que nada se mira la precision de la coordenada: si el error de la
 * propia lectura es mas grande que el radio con el que se busca, no encontrar
 * nada estaba garantizado y no dice nada del parque. Echarle la culpa a la
 * importacion ahi seria mandar a revisar el archivo equivocado.
 */
function diagnosticoDeDistancia(
  m: { rowId: string; distanceM: number },
  accuracyM: number | undefined,
  radioM: number,
): string {
  const d = m.distanceM;
  const lejos = d < 1000 ? `${d.toFixed(0)} m` : `${(d / 1000).toFixed(1)} km`;

  if (accuracyM != null && accuracyM > radioM) {
    return (
      `La fila mas cercana ("${m.rowId}") esta a ${lejos}, pero la coordenada viene con ` +
      `±${Math.round(accuracyM)} m de error — mas que los ${radioM} m con los que se busca. ` +
      `Con esa precision no encontrar nada estaba cantado, y no dice nada sobre el parque: ` +
      `primero hay que conseguir una lectura de GPS de verdad.`
    );
  }

  if (d < 200) {
    return (
      `La fila mas cercana ("${m.rowId}") esta a ${lejos}. Estas en el parque pero fuera de toda ` +
      `fila: puede ser que ese bloque no se haya importado todavia, o que el GPS haya tomado mal ` +
      `la posicion. Probá de nuevo parado quieto unos segundos.`
    );
  }
  if (d < 5000) {
    return (
      `La fila mas cercana ("${m.rowId}") esta a ${lejos}. Estas cerca del parque pero no sobre ` +
      `el: puede que falte importar el bloque donde estas parado.`
    );
  }
  if (d < 500000) {
    return (
      `La fila mas cercana ("${m.rowId}") esta a ${lejos}. Esa coordenada no es de este parque — ` +
      `o el parque cargado es otro, o todavia no llegaste.`
    );
  }
  return (
    `La fila mas cercana ("${m.rowId}") esta a ${Math.round(d / 1000)} km. A esa distancia no hay ` +
    `error de GPS que alcance: las coordenadas del parque estan mal convertidas al importarlas, ` +
    `casi siempre por la zona UTM o el hemisferio equivocados.`
  );
}

export function locate(fix: Fix, farm: CompiledFarm): LocateResult {
  const frame = makeFrame(farm.origin.lat, farm.origin.lon);
  const p = toLocal(frame, fix.lat, fix.lon);

  const warnings: Warning[] = [];
  const diagnostics: Diagnostics = {
    farmId: farm.profile.id,
    profileVersion: farm.profile.profileVersion,
    origin: farm.origin,
    local: p,
    rowsConsidered: 0,
  };

  // --- 1. filas plausibles --------------------------------------------------
  const near: Array<{ row: CompiledRow; clampedM: number; alongM: number; offAxisM: number }> = [];

  for (const row of farm.rows) {
    if (
      p.x < row.bbox.minX ||
      p.x > row.bbox.maxX ||
      p.y < row.bbox.minY ||
      p.y > row.bbox.maxY
    ) {
      continue;
    }
    diagnostics.rowsConsidered++;

    const proj = projectOnSegment(p, row.a, row.b);
    const clampedAlong = Math.min(Math.max(proj.alongM, 0), row.lengthM);
    const foot = {
      x: row.a.x + row.ux * clampedAlong,
      y: row.a.y + row.uy * clampedAlong,
    };
    const clampedM = Math.hypot(p.x - foot.x, p.y - foot.y);

    if (clampedM <= farm.maxDistanceM) {
      near.push({ row, clampedM, alongM: proj.alongM, offAxisM: proj.offAxisM });
    }
  }

  // Sin nada realmente cerca, avisar en vez de devolver el resultado menos
  // lejano como si fuera confiable. Una coordenada de un bloque que nunca se
  // importo tiene que decir "no tengo datos aca", no senalar el bloque vecino.
  if (near.length === 0) {
    // A que distancia esta la fila mas cercana de TODO el parque. El filtro por
    // caja de arriba descarta las lejanas sin medirlas, asi que sin esto el
    // mensaje dice "no hay nada cerca" y no se puede saber si faltan 30 metros
    // o 8000 kilometros — que son dos problemas completamente distintos y se
    // arreglan de formas opuestas.
    const masCerca = filaMasCercana(p, farm);
    if (masCerca) diagnostics.nearestRow = masCerca;

    warnings.push({
      code: "no-row-within-range",
      message:
        `No hay ninguna fila de trackers a menos de ${farm.maxDistanceM} m de esa coordenada. ` +
        (masCerca
          ? diagnosticoDeDistancia(masCerca, fix.accuracyM, farm.maxDistanceM)
          : "El parque no tiene ninguna fila cargada."),
    });
    return { best: null, candidates: [], diagnostics, warnings };
  }

  near.sort((x, y) => x.clampedM - y.clampedM);
  const chosen = near.slice(0, Math.max(1, farm.maxRowCandidates));

  // --- 2. candidatos --------------------------------------------------------
  const sigma = fix.accuracyM && fix.accuracyM > 0 ? fix.accuracyM : farm.defaultAccuracyM;

  // La cantidad de vecinos tiene que salir de la precision de la coordenada, no
  // ser un numero fijo. Verificado en campo: con un celular a ~4 m de precision
  // el error tipico son 7 modulos, y una lista de +-2 dejaba la respuesta
  // correcta AFUERA. Una lista corta no es mas precisa; es mas confiada.
  const spanFromAccuracy = Math.ceil((2 * sigma) / (chosen[0]?.row.pitchM ?? 1.15));
  const neighborhood = Math.min(
    MAX_NEIGHBOURHOOD,
    Math.max(farm.neighborhood, spanFromAccuracy),
  );

  const seen = new Set<string>();
  const candidates: Address[] = [];

  for (const entry of chosen) {
    const centre = positionAt(entry.row, entry.alongM, farm);
    const lo = Math.max(1, centre.positionInRow - neighborhood);
    const hi = Math.min(entry.row.modulesPerRow, centre.positionInRow + neighborhood);

    for (let pos = lo; pos <= hi; pos++) {
      const key = `${entry.row.source.id}#${pos}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(makeAddress(entry.row, pos, farm, frame, p, entry.offAxisM));
    }
  }

  candidates.sort((x, y) => x.distanceM - y.distanceM);

  // --- 3. confianza ---------------------------------------------------------
  // Gaussiana centrada en el Fix, normalizada sobre el conjunto. La lista
  // rankeada no es un extra del resultado: sin RTK el error de GPS son entre
  // 2 y 5 m, o sea entre 2 y 4 modulos, y devolver una sola respuesta seria
  // mentirle al tecnico que la va a caminar.
  let total = 0;
  const weights = candidates.map((c) => {
    const w = Math.exp(-0.5 * (c.distanceM / sigma) ** 2);
    total += w;
    return w;
  });
  if (total > 0) {
    candidates.forEach((c, i) => {
      c.confidence = (weights[i] ?? 0) / total;
    });
  }

  const best = candidates[0] ?? null;

  // --- 4. diagnostico y avisos ---------------------------------------------
  const winnerEntry = chosen[0];
  if (winnerEntry) {
    const row = winnerEntry.row;
    const alongFromOrigin = fromOrigin(row, winnerEntry.alongM);
    const winnerHit = positionAtDistance(layoutOf(row, farm), alongFromOrigin);
    const winnerPosition = winnerHit.positionInRow;
    const winnerChunk = chunkOf(winnerPosition, row.modulesPerString);

    diagnostics.winner = {
      rowId: row.source.id,
      t: winnerEntry.alongM / row.lengthM,
      alongFromOriginM: alongFromOrigin,
      segmentLengthM: row.lengthM,
      pitchM: row.pitchM,
      originOffsetM: row.originOffsetM,
      originEnd: row.originEnd,
      originStrategy: farm.profile.addressing.originStrategy,
      inversionStrategy: farm.profile.addressing.inversionStrategy,
      inverted: row.inverted[winnerChunk] ?? false,
      lengthResidualMmPerModule: row.lengthResidualMmPerModule,
    };

    warnings.push(...row.strategyWarnings);

    /**
     * El aviso de largo tambien tiene que aparecer ACA.
     *
     * Vivia solo en `buildWarnings`, o sea en la pantalla de alta del parque,
     * truncado a ocho items, meses antes. Despues la fila con la geometria rota
     * contestaba con confianza normal y cero avisos, para siempre. En Edenvale
     * hay una fila que mide 57,59 m en vez de 65,145: parado sobre ella la app
     * contestaba un modulo corrido tres posiciones y no decia nada.
     *
     * Un aviso por fila tiene que reaparecer cuando esa fila es la que gana.
     */
    const tol = farm.lengthToleranceMmPerModule;
    if (Math.abs(row.lengthResidualMmPerModule) > tol) {
      const corridoM =
        (Math.abs(row.lengthResidualMmPerModule) * row.modulesPerRow) / 2 / 1000;
      warnings.push({
        code: "length-mismatch",
        rowId: row.source.id,
        message:
          `Esta fila no cierra con la geometria del parque: sobran ` +
          `${row.lengthResidualMmPerModule.toFixed(0)} mm por modulo, que sobre la fila entera son ` +
          `${corridoM.toFixed(1)} m de corrimiento por punta. El modulo que te doy puede estar ` +
          `corrido ${(corridoM / (row.pitchM || 1)).toFixed(1)} posiciones. Contá desde la caja ` +
          `antes de reportar nada de esta fila.`,
      });
    }

    if (winnerHit.inGap) {
      warnings.push({
        code: "in-string-gap",
        rowId: row.source.id,
        message:
          `La coordenada cae en la bahia del motor, entre dos strings — ahi no hay ningun modulo. ` +
          `Te doy el modulo del borde mas cercano, pero conviene mirar la foto para ver de que lado esta.`,
      });
    }

    /*
      Fuera de la fila es PASADO el ultimo modulo, no adentro de el.

      `raw` es continua y el modulo k ocupa de k a k+1: parado en el centro del
      ultimo modulo de una fila de 56 vale 56,5. Comparando contra 56, el aviso
      saltaba en toda la mitad de afuera del ultimo modulo de TODAS las filas
      —"posicion cruda 56.5 de 56"— justo donde mas se lo va a leer, y decia
      que la coordenada cae fuera de la fila cuando cae sobre un panel. Un
      aviso que grita siempre es un aviso que se aprende a ignorar, y este
      tiene que servir para cuando el punto de verdad cayo en la fila de al
      lado.
    */
    const raw = winnerHit.raw;
    if (raw < 1 || raw >= row.modulesPerRow + 1) {
      warnings.push({
        code: "outside-row-extent",
        rowId: row.source.id,
        message:
          `La coordenada cae fuera de la extension de modulos de la fila ` +
          `(posicion cruda ${raw.toFixed(1)} de ${row.modulesPerRow}). ` +
          `Recorte al modulo del extremo, pero puede que el punto pertenezca a la fila de al lado.`,
      });
    }
  }

  /**
   * Lejos, pero adentro del radio de busqueda.
   *
   * La confianza se normaliza ENTRE los candidatos, asi que no dice nada de la
   * distancia absoluta: parado a veinte metros de la fila mas cercana —en la
   * calle, en el camino perimetral, o sobre la fila de al lado de un bloque que
   * nunca se importo— todos los candidatos estan igual de lejos, la confianza
   * del primero sale alta, y la app contesta un modulo como si nada. El unico
   * aviso que existia era para cuando NO hay nada a menos de 30 m.
   *
   * Dos cosas distintas, y las dos importan:
   *
   *  - de costado (`offAxisM`): el punto no esta sobre el tracker sino al lado.
   *    Mas de un modulo de largo hacia el costado y ya estas fuera de la mesa.
   *  - de lejos (`distanceM`): el modulo que se senala esta a mas metros de los
   *    que explica el error del GPS.
   */
  if (best && winnerEntry) {
    const largoModuloM = (farm.profile.module.lengthMm ?? 2300) / 1000;
    const deCostadoM = Math.abs(winnerEntry.offAxisM);
    if (deCostadoM > largoModuloM) {
      warnings.push({
        code: "off-axis",
        rowId: best.rowId,
        message:
          `La coordenada esta ${deCostadoM.toFixed(1)} m al costado del eje de la fila, y la mesa ` +
          `mide ${largoModuloM.toFixed(1)} m de ancho: el punto NO cae sobre este tracker. ` +
          `Te doy el modulo de enfrente, pero puede ser de la fila de al lado — o de un bloque ` +
          `que todavia no cargaste.`,
      });
    }

    const lejosM = Math.max(3 * sigma, 5);
    if (best.distanceM > lejosM) {
      warnings.push({
        code: "far-from-module",
        rowId: best.rowId,
        message:
          `El modulo que te doy esta a ${best.distanceM.toFixed(1)} m de la coordenada. Con ` +
          `±${sigma.toFixed(0)} m de precision, esa distancia no la explica el GPS: o la ` +
          `coordenada no es de este parque, o falta cargar el bloque donde estas parado.`,
      });
    }
  }

  if (best && best.confidence < 0.35) {
    const sameRow = candidates.filter((c) => c.rowId === best.rowId);
    const lo = Math.min(...sameRow.map((c) => c.positionInRow));
    const hi = Math.max(...sameRow.map((c) => c.positionInRow));
    warnings.push({
      code: "low-confidence",
      message:
        `Con ±${sigma.toFixed(0)} m de precision no se puede senalar un modulo solo: la coordenada ` +
        `cae en cualquier lugar entre las posiciones ${lo} y ${hi} de la fila. ` +
        `El tracker y la fila si son confiables — el modulo hay que confirmarlo contra la foto termica.`,
    });
  }

  // "Ambiguo" no es dudar entre el modulo 27 y el 28: eso ya lo dice la lista de
  // vecinos, y sin RTK pasa en cada consulta. Lo que amerita un aviso es la
  // duda que cambia adonde camina el tecnico o que string hay que revisar.
  if (best) {
    const rival = candidates.find(
      (c) =>
        c !== best &&
        c.confidence > 0.6 * best.confidence &&
        (c.rowId !== best.rowId || c.stringNumber !== best.stringNumber),
    );
    if (rival) {
      const what =
        rival.rowId !== best.rowId
          ? `otra fila (${rival.tracker}${rival.row ? " " + rival.row : ""})`
          : `el string ${rival.stringNumber}`;
      warnings.push({
        code: "ambiguous",
        message:
          `El punto esta en el limite: ${what} es casi igual de probable ` +
          `(${rival.distanceM.toFixed(2)} m contra ${best.distanceM.toFixed(2)} m). ` +
          `Conviene confirmar contando en el campo antes de reportar.`,
      });
    }
  }

  return { best, candidates, diagnostics, warnings };
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** Distancia recorrida desde el extremo de conteo, dado el avance desde `start`. */
function fromOrigin(row: CompiledRow, alongFromStartM: number): number {
  return row.originEnd === "start" ? alongFromStartM : row.lengthM - alongFromStartM;
}

/**
 * Reconstruye el reparto de modulos de la fila. Se arma desde los valores que
 * ya calculo el compilador, nunca recalculando la geometria por separado: si
 * esta funcion y la del compilador se desincronizan, el error es de metros.
 */
function layoutOf(row: CompiledRow, farm: CompiledFarm): RowLayout {
  // Todo sale de la FILA, no del perfil del parque. Un parque puede mezclar dos
  // tipos de tracker —largos de 56 y cortos de 28— en los mismos bloques, y el
  // compilador ya decidio cual es cual mirando el largo medido de cada una.
  return makeRowLayout({
    modulesPerString: row.modulesPerString,
    stringsPerRow: row.stringsPerRow,
    pitchM: row.pitchM,
    moduleGapM: farm.profile.module.gapMm / 1000,
    moduleWidthM: row.moduleWidthM,
    huecosM: row.huecosM,
    originOffsetM: row.originOffsetM,
  });
}

function positionAt(
  row: CompiledRow,
  alongFromStartM: number,
  farm: CompiledFarm,
): { positionInRow: number } {
  const hit = positionAtDistance(layoutOf(row, farm), fromOrigin(row, alongFromStartM));
  return { positionInRow: hit.positionInRow };
}

function makeAddress(
  row: CompiledRow,
  positionInRow: number,
  farm: CompiledFarm,
  frame: ReturnType<typeof makeFrame>,
  p: { x: number; y: number },
  offAxisM: number,
): Address {
  const modulesPerString = row.modulesPerString;
  const chunkIndex = chunkOf(positionInRow, modulesPerString);
  const inverted = row.inverted[chunkIndex] ?? false;
  const { module } = splitPosition(positionInRow, modulesPerString, inverted);

  // Centro del modulo, medido desde el extremo de conteo. Sale de la misma
  // funcion que interpreta las distancias, para que no puedan discrepar.
  const centreFromOrigin = distanceAtPosition(layoutOf(row, farm), positionInRow);
  const centreFromStart =
    row.originEnd === "start" ? centreFromOrigin : row.lengthM - centreFromOrigin;

  const cx = row.a.x + row.ux * centreFromStart;
  const cy = row.a.y + row.uy * centreFromStart;
  const centre = toGeo(frame, cx, cy);

  const address: Address = {
    rowId: row.source.id,
    block: row.source.block,
    tracker: row.source.tracker,
    chunkIndex,
    stringNumber: row.stringNumbers[chunkIndex] ?? chunkIndex + 1,
    module,
    countedFrom: inverted ? "far-end" : "near-dc",
    positionInRow,
    center: centre,
    distanceM: Math.hypot(p.x - cx, p.y - cy),
    offAxisM,
    confidence: 0,
  };
  /*
    Desde que punta se conto, dicho por su rumbo y no por su relacion con la
    caja. Se mide contra las coordenadas de la propia fila: no depende de la
    estrategia ni de ningun plano.
  */
  const puntaOrigen = row.originEnd === "start" ? row.source.start : row.source.end;
  const puntaLejana = row.originEnd === "start" ? row.source.end : row.source.start;
  const dLat = puntaOrigen.lat - puntaLejana.lat;
  const dLon = puntaOrigen.lon - puntaLejana.lon;
  // Se nombra el eje sobre el que la fila realmente corre. En un parque de
  // trackers eso es siempre norte-sur.
  address.origenGeografico =
    Math.abs(dLat) >= Math.abs(dLon)
      ? (dLat >= 0 ? "norte" : "sur")
      : (dLon >= 0 ? "este" : "oeste");
  if (row.source.row !== undefined) address.row = row.source.row;
  const label = row.stringLabels?.[chunkIndex];
  if (label) address.stringLabel = label;
  // Por donde se entra caminando. Sale del plano de interconexion.
  if (row.source.dcBoxLabel) address.dcBoxLabel = row.source.dcBoxLabel;
  return address;
}

// ---------------------------------------------------------------------------
// Los modulos, uno por uno
// ---------------------------------------------------------------------------

/** Un modulo con su direccion y su centro, para recorrer el parque entero. */
export interface ModuleRef {
  rowId: string;
  block: string;
  tracker: string;
  row?: string;
  chunkIndex: number;
  stringNumber: number;
  stringLabel?: string;
  module: number;
  positionInRow: number;
  /** Centro en el marco local del parque, en metros. */
  x: number;
  y: number;
}

/**
 * Todos los modulos de una fila, con su direccion ya resuelta.
 *
 * Es el recorrido inverso al de `locate`: en vez de preguntar que hay en una
 * coordenada, enumera donde esta cada modulo. Lo necesita cualquier analisis
 * que quiera mirar el parque modulo por modulo — por ejemplo comparar la
 * temperatura de cada uno contra sus vecinos del mismo string.
 *
 * Usa las mismas funciones que `locate`, a proposito: si el recorrido de ida y
 * el de vuelta se calcularan por separado podrian discrepar, y la discrepancia
 * seria invisible.
 */
export function modulesOfRow(row: CompiledRow, farm: CompiledFarm): ModuleRef[] {
  const modulesPerString = row.modulesPerString;
  const total = row.modulesPerRow;
  const layout = layoutOf(row, farm);
  const out: ModuleRef[] = [];

  for (let positionInRow = 1; positionInRow <= total; positionInRow++) {
    const chunkIndex = chunkOf(positionInRow, modulesPerString);
    const inverted = row.inverted[chunkIndex] ?? false;
    const { module } = splitPosition(positionInRow, modulesPerString, inverted);

    const centreFromOrigin = distanceAtPosition(layout, positionInRow);
    const centreFromStart =
      row.originEnd === "start" ? centreFromOrigin : row.lengthM - centreFromOrigin;

    const ref: ModuleRef = {
      rowId: row.source.id,
      block: row.source.block,
      tracker: row.source.tracker,
      chunkIndex,
      stringNumber: row.stringNumbers[chunkIndex] ?? chunkIndex + 1,
      module,
      positionInRow,
      x: row.a.x + row.ux * centreFromStart,
      y: row.a.y + row.uy * centreFromStart,
    };
    if (row.source.row) ref.row = row.source.row;
    const label = row.stringLabels?.[chunkIndex];
    if (label) ref.stringLabel = label;
    out.push(ref);
  }
  return out;
}

/** Todos los modulos del parque. Ojo: son decenas de miles en una planta grande. */
export function allModules(farm: CompiledFarm): ModuleRef[] {
  return farm.rows.flatMap((r) => modulesOfRow(r, farm));
}
