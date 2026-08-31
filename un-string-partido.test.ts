/**
 * Un tracker corto: 14 modulos de un lado, 14 del otro, y todo eso es UN string.
 *
 * Sale de un parque real distinto de Edenvale. Importa porque es la unica
 * pregunta del alta que la geometria no puede contestar sola:
 *
 *   Una fila de 28 modulos con una bahia en el medio se ve EXACTAMENTE igual si
 *   son dos strings de 14 o uno solo de 28 partido por el motor. Los modulos
 *   caen en los mismos milimetros, el dibujo sale igual y el cuadre cierra
 *   igual. Lo unico que cambia es la direccion que se entrega.
 *
 * Con dos strings, el modulo 17 se reporta "string 2, modulo 3". Con uno,
 * "modulo 17". El plano dice una de las dos cosas, y el tecnico camina segun lo
 * que diga la app.
 */

import { describe, expect, it } from "vitest";
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, pointAtSlot } from "./helpers/synthetic.js";

/** El modulo del manual del AXD: 2278 x 1134, 10 mm entre modulos. */
const MODULO = { widthMm: 1134, gapMm: 10, lengthMm: 2278, orientation: "portrait" as const, pitchMm: null };
const BAHIA_MM = 824;

/** Como HAY que cargarlo: un string de 28 con un hueco declarado en el medio. */
const unString: FarmProfile = {
  id: "corto-un-string", name: "Tracker corto", profileVersion: 1,
  module: MODULO,
  topology: {
    modulesPerString: 28,
    stringsPerRow: 1,
    stringGapMm: 0,
    gaps: [{ afterModule: 14, mm: BAHIA_MM }],
  },
  geometry: { source: "survey-stakes", endpointOffsetMm: 0, endpointOffsetMode: "none" },
  addressing: { originStrategy: "per-row-flag", inversionStrategy: "none" },
};

/** Como se carga si uno confunde "mitad del tracker" con "string". */
const dosStrings: FarmProfile = {
  ...unString,
  id: "corto-dos-strings",
  topology: { modulesPerString: 14, stringsPerRow: 2, stringGapMm: BAHIA_MM },
};

const spec = {
  id: "01-001-R1", block: "01", tracker: "01-001", row: "R1",
  anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180,
  originEnd: "start" as const,
};

const farmUno = compileFarm(unString, [makeRow(spec, unString)]);
const farmDos = compileFarm(dosStrings, [makeRow(spec, dosStrings)]);

/** El punto del hueco fisico `slot`, contando desde la pica de arranque. */
const enElHueco = (slot: number, profile: FarmProfile) =>
  pointAtSlot(makeRow(spec, profile), slot, profile, "start");

describe("un tracker corto que es un solo string", () => {
  it("se carga como 28 modulos con la bahia declarada como hueco", () => {
    expect(farmUno.modulesPerRow).toBe(28);
    expect(farmUno.buildWarnings).toEqual([]);
  });

  it("numera de corrido: el que sigue a la bahia es el 15, no el 1 de otro string", () => {
    const r = locate({ ...enElHueco(15, unString), accuracyM: 0.3 }, farmUno);
    expect(r.best).toMatchObject({ stringNumber: 1, module: 15, positionInRow: 15 });
  });

  it("y el ultimo es el 28", () => {
    const r = locate({ ...enElHueco(28, unString), accuracyM: 0.3 }, farmUno);
    expect(r.best?.module).toBe(28);
  });

  it("parado en la bahia del motor avisa que ahi no hay panel", () => {
    // El centro de la bahia: entre el borde de salida del 14 y la entrada del 15.
    const fila = makeRow(spec, unString);
    const a = enElHueco(14, unString);
    const b = enElHueco(15, unString);
    const medio = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    void fila;
    const r = locate({ ...medio, accuracyM: 0.3 }, farmUno);
    expect(r.warnings.map((w) => w.code)).toContain("in-string-gap");
  });
});

describe("las dos formas de cargarlo son identicas en el terreno", () => {
  /**
   * Esto es lo que hace peligrosa a la confusion: NO hay ninguna senal
   * geometrica. Si las dos dieran filas de largo distinto, el cuadre lo cazaria.
   */
  it("la fila mide exactamente lo mismo de las dos formas", () => {
    const largo = (f: typeof farmUno) => f.rows[0]!.lengthM;
    expect(largo(farmUno)).toBeCloseTo(largo(farmDos), 6);
  });

  it("el modulo 15 cae en el mismo lugar del mundo", () => {
    const uno = locate({ ...enElHueco(15, unString), accuracyM: 0.3 }, farmUno).best!;
    const dos = locate({ ...enElHueco(15, dosStrings), accuracyM: 0.3 }, farmDos).best!;
    expect(uno.center.lat).toBeCloseTo(dos.center.lat, 7);
    expect(uno.center.lon).toBeCloseTo(dos.center.lon, 7);
  });

  /**
   * Y sin embargo la direccion que se entrega es distinta. Esta es la linea que
   * explica por que la pantalla tiene que preguntarlo bien.
   */
  it("pero la direccion que se entrega NO es la misma", () => {
    const uno = locate({ ...enElHueco(15, unString), accuracyM: 0.3 }, farmUno).best!;
    const dos = locate({ ...enElHueco(15, dosStrings), accuracyM: 0.3 }, farmDos).best!;
    expect(uno.module).toBe(15);
    expect(dos.module).toBe(1);
    expect(dos.stringNumber).toBe(2);
  });
});

describe("cuando la lista de strings contradice al perfil", () => {
  /**
   * La geometria no puede contestar la pregunta, pero la lista de strings del
   * proyecto SI: si trae un solo string por fila y el perfil declara dos, el
   * perfil esta mal. Antes esto se resolvia inventando un string correlativo y
   * diciendo "completo con correlativos", que no le dice a nadie que hacer.
   */
  const conUnSoloString = makeRow({ ...spec, stringNumbers: [7] }, dosStrings);
  const farm = compileFarm(dosStrings, [conUnSoloString]);

  it("avisa, y dice cual de los dos esta probablemente mal", () => {
    const aviso = farm.buildWarnings.find((w) => /numero\(s\) de string/.test(w.message));
    expect(aviso).toBeDefined();
    expect(aviso!.message).toMatch(/el perfil esta mal/);
  });

  it("y nombra los valores concretos que hay que poner", () => {
    const aviso = farm.buildWarnings.find((w) => /numero\(s\) de string/.test(w.message))!;
    expect(aviso.message).toMatch(/strings por fila = 1/);
    expect(aviso.message).toMatch(/modulos por string = 28/);
    expect(aviso.message).toMatch(/hueco despues del modulo 14/);
  });
});
