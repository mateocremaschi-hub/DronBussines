/**
 * La capa de estrategias, testeada sin una sola coordenada.
 *
 * Que estos casos se puedan verificar sin GPS es exactamente el punto de
 * separarlos de la geometria: son reglas de conteo electrico, no de posicion.
 */

import { describe, expect, it } from "vitest";
import { chunkOf, resolveInversion, splitPosition } from "../src/strategies/inversion.js";
import { resolveOriginEnd } from "../src/strategies/origin.js";
import type { FarmProfile, TrackerRow } from "../src/types.js";

const EDENVALE_ADDRESSING: FarmProfile["addressing"] = {
  originStrategy: "dc-box-end",
  dcBoxPlacement: "center-road",
  inversionStrategy: "piercing-chain",
};

const bareRow = (over: Partial<TrackerRow> = {}): TrackerRow => ({
  id: "t",
  block: "01",
  tracker: "01-001",
  start: { lat: -27.4, lon: 152.7 },
  end: { lat: -27.401, lon: 152.7 },
  ...over,
});

// ---------------------------------------------------------------------------

describe("origen: dc-box-end", () => {
  // Las cajas DC estan en la calle del medio, asi que el extremo de conteo es
  // el opuesto al lado del tracker. Es inverso entre los dos lados de la calle.
  it("cuenta desde la punta sur en un tracker del lado norte", () => {
    const res = resolveOriginEnd(
      { row: bareRow({ side: "north" }), startIsNorth: true, startIsEast: false },
      EDENVALE_ADDRESSING,
    );
    expect(res.end).toBe("end"); // `start` es la punta norte, asi que el sur es `end`
    expect(res.warnings).toHaveLength(0);
  });

  it("cuenta desde la punta norte en un tracker del lado sur", () => {
    const res = resolveOriginEnd(
      { row: bareRow({ side: "south" }), startIsNorth: true, startIsEast: false },
      EDENVALE_ADDRESSING,
    );
    expect(res.end).toBe("start");
  });

  it("no depende de en que orden vinieron las picas en el Excel", () => {
    const northSide = { row: bareRow({ side: "north" }), startIsEast: false };
    const a = resolveOriginEnd({ ...northSide, startIsNorth: true }, EDENVALE_ADDRESSING);
    const b = resolveOriginEnd({ ...northSide, startIsNorth: false }, EDENVALE_ADDRESSING);
    expect(a.end).toBe("end");
    expect(b.end).toBe("start"); // el mismo extremo fisico, con las picas al reves
  });

  it("avisa en vez de adivinar si la fila no trae `side`", () => {
    const res = resolveOriginEnd(
      { row: bareRow(), startIsNorth: true, startIsEast: false },
      EDENVALE_ADDRESSING,
    );
    expect(res.warnings.map((w) => w.code)).toContain("missing-side");
  });
});

describe("origen: fixed-end y per-row-flag", () => {
  it("fixed-end north toma la punta norte", () => {
    const res = resolveOriginEnd(
      { row: bareRow(), startIsNorth: false, startIsEast: false },
      { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
    );
    expect(res.end).toBe("end");
  });

  it("per-row-flag respeta el bit de la fila", () => {
    const res = resolveOriginEnd(
      { row: bareRow({ originEnd: "end" }), startIsNorth: true, startIsEast: false },
      { originStrategy: "per-row-flag", inversionStrategy: "none" },
    );
    expect(res.end).toBe("end");
    expect(res.warnings).toHaveLength(0);
  });

  it("per-row-flag avisa si falta el bit", () => {
    const res = resolveOriginEnd(
      { row: bareRow(), startIsNorth: true, startIsEast: false },
      { originStrategy: "per-row-flag", inversionStrategy: "none" },
    );
    expect(res.warnings.map((w) => w.code)).toContain("missing-flag");
  });
});

// ---------------------------------------------------------------------------

describe("inversion: piercing-chain", () => {
  // Verificado en campo. El string pegado a la caja DC nunca se invierte.
  it("nunca invierte el string cercano a la caja DC", () => {
    for (const [pos, posTotal] of [
      [1, 3],
      [3, 3],
      [1, 1],
    ] as const) {
      const res = resolveInversion(bareRow({ pos, posTotal }), 0, EDENVALE_ADDRESSING);
      expect(res.inverted).toBe(false);
    }
  });

  // Caso bloque 4: tracker aislado. Los dos strings cuentan igual.
  it("no invierte el string lejano si el tracker es el ultimo de su linea", () => {
    expect(resolveInversion(bareRow({ pos: 3, posTotal: 3 }), 1, EDENVALE_ADDRESSING).inverted).toBe(
      false,
    );
  });

  it("no invierte el string lejano si el tracker esta solo", () => {
    expect(resolveInversion(bareRow({ pos: 1, posTotal: 1 }), 1, EDENVALE_ADDRESSING).inverted).toBe(
      false,
    );
  });

  // Caso bloque 5, tracker 05-042 R1: hay piercing connector en la punta.
  it("invierte el string lejano si el tracker NO es el ultimo de su linea", () => {
    expect(resolveInversion(bareRow({ pos: 1, posTotal: 3 }), 1, EDENVALE_ADDRESSING).inverted).toBe(
      true,
    );
    expect(resolveInversion(bareRow({ pos: 2, posTotal: 3 }), 1, EDENVALE_ADDRESSING).inverted).toBe(
      true,
    );
  });

  it("avisa en vez de adivinar si falta pos/posTotal", () => {
    const res = resolveInversion(bareRow(), 1, EDENVALE_ADDRESSING);
    expect(res.inverted).toBe(false);
    expect(res.warnings.map((w) => w.code)).toContain("missing-chain-position");
  });
});

describe("inversion: none y per-string-flag", () => {
  it("none no invierte nunca", () => {
    const addressing: FarmProfile["addressing"] = {
      originStrategy: "fixed-end",
      fixedEnd: "north",
      inversionStrategy: "none",
    };
    expect(resolveInversion(bareRow({ pos: 1, posTotal: 5 }), 1, addressing).inverted).toBe(false);
  });

  it("per-string-flag respeta el bit por chunk", () => {
    const addressing: FarmProfile["addressing"] = {
      originStrategy: "per-row-flag",
      inversionStrategy: "per-string-flag",
    };
    const row = bareRow({ stringInverted: [false, true, true] });
    expect(resolveInversion(row, 0, addressing).inverted).toBe(false);
    expect(resolveInversion(row, 1, addressing).inverted).toBe(true);
    expect(resolveInversion(row, 2, addressing).inverted).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("splitPosition", () => {
  const MPS = 28;

  it("mapea el string cercano de forma directa", () => {
    expect(splitPosition(1, MPS, false)).toEqual({ chunkIndex: 0, module: 1 });
    expect(splitPosition(28, MPS, false)).toEqual({ chunkIndex: 0, module: 28 });
  });

  it("mapea el string lejano sin invertir: modulo 1 pegado al medio", () => {
    expect(splitPosition(29, MPS, false)).toEqual({ chunkIndex: 1, module: 1 });
    expect(splitPosition(56, MPS, false)).toEqual({ chunkIndex: 1, module: 28 });
  });

  it("mapea el string lejano invertido: modulo 28 pegado al medio, modulo 1 en la punta", () => {
    // Este es el dato exacto que se conto fisicamente en el bloque 5.
    expect(splitPosition(29, MPS, true)).toEqual({ chunkIndex: 1, module: 28 });
    expect(splitPosition(56, MPS, true)).toEqual({ chunkIndex: 1, module: 1 });
  });

  it("chunkOf coincide con splitPosition", () => {
    for (let pos = 1; pos <= 56; pos++) {
      expect(chunkOf(pos, MPS)).toBe(splitPosition(pos, MPS, false).chunkIndex);
    }
  });

  it("cubre todos los modulos exactamente una vez, invertido o no", () => {
    for (const inverted of [false, true]) {
      const seen = new Set<string>();
      for (let pos = 1; pos <= 56; pos++) {
        const r = splitPosition(pos, MPS, inverted);
        expect(r.module).toBeGreaterThanOrEqual(1);
        expect(r.module).toBeLessThanOrEqual(MPS);
        seen.add(`${r.chunkIndex}.${r.module}`);
      }
      expect(seen.size).toBe(56);
    }
  });
});

/**
 * "Desde el norte" tiene que significar algo en esta fila.
 *
 * En un parque de trackers la fila corre siempre norte-sur: el eje gira de
 * este a oeste para seguir al sol. Por eso contar desde el norte es un dato
 * geometrico y no una deduccion — no hace falta leer ninguna calle ni ninguna
 * caja para saberlo.
 *
 * Pero la app no lo asume: lo mide. Si alguna vez entra un parque de
 * estructura fija, donde las filas corren este-oeste, las dos puntas quedan a
 * la misma latitud y "la punta norte" la decidiria el ruido del relevamiento.
 * Ahi hay que avisar, no contestar con seguridad.
 */
describe("contar desde el norte", () => {
  const fila = (start: { lat: number; lon: number }, end: { lat: number; lon: number }): TrackerRow => ({
    id: "r1", block: "01", tracker: "01-001", row: "R1", start, end,
  });
  const norte: FarmProfile["addressing"] = {
    originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none",
  };

  it("elige la punta de mayor latitud, venga como venga el par de picas", () => {
    const haciaElSur = resolveOriginEnd(
      { row: fila({ lat: -32.5, lon: 148.9 }, { lat: -32.5006, lon: 148.9 }),
        startIsNorth: true, startIsEast: false, alineacion: { norteSur: 1, esteOeste: 0 } },
      norte);
    expect(haciaElSur.end).toBe("start");
    expect(haciaElSur.warnings).toEqual([]);

    // Las mismas dos picas cargadas al reves dan la MISMA punta fisica.
    const haciaElNorte = resolveOriginEnd(
      { row: fila({ lat: -32.5006, lon: 148.9 }, { lat: -32.5, lon: 148.9 }),
        startIsNorth: false, startIsEast: false, alineacion: { norteSur: 1, esteOeste: 0 } },
      norte);
    expect(haciaElNorte.end).toBe("end");
  });

  it("avisa si la fila corre este-oeste, en vez de decidirlo con el ruido", () => {
    const r = resolveOriginEnd(
      { row: fila({ lat: -32.5, lon: 148.9 }, { lat: -32.5, lon: 148.9007 }),
        startIsNorth: true, startIsEast: false, alineacion: { norteSur: 0.02, esteOeste: 0.99 } },
      norte);
    expect(r.warnings.map((w) => w.code)).toContain("origin-ambiguous");
    expect(r.warnings[0]!.message).toMatch(/no corre norte-sur/);
  });

  it("una fila de trackers normal no dispara ningun aviso", () => {
    const r = resolveOriginEnd(
      { row: fila({ lat: -32.5, lon: 148.9 }, { lat: -32.5006, lon: 148.9 }),
        startIsNorth: true, startIsEast: false, alineacion: { norteSur: 0.999, esteOeste: 0.03 } },
      norte);
    expect(r.warnings).toEqual([]);
  });
});

/**
 * Origen fijo e inversion son excluyentes, y eso hay que poder verlo.
 *
 * `piercing-chain` decide si un string se numera al reves porque el cable lo
 * atraviesa viniendo de la caja. Esa pregunta tiene sentido mientras el modulo
 * 1 sea "el primero de la serie electrica". Declarando que el modulo 1 es el
 * del extremo norte, la numeracion la fija la geometria: invertir seria
 * contradecir la convencion que el informe declara, y dejaria media fila
 * numerada desde el norte y la otra media desde el sur, las dos diciendo que
 * cuentan desde el norte.
 */
describe("con origen en el norte no hay nada que invertir", () => {
  const fila: TrackerRow = {
    id: "r1", block: "01", tracker: "01-001", row: "R1",
    start: { lat: -32.5, lon: 148.9 }, end: { lat: -32.5006, lon: 148.9 },
    pos: 1, posTotal: 3,
  };

  it("sin inversion, los dos strings se cuentan para el mismo lado", () => {
    const sin: FarmProfile["addressing"] = {
      originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none",
    };
    expect(resolveInversion(fila, 0, sin).inverted).toBe(false);
    expect(resolveInversion(fila, 1, sin).inverted).toBe(false);
  });

  it("con piercing-chain uno de los dos sale al reves: por eso no se combinan", () => {
    const con: FarmProfile["addressing"] = {
      originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "piercing-chain",
    };
    const a = resolveInversion(fila, 0, con).inverted;
    const b = resolveInversion(fila, 1, con).inverted;
    expect(a).not.toBe(b);
  });
});
