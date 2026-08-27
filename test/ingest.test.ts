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
import type { TrackerRow } from "@locator";
import * as XLSX from "xlsx";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import {
  buildRows,
  capabilityReport,
  guessCrs,
  mergeRows,
  readWorkbook,
  suggestEndpointOffsetMm,
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

// ---------------------------------------------------------------------------
// Casos que salieron del primer archivo real (Datos_Backtracking_T1)
// ---------------------------------------------------------------------------

describe("columna de fila usada como bandera (MOTOR ROW = YES/NO)", () => {
  const sheetWith = (values: unknown[]) => ({
    name: "DATA",
    headers: ["bloque", "tracker", "MOTOR ROW", "pica1Y", "pica1X", "pica2Y", "pica2X"],
    rows: values.map((v, i) => ({
      bloque: 1,
      tracker: i + 1,
      "MOTOR ROW": v,
      pica1Y: -27.4,
      pica1X: 152.7,
      pica2Y: -27.4006,
      pica2X: 152.7,
    })),
  });
  const mapping = {
    block: "bloque", tracker: "tracker", row: "MOTOR ROW",
    startY: "pica1Y", startX: "pica1X", endY: "pica2Y", endX: "pica2X",
  };

  it("traduce YES/NO a motorizada/esclava", () => {
    const built = buildRows(sheetWith(["YES", "NO", "YES"]), mapping, { type: "wgs84" });
    expect(built.rows.map((r) => r.row)).toEqual(["motorizada", "esclava", "motorizada"]);
  });

  it("no toca una columna que de verdad son etiquetas de fila", () => {
    const built = buildRows(sheetWith(["R1", "R4", "R5"]), mapping, { type: "wgs84" });
    expect(built.rows.map((r) => r.row)).toEqual(["R1", "R4", "R5"]);
  });

  it("no traduce si la columna mezcla banderas con otra cosa", () => {
    const built = buildRows(sheetWith(["YES", "NO", "R3"]), mapping, { type: "wgs84" });
    expect(built.rows.map((r) => r.row)).toEqual(["YES", "NO", "R3"]);
  });
});

describe("deduccion del offset de pica", () => {
  // Reproduce el caso real: filas de 65.145 m con 56 modulos de 1150 mm.
  // El offset tiene que dar ~373 mm, no los 1400 mm que declaraba el perfil.
  it("despeja el offset a partir del largo real de las filas", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      makeRow(
        {
          id: `t${i}`, block: "1", tracker: `${i}`,
          anchor: { lat: -27.4, lon: 152.7 + i * 0.0001 },
          azimuthDeg: 180,
          lengthM: 65.145,
        },
        profile,
      ),
    );
    const hint = suggestEndpointOffsetMm(rows, 56, 1150)!;
    expect(hint.medianLengthM).toBeCloseTo(65.145, 2);
    expect(hint.offsetMm).toBeGreaterThan(360);
    expect(hint.offsetMm).toBeLessThan(390);
    expect(hint.spreadMm).toBeLessThan(50);
  });

  /**
   * Edenvale con los cuatro numeros medidos con cinta, que es de donde sale el
   * −25 que quedo guardado en el perfil.
   *
   * Se prueba el desglose y no solo el resultado, porque la pantalla mostraba
   * el −25 correcto con una explicacion que no daba −25: decia "56 modulos de
   * 1155 mm" y se olvidaba de la bahia y del hueco que el ultimo modulo no
   * tiene. Numero bien, cuenta mal es peor que los dos mal — el que la revisa
   * a mano concluye que el numero esta mal y lo cambia.
   */
  it("el -25 de Edenvale sale de sumar el fierro, no de un paso promedio", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      makeRow(
        {
          id: `t${i}`, block: "1", tracker: `${i}`,
          anchor: { lat: -27.4, lon: 152.7 + i * 0.0001 },
          azimuthDeg: 180, lengthM: 65.145,
        },
        profile,
      ),
    );
    const hint = suggestEndpointOffsetMm(rows, 56, 1135 + 20, {
      moduleGapMm: 20, stringsPerRow: 2, stringGapMm: 555,
    })!;

    // 56 paneles + 54 huecos + 1 bahia. Ni 55 huecos ni 2 bahias.
    expect(hint.extentMm).toBe(56 * 1135 + 54 * 20 + 555);
    expect(hint.extentMm).toBe(65195);
    expect(hint.offsetMm).toBeCloseTo(-25, 0);
  });

  it("avisa cuando las filas no miden todas lo mismo", () => {
    const rows = [40, 65, 90].map((len, i) =>
      makeRow(
        {
          id: `t${i}`, block: "1", tracker: `${i}`,
          anchor: { lat: -27.4, lon: 152.7 + i * 0.0001 },
          azimuthDeg: 180, lengthM: len,
        },
        profile,
      ),
    );
    expect(suggestEndpointOffsetMm(rows, 56, 1150)!.spreadMm).toBeGreaterThan(500);
  });
});

describe("agrupacion de filas salteadas", () => {
  const base = (i: number, ok: boolean) => ({
    bloque: 1, tracker: i, pica1Y: ok ? -27.4 : null, pica1X: 152.7,
    pica2Y: -27.4006, pica2X: 152.7,
  });
  const mapping = {
    block: "bloque", tracker: "tracker",
    startY: "pica1Y", startX: "pica1X", endY: "pica2Y", endX: "pica2X",
  };

  it("distingue un bloque contiguo al final de descartes desparramados", () => {
    const contiguo = buildRows(
      { name: "s", headers: [], rows: [...Array(5)].map((_, i) => base(i, i < 3)) },
      mapping, { type: "wgs84" },
    );
    expect(contiguo.skippedSummary).toHaveLength(1);
    expect(contiguo.skippedSummary[0]!.count).toBe(2);
    // Contiguo: el rango de filas coincide con la cantidad.
    const s = contiguo.skippedSummary[0]!;
    expect(s.lastRow - s.firstRow + 1).toBe(s.count);

    const disperso = buildRows(
      { name: "s", headers: [], rows: [...Array(6)].map((_, i) => base(i, i % 2 === 0)) },
      mapping, { type: "wgs84" },
    );
    const d = disperso.skippedSummary[0]!;
    expect(d.lastRow - d.firstRow + 1).toBeGreaterThan(d.count);
  });
});

describe("fusion de geometria", () => {
  const fila = (id: string, lat = -27.4) => ({
    id, block: id.slice(0, 2), tracker: id,
    start: { lat, lon: 152.7 }, end: { lat: lat - 0.0006, lon: 152.7 },
  });

  it("suma las filas nuevas y conserva las que ya estaban", () => {
    const m = mergeRows([fila("01-a"), fila("01-b")], [fila("02-a"), fila("02-b"), fila("02-c")]);
    expect(m.rows).toHaveLength(5);
    expect(m.nuevas).toBe(3);
    expect(m.repetidas).toBe(0);
    expect(m.rows.map((r) => r.id)).toContain("01-a");
  });

  // Volver a cargar el mismo archivo no tiene que cambiar nada: es lo que uno
  // hace cuando no se acuerda si ya lo habia cargado.
  it("cargar dos veces el mismo archivo deja el parque igual", () => {
    const previas = [fila("01-a"), fila("01-b")];
    const m = mergeRows(previas, [fila("01-a"), fila("01-b")]);
    expect(m.rows).toHaveLength(2);
    expect(m.nuevas).toBe(0);
    expect(m.repetidas).toBe(2);
  });

  it("una fila repetida se actualiza con la version nueva, no se duplica", () => {
    const m = mergeRows([fila("01-a", -27.4)], [fila("01-a", -27.5)]);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]!.start.lat).toBe(-27.5);
  });

  it("sobre un parque vacio es simplemente cargar", () => {
    const m = mergeRows([], [fila("01-a")]);
    expect(m.rows).toHaveLength(1);
    expect(m.nuevas).toBe(1);
  });

  it("mantiene el orden: primero lo viejo que sigue, despues lo que entra", () => {
    const m = mergeRows([fila("01-a"), fila("01-b")], [fila("01-b"), fila("02-a")]);
    expect(m.rows.map((r) => r.id)).toEqual(["01-a", "01-b", "02-a"]);
  });
});

describe("diagnostico de las filas salteadas", () => {
  const sheet = {
    name: "DATA",
    headers: ["BLOQUE", "TRACKER", "y1", "x1", "y2", "x2"],
    rows: [
      { BLOQUE: "01", TRACKER: "T1", y1: -27.4, x1: 152.7, y2: -27.4006, x2: 152.7 },
      { BLOQUE: "01", TRACKER: "T2", y1: -27.4, x1: 152.7, y2: -27.4006, x2: 152.7 },
      { BLOQUE: "TOTAL", TRACKER: null, y1: null, x1: null, y2: null, x2: null },
      { BLOQUE: null, TRACKER: null, y1: null, x1: null, y2: null, x2: null },
    ],
  };
  const mapping = {
    block: "BLOQUE", tracker: "TRACKER",
    startY: "y1", startX: "x1", endY: "y2", endX: "x2",
  };

  // Sin ver que dicen esas filas, "384 salteadas" no se puede interpretar.
  it("muestra que decia de verdad cada fila salteada", () => {
    const built = buildRows(sheet, mapping, { type: "wgs84" });
    expect(built.rows).toHaveLength(2);

    const resumen = built.skippedSummary[0]!;
    expect(resumen.count).toBe(2);
    expect(resumen.sample.length).toBeGreaterThan(0);
    // La fila de totales se reconoce por su contenido.
    expect(resumen.sample.map((s) => s.cells).join(" ")).toMatch(/TOTAL/);
  });

  it("dice cuando la fila estaba completamente vacia", () => {
    const built = buildRows(
      { ...sheet, rows: [sheet.rows[0]!, sheet.rows[3]!] },
      mapping,
      { type: "wgs84" },
    );
    expect(built.skippedSummary[0]!.sample[0]!.cells).toMatch(/vacias/);
  });
});

describe("colisiones al fusionar dos archivos", () => {
  const fila = (id: string, lat: number, lon: number) => ({
    id, block: id.slice(0, 2), tracker: id,
    start: { lat, lon }, end: { lat: lat - 0.0006, lon },
  });

  // El riesgo real: dos archivos que numeran bloques distintos con el mismo
  // numero. Fusionarlos pisa geometria buena sin que nadie se entere.
  it("avisa cuando una fila repetida esta en otro lugar del mundo", () => {
    const m = mergeRows([fila("05-001", -27.4, 152.7)], [fila("05-001", -27.41, 152.71)]);
    expect(m.colisiones).toHaveLength(1);
    expect(m.colisiones[0]!.id).toBe("05-001");
    expect(m.colisiones[0]!.distanciaM).toBeGreaterThan(500);
  });

  it("no avisa por una correccion chica de coordenada", () => {
    // Un metro de diferencia es un replanteo corregido, no otro bloque.
    const m = mergeRows([fila("05-001", -27.4, 152.7)], [fila("05-001", -27.400009, 152.7)]);
    expect(m.repetidas).toBe(1);
    expect(m.colisiones).toEqual([]);
  });

  it("no avisa cuando los bloques no se solapan", () => {
    const m = mergeRows([fila("05-001", -27.4, 152.7)], [fila("06-001", -27.41, 152.71)]);
    expect(m.nuevas).toBe(1);
    expect(m.colisiones).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * Volver a cargar el Excel no puede borrar lo que se aplico aparte.
 *
 * Un Excel de picas trae geometria y nada mas. El numero de string, la etiqueta
 * del cliente, la posicion del tracker en su linea electrica y el lado de la
 * calle entraron por otro lado y despues de bastante trabajo.
 *
 * Sin esta regla, corregir un parametro de geometria —que obliga a pasar por el
 * asistente— borraba los 13.480 strings de Edenvale en silencio.
 */
describe("fusionar sin perder lo aplicado aparte", () => {
  const base = (over: Partial<TrackerRow> = {}): TrackerRow => ({
    id: "01-001-R1", block: "01", tracker: "01-001", row: "R1",
    start: { lat: -27.4, lon: 152.7 }, end: { lat: -27.4006, lon: 152.7 },
    ...over,
  });

  const conStrings = base({
    stringNumbers: [5, 6],
    stringLabels: ["S-1.2.15.1", "S-1.2.15.2"],
    pos: 2, posTotal: 4, side: "north",
  });

  it("conserva los strings cuando el archivo nuevo no los trae", () => {
    const r = mergeRows([conStrings], [base({ start: { lat: -27.4001, lon: 152.7 } })]);
    const fila = r.rows[0]!;
    expect(fila.stringNumbers).toEqual([5, 6]);
    expect(fila.stringLabels).toEqual(["S-1.2.15.1", "S-1.2.15.2"]);
    expect(fila.pos).toBe(2);
    expect(fila.posTotal).toBe(4);
    expect(fila.side).toBe("north");
  });

  it("pero la geometria si la pisa el archivo nuevo", () => {
    const r = mergeRows([conStrings], [base({ start: { lat: -27.4001, lon: 152.7 } })]);
    expect(r.rows[0]!.start.lat).toBeCloseTo(-27.4001, 6);
    expect(r.repetidas).toBe(1);
  });

  it("y si el archivo nuevo SI trae strings, manda el archivo", () => {
    const r = mergeRows([conStrings], [base({ stringNumbers: [9], stringLabels: ["S-9"] })]);
    expect(r.rows[0]!.stringNumbers).toEqual([9]);
    expect(r.rows[0]!.stringLabels).toEqual(["S-9"]);
  });

  it("una fila nueva entra tal cual, sin heredar nada", () => {
    const r = mergeRows([conStrings], [base({ id: "01-002-R1" })]);
    expect(r.nuevas).toBe(1);
    expect(r.rows.find((x) => x.id === "01-002-R1")!.stringNumbers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("codificacion del archivo", () => {
  /**
   * Un CSV exportado en UTF-8 sin BOM —lo que sale de QGIS, de un script, de
   * cualquier cosa que no sea Excel en Windows— se leia con la codificacion
   * vieja y los acentos quedaban rotos: "Ubicación" entraba como "UbicaciÃ³n".
   *
   * No rompe nada a la vista. Rompe el reconocimiento de columnas, que es lo
   * que decide si el operador asigna dos columnas o cuarenta.
   */
  it("lee los acentos de un CSV en UTF-8 sin BOM", async () => {
    const csv = "Bloque,Tracker,Posición,Este inicial\n05,05-042,1,512345.6\n";
    const buf = new TextEncoder().encode(csv).buffer as ArrayBuffer;
    const [hoja] = await readWorkbook(buf);
    expect(hoja!.headers).toContain("Posición");
    expect(hoja!.headers).toContain("Este inicial");
    expect(hoja!.headers).not.toContain("PosiciÃ³n");
  });

  it("un CSV en ASCII puro sigue entrando igual", async () => {
    const csv = "Bloque,Tracker\n05,05-042\n";
    const buf = new TextEncoder().encode(csv).buffer as ArrayBuffer;
    const [hoja] = await readWorkbook(buf);
    expect(hoja!.headers).toEqual(["Bloque", "Tracker"]);
    expect(hoja!.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("reconocimiento de columnas: la mas especifica gana", () => {
  /**
   * "POS TOTAL" se la llevaba `pos`, porque `pos` va antes en la lista y su
   * regla es una sola palabra. "Trackers en la linea" quedaba sin asignar — y
   * ese es el dato que dice si una fila es la ultima de su linea electrica, o
   * sea el que decide de que punta se cuenta el modulo 1.
   */
  it("POS TOTAL va a 'trackers en la linea', no a 'posicion'", () => {
    const m = suggestMapping(["BLOQUE", "TRACKER", "POS", "POS TOTAL"]);
    expect(m.posTotal).toBe("POS TOTAL");
    expect(m.pos).toBe("POS");
  });

  it("si solo esta POS TOTAL, no se la queda 'posicion'", () => {
    const m = suggestMapping(["BLOQUE", "TRACKER", "POS TOTAL"]);
    expect(m.posTotal).toBe("POS TOTAL");
    expect(m.pos).toBeUndefined();
  });

  it("a igualdad de regla gana el encabezado con menos palabras de sobra", () => {
    const m = suggestMapping(["POSICION DEL TRACKER EN LA LINEA", "POSICION"]);
    expect(m.pos).toBe("POSICION");
  });
});

// ---------------------------------------------------------------------------

describe("la bandera de fila motorizada", () => {
  /**
   * De aca sale que un parque "tenga filas motorizadas y esclavas", que es una
   * afirmacion fuerte sobre el racking. No la deduce nadie: esta en el archivo,
   * en una columna que trae YES/NO. Pero la traduccion se hacia EN SILENCIO, y
   * el que carga el parque no tenia como saber de donde salieron esas palabras
   * ni sobre que columna. Una conclusion que no se puede rastrear es una
   * conclusion en la que no se puede confiar.
   */
  const hoja = (valores: string[]) => ({
    name: "s",
    headers: ["BLOQUE", "TRACKER", "MOTOR ROW", "XI", "YI", "XF", "YF"],
    rows: valores.map((v, i) => ({
      BLOQUE: "01", TRACKER: `00${i + 1}`, "MOTOR ROW": v,
      XI: 500000 + i, YI: 7000000, XF: 500000 + i, YF: 7000065,
    })),
  });
  const mapa = {
    block: "BLOQUE", tracker: "TRACKER", row: "MOTOR ROW",
    startX: "XI", startY: "YI", endX: "XF", endY: "YF",
  } as const;
  const crs = { type: "utm", zone: 56, hemisphere: "S" } as const;

  it("traduce YES/NO a motorizada/esclava", () => {
    const b = buildRows(hoja(["YES", "NO", "YES", "NO"]), mapa, crs);
    expect(b.rows.map((r) => r.row)).toEqual(["motorizada", "esclava", "motorizada", "esclava"]);
  });

  it("y lo DICE: nombra la columna, los valores y cuantas filas cayeron de cada lado", () => {
    const b = buildRows(hoja(["YES", "NO", "YES", "NO"]), mapa, crs);
    const texto = b.sospechas.join(" ");
    expect(texto).toMatch(/columna "MOTOR ROW"/);
    expect(texto).toMatch(/2 filas con "YES" → motorizada/);
    expect(texto).toMatch(/2 filas con "NO" → esclava/);
    // Y dice que hacer si esa columna significa otra cosa.
    expect(texto).toMatch(/sin asignar/);
  });

  /**
   * El limite de la traduccion: solo se aplica si TODA la columna esta en ese
   * vocabulario. Un parque que numera sus filas de verdad no sale trastocado.
   */
  it("una columna con nombres de fila de verdad no se toca ni se comenta", () => {
    const b = buildRows(hoja(["R1", "R2", "R1", "R2"]), mapa, crs);
    expect(b.rows.map((r) => r.row)).toEqual(["R1", "R2", "R1", "R2"]);
    expect(b.sospechas.join(" ")).not.toMatch(/bandera si\/no/);
  });
});
