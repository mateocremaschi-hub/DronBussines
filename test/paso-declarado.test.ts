/**
 * El paso declarado tiene que mover los modulos.
 *
 * Parece obvio y estuvo mal. El reparto avanzaba `ancho + hueco` —el paso
 * NOMINAL— ignorando el `pitchM` que recibia. En Edenvale los dos numeros son
 * el mismo, asi que 442 pruebas pasaban en verde sobre un motor que no usaba
 * el parametro.
 *
 * Y lo que quedaba roto no era un detalle: `pitchMm: "derive"` —despejar el
 * paso del largo real de cada fila, que es la opcion del preset "Generico",
 * o sea la que va a usar cualquier parque nuevo— no movia nada Y ADEMAS
 * apagaba el aviso de largo, porque el residuo se calculaba contra si mismo y
 * daba cero. Parque nuevo, modulos al paso equivocado, cero avisos.
 *
 * Estas pruebas usan a proposito un paso que NO es ancho + hueco, que es lo
 * unico que el parque de control no podia distinguir.
 */

import { describe, expect, it } from "vitest";
import type { FarmProfile } from "../src/types.js";
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import { makeRowLayout } from "../src/geo/rowLayout.js";
import { makeRow } from "./helpers/synthetic.js";
import { makeFrame, toGeo, toLocal } from "../src/geo/frame.js";

const base = (over: Record<string, unknown> = {}): FarmProfile => ({
  id: "p", name: "Paso declarado", profileVersion: 1,
  module: { widthMm: 1000, gapMm: 0, ...(over.module as object) },
  topology: { modulesPerString: 10, stringsPerRow: 1 },
  geometry: { endpointOffsetMm: 0, endpointOffsetMode: "none" },
  addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
} as unknown as FarmProfile);

describe("el paso declarado reparte los modulos", () => {
  it("con paso 2000 los modulos van cada 2 m, no cada 1", () => {
    const l = makeRowLayout({
      modulesPerString: 10, stringsPerRow: 1,
      pitchM: 2, moduleGapM: 0, moduleWidthM: 1, originOffsetM: 0,
    });
    expect(l.bordesM[0]).toBeCloseTo(0, 9);
    expect(l.bordesM[1]).toBeCloseTo(2, 9);
    expect(l.bordesM[9]).toBeCloseTo(18, 9);
    // Y el espacio libre entre modulos sale del paso, no del hueco declarado.
    expect(l.libreM[0]).toBeCloseTo(1, 9);
  });

  it("de punta a punta: parado sobre el modulo 10 la app dice 10", () => {
    const profile = base({ module: { widthMm: 1000, gapMm: 0, pitchMm: 2000 } });
    // 10 modulos de 2 m de paso ocupan 9 pasos + 1 ancho = 19 m.
    const row = makeRow({
      id: "r", block: "01", tracker: "01-1",
      anchor: { lat: -26.9, lon: 150.58 }, azimuthDeg: 180, lengthM: 19,
    }, profile);
    const farm = compileFarm(profile, [row]);

    const frame = makeFrame(row.start.lat, row.start.lon);
    const a = toLocal(frame, row.start.lat, row.start.lon);
    const b = toLocal(frame, row.end.lat, row.end.lon);
    const en = (m: number) => {
      const f = m / 19;
      const g = toGeo(frame, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      return locate({ ...g, accuracyM: 0.2 }, farm).best?.positionInRow;
    };

    expect(en(0.5)).toBe(1);
    expect(en(2.5)).toBe(2);      // con el bug daba 3
    expect(en(18.5)).toBe(10);    // con el bug daba fuera de rango
  });
});

describe("despejar el paso del largo real", () => {
  /**
   * La red de seguridad. Con `derive`, el residuo se calculaba como
   * `derivedPitch - pitch`, y como pitch ERA derivedPitch daba cero siempre.
   * Una fila 20 % mas larga entraba sin una queja.
   */
  it("derive despeja el paso de verdad, en vez de devolver el nominal", () => {
    const profile = base({ module: { widthMm: 1000, gapMm: 0, pitchMm: "derive" } });
    // Fila de 28 m con 10 modulos: 9 pasos + 1 ancho = 28 -> paso 3 m.
    const row = makeRow({
      id: "r", block: "01", tracker: "01-1",
      anchor: { lat: -26.9, lon: 150.58 }, azimuthDeg: 180, lengthM: 28,
    }, profile);
    const farm = compileFarm(profile, [row]);
    expect(farm.rows[0]!.pitchM).toBeCloseTo(3, 6);
  });

  it("y el largo predicho coincide con el medido, que es lo que derive promete", () => {
    const profile = base({ module: { widthMm: 1000, gapMm: 0, pitchMm: "derive" } });
    const row = makeRow({
      id: "r", block: "01", tracker: "01-1",
      anchor: { lat: -26.9, lon: 150.58 }, azimuthDeg: 180, lengthM: 28,
    }, profile);
    const farm = compileFarm(profile, [row]);
    const l = farm.rows[0]!;
    // El ultimo borde mas el ancho tiene que dar los 28 m medidos.
    expect(Math.abs(l.lengthResidualMmPerModule)).toBeLessThan(1);
  });
});

describe("el aviso de largo sigue siendo una red", () => {
  it("una fila 20 % mas larga con paso declarado dispara el aviso", () => {
    const profile = base({ module: { widthMm: 1000, gapMm: 0, pitchMm: 1000 } });
    const row = makeRow({
      id: "r", block: "01", tracker: "01-1",
      anchor: { lat: -26.9, lon: 150.58 }, azimuthDeg: 180, lengthM: 12,
    }, profile);
    const farm = compileFarm(profile, [row]);
    expect(farm.buildWarnings.filter((w) => w.code === "length-mismatch")).toHaveLength(1);
  });

  /**
   * El mensaje se contradecia: "mide 10.00 m, pero el perfil predice 10.00 m
   * ... Sobran -500 mm por modulo". El largo predicho salia de la tabla de
   * bordes y el residuo del paso declarado, o sea de dos modelos distintos.
   */
  it("el largo predicho y el residuo hablan del mismo modelo", () => {
    const profile = base({ module: { widthMm: 1000, gapMm: 0, pitchMm: 1500 } });
    const row = makeRow({
      id: "r", block: "01", tracker: "01-1",
      anchor: { lat: -26.9, lon: 150.58 }, azimuthDeg: 180, lengthM: 10,
    }, profile);
    const farm = compileFarm(profile, [row]);
    const aviso = farm.buildWarnings.find((w) => w.code === "length-mismatch");
    expect(aviso, "esperaba el aviso").toBeDefined();
    const m = /predice ([\d.]+) m/.exec(aviso!.message)!;
    // 10 modulos de paso 1500 ocupan 9x1500 + 1000 = 14.5 m, no 10.
    expect(Number(m[1])).toBeCloseTo(14.5, 1);
  });
});
