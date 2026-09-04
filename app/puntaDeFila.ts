/**
 * El calor que tiene la PUNTA de la fila y no el modulo.
 *
 * El motor compara cada modulo contra sus hermanos de string, que es la
 * comparacion correcta para un defecto electrico: comparten corriente,
 * orientacion, edad y suciedad. Pero no comparten AMBIENTE. Los ultimos
 * modulos de una fila dan a la calle de servicio —tierra pelada que al sol
 * lee veinte grados por encima del panel— y se calientan de a poco por su
 * cuenta.
 *
 * No es una teoria: se ve en el vuelo entero de Wellington. En el string 7 de
 * la fila 1-5 el delta contra los hermanos va +3,15 en el modulo 1, +1,74 en
 * el 2, +1,18 en el 3, +0,63 en el 4, +0,29 en el 5 y cero del 6 en adelante.
 * Un defecto no hace eso: un defecto calienta UN modulo y deja al vecino
 * normal. Y en esa misma foto, el modulo 1 de las otras tres filas del cuadro
 * marca +2,06, +2,25 y +2,50. No son cuatro modulos en circuito abierto al
 * mismo tiempo — es la punta.
 *
 * Sin corregirlo, el modulo 1 gana siempre. Con la lista corta llena de
 * modulos 1 y 28 nadie va a ir a mirar el unico que si estaba mal.
 *
 * Se corrige igual que el vinieteo de la camara: se mide sobre las propias
 * fotos y se resta. La referencia es el MISMO NUMERO DE MODULO en las otras
 * filas del cuadro, que es la unica manera de separar "esta punta esta
 * caliente" de "todas las puntas de aca estan calientes".
 */

/** Cuantas filas distintas hacen falta para creerle a una posicion. */
const FILAS_PARA_LA_BASE = 3;

/**
 * Cuanto calor de mas trae cada posicion de la fila, en esta foto.
 *
 * Devuelve el corrimiento por numero de modulo. Las posiciones que aparecen en
 * pocas filas no estan: ahi no hay con que separar el ambiente del defecto, y
 * restar la mediana de dos filas seria restarle a un modulo su propio defecto.
 */
export function calorDeLaPunta(
  medidas: Array<{ string: string; posicion: number; celsius: number }>,
): Map<number, number> {
  // El nivel de cada string en esta foto: contra eso se mide cada modulo.
  const porString = new Map<string, number[]>();
  for (const m of medidas) {
    const l = porString.get(m.string);
    if (l) l.push(m.celsius); else porString.set(m.string, [m.celsius]);
  }
  const nivel = new Map<string, number>();
  for (const [s, cs] of porString) {
    // Un string del que se ven cuatro modulos no tiene nivel: cualquiera de
    // ellos puede ser el defecto y arrastrar la mediana.
    if (cs.length < 8) continue;
    cs.sort((a, b) => a - b);
    nivel.set(s, cs[cs.length >> 1]!);
  }

  const porPosicion = new Map<number, number[]>();
  for (const m of medidas) {
    const n = nivel.get(m.string);
    if (n == null) continue;
    const l = porPosicion.get(m.posicion);
    if (l) l.push(m.celsius - n); else porPosicion.set(m.posicion, [m.celsius - n]);
  }

  const base = new Map<number, number>();
  for (const [pos, ds] of porPosicion) {
    if (ds.length < FILAS_PARA_LA_BASE) continue;
    ds.sort((a, b) => a - b);
    base.set(pos, ds[ds.length >> 1]!);
  }
  return base;
}
