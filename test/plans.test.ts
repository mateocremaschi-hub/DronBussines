/**
 * Cargar los planos en vez de deducir lo que ya esta dibujado.
 *
 * La trampa que se prueba primero, porque casi entra sola: el plano trae un
 * campo `pos` que es el rango FISICO del tracker contando desde la calle, y
 * Pica tiene un `pos` que es la posicion ELECTRICA dentro de la linea — la que
 * decide si el string lejano se cuenta invertido. Mismo nombre, cosas
 * distintas. Copiar una sobre la otra daria un parque entero de conteos
 * invertidos justo en los lugares equivocados, y sin ningun sintoma visible.
 */

import { describe, expect, it } from "vitest";
import type { TrackerRow } from "../src/types.js";
import { aplicarPlano, leerPlano, type PlanoDeParque } from "../app/plans";

/**
 * Una fila como la que arma la importacion de verdad, no una de laboratorio.
 *
 * El detalle que importa es el `id`: se arma con bloque + tracker + fila, y
 * como el tracker YA trae el bloque adentro, queda "04-04-018-R2". Escribirlo
 * a mano como "04-018-R2" hacia que el cruce con el plano pareciera andar
 * cuando en el parque de verdad no cruzaba una sola fila.
 */
const fila = (nombre: string, over: Partial<TrackerRow> = {}): TrackerRow => {
  const [block, tracker, row] = nombre.split("-");
  return {
    id: [block, `${block}-${tracker}`, row].join("-"),
    block: block!, tracker: `${block}-${tracker}`, row: row!,
    start: { lat: -26.9, lon: 150.58 }, end: { lat: -26.8994, lon: 150.58 },
    ...over,
  };
};

const PLANO: PlanoDeParque = {
  "04": {
    trackers: {
      "04-018": { rows: ["R2", "R3"], side: "North", dcbox: "DCB-1.2.15", pos: 3, pos_total: 7 },
      "04-019": { rows: ["R1"], side: "South", dcbox: "DCB-1.2.16", pos: 1, pos_total: 7 },
    },
    dcbox: [{ name: "DCB-1.2.15", x: 10, y: 20 }],
    strings: [{ n: "S-1.2.15.2.4", s: "North", t: "018", r: "R2" }],
    road: 500, axis: "x",
  },
};

// ---------------------------------------------------------------------------

describe("leer el archivo del extractor", () => {
  it("resume lo que trae", () => {
    const r = leerPlano(JSON.stringify(PLANO));
    expect("resumen" in r).toBe(true);
    if (!("resumen" in r)) return;
    expect(r.resumen.bloques).toBe(1);
    expect(r.resumen.trackers).toBe(2);
    expect(r.resumen.cajas).toBe(1);
  });

  it("rechaza un archivo que no es el del extractor, en vez de romperse despues", () => {
    const r = leerPlano(JSON.stringify({ hola: { chau: 1 } }));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/falta la lista de trackers/);
  });

  it("y uno que ni siquiera es JSON", () => {
    const r = leerPlano("<html>");
    expect("error" in r).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("cruzar el plano con la geometria", () => {
  const rows = [fila("04-018-R2"), fila("04-018-R3"), fila("04-019-R1")];

  it("le pone el lado a las dos filas de un tracker doble", () => {
    const a = aplicarPlano(rows, PLANO);
    expect(a.rows.find((r) => r.id === "04-04-018-R2")!.side).toBe("north");
    expect(a.rows.find((r) => r.id === "04-04-018-R3")!.side).toBe("north");
    expect(a.rows.find((r) => r.id === "04-04-019-R1")!.side).toBe("south");
    expect(a.conLado).toBe(3);
  });

  /**
   * La prueba que evita el desastre silencioso. El plano trae pos: 3 y
   * pos_total: 7 para el tracker 018, pero eso es el rango desde la calle.
   * Si se copiara al pos electrico de Pica, la regla del piercing connector
   * invertiria strings en los trackers equivocados y no habria como notarlo.
   */
  it("NO copia el pos del plano al pos electrico de Pica", () => {
    const a = aplicarPlano(rows, PLANO);
    for (const r of a.rows) {
      expect(r.pos, `fila ${r.id}`).toBeUndefined();
      expect(r.posTotal, `fila ${r.id}`).toBeUndefined();
    }
    expect(a.notas.join(" ")).toMatch(/rango fisico desde la calle/);
    expect(a.notas.join(" ")).toMatch(/posicion electrica/);
  });

  it("no pisa el pos electrico que ya tenia una fila", () => {
    const conPos = [fila("04-018-R2", { pos: 2, posTotal: 4 })];
    const a = aplicarPlano(conPos, PLANO);
    expect(a.rows[0]!.pos).toBe(2);
    expect(a.rows[0]!.posTotal).toBe(4);
  });

  // El plano manda sobre una deduccion, pero no en silencio.
  it("lista los desacuerdos en vez de resolverlos calladamente", () => {
    const alReves = [fila("04-018-R2", { side: "south" })];
    const a = aplicarPlano(alReves, PLANO);
    expect(a.rows[0]!.side).toBe("north");
    expect(a.conflictos).toHaveLength(1);
    expect(a.conflictos[0]).toMatchObject({ rowId: "04-04-018-R2", cargado: "south", plano: "north" });
    expect(a.notas.join(" ")).toMatch(/contradice lo que ya estaba/);
  });

  it("avisa de las filas que el plano no menciona", () => {
    const a = aplicarPlano([...rows, fila("09-001-R1")], PLANO);
    expect(a.sinPlano).toEqual(["09-09-001-R1"]);
    expect(a.notas.join(" ")).toMatch(/no aparecen en el plano/);
  });

  it("cuenta las cajas de continua, que es por donde se llega caminando", () => {
    const a = aplicarPlano(rows, PLANO);
    expect(a.conCajaDc).toBe(3);
    expect(a.notas.join(" ")).toMatch(/entrá por la DCB/);
  });

  it("no toca las filas cuando el plano no dice nada de ellas", () => {
    const otras = [fila("77-001-R1", { side: "east" })];
    expect(aplicarPlano(otras, PLANO).rows[0]!.side).toBe("east");
  });
});
