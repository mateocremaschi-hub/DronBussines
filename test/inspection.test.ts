/**
 * El lote de vuelo: resumen, clasificacion y export.
 *
 * La parte de leer el EXIF necesita un navegador y se prueba a mano; lo que se
 * testea aca es lo que decide que sale en el entregable, que es donde un error
 * se le escapa a cualquiera revisando 400 hallazgos en pantalla.
 */

import { describe, expect, it } from "vitest";
import { summarize, toCsv, type Finding, type Inspection } from "../app/inspection";
import type { Address } from "../src/types.js";

const dir = (over: Partial<Address> = {}): Address => ({
  rowId: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
  chunkIndex: 0, stringNumber: 1, module: 7, countedFrom: "near-dc", positionInRow: 7,
  center: { lat: -27.4, lon: 152.7 }, distanceM: 0.4, offAxisM: 0.3, confidence: 0.42,
  ...over,
});

const hallazgo = (over: Partial<Finding> = {}): Finding => ({
  id: Math.random().toString(36).slice(2),
  fileName: "DJI_0001.JPG",
  fix: { fileName: "DJI_0001.JPG", lat: -27.4, lon: 152.7 },
  address: dir(),
  candidates: [dir()],
  warnings: [],
  status: "pendiente",
  ...over,
});

describe("resumen", () => {
  it("cuenta estados, clases, bloques y los que no se pudieron ubicar", () => {
    const s = summarize([
      hallazgo({ status: "confirmado", klass: 3 }),
      hallazgo({ status: "confirmado", klass: 2, address: dir({ block: "07" }) }),
      hallazgo({ status: "descartado" }),
      hallazgo(),
      hallazgo({ address: null, candidates: [] }),
    ]);

    expect(s.total).toBe(5);
    expect(s.confirmados).toBe(2);
    expect(s.descartados).toBe(1);
    expect(s.pendientes).toBe(2);
    expect(s.sinUbicar).toBe(1);
    expect(s.porClase[3]).toBe(1);
    expect(s.porClase[2]).toBe(1);
    expect(s.bloques).toBe(2);
  });

  it("un lote vacio no rompe", () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.bloques).toBe(0);
    expect(s.porClase[1]).toBe(0);
  });
});

describe("export CSV", () => {
  const insp = (findings: Finding[]): Inspection => ({
    id: "i1", farmId: "edenvale", farmName: "Edenvale", name: "Vuelo 1",
    createdAt: "2026-08-21T00:00:00.000Z", conditions: {}, findings,
  });

  it("saca los descartados y deja los demas", () => {
    const csv = toCsv(insp([
      hallazgo({ fileName: "a.jpg", status: "confirmado" }),
      hallazgo({ fileName: "b.jpg", status: "descartado" }),
      hallazgo({ fileName: "c.jpg" }),
    ]));
    const lineas = csv.trim().split("\n");
    expect(lineas).toHaveLength(3); // encabezado + 2
    expect(csv).toContain("a.jpg");
    expect(csv).not.toContain("b.jpg");
  });

  it("escribe la direccion en columnas separadas, no en un texto", () => {
    const csv = toCsv(insp([hallazgo({ address: dir({ module: 23, countedFrom: "far-end" }) })]));
    const fila = csv.trim().split("\n")[1]!.split(",");
    expect(fila[5]).toBe("05");        // bloque
    expect(fila[6]).toBe("05-042");    // tracker
    expect(fila[9]).toBe("23");        // modulo
    expect(fila[10]).toBe("punta lejana");
  });

  it("un hallazgo sin ubicar sale igual, con las columnas vacias", () => {
    const csv = toCsv(insp([hallazgo({ address: null, candidates: [] })]));
    const fila = csv.trim().split("\n")[1]!.split(",");
    expect(fila[0]).toBe("DJI_0001.JPG");
    expect(fila[5]).toBe(""); // sin bloque
    expect(fila[9]).toBe(""); // sin modulo
  });

  // Si el tecnico corrige el modulo mirando la foto, tiene que quedar aparte
  // del que calculo la app. Pisarlo seria borrar de donde salio cada numero.
  it("guarda el modulo corregido sin pisar el calculado", () => {
    const csv = toCsv(insp([hallazgo({ address: dir({ module: 7 }), moduleCorregido: 9 })]));
    const fila = csv.trim().split("\n")[1]!.split(",");
    expect(fila[9]).toBe("7");
    expect(fila[11]).toBe("9");
  });

  it("escapa comas y comillas de las notas", () => {
    const csv = toCsv(insp([hallazgo({ note: 'vidrio roto, esquina "sur"' })]));
    expect(csv).toContain('"vidrio roto, esquina ""sur"""');
    // Y no rompe la cantidad de columnas.
    expect(csv.trim().split("\n")).toHaveLength(2);
  });

  it("arrastra los avisos del motor al entregable", () => {
    const csv = toCsv(insp([
      hallazgo({ warnings: [{ code: "low-confidence", message: "x" }, { code: "ambiguous", message: "y" }] }),
    ]));
    expect(csv).toContain("low-confidence ambiguous");
  });
});
