/**
 * El reparto de modulos con la bahia del motor.
 *
 * Esto salio de una observacion de campo que cambio el modelo entero: entre los
 * dos strings de una fila no hay un huequito de 20 mm sino 3.7 m, porque ahi va
 * el motor que mueve el tracker. Ignorarlo desplaza todo el string lejano por
 * esa distancia — mas de tres modulos.
 */

import { describe, expect, it } from "vitest";
import {
  distanceAtPosition,
  makeRowLayout,
  moduleExtentM,
  positionAtDistance,
} from "../src/geo/rowLayout.js";

// Edenvale, con los numeros medidos en el campo.
const edenvale = makeRowLayout({
  modulesPerString: 28,
  stringsPerRow: 2,
  pitchM: 1.15,
  moduleGapM: 0.02,
  moduleWidthM: 1.13,
  stringGapM: 3.713,
  originOffsetM: -1.464, // los modulos sobresalen mas alla de la pica
});

describe("reparto con bahia de motor", () => {
  it("un string ocupa 28 modulos con 27 huequitos", () => {
    // Del borde de arranque del modulo 1 al borde de salida del 28.
    const span = edenvale.bordesM[27]! + edenvale.moduleWidthM - edenvale.bordesM[0]!;
    expect(span).toBeCloseTo(32.18, 6);
  });

  /**
   * El hueco grande reemplaza al huequito entre modulos, no se suma. Donde
   * entra el motor no hay dos paneles casi tocandose, y sumar los dos correria
   * cada string 2 cm por bahia.
   */
  it("la bahia reemplaza al huequito, no se le suma", () => {
    expect(edenvale.libreM[27]).toBeCloseTo(3.713, 9);
    expect(edenvale.libreM[26]).toBeCloseTo(0.02, 9);
  });

  it("el largo pica a pica coincide con el que miden las 3182 filas reales", () => {
    const picaAPica = edenvale.originOffsetM + moduleExtentM(edenvale) + edenvale.originOffsetM;
    expect(picaAPica).toBeCloseTo(65.145, 2);
  });

  it("va y vuelve para las 56 posiciones", () => {
    for (let pos = 1; pos <= 56; pos++) {
      const d = distanceAtPosition(edenvale, pos);
      expect(positionAtDistance(edenvale, d).positionInRow, `posicion ${pos}`).toBe(pos);
    }
  });

  it("el salto entre el modulo 28 y el 29 es la bahia, no el paso normal", () => {
    const d28 = distanceAtPosition(edenvale, 28);
    const d29 = distanceAtPosition(edenvale, 29);
    expect(d29 - d28).toBeCloseTo(1.15 + 3.713 - 0.02, 6);
    // Contra el salto entre dos modulos del mismo string:
    expect(distanceAtPosition(edenvale, 28) - distanceAtPosition(edenvale, 27)).toBeCloseTo(1.15, 9);
  });

  it("avisa cuando la distancia cae dentro de la bahia", () => {
    const finDelString1 = distanceAtPosition(edenvale, 28) + edenvale.moduleWidthM / 2;
    const enLaBahia = positionAtDistance(edenvale, finDelString1 + 1.8);
    expect(enLaBahia.inGap).toBe(true);

    // Sobre un modulo de verdad no avisa.
    expect(positionAtDistance(edenvale, distanceAtPosition(edenvale, 20)).inGap).toBe(false);
    expect(positionAtDistance(edenvale, distanceAtPosition(edenvale, 40)).inGap).toBe(false);
  });

  it("sin bahia, el modulo 29 quedaria 3.7 m mas aca — el error que se corrigio", () => {
    const sinBahia = makeRowLayout({
      modulesPerString: 28, stringsPerRow: 2, pitchM: 1.15, moduleGapM: 0.02,
      moduleWidthM: 1.13, stringGapM: 0, originOffsetM: -1.464,
    });
    const diferencia = distanceAtPosition(edenvale, 56) - distanceAtPosition(sinBahia, 56);
    expect(diferencia).toBeCloseTo(3.713, 6);
    expect(diferencia / 1.15).toBeGreaterThan(3); // mas de tres modulos
  });

  it("con un solo string por fila la bahia no juega", () => {
    const simple = makeRowLayout({
      modulesPerString: 30, stringsPerRow: 1, pitchM: 2.305, moduleGapM: 0.025,
      moduleWidthM: 2.28, stringGapM: 0, originOffsetM: 0,
    });
    expect(moduleExtentM(simple)).toBeCloseTo(30 * 2.305 - 0.025, 6);
    for (let pos = 1; pos <= 30; pos++) {
      expect(positionAtDistance(simple, distanceAtPosition(simple, pos)).positionInRow).toBe(pos);
    }
  });
});

// ---------------------------------------------------------------------------

describe("el aviso de 'caiste en la bahia'", () => {
  /**
   * El umbral era "medio modulo". Con el panel de Edenvale eso son 567 mm y la
   * bahia mide 555: por doce milimetros el aviso NUNCA se disparo en el parque
   * para el que se escribio. Parado sobre el motor, la app contestaba un modulo
   * con confianza normal y sin decir que ahi no hay ningun panel.
   */
  const edenvaleReal = makeRowLayout({
    modulesPerString: 28,
    stringsPerRow: 2,
    pitchM: 1.155,
    moduleGapM: 0.02,
    moduleWidthM: 1.135,
    stringGapM: 0.555,   // la bahia medida con cinta
    originOffsetM: -0.025,
  });

  /** Distancia al centro de la bahia, que arranca al terminar el modulo 28. */
  const finDel28 = edenvaleReal.bordesM[27]! + edenvaleReal.moduleWidthM;

  it("la bahia de 555 mm dispara el aviso, aunque mida menos que medio modulo", () => {
    expect(0.555).toBeLessThan(edenvaleReal.moduleWidthM / 2); // el umbral viejo
    expect(positionAtDistance(edenvaleReal, finDel28 + 0.1).inGap).toBe(true);
  });

  it("el huequito de 20 mm entre dos paneles NO es una bahia", () => {
    const finDel10 = edenvaleReal.bordesM[9]! + edenvaleReal.moduleWidthM;
    expect(positionAtDistance(edenvaleReal, finDel10 + 0.01).inGap).toBe(false);
  });

  it("sobre un modulo no avisa nada", () => {
    const centroDel10 = edenvaleReal.bordesM[9]! + edenvaleReal.moduleWidthM / 2;
    expect(positionAtDistance(edenvaleReal, centroDel10).inGap).toBe(false);
    expect(positionAtDistance(edenvaleReal, centroDel10).positionInRow).toBe(10);
  });

  /**
   * Adentro del hueco gana el mas cercano. En una bahia de 3,7 m devolver
   * siempre el de atras deja a la persona a tres metros y medio del panel que
   * tiene delante.
   */
  it("en la bahia devuelve el modulo mas cercano, no siempre el de atras", () => {
    const bahiaGrande = makeRowLayout({
      modulesPerString: 28, stringsPerRow: 2, pitchM: 1.155, moduleGapM: 0.02,
      moduleWidthM: 1.135, stringGapM: 3.713, originOffsetM: 0,
    });
    const fin28 = bahiaGrande.bordesM[27]! + bahiaGrande.moduleWidthM;
    // Apenas entrando en la bahia: el 28 sigue siendo el mas cercano.
    expect(positionAtDistance(bahiaGrande, fin28 + 0.3).positionInRow).toBe(28);
    // Casi saliendo: el 29 esta a centimetros y el 28 a tres metros y medio.
    expect(positionAtDistance(bahiaGrande, fin28 + 3.4).positionInRow).toBe(29);
    // Y en los dos casos avisa que ahi no hay panel.
    expect(positionAtDistance(bahiaGrande, fin28 + 3.4).inGap).toBe(true);
  });
});
