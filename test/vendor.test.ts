/**
 * Leer el informe de la empresa de termografia con la geometria propia.
 *
 * Lo que se prueba aca no es leer un CSV: es detectar que el proveedor cuenta
 * los modulos desde otra punta, y que un tracker desalineado no son 56
 * defectos. Las dos cosas salieron del informe real de Edenvale y ninguna
 * estaba declarada en el archivo.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import {
  checkConditions,
  filasSinCoordenada,
  parseModuleIndex,
  readVendorFindings,
  reconcile,
  suggestVendorMapping,
  summarizeReconcile,
  toEventsCsv,
  toWalkCsv,
  trackerEvents,
  type Reconciled,
  type VendorFinding,
} from "../app/vendor";
import { applyStrings } from "../app/strings";
import { compileFarm } from "../src/index.js";
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { makeRow, pointAtSlot } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const N = profile.topology.modulesPerString; // 28

// Una fila con su lista de strings aplicada, como queda un parque cargado.
const row = makeRow(
  {
    id: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
    anchor: { lat: -27.4, lon: 152.7 }, azimuthDeg: 180, side: "north",
  },
  profile,
);
const conStrings = applyStrings([row], {
  fieldIndex: 3,
  byRow: new Map([["05-042-R1", { labels: ["S-1.2.15.1", "S-1.2.15.2"], dcBox: "DCB-1.2.15" }]]),
  chains: new Map([["05-042-R1", { pos: 1, posTotal: 1 }]]),
});
const farm = compileFarm(profile, conStrings);

/** Coordenada del hueco fisico `slot` de la fila, como la daria un dron. */
const coordDe = (slot: number) => pointAtSlot(row, slot, profile);

// ---------------------------------------------------------------------------

describe("lectura del archivo del proveedor", () => {
  it("reconoce los encabezados del informe real", () => {
    const m = suggestVendorMapping([
      "String Id", "Module Serial Number", "Anomaly Type", "Module Coordinates",
      "Latitude", "Longitude", "IEC Category", "Severity", "Delta Temperature",
      "Irradiation", "Capture DateTime", "Thermal Image Url", "RGB Image Url",
    ]);
    expect(m.lat).toBe("Latitude");
    expect(m.lon).toBe("Longitude");
    expect(m.stringId).toBe("String Id");
    expect(m.moduleIndex).toBe("Module Coordinates");
    expect(m.deltaT).toBe("Delta Temperature");
    expect(m.irradiance).toBe("Irradiation");
    expect(m.thermalUrl).toBe("Thermal Image Url");
    expect(m.rgbUrl).toBe("RGB Image Url");
  });

  // Cada proveedor lo envuelve distinto; el que varia modulo a modulo es el ultimo.
  it("saca el numero de modulo venga como venga", () => {
    expect(parseModuleIndex("(1,25)")).toBe(25);
    expect(parseModuleIndex("25")).toBe(25);
    expect(parseModuleIndex("R1-07")).toBe(7);
    expect(parseModuleIndex("")).toBeUndefined();
    expect(parseModuleIndex(null)).toBeUndefined();
  });

  /**
   * "Long" a secas es como escribe la columna la mitad de los exportadores.
   * Sin esa palabra quedaba sin asignar, se perdian TODAS las filas, y la
   * auditoria salia vacia (y hasta hace poco, en verde).
   */
  it("reconoce la longitud escrita como Long", () => {
    const m = suggestVendorMapping(["Lat", "Long", "String Id"]);
    expect(m.lon).toBe("Long");
    expect(m.lat).toBe("Lat");
  });

  /**
   * Un indice guardado como numero real —"25.0", que es lo que sale de exportar
   * una columna numerica— daba 0: el ultimo grupo de digitos era el cero de la
   * derecha. Y 0 se comparaba como si fuera un modulo.
   */
  it("un indice con decimales no se convierte en cero", () => {
    expect(parseModuleIndex("25.0")).toBe(25);
    expect(parseModuleIndex(25.0)).toBe(25);
    expect(parseModuleIndex("0")).toBeUndefined();   // no existe el modulo 0
    expect(parseModuleIndex("(1,25)")).toBe(25);     // la coma sigue separando
  });

  it("dice cuantas filas se quedaron sin coordenada, en vez de perderlas calladas", () => {
    const sheet = {
      name: "s", headers: ["Latitude", "Longitude"],
      rows: [
        { Latitude: -27.4, Longitude: 152.7 },
        { Latitude: "", Longitude: 152.7 },
        { Latitude: null, Longitude: null },
      ],
    };
    expect(filasSinCoordenada(sheet, suggestVendorMapping(sheet.headers))).toBe(2);
  });

  it("saltea las filas sin coordenada en vez de romper el lote", () => {
    const sheet = {
      name: "s", headers: ["Latitude", "Longitude", "String Id"],
      rows: [
        { Latitude: -27.4, Longitude: 152.7, "String Id": "S-1" },
        { Latitude: "", Longitude: 152.7, "String Id": "S-2" },
      ],
    };
    const f = readVendorFindings(sheet, suggestVendorMapping(sheet.headers));
    expect(f).toHaveLength(1);
    expect(f[0]!.stringId).toBe("S-1");
  });
});

// ---------------------------------------------------------------------------

describe("recalculo contra la geometria propia", () => {
  it("marca coincidencia cuando las dos numeraciones dicen lo mismo", () => {
    // El modulo 1 del string cercano a la caja.
    const propio = reconcile(
      [{ index: 1, ...coordDe(N * 2), stringId: "S-1.2.15.1", moduleIndex: 1 }],
      farm,
    )[0]!;
    expect(propio.address).not.toBeNull();
    expect(propio.ownModule).toBe(1);
    expect(propio.agreement).toBe("coincide");
  });

  // El caso que importa: mismo string, numero contado desde la otra punta.
  it("detecta el espejado, que es contar desde la punta opuesta", () => {
    const slot = N * 2; // modulo 1 desde la caja
    const r = reconcile(
      [{ index: 1, ...coordDe(slot), stringId: "S-1.2.15.1", moduleIndex: N }],
      farm,
    )[0]!;
    expect(r.ownModule).toBe(1);
    expect(r.agreement).toBe("espejado");
  });

  it("no compara si el proveedor no declaro numero de modulo", () => {
    const r = reconcile([{ index: 1, ...coordDe(5) }], farm)[0]!;
    expect(r.agreement).toBe("sin-declarar");
    expect(r.ownModule).toBeGreaterThan(0);
  });

  it("una coordenada fuera del parque queda sin ubicar, no inventa fila", () => {
    const r = reconcile([{ index: 1, lat: -30, lon: 140, moduleIndex: 5 }], farm)[0]!;
    expect(r.address).toBeNull();
    expect(r.agreement).toBe("sin-ubicar");
  });
});

describe("el veredicto", () => {
  const filas = (agreements: Reconciled["agreement"][]): Reconciled[] =>
    agreements.map((a, i) => ({ index: i, lat: 0, lon: 0, address: null, agreement: a }));

  // La firma de contar desde una punta fija en un parque de dos lados.
  it("nombra el problema cuando esta casi todo espejado", () => {
    const r = summarizeReconcile(filas(Array(50).fill("espejado")));
    expect(r.veredicto).toMatch(/desde una punta fija/);
    expect(r.veredicto).toMatch(/al reves/);
  });

  it("reconoce la mezcla mitad y mitad, que es el mismo problema", () => {
    const r = summarizeReconcile(filas([
      ...Array(25).fill("espejado"), ...Array(25).fill("coincide"),
    ]));
    expect(r.veredicto).toMatch(/de un lado de la calle/);
  });

  it("dice que el archivo sirve tal cual cuando todo coincide", () => {
    const r = summarizeReconcile(filas(Array(30).fill("coincide")));
    expect(r.veredicto).toMatch(/mismo idioma/);
  });

  it("no saca conclusiones si no hubo con que comparar", () => {
    const r = summarizeReconcile(filas(Array(10).fill("sin-ubicar")));
    expect(r.veredicto).toMatch(/No se pudo auditar nada/);
    // Y sobre todo: NO sale en verde. "No se pudo auditar" es el peor
    // resultado posible — significa que la auditoria no se hizo — y salia del
    // mismo color que un archivo impecable.
    expect(r.nivel).toBe("malo");
  });

  it("un archivo que coincide entero sale en verde y uno espejado no", () => {
    expect(summarizeReconcile(filas(Array(10).fill("coincide"))).nivel).toBe("ok");
    expect(summarizeReconcile(filas(Array(10).fill("espejado"))).nivel).toBe("malo");
  });
});

// ---------------------------------------------------------------------------

describe("eventos de tracker", () => {
  const marcar = (n: number, anomaly: string): Reconciled[] =>
    Array.from({ length: n }, (_, i) => ({
      index: i, lat: 0, lon: 0, anomaly,
      address: {
        rowId: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
        chunkIndex: 0, stringNumber: 1, module: i + 1, countedFrom: "near-dc",
        positionInRow: i + 1, center: { lat: 0, lon: 0 },
        distanceM: 0, offAxisM: 0, confidence: 1,
      } as Reconciled["address"],
      agreement: "coincide",
    }));

  // 15 trackers desalineados aparecieron como 767 defectos de modulo en el
  // informe real. Es el 24 % del archivo, y no son defectos de modulo.
  it("junta una fila entera marcada en un solo evento", () => {
    const ev = trackerEvents(marcar(56, "Wrongly inclined modules"), conStrings, farm);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.modulos).toBe(56);
    expect(ev[0]!.fraccion).toBeCloseTo(1, 2);
    expect(ev[0]!.tracker).toBe("05-042");
  });

  it("no agrupa unos pocos modulos sueltos, que si son defectos reales", () => {
    expect(trackerEvents(marcar(3, "Single hotspot affected module"), conStrings, farm)).toHaveLength(0);
  });

  it("separa por tipo de anomalia: son problemas distintos", () => {
    const ev = trackerEvents(
      [...marcar(56, "Wrongly inclined modules"), ...marcar(30, "Missing module")],
      conStrings, farm,
    );
    expect(ev.map((e) => e.anomaly)).toEqual(["Wrongly inclined modules", "Missing module"]);
  });
});

// ---------------------------------------------------------------------------

describe("condiciones de captura", () => {
  const f = (irr?: number): VendorFinding => ({ index: 1, lat: 0, lon: 0, ...(irr != null ? { irradiance: irr } : {}) });

  it("cuenta las que no traen irradiancia y las que estan por debajo del minimo", () => {
    const r = checkConditions([f(800), f(700), f(392), undefined as never].map((x) => x ?? f()));
    expect(r.bajoMinimo).toBe(1);
    expect(r.minima).toBe(392);
    expect(r.nota).toMatch(/600 W\/m2/);
    expect(r.nota).toMatch(/limitacion/);
  });

  it("no inventa un problema cuando el vuelo estuvo bien", () => {
    const r = checkConditions([f(800), f(950)]);
    expect(r.bajoMinimo).toBe(0);
    expect(r.nota).toMatch(/por encima del minimo/);
  });
});

// ---------------------------------------------------------------------------

describe("exportacion", () => {
  it("el CSV caminable conserva los dos numeros, para poder cotejar", () => {
    const r = reconcile(
      [{ index: 1, ...coordDe(N * 2), stringId: "S-1.2.15.1", moduleIndex: N, anomaly: "Hotspot" }],
      farm,
    );
    const csv = toWalkCsv(r);
    const [head, fila] = csv.split("\n");
    expect(head).toContain("modulo_desde_caja_dc");
    expect(head).toContain("modulo_proveedor");
    expect(fila).toContain("espejado");
    expect(fila).toContain("S-1.2.15.1");
  });

  it("el CSV de eventos sale ordenado por tamaño", () => {
    const csv = toEventsCsv([
      { rowId: "a", block: "1", tracker: "t1", anomaly: "x", modulos: 10, fraccion: 0.2 },
      { rowId: "b", block: "1", tracker: "t2", anomaly: "x", modulos: 56, fraccion: 1 },
    ]);
    expect(csv.split("\n")[1]).toContain("t1"); // toEventsCsv respeta el orden dado
    expect(csv.split("\n")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// El bug que casi pasa desapercibido, y que no era del codigo propio.
//
// El lector de CSV aplicaba la convencion contable: parentesis = negativo,
// coma = separador de miles. Asi, "(1,25)" —la posicion del modulo 25 en el
// informe de la termografica— entraba como el numero -125, en las 3156 filas.
//
// No fallaba nada. Quedaba un numero valido y equivocado, que es exactamente
// la clase de error que este proyecto existe para no cometer. Excel hace lo
// mismo al abrir ese archivo.
// ---------------------------------------------------------------------------

describe("el CSV se lee sin que nadie le cambie los numeros", () => {
  const csv = [
    "String Id,Module Coordinates,Latitude,Longitude",
    'S-1.1.1.2.1,"(1,25)",-26.919,150.577',
    'S-1.1.1.2.2,"(1,1)",-26.920,150.578',
  ].join("\n");

  it("no convierte (1,25) en -125", async () => {
    const { readWorkbook } = await import("../app/ingest");
    const buf = new TextEncoder().encode(csv).buffer;
    const sheets = await readWorkbook(buf as ArrayBuffer, 1);
    const s = sheets[0]!;
    const f = readVendorFindings(s, suggestVendorMapping(s.headers));

    expect(f).toHaveLength(2);
    expect(f[0]!.moduleIndex).toBe(25);
    expect(f[1]!.moduleIndex).toBe(1);
    // Y sobre todo: ningun modulo negativo ni fuera del string.
    expect(f.every((x) => x.moduleIndex! > 0 && x.moduleIndex! <= 28)).toBe(true);
  });

  it("las coordenadas siguen leyendose como numeros", async () => {
    const { readWorkbook } = await import("../app/ingest");
    const buf = new TextEncoder().encode(csv).buffer;
    const sheets = await readWorkbook(buf as ArrayBuffer, 1);
    const f = readVendorFindings(sheets[0]!, suggestVendorMapping(sheets[0]!.headers));
    expect(f[0]!.lat).toBeCloseTo(-26.919, 3);
    expect(f[0]!.lon).toBeCloseTo(150.577, 3);
  });
});

// ---------------------------------------------------------------------------
// Un parque con dos tipos de tracker mezclados
// ---------------------------------------------------------------------------

/**
 * El largo del string sale de la FILA, no del perfil.
 *
 * La auditoria leia `profile.topology.modulesPerString` una sola vez y lo usaba
 * para todo el parque. Un parque puede mezclar trackers largos con cortos —los
 * cortos van contra el limite del terreno o en las puntas de fila, en los
 * mismos bloques y en la misma lista de strings— y el compilador ya resuelve el
 * largo fila por fila. Leer el del perfil es tirar ese dato justo donde importa.
 *
 * Lo que rompia, con los numeros de este archivo: en una fila corta de 28, el
 * proveedor dice modulo 5 y la geometria da 24. Son el mismo modulo contado
 * desde puntas opuestas (24 = 29 − 5), pero el espejo se probaba contra 56 + 1
 * − 5 = 52, no daba, y el hallazgo caia en "otro-string". En una fila de 32 m
 * eso son los dos extremos del tracker.
 */
const mixto: FarmProfile = {
  id: "mixto", name: "Parque de dos tipos", profileVersion: 1,
  module: { widthMm: 1134, gapMm: 10, lengthMm: 2278, orientation: "portrait", pitchMm: null },
  topology: {
    modulesPerString: 56,
    stringsPerRow: 1,
    variants: [{ id: "corto", name: "Tracker corto de 28", modulesPerString: 28, stringsPerRow: 1 }],
  },
  geometry: { source: "survey-stakes", endpointOffsetMm: 0, endpointOffsetMode: "none" },
  addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
  matching: { maxDistanceM: 20, neighborhood: 1, defaultAccuracyM: 1 },
};

/** El mismo perfil visto como si solo existiera un tipo: para medir largos. */
const vistaLarga: FarmProfile = { ...mixto, topology: { modulesPerString: 56, stringsPerRow: 1 } };
const vistaCorta: FarmProfile = { ...mixto, topology: { modulesPerString: 28, stringsPerRow: 1 } };

const larga = makeRow(
  { id: "01-001-R1", block: "01", tracker: "01-001", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180 },
  vistaLarga,
);
const corta = makeRow(
  { id: "01-002-R1", block: "01", tracker: "01-002", row: "R1",
    anchor: { lat: -26.92, lon: 150.582 }, azimuthDeg: 180 },
  vistaCorta,
);
const parqueMixto = compileFarm(mixto, [larga, corta]);

/** Un hallazgo del proveedor parado en el modulo fisico `slot` de la fila. */
function hallazgoEn(
  index: number,
  row: TrackerRow,
  vista: FarmProfile,
  slot: number,
  moduleIndex: number,
  anomaly = "Hot spot",
): VendorFinding {
  const c = pointAtSlot(row, slot, vista, "start");
  return { index, lat: c.lat, lon: c.lon, moduleIndex, anomaly };
}

describe("la auditoria en un parque de dos tipos de tracker", () => {
  it("el compilador le da a cada fila su largo, que es de donde hay que leerlo", () => {
    const l = parqueMixto.rows.find((r) => r.source.id === "01-001-R1")!;
    const c = parqueMixto.rows.find((r) => r.source.id === "01-002-R1")!;
    expect(l.modulesPerString).toBe(56);
    expect(c.modulesPerString).toBe(28);
    expect(c.variantId).toBe("corto");
  });

  // El caso exacto: fila corta, el proveedor dice 5 y la geometria da 24.
  it("reconoce el espejo en una fila corta, que con el largo del perfil no daba", () => {
    const r = reconcile([hallazgoEn(1, corta, vistaCorta, 24, 5)], parqueMixto)[0]!;
    expect(r.ownModule).toBe(24);
    expect(r.agreement).toBe("espejado");
  });

  it("y lo sigue reconociendo en una fila larga, que es donde ya funcionaba", () => {
    const r = reconcile([hallazgoEn(1, larga, vistaLarga, 50, 7)], parqueMixto)[0]!;
    expect(r.ownModule).toBe(50);
    expect(r.agreement).toBe("espejado");
  });

  it("una coincidencia en la fila corta sigue siendo coincidencia", () => {
    const r = reconcile([hallazgoEn(1, corta, vistaCorta, 24, 24)], parqueMixto)[0]!;
    expect(r.agreement).toBe("coincide");
  });

  /**
   * El veredicto es lo que se lee en dos segundos. Con el largo del perfil, los
   * hallazgos de las filas cortas caian en "no cierran de ninguna de las dos
   * formas" y el numero del titular dejaba de contar medio archivo: un parque
   * enteramente espejado —que se arregla de una sola manera— se leia como un
   * archivo mezclado, que manda a revisar casos a mano.
   */
  it("un archivo entero espejado se ve entero espejado, no medio sin explicar", () => {
    const findings = [
      hallazgoEn(1, larga, vistaLarga, 50, 7),
      hallazgoEn(2, larga, vistaLarga, 10, 47),
      hallazgoEn(3, corta, vistaCorta, 24, 5),
      hallazgoEn(4, corta, vistaCorta, 3, 26),
    ];
    const resumen = summarizeReconcile(reconcile(findings, parqueMixto));
    expect(resumen.espejados).toBe(4);
    expect(resumen.otros).toBe(0);
    expect(resumen.veredicto).toMatch(/Practicamente todo el archivo esta espejado \(4 de 4\)/);
    expect(resumen.nivel).toBe("malo");
  });

  /**
   * Lo mismo en el agrupamiento por tracker. Un tracker corto marcado casi
   * entero se dividia por 56 en vez de por 28: daba fraccion 0.36 y se caia del
   * umbral, asi que 20 hallazgos que son UN tracker volvian a leerse como 20
   * defectos de modulo.
   */
  it("un tracker corto marcado casi entero se reporta como un evento de tracker", () => {
    const findings = Array.from({ length: 20 }, (_, i) =>
      hallazgoEn(i + 1, corta, vistaCorta, i + 1, i + 1, "Tracker desalineado"),
    );
    const eventos = trackerEvents(reconcile(findings, parqueMixto), [larga, corta], parqueMixto);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.rowId).toBe("01-002-R1");
    expect(eventos[0]!.modulos).toBe(20);
    expect(eventos[0]!.fraccion).toBeCloseTo(20 / 28, 3);
  });
});
