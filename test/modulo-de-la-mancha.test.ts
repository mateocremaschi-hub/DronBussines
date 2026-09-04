/**
 * A que modulo pertenece la mancha, cuando la fila esta corrida.
 *
 * Mateo encontro un diodo de bypass de verdad y el informe decia modulo 25
 * cuando era el 26. El defecto estaba bien encontrado; el numero, corrido uno.
 * Y eso no es un detalle: el cliente cuenta 25 paneles desde la punta,
 * encuentra uno sano, y a partir de ahi el informe entero deja de valer.
 */

import { describe, expect, it } from "vitest";
import { centroDeLaMancha, moduloDeLaMancha } from "../app/moduloDeLaMancha";

const FILAS = 12, COLUMNAS = 6;

/** Un retrato parejo con una franja caliente en las columnas que se pidan. */
function retrato(base: number, calientes: number[], grados = 6): {
  celdas: Float32Array; filas: number; columnas: number;
} {
  const celdas = new Float32Array(FILAS * COLUMNAS).fill(base);
  for (let f = 0; f < FILAS; f++) {
    for (const c of calientes) celdas[f * COLUMNAS + c] = base + grados;
  }
  return { celdas, filas: FILAS, columnas: COLUMNAS };
}

/** La caja real de Wellington: 14,5 px de largo con un paso de 25. */
const caja = { largo: 14.5, pasoPx: 25, sentido: 1 };

describe("donde esta la mancha adentro del modulo", () => {
  it("una mancha en el centro no corre nada", () => {
    const c = centroDeLaMancha(retrato(40, [2, 3]), caja);
    expect(c).toBeCloseTo(0, 2);
  });

  it("una franja pegada a un borde cae a un tercio de modulo del centro", () => {
    // La caja mide 58 % del modulo, asi que su borde esta a 0,29 de modulo.
    const c = centroDeLaMancha(retrato(40, [5]), caja)!;
    expect(c).toBeGreaterThan(0.15);
    expect(c).toBeLessThan(0.3);
    expect(centroDeLaMancha(retrato(40, [0]), caja)!).toBeCloseTo(-c, 3);
  });

  it("sin mancha, o sin el paso, no contesta", () => {
    expect(centroDeLaMancha(retrato(40, []), caja)).toBeNull();
    expect(centroDeLaMancha(retrato(40, [5]), { largo: 14.5 })).toBeNull();
  });
});

describe("el modulo que hay que escribir en el informe", () => {
  it("el caso real: la franja en el borde y la fila corrida media, dan el vecino", () => {
    /*
      El diodo de 1-24-esclava. El parque dice 25, la fila esta corrida -0,46
      y la franja cae del lado de afuera de la caja: sumadas, la mancha esta en
      el 26.
    */
    expect(moduloDeLaMancha(25, retrato(38, [5]), caja, -0.46, 28)).toBe(26);
  });

  it("con la fila en su lugar, el numero no se toca", () => {
    expect(moduloDeLaMancha(25, retrato(38, [5]), caja, 0, 28)).toBe(25);
    expect(moduloDeLaMancha(25, retrato(38, [2, 3]), caja, -0.46, 28)).toBe(25);
  });

  it("respeta hacia que lado crece el numero de modulo", () => {
    /*
      El eje de la imagen apunta para un lado o para el otro segun como caiga
      la fila en el cuadro. Con el sentido al reves, la misma mancha y el mismo
      corrimiento tienen que dar el vecino del OTRO lado.
    */
    const alReves = { ...caja, sentido: -1 };
    expect(moduloDeLaMancha(25, retrato(38, [5]), alReves, 0.46, 28)).toBe(24);
  });

  it("no inventa un modulo 29 en un string de 28", () => {
    /*
      Pasa cuando la mancha esta en la punta y el corrimiento la empuja para
      afuera. Lo que hay al lado no es el modulo 29: es el hueco del motor o el
      primer modulo del string siguiente, y elegir entre esos dos con esta
      cuenta seria inventar.
    */
    expect(moduloDeLaMancha(28, retrato(38, [5]), caja, -0.57, 28)).toBeNull();
    expect(moduloDeLaMancha(1, retrato(38, [0]), caja, 0.57, 28)).toBeNull();
  });

  it("sin medicion de la fila no toca el numero", () => {
    expect(moduloDeLaMancha(25, retrato(38, [5]), caja, undefined, 28)).toBeNull();
    expect(moduloDeLaMancha(25, undefined, caja, -0.46, 28)).toBeNull();
  });
});
