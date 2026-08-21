/**
 * Deduccion del lado de la calle a partir de la geometria.
 *
 * Existe porque el Excel de picas de Edenvale no trae la columna LADO, y sin
 * ella la estrategia de conteo desde la caja DC elige una punta al azar: le
 * pega en la mitad de los trackers y sale espejada en la otra mitad. Eso se
 * confirmo en el campo.
 *
 * La regla se puede verificar sola, que es lo que la hace usable: dentro de un
 * lado los centros de fila difieren unos metros, y entre lados difieren mas de
 * medio largo de fila. Si un bloque no se parte limpio, lo dice.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { deriveSides } from "../app/ingest";
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { makeRow, nominalLengthM } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const LEN = nominalLengthM(profile); // 65.145 m
const M_PER_DEG_LAT = 110946;
const ROAD = 8;

/** Un bloque con `n` filas a cada lado de una calle central. */
function twoSidedBlock(block: string, n: number): TrackerRow[] {
  const rows: TrackerRow[] = [];
  for (const side of ["north", "south"] as const) {
    for (let i = 0; i < n; i++) {
      // Las del norte arrancan arriba; las del sur, del otro lado de la calle.
      const topOffset = side === "north" ? 0 : -(LEN + ROAD);
      rows.push(
        makeRow(
          {
            id: `${block}-${side}-${i}`,
            block,
            tracker: `${block}-${side}-${i}`,
            anchor: { lat: -27.4 + topOffset / M_PER_DEG_LAT, lon: 152.7 + i * 0.00006 },
            azimuthDeg: 180,
          },
          profile,
        ),
      );
    }
  }
  return rows;
}

describe("deriveSides", () => {
  it("parte un bloque en sus dos lados de la calle", () => {
    const rows = twoSidedBlock("04", 6);
    const { sides, blocks } = deriveSides(rows);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe("dos-lados");
    expect(blocks[0]!.detail).toMatch(/6 filas al norte y 6 al sur/);

    for (const r of rows) {
      expect(sides.get(r.id), r.id).toBe(r.id.includes("north") ? "north" : "south");
    }
  });

  it("no depende del orden en que vinieron las picas en el Excel", () => {
    const rows = twoSidedBlock("04", 4).map((r, i) =>
      // A la mitad de las filas se le dan vuelta las picas, como pasa de verdad.
      i % 2 === 0 ? r : { ...r, start: r.end, end: r.start },
    );
    const { sides } = deriveSides(rows);
    for (const r of rows) {
      expect(sides.get(r.id), r.id).toBe(r.id.includes("north") ? "north" : "south");
    }
  });

  // Lo importante no es que acierte siempre: es que avise cuando no puede.
  it("no le inventa lado a un bloque de un solo lado", () => {
    const rows = twoSidedBlock("07", 5).filter((r) => r.id.includes("north"));
    const { sides, blocks } = deriveSides(rows);

    expect(blocks[0]!.status).toBe("un-solo-lado");
    expect(blocks[0]!.detail).toMatch(/No le asigno lado/);
    for (const r of rows) expect(sides.has(r.id)).toBe(false);
  });

  it("resuelve cada bloque por separado", () => {
    const rows = [...twoSidedBlock("04", 3), ...twoSidedBlock("05", 4)];
    const { blocks } = deriveSides(rows);
    expect(blocks.map((b) => b.block)).toEqual(["04", "05"]);
    expect(blocks.every((b) => b.status === "dos-lados")).toBe(true);
    expect(blocks[1]!.detail).toMatch(/4 filas al norte y 4 al sur/);
  });

  it("no dice nada de un bloque con una sola fila", () => {
    const { blocks } = deriveSides([twoSidedBlock("09", 1)[0]!]);
    expect(blocks[0]!.status).toBe("ambiguo");
  });

  // La prueba de que sirve para lo que se construyo: con el lado puesto, la
  // estrategia dc-box-end deja de elegir una punta al azar.
  it("con el lado deducido, las dos mitades cuentan desde puntas opuestas", async () => {
    const { compileFarm } = await import("../src/profile/compile.js");
    const rows = twoSidedBlock("04", 3);
    const { sides } = deriveSides(rows);
    const conLado = rows.map((r) => ({ ...r, side: sides.get(r.id) }));

    const farm = compileFarm(profile, conLado);
    const norte = farm.rows.filter((r) => r.source.side === "north");
    const sur = farm.rows.filter((r) => r.source.side === "south");

    // Las picas se generaron todas de norte a sur, asi que los dos lados tienen
    // que resolver extremos de conteo opuestos.
    expect(norte.every((r) => r.originEnd === "end")).toBe(true);
    expect(sur.every((r) => r.originEnd === "start")).toBe(true);

    // Ya no queda ningun aviso de lado faltante. El de la posicion en la linea
    // sigue: ese dato es electrico y no se puede sacar de la geometria.
    const codes = farm.rows.flatMap((r) => r.strategyWarnings.map((w) => w.code));
    expect(codes).not.toContain("missing-side");
    expect(codes).toContain("missing-chain-position");
  });
});
