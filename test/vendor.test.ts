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
import type { FarmProfile } from "../src/types.js";
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
    expect(r.veredicto).toMatch(/No hubo con que comparar/);
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
