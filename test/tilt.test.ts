/**
 * El supuesto escondido de fotografiar desde arriba.
 *
 * La coordenada que trae una foto de dron es la del DRON, no la del panel.
 * Coinciden solo si el gimbal apunta derecho para abajo. Inclinado, el punto
 * que quedo en el centro del cuadro esta a "altura x tan(desvio)" — y siempre
 * corrido para el mismo lado, que es lo que lo vuelve peligroso: no se
 * promedia con mas fotos, se acumula.
 */

import { describe, expect, it } from "vitest";
import { offNadirDeg, tiltOffsetM } from "../app/photos";

const PASO = 1.15; // metros por modulo en Edenvale

describe("desvio del gimbal", () => {
  it("mirando derecho para abajo no hay desvio", () => {
    expect(offNadirDeg(-90)).toBe(0);
    expect(offNadirDeg(90)).toBe(0);
  });

  it("mide el desvio contra la vertical, no contra el horizonte", () => {
    expect(offNadirDeg(-85)).toBe(5);
    expect(offNadirDeg(-60)).toBe(30);
    expect(offNadirDeg(0)).toBe(90);   // camara horizontal
  });

  it("sin dato no inventa un cero", () => {
    expect(offNadirDeg(undefined)).toBeUndefined();
    expect(offNadirDeg(NaN)).toBeUndefined();
  });
});

describe("cuanto se corre el punto fotografiado", () => {
  it("a plomo, nada", () => {
    expect(tiltOffsetM(30, 0)).toBe(0);
  });

  // El numero que justifica todo esto: un desvio que a ojo no se ve.
  it("5 grados a 30 m son mas de dos modulos", () => {
    const d = tiltOffsetM(30, 5);
    expect(d).toBeCloseTo(2.62, 2);
    expect(d / PASO).toBeGreaterThan(2);
  });

  it("crece con la altura: lo mismo a 60 m es el doble", () => {
    expect(tiltOffsetM(60, 5) / tiltOffsetM(30, 5)).toBeCloseTo(2, 6);
  });

  it("a 15 grados el error ya es de siete modulos", () => {
    expect(tiltOffsetM(30, 15) / PASO).toBeGreaterThan(6);
  });

  // Volando bajo el desvio importa mucho menos, que es un argumento real
  // a favor de acercarse en vez de hacer zoom.
  it("a 10 m de altura, 5 grados es menos de un modulo", () => {
    expect(tiltOffsetM(10, 5) / PASO).toBeLessThan(1);
  });
});
