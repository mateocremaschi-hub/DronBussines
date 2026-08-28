/**
 * De que punta se cuenta cada fila, sacado del terreno.
 *
 * Esto reemplaza a una cadena de tres pasos —etiqueta cardinal, invertirla,
 * buscar el extremo que apunte para alla— que tenia tres lugares donde se podia
 * dar vuelta un signo. Y se dio vuelta: en el bloque 4 de Edenvale el conteo
 * salia espejado, y arreglarlo requeria ir a contar modulos a cada bloque.
 *
 * La regla nueva no tiene coin flip. La punta que da a la calle del medio es la
 * que cae mas cerca del corte entre los dos grupos de filas, y eso se mide.
 * Sale igual en los 36 bloques sin que nadie camine ninguno.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { deriveOriginEnds, aplicarOrigenes, agruparPorCalle } from "../app/ingest";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;

/**
 * Un bloque como los de verdad: dos rangos de filas enfrentados, con la calle
 * de las cajas de continua en el medio.
 *
 * Las de arriba nacen en la calle y se van al norte; las de abajo nacen en la
 * calle y se van al sur. En los dos casos la punta que da a la calle es la que
 * tiene que ganar.
 */
function bloqueConCalle(block: string, filas = 4): TrackerRow[] {
  const largo = 0.000586; // ~65 m en latitud
  const calle = -26.9;
  const anchoCalle = 0.00008;
  const out: TrackerRow[] = [];

  for (let i = 0; i < filas; i++) {
    const lon = 150.58 + i * 0.00006;
    // Norte: start pegado a la calle, end lejos.
    out.push({
      ...makeRow(
        { id: `${block}-N${i}`, block, tracker: `${block}-N${i}`, anchor: { lat: 0, lon: 0 }, azimuthDeg: 0 },
        profile,
      ),
      id: `${block}-N${i}`, block, tracker: `${block}-N${i}`,
      start: { lat: calle + anchoCalle, lon },
      end: { lat: calle + anchoCalle + largo, lon },
    });
    // Sur: al reves a proposito — start LEJOS de la calle, end pegado.
    // Si la regla mirara el orden de las picas en vez de la geometria, esta
    // fila la sacaria al reves.
    out.push({
      ...makeRow(
        { id: `${block}-S${i}`, block, tracker: `${block}-S${i}`, anchor: { lat: 0, lon: 0 }, azimuthDeg: 0 },
        profile,
      ),
      id: `${block}-S${i}`, block, tracker: `${block}-S${i}`,
      start: { lat: calle - anchoCalle - largo, lon },
      end: { lat: calle - anchoCalle, lon },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("agrupar las filas a los lados de la calle", () => {
  it("encuentra los dos grupos y donde cae la calle", () => {
    const g = agruparPorCalle(bloqueConCalle("04"));
    expect(g.status).toBe("ok");
    expect(g.lower).toHaveLength(4);
    expect(g.upper).toHaveLength(4);
    expect(g.corte).toBeDefined();
  });
});

describe("de que punta se cuenta", () => {
  const rows = bloqueConCalle("04");

  it("resuelve todas las filas sin que nadie vaya al campo", () => {
    const d = deriveOriginEnds(rows);
    expect(d.origins.size).toBe(rows.length);
    expect(d.blocks[0]!.status).toBe("ok");
  });

  /**
   * La prueba que importa: las filas del sur estan cargadas con las picas al
   * reves. Si la regla mirara el orden de start/end en vez de la geometria,
   * las sacaria espejadas — que es exactamente el bug que se esta arreglando.
   */
  it("gana la punta que da a la calle, no la que figura primero en el archivo", () => {
    const d = deriveOriginEnds(rows);
    for (const r of rows) {
      const esperado = r.id.includes("N") ? "start" : "end";
      expect(d.origins.get(r.id), `fila ${r.id}`).toBe(esperado);
    }
  });

  it("con las cajas en el borde de afuera, se cuenta desde la otra punta", () => {
    const centro = deriveOriginEnds(rows, "center-road");
    const borde = deriveOriginEnds(rows, "outer-edge");
    for (const r of rows) {
      expect(borde.origins.get(r.id)).not.toBe(centro.origins.get(r.id));
    }
  });

  // Un bloque sin calle no se puede resolver, y eso se dice en vez de elegir.
  it("un bloque de un solo lado queda sin resolver, y lo explica", () => {
    const solo = bloqueConCalle("07").filter((r) => r.id.includes("N"));
    const d = deriveOriginEnds(solo);
    expect(d.origins.size).toBe(0);
    expect(d.blocks[0]!.status).toBe("un-solo-lado");
    expect(d.blocks[0]!.detail).toMatch(/sentido sin verificar/);
  });

  it("resuelve cada bloque por separado", () => {
    const d = deriveOriginEnds([...bloqueConCalle("04"), ...bloqueConCalle("05")]);
    expect(d.blocks.map((b) => b.block)).toEqual(["04", "05"]);
    expect(d.origins.size).toBe(16);
  });
});

describe("dejarlo escrito en las filas", () => {
  it("escribe el sentido para que se pueda ver y corregir", () => {
    const rows = bloqueConCalle("04");
    const out = aplicarOrigenes(rows, deriveOriginEnds(rows));
    expect(out.every((r) => r.originEnd)).toBe(true);
    expect(out.find((r) => r.id === "04-N0")!.originEnd).toBe("start");
    expect(out.find((r) => r.id === "04-S0")!.originEnd).toBe("end");
  });

  /*
    Este test decia lo contrario: que a una fila sin resolver no se le escribia
    nada. Sonaba prudente y era el peor de los dos comportamientos.

    Sin `originEnd` la fila cae en la salida de emergencia de `per-row-flag`,
    que cuenta desde `start` — la primera pica del Excel. Ese orden no es un
    dato del terreno: el topografo tomo unas filas de sur a norte y otras al
    reves. O sea que "no inventar nada" terminaba inventando, y peor: fila por
    fila, para lados distintos. Un bloque asi ni siquiera se puede arreglar
    yendo a contar un modulo, porque no hay un sentido comun que dar vuelta.

    Lo que corresponde es escribir una punta consistente y no contarla como
    verificada.
  */
  it("a una fila sin resolver le escribe una punta, pero no la cuenta como resuelta", () => {
    const solo = bloqueConCalle("07").filter((r) => r.id.includes("N"));
    const d = deriveOriginEnds(solo);
    const out = aplicarOrigenes(solo, d);
    expect(d.origins.size).toBe(0);
    expect(d.provisionales.size).toBe(solo.length);
    expect(out.every((r) => r.originEnd)).toBe(true);
  });

  it("y esa punta es la MISMA en el terreno, aunque las picas vengan al reves", () => {
    // Un solo banco, con la mitad de las filas cargadas de sur a norte y la
    // otra mitad de norte a sur. Es lo que trae un relevamiento real.
    const solo = bloqueConCalle("08")
      .filter((r) => r.id.includes("N"))
      .map((r, i) => (i % 2 === 0 ? r : { ...r, start: r.end, end: r.start }));

    const d = deriveOriginEnds(solo);
    const out = aplicarOrigenes(solo, d);

    // La punta elegida tiene que caer siempre del mismo lado: la mas al sur.
    for (const r of out) {
      const elegida = r.originEnd === "start" ? r.start : r.end;
      const otra = r.originEnd === "start" ? r.end : r.start;
      expect(elegida.lat).toBeLessThan(otra.lat);
    }

    // Y con las picas al reves, `start` NO sirve: es justamente lo que hacia
    // la salida de emergencia.
    const alReves = out.filter((r) => r.originEnd === "end");
    expect(alReves.length).toBeGreaterThan(0);
  });
});

/**
 * Bloques de mas de dos bancos.
 *
 * El caso que aparecio en Wellington North, y el mas peligroso que tenia esta
 * funcion. Buscaba el corte MAS GRANDE y devolvia "ok" con dos grupos, aunque
 * el bloque tuviera cuatro bancos y tres calles casi iguales: la eleccion la
 * decidian centimetros. Despues el sentido salia de "que punta cae mas cerca
 * del corte", que para los bancos de las orillas da la punta equivocada — o
 * sea medio bloque contando al reves, con el cartel en verde.
 *
 * Lo correcto es no contestar: en cual de las calles estan las cajas no esta
 * en un archivo de coordenadas.
 */
describe("un bloque con mas de una calle", () => {
  /** N bancos de filas norte-sur, apilados con calles entre medio. */
  function bancos(block: string, cuantos: number, filasPorBanco = 4): TrackerRow[] {
    const largo = 0.000586; // ~65 m
    const calle = 0.00008; // ~9 m
    const out: TrackerRow[] = [];
    for (let b = 0; b < cuantos; b++) {
      const pie = -26.9 + b * (largo + calle);
      for (let i = 0; i < filasPorBanco; i++) {
        const id = `${block}-B${b}F${i}`;
        const lon = 150.58 + i * 0.00006;
        out.push({
          ...makeRow(
            { id, block, tracker: id, anchor: { lat: 0, lon: 0 }, azimuthDeg: 0 },
            profile,
          ),
          id, block, tracker: id,
          start: { lat: pie, lon },
          end: { lat: pie + largo, lon },
        });
      }
    }
    return out;
  }

  it("con dos bancos sigue resolviendo, que es el caso normal", () => {
    const g = agruparPorCalle(bancos("20", 2));
    expect(g.status).toBe("ok");
  });

  it("con cuatro bancos no inventa una calle: avisa que hay tres", () => {
    const g = agruparPorCalle(bancos("21", 4));
    expect(g.status).toBe("varias-calles");
    expect(g.detail).toMatch(/4 bancos/);
    expect(g.detail).toMatch(/3 calles/);
  });

  it("no da ninguna de esas filas por verificada", () => {
    const filas = bancos("21", 4);
    const d = deriveOriginEnds(filas);
    expect(d.origins.size).toBe(0);
    expect(d.blocks[0]!.status).toBe("varias-calles");
  });

  it("pero deja los cuatro bancos apuntando al sur, listos para un conteo cada uno", () => {
    const filas = bancos("21", 4);
    const d = deriveOriginEnds(filas);
    expect(d.provisionales.size).toBe(filas.length);
    expect(d.bancos.filter((b) => b.block === "21")).toHaveLength(4);
    expect(d.bancos.every((b) => !b.verificado)).toBe(true);

    for (const r of aplicarOrigenes(filas, d)) {
      const elegida = r.originEnd === "start" ? r.start : r.end;
      const otra = r.originEnd === "start" ? r.end : r.start;
      expect(elegida.lat).toBeLessThan(otra.lat);
    }
  });

  it("dice cuantos bancos son, que es cuantos conteos hacen falta", () => {
    const d = deriveOriginEnds(bancos("21", 4));
    expect(d.blocks[0]!.detail).toMatch(/4 en este bloque/);
    expect(d.blocks[0]!.detail).toMatch(/punta sur/);
  });

  // La razon de ser del cambio, dicha como test: la respuesta vieja no era
  // "un poco imprecisa", era medio bloque al reves.
  it("antes hubiera partido 2+2 y dado vuelta los bancos de las orillas", () => {
    const filas = bancos("21", 4);
    // Con la regla vieja los dos bancos de abajo son "lower" y los dos de
    // arriba "upper", y el corte cae en la calle del medio. Para el banco 0 la
    // punta mas cercana a ese corte es la de arriba... igual que para el banco
    // 1, que si esta pegado a la calle. Las dos darian lo mismo aunque una este
    // a 75 m de distancia: eso es el error.
    const g = agruparPorCalle(filas);
    // Ahora no hay `corte` que usar mal.
    expect(g.corte).toBeUndefined();
    expect(g.lower).toBeUndefined();
    expect(g.upper).toBeUndefined();
  });

  it("tres bancos tampoco: dos calles ya son ambiguas", () => {
    expect(agruparPorCalle(bancos("22", 3)).status).toBe("varias-calles");
  });
});
