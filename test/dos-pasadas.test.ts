/**
 * El mismo string, fotografiado en dos momentos distintos.
 *
 * La pregunta que lo destapo, palabra por palabra: "¿que pasa si vuelo el dron
 * por al lado de un bloque, por donde termina un bloque, y ese bloque esta en
 * posicion plana, y despues vuelvo y vuelo el otro lado del bloque cuando los
 * paneles estan en otra posicion?".
 *
 * Pasa que ese string queda medido en dos momentos. Y entre las nueve y las
 * once el parque se calienta: sube la irradiancia, sube la ambiente, y el mismo
 * modulo SANO lee varios grados mas tarde que temprano. La app sacaba la
 * mediana de las dos mitades juntas, y de ahi salen los dos errores:
 *
 *   - todos los de la pasada tardia dan calientes (la cuadrilla camina hasta
 *     paneles sanos, y a la tercera deja de creerle al informe);
 *   - todos los de la temprana dan frios, asi que un modulo REALMENTE quemado
 *     de ese grupo se puede quedar debajo del umbral. Ese es el que duele.
 */

import { describe, expect, it } from "vitest";
import { comparar, stringsEnVariasTandas, UMBRALES, type Muestra } from "../app/detect";

const T0 = Date.parse("2026-09-02T09:00:00Z");
const MINUTO = 60_000;

/** Un modulo del string 0 de la fila `05-042-R1`. */
function muestra(pos: number, celsius: number, cuando: number): Muestra {
  return {
    modulo: {
      rowId: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
      chunkIndex: 0, stringNumber: 1, module: pos, positionInRow: pos,
      x: pos * 1.14, y: 0,
    },
    celsius,
    pixeles: 600,
    fileName: `T_${pos}.jpg`,
    cuando,
    distanciaAlCentroM: 1,
  };
}

/**
 * Un string de 28 modulos partido al medio entre dos pasadas.
 *
 * Los 28 estan SANOS: los primeros 14 se fotografiaron a las 9 y leen 45 °C,
 * los otros 14 dos horas despues y leen 53 °C porque el parque se calento. La
 * diferencia de 8 grados no es un defecto, es la mañana.
 */
const partido = [
  ...Array.from({ length: 14 }, (_, i) => muestra(i + 1, 45, T0)),
  ...Array.from({ length: 14 }, (_, i) => muestra(i + 15, 53, T0 + 120 * MINUTO)),
];

describe("un string medido en dos pasadas", () => {
  it("se detecta que quedo partido", () => {
    expect(stringsEnVariasTandas(partido)).toBe(1);
  });

  /*
    El nucleo. Con las dos mitades mezcladas, la mediana del string cae en el
    medio de los dos regimenes y los 28 modulos sanos salen a +4 y -4 grados.
    Comparando cada uno contra SU pasada, los 28 dan cero.
  */
  it("los 28 modulos sanos dan delta cero, no ±4 grados", () => {
    for (const h of comparar(partido, UMBRALES)) {
      expect(Math.abs(h.deltaT)).toBeLessThan(0.5);
      expect(h.severidad).toBe("normal");
    }
  });

  it("cada mitad se compara contra los vecinos de su propia pasada", () => {
    for (const h of comparar(partido, UMBRALES)) {
      // 14 muestras por tanda: 13 vecinos, no 27.
      expect(h.vecinos).toBe(13);
      expect(h.ambito).toBe("string");
    }
  });

  /*
    El falso negativo, que es el que importa. Un modulo de la pasada TEMPRANA
    a +6 grados sobre sus vecinos: mezclando las dos mitades queda en 45+6=51,
    por DEBAJO de la mediana global de 49... y sale como normal. Un panel
    quemado que no se reporta.
  */
  it("un defecto de la pasada temprana no queda tapado por la pasada tardia", () => {
    const conDefecto = partido.map((m) =>
      m.modulo.positionInRow === 3 ? { ...m, celsius: 51 } : m,
    );
    const h = comparar(conDefecto, UMBRALES).find((x) => x.modulo.positionInRow === 3)!;
    expect(h.deltaT).toBeCloseTo(6, 1);
    expect(h.severidad).not.toBe("normal");

    /*
      Y la otra mitad de la prueba: que el modelo VIEJO se lo comia.

      Sin hora, las 28 muestras caen en un solo vecindario — que es exactamente
      como se comparaba antes de esto. La mediana de la mezcla queda arriba de
      51, asi que el panel quemado da delta NEGATIVO y sale como normal. Sin
      esta linea el test de arriba no prueba nada: podria estar en verde
      tambien con el bug puesto.
    */
    const comoAntes = conDefecto.map(({ cuando: _c, ...resto }) => resto as Muestra);
    const viejo = comparar(comoAntes, UMBRALES).find((x) => x.modulo.positionInRow === 3)!;
    expect(viejo.deltaT).toBeLessThan(0);
    expect(viejo.severidad).toBe("normal");
  });

  it("y uno de la pasada tardia tampoco se infla", () => {
    const conDefecto = partido.map((m) =>
      m.modulo.positionInRow === 20 ? { ...m, celsius: 59 } : m,
    );
    const h = comparar(conDefecto, UMBRALES).find((x) => x.modulo.positionInRow === 20)!;
    // +6 sobre SUS vecinos, no +10 sobre la mezcla.
    expect(h.deltaT).toBeCloseTo(6, 1);
  });
});

describe("un vuelo normal de una sola pasada", () => {
  /*
    Lo que NO tiene que cambiar. Casi todos los vuelos son una pasada por
    bloque, con las fotos a segundos una de otra: ahi el vecindario tiene que
    seguir siendo el string entero, con sus 27 vecinos.
  */
  const seguido = Array.from({ length: 28 }, (_, i) =>
    muestra(i + 1, 45, T0 + i * 4000),   // una foto cada 4 segundos
  );

  it("no se parte nada", () => {
    expect(stringsEnVariasTandas(seguido)).toBe(0);
  });

  it("cada modulo se sigue comparando contra sus 27 hermanos", () => {
    for (const h of comparar(seguido, UMBRALES)) expect(h.vecinos).toBe(27);
  });

  it("una pasada larga de diez minutos sigue siendo una sola tanda", () => {
    const largo = Array.from({ length: 28 }, (_, i) => muestra(i + 1, 45, T0 + i * 20_000));
    expect(stringsEnVariasTandas(largo)).toBe(0);
  });
});

describe("fotos sin hora en el EXIF", () => {
  /*
    Sin fecha no se puede hacer nada mejor que antes, y romper el vecindario
    por las dudas seria peor: dejaria a cada modulo comparandose contra menos
    vecinos sin ninguna razon.
  */
  const sinHora = Array.from({ length: 28 }, (_, i) => {
    const { cuando: _c, ...resto } = muestra(i + 1, 45, T0);
    return resto as Muestra;
  });

  it("se comportan como antes: un solo vecindario por string", () => {
    expect(stringsEnVariasTandas(sinHora)).toBe(0);
    for (const h of comparar(sinHora, UMBRALES)) expect(h.vecinos).toBe(27);
  });
});
