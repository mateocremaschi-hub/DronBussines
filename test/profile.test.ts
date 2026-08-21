/**
 * El perfil tiene que romper ruidosamente al cargarlo.
 *
 * Un perfil mal armado que no falla produce direcciones equivocadas en
 * silencio, y eso se descubre en el campo seis meses despues. Es exactamente
 * la clase de error que este diseno existe para evitar.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import northfieldJson from "../farms/northfield-synthetic.json" with { type: "json" };
import { ProfileError, validateProfile } from "../src/profile/validate.js";
import { compileFarm } from "../src/profile/compile.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, nominalLengthM } from "./helpers/synthetic.js";

const edenvale = edenvaleJson as unknown as FarmProfile;

const clone = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...JSON.parse(JSON.stringify(edenvale)),
  ...over,
});

describe("validacion", () => {
  it("acepta los dos perfiles del repo", () => {
    expect(() => validateProfile(edenvaleJson)).not.toThrow();
    expect(() => validateProfile(northfieldJson)).not.toThrow();
  });

  it("junta todos los problemas en un solo error", () => {
    try {
      validateProfile({ id: "x" });
      expect.unreachable("tendria que haber tirado");
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileError);
      expect((err as ProfileError).issues.length).toBeGreaterThan(3);
    }
  });

  it("exige fixedEnd cuando la estrategia es fixed-end", () => {
    const bad = clone({
      addressing: { originStrategy: "fixed-end", inversionStrategy: "none" },
    });
    expect(() => validateProfile(bad)).toThrow(/fixedEnd/);
  });

  it("rechaza estrategias que no existen", () => {
    const bad = clone({
      addressing: { originStrategy: "vibes", inversionStrategy: "none" },
    });
    expect(() => validateProfile(bad)).toThrow(/originStrategy/);
  });

  // La regla del piercing connector se verifico con dos strings por fila.
  // Extrapolarla a tres seria repetir el error que ya costo dos viajes al campo:
  // asumir un patron razonable y descubrir en el campo que no era.
  it("no deja usar piercing-chain con mas de dos strings por fila", () => {
    const bad = clone({
      topology: { modulesPerString: 28, stringsPerRow: 3 },
    });
    expect(() => validateProfile(bad)).toThrow(/per-string-flag/);
  });

  it("pero si deja tres strings por fila con la salida de emergencia", () => {
    const ok = clone({
      topology: { modulesPerString: 28, stringsPerRow: 3 },
      addressing: { originStrategy: "per-row-flag", inversionStrategy: "per-string-flag" },
    });
    expect(() => validateProfile(ok)).not.toThrow();
  });
});

describe("chequeo de coherencia geometrica al compilar", () => {
  const rowSpec = {
    id: "x",
    block: "01",
    tracker: "01-001",
    anchor: { lat: -27.4, lon: 152.7 },
    azimuthDeg: 180,
    side: "north" as const,
    pos: 1,
    posTotal: 2,
  };

  it("no dice nada cuando el largo cierra con el paso declarado", () => {
    const farm = compileFarm(edenvale, [makeRow(rowSpec, edenvale)]);
    expect(farm.buildWarnings).toEqual([]);
  });

  // Este es el chequeo que hubiera hecho saltar los bloques de trazado disperso
  // sin necesidad de mirar el mapa a ojo.
  it("avisa cuando el segmento importado no da el largo que el perfil predice", () => {
    const short = makeRow({ ...rowSpec, lengthM: nominalLengthM(edenvale) - 4 }, edenvale);
    const farm = compileFarm(edenvale, [short]);
    const w = farm.buildWarnings.find((x) => x.code === "length-mismatch");
    expect(w).toBeDefined();
    expect(w!.message).toMatch(/por modulo/);
  });

  it("con pitchMm derive el paso sale del largo real y nunca hay residuo", () => {
    const derived = { ...edenvale, module: { ...edenvale.module, pitchMm: "derive" as const } };
    const odd = makeRow({ ...rowSpec, lengthM: nominalLengthM(edenvale) - 4 }, edenvale);
    const farm = compileFarm(derived, [odd]);
    expect(farm.buildWarnings).toEqual([]);
    expect(farm.rows[0]!.lengthResidualMmPerModule).toBeCloseTo(0, 9);
    expect(farm.rows[0]!.pitchM).toBeLessThan(1.15);
  });

  it("rompe si las dos picas de una fila son el mismo punto", () => {
    const degenerate = makeRow(rowSpec, edenvale);
    degenerate.end = { ...degenerate.start };
    expect(() => compileFarm(edenvale, [degenerate])).toThrow(/mismo punto/);
  });

  it("rompe si el parque no tiene geometria", () => {
    expect(() => compileFarm(edenvale, [])).toThrow(/ninguna fila/);
  });

  it("avisa si a una fila le falta el `side` que la estrategia necesita", () => {
    const noSide = makeRow(rowSpec, edenvale);
    delete noSide.side;
    const farm = compileFarm(edenvale, [noSide]);
    expect(farm.rows[0]!.strategyWarnings.map((w) => w.code)).toContain("missing-side");
  });

  it("avisa si hay ids repetidos", () => {
    const a = makeRow(rowSpec, edenvale);
    const b = makeRow({ ...rowSpec, anchor: { lat: -27.41, lon: 152.7 } }, edenvale);
    const farm = compileFarm(edenvale, [a, b]);
    expect(farm.buildWarnings.some((w) => w.message.includes("mas de una fila"))).toBe(true);
  });
});
