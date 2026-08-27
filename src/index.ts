export * from "./types.js";

export { locate, modulesOfRow, allModules, type ModuleRef } from "./locate.js";
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
export {
  anguloDeTracker,
  husoAproximado,
  posicionSolar,
  TOPE_TRACKER_DEG,
  ventanaDeVuelo,
  type AnguloDeTracker,
  type PosicionSolar,
  type VentanaDeVuelo,
} from "./sun.js";

/**
 * Formato humano de una direccion, para la app de campo y el reporte.
 *
 * Cuando el plano trajo el nombre de la caja de continua, se lo dice: "desde la
 * caja DC" es una instruccion incompleta en un bloque con doce cajas, y el
 * nombre es justo el dato que convierte la direccion en un camino a caminar.
 */
export function formatAddress(a: import("./types.js").Address): string {
  const row = a.row ? ` ${a.row}` : "";
  const end =
    a.countedFrom === "near-dc"
      ? `desde la caja DC${a.dcBoxLabel ? " " + a.dcBoxLabel : ""}`
      : `desde la punta lejana${a.dcBoxLabel ? ", o sea la mas lejos de " + a.dcBoxLabel : ""}`;
  return `Bloque ${a.block}, tracker ${a.tracker}${row}, string ${a.stringNumber}, modulo ${a.module} (${end})`;
}
