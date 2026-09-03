/**
 * El borde del cuadro lee mas caliente que el centro, y hay que sacarselo.
 *
 * Una termica de dron no es un termometro parejo. El microbolometro no esta
 * refrigerado: el propio cuerpo de la camara y el barril de la lente irradian
 * sobre los detectores de afuera, asi que la misma superficie leida en una
 * esquina del cuadro da varios grados mas que leida en el centro. Es el
 * vinieteo termico, y todas las camaras de esta clase lo tienen.
 *
 * Medido sobre la foto real del Matrice 4T del 3 de septiembre, mirando SOLO
 * pixeles de panel: 42,1 °C en el centro y 46,0 °C en las esquinas. Casi
 * cuatro grados, sobre un umbral de anomalia leve de tres.
 *
 * Eso alcanza para inventar defectos solo. La app compara cada modulo contra
 * sus hermanos de string, y los hermanos casi nunca caen a la misma distancia
 * del centro del cuadro: un modulo fotografiado en la esquina contra hermanos
 * fotografiados en el centro sale con +3 °C que no existen. Fue exactamente lo
 * que paso — un modulo del borde de arriba leyo 45,0 °C contra 41,9 de sus
 * hermanos y se reporto como "modulo completo, circuito abierto".
 *
 * La correccion sale de la propia foto, sin calibracion de fabrica: hay
 * cientos de modulos en cada cuadro a todas las distancias del centro, y la
 * mediana de cada anillo dice cuanto sube el borde. Dos frenos la hacen
 * segura:
 *
 * - Solo corrige en el sentido fisico —el borde mas caliente que el centro— y
 *   nunca al reves. Una foto con el centro caliente no se toca.
 * - La correccion no puede bajar hacia afuera.
 *
 * Los dos frenos existen por lo mismo: que un defecto de verdad nunca sea
 * absorbido por la correccion. Verificado contra las tres fotos reales: en la
 * que no tiene defectos grandes aplana el cuadro de 42,1-46,0 a 42,1 parejo, y
 * en las dos que tienen un string desconectado cerca del centro la correccion
 * da exactamente cero en todos los anillos.
 */

/** En cuantos anillos se parte el cuadro para medir el vinieteo. */
const ANILLOS = 6;

/**
 * Radio de la esquina, con el cuadro normalizado a 1 desde el centro hasta el
 * borde en cada eje. La esquina queda en raiz de dos.
 */
const R_MAXIMO = Math.SQRT2;

/** Con menos modulos que esto en un anillo no se le cree a su mediana. */
const MINIMO_POR_ANILLO = 6;

/**
 * Cuanto se acepta corregir como maximo.
 *
 * Cuatro grados es lo que mide esta camara. Si una foto pide mucho mas que
 * eso, lo que tiene no es vinieteo: puede ser media foto sobre otra cosa. Se
 * corrige hasta el tope y se avisa, en vez de aplicar una correccion enorme
 * deducida de una foto rara.
 */
export const TOPE_DE_CORRECCION_C = 8;

export interface Vinieta {
  /** Cuanto sumar de mas tiene cada anillo, del centro hacia afuera. */
  porAnillo: number[];
  /**
   * Lo que corrige donde mas corrige. Es lo que se le muestra a una persona.
   *
   * Corresponde al centro del anillo de afuera, no a la esquina misma: mas
   * afuera de ahi no hay modulos con que medirlo y no se extrapola.
   */
  maximoC: number;
}

/** Donde cae un punto en el cuadro, de 0 en el centro a raiz de dos en la esquina. */
export function radioNormalizado(cx: number, cy: number, ancho: number, alto: number): number {
  const rx = (cx - ancho / 2) / (ancho / 2);
  const ry = (cy - alto / 2) / (alto / 2);
  return Math.hypot(rx, ry);
}

/**
 * Mide el vinieteo de una foto con sus propios modulos.
 *
 * Devuelve null cuando no hay con que medirlo —pocos modulos, o repartidos en
 * un solo anillo— y entonces no se corrige nada. Es la respuesta correcta: una
 * correccion inventada sobre cuatro puntos es peor que ninguna.
 */
export function medirVinieta(puntos: Array<{ r: number; celsius: number }>): Vinieta | null {
  const anillos: number[][] = Array.from({ length: ANILLOS }, () => []);
  for (const p of puntos) {
    const i = Math.min(ANILLOS - 1, Math.floor((p.r / R_MAXIMO) * ANILLOS));
    if (i >= 0) anillos[i]!.push(p.celsius);
  }

  const medianas = anillos.map((v) => (v.length >= MINIMO_POR_ANILLO ? mediana(v) : null));
  const conDatos = medianas.filter((m): m is number => m != null);
  if (conDatos.length < 3) return null;

  // El cero es el anillo mas al centro que tenga datos: es el que menos
  // vinieteo tiene, asi que es contra el que se mide todo lo demas.
  const base = medianas.find((m): m is number => m != null)!;

  const porAnillo: number[] = [];
  let previo = 0;
  for (const m of medianas) {
    if (m == null) { porAnillo.push(previo); continue; }
    // Nunca negativa —solo se corrige el borde caliente— y nunca hacia abajo.
    const v = Math.min(TOPE_DE_CORRECCION_C, Math.max(previo, m - base, 0));
    porAnillo.push(v);
    previo = v;
  }

  const maximoC = porAnillo[porAnillo.length - 1] ?? 0;
  return maximoC > 0 ? { porAnillo, maximoC } : null;
}

/**
 * Lo que hay que restarle a una medicion tomada a ese radio.
 *
 * Se interpola entre el centro de un anillo y el del siguiente en vez de usar
 * el escalon. El anillo de afuera abarca un rango ancho de radios y ahi la
 * curva sube casi un grado y medio de punta a punta: con el escalon quedaba un
 * grado de sesgo sin corregir, que sobre un umbral de tres es mucho.
 *
 * Afuera del ultimo centro no se extrapola, se sostiene el valor. Extrapolar
 * seria inventar en la unica zona donde no hay con que medir.
 */
export function correccion(v: Vinieta, r: number): number {
  const anillo = R_MAXIMO / ANILLOS;
  // El valor de cada anillo corresponde a su centro, no a su borde.
  const x = r / anillo - 0.5;
  if (x <= 0) return v.porAnillo[0] ?? 0;
  if (x >= ANILLOS - 1) return v.porAnillo[ANILLOS - 1] ?? 0;
  const i = Math.floor(x);
  const t = x - i;
  const a = v.porAnillo[i] ?? 0, b = v.porAnillo[i + 1] ?? a;
  return a + (b - a) * t;
}

function mediana(v: number[]): number {
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}
