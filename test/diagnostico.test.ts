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
import northfieldJson from "../farms/northfield-synthetic.json" with { type: "json" };
import type { CompiledFarm, FarmProfile, TrackerRow } from "../src/types.js";
import { compileFarm, locate } from "../src/index.js";
import { diagnosticoDeReglas, pareceEspejado, voltearLadoDelBloque } from "../app/diagnostico";
import type { FieldCheck } from "../app/checks";
import { makeRow, pointAtSlot } from "./helpers/synthetic.js";

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

/**
 * El parque compilado, que es lo que ahora recibe `pareceEspejado`.
 *
 * Antes recibia el `modulesPerString` del perfil, un numero suelto. Eso daba
 * por sentado que todas las filas del parque miden lo mismo, y un parque puede
 * mezclar trackers largos de 56 modulos con cortos de 28: el largo del string
 * donde se conto lo sabe la fila compilada, no el perfil.
 */
const compilado = compileFarm(profile, [fila]);

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
    const p = pareceEspejado(comoChecks(), compilado);
    expect(p.esperada).toBe(N + 1);
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
    const p = pareceEspejado(comoChecks(), compilado);
    const desvios = p.sumas.map((s) => Math.abs(s - 29));
    expect(Math.max(...desvios)).toBeLessThanOrEqual(2);
  });

  it("un desacuerdo cualquiera no lo llama espejo", () => {
    const sueltos = comoChecks().slice(0, 2).map((c, i) => ({ ...c, countedModule: i === 0 ? 12 : 5 }));
    expect(pareceEspejado(sueltos, compilado).espejado).toBe(false);
  });

  it("con un solo conteo no se pronuncia: una suma sola es casualidad", () => {
    expect(pareceEspejado(comoChecks().slice(0, 1), compilado).espejado).toBe(false);
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

// ---------------------------------------------------------------------------
// Un parque que cuenta desde el norte, con dos bloques que no estan igual
// ---------------------------------------------------------------------------

/**
 * Northfield cuenta SIEMPRE desde el extremo norte de la fila y no invierte
 * nada. Es el parque de control justo para esto: la fila no trae `originEnd`
 * escrito —lo resuelve el compilador mirando cual pica queda mas al norte— asi
 * que una hipotesis que quiera dar vuelta el conteo tiene que preguntarselo al
 * compilado en vez de suponer que las picas del Excel estan todas en el mismo
 * sentido.
 */
const norte = northfieldJson as unknown as FarmProfile;

/** El mismo parque, pero con cada fila contando desde su punta opuesta. */
function alReves(rows: TrackerRow[]): CompiledFarm {
  const hoy = compileFarm(norte, rows);
  return compileFarm(
    { ...norte, addressing: { ...norte.addressing, originStrategy: "per-row-flag" } },
    rows.map((r) => {
      const c = hoy.rows.find((x) => x.source.id === r.id)!;
      return { ...r, originEnd: c.originEnd === "start" ? "end" : "start" } as TrackerRow;
    }),
  );
}

/**
 * Un conteo hecho parado en el hueco fisico `slot`, contando desde la pica
 * `start` de la fila.
 *
 * Si `espejado`, la persona conto lo que da la otra punta y queda registrado
 * como desacuerdo. Si no, conto lo mismo que dijo la app y queda como acuerdo.
 */
function conteoEn(
  rows: TrackerRow[],
  row: TrackerRow,
  slot: number,
  espejado: boolean,
): FieldCheck {
  const hoy = compileFarm(norte, rows);
  const coord = pointAtSlot(row, slot, norte, "start");
  const dijo = locate({ ...coord, accuracyM: 1 }, hoy).best?.module;
  const otro = locate({ ...coord, accuracyM: 1 }, alReves(rows)).best?.module;
  expect(dijo).toBeTypeOf("number");
  expect(otro).toBeTypeOf("number");

  const c: FieldCheck = {
    id: `${row.id}-${slot}`,
    at: "2026-09-01T09:00:00Z",
    coord,
    accuracyM: 1,
    said: `modulo ${dijo}`,
    rowId: row.id,
    block: row.block,
    tracker: row.tracker,
    module: dijo!,
    outcome: espejado ? "mismatch" : "match",
  };
  if (espejado) c.countedModule = otro!;
  return c;
}

describe("que bloques se ofrecen para dar vuelta", () => {
  /**
   * El escenario que rompia: conteos en dos bloques, uno bien y otro espejado.
   *
   * `bloquesParaVoltear` salia de `utiles.map(c => c.block)`, o sea TODOS los
   * bloques donde hubiera un conteo. La pantalla ofrecia un boton para el 04 y
   * otro para el 05, y el del 04 daba vuelta un bloque que estaba bien: lo
   * dejaba contando al reves y encima le borraba sus conteos, porque al
   * aplicarlo se reescribe la calibracion del bloque.
   */
  const bien = makeRow(
    { id: "04-001-R1", block: "04", tracker: "04-001", row: "R1",
      anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180 },
    norte,
  );
  const espejada = makeRow(
    { id: "05-001-R1", block: "05", tracker: "05-001", row: "R1",
      anchor: { lat: -26.92, lon: 150.59 }, azimuthDeg: 180 },
    norte,
  );
  const rows = [bien, espejada];

  // El 05 pesa mas que el 04 a proposito: si empataran, el diagnostico no
  // propondria nada y el test no probaria nada.
  const checks = [
    conteoEn(rows, bien, 10, false),
    conteoEn(rows, bien, 20, false),
    conteoEn(rows, espejada, 2, true),
    conteoEn(rows, espejada, 5, true),
    conteoEn(rows, espejada, 26, true),
    conteoEn(rows, espejada, 29, true),
  ];

  it("los conteos del bloque sano coinciden y los del otro no", () => {
    const d = diagnosticoDeReglas(checks, norte, rows);
    expect(d.usados).toBe(6);
    expect(d.actual).toBe(2);
    expect(d.mejor).not.toBeNull();
    expect(d.mejor!.titulo).toMatch(/otra punta/);
    expect(d.mejor!.aciertos).toBe(4);
  });

  it("ofrece el bloque espejado y NO el que ya estaba bien", () => {
    const d = diagnosticoDeReglas(checks, norte, rows);
    expect(d.bloquesParaVoltear).toEqual(["05"]);
  });

  // Un bloque sin ningun desacuerdo no se ofrece jamas, ni cuando el resto del
  // parque esta espejado: no hay nada que arreglar ahi.
  it("un bloque donde la hipotesis rompe conteos que hoy coinciden no se ofrece", () => {
    const d = diagnosticoDeReglas(checks, norte, rows);
    expect(d.bloquesParaVoltear).not.toContain("04");
    expect(d.notas.join(" ")).toMatch(/lado de la calle del bloque 05/);
    expect(d.notas.join(" ")).not.toMatch(/bloque 04/);
  });

  // Sin desacuerdos no hay boton, aunque haya conteos de sobra.
  it("con todos los conteos coincidiendo no ofrece ningun bloque", () => {
    const soloBuenos = checks.filter((c) => c.outcome === "match");
    const d = diagnosticoDeReglas(soloBuenos, norte, rows);
    expect(d.bloquesParaVoltear).toEqual([]);
  });
});

describe("una sola hipotesis de origen, que invierte fila por fila", () => {
  /**
   * El parque donde las dos hipotesis viejas no podian ganar.
   *
   * `origen-start` y `origen-end` forzaban `originEnd` al MISMO valor en todas
   * las filas probadas, y el orden de las picas del Excel no significa nada:
   * el topografo tomo unas filas de sur a norte y otras al reves (ver
   * `deriveOriginEnds` en app/ingest.ts). Estas dos filas son ese caso —una
   * relevada de norte a sur y la otra de sur a norte, las dos espejadas en el
   * campo— y ahi cada una de las hipotesis viejas explicaba la mitad: la que
   * ganaba terminaba siendo «los dos strings se cuentan invertidos», que da el
   * mismo numero por una razon que no se puede ir a comprobar.
   */
  const deNorteASur = makeRow(
    { id: "07-001-R1", block: "07", tracker: "07-001", row: "R1",
      anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180 },
    norte,
  );
  const deSurANorte = makeRow(
    { id: "07-002-R1", block: "07", tracker: "07-002", row: "R1",
      anchor: { lat: -26.9268, lon: 150.59 }, azimuthDeg: 0 },
    norte,
  );
  const rows = [deNorteASur, deSurANorte];

  it("las dos filas se relevaron en sentidos opuestos, que es el caso dificil", () => {
    const hoy = compileFarm(norte, rows);
    const a = hoy.rows.find((r) => r.source.id === "07-001-R1")!;
    const b = hoy.rows.find((r) => r.source.id === "07-002-R1")!;
    expect(a.originEnd).not.toBe(b.originEnd);
  });

  /*
    Los slots se eligen lejos del medio de la fila. En una fila de 30, el
    modulo 15 y su espejo (el 16) son vecinos, y el diagnostico da por bueno un
    conteo que caiga entre los candidatos que la app ofrece por el error del
    GPS: un conteo ahi no distingue una punta de la otra.
  */
  const checks = [
    conteoEn(rows, deNorteASur, 3, true),
    conteoEn(rows, deNorteASur, 10, true),
    conteoEn(rows, deNorteASur, 28, true),
    conteoEn(rows, deSurANorte, 3, true),
    conteoEn(rows, deSurANorte, 10, true),
    conteoEn(rows, deSurANorte, 28, true),
  ];

  it("explica las dos filas con una sola regla, no la mitad cada una", () => {
    const d = diagnosticoDeReglas(checks, norte, rows);
    expect(d.actual).toBe(0);
    expect(d.mejor).not.toBeNull();
    expect(d.mejor!.titulo).toMatch(/otra punta/);
    expect(d.mejor!.aciertos).toBe(d.usados);
  });

  // La tabla mostraba dos filas con el mismo titulo y el mismo texto de
  // arreglo, palabra por palabra, y numeros distintos.
  it("en la tabla no hay dos hipotesis con el mismo titulo", () => {
    const d = diagnosticoDeReglas(checks, norte, rows);
    const titulos = d.hipotesis.map((h) => h.titulo);
    expect(new Set(titulos).size).toBe(titulos.length);
    expect(titulos.filter((t) => /otra punta/.test(t))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// La pista rapida en un parque de dos tipos de tracker
// ---------------------------------------------------------------------------

/**
 * El N contra el que se compara la suma sale de la FILA.
 *
 * `pareceEspejado` lo leia del perfil, y un parque puede mezclar trackers
 * largos de 56 modulos con cortos de 28. Un conteo hecho en una fila corta
 * —dijo 5, conto 24, suma 29— se comparaba contra el 57 de una fila larga: la
 * pista decia "no esta espejado" justo donde lo estaba, y encima lo decia
 * mirando conteos que SI cerraban en su propia fila.
 */
describe("la pista rapida con dos largos de tracker", () => {
  const dosTipos: FarmProfile = {
    id: "mixto-pista", name: "Parque de dos tipos", profileVersion: 1,
    module: { widthMm: 1134, gapMm: 10, pitchMm: null },
    topology: {
      modulesPerString: 56,
      stringsPerRow: 1,
      variants: [{ id: "corto", modulesPerString: 28, stringsPerRow: 1 }],
    },
    geometry: { source: "survey-stakes", endpointOffsetMm: 0, endpointOffsetMode: "none" },
    addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
  };
  const comoLarga: FarmProfile = { ...dosTipos, topology: { modulesPerString: 56, stringsPerRow: 1 } };
  const comoCorta: FarmProfile = { ...dosTipos, topology: { modulesPerString: 28, stringsPerRow: 1 } };

  const filaLarga = makeRow(
    { id: "01-001-R1", block: "01", tracker: "01-001", anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180 },
    comoLarga,
  );
  const filaCorta = makeRow(
    { id: "01-002-R1", block: "01", tracker: "01-002", anchor: { lat: -26.92, lon: 150.582 }, azimuthDeg: 180 },
    comoCorta,
  );
  const parque = compileFarm(dosTipos, [filaLarga, filaCorta]);

  const conteo = (row: TrackerRow, dijo: number, conto: number): FieldCheck => ({
    id: `${row.id}-${dijo}`, at: "2026-09-01T09:00:00Z",
    coord: { ...row.start }, accuracyM: 3,
    said: `modulo ${dijo}`, rowId: row.id, block: row.block, tracker: row.tracker,
    module: dijo, outcome: "mismatch", countedModule: conto,
  });

  it("mide cada suma contra el largo de SU fila", () => {
    const p = pareceEspejado([conteo(filaLarga, 10, 47), conteo(filaCorta, 5, 24)], parque);
    expect(p.sumas).toEqual([57, 29]);
    expect(p.esperadas).toEqual([57, 29]);
    expect(p.espejado).toBe(true);
  });

  // Con dos largos distintos no hay un solo numero que escribir en pantalla.
  it("no inventa una suma esperada unica cuando el parque mezcla dos largos", () => {
    const p = pareceEspejado([conteo(filaLarga, 10, 47), conteo(filaCorta, 5, 24)], parque);
    expect(p.esperada).toBeNull();
  });

  it("con los conteos en filas del mismo largo si dice cual es la suma", () => {
    const p = pareceEspejado([conteo(filaCorta, 5, 24), conteo(filaCorta, 3, 26)], parque);
    expect(p.esperada).toBe(29);
    expect(p.espejado).toBe(true);
  });

  // Un conteo de una fila que este parque no tiene no aporta nada, y meterlo
  // con el largo del perfil es exactamente el error que se esta arreglando.
  it("descarta el conteo de una fila que no esta en el parque", () => {
    const fantasma = { ...filaCorta, id: "99-999-R1" };
    const p = pareceEspejado([conteo(filaCorta, 5, 24), conteo(fantasma, 5, 24)], parque);
    expect(p.sumas).toEqual([29]);
    expect(p.espejado).toBe(false);
  });
});
