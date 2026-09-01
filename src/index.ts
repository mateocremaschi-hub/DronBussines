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
 * Dice DONDE ESTA EL PANEL y nada mas. La punta se nombra por su rumbo —"desde
 * la punta norte"— porque el numero de modulo es una posicion y necesita un
 * datum declarado; el informe declara el mismo en su encabezado.
 *
 * Lo que NO va aca es la caja de continua. Estuvo dos veces y las dos veces
 * sobraba. Primero como "desde la caja DC", que ademas era falso desde que el
 * conteo arranca en el norte. Despues como "entrando por DCB-…", que era
 * cierto pero seguia siendo una instruccion para caminar hasta el panel — y el
 * trabajo no es caminar hasta el panel, es entregar su ubicacion. La caja sigue
 * estando en el informe como columna, que es donde le sirve al cliente para
 * cruzar con su documentacion electrica.
 */
export function formatAddress(a: import("./types.js").Address): string {
  const row = a.row ? ` ${a.row}` : "";
  const end = a.origenGeografico
    ? `contando desde la punta ${a.origenGeografico}`
    : a.countedFrom === "near-dc"
      ? `desde la caja DC${a.dcBoxLabel ? " " + a.dcBoxLabel : ""}`
      : `desde la punta lejana${a.dcBoxLabel ? ", o sea la mas lejos de " + a.dcBoxLabel : ""}`;
  return `Bloque ${a.block}, tracker ${a.tracker}${row}, string ${a.stringNumber}, modulo ${a.module} (${end})`;
}
