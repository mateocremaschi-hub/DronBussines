/**
 * Los bancos y la calle, leidos del plano en vez de adivinados.
 *
 * La fixture no es inventada: son los 1844 trackers de las 14 laminas de
 * fundaciones de Wellington North que entraron de verdad, con la marca de
 * perimetro que trae cada etiqueta. Si alguien vuelve a "simplificar" el lector
 * tirando ese campo —que es exactamente lo que estaba pasando— estos tests
 * cambian de color.
 */

import { describe, expect, it } from "vitest";
import perimetros from "./fixtures/wellington-perimetros.json" with { type: "json" };
import { analizarEtiqueta, leerPerimetro } from "../app/planpdf";
import { bancosDelBloque, sentidoDesdeElPlano, type TrackerDelPlano } from "../app/bancos";
import type { TrackerRow } from "../src/types.js";

const datos = perimetros as unknown as Record<string, Array<[number, string]>>;

const mapa: Record<string, TrackerDelPlano["perimetro"]> = {
  P1N: "norte", P1S: "sur", C: "centro", P2: "perimetro-2",
};

function delPlano(block: string): TrackerDelPlano[] {
  return datos[block]!.map(([n, p]) => ({
    block, tracker: String(n),
    ...(mapa[p] ? { perimetro: mapa[p]! } : {}),
  }));
}

describe("leer la marca de perimetro de la etiqueta", () => {
  // La leyenda de la lamina, tal cual esta impresa.
  it("entiende lo que dice la leyenda del plano", () => {
    expect(leerPerimetro("P1N")).toBe("norte");
    expect(leerPerimetro("P1S")).toBe("sur");
    expect(leerPerimetro("C")).toBe("centro");
    expect(leerPerimetro("P2")).toBe("perimetro-2");
  });

  it("un parque que no marque nada no se rompe: devuelve nada", () => {
    for (const p of ["L", "S2", "INT", "17", "PX9", ""]) {
      expect(leerPerimetro(p)).toBeUndefined();
    }
  });

  /*
    El bug de origen, escrito como test. El lector tenia un comentario que
    decia "las de atras son codigos de pila" y descartaba este pedazo — con lo
    cual el unico dato del plano que dice donde esta la calle se perdia en el
    parseo.
  */
  it("una etiqueta real de Wellington trae el perimetro, no solo la fila", () => {
    const a = analizarEtiqueta("01-035-INT-R1-C-L-S2")!;
    expect(a).toMatchObject({ tipo: "tracker", bloque: "01", tracker: "35", fila: "R1", perimetro: "centro" });

    expect(analizarEtiqueta("02-065-INT-R1-P1N-L-S2")!.perimetro).toBe("norte");
    expect(analizarEtiqueta("02-049-INT-R1-P1S-L-S1")!.perimetro).toBe("sur");
  });

  it("una etiqueta de Edenvale sigue leyendose igual, sin perimetro", () => {
    const a = analizarEtiqueta("04-017-R3")!;
    expect(a).toMatchObject({ bloque: "04", tracker: "17", fila: "R3" });
    expect(a.perimetro).toBeUndefined();
  });

  it("no confunde el tipo de tracker Long/Short con un perimetro", () => {
    // En "01-035-INT-R1-C-L-S2" el pedazo despues de la fila es C, no L.
    expect(analizarEtiqueta("17-017-EXT-R1-L-S2")!.perimetro).toBeUndefined();
  });
});

describe("los bancos que dice el plano de Wellington North", () => {
  it("las 14 laminas dan tramos en todos los bloques", () => {
    for (const block of Object.keys(datos)) {
      const b = bancosDelBloque(delPlano(block))!;
      expect(b.tramos.length).toBeGreaterThan(1);
    }
  });

  /*
    El numero concreto, para que un cambio se note. El bloque 02 tiene ocho
    bancos y la forma N . . S | N . . . de norte a sur.
  */
  /*
    El numero concreto, para que un cambio se note.

    Cinco tramos y no ocho: los tres bancos centrales comparten la marca C y
    salen como uno solo. Ver `TramoDelPlano` — lo que hace falta no son los
    bancos sino el borde, y el borde sale igual.
  */
  it("el bloque 02 da N . S | N . y la calle cae entre el tramo 3 y el 4", () => {
    const b = bancosDelBloque(delPlano("02"))!;
    expect(b.tramos.map((x: { borde: string }) => x.borde)).toEqual([
      "norte", "centro", "sur", "norte", "centro",
    ]);
    expect(b.calleDespuesDelTramo).toBe(3);
    expect(b.tramos[0]!.trackers).toEqual(
      Array.from({ length: 16 }, (_, i) => String(i + 1)),
    );
    // Los 64 primeros quedan al norte de la calle.
    const alNorte = b.tramos.slice(0, 3).reduce((n: number, t: { trackers: string[] }) => n + t.trackers.length, 0);
    expect(alNorte).toBe(64);
  });

  it("encuentra la calle en la gran mayoria de los bloques, sin una sola coordenada", () => {
    const conCalle = Object.keys(datos)
      .map((b) => bancosDelBloque(delPlano(b))!)
      .filter((b) => b.calleDespuesDelTramo != null);
    // El heuristico de coordenadas resolvia 0 de 52. Esto es lo contrario.
    expect(conCalle.length).toBeGreaterThanOrEqual(12);
  });

  it("dice de donde salio, en vez de pedir que se le crea", () => {
    const b = bancosDelBloque(delPlano("02"))!;
    expect(b.detail).toMatch(/perimetro sur de uno toca el perimetro norte/);
    expect(b.detail).toMatch(/No hace falta deducirla de las coordenadas/);
  });

  it("con dos bordes norte-sur no elige uno: dice que hace falta el plano de interconexion", () => {
    const dosCalles: TrackerDelPlano[] = [
      { block: "99", tracker: "1", perimetro: "norte" },
      { block: "99", tracker: "2", perimetro: "sur" },
      { block: "99", tracker: "3", perimetro: "norte" },
      { block: "99", tracker: "4", perimetro: "sur" },
      { block: "99", tracker: "5", perimetro: "norte" },
    ];
    const b = bancosDelBloque(dosCalles)!;
    expect(b.calleDespuesDelTramo).toBe(null);
    expect(b.motivo).toBe("varias-calles");
    expect(b.detail).toMatch(/plano de interconexion/);
  });

  it("un plano sin marcas no inventa una calle", () => {
    const sinMarca: TrackerDelPlano[] = [1, 2, 3, 4].map((n) => ({ block: "98", tracker: String(n) }));
    const b = bancosDelBloque(sinMarca)!;
    expect(b.calleDespuesDelTramo).toBe(null);
    // Los dos fracasos NO son el mismo: este no tiene arreglo desde el plano,
    // el de varias calles si. Confundirlos manda a hacer el trabajo equivocado.
    expect(b.motivo).toBe("sin-borde");
    expect(b.detail).toMatch(/ningun borde/);
  });

  it("los bloques de Wellington se reparten en los dos motivos, no en uno solo", () => {
    const motivos = Object.keys(datos).map((b) => bancosDelBloque(delPlano(b))!.motivo);
    expect(motivos.filter((m) => m === "una-calle").length).toBeGreaterThanOrEqual(12);
    // El 07 marca dos bordes norte-sur: ese es el caso que se puede cerrar con
    // un solo plano de interconexion, no con conteos de campo.
    expect(motivos).toContain("varias-calles");
  });
});

describe("el sentido de conteo que sale del plano", () => {
  /** Filas norte-sur de 65 m, con las picas cargadas en orden alterno. */
  function filas(block: string, nums: number[]): TrackerRow[] {
    return nums.map((n, i) => {
      const lat = -32.5 + n * 0.0001;
      const sur = { lat, lon: 148.9 };
      const norte = { lat: lat + 0.000586, lon: 148.9 };
      // Mitad al derecho y mitad al reves, como viene un relevamiento real.
      const [start, end] = i % 2 === 0 ? [sur, norte] : [norte, sur];
      return {
        id: `${block}-${n}`, block, tracker: String(n), row: "R1",
        start, end,
      } as unknown as TrackerRow;
    });
  }

  it("los bancos al norte de la calle cuentan desde su punta sur, y al reves", () => {
    const plano = bancosDelBloque(delPlano("02"))!;
    const nums = datos["02"]!.map(([n]) => n);
    const rows = filas("02", nums);

    const { origins, resueltos } = sentidoDesdeElPlano(rows, [plano]);
    expect(resueltos).toEqual(["02"]);
    expect(origins.size).toBe(rows.length);

    // Trackers 1..64 estan al norte de la calle; 65..132 al sur.
    for (const r of rows) {
      const n = Number(r.tracker);
      const punta = origins.get(r.id) === "start" ? r.start : r.end;
      const otra = origins.get(r.id) === "start" ? r.end : r.start;
      if (n <= 64) expect(punta.lat).toBeLessThan(otra.lat);
      else expect(punta.lat).toBeGreaterThan(otra.lat);
    }
  });

  it("el orden de las picas en el archivo no cambia nada", () => {
    const plano = bancosDelBloque(delPlano("02"))!;
    const nums = datos["02"]!.map(([n]) => n);
    const rows = filas("02", nums);
    const dadasVuelta = rows.map((r) => ({ ...r, start: r.end, end: r.start }));

    const a = sentidoDesdeElPlano(rows, [plano]).origins;
    const b = sentidoDesdeElPlano(dadasVuelta, [plano]).origins;
    // La punta ELEGIDA es la misma en el terreno, aunque el nombre cambie.
    for (const r of rows) {
      const puntaA = a.get(r.id) === "start" ? r.start : r.end;
      const rb = dadasVuelta.find((x) => x.id === r.id)!;
      const puntaB = b.get(r.id) === "start" ? rb.start : rb.end;
      expect(puntaB.lat).toBeCloseTo(puntaA.lat, 9);
    }
  });

  it("con las cajas en el borde de afuera se cuenta desde la otra punta", () => {
    const plano = bancosDelBloque(delPlano("02"))!;
    const rows = filas("02", datos["02"]!.map(([n]) => n));
    const centro = sentidoDesdeElPlano(rows, [plano], "center-road").origins;
    const borde = sentidoDesdeElPlano(rows, [plano], "outer-edge").origins;
    for (const r of rows) expect(borde.get(r.id)).not.toBe(centro.get(r.id));
  });

  it("un bloque sin calle en el plano no se resuelve, y se nombra", () => {
    const sinCalleBloque = bancosDelBloque(
      [1, 2, 3].map((n) => ({ block: "98", tracker: String(n) })),
    )!;
    const { origins, sinCalle } = sentidoDesdeElPlano(filas("98", [1, 2, 3]), [sinCalleBloque]);
    expect(origins.size).toBe(0);
    expect(sinCalle).toEqual(["98"]);
  });
});
