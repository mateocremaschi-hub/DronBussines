/**
 * La prueba de que el camino completo funciona: un Excel con la forma que
 * tienen las planillas reales entra por un lado, y por el otro sale una
 * direccion fisica correcta.
 *
 * Se arma el Excel dentro del test, con encabezados feos a proposito y
 * coordenadas en UTM, para ejercitar la deteccion de columnas y la conversion
 * de coordenadas — no solo el caso limpio.
 */

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import {
  buildRows,
  capabilityReport,
  guessCrs,
  readWorkbook,
  suggestMapping,
  toNumber,
} from "../app/ingest";
import { compileFarm, locate, wgs84ToUtm } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, pointAtSlot } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;

// Una fila real de Edenvale: lado norte, primera de una linea de 3.
const row = makeRow(
  {
    id: "05-042-R1",
    block: "05",
    tracker: "05-042",
    row: "R1",
    anchor: { lat: -27.4, lon: 152.7 },
    azimuthDeg: 180,
    side: "north",
    pos: 1,
    posTotal: 3,
    stringNumbers: [1, 2],
  },
  profile,
);

/** Arma un .xlsx en memoria con la forma tipica de una planilla de picas. */
function makeWorkbook(): ArrayBuffer {
  const a = wgs84ToUtm(row.start.lat, row.start.lon, 56);
  const b = wgs84ToUtm(row.end.lat, row.end.lon, 56);

  const data = [
    {
      // Encabezados con mayusculas, espacios y acentos, como vienen de verdad.
      "BLOQUE": 5,
      "TRACKER": "05-042",
      "MOTOR ROW": "R1",
      "PICA 1 NORTE (N)": b.northing, // pica 1 = la del norte
      "PICA 1 ESTE (E)": b.easting,
      "PICA 2 NORTE (N)": a.northing,
      "PICA 2 ESTE (E)": a.easting,
      "LADO": "Norte",
      "POS": 1,
      "POS TOTAL": 3,
      "STRINGS": "1,2",
    },
  ];

  const wb = XLSX.utils.book_new();
  // Primera hoja vacia a proposito: la hoja con datos no siempre es la primera,
  // y mirar solo la primera fue un bug real en Edenvale.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["hoja de portada"]]), "PORTADA");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "DATA");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

// ---------------------------------------------------------------------------

describe("toNumber", () => {
  it("entiende los formatos que aparecen en planillas reales", () => {
    expect(toNumber(1234.5)).toBe(1234.5);
    expect(toNumber("1234.5")).toBe(1234.5);
    expect(toNumber("1.234,5")).toBe(1234.5); // formato europeo
    expect(toNumber("1,234.5")).toBe(1234.5); // formato ingles
    expect(toNumber("6 965 000")).toBe(6965000); // espacios de miles
    expect(toNumber("-27,4")).toBe(-27.4); // coma decimal sola
    expect(toNumber("")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber("no es un numero")).toBeNull();
  });
});

describe("camino completo: Excel -> direccion fisica", () => {
  it("lee todas las hojas, no solo la primera", async () => {
    const sheets = await readWorkbook(makeWorkbook());
    expect(sheets.map((s) => s.name)).toContain("DATA");
    expect(sheets.find((s) => s.name === "DATA")!.rows).toHaveLength(1);
  });

  it("reconoce las columnas aunque los encabezados sean feos", async () => {
    const sheets = await readWorkbook(makeWorkbook());
    const data = sheets.find((s) => s.name === "DATA")!;
    const mapping = suggestMapping(data.headers);

    expect(mapping.block).toBe("BLOQUE");
    expect(mapping.tracker).toBe("TRACKER");
    expect(mapping.row).toBe("MOTOR ROW");
    expect(mapping.side).toBe("LADO");
    expect(mapping.pos).toBe("POS");
    expect(mapping.stringNumbers).toBe("STRINGS");
    // Las cuatro coordenadas tienen que caer en cuatro campos distintos.
    const coords = [mapping.startX, mapping.startY, mapping.endX, mapping.endY];
    expect(new Set(coords).size).toBe(4);
    expect(coords.every(Boolean)).toBe(true);
  });

  it("se da cuenta de que las coordenadas son UTM del hemisferio sur", async () => {
    const sheets = await readWorkbook(makeWorkbook());
    const data = sheets.find((s) => s.name === "DATA")!;
    const mapping = suggestMapping(data.headers);
    const samples = data.rows.map((r) => ({
      x: toNumber(r[mapping.startX!])!,
      y: toNumber(r[mapping.startY!])!,
    }));
    expect(guessCrs(samples)).toMatchObject({ type: "utm", hemisphere: "S" });
  });

  it("construye geometria que el motor localiza correctamente", async () => {
    const sheets = await readWorkbook(makeWorkbook());
    const data = sheets.find((s) => s.name === "DATA")!;
    const mapping = suggestMapping(data.headers);
    const built = buildRows(data, mapping, { type: "utm", zone: 56, hemisphere: "S" });

    expect(built.skipped).toEqual([]);
    expect(built.rows).toHaveLength(1);

    const imported = built.rows[0]!;
    expect(imported.block).toBe("5");
    expect(imported.tracker).toBe("05-042");
    expect(imported.row).toBe("R1");
    expect(imported.side).toBe("north");
    expect(imported.stringNumbers).toEqual([1, 2]);

    // La ida y vuelta por UTM tiene que conservar la geometria al centimetro.
    const farm = compileFarm(profile, built.rows);
    expect(farm.buildWarnings).toEqual([]);

    // El caso verificado en campo: en la punta mas lejana a la caja DC esta el
    // modulo 1 del string lejano, contado al reves por el piercing connector.
    const tip = pointAtSlot(row, 1, profile);
    const res = locate({ ...tip, accuracyM: 0.5 }, farm);
    expect(res.best).toMatchObject({
      block: "5",
      tracker: "05-042",
      row: "R1",
      stringNumber: 2,
      module: 1,
      countedFrom: "far-end",
    });

    // Y en la punta de la caja DC, el modulo 1 del string cercano.
    const dcEnd = pointAtSlot(row, 56, profile);
    expect(locate({ ...dcEnd, accuracyM: 0.5 }, farm).best).toMatchObject({
      stringNumber: 1,
      module: 1,
      countedFrom: "near-dc",
    });
  });

  it("saltea filas incompletas en vez de romper el import entero", () => {
    const sheet = {
      name: "x",
      headers: ["block", "tracker", "y1", "x1", "y2", "x2"],
      rows: [
        { block: "01", tracker: "T1", y1: -27.4, x1: 152.7, y2: -27.401, x2: 152.7 },
        { block: "01", tracker: "T2", y1: null, x1: 152.7, y2: -27.401, x2: 152.7 },
        { block: "", tracker: "T3", y1: -27.4, x1: 152.7, y2: -27.401, x2: 152.7 },
      ],
    };
    const built = buildRows(
      sheet,
      { block: "block", tracker: "tracker", startY: "y1", startX: "x1", endY: "y2", endX: "x2" },
      { type: "wgs84" },
    );
    expect(built.rows).toHaveLength(1);
    expect(built.skipped).toHaveLength(2);
    expect(built.skipped[0]!.reason).toMatch(/coordenadas/);
    expect(built.skipped[1]!.reason).toMatch(/bloque o tracker/);
  });
});

describe("informe de capacidad", () => {
  it("con datos completos habilita todo menos el serial", async () => {
    const sheets = await readWorkbook(makeWorkbook());
    const data = sheets.find((s) => s.name === "DATA")!;
    const built = buildRows(data, suggestMapping(data.headers), {
      type: "utm", zone: 56, hemisphere: "S",
    });
    const caps = capabilityReport(built.rows, profile);

    expect(caps.filter((c) => !c.available).map((c) => c.label)).toEqual([
      "Numero de serie del panel",
    ]);
  });

  // Este es el comportamiento que hace que la app sirva "para cualquier parque
  // segun la info que tenga": con menos datos no se niega, degrada y lo dice.
  it("con solo coordenadas sigue localizando, y avisa que no puede resolver el string", () => {
    const rows = [
      { id: "a", block: "01", tracker: "T1", start: { lat: -27.4, lon: 152.7 }, end: { lat: -27.4006, lon: 152.7 } },
    ];
    const caps = capabilityReport(rows, profile);
    const byLabel = Object.fromEntries(caps.map((c) => [c.label, c]));

    expect(byLabel["Bloque, tracker y posicion del modulo en la fila"]!.available).toBe(true);
    expect(byLabel["Desde que punta se cuenta el modulo 1"]!.available).toBe(false);
    expect(byLabel["Cual de los strings de la fila"]!.available).toBe(false);
    expect(byLabel["Desde que punta se cuenta el modulo 1"]!.detail).toMatch(/fixed-end/);
  });

  it("con la estrategia simple, esas mismas capacidades quedan disponibles", () => {
    const simple: FarmProfile = {
      ...profile,
      addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
    };
    const rows = [
      { id: "a", block: "01", tracker: "T1", start: { lat: -27.4, lon: 152.7 }, end: { lat: -27.4006, lon: 152.7 } },
    ];
    const caps = capabilityReport(rows, simple);
    const byLabel = Object.fromEntries(caps.map((c) => [c.label, c]));
    expect(byLabel["Desde que punta se cuenta el modulo 1"]!.available).toBe(true);
    expect(byLabel["Cual de los strings de la fila"]!.available).toBe(true);
  });
});
