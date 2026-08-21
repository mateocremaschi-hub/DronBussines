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
