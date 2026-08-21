/**
 * End-to-end con las reglas de Edenvale, sobre geometria sintetica.
 *
 * La geometria es sintetica a proposito: lo que se esta testeando es que las
 * reglas de conteo verificadas en el campo sobrevivan al viaje completo
 * coordenada -> direccion. Cuando carguemos las coordenadas reales de los
 * puntos verificados, entran como fixtures adicionales sin tocar nada de esto.
 */

import { describe, expect, it } from "vitest";
import profileJson from "../farms/edenvale.json" with { type: "json" };
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, pointAtSlot } from "./helpers/synthetic.js";

const profile = profileJson as unknown as FarmProfile;
const MODULES_PER_ROW = 56;

// Todas las filas apuntan de norte a sur: la pica `start` es la del norte.
const base = { azimuthDeg: 180 } as const;

const rowNorthMid = makeRow(
  {
    ...base,
    id: "05-042-R1",
    block: "05",
    tracker: "05-042",
    row: "R1",
    anchor: { lat: -27.4, lon: 152.7 },
    side: "north",
    pos: 1,
    posTotal: 3, // NO es el ultimo de su linea -> hay piercing en la punta
    stringNumbers: [1, 2],
  },
  profile,
);

const rowNorthLast = makeRow(
  {
    ...base,
    id: "04-049-R1",
    block: "04",
    tracker: "04-049",
    row: "R1",
    anchor: { lat: -27.4, lon: 152.701 },
    side: "north",
    pos: 3,
    posTotal: 3, // ultimo de su linea -> sin piercing propio
    stringNumbers: [1, 2],
  },
  profile,
);

const rowSouth = makeRow(
  {
    ...base,
    id: "05-043-R1",
    block: "05",
    tracker: "05-043",
    row: "R1",
    anchor: { lat: -27.4, lon: 152.702 },
    side: "south",
    pos: 1,
    posTotal: 3,
    stringNumbers: [1, 2],
  },
  profile,
);

const rowOddStrings = makeRow(
  {
    ...base,
    id: "07-028-R2",
    block: "07",
    tracker: "07-028",
    row: "R2",
    anchor: { lat: -27.4, lon: 152.703 },
    side: "north",
    pos: 1,
    posTotal: 3,
    stringNumbers: [6, 5], // desordenados a proposito
  },
  profile,
);

const farm = compileFarm(profile, [rowNorthMid, rowNorthLast, rowSouth, rowOddStrings]);

/** Consulta el motor parandose en el centro del hueco `slot` contando desde la pica norte. */
function atSlot(row: typeof rowNorthMid, slot: number, offAxisM = 0) {
  const fix = pointAtSlot(row, slot, profile, "start", offAxisM);
  return locate({ ...fix, accuracyM: 0.5 }, farm);
}

// ---------------------------------------------------------------------------

describe("compilacion", () => {
  it("no emite warnings con geometria coherente", () => {
    expect(farm.buildWarnings).toEqual([]);
  });

  it("resuelve el paso a 1150 mm a partir del modulo y el hueco", () => {
    expect(farm.rows[0]?.pitchM).toBeCloseTo(1.15, 9);
  });

  it("resuelve el extremo de conteo segun el lado de la calle", () => {
    // Lado norte -> cuenta desde su punta sur, que es la pica `end`.
    expect(farm.rows[0]?.originEnd).toBe("end");
    // Lado sur -> cuenta desde su punta norte, que es la pica `start`.
    expect(farm.rows[2]?.originEnd).toBe("start");
  });

  it("ordena los numeros de string: el menor es el mas cercano a la caja DC", () => {
    expect(farm.rows[3]?.stringNumbers).toEqual([5, 6]);
  });
});

// ---------------------------------------------------------------------------

describe("tracker del lado norte, NO ultimo de su linea (caso bloque 5)", () => {
  it("el modulo pegado a la caja DC es el 1 del string cercano", () => {
    const { best } = atSlot(rowNorthMid, 56); // el hueco mas al sur
    expect(best).toMatchObject({
      block: "05",
      tracker: "05-042",
      row: "R1",
      stringNumber: 1,
      module: 1,
      countedFrom: "near-dc",
      positionInRow: 1,
    });
  });

  it("el ultimo modulo del string cercano es el 28, contra el medio", () => {
    expect(atSlot(rowNorthMid, 29).best).toMatchObject({
      stringNumber: 1,
      module: 28,
      countedFrom: "near-dc",
    });
  });

  // Este es el dato exacto que se conto fisicamente en el campo y que obligo a
  // corregir el calculo: en el string lejano, el 28 queda contra el medio.
  it("el string lejano arranca invertido: el 28 queda contra el medio", () => {
    expect(atSlot(rowNorthMid, 28).best).toMatchObject({
      stringNumber: 2,
      module: 28,
      countedFrom: "far-end",
    });
  });

  it("y el modulo 1 del string lejano queda en la punta mas lejana", () => {
    expect(atSlot(rowNorthMid, 1).best).toMatchObject({
      stringNumber: 2,
      module: 1,
      countedFrom: "far-end",
    });
  });
});

describe("tracker del lado norte, ULTIMO de su linea (caso bloque 4)", () => {
  it("los dos strings cuentan en el mismo sentido", () => {
    expect(atSlot(rowNorthLast, 28).best).toMatchObject({
      stringNumber: 2,
      module: 1,
      countedFrom: "near-dc",
    });
    expect(atSlot(rowNorthLast, 1).best).toMatchObject({
      stringNumber: 2,
      module: 28,
      countedFrom: "near-dc",
    });
  });
});

describe("tracker del lado sur", () => {
  it("cuenta desde la punta norte: es el espejo del lado norte", () => {
    expect(atSlot(rowSouth, 1).best).toMatchObject({
      stringNumber: 1,
      module: 1,
      countedFrom: "near-dc",
      positionInRow: 1,
    });
    expect(atSlot(rowSouth, 56).best).toMatchObject({
      stringNumber: 2,
      module: 1,
      countedFrom: "far-end",
    });
  });
});

describe("strings con numeracion no correlativa (caso bloque 7)", () => {
  it("usa el menor de los dos numeros presentes como el cercano a la caja DC", () => {
    expect(atSlot(rowOddStrings, 56).best).toMatchObject({ stringNumber: 5, module: 1 });
    expect(atSlot(rowOddStrings, 28).best).toMatchObject({ stringNumber: 6, module: 28 });
  });
});

// ---------------------------------------------------------------------------

describe("barrido completo de la fila", () => {
  it("resuelve los 56 huecos a 56 direcciones distintas y correctas", () => {
    const seen = new Set<string>();
    for (let slot = 1; slot <= MODULES_PER_ROW; slot++) {
      const { best } = atSlot(rowNorthMid, slot);
      expect(best, `slot ${slot}`).not.toBeNull();

      const position = MODULES_PER_ROW - slot + 1; // el conteo arranca en la punta sur
      expect(best!.positionInRow, `slot ${slot}`).toBe(position);

      const expectedString = position <= 28 ? 1 : 2;
      const expectedModule = position <= 28 ? position : MODULES_PER_ROW - position + 1;
      expect(best!.stringNumber, `slot ${slot}`).toBe(expectedString);
      expect(best!.module, `slot ${slot}`).toBe(expectedModule);

      seen.add(`${best!.stringNumber}.${best!.module}`);
    }
    expect(seen.size).toBe(MODULES_PER_ROW);
  });

  it("aguanta un corrimiento lateral tipico de GPS sin RTK", () => {
    for (const off of [-2.5, -1, 1, 2.5]) {
      const { best } = atSlot(rowNorthMid, 20, off);
      expect(best?.rowId).toBe("05-042-R1");
      expect(best?.positionInRow).toBe(MODULES_PER_ROW - 20 + 1);
    }
  });
});

// ---------------------------------------------------------------------------

describe("candidatos, confianza y avisos", () => {
  it("devuelve vecinos ordenados por distancia real, nunca una sola respuesta", () => {
    const res = atSlot(rowNorthMid, 20);
    expect(res.candidates.length).toBeGreaterThanOrEqual(5);
    const distances = res.candidates.map((c) => c.distanceM);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(res.candidates[0]).toBe(res.best);
  });

  it("reparte la confianza y suma 1", () => {
    const res = atSlot(rowNorthMid, 20);
    const total = res.candidates.reduce((s, c) => s + c.confidence, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(res.best!.confidence).toBeGreaterThan(0.5);
  });

  it("con precision mala reparte la confianza entre vecinos y avisa", () => {
    const fix = pointAtSlot(rowNorthMid, 20, profile);
    const res = locate({ ...fix, accuracyM: 6 }, farm);
    expect(res.best!.confidence).toBeLessThan(0.35);
    expect(res.warnings.map((w) => w.code)).toContain("low-confidence");
  });

  it("avisa en vez de responder cuando no hay datos cerca", () => {
    const res = locate({ lat: -27.5, lon: 152.9 }, farm);
    expect(res.best).toBeNull();
    expect(res.candidates).toEqual([]);
    expect(res.warnings.map((w) => w.code)).toContain("no-row-within-range");
  });

  it("avisa cuando la coordenada cae pasando la punta del tracker", () => {
    const fix = pointAtSlot(rowNorthMid, 62, profile); // 6 huecos mas alla del final
    const res = locate({ ...fix, accuracyM: 0.5 }, farm);
    expect(res.warnings.map((w) => w.code)).toContain("outside-row-extent");
    expect(res.best?.positionInRow).toBe(1); // recortado al modulo del extremo
  });

  it("no marca como ambiguo el vecino de al lado dentro del mismo string", () => {
    // Sin RTK, dudar entre el modulo 10 y el 11 pasa siempre: eso ya lo dice la
    // lista de vecinos. Si el aviso saltara ahi, seria ruido en cada consulta.
    const res = atSlot(rowNorthMid, 10, 0);
    expect(res.warnings.map((w) => w.code)).not.toContain("ambiguous");
  });

  it("si marca como ambiguo el limite entre los dos strings de la fila", () => {
    // En la mitad del tracker, errar el string cambia el diagnostico electrico.
    const fix = pointAtSlot(rowNorthMid, 28, profile);
    const res = locate({ ...fix, accuracyM: 3 }, farm);
    expect(res.warnings.map((w) => w.code)).toContain("ambiguous");
    expect(res.warnings.find((w) => w.code === "ambiguous")!.message).toMatch(/string/);
  });

  it("expone el diagnostico completo del calculo", () => {
    const res = atSlot(rowNorthMid, 28);
    expect(res.diagnostics.winner).toMatchObject({
      rowId: "05-042-R1",
      originEnd: "end",
      originStrategy: "dc-box-end",
      inversionStrategy: "piercing-chain",
      inverted: true,
    });
    expect(res.diagnostics.winner!.pitchM).toBeCloseTo(1.15, 9);
    // Residuo por debajo de la milesima de milimetro por modulo: la geometria
    // sintetica cierra exacto contra el paso declarado.
    expect(Math.abs(res.diagnostics.winner!.lengthResidualMmPerModule)).toBeLessThan(1e-3);
  });

  it("elige la fila correcta cuando hay varias en rango", () => {
    const res = atSlot(rowSouth, 10);
    expect(res.best?.rowId).toBe("05-043-R1");
  });
});
