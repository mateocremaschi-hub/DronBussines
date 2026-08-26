/**
 * Deteccion por comparacion con los vecinos.
 *
 * Lo que se prueba no es que encuentre calor: es que compare contra lo que
 * corresponde. Un modulo a 60 grados no es una anomalia si todo el string
 * esta a 60 —eso es un mediodia de verano— y uno a 45 si es una anomalia
 * cuando sus 27 vecinos estan a 40.
 *
 * Por eso el vecindario es ELECTRICO y no geometrico: los modulos de un mismo
 * string comparten corriente, orientacion, edad y suciedad. Es la comparacion
 * que aisla el defecto de todo lo demas.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { comparar, eventosDeString, resumir, UMBRALES, type Muestra } from "../app/detect";
import { compileFarm, makeFrame, modulesOfRow } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { applyStrings } from "../app/strings";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const N = profile.topology.modulesPerString; // 28

const row = makeRow(
  {
    id: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north",
  },
  profile,
);
const conStrings = applyStrings([row], {
  fieldIndex: 3,
  byRow: new Map([["05-042-R1", { labels: ["S-1.2.15.1", "S-1.2.15.2"], dcBox: "DCB-1.2.15" }]]),
  chains: new Map([["05-042-R1", { pos: 1, posTotal: 1 }]]),
});
const farm = compileFarm(profile, conStrings);
const modulos = modulesOfRow(farm.rows[0]!, farm);

/** Muestras de toda la fila a una temperatura base, con los retoques que se pidan. */
const muestras = (base: number, retoques: Record<number, number> = {}): Muestra[] =>
  modulos.map((m) => ({
    modulo: m,
    celsius: base + (retoques[m.positionInRow] ?? 0),
    pixeles: 40,
    fileName: "DJI_0001_T.JPG",
    distanciaAlCentroM: 3,
  }));

// ---------------------------------------------------------------------------

describe("recorrer los modulos de una fila", () => {
  it("los enumera todos, una vez cada uno", () => {
    expect(modulos).toHaveLength(N * profile.topology.stringsPerRow);
    expect(new Set(modulos.map((m) => m.positionInRow)).size).toBe(modulos.length);
  });

  it("les pone la etiqueta real del string", () => {
    expect(modulos[0]!.stringLabel).toBeTruthy();
    expect(new Set(modulos.map((m) => m.stringLabel)).size).toBe(2);
  });

  // El recorrido de ida y el de vuelta tienen que dar lo mismo. Si no, la
  // deteccion mediría un modulo y lo reportaría como otro.
  it("cada modulo numera del 1 al 28 dentro de su string", () => {
    for (const chunk of [0, 1]) {
      const nums = modulos.filter((m) => m.chunkIndex === chunk).map((m) => m.module).sort((a, b) => a - b);
      expect(nums).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    }
  });
});

// ---------------------------------------------------------------------------

describe("comparar contra los vecinos", () => {
  it("un parque entero caliente no tiene ninguna anomalia", () => {
    // Mediodia de verano: todo a 62 grados. No hay nada que reportar.
    const h = comparar(muestras(62));
    expect(h.every((x) => x.severidad === "normal")).toBe(true);
    expect(h.every((x) => Math.abs(x.deltaT) < 0.001)).toBe(true);
  });

  it("un modulo por encima de sus vecinos si lo es, aunque el parque este frio", () => {
    const h = comparar(muestras(22, { 5: 15 }));
    const caliente = h.find((x) => x.modulo.positionInRow === 5)!;
    expect(caliente.deltaT).toBeCloseTo(15, 1);
    expect(caliente.severidad).toBe("moderada");
    expect(h.filter((x) => x.severidad !== "normal")).toHaveLength(1);
  });

  it("gradua la severidad por cuanto se despega", () => {
    const h = comparar(muestras(40, { 3: 4, 7: 12, 11: 25 }));
    const pos = (p: number) => h.find((x) => x.modulo.positionInRow === p)!.severidad;
    expect(pos(3)).toBe("leve");
    expect(pos(7)).toBe("moderada");
    expect(pos(11)).toBe("critica");
  });

  // El punto entero del vecindario electrico.
  it("compara contra el propio string, no contra la fila entera", () => {
    // El string lejano entero 8 grados mas caliente que el cercano.
    const m = muestras(40).map((x) =>
      x.modulo.chunkIndex === 1 ? { ...x, celsius: 48 } : x,
    );
    const h = comparar(m);
    // Ningun modulo se despega DE SU STRING, asi que no hay anomalias de modulo.
    expect(h.every((x) => x.severidad === "normal")).toBe(true);
    expect(h.every((x) => x.ambito === "string")).toBe(true);
  });

  it("dice contra que se comparo cuando no alcanzan los vecinos", () => {
    const h = comparar(muestras(40).slice(0, 3));
    expect(h.every((x) => x.ambito === "vuelo")).toBe(true);
    expect(h[0]!.vecinos).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe("cuando el problema es del string entero", () => {
  it("junta un string caliente en un solo evento", () => {
    // Todo el string cercano 12 grados arriba: una conexion, no 28 modulos.
    const m = muestras(40).map((x) =>
      x.modulo.chunkIndex === 0 ? { ...x, celsius: 52 } : x,
    );
    // Comparado contra su propio string no se ve; contra la fila si.
    const h = comparar(m).map((x) =>
      x.modulo.chunkIndex === 0 ? { ...x, deltaT: 12, severidad: "moderada" as const } : x,
    );
    const ev = eventosDeString(h, N);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.modulos).toBe(N);
    expect(ev[0]!.fraccion).toBeCloseTo(1, 3);
    expect(ev[0]!.deltaTMedio).toBeCloseTo(12, 3);
    expect(ev[0]!.stringLabel).toBeTruthy();
  });

  it("no junta unos pocos modulos sueltos, que si son defectos de modulo", () => {
    const h = comparar(muestras(40, { 2: 12, 9: 12, 15: 12 }));
    expect(eventosDeString(h, N)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("declarar lo que el vuelo NO permite afirmar", () => {
  it("avisa que a esa resolucion no se ven celdas", () => {
    // 14.9 cm/px: el vuelo real de Edenvale a 113 m.
    const r = resumir(comparar(muestras(40)), 56, [], 14.9);
    expect(r.limitaciones.join(" ")).toMatch(/una celda de 16 cm entra en 1\.1/);
    expect(r.limitaciones.join(" ")).toMatch(/no celdas/);
  });

  it("no se queja cuando el vuelo si resuelve la celda", () => {
    const r = resumir(comparar(muestras(40)), 56, [], 4.5);
    expect(r.limitaciones.join(" ")).not.toMatch(/celda/);
  });

  it("cuenta los modulos que no cayeron en ninguna foto", () => {
    const r = resumir(comparar(muestras(40).slice(0, 20)), 56, [], 4.5);
    expect(r.sinMedir).toBe(36);
    expect(r.limitaciones.join(" ")).toMatch(/36 modulos del parque no cayeron/);
  });

  it("cuenta bien las severidades", () => {
    const h = comparar(muestras(40, { 3: 4, 7: 12, 11: 25, 19: 22 }));
    const r = resumir(h, 56, [], 4.5);
    expect(r).toMatchObject({ leves: 1, moderadas: 1, criticas: 2, modulosMedidos: 56 });
  });
});

describe("los umbrales son una convencion declarada, no la norma", () => {
  it("se pueden cambiar sin tocar el codigo", () => {
    const estricto = comparar(muestras(40, { 5: 4 }), { leve: 2, moderada: 3, critica: 4 });
    expect(estricto.find((x) => x.modulo.positionInRow === 5)!.severidad).toBe("critica");
    expect(UMBRALES.leve).toBe(3);
  });
});
