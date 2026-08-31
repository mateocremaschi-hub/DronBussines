/**
 * Llegar a un parque que no es Edenvale y que las coordenadas entren bien.
 *
 * Este archivo cubre la familia de errores mas cara que tiene la app: los que
 * NO fallan. Con el sistema de coordenadas mal elegido las filas siguen
 * midiendo 65 m, el dibujo del parque sale con la forma correcta, el cuadre
 * cierra y el aviso de largo no salta — porque el marco local se arma sobre el
 * propio parque, asi que ponerlo en otro continente no cambia ninguna
 * distancia interna.
 *
 * El unico sintoma aparecia parado en el campo, a un viaje de distancia.
 */

import { describe, expect, it } from "vitest";
import { buildRows, detectarCrs, toNumber, type Mapping, type Sheet } from "../app/ingest";

const hoja = (filas: Array<Record<string, unknown>>): Sheet => ({
  name: "DATA",
  headers: Object.keys(filas[0] ?? {}),
  rows: filas,
});

const MAPEO: Mapping = {
  block: "B", tracker: "T", startY: "Y1", startX: "X1", endY: "Y2", endX: "X2",
};

// ---------------------------------------------------------------------------

describe("la coma decimal europea", () => {
  /**
   * Una coordenada al milimetro escrita a la europea tiene exactamente tres
   * decimales. Se tomaban por separador de miles y quedaba x1000 — y con los
   * valores inflados la deteccion decia "esto es UTM" y todo seguia sin quejas.
   */
  it("no multiplica por mil una coordenada de tres decimales", () => {
    expect(toNumber("512345,678")).toBeCloseTo(512345.678, 6);
    expect(toNumber("4520123,456")).toBeCloseTo(4520123.456, 6);
    expect(toNumber("41,123")).toBeCloseTo(41.123, 9);
  });

  it("y sigue entendiendo los separadores de miles de verdad", () => {
    expect(toNumber("1,234,567")).toBe(1234567);
    expect(toNumber("1.234.567")).toBe(1234567);
    expect(toNumber("1.234,56")).toBeCloseTo(1234.56, 6);
  });
});

// ---------------------------------------------------------------------------

describe("que sistema de coordenadas trae el archivo", () => {
  it("grados es la unica respuesta que se puede dar sola", () => {
    const d = detectarCrs([{ x: 150.58, y: -26.9 }, { x: 150.59, y: -26.91 }]);
    expect(d.crs.type).toBe("wgs84");
    expect(d.seguro).toBe(true);
    expect(d.aConfirmar).toEqual([]);
  });

  /**
   * La zona no viaja en la coordenada: un easting de 470.341 existe en las 60.
   * Antes se devolvia 56 —la de Edenvale— y un parque espanol entraba corrido
   * 156 grados de longitud sin un solo sintoma.
   */
  it("con UTM no inventa la zona: la deja en cero para que la escriban", () => {
    const d = detectarCrs([{ x: 470341, y: 6969224 }, { x: 470347, y: 6969159 }]);
    expect(d.crs.type).toBe("utm");
    if (d.crs.type !== "utm") return;
    expect(d.crs.zone, "no puede proponer una zona: no esta en el archivo").toBe(0);
    expect(d.seguro).toBe(false);
    expect(d.aConfirmar.join(" ")).toMatch(/zona/i);
  });

  /**
   * El hemisferio tampoco se puede deducir. Un northing de 5.098.424 es lat
   * 46,0 N o lat -44,2 S, las dos validas. La regla vieja lo daba por seguro.
   */
  it("y avisa que el hemisferio tampoco sale de los numeros", () => {
    const d = detectarCrs([{ x: 500000, y: 5098424 }]);
    expect(d.seguro).toBe(false);
    expect(d.aConfirmar.join(" ")).toMatch(/hemisferio/i);
  });
});

// ---------------------------------------------------------------------------

describe("las coordenadas construidas tienen que ser coordenadas", () => {
  it("marca una latitud imposible en vez de construir la fila y callarse", () => {
    const b = buildRows(
      hoja([{ B: "1", T: "1", Y1: 152.7, X1: -27.4, Y2: 152.71, X2: -27.4 }]),
      MAPEO, { type: "wgs84" },
    );
    expect(b.rows).toHaveLength(1);   // no se niega a trabajar…
    expect(b.sospechas.join(" ")).toMatch(/imposible|dadas vuelta|cambiadas/i);  // …pero lo dice
  });

  /**
   * El caso que ninguna otra cosa puede detectar: en Espana, Chile o Italia
   * |lat| y |lon| son los dos <= 90, asi que darlas vuelta produce un punto
   * perfectamente valido en otro continente.
   */
  it("avisa cuando latitud y longitud dadas vuelta serian indistinguibles", () => {
    const b = buildRows(
      hoja([
        { B: "1", T: "1", Y1: 41.5, X1: -4.5, Y2: 41.5006, X2: -4.5 },
        { B: "1", T: "2", Y1: 41.5, X1: -4.4994, Y2: 41.5006, X2: -4.4994 },
      ]),
      MAPEO, { type: "wgs84" },
    );
    expect(b.rows).toHaveLength(2);
    expect(b.sospechas.join(" ")).toMatch(/dadas vuelta/i);
  });

  it("un parque de verdad no dispara ninguna sospecha", () => {
    const b = buildRows(
      hoja([
        { B: "1", T: "1", Y1: -26.9, X1: 150.58, Y2: -26.8994, X2: 150.58 },
        { B: "1", T: "2", Y1: -26.9, X1: 150.5801, Y2: -26.8994, X2: 150.5801 },
      ]),
      MAPEO, { type: "wgs84" },
    );
    expect(b.sospechas).toEqual([]);
  });

  it("avisa cuando las filas se extienden mas que cualquier parque", () => {
    const b = buildRows(
      hoja([
        { B: "1", T: "1", Y1: -26.9, X1: 150.58, Y2: -26.8994, X2: 150.58 },
        { B: "1", T: "2", Y1: -26.9, X1: 152.58, Y2: -26.8994, X2: 152.58 },
      ]),
      MAPEO, { type: "wgs84" },
    );
    expect(b.sospechas.join(" ")).toMatch(/km/);
  });
});
