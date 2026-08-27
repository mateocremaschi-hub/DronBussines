/**
 * Conversion UTM <-> WGS84 (serie de Snyder, elipsoide WGS84).
 *
 * La ingesta suele venir en UTM: los Excel de picas de Edenvale estan en
 * zona 56 sur. El motor trabaja siempre en WGS84, asi que esto vive en el
 * borde, no en el calculo.
 */

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function centralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

export interface UtmPoint {
  easting: number;
  northing: number;
  zone: number;
  hemisphere: "N" | "S";
}

export function utmToWgs84(p: UtmPoint): { lat: number; lon: number } {
  if (!Number.isInteger(p.zone) || p.zone < 1 || p.zone > 60) {
    throw new RangeError(`Zona UTM invalida: ${p.zone}`);
  }

  const x = p.easting - 500000;
  const y = p.hemisphere === "S" ? p.northing - 10000000 : p.northing;

  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);

  const c1 = EP2 * cos1 * cos1;
  const t1 = tan1 * tan1;
  const w = 1 - E2 * sin1 * sin1;
  const n1 = A / Math.sqrt(w);
  const r1 = (A * (1 - E2)) / (w * Math.sqrt(w));
  const d = x / (n1 * K0);

  const lat =
    phi1 -
    ((n1 * tan1) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);

  const lon =
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
    cos1;

  return { lat: lat * DEG, lon: centralMeridian(p.zone) + lon * DEG };
}

export function wgs84ToUtm(lat: number, lon: number, zone?: number): UtmPoint {
  // La 61 existe solo en lon = 180 exacto, que es el borde de la 60.
  const z = zone ?? Math.min(60, Math.floor((lon + 180) / 6) + 1);
  const phi = lat * RAD;
  const lam = lon * RAD;
  const lam0 = centralMeridian(z) * RAD;

  const sinP = Math.sin(phi);
  const cosP = Math.cos(phi);
  const tanP = Math.tan(phi);

  const n = A / Math.sqrt(1 - E2 * sinP * sinP);
  const t = tanP * tanP;
  const c = EP2 * cosP * cosP;
  const a1 = cosP * (lam - lam0);

  const m =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    K0 *
      n *
      (a1 +
        ((1 - t + c) * a1 ** 3) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a1 ** 5) / 120) +
    500000;

  let northing =
    K0 *
    (m +
      n *
        tanP *
        ((a1 * a1) / 2 +
          ((5 - t + 9 * c + 4 * c * c) * a1 ** 4) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a1 ** 6) / 720));

  const hemisphere: "N" | "S" = lat < 0 ? "S" : "N";
  if (hemisphere === "S") northing += 10000000;

  return { easting, northing, zone: z, hemisphere };
}
