/**
 * Trackers donde los huecos NO caen entre strings.
 *
 * El modelo original suponia lo que se ve en Edenvale: strings iguales
 * separados por bahias iguales. Existe otro tracker bastante comun donde el
 * primer panel va solo, despues un hueco, despues todos los demas juntos, y
 * otro hueco antes del ultimo — porque el accionamiento y los apoyos estan en
 * las puntas y no en el medio de la mesa.
 *
 * Con el modelo periodico eso no se puede escribir. Se puede APROXIMAR, y ahi
 * esta el peligro: los totales cierran igual —la fila mide lo que mide— y cada
 * modulo del medio queda corrido casi un metro. El total nunca puede distinguir
 * los dos modelos, exactamente como no pudo distinguir la bahia de 3713 mm de
 * la de 555.
 *
 * Por eso los huecos se enumeran: despues de que modulo cae cada uno y cuanto
 * mide. El caso normal se sigue declarando con dos numeros y se expande solo.
 */

import { describe, expect, it } from "vitest";
import type { FarmProfile } from "../src/types.js";
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import { validateProfile } from "../src/profile/validate.js";
import { makeRow } from "./helpers/synthetic.js";
import { makeFrame, toGeo, toLocal } from "../src/geo/frame.js";
import { cuadreDeFila } from "../app/rowbalance";

// ---------------------------------------------------------------------------
// Un tracker de 30 modulos: [1] hueco [2…29] hueco [30]
// ---------------------------------------------------------------------------

const ANCHO = 1130;
const HUEQUITO = 20;
const HUECO_PUNTA = 900;
const N = 30;

/** 30 paneles + 27 huequitos + 2 huecos de punta. */
const LARGO_MM = N * ANCHO + (N - 1 - 2) * HUEQUITO + 2 * HUECO_PUNTA;

const PERFIL = {
  id: "puntas", name: "Parque con huecos en las puntas", profileVersion: 1,
  module: { widthMm: ANCHO, gapMm: HUEQUITO },
  topology: {
    modulesPerString: N, stringsPerRow: 1,
    gaps: [
      { afterModule: 1, mm: HUECO_PUNTA },
      { afterModule: N - 1, mm: HUECO_PUNTA },
    ],
  },
  geometry: { endpointOffsetMm: 0, endpointOffsetMode: "none" },
  addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
} as unknown as FarmProfile;

const fila = () =>
  makeRow(
    {
      id: "t1", block: "01", tracker: "01-001",
      anchor: { lat: -26.9, lon: 150.58 }, azimuthDeg: 180,
      lengthM: LARGO_MM / 1000,
    },
    PERFIL,
  );

// ---------------------------------------------------------------------------

describe("el perfil los acepta y los revisa", () => {
  it("valida un perfil con huecos enumerados", () => {
    expect(() => validateProfile(PERFIL)).not.toThrow();
  });

  /**
   * Un hueco despues del ultimo modulo no es un hueco: es un voladizo, y eso
   * se declara aparte. Dejarlo pasar correria la fila entera sin sintoma.
   */
  it("rechaza un hueco despues del ultimo modulo", () => {
    const malo = { ...PERFIL, topology: { ...PERFIL.topology, gaps: [{ afterModule: N, mm: 900 }] } };
    expect(() => validateProfile(malo)).toThrow(/voladizo|endpointOffsetMm/i);
  });

  it("rechaza dos huecos en el mismo lugar y una lista desordenada", () => {
    const repetido = {
      ...PERFIL,
      topology: { ...PERFIL.topology, gaps: [{ afterModule: 5, mm: 900 }, { afterModule: 5, mm: 900 }] },
    };
    expect(() => validateProfile(repetido)).toThrow(/repite/i);

    const desordenado = {
      ...PERFIL,
      topology: { ...PERFIL.topology, gaps: [{ afterModule: 20, mm: 900 }, { afterModule: 3, mm: 900 }] },
    };
    expect(() => validateProfile(desordenado)).toThrow(/orden/i);
  });
});

// ---------------------------------------------------------------------------

describe("el reparto de modulos", () => {
  const farm = compileFarm(PERFIL, [fila()]);

  it("compila sin avisos de largo: la fila cierra con este modelo", () => {
    expect(farm.buildWarnings.filter((w) => w.code === "length-mismatch")).toEqual([]);
  });

  /**
   * La prueba central. Se camina la fila de a 5 cm y se anotan los puntos donde
   * cambia el modulo: esos bordes tienen que caer donde dice la cuenta a mano.
   */
  it("pone los tres tramos donde van, medido de a 5 cm", () => {
    const row = farm.rows[0]!;
    const frame = makeFrame(row.source.start.lat, row.source.start.lon);
    const a = toLocal(frame, row.source.start.lat, row.source.start.lon);
    const b = toLocal(frame, row.source.end.lat, row.source.end.lon);

    const posEn = (mm: number) => {
      const f = mm / LARGO_MM;
      const g = toGeo(frame, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      return locate({ ...g, accuracyM: 0.2 }, farm).best?.positionInRow;
    };

    // El primer panel va solo, de 0 a 1130.
    expect(posEn(50)).toBe(1);
    expect(posEn(1080)).toBe(1);

    // Despues 900 mm de nada, y arranca el segundo.
    const arranqueDel2 = ANCHO + HUECO_PUNTA;
    expect(posEn(arranqueDel2 + 50)).toBe(2);
    expect(posEn(arranqueDel2 + ANCHO + HUEQUITO + 50)).toBe(3);

    // El ultimo panel, del otro lado de su hueco.
    expect(posEn(LARGO_MM - 50)).toBe(30);
    expect(posEn(LARGO_MM - ANCHO + 50)).toBe(30);
    expect(posEn(LARGO_MM - ANCHO - HUECO_PUNTA - 50)).toBe(29);
  });

  it("va y vuelve para los 30 modulos", () => {
    const farm2 = compileFarm(PERFIL, [fila()]);
    const row = farm2.rows[0]!;
    const frame = makeFrame(row.source.start.lat, row.source.start.lon);
    const a = toLocal(frame, row.source.start.lat, row.source.start.lon);
    const b = toLocal(frame, row.source.end.lat, row.source.end.lon);

    for (let mm = 60; mm < LARGO_MM; mm += 60) {
      const f = mm / LARGO_MM;
      const g = toGeo(frame, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      const p = locate({ ...g, accuracyM: 0.2 }, farm2).best?.positionInRow;
      expect(p == null || (p >= 1 && p <= N), `a los ${mm} mm dio ${p}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Por que no alcanza con aproximarlo.
 *
 * Alguien podria declarar dos strings de 15 con una bahia equivalente y decir
 * "total, la fila mide lo mismo". Mide lo mismo. Y los modulos del medio caen
 * en otro lado.
 */
describe("el modelo periodico no lo puede aproximar", () => {
  it("aproximarlo con dos strings iguales corre los modulos casi un metro", () => {
    const real = compileFarm(PERFIL, [fila()]);
    const aproximado = compileFarm(
      {
        ...PERFIL,
        topology: {
          modulesPerString: 15, stringsPerRow: 2,
          // La bahia que hace que el total de igual: los dos huecos juntos.
          stringGapMm: 2 * HUECO_PUNTA + HUEQUITO,
        },
      } as unknown as FarmProfile,
      [fila()],
    );

    const frame = makeFrame(real.rows[0]!.source.start.lat, real.rows[0]!.source.start.lon);
    const a = toLocal(frame, real.rows[0]!.source.start.lat, real.rows[0]!.source.start.lon);
    const b = toLocal(frame, real.rows[0]!.source.end.lat, real.rows[0]!.source.end.lon);

    let distintos = 0;
    let total = 0;
    for (let mm = 60; mm < LARGO_MM; mm += 60) {
      const f = mm / LARGO_MM;
      const g = toGeo(frame, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      const uno = locate({ ...g, accuracyM: 0.2 }, real).best?.positionInRow;
      const otro = locate({ ...g, accuracyM: 0.2 }, aproximado).best?.positionInRow;
      if (uno == null || otro == null) continue;
      total++;
      if (uno !== otro) distintos++;
    }

    // Casi toda la fila contesta otro panel. Y el total cierra en los dos.
    expect(distintos / total).toBeGreaterThan(0.4);
  });
});

// ---------------------------------------------------------------------------

describe("el cuadre lo suma bien", () => {
  it("cuenta 27 huequitos, no 29: cada hueco grande reemplaza a uno", () => {
    const c = cuadreDeFila({
      modulosPorFila: N, stringsPorFila: 1,
      anchoModuloMm: ANCHO, huecoEntreModulosMm: HUEQUITO,
      bahiaMm: 0,
      huecos: [{ afterModule: 1, mm: HUECO_PUNTA }, { afterModule: N - 1, mm: HUECO_PUNTA }],
      offsetMm: 0,
      largoMedidoM: LARGO_MM / 1000,
      medidos: { ancho: true, hueco: true, bahia: true, offset: true },
    });

    const huequitos = c.partes.find((p) => p.concepto === "Huecos entre modulos")!;
    expect(huequitos.cantidad).toBe(27);

    // Y no se llaman "bahia entre strings", porque no caen entre strings.
    expect(c.partes.map((p) => p.concepto)).toContain("Huecos grandes");
    expect(c.partes.map((p) => p.concepto)).not.toContain("Bahia entre strings");
    expect(c.fierroMm).toBe(LARGO_MM);
    expect(c.cierra).toBe(true);
  });

  it("con huecos de distinto tamano los muestra por separado, no promediados", () => {
    const c = cuadreDeFila({
      modulosPorFila: N, stringsPorFila: 1,
      anchoModuloMm: ANCHO, huecoEntreModulosMm: HUEQUITO, bahiaMm: 0,
      huecos: [{ afterModule: 1, mm: 900 }, { afterModule: 15, mm: 555 }],
      offsetMm: 0, largoMedidoM: 1,
    });
    const conceptos = c.partes.map((p) => p.concepto);
    expect(conceptos).toContain("Huecos grandes de 900 mm");
    expect(conceptos).toContain("Huecos grandes de 555 mm");
  });
});
