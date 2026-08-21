/**
 * Marco local plano.
 *
 * Sobre la extension de una solar farm (unos pocos km) una proyeccion
 * equirectangular anclada al centro del parque, usando los radios de curvatura
 * reales del elipsoide WGS84, tiene error sub-centimetrico. Es mucho mas
 * barata y mas facil de testear que una proyeccion completa, y evita arrastrar
 * una dependencia de proyecciones al motor.
 */

const A = 6378137.0; // semieje mayor WGS84
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

const RAD = Math.PI / 180;

export interface LocalFrame {
  origin: { lat: number; lon: number };
  /** Metros por radian de longitud, a la latitud del origen. */
  east: number;
  /** Metros por radian de latitud, a la latitud del origen. */
  north: number;
}

/** Construye el marco local anclado a un punto de referencia del parque. */
export function makeFrame(lat: number, lon: number): LocalFrame {
  const phi = lat * RAD;
  const s = Math.sin(phi);
  const w = 1 - E2 * s * s;
  // Radio de curvatura normal (este-oeste) y meridional (norte-sur).
  const nRad = A / Math.sqrt(w);
  const mRad = (A * (1 - E2)) / (w * Math.sqrt(w));
  return {
    origin: { lat, lon },
    east: nRad * Math.cos(phi),
    north: mRad,
  };
}

/** Geodesicas -> metros locales. */
export function toLocal(frame: LocalFrame, lat: number, lon: number): { x: number; y: number } {
  return {
    x: (lon - frame.origin.lon) * RAD * frame.east,
    y: (lat - frame.origin.lat) * RAD * frame.north,
  };
}

/** Metros locales -> geodesicas. */
export function toGeo(frame: LocalFrame, x: number, y: number): { lat: number; lon: number } {
  return {
    lat: frame.origin.lat + y / frame.north / RAD,
    lon: frame.origin.lon + x / frame.east / RAD,
  };
}

/** Distancia entre dos puntos geodesicos, via el marco local. Metros. */
export function distanceM(
  frame: LocalFrame,
  p: { lat: number; lon: number },
  q: { lat: number; lon: number },
): number {
  const a = toLocal(frame, p.lat, p.lon);
  const b = toLocal(frame, q.lat, q.lon);
  return Math.hypot(b.x - a.x, b.y - a.y);
}
