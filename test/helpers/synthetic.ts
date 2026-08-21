/**
 * Geometria sintetica para los tests.
 *
 * Construye filas cuya longitud es exactamente la que el perfil predice, y
 * permite pedir el centro geometrico del enesimo hueco fisico contando desde
 * una de las dos picas. Con eso se puede testear el motor entero sin una sola
 * coordenada real: el test calcula hacia adelante (hueco -> coordenada) y el
 * motor calcula hacia atras (coordenada -> direccion).
 */

import { makeFrame, toGeo } from "../../src/geo/frame.js";
import type { FarmProfile, TrackerRow } from "../../src/types.js";

const RAD = Math.PI / 180;

export interface RowSpec {
  id: string;
  block: string;
  tracker: string;
  row?: string;
  /** La pica `start` del segmento. */
  anchor: { lat: number; lon: number };
  /** Rumbo de `start` hacia `end`. 0 = norte, 90 = este, 180 = sur. */
  azimuthDeg: number;
  side?: TrackerRow["side"];
  pos?: number;
  posTotal?: number;
  stringNumbers?: number[];
  originEnd?: TrackerRow["originEnd"];
  stringInverted?: boolean[];
  /** Fuerza un largo distinto al nominal, para probar el chequeo de coherencia. */
  lengthM?: number;
}

function pitchOf(profile: FarmProfile): number {
  return typeof profile.module.pitchMm === "number"
    ? profile.module.pitchMm / 1000
    : (profile.module.widthMm + profile.module.gapMm) / 1000;
}

/** Largo de un string completo: n modulos con n-1 huequitos entre ellos. */
function stringSpanM(profile: FarmProfile): number {
  return profile.topology.modulesPerString * pitchOf(profile) - profile.module.gapMm / 1000;
}

/** Largo pica a pica que el perfil predice para una fila completa. */
export function nominalLengthM(profile: FarmProfile): number {
  const { stringsPerRow, stringGapMm } = profile.topology;
  const offsetM = profile.geometry.endpointOffsetMm / 1000;
  const mode = profile.geometry.endpointOffsetMode ?? "both";
  const offsets = mode === "both" ? 2 * offsetM : mode === "origin" ? offsetM : 0;
  const extent =
    stringsPerRow * stringSpanM(profile) + (stringsPerRow - 1) * ((stringGapMm ?? 0) / 1000);
  return extent + offsets;
}

export function makeRow(spec: RowSpec, profile: FarmProfile): TrackerRow {
  const length = spec.lengthM ?? nominalLengthM(profile);
  const frame = makeFrame(spec.anchor.lat, spec.anchor.lon);
  const a = spec.azimuthDeg * RAD;
  const end = toGeo(frame, Math.sin(a) * length, Math.cos(a) * length);

  const row: TrackerRow = {
    id: spec.id,
    block: spec.block,
    tracker: spec.tracker,
    start: { ...spec.anchor },
    end,
  };
  if (spec.row !== undefined) row.row = spec.row;
  if (spec.side !== undefined) row.side = spec.side;
  if (spec.pos !== undefined) row.pos = spec.pos;
  if (spec.posTotal !== undefined) row.posTotal = spec.posTotal;
  if (spec.stringNumbers !== undefined) row.stringNumbers = spec.stringNumbers;
  if (spec.originEnd !== undefined) row.originEnd = spec.originEnd;
  if (spec.stringInverted !== undefined) row.stringInverted = spec.stringInverted;
  return row;
}

/**
 * Centro del hueco fisico numero `slot` (1-based) contando desde la pica
 * indicada. Es geometria pura sobre el segmento: no sabe nada de strings, de
 * inversion ni de cajas DC, que es justo lo que hace que sirva para testear.
 */
export function pointAtSlot(
  row: TrackerRow,
  slot: number,
  profile: FarmProfile,
  from: "start" | "end" = "start",
  /** Corrimiento perpendicular al eje, en metros. Simula error de GPS. */
  offAxisM = 0,
): { lat: number; lon: number } {
  const frame = makeFrame(row.start.lat, row.start.lon);
  const dx = (row.end.lon - row.start.lon) * RAD * frame.east;
  const dy = (row.end.lat - row.start.lat) * RAD * frame.north;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;

  const pitchM = pitchOf(profile);
  const widthM = profile.module.widthMm / 1000;
  const mode = profile.geometry.endpointOffsetMode ?? "both";
  const offsetM = mode === "none" ? 0 : profile.geometry.endpointOffsetMm / 1000;

  // El hueco `slot` cuenta modulos fisicos: hay que saltear la bahia de motor
  // que separa un string del siguiente.
  const n = profile.topology.modulesPerString;
  const gapM = (profile.topology.stringGapMm ?? 0) / 1000;
  const stringIndex = Math.floor((slot - 1) / n);
  const within = slot - stringIndex * n;
  const fromRef =
    offsetM + stringIndex * (stringSpanM(profile) + gapM) + (within - 1) * pitchM + widthM / 2;
  const fromStart = from === "start" ? fromRef : len - fromRef;

  const x = ux * fromStart - uy * offAxisM;
  const y = uy * fromStart + ux * offAxisM;
  return toGeo(frame, x, y);
}
