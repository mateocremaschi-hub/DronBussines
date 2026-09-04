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
  /**
   * Cuanto se parece la foto de al lado con cada uno de los cuatro giros, en
   * el mismo orden que `GIROS`.
   *
   * Se guardan los cuatro y no el ganador. Un par suelto casi nunca decide: en
   * el medio de una fila de trescientos metros el terreno es igual a lo largo,
   * asi que ir para adelante y para atras correlacionan casi igual —0,88
   * contra 0,78— y eso no alcanza para afirmar nada. Lo que si alcanza es que
   * los catorce pares del vuelo prefieran SIEMPRE el mismo, cada uno por poco.
   */
  puntajes: number[];
}

/** Los cuatro lados por los que puede estar puesta una camara. */
export const GIROS = [0, 90, 180, 270];

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

  const puntajes = GIROS.map((giro) => {
    const p = corrimientoEsperado(
      normalizarAzimut(par.gimbalYawDeg + giro), par.dEsteM, par.dNorteM, par.mPorPx,
    );
    return mejorParecido(par.a, par.b, p.sx, p.sy);
  });
  // Si ni el mejor de los cuatro engancha, esta foto no sirve para preguntar.
  if (Math.max(...puntajes) < 0.3) return null;
  return { puntajes };
}

export interface GiroDeLaCamara {
  giroDeg: number;
  /** Pares que se pudieron mirar. */
  pares: number;
  /** De esos, cuantos prefirieron por su cuenta el giro que salio. */
  aFavor: number;
  /** Cuanto le saca al segundo, promediado sobre todos los pares. */
  ventaja: number;
}

/**
 * Tres pares son pocos para un promedio, pero son el vuelo mas corto que vale
 * la pena revisar. Menos que eso no se corrige nada y se avisa.
 */
const PARES_MINIMOS = 3;
/**
 * Cuanto tiene que sacarle el ganador al segundo, promediando los pares.
 *
 * Cinco centesimas. Sobre las fotos del bloque 1 el ganador saca 0,14 de
 * promedio; los pares que no deciden por su cuenta aportan 0,10 cada uno y
 * siempre para el mismo lado. Un empate real anda en 0,00 a 0,02.
 */
const VENTAJA_MINIMA = 0.05;
/**
 * Y ademas casi todos los pares tienen que preferirlo por su cuenta.
 *
 * Esto es lo que separa "poca ventaja pero siempre la misma" de "ventaja
 * promedio que sale de dos pares raros": catorce de catorce es una cosa, ocho
 * de catorce es otra.
 */
const ACUERDO_MINIMO = 0.8;

/**
 * Cuanto hay que girarle al rumbo del EXIF para todo el vuelo.
 *
 * Se promedian los cuatro puntajes de cada par en vez de contar ganadores.
 * Contando ganadores se perdia el vuelo entero: de catorce pares del bloque 1
 * solo tres decidian por su cuenta con margen, y con pocas fotos podian ser
 * cero — y entonces no se corregia nada, que es exactamente el error que esto
 * viene a arreglar. Los catorce prefieren el mismo giro; lo que cambia es que
 * once lo prefieren por poco.
 *
 * Devuelve `null` cuando las fotos no alcanzan para decidir: ahi se sigue
 * usando el EXIF como siempre, pero hay que decirlo.
 */
export function decidirElGiro(votos: VotoDeUnPar[]): GiroDeLaCamara | null {
  if (votos.length < PARES_MINIMOS) return null;

  const medias = GIROS.map(
    (_, i) => votos.reduce((a, v) => a + (v.puntajes[i] ?? -2), 0) / votos.length,
  );
  let mejor = 0;
  for (let i = 1; i < medias.length; i++) if (medias[i]! > medias[mejor]!) mejor = i;
  let segundo = -Infinity;
  for (let i = 0; i < medias.length; i++) if (i !== mejor && medias[i]! > segundo) segundo = medias[i]!;
  if (medias[mejor]! - segundo < VENTAJA_MINIMA) return null;

  let aFavor = 0;
  for (const v of votos) {
    let suyo = 0;
    for (let i = 1; i < v.puntajes.length; i++) if (v.puntajes[i]! > v.puntajes[suyo]!) suyo = i;
    if (suyo === mejor) aFavor++;
  }
  if (aFavor / votos.length < ACUERDO_MINIMO) return null;

  return {
    giroDeg: GIROS[mejor]!,
    pares: votos.length,
    aFavor,
    ventaja: medias[mejor]! - segundo,
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
