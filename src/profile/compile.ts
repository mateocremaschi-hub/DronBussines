/**
 * Compilacion del perfil: perfil declarativo + geometria cruda -> estructura
 * lista para consultar.
 *
 * Todo lo que puede resolverse una sola vez se resuelve aca: el marco local,
 * los extremos en metros, el paso de cada fila, el extremo de conteo y la
 * inversion de cada string. `locate()` queda como geometria pura mas una
 * busqueda en tabla.
 *
 * El efecto practico buscado es que los problemas de datos aparezcan al cargar
 * el parque, no cuando alguien esta parado al lado de un panel.
 */

import { makeFrame, toLocal, type LocalFrame } from "../geo/frame.js";
import { resolveInversion } from "../strategies/inversion.js";
import { resolveOriginEnd } from "../strategies/origin.js";
import type { CompiledFarm, CompiledRow, FarmProfile, TrackerRow, Warning } from "../types.js";
import { validateProfile } from "./validate.js";

const DEFAULTS = {
  maxDistanceM: 30,
  neighborhood: 2,
  maxRowCandidates: 3,
  defaultAccuracyM: 3,
  lengthToleranceMmPerModule: 15,
};

export interface CompileOptions {
  /** Punto de referencia del marco local. Por defecto, el centroide del parque. */
  origin?: { lat: number; lon: number };
}

export function compileFarm(
  profileInput: unknown,
  rows: TrackerRow[],
  options: CompileOptions = {},
): CompiledFarm {
  const profile = validateProfile(profileInput);
  const buildWarnings: Warning[] = [];

  if (rows.length === 0) {
    throw new Error(
      `El parque "${profile.id}" no tiene ninguna fila de trackers. Sin geometria no hay nada que localizar.`,
    );
  }

  const modulesPerString = profile.topology.modulesPerString;
  const stringsPerRow = profile.topology.stringsPerRow;
  const modulesPerRow = modulesPerString * stringsPerRow;

  const moduleWidthM = profile.module.widthMm / 1000;
  const nominalPitchM = (profile.module.widthMm + profile.module.gapMm) / 1000;
  const declaredPitch = profile.module.pitchMm;

  const offsetM = profile.geometry.endpointOffsetMm / 1000;
  const offsetMode = profile.geometry.endpointOffsetMode ?? "both";
  const tolerance =
    profile.geometry.lengthToleranceMmPerModule ?? DEFAULTS.lengthToleranceMmPerModule;

  const maxDistanceM = profile.matching?.maxDistanceM ?? DEFAULTS.maxDistanceM;

  const origin = options.origin ?? centroid(rows);
  const frame = makeFrame(origin.lat, origin.lon);

  const compiled: CompiledRow[] = rows.map((row) =>
    compileRow(row, {
      frame,
      profile,
      modulesPerRow,
      nominalPitchM,
      declaredPitch,
      offsetM,
      offsetMode,
      maxDistanceM,
      tolerance,
      stringsPerRow,
      buildWarnings,
    }),
  );

  const ids = new Set<string>();
  for (const r of compiled) {
    if (ids.has(r.source.id)) {
      buildWarnings.push({
        code: "missing-flag",
        rowId: r.source.id,
        message: `Hay mas de una fila con el id "${r.source.id}". Los ids tienen que ser unicos.`,
      });
    }
    ids.add(r.source.id);
  }

  return {
    profile: profile as CompiledFarm["profile"],
    rows: compiled,
    origin,
    scale: { east: frame.east, north: frame.north },
    modulesPerRow,
    moduleWidthM,
    maxDistanceM,
    neighborhood: profile.matching?.neighborhood ?? DEFAULTS.neighborhood,
    maxRowCandidates: profile.matching?.maxRowCandidates ?? DEFAULTS.maxRowCandidates,
    defaultAccuracyM: profile.matching?.defaultAccuracyM ?? DEFAULTS.defaultAccuracyM,
    buildWarnings,
  };
}

// ---------------------------------------------------------------------------

interface RowContext {
  frame: LocalFrame;
  profile: FarmProfile;
  modulesPerRow: number;
  nominalPitchM: number;
  declaredPitch: number | null | "derive" | undefined;
  offsetM: number;
  offsetMode: "both" | "origin" | "none";
  maxDistanceM: number;
  tolerance: number;
  stringsPerRow: number;
  buildWarnings: Warning[];
}

function compileRow(row: TrackerRow, ctx: RowContext): CompiledRow {
  const a = toLocal(ctx.frame, row.start.lat, row.start.lon);
  const b = toLocal(ctx.frame, row.end.lat, row.end.lon);

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthM = Math.hypot(dx, dy);

  if (lengthM === 0) {
    throw new Error(
      `La fila "${row.id}" tiene las dos picas en el mismo punto. Revisa la importacion de geometria.`,
    );
  }

  const ux = dx / lengthM;
  const uy = dy / lengthM;

  // --- estrategia de origen (se resuelve una sola vez) ----------------------
  const originRes = resolveOriginEnd(
    { row, startIsNorth: a.y > b.y, startIsEast: a.x > b.x },
    ctx.profile.addressing,
  );
  const strategyWarnings = [...originRes.warnings];

  // --- estrategia de inversion, chunk por chunk ----------------------------
  const inverted: boolean[] = [];
  for (let chunk = 0; chunk < ctx.stringsPerRow; chunk++) {
    const res = resolveInversion(row, chunk, ctx.profile.addressing);
    inverted.push(res.inverted);
    strategyWarnings.push(...res.warnings);
  }

  // --- offsets de pica ------------------------------------------------------
  const originOffsetM = ctx.offsetMode === "none" ? 0 : ctx.offsetM;
  const farOffsetM = ctx.offsetMode === "both" ? ctx.offsetM : 0;
  const usableM = lengthM - originOffsetM - farOffsetM;

  if (usableM <= 0) {
    throw new Error(
      `La fila "${row.id}" mide ${lengthM.toFixed(2)} m, menos que los offsets de pica configurados. Revisa geometry.endpointOffsetMm o la geometria importada.`,
    );
  }

  // --- paso -----------------------------------------------------------------
  const derivedPitchM = usableM / ctx.modulesPerRow;
  let pitchM: number;
  if (row.pitchMmOverride != null) {
    pitchM = row.pitchMmOverride / 1000;
  } else if (ctx.declaredPitch === "derive") {
    pitchM = derivedPitchM;
  } else if (typeof ctx.declaredPitch === "number") {
    pitchM = ctx.declaredPitch / 1000;
  } else {
    pitchM = ctx.nominalPitchM;
  }

  // Cuanto se aparta el paso declarado del que exige el largo real del
  // segmento. Es la senal mas barata de que la geometria importada esta mal:
  // un bloque con filas partidas o picas cruzadas salta aca, sin ir al campo.
  const lengthResidualMmPerModule = (derivedPitchM - pitchM) * 1000;
  if (Math.abs(lengthResidualMmPerModule) > ctx.tolerance) {
    ctx.buildWarnings.push({
      code: "length-mismatch",
      rowId: row.id,
      message:
        `La fila "${row.id}" mide ${lengthM.toFixed(2)} m. Con ${ctx.modulesPerRow} modulos y ` +
        `offsets de ${originOffsetM.toFixed(2)}/${farOffsetM.toFixed(2)} m, el paso deberia ser ` +
        `${(derivedPitchM * 1000).toFixed(0)} mm, pero el perfil declara ${(pitchM * 1000).toFixed(0)} mm ` +
        `(diferencia de ${lengthResidualMmPerModule.toFixed(0)} mm por modulo). ` +
        `Revisa la geometria de esa fila o el paso del perfil.`,
    });
  }

  // --- numeros de string ----------------------------------------------------
  // El menor de los numeros presentes es el mas cercano al origen. Comparar
  // relativamente, y nunca contra un numero fijo: hay filas cuyos dos strings
  // se numeran 5 y 6 en vez de 1 y 2.
  let stringNumbers: number[];
  if (row.stringNumbers && row.stringNumbers.length > 0) {
    stringNumbers = [...row.stringNumbers].sort((x, y) => x - y);
    if (stringNumbers.length !== ctx.stringsPerRow) {
      ctx.buildWarnings.push({
        code: "missing-flag",
        rowId: row.id,
        message:
          `La fila "${row.id}" trae ${stringNumbers.length} numero(s) de string pero el perfil declara ` +
          `${ctx.stringsPerRow} por fila. Completo con correlativos.`,
      });
      while (stringNumbers.length < ctx.stringsPerRow) {
        stringNumbers.push((stringNumbers[stringNumbers.length - 1] ?? 0) + 1);
      }
      stringNumbers = stringNumbers.slice(0, ctx.stringsPerRow);
    }
  } else {
    stringNumbers = Array.from({ length: ctx.stringsPerRow }, (_, i) => i + 1);
  }

  const pad = ctx.maxDistanceM;
  return {
    source: row,
    a,
    b,
    lengthM,
    ux,
    uy,
    bbox: {
      minX: Math.min(a.x, b.x) - pad,
      maxX: Math.max(a.x, b.x) + pad,
      minY: Math.min(a.y, b.y) - pad,
      maxY: Math.max(a.y, b.y) + pad,
    },
    pitchM,
    originOffsetM,
    farOffsetM,
    stringNumbers,
    lengthResidualMmPerModule,
    originEnd: originRes.end,
    inverted,
    strategyWarnings,
  };
}

function centroid(rows: TrackerRow[]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const r of rows) {
    lat += r.start.lat + r.end.lat;
    lon += r.start.lon + r.end.lon;
  }
  const n = rows.length * 2;
  return { lat: lat / n, lon: lon / n };
}
