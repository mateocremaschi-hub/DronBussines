/**
 * Hacia donde mira la foto de verdad, medido con las propias fotos.
 *
 * La huella se orienta con `GimbalYawDegree`. En el Matrice 4T ese dato esta
 * 180 grados corrido respecto del eje "arriba" de la imagen, y el programa le
 * creyo: TODO el bloque 1 de Wellington se proyecto espejado. Por eso las
 * cajas de la foto 0373 cayeron en el pasto de la derecha mientras los paneles
 * estaban a la izquierda, y por eso los 593 hallazgos eran suelo.
 *
 * Lo peor del error es que no se nota. Una huella rectangular girada 180
 * grados sobre su centro es la MISMA huella: los modulos que entran en el
 * cuadro siguen siendo los correctos, la cuenta de fotos y de modulos da
 * bien, ninguna advertencia se dispara. Lo unico que cambia es DONDE se
 * dibuja cada modulo adentro de la foto, que es justo lo que nadie mira.
 *
 * Asi que el giro se mide. Entre dos fotos seguidas el dron se movio algo que
 * el RTK sabe con dos milimetros; el contenido de la imagen se corrio otro
 * tanto, y de que lado se corrio lo dice la correlacion. Se prueban los cuatro
 * giros rectos del rumbo del EXIF y gana el que explica el corrimiento.
 *
 * Sobre las 44 fotos del bloque 1: 13 pares deciden con margen y los 13 dicen
 * lo mismo —180 grados— en las dos pasadas; en los otros 29 el par no decide
 * porque las filas son iguales a lo largo, pero ni uno solo prefiere el EXIF
 * crudo.
 *
 * El angulo fino se lo sigue poniendo el EXIF: es bueno (±1 grado contra lo
 * medido). Lo que se le corrige es de que lado esta puesto.
 */

import type { Radiometric } from "./thermal";

const RAD = Math.PI / 180;

/** Angulo de 0 a 360, con el norte en 0 y creciendo hacia el este. */
export function normalizarAzimut(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** La diferencia mas corta entre dos angulos, de -180 a 180. */
export function diferenciaAngular(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * Cuanto se corre el contenido de la imagen entre dos fotos.
 *
 * Con el eje "arriba" de la imagen apuntando al azimut dado, el punto del
 * suelo que estaba en el pixel p de la primera foto aparece en p + (sx, sy)
 * en la segunda. `sy` cuenta hacia abajo, como los pixeles.
 */
export function corrimientoEsperado(
  azimutDeg: number,
  dEsteM: number,
  dNorteM: number,
  mPorPx: number,
): { sx: number; sy: number } {
  const s = Math.sin(azimutDeg * RAD), c = Math.cos(azimutDeg * RAD);
  return {
    sx: (dNorteM * s - dEsteM * c) / mPorPx,
    sy: (dEsteM * s + dNorteM * c) / mPorPx,
  };
}

/**
 * Cuanto se parecen dos fotos con un corrimiento dado.
 *
 * Correlacion normalizada: no le importan ni el nivel ni el contraste, que
 * entre dos fotos seguidas cambian solos con el auto-rango de la camara. Se
 * mide solo donde las dos fotos tienen pixel, y si eso es poco no se contesta.
 */
function parecido(
  a: Radiometric,
  b: Radiometric,
  dx: number,
  dy: number,
  paso: number,
): number {
  const W = a.width, H = a.height;
  const x0 = Math.max(0, -dx) + 8, x1 = Math.min(W, W - dx) - 8;
  const y0 = Math.max(0, -dy) + 8, y1 = Math.min(H, H - dy) - 8;
  if (x1 - x0 < 40 || y1 - y0 < 40) return -2;
  let s = 0, sa = 0, sb = 0, saa = 0, sbb = 0, n = 0;
  for (let y = y0; y < y1; y += paso) {
    for (let x = x0; x < x1; x += paso) {
      const va = a.celsius[y * W + x]!;
      const vb = b.celsius[(y + dy) * W + (x + dx)]!;
      s += va * vb; sa += va; sb += vb; saa += va * va; sbb += vb * vb; n++;
    }
  }
  if (n < 400) return -2;
  const cov = s / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  if (va < 1e-6 || vb < 1e-6) return -2;
  return cov / Math.sqrt(va * vb);
}

/**
 * Cuanto se deja buscar alrededor de lo que predice cada candidato.
 *
 * La prediccion usa la escala del EXIF, que puede estar un diez por ciento
 * corrida —lo estaba— y sobre un corrimiento de 170 pixeles eso son 19. Se
 * busca de a cuatro pixeles porque aca no se necesita punteria: se necesita
 * saber para que lado.
 */
const RADIO_PX = 24;
const PASO_DE_BUSQUEDA_PX = 4;

function mejorParecido(a: Radiometric, b: Radiometric, px: number, py: number): number {
  const paso = Math.max(2, Math.round(Math.min(a.width, a.height) / 128));
  let mejor = -2;
  for (let dy = -RADIO_PX; dy <= RADIO_PX; dy += PASO_DE_BUSQUEDA_PX) {
    for (let dx = -RADIO_PX; dx <= RADIO_PX; dx += PASO_DE_BUSQUEDA_PX) {
      const v = parecido(a, b, Math.round(px) + dx, Math.round(py) + dy, paso);
      if (v > mejor) mejor = v;
    }
  }
  return mejor;
}

export interface ParDeFotos {
  a: Radiometric;
  b: Radiometric;
  /** De la primera a la segunda, en metros. */
  dEsteM: number;
  dNorteM: number;
  mPorPx: number;
  /** El rumbo que declara el EXIF de la primera foto. */
  gimbalYawDeg: number;
}

export interface VotoDeUnPar {
  /** 0, 90, 180 o 270: cuanto hay que girarle al rumbo del EXIF. */
  giroDeg: number;
  puntaje: number;
  /** Cuanto le gano al segundo: sin margen el par no decide nada. */
  margen: number;
}

const GIROS = [0, 90, 180, 270];

/**
 * El giro que explica como se movio la imagen entre dos fotos.
 *
 * Devuelve `null` cuando el par no sirve para preguntar: si el dron casi no se
 * movio no hay corrimiento que medir, y si se movio mas que el cuadro las dos
 * fotos no se pisan.
 */
export function votoDeUnPar(par: ParDeFotos): VotoDeUnPar | null {
  if (par.a.width !== par.b.width || par.a.height !== par.b.height) return null;
  if (!(par.mPorPx > 0)) return null;
  const recorrido = Math.hypot(par.dEsteM, par.dNorteM);
  if (recorrido < 1) return null;
  if (recorrido / par.mPorPx > Math.min(par.a.width, par.a.height) * 0.75) return null;

  let mejor = { giroDeg: 0, puntaje: -2 };
  let segundo = -2;
  for (const giro of GIROS) {
    const p = corrimientoEsperado(
      normalizarAzimut(par.gimbalYawDeg + giro), par.dEsteM, par.dNorteM, par.mPorPx,
    );
    const r = mejorParecido(par.a, par.b, p.sx, p.sy);
    if (r > mejor.puntaje) { segundo = mejor.puntaje; mejor = { giroDeg: giro, puntaje: r }; }
    else if (r > segundo) segundo = r;
  }
  if (mejor.puntaje < -1) return null;
  return { giroDeg: mejor.giroDeg, puntaje: mejor.puntaje, margen: mejor.puntaje - segundo };
}

export interface GiroDeLaCamara {
  giroDeg: number;
  /** Pares que decidieron con margen. */
  votos: number;
  /** De esos, cuantos votaron lo que salio. */
  aFavor: number;
  /** Pares mirados en total, decidan o no. */
  mirados: number;
}

/**
 * Un par decide si su candidato le gana al segundo por esto. Sobre las fotos
 * reales los pares que deciden separan 0,3 a 0,8, y los que no, menos de 0,1:
 * el corte cae en tierra de nadie a proposito.
 */
const MARGEN_MINIMO = 0.15;
/** Y ademas tiene que haber enganchado: media correlacion no es un enganche. */
const PUNTAJE_MINIMO = 0.5;
const VOTOS_MINIMOS = 3;
/** Un solo par en contra ya obliga a no tocar nada y avisar. */
const ACUERDO_MINIMO = 0.8;

/**
 * Cuanto hay que girarle al rumbo del EXIF para todo el vuelo.
 *
 * Devuelve `null` cuando las fotos no alcanzan para decidir: ahi se sigue
 * usando el EXIF como siempre, pero hay que decirlo.
 */
export function decidirElGiro(votos: VotoDeUnPar[]): GiroDeLaCamara | null {
  const firmes = votos.filter(
    (v) => v.margen >= MARGEN_MINIMO && v.puntaje >= PUNTAJE_MINIMO,
  );
  if (firmes.length < VOTOS_MINIMOS) return null;
  const cuenta = new Map<number, number>();
  for (const v of firmes) cuenta.set(v.giroDeg, (cuenta.get(v.giroDeg) ?? 0) + 1);
  let gana = { giroDeg: 0, n: 0 };
  for (const [giroDeg, n] of cuenta) if (n > gana.n) gana = { giroDeg, n };
  if (gana.n / firmes.length < ACUERDO_MINIMO) return null;
  return {
    giroDeg: gana.giroDeg,
    votos: firmes.length,
    aFavor: gana.n,
    mirados: votos.length,
  };
}

/** El rumbo que le toca a una foto. Sin medicion, manda el EXIF. */
export function rumboDeLaFoto(
  giro: GiroDeLaCamara | null,
  gimbalYawDeg: number | null,
): number | null {
  if (gimbalYawDeg == null) return null;
  if (!giro) return gimbalYawDeg;
  return normalizarAzimut(gimbalYawDeg + giro.giroDeg);
}
