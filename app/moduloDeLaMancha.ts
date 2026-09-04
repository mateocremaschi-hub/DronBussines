/**
 * A que modulo pertenece la mancha caliente, y no a cual la puso el parque.
 *
 * Mateo encontro un diodo de bypass de verdad y el informe decia modulo 25
 * cuando era el 26. El defecto estaba bien encontrado; el numero, corrido uno.
 * Y un numero corrido no es un detalle menor: el cliente abre el informe,
 * cuenta 25 paneles desde la punta, encuentra uno sano, y a partir de ahi el
 * informe entero deja de valer.
 *
 * Son dos corrimientos que se suman y ninguno de los dos es un error de
 * medicion:
 *
 *   - La FILA esta corrida a lo largo respecto de donde la pone el parque.
 *     Eso se mide con el hueco entre los dos strings —555 mm sin panel, entre
 *     el modulo 28 de uno y el 1 del otro— y sobre el vuelo de Wellington da
 *     medio modulo en muchas filas.
 *   - La MANCHA no esta en el centro del modulo. Un diodo de bypass puentea un
 *     tercio del panel, asi que su franja cae de un lado. Si ademas la fila
 *     esta corrida, esa franja termina adentro de la caja del vecino.
 *
 * Los dos juntos se resuelven de una: se pregunta en que modulo cae la mancha
 * con la fila ya puesta en su lugar. El modulo que sale es el que hay que
 * escribir en el informe.
 */

import type { Caja } from "./detect";

/** Cuanto tiene que despegarse una celda para contar como parte de la mancha. */
const CELDA_CALIENTE_C = 0.6;

/**
 * Donde esta el centro de la mancha, a lo largo de la fila, en modulos desde
 * el centro de la caja.
 *
 * El retrato viene en su propio marco: las COLUMNAS van a lo largo de la fila.
 * Se pesa cada celda por lo que se despega de la mediana del modulo, asi que
 * una franja de diodo pesa por toda su franja y una celda caliente por su
 * celda.
 */
export function centroDeLaMancha(
  retrato: { celdas: Float32Array; filas: number; columnas: number },
  caja: Pick<Caja, "largo" | "pasoPx">,
): number | null {
  const { celdas, filas, columnas } = retrato;
  if (!celdas.length || !caja.pasoPx || !(caja.pasoPx > 0)) return null;

  const vivas = Array.from(celdas).filter((v) => Number.isFinite(v) && v !== 0);
  if (vivas.length < filas * columnas * 0.5) return null;
  vivas.sort((a, b) => a - b);
  const mediana = vivas[vivas.length >> 1]!;

  let peso = 0, momento = 0;
  for (let f = 0; f < filas; f++) {
    for (let c = 0; c < columnas; c++) {
      const v = celdas[f * columnas + c]!;
      if (!Number.isFinite(v)) continue;
      const w = Math.max(0, v - mediana - CELDA_CALIENTE_C);
      peso += w;
      momento += w * (c + 0.5);
    }
  }
  if (peso <= 0) return null;

  // De columna a modulos: la caja mide `largo` px a lo largo y el modulo `pasoPx`.
  const enLaCaja = (momento / peso) / columnas - 0.5;   // -0.5 a +0.5 de la caja
  return (enLaCaja * caja.largo) / caja.pasoPx;
}

/**
 * El modulo al que pertenece la mancha, contando desde el que dice el parque.
 *
 * Devuelve `null` cuando no hay con que decidir —sin retrato, sin paso, o sin
 * mancha que pesar— y ahi se deja el numero del parque, que es lo que habia.
 */
export function moduloDeLaMancha(
  moduloDelParque: number,
  retrato: { celdas: Float32Array; filas: number; columnas: number } | undefined,
  caja: Pick<Caja, "largo" | "pasoPx" | "sentido"> | undefined,
  /** Cuanto esta corrida la fila, en modulos, medida con el hueco entre strings. */
  corrimientoDeLaFila: number | undefined,
  /** Cuantos modulos tiene un string en esta fila. */
  modulosPorString: number | undefined,
): number | null {
  if (!retrato || !caja || corrimientoDeLaFila == null) return null;
  const mancha = centroDeLaMancha(retrato, caja);
  if (mancha == null) return null;

  /*
    El sentido, que es la mitad del problema.

    `centroDeLaMancha` mide sobre el eje de la imagen, que apunta para un lado
    o para el otro segun como caiga la fila en el cuadro. El corrimiento de la
    fila ya viene en el sentido en que crece el numero de modulo. Si no se
    pasan los dos al mismo marco, la correccion corre el numero justo para el
    lado contrario — y eso es peor que no corregir nada.
  */
  const enModulos = mancha * (caja.sentido ?? 1);
  const real = moduloDelParque + Math.round(enModulos - corrimientoDeLaFila);

  /*
    Y si el numero se sale del string, no se contesta.

    Un string tiene 28 modulos: "el modulo 29" no existe y ponerlo en un
    informe es peor que no decir nada. Pasa cuando la mancha esta en la punta y
    el corrimiento la empuja para afuera — ahi lo que hay al lado no es el
    modulo 29, es el hueco del motor o el primer modulo del string siguiente, y
    decidir entre esos dos con esta cuenta seria inventar.
  */
  if (modulosPorString != null && (real < 1 || real > modulosPorString)) return null;
  return real;
}
