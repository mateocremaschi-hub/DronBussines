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
  describeFields,
  deriveChains,
  forwardFill,
  matchEntries,
  numericFields,
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
