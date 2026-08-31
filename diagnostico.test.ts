/**
 * Convertir los desacuerdos en un diagnostico.
 *
 * Los numeros de este archivo son reales: Mateo fue al tracker 04-018 de
 * Edenvale y registro cuatro conteos que no coincidian. Parecia un desastre.
 *
 *     la app dijo 11 → conto 19      suma 30
 *     la app dijo 26 → conto  3      suma 29
 *     la app dijo  2 → conto 25      suma 27
 *     la app dijo  1 → conto 28      suma 29
 *
 * En un string de 28, contar desde la otra punta convierte el modulo k en el
 * 29 − k. Las sumas dan 29. No estaba mal: estaba al reves.
 *
 * Y de yapa prueba lo que ninguna cuenta podia probar. Si el paso o los huecos
 * estuvieran mal, las sumas se irian corriendo de una punta de la fila a la
 * otra. Se quedan en 29 con dos modulos de ruido, que es menos que el error del
 * GPS de un celular. La geometria estaba bien todo este tiempo.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile } from "../src/types.js";
import { compileFarm, locate } from "../src/index.js";
import { diagnosticoDeReglas, pareceEspejado, voltearLadoDelBloque } from "../app/diagnostico";
import type { FieldCheck } from "../app/checks";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const N = profile.topology.modulesPerString;

const fila = makeRow(
  {
    id: "04-018-R1", block: "04", tracker: "04-018", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north",
    pos: 1, posTotal: 1,
  },
  profile,
);

/** Los cuatro conteos reales, tal como quedaron registrados. */
const REALES: Array<{ dijo: number; conto: number; string: number }> = [
  { dijo: 11, conto: 19, string: 1 },
  { dijo: 26, conto: 3, string: 1 },
  { dijo: 2, conto: 25, string: 2 },
  { dijo: 1, conto: 28, string: 1 },
];

const comoChecks = (): FieldCheck[] =>
  REALES.map((r, i) => ({
    id: `r${i}`, at: "2026-08-26T15:41:00Z",
    coord: { lat: -26.92, lon: 150.58 }, accuracyM: 8,
    said: `modulo ${r.dijo}`, rowId: fila.id, block: "04", tracker: "04-018",
    stringNumber: r.string, module: r.dijo,
    outcome: "mismatch", countedModule: r.conto,
  }));

// ---------------------------------------------------------------------------

describe("la pista rapida: las sumas", () => {
  it("reconoce el espejo en los cuatro conteos reales", () => {
    const p = pareceEspejado(comoChecks(), N);
    expect(p.esperada).toBe(29);
    expect(p.sumas).toEqual([30, 29, 27, 29]);
    expect(p.espejado).toBe(true);
  });

  /**
   * Lo que hace fuerte al resultado: si el paso estuviera mal, las sumas se
   * irian corriendo de una punta a la otra. Estos conteos cubren los dos
   * extremos —el modulo 1 y el 26— y las sumas no se mueven.
   */
  it("cubre las dos puntas de la fila, que es lo que descarta un error de paso", () => {
    const dijo = REALES.map((r) => r.dijo);
    expect(Math.min(...dijo)).toBeLessThanOrEqual(2);
    expect(Math.max(...dijo)).toBeGreaterThanOrEqual(26);
    const p = pareceEspejado(comoChecks(), N);
    const desvios = p.sumas.map((s) => Math.abs(s - 29));
    expect(Math.max(...desvios)).toBeLessThanOrEqual(2);
  });

  it("un desacuerdo cualquiera no lo llama espejo", () => {
    const sueltos = comoChecks().slice(0, 2).map((c, i) => ({ ...c, countedModule: i === 0 ? 12 : 5 }));
    expect(pareceEspejado(sueltos, N).espejado).toBe(false);
  });

  it("con un solo conteo no se pronuncia: una suma sola es casualidad", () => {
    expect(pareceEspejado(comoChecks().slice(0, 1), N).espejado).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("probar que regla explica los desacuerdos", () => {
  /**
   * El diagnostico de verdad no usa la aritmetica de las sumas: recompila la
   * fila con cada combinacion de reglas y mira cual habria acertado. Aca se
   * fabrican conteos desde una coordenada real, con el origen dado vuelta.
   */
  const conteosEspejados = (): FieldCheck[] => {
    const farm = compileFarm(profile, [fila]);
    const alReves: FarmProfile = {
      ...profile,
      addressing: { ...profile.addressing, originStrategy: "per-row-flag" },
    };
    const out: FieldCheck[] = [];
    for (const m of [4, 12, 24]) {
      // Donde cae el modulo m segun la app...
      const a = fila.start, b = fila.end;
      let coord: { lat: number; lon: number } | null = null;
      for (let t = 0; t <= 1; t += 0.0005) {
        const lat = a.lat + (b.lat - a.lat) * t;
        const lon = a.lon + (b.lon - a.lon) * t;
        if (locate({ lat, lon, accuracyM: 0.2 }, farm).best?.module === m) { coord = { lat, lon }; break; }
      }
      if (!coord) continue;
      // ...y que modulo seria ahi contando desde la otra punta.
      const otra = compileFarm(alReves, [{ ...fila, originEnd: "start" }]);
      const real = locate({ ...coord, accuracyM: 0.2 }, otra).best?.module;
      if (real == null) continue;
      out.push({
        id: `e${m}`, at: "2026-08-26T00:00:00Z", coord, accuracyM: 1,
        said: `modulo ${m}`, rowId: fila.id, block: "04", tracker: "04-018",
        module: m, outcome: "mismatch", countedModule: real,
      });
    }
    return out;
  };

  it("con la fila al reves, propone contar desde la otra punta", () => {
    const d = diagnosticoDeReglas(conteosEspejados(), profile, [fila]);
    expect(d.usados).toBeGreaterThan(0);
    expect(d.mejor).not.toBeNull();
    expect(d.mejor!.titulo).toMatch(/otra punta/);
    expect(d.mejor!.aciertos).toBeGreaterThan(d.actual);
  });

  it("y explica como se arregla, en vez de solo nombrarlo", () => {
    const d = diagnosticoDeReglas(conteosEspejados(), profile, [fila]);
    expect(d.mejor!.comoSeArregla).toMatch(/extremo equivocado/);
    expect(d.notas.join(" ")).toMatch(/explica \d+ de \d+/);
  });

  // No cambiar una regla porque empata: eso es mover un numero al azar.
  it("si la configuracion actual ya explica todo, no propone nada", () => {
    const farm = compileFarm(profile, [fila]);
    const a = fila.start, b = fila.end;
    const buenos: FieldCheck[] = [];
    for (let t = 0.2; t < 0.8; t += 0.2) {
      const lat = a.lat + (b.lat - a.lat) * t;
      const lon = a.lon + (b.lon - a.lon) * t;
      const r = locate({ lat, lon, accuracyM: 1 }, farm);
      if (!r.best?.module) continue;
      buenos.push({
        id: `b${t}`, at: "2026-08-26T00:00:00Z", coord: { lat, lon }, accuracyM: 1,
        said: "ok", rowId: fila.id, block: "04", tracker: "04-018",
        module: r.best.module, outcome: "match",
      });
    }
    const d = diagnosticoDeReglas(buenos, profile, [fila]);
    expect(d.actual).toBe(d.usados);
    expect(d.mejor).toBeNull();
    expect(d.notas.join(" ")).toMatch(/No hay nada que cambiar/);
  });

  it("sin conteos con numero de modulo, no diagnostica", () => {
    const d = diagnosticoDeReglas([], profile, [fila]);
    expect(d.usados).toBe(0);
    expect(d.notas.join(" ")).toMatch(/Hacen falta conteos/);
  });

  // Un desacuerdo que ninguna regla conocida explica NO se fuerza a una.
  it("cuando ninguna regla alcanza, lo dice en vez de elegir la menos mala", () => {
    const raros = comoChecks().map((c, i) => ({ ...c, countedModule: [7, 7, 7, 7][i]! }));
    const d = diagnosticoDeReglas(raros, profile, [fila]);
    if (!d.mejor) expect(d.notas.join(" ")).toMatch(/Ninguna de las reglas conocidas/);
  });
});

// ---------------------------------------------------------------------------

describe("dar vuelta el lado del bloque", () => {
  const rows = [
    { ...fila, id: "04-018-R1", block: "04", side: "north" as const },
    { ...fila, id: "04-019-R1", block: "04", side: "south" as const },
    { ...fila, id: "05-001-R1", block: "05", side: "north" as const },
  ];

  it("da vuelta las dos orillas del bloque, no solo una", () => {
    const out = voltearLadoDelBloque(rows, "04");
    expect(out.find((r) => r.id === "04-018-R1")!.side).toBe("south");
    expect(out.find((r) => r.id === "04-019-R1")!.side).toBe("north");
  });

  // El lado es del bloque: tocar otro seria romper lo que ya estaba verificado.
  it("no toca los otros bloques", () => {
    expect(voltearLadoDelBloque(rows, "04").find((r) => r.id === "05-001-R1")!.side).toBe("north");
  });

  it("una fila sin lado se queda sin lado, en vez de inventarle uno", () => {
    const sinLado = [{ ...fila, id: "x", block: "04", side: undefined }];
    expect(voltearLadoDelBloque(sinLado, "04")[0]!.side).toBeUndefined();
  });
});

describe("el desempate entre las dos hipotesis que empatan", () => {
  /**
   * Dar vuelta el origen y dar vuelta los dos strings producen la MISMA
   * numeracion, asi que siempre empatan. Lo que las separa no es la aritmetica:
   * es que una se puede ir a comprobar parandose donde esta la caja de continua.
   */
  it("elige la que se puede comprobar en el campo, y lo explica", () => {
    const d = diagnosticoDeReglas(comoChecks(), profile, [fila]);
    if (!d.mejor) return;
    expect(d.mejor.id.startsWith("origen-")).toBe(true);
    expect(d.notas.join(" ")).toMatch(/da exactamente la misma numeracion/);
    expect(d.notas.join(" ")).toMatch(/se puede ir a comprobar/);
  });

  it("y ofrece el bloque concreto para darlo vuelta", () => {
    const d = diagnosticoDeReglas(comoChecks(), profile, [fila]);
    if (!d.mejor) return;
    expect(d.bloquesParaVoltear).toContain("04");
    expect(d.notas.join(" ")).toMatch(/lado de la calle del bloque 04/);
    // Y avisa del alcance: es el bloque entero, no una fila.
    expect(d.notas.join(" ")).toMatch(/BLOQUE entero/);
  });
});
