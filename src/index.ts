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
export { projectOnSegment, type Projection } from "./geo/segment.js";
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
 * La frase de la punta se dice por RUMBO —"desde la punta norte"— y no por su
 * relacion con la caja de continua. Decir "desde la caja DC" solo era cierto
 * mientras el parque contara desde la caja; con un parque que cuenta desde el
 * norte, esa misma frase manda a contar desde la punta contraria de una fila de
 * 65 metros. Es la unica frase que el tecnico ejecuta caminando, asi que no
 * puede depender de una configuracion que el que lee no ve.
 *
 * La caja sigue estando, pero como lo que es: por donde se entra. En un bloque
 * con doce cajas, el nombre es lo que convierte la direccion en un camino.
 */
export function formatAddress(a: import("./types.js").Address): string {
  const row = a.row ? ` ${a.row}` : "";
  const end = a.origenGeografico
    ? `contando desde la punta ${a.origenGeografico}`
    : a.countedFrom === "near-dc"
      ? `desde la caja DC${a.dcBoxLabel ? " " + a.dcBoxLabel : ""}`
      : `desde la punta lejana${a.dcBoxLabel ? ", o sea la mas lejos de " + a.dcBoxLabel : ""}`;
  const entrada = a.origenGeografico && a.dcBoxLabel ? `, entrando por ${a.dcBoxLabel}` : "";
  return `Bloque ${a.block}, tracker ${a.tracker}${row}, string ${a.stringNumber}, modulo ${a.module} (${end}${entrada})`;
}
