/**
 * Parseo de coordenadas escritas a mano.
 *
 * Existe por una razon concreta: en Edenvale, una prueba de campo dio un
 * resultado equivocado y se perdieron horas buscando un bug en el calculo.
 * La causa era la conversion manual de grados-minutos-segundos a decimal.
 * Pegar el texto tal como sale de Google Maps elimina esa clase de error.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const HEMI = new Set(["N", "S", "E", "W"]);

interface Component {
  nums: number[];
  hemi?: string;
}

/**
 * Acepta, entre otros:
 *   -27.504333, 152.752833
 *   27°30'15.6"S 152°45'10.2"E
 *   S 27 30 15.6  E 152 45 10.2
 *   27 30.26 S, 152 45.17 E
 *   152°45'10.2"E 27°30'15.6"S   (invertido: lo ordena por el hemisferio)
 */
export function parseCoordinate(input: string): LatLon {
  const tokens = tokenize(input);
  const hemis = tokens.filter((t) => typeof t === "string");
  const numbers = tokens.filter((t) => typeof t === "number") as number[];

  const components =
    hemis.length === 0 ? splitWithoutHemispheres(numbers, input) : walkWithHemispheres(tokens, input);

  if (components.length !== 2) {
    throw new SyntaxError(
      `Esperaba dos componentes (latitud y longitud), encontre ${components.length}: ${input}`,
    );
  }

  const [c0, c1] = components as [Component, Component];
  const v0 = toDecimal(c0);
  const v1 = toDecimal(c1);

  const axisOf = (c: Component): "lat" | "lon" | undefined =>
    c.hemi === "N" || c.hemi === "S" ? "lat" : c.hemi === "E" || c.hemi === "W" ? "lon" : undefined;

  const swap = axisOf(c0) === "lon" || axisOf(c1) === "lat";
  const lat = swap ? v1 : v0;
  const lon = swap ? v0 : v1;

  if (Math.abs(lat) > 90) throw new RangeError(`Latitud fuera de rango (${lat}): ${input}`);
  if (Math.abs(lon) > 180) throw new RangeError(`Longitud fuera de rango (${lon}): ${input}`);

  return { lat, lon };
}

// ---------------------------------------------------------------------------

type Token = number | string;

function tokenize(input: string): Token[] {
  const cleaned = input
    .toUpperCase()
    .replace(/[°º*]/g, " ")
    .replace(/['´`′]/g, " ")
    .replace(/["″“”]/g, " ")
    .replace(/[,;]/g, " ")
    .replace(/([NSEW])/g, " $1 ")
    .trim();

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      if (HEMI.has(tok)) return tok;
      const n = Number(tok);
      if (!Number.isFinite(n)) {
        throw new SyntaxError(`No entiendo el fragmento "${tok}" en la coordenada: ${input}`);
      }
      return n;
    });
}

/**
 * Sin letras de hemisferio no hay forma de saber donde termina una componente,
 * asi que se exige simetria: los numeros se parten al medio. "27 30" es un par
 * decimal; "27 30 15.6 152 45 10.2" son dos ternas.
 */
function splitWithoutHemispheres(numbers: number[], input: string): Component[] {
  if (numbers.length === 0 || numbers.length % 2 !== 0 || numbers.length > 6) {
    throw new SyntaxError(
      `Sin N/S/E/W necesito una cantidad par de numeros (2, 4 o 6) para partir en dos componentes. Recibi ${numbers.length}: ${input}`,
    );
  }
  const half = numbers.length / 2;
  return [{ nums: numbers.slice(0, half) }, { nums: numbers.slice(half) }];
}

function walkWithHemispheres(tokens: Token[], input: string): Component[] {
  const components: Component[] = [];
  let cur: Component = { nums: [] };

  const flush = () => {
    if (cur.nums.length > 0 || cur.hemi) components.push(cur);
    cur = { nums: [] };
  };

  for (const tok of tokens) {
    if (typeof tok === "string") {
      if (cur.hemi === undefined && cur.nums.length > 0) {
        // Hemisferio al final: "27 30 15.6 S"
        cur.hemi = tok;
        flush();
      } else {
        // Hemisferio adelante: "S 27 30 15.6"
        flush();
        cur.hemi = tok;
      }
      continue;
    }
    if (cur.nums.length >= 3) {
      throw new SyntaxError(
        `Mas de tres numeros seguidos sin hemisferio; no se donde corta una componente: ${input}`,
      );
    }
    cur.nums.push(tok);
  }
  flush();
  return components;
}

function toDecimal(c: Component): number {
  const [d = 0, m = 0, s = 0] = c.nums;
  if (m < 0 || s < 0) throw new RangeError("Los minutos y segundos no pueden ser negativos.");
  if (m >= 60 || s >= 60) throw new RangeError("Los minutos y segundos tienen que ser menores a 60.");

  const magnitude = Math.abs(d) + m / 60 + s / 3600;
  const negativeNumber = d < 0 || Object.is(d, -0);
  const negativeHemi = c.hemi === "S" || c.hemi === "W";
  return magnitude * (negativeNumber ? -1 : 1) * (negativeHemi ? -1 : 1);
}

/** Alias con el nombre que ya usa la app de Edenvale. */
export const parseDMS = parseCoordinate;
