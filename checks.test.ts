/**
 * Verificaciones de campo.
 *
 * Lo que se prueba aca no es aritmetica, es una politica: cuando esta app
 * tiene derecho a decir que un parque esta verificado. La regla que importa
 * esta al final — un desacuerdo sin explicar tira el parque a "parcial" por
 * mas puntos que coincidan.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { coverage, summarize, toCalibration, type FieldCheck } from "../app/checks";
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;

const fila = (id: string, side: TrackerRow["side"]) =>
  makeRow(
    { id, block: "1", tracker: id, anchor: { lat: -27.4, lon: 152.7 }, azimuthDeg: 180, side },
    profile,
  );

/** Un parque con filas de los dos lados de la calle. */
const rows = [fila("a", "north"), fila("b", "south")];

const check = (p: Partial<FieldCheck>): FieldCheck => ({
  id: Math.random().toString(36).slice(2),
  at: "2026-08-21T00:00:00.000Z",
  coord: { lat: -27.4, lon: 152.7 },
  said: "Bloque 1, tracker a, string 1, modulo 5",
  rowId: "a",
  block: "1",
  tracker: "a",
  outcome: "match",
  ...p,
});

describe("que reglas quedan probadas", () => {
  it("un parque sin verificaciones no tiene nada probado", () => {
    const s = summarize([], rows);
    expect(s.status).toBe("unverified");
    expect(s.coverage.every((c) => !c.covered)).toBe(true);
  });

  // El error que esto existe para evitar: verificar tres veces lo mismo y
  // creer que se probo el parque.
  it("tres puntos del mismo tipo no alcanzan", () => {
    const tres = [1, 2, 3].map(() => check({ countedFrom: "near-dc", side: "north" }));
    const s = summarize(tres, rows);
    expect(s.matches).toBe(3);
    expect(s.status).toBe("partial");
    expect(s.missing.map((m) => m.key)).toEqual(["far-end", "sides"]);
  });

  it("con las tres reglas cubiertas, el parque queda verificado", () => {
    const s = summarize(
      [
        check({ countedFrom: "near-dc", side: "north" }),
        check({ countedFrom: "far-end", side: "north" }),
        check({ countedFrom: "near-dc", side: "south", rowId: "b" }),
      ],
      rows,
    );
    expect(s.status).toBe("field-verified");
    expect(s.missing).toEqual([]);
  });

  // Si el parque tiene un solo lado, exigir los dos seria pedir algo imposible.
  it("no exige los dos lados en un parque que tiene uno solo", () => {
    const unLado = [fila("a", "north")];
    const cov = coverage([check({ countedFrom: "near-dc", side: "north" })], unLado);
    expect(cov.find((c) => c.key === "sides")!.covered).toBe(true);
  });
});

describe("desacuerdos", () => {
  // La regla central: un choque sin explicar pesa mas que cualquier cantidad
  // de coincidencias. Si no, alcanzaria con seguir midiendo hasta tener suerte.
  it("un desacuerdo tira el parque a parcial aunque este todo cubierto", () => {
    const s = summarize(
      [
        check({ countedFrom: "near-dc", side: "north" }),
        check({ countedFrom: "far-end", side: "north" }),
        check({ countedFrom: "near-dc", side: "south", rowId: "b" }),
        check({ outcome: "mismatch", countedModule: 16, countedFrom: "near-dc", side: "north" }),
      ],
      rows,
    );
    expect(s.matches).toBe(3);
    expect(s.mismatches).toBe(1);
    expect(s.status).toBe("partial");
  });

  it("un desacuerdo no cuenta como regla probada", () => {
    const s = summarize([check({ outcome: "mismatch", countedFrom: "far-end" })], rows);
    expect(s.status).toBe("unverified");
    expect(s.coverage.find((c) => c.key === "far-end")!.covered).toBe(false);
  });
});

describe("lo que viaja con el parque", () => {
  // La evidencia va adentro del perfil para que al exportarlo o pasarselo a
  // otra persona vaya junto que se probo y que no.
  it("escribe los casos probados y lo que falta", () => {
    const cal = toCalibration(
      [
        check({ countedFrom: "near-dc", side: "north", said: "Bloque 4, tracker 18, modulo 16" }),
        check({ outcome: "mismatch", countedModule: 22, said: "Bloque 7, tracker 3, modulo 19" }),
      ],
      rows,
    );
    expect(cal.status).toBe("partial");
    expect(cal.verifiedCases[0]).toContain("Bloque 4, tracker 18");
    expect(cal.verifiedCases[0]).toContain("2026-08-21");
    expect(cal.unverified[0]).toContain("SIN EXPLICAR");
    expect(cal.unverified[0]).toContain("22");
    // Y ademas lo que todavia no se probo.
    expect(cal.unverified.some((u) => u.includes("piercing"))).toBe(true);
  });
});
