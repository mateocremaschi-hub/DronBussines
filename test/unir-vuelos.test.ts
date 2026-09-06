/**
 * Cargar el vuelo por partes.
 *
 * Un parque de cuatro bloques son dos mil fotos y no entran de una: se cargan
 * por tandas, y antes cada carga pisaba la anterior — el Excel que salia de
 * ahi era el de la ultima tanda. Ahora se juntan los resultados.
 */
import { describe, expect, it } from "vitest";
import { unirVuelos, type ResultadoDeVuelo } from "../app/vuelo";
import type { Muestra } from "../app/detect";

const muestra = (rowId: string, pos: number, celsius: number, d: number): Muestra => ({
  modulo: {
    rowId, block: rowId.split("-")[0]!, tracker: rowId, positionInRow: pos, module: pos,
    stringNumber: 1, chunkIndex: 0, x: 0, y: 0,
  } as Muestra["modulo"],
  celsius, pixeles: 40, fileName: `f${pos}.JPG`, distanciaAlCentroM: d,
});

const vuelo = (ms: Muestra[], extra: Partial<ResultadoDeVuelo> = {}): ResultadoDeVuelo => ({
  muestras: ms, camera: null, gsdCm: 5, fotosTermicas: ms.length, soloEnElBorde: 0,
  repetibilidad: null, posesSupuestas: [], anguloMedio: null, problemas: [],
  alineaciones: [], auditoria: [], corregidoPorFila: new Map(), fixes: new Map(), ...extra,
});

describe("juntar dos cargas del mismo vuelo", () => {
  it("suma los modulos de las dos tandas", () => {
    const a = vuelo([muestra("1-1", 1, 40, 5), muestra("1-1", 2, 41, 5)]);
    const b = vuelo([muestra("2-1", 1, 42, 5)]);
    const u = unirVuelos(a, b);
    expect(u.muestras).toHaveLength(3);
    expect(u.fotosTermicas).toBe(3);
  });

  /*
    El mismo modulo en las dos tandas: gana el que lo vio mas cerca del centro
    del cuadro, y la otra medicion viaja como `otrasC` — es la prueba de que lo
    que se midio es del panel y no de la foto.
  */
  it("un modulo repetido se queda con la medicion mas centrada, y guarda la otra", () => {
    const a = vuelo([muestra("1-1", 1, 55, 9)]);
    const b = vuelo([muestra("1-1", 1, 40, 2)]);
    const u = unirVuelos(a, b);
    expect(u.muestras).toHaveLength(1);
    expect(u.muestras[0]!.celsius).toBe(40);
    expect(u.muestras[0]!.otrasC).toEqual([55]);
  });

  it("la auditoria de un bloque que sale en las dos cargas se suma, y la lisura se pondera", () => {
    const a = vuelo([], { auditoria: [{ block: "1", fotos: 10, medidas: 100, lisuraMedia: 1, bajo90: 0, descartadas: 5 }] });
    const b = vuelo([], { auditoria: [{ block: "1", fotos: 5, medidas: 100, lisuraMedia: 0.8, bajo90: 4, descartadas: 1 }] });
    const t = unirVuelos(a, b).auditoria[0]!;
    expect(t.medidas).toBe(200);
    expect(t.fotos).toBe(15);
    expect(t.descartadas).toBe(6);
    expect(t.lisuraMedia).toBeCloseTo(0.9, 6);
  });

  /*
    El numero de modulo de una fila se cuenta desde su punta, y cada carga
    cuenta con las puntas que vio. Una fila partida entre dos cargas puede
    quedar con dos numeraciones, y eso hay que decirlo.
  */
  it("avisa si una fila salio en las dos cargas", () => {
    const a = vuelo([], { corregidoPorFila: new Map([["fa|1-7", { modulos: 0.3, conFinal: true }]]) });
    const b = vuelo([], { corregidoPorFila: new Map([["fb|1-7", { modulos: 0.4, conFinal: false }]]) });
    expect(unirVuelos(a, b).problemas.some((p) => /mas de una carga/.test(p))).toBe(true);
  });

  it("con una sola carga no avisa nada nuevo", () => {
    const a = vuelo([], { corregidoPorFila: new Map([["fa|1-7", { modulos: 0.3, conFinal: true }]]) });
    const b = vuelo([], { corregidoPorFila: new Map([["fb|1-9", { modulos: 0.4, conFinal: true }]]) });
    expect(unirVuelos(a, b).problemas).toEqual([]);
  });

  it("la primera carga entra tal cual", () => {
    const b = vuelo([muestra("1-1", 1, 40, 5)]);
    expect(unirVuelos(null, b)).toBe(b);
  });
});

/*
  El anclaje de una fila vale para las dos tandas.

  Los bloques se pisan en los bordes, asi que muchas filas salen en las dos
  cargas. A Mateo le paso con la 2-25-esclava: once fotos la anclaron y el
  hallazgo salio igual como "modulo sin confirmar", solo porque cargo el vuelo
  en dos partes. El mismo vuelo daba dos respuestas distintas segun como se
  hubiera cargado.
*/
describe("el anclaje de una fila al fusionar", () => {
  const con = (pares: Array<[string, boolean]>): ResultadoDeVuelo =>
    vuelo([], {
      corregidoPorFila: new Map(pares.map(([k, conFinal]) => [k, { modulos: 0.9, conFinal }])),
    });

  it("una fila anclada en la segunda tanda queda anclada en la primera", () => {
    const r = unirVuelos(
      con([["A.JPG|2-25-esclava", false]]),
      con([["B.JPG|2-25-esclava", true]]),
    );
    expect(r.corregidoPorFila.get("A.JPG|2-25-esclava")?.conFinal).toBe(true);
    expect(r.corregidoPorFila.get("B.JPG|2-25-esclava")?.conFinal).toBe(true);
  });

  it("y al reves: la primera ancla, la segunda hereda", () => {
    const r = unirVuelos(
      con([["A.JPG|2-25-esclava", true]]),
      con([["B.JPG|2-25-esclava", false]]),
    );
    expect(r.corregidoPorFila.get("B.JPG|2-25-esclava")?.conFinal).toBe(true);
  });

  it("una fila que nadie anclo sigue sin anclar", () => {
    const r = unirVuelos(
      con([["A.JPG|1-9-esclava", false]]),
      con([["B.JPG|1-9-esclava", false]]),
    );
    expect(r.corregidoPorFila.get("A.JPG|1-9-esclava")?.conFinal).toBe(false);
  });

  it("el anclaje no se contagia entre filas distintas", () => {
    const r = unirVuelos(
      con([["A.JPG|2-25-esclava", true]]),
      con([["B.JPG|2-85-motorizada", false]]),
    );
    expect(r.corregidoPorFila.get("B.JPG|2-85-motorizada")?.conFinal).toBe(false);
  });

  it("no toca el corrimiento medido de cada foto", () => {
    const r = unirVuelos(
      con([["A.JPG|2-25-esclava", false]]),
      con([["B.JPG|2-25-esclava", true]]),
    );
    expect(r.corregidoPorFila.get("A.JPG|2-25-esclava")?.modulos).toBe(0.9);
  });
});
