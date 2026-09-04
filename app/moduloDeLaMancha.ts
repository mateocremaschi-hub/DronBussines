/**
 * A que modulo pertenece la mancha caliente, dentro del recuadro ya puesto.
 *
 * Este archivo nacio para arreglar un numero corrido: Mateo encontro un diodo
 * de bypass de verdad y el informe decia modulo 25 cuando era el 26. Eso ya no
 * se arregla aca — se arregla en `juntas.ts`, que cuenta las juntas entre
 * modulos de la propia foto y acomoda la rejilla ANTES de medir, asi que la
 * franja del diodo se mide adentro de la caja del 26 y sale con su numero.
 * Corregir el numero al final era tapar el agujero del lado equivocado: la
 * MEDICION seguia saliendo de la caja mal puesta.
 *
 * Lo que queda aca es la comprobacion, y sigue haciendo falta. Con la rejilla
 * ya alineada, una mancha pegada al borde del panel —una substring de la
 * punta— puede quedar a milimetros del vecino. Ahi el numero no se cambia,
 * porque la substring es real y esta en SU modulo; lo que se hace es decirlo,
 * para que el que entrega el informe mire la foto antes de anotar el numero.
 *
 * El calculo es el mismo de siempre: se pregunta en que modulo cae el centro
 * de masa de lo que se despega, contado en modulos desde el centro de la caja.
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
