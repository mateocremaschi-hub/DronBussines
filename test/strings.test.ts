/**
 * La lista de strings: lo que cierra la numeracion.
 *
 * El caso que mas importa esta al final: los trackers que cuelgan de una misma
 * caja DC pueden estar en cadena (uno atras del otro, con piercing connectors
 * entre ellos) o en paralelo (uno al lado del otro, cada uno su propia linea).
 * Significan cosas opuestas para el conteo, y la diferencia se MIDE en las
 * coordenadas en vez de suponerse.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import {
  applyStrings,
  canonRow,
  describeFields,
  deriveChains,
  forwardFill,
  matchEntries,
  numericFields,
  parseTrackerRef,
  readEntries,
  suggestStringMapping,
  type StringEntry,
} from "../app/strings";
import { compileFarm, locate } from "../src/index.js";
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { makeRow, nominalLengthM, pointAtSlot } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const LEN = nominalLengthM(profile);
const M_LAT = 110946;

/** Fila de modulos en (lat, lon), apuntando de norte a sur. */
const fila = (id: string, lat: number, lon: number, block = "05") =>
  makeRow(
    { id, block, tracker: id, anchor: { lat, lon }, azimuthDeg: 180, side: "north" },
    profile,
  );

// ---------------------------------------------------------------------------

describe("lectura del archivo", () => {
  it("reconoce los encabezados tipicos", () => {
    const m = suggestStringMapping(["STRING", "TRACKER", "ARRAY BUS", "DC BOX No.", "TYPE"]);
    expect(m.label).toBe("STRING");
    expect(m.tracker).toBe("TRACKER");
    expect(m.dcBox).toBe("DC BOX No.");
  });

  // Sin esto, la caja DC aparece solo en la primera fila de cada bloque
  // combinado y el 90 % de los strings queda sin caja.
  it("rellena hacia abajo las celdas combinadas", () => {
    const sheet = {
      name: "s", headers: ["STRING", "DCB"],
      rows: [
        { STRING: "S-1", DCB: "DCB-1" },
        { STRING: "S-2", DCB: null },
        { STRING: "S-3", DCB: "" },
        { STRING: "S-4", DCB: "DCB-2" },
        { STRING: "S-5", DCB: null },
      ],
    };
    const lleno = forwardFill(sheet, ["DCB"]);
    expect(lleno.rows.map((r) => r.DCB)).toEqual(["DCB-1", "DCB-1", "DCB-1", "DCB-2", "DCB-2"]);
  });

  it("saltea filas sin etiqueta o sin tracker", () => {
    const sheet = {
      name: "s", headers: ["STRING", "TRACKER"],
      rows: [
        { STRING: "S-1.2.15.1", TRACKER: "05-001" },
        { STRING: "", TRACKER: "05-002" },
        { STRING: "S-1.2.15.2", TRACKER: "" },
      ],
    };
    expect(readEntries(sheet, { label: "STRING", tracker: "TRACKER" })).toHaveLength(1);
  });
});

describe("el numero de string dentro de la etiqueta", () => {
  it("saca los campos numericos en orden", () => {
    expect(numericFields("S-1.2.15.2.4")).toEqual([1, 2, 15, 2, 4]);
    expect(numericFields("STR-07-B-3")).toEqual([7, 3]);
  });

  // No se adivina cual campo es el numero de string: se describen todos para
  // que la persona lo elija viendo los valores que toma cada uno.
  it("describe cada campo para poder elegir", () => {
    const d = describeFields(["S-1.2.15.1", "S-1.2.15.2", "S-1.2.16.1", "S-1.2.16.2"]);
    expect(d).toHaveLength(4);
    expect(d[0]!.distintos).toBe(1);        // el bloque, siempre 1
    expect(d[2]!.ejemplos).toEqual([15, 16]); // la caja
    expect(d[3]!.ejemplos).toEqual([1, 2]);   // el string
  });
});

// ---------------------------------------------------------------------------
// El caso que rompio el import real de Edenvale: la lista de strings escribe
// bloque, tracker y fila todo junto ("01-034-R2") mientras la geometria los
// tiene en columnas separadas, y ademas la fila como motorizada/esclava porque
// su columna era una bandera si/no. Sin partir las dos referencias igual, de
// 13496 strings cruzaban 429.
// ---------------------------------------------------------------------------

describe("como se lee una referencia a un tracker", () => {
  it("parte la forma compuesta de la lista de strings", () => {
    expect(parseTrackerRef("01-034-R2")).toEqual({ block: "1", tracker: "34", row: "R2" });
    expect(parseTrackerRef("01-035-R4")).toEqual({ block: "1", tracker: "35", row: "R4" });
  });

  it("no confunde el numero de la fila con el del tracker", () => {
    // El bug: el ultimo grupo de digitos de "01-034-R2" es el 2 de R2.
    expect(parseTrackerRef("01-034-R2").tracker).toBe("34");
  });

  it("acepta las otras formas de escribir la fila", () => {
    expect(parseTrackerRef("01-034 ROW 3").row).toBe("R3");
    expect(parseTrackerRef("01-034_r3").row).toBe("R3");
  });

  it("toma el bloque de su columna cuando viene aparte", () => {
    expect(parseTrackerRef("34", "24")).toEqual({ block: "24", tracker: "34" });
    expect(parseTrackerRef("034")).toEqual({ tracker: "34" });
  });
});

describe("nombres de fila", () => {
  // Sigue sirviendo para un parque donde las etiquetas SI se repiten en cada
  // tracker y una lista fija las une. En Edenvale no es el caso: la numeracion
  // corre de corrido por bloque, y por eso ese perfil no lleva estas listas.
  const listas = { motorized: ["R1", "R2", "R4"], slave: ["R3", "R5"] };

  it("traduce R2/R3 a motorizada/esclava cuando el perfil declara las listas", () => {
    expect(canonRow("R2", listas)).toBe("motorizada");
    expect(canonRow("R1", listas)).toBe("motorizada");
    expect(canonRow("R3", listas)).toBe("esclava");
    expect(canonRow("R5", listas)).toBe("esclava");
  });

  it("deja pasar lo que ya viene en el vocabulario de la geometria", () => {
    expect(canonRow("motorizada", listas)).toBe("motorizada");
    expect(canonRow("Esclava")).toBe("esclava");
  });

  // Edenvale no puede usar listas: R2 es del tracker 34 y R4 del 35.
  it("el perfil de Edenvale declara el orden, no listas de R", () => {
    expect(profile.topology.rowNaming?.motorized).toBeUndefined();
    expect(profile.topology.rowNaming?.orderWithinTracker).toBe("lowest-first");
  });

  it("sin perfil que lo declare, no inventa la equivalencia", () => {
    expect(canonRow("R2")).toBe("r2");
  });
});

describe("matcheo contra la geometria", () => {
  const rows = [fila("05-001", -27.4, 152.7), fila("05-002", -27.4, 152.7001)];

  it("matchea aunque el archivo escriba el tracker distinto", () => {
    const entries: StringEntry[] = [
      { label: "S-1.2.15.1", tracker: "05-001", dcBox: "DCB-1.2.15" },
      { label: "S-1.2.15.2", tracker: "05-001", dcBox: "DCB-1.2.15" },
      { label: "S-1.2.16.1", tracker: "05-002", dcBox: "DCB-1.2.16" },
    ];
    const { byRow, report } = matchEntries(entries, rows);
    expect(report.matched).toBe(3);
    expect(byRow.get("05-001")!.labels).toHaveLength(2);
    expect(byRow.get("05-001")!.dcBox).toBe("DCB-1.2.15");
  });

  // Lo que hace usable el import: decir sobre cuanto trabajo y con que falla.
  it("informa lo que no matcheo, con ejemplos", () => {
    const { report } = matchEntries(
      [
        { label: "S-1", tracker: "05-001" },
        { label: "S-2", tracker: "99-999" },
        { label: "S-3", tracker: "88-888" },
      ],
      rows,
    );
    expect(report.matched).toBe(1);
    expect(report.total).toBe(3);
    expect(report.unmatchedExamples.length).toBeGreaterThan(0);
    expect(report.unmatchedExamples[0]).toContain("99-999");
  });

  // El caso real de Edenvale, de punta a punta.
  it("cruza la lista compuesta contra la geometria de bandera si/no", () => {
    const listas = { motorized: ["R1", "R2", "R4"], slave: ["R3", "R5"] };
    const edenvale: TrackerRow[] = [
      { block: "1", tracker: "34", row: "motorizada" },
      { block: "1", tracker: "34", row: "esclava" },
      { block: "1", tracker: "35", row: "motorizada" },
    ].map((r, i) =>
      makeRow(
        {
          id: `${r.block}-${r.tracker}-${r.row}`,
          block: r.block, tracker: r.tracker, row: r.row,
          anchor: { lat: -27.4, lon: 152.7 + i * 0.00006 },
          azimuthDeg: 180, side: "north",
        },
        profile,
      ),
    );

    const entries: StringEntry[] = [
      { label: "S-1.1.1.2.1", tracker: "01-034-R2", dcBox: "DCB-1.1.1" },
      { label: "S-1.1.1.2.2", tracker: "01-034-R2", dcBox: "DCB-1.1.1" },
      { label: "S-1.1.1.3.1", tracker: "01-034-R3", dcBox: "DCB-1.1.1" },
      { label: "S-1.1.2.1.1", tracker: "01-035-R4", dcBox: "DCB-1.1.2" },
    ];

    const { byRow, report } = matchEntries(entries, edenvale, { naming: listas });

    expect(report.matched).toBe(4);
    expect(report.strategy).toBe("bloque + tracker + fila");
    expect(byRow.get("1-34-motorizada")!.labels).toEqual(["S-1.1.1.2.1", "S-1.1.1.2.2"]);
    expect(byRow.get("1-34-esclava")!.labels).toEqual(["S-1.1.1.3.1"]);
    expect(byRow.get("1-35-motorizada")!.dcBox).toBe("DCB-1.1.2");
  });

  // El caso de verdad: los numeros de fila corren de corrido por el bloque
  // (tracker 33 → R1, tracker 34 → R2 y R3, tracker 35 → R4 y R5), asi que
  // ninguna lista de R fijas puede unirlos con motorizada/esclava. Lo que se
  // conserva es el ORDEN adentro del tracker, y con eso alcanza.
  it("empareja por orden cuando los dos lados no comparten vocabulario", () => {
    const edenvale = [
      { block: "1", tracker: "33", row: "motorizada" },
      { block: "1", tracker: "34", row: "motorizada" },
      { block: "1", tracker: "34", row: "esclava" },
      { block: "1", tracker: "35", row: "motorizada" },
      { block: "1", tracker: "35", row: "esclava" },
    ].map((r, i) =>
      makeRow(
        {
          id: `${r.block}-${r.tracker}-${r.row}`,
          block: r.block, tracker: r.tracker, row: r.row,
          anchor: { lat: -27.4, lon: 152.7 + i * 0.00006 }, azimuthDeg: 180,
        },
        profile,
      ),
    );

    const entries: StringEntry[] = [
      { label: "S-1.1.1.1.1", tracker: "01-033-R1" },
      { label: "S-1.1.1.2.1", tracker: "01-034-R2" },
      { label: "S-1.1.1.3.1", tracker: "01-034-R3" },
      { label: "S-1.1.2.1.1", tracker: "01-035-R4" },
      { label: "S-1.1.2.2.1", tracker: "01-035-R5" },
    ];

    // Sin ninguna lista de nombres: solo el orden.
    const { byRow, report } = matchEntries(entries, edenvale);

    expect(report.matched).toBe(5);
    expect(report.strategy).toMatch(/orden de fila/);
    expect(byRow.get("1-33-motorizada")!.labels).toEqual(["S-1.1.1.1.1"]);
    expect(byRow.get("1-34-motorizada")!.labels).toEqual(["S-1.1.1.2.1"]); // R2, la mas baja
    expect(byRow.get("1-34-esclava")!.labels).toEqual(["S-1.1.1.3.1"]);    // R3, la mas alta
    expect(byRow.get("1-35-motorizada")!.labels).toEqual(["S-1.1.2.1.1"]); // R4
    expect(byRow.get("1-35-esclava")!.labels).toEqual(["S-1.1.2.2.1"]);    // R5
  });

  it("se puede dar vuelta si en el parque la motorizada es la de arriba", () => {
    const rows2 = ["motorizada", "esclava"].map((row, i) =>
      makeRow(
        { id: `1-34-${row}`, block: "1", tracker: "34", row,
          anchor: { lat: -27.4, lon: 152.7 + i * 0.00006 }, azimuthDeg: 180 },
        profile,
      ),
    );
    const entries: StringEntry[] = [
      { label: "S-a", tracker: "01-034-R2" },
      { label: "S-b", tracker: "01-034-R3" },
    ];

    const { byRow } = matchEntries(entries, rows2, {
      naming: { orderWithinTracker: "highest-first" },
    });
    expect(byRow.get("1-34-motorizada")!.labels).toEqual(["S-b"]); // R3
    expect(byRow.get("1-34-esclava")!.labels).toEqual(["S-a"]);    // R2
  });

  // No inventa correspondencias: si las cantidades no cierran, no empareja.
  it("no empareja un tracker donde las cantidades no coinciden", () => {
    const rows2 = ["motorizada", "esclava"].map((row, i) =>
      makeRow(
        { id: `1-34-${row}`, block: "1", tracker: "34", row,
          anchor: { lat: -27.4, lon: 152.7 + i * 0.00006 }, azimuthDeg: 180 },
        profile,
      ),
    );
    const { report } = matchEntries(
      [
        { label: "S-a", tracker: "01-034-R2" },
        { label: "S-b", tracker: "01-034-R3" },
        { label: "S-c", tracker: "01-034-R7" }, // una fila de mas
      ],
      rows2,
    );
    expect(report.matched).toBe(0);
    expect(report.unmatchedExamples.length).toBeGreaterThan(0);
  });

  // El diagnostico que hubiera hecho obvio el problema en un minuto en vez de
  // en una tarde: mostrar como quedo entendida cada referencia de los dos lados.
  it("muestra como entendio cada lado", () => {
    const rows2 = [
      makeRow(
        { id: "1-34-motorizada", block: "1", tracker: "34", row: "motorizada",
          anchor: { lat: -27.4, lon: 152.7 }, azimuthDeg: 180 },
        profile,
      ),
    ];
    const { report } = matchEntries(
      [{ label: "S-1.1.1.2.1", tracker: "01-034-R2" }],
      rows2,
      { naming: { motorized: ["R2"], slave: ["R3"] } },
    );
    expect(report.preview[0]!.entendido).toContain("tracker 34");
    expect(report.preview[0]!.entendido).toContain("motorizada");
    expect(report.preview[0]!.geometria).toContain("motorizada");
  });
});

// ---------------------------------------------------------------------------

describe("lineas electricas: cadena contra paralelas", () => {
  const byRowDe = (ids: string[], dcBox: string) =>
    new Map(ids.map((id) => [id, { labels: [`S-${id}`], dcBox }]));

  it("detecta trackers en cadena, uno atras del otro", () => {
    // Tres filas sobre el mismo meridiano, corridas una tras otra hacia el sur.
    const rows = [0, 1, 2].map((i) =>
      fila(`t${i}`, -27.4 - (i * (LEN + 2)) / M_LAT, 152.7),
    );
    const { chains, reports } = deriveChains(rows, byRowDe(["t0", "t1", "t2"], "DCB-1"));

    expect(reports[0]!.forma).toBe("cadena");
    expect(chains.get("t0")).toEqual({ pos: 3, posTotal: 3 });
    expect(chains.get("t2")).toEqual({ pos: 1, posTotal: 3 });
    expect(reports[0]!.detail).toMatch(/cuenta invertido/);
  });

  it("detecta trackers en paralelo, uno al lado del otro", () => {
    // Cuatro filas a la misma latitud, separadas al este: cada una su linea.
    const rows = [0, 1, 2, 3].map((i) => fila(`p${i}`, -27.4, 152.7 + i * 0.00006));
    const { chains, reports } = deriveChains(rows, byRowDe(["p0", "p1", "p2", "p3"], "DCB-2"));

    expect(reports[0]!.forma).toBe("paralelas");
    expect(reports[0]!.detail).toMatch(/ninguno invierte/);
    for (const id of ["p0", "p1", "p2", "p3"]) {
      expect(chains.get(id)).toEqual({ pos: 1, posTotal: 1 });
    }
  });

  it("un tracker solo en su caja no invierte", () => {
    const rows = [fila("solo", -27.4, 152.7)];
    const { chains, reports } = deriveChains(rows, byRowDe(["solo"], "DCB-3"));
    expect(chains.get("solo")).toEqual({ pos: 1, posTotal: 1 });
    expect(reports[0]!.forma).toBe("cadena");
  });

  it("resuelve cada caja por separado", () => {
    const rows = [
      ...[0, 1].map((i) => fila(`a${i}`, -27.4 - (i * (LEN + 2)) / M_LAT, 152.7)),
      ...[0, 1, 2].map((i) => fila(`b${i}`, -27.41, 152.7 + i * 0.00006)),
    ];
    const byRow = new Map([
      ...byRowDe(["a0", "a1"], "DCB-A"),
      ...byRowDe(["b0", "b1", "b2"], "DCB-B"),
    ]);
    const { reports } = deriveChains(rows, byRow);
    expect(reports.map((r) => `${r.dcBox}:${r.forma}`)).toEqual(["DCB-A:cadena", "DCB-B:paralelas"]);
  });
});

// ---------------------------------------------------------------------------

describe("aplicacion sobre la geometria", () => {
  it("deja numeros, etiquetas y posicion en la linea", () => {
    const rows = [fila("05-001", -27.4, 152.7)];
    const byRow = new Map([
      ["05-001", { labels: ["S-1.2.15.2", "S-1.2.15.1"], dcBox: "DCB-1.2.15" }],
    ]);
    const chains = new Map([["05-001", { pos: 1, posTotal: 3 }]]);
    const out = applyStrings(rows, { fieldIndex: 3, byRow, chains });

    // Ordenados por el campo elegido: el menor es el mas cercano a la caja DC.
    expect(out[0]!.stringNumbers).toEqual([1, 2]);
    expect(out[0]!.stringLabels).toEqual(["S-1.2.15.1", "S-1.2.15.2"]);
    expect(out[0]!.pos).toBe(1);
    expect(out[0]!.posTotal).toBe(3);
  });

  // La prueba de que sirve: con la lista aplicada, el motor devuelve la
  // etiqueta real del cliente y deja de asumir que no invierte.
  it("el motor devuelve la etiqueta real y resuelve la inversion", () => {
    const row = makeRow(
      {
        id: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
        anchor: { lat: -27.4, lon: 152.7 }, azimuthDeg: 180, side: "north",
      },
      profile,
    );
    const conStrings = applyStrings([row], {
      fieldIndex: 3,
      byRow: new Map([["05-042-R1", { labels: ["S-1.2.15.6", "S-1.2.15.5"], dcBox: "DCB-1.2.15" }]]),
      chains: new Map([["05-042-R1", { pos: 1, posTotal: 3 }]]),
    });

    const farm = compileFarm(profile, conStrings);
    expect(farm.rows[0]!.strategyWarnings).toEqual([]); // ya no falta ningun dato

    // La punta mas lejana: string alto, invertido, modulo 1.
    const best = locate({ ...pointAtSlot(row, 1, profile), accuracyM: 0.5 }, farm).best!;
    expect(best.stringNumber).toBe(6);
    expect(best.stringLabel).toBe("S-1.2.15.6");
    expect(best.module).toBe(1);
    expect(best.countedFrom).toBe("far-end");

    // Y pegado a la caja: string bajo, sin invertir.
    const cerca = locate({ ...pointAtSlot(row, 56, profile), accuracyM: 0.5 }, farm).best!;
    expect(cerca.stringLabel).toBe("S-1.2.15.5");
    expect(cerca.module).toBe(1);
    expect(cerca.countedFrom).toBe("near-dc");
  });
});
