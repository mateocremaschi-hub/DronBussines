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
    expect(edenvale.stringSpanM).toBeCloseTo(32.18, 6);
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
