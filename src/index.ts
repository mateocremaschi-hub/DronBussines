export * from "./types.js";

export { locate } from "./locate.js";
export { compileFarm, type CompileOptions } from "./profile/compile.js";
export { validateProfile, ProfileError } from "./profile/validate.js";

export { resolveOriginEnd, type OriginContext, type OriginResult } from "./strategies/origin.js";
export {
  resolveInversion,
  splitPosition,
  chunkOf,
  type InversionResult,
} from "./strategies/inversion.js";

export { makeFrame, toLocal, toGeo, distanceM, type LocalFrame } from "./geo/frame.js";
export { projectOnSegment, pointAlong, type Projection } from "./geo/segment.js";
export { utmToWgs84, wgs84ToUtm, type UtmPoint } from "./geo/utm.js";
export { parseCoordinate, parseDMS, type LatLon } from "./geo/dms.js";

/** Formato humano de una direccion, para la app de campo y el reporte. */
export function formatAddress(a: import("./types.js").Address): string {
  const row = a.row ? ` ${a.row}` : "";
  const end = a.countedFrom === "near-dc" ? "desde la caja DC" : "desde la punta lejana";
  return `Bloque ${a.block}, tracker ${a.tracker}${row}, string ${a.stringNumber}, modulo ${a.module} (${end})`;
}
