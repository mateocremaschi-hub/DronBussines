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
    warnings.push({
      code: "no-row-within-range",
      message:
        `No hay ninguna fila de trackers a menos de ${farm.maxDistanceM} m de esa coordenada. ` +
        `Puede que el bloque no este importado todavia, o que la coordenada este mal.`,
    });
    return { best: null, candidates: [], diagnostics, warnings };
  }

  near.sort((x, y) => x.clampedM - y.clampedM);
  const chosen = near.slice(0, Math.max(1, farm.maxRowCandidates));

  // --- 2. candidatos --------------------------------------------------------
  const sigma = fix.accuracyM && fix.accuracyM > 0 ? fix.accuracyM : farm.defaultAccuracyM;
  const seen = new Set<string>();
  const candidates: Address[] = [];

  for (const entry of chosen) {
    const centre = positionAt(entry.row, entry.alongM, farm);
    const lo = Math.max(1, centre.positionInRow - farm.neighborhood);
    const hi = Math.min(farm.modulesPerRow, centre.positionInRow + farm.neighborhood);

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
    const winnerPosition = clampPosition(row, alongFromOrigin, farm);
    const winnerChunk = chunkOf(winnerPosition, farm.profile.topology.modulesPerString);

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

    const raw = rawPosition(row, alongFromOrigin);
    if (raw < 1 || raw > farm.modulesPerRow) {
      warnings.push({
        code: "outside-row-extent",
        rowId: row.source.id,
        message:
          `La coordenada cae fuera de la extension de modulos de la fila ` +
          `(posicion cruda ${raw.toFixed(1)} de ${farm.modulesPerRow}). ` +
          `Recorte al modulo del extremo, pero puede que el punto pertenezca a la fila de al lado.`,
      });
    }
  }

  if (best && best.confidence < 0.35) {
    warnings.push({
      code: "low-confidence",
      message:
        `Ninguna posicion se lleva mas del ${(best.confidence * 100).toFixed(0)} % de la probabilidad. ` +
        `Confirma visualmente contra la foto termica usando la lista de vecinos.`,
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

/** Posicion continua dentro de la fila (puede caer fuera del rango valido). */
function rawPosition(row: CompiledRow, alongFromOriginM: number): number {
  return (alongFromOriginM - row.originOffsetM) / row.pitchM + 1;
}

function clampPosition(row: CompiledRow, alongFromOriginM: number, farm: CompiledFarm): number {
  const idx = Math.floor((alongFromOriginM - row.originOffsetM) / row.pitchM) + 1;
  return Math.min(Math.max(idx, 1), farm.modulesPerRow);
}

function positionAt(
  row: CompiledRow,
  alongFromStartM: number,
  farm: CompiledFarm,
): { positionInRow: number } {
  return { positionInRow: clampPosition(row, fromOrigin(row, alongFromStartM), farm) };
}

function makeAddress(
  row: CompiledRow,
  positionInRow: number,
  farm: CompiledFarm,
  frame: ReturnType<typeof makeFrame>,
  p: { x: number; y: number },
  offAxisM: number,
): Address {
  const modulesPerString = farm.profile.topology.modulesPerString;
  const chunkIndex = chunkOf(positionInRow, modulesPerString);
  const inverted = row.inverted[chunkIndex] ?? false;
  const { module } = splitPosition(positionInRow, modulesPerString, inverted);

  // Centro del modulo, medido desde el extremo de conteo.
  const centreFromOrigin =
    row.originOffsetM + (positionInRow - 1) * row.pitchM + farm.moduleWidthM / 2;
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
  if (row.source.row !== undefined) address.row = row.source.row;
  return address;
}
