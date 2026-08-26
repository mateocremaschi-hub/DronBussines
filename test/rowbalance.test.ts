/**
 * El cuadre de la fila.
 *
 * Lo que se prueba es la leccion que costo meses: que un numero DESPEJADO
 * siempre cierra, y que cerrar no es evidencia. El caso real de Edenvale entra
 * entero aca abajo — dos modelos que cuadran los mismos 65145 mm y que ponen
 * cada modulo con metro y medio de diferencia.
 */

import { describe, expect, it } from "vitest";
import { cuadreDeFila, type EntradaCuadre } from "../app/rowbalance";

/** Edenvale: 2 strings de 28, filas de 65,145 m de pica a pica. */
const base: EntradaCuadre = {
  modulosPorFila: 56,
  stringsPorFila: 2,
  anchoModuloMm: 1120,
  huecoEntreModulosMm: 20,
  bahiaMm: 555,
  offsetMm: 395,
  largoMedidoM: 65.145,
};

describe("sumar el fierro de una fila", () => {
  it("cuenta los huecos que hay, no uno por modulo", () => {
    const c = cuadreDeFila(base);
    const huecos = c.partes.find((p) => p.concepto.startsWith("Huecos"))!;
    // 27 huecos adentro de cada string, no 28.
    expect(huecos.cantidad).toBe(54);
    const bahia = c.partes.find((p) => p.concepto.startsWith("Bahia"))!;
    expect(bahia.cantidad).toBe(1);
  });

  it("con una fila de un solo string no inventa una bahia", () => {
    const c = cuadreDeFila({ ...base, stringsPorFila: 1, modulosPorFila: 28 });
    expect(c.partes.some((p) => p.concepto.startsWith("Bahia"))).toBe(false);
  });

  it("suma el fierro y le agrega el offset de las dos puntas", () => {
    const c = cuadreDeFila(base);
    expect(c.fierroMm).toBe(56 * 1120 + 54 * 20 + 555);
    expect(c.predichoMm).toBe(c.fierroMm + 2 * 395);
  });
});

// ---------------------------------------------------------------------------

describe("el caso real de Edenvale", () => {
  /** Lo que dice la cinta: bahia de 555 y la pica por fuera. */
  it("con las medidas de campo la fila cierra", () => {
    const c = cuadreDeFila(base);
    expect(c.cierra).toBe(true);
    expect(Math.abs(c.residuoMm)).toBeLessThan(120);
  });

  /**
   * El modelo viejo. Cierra igual de bien, y esa es toda la cuestion: el largo
   * total nunca pudo distinguirlos.
   */
  it("el modelo de la bahia de 3713 tambien cierra — por eso engaño", () => {
    const viejo = cuadreDeFila({
      ...base, anchoModuloMm: 1130, bahiaMm: 3713, offsetMm: -1464,
    });
    expect(viejo.cierra).toBe(true);
  });

  /**
   * Y sin embargo colocan los modulos en lugares distintos. Un cuadre que da
   * cero no dice nada sobre eso: por eso el aviso importa mas que el numero.
   */
  it("cuando cierra con numeros supuestos, avisa que no confirma nada", () => {
    const c = cuadreDeFila({ ...base, medidos: { ancho: true, hueco: true } });
    expect(c.cierra).toBe(true);
    expect(c.notas.join(" ")).toMatch(/no confirma nada/);
    expect(c.notas.join(" ")).toMatch(/2 de 4/);
  });

  it("cuando cierra y todo esta medido, ahi si lo llama evidencia", () => {
    const c = cuadreDeFila({
      ...base, medidos: { ancho: true, hueco: true, bahia: true, offset: true },
    });
    expect(c.notas.join(" ")).toMatch(/Esto si es evidencia/);
  });

  /**
   * La combinacion que destapo el problema: la bahia medida (555) junto con el
   * voladizo que se habia medido antes (−1464). No cierran, y faltan casi tres
   * modulos y medio.
   */
  it("mezclando las dos mediciones faltan 3,7 m y lo dice en modulos", () => {
    const c = cuadreDeFila({ ...base, bahiaMm: 555, offsetMm: -1464 });
    expect(c.cierra).toBe(false);
    expect(c.residuoMm).toBeCloseTo(3718, -1);
    expect(c.residuoEnModulos).toBeGreaterThan(3);
    expect(c.residuoEnModulos).toBeLessThan(3.5);
    expect(c.notas.join(" ")).toMatch(/Sobran 3718 mm/);
    expect(c.notas.join(" ")).toMatch(/hueco que no esta declarado/);
  });
});

// ---------------------------------------------------------------------------

describe("que dice cuando no cierra", () => {
  it("si sobra largo, apunta a un hueco sin declarar", () => {
    const c = cuadreDeFila({ ...base, largoMedidoM: 68 });
    expect(c.residuoMm).toBeGreaterThan(0);
    expect(c.notas.join(" ")).toMatch(/hueco que no esta declarado/);
  });

  it("si falta largo, apunta al paso o a la cantidad de modulos", () => {
    const c = cuadreDeFila({ ...base, largoMedidoM: 60 });
    expect(c.residuoMm).toBeLessThan(0);
    expect(c.notas.join(" ")).toMatch(/no entran en el largo/);
  });

  // La regla de oro, escrita en la propia app.
  it("dice explicitamente que no se arregla tocando el numero mas flojo", () => {
    const c = cuadreDeFila({ ...base, largoMedidoM: 68 });
    expect(c.notas.join(" ")).toMatch(/No lo arregles cambiando el numero que menos mediste/);
    expect(c.notas.join(" ")).toMatch(/Anda a la fila/);
  });

  it("una diferencia mas chica que un decimo de modulo no es un problema", () => {
    const c = cuadreDeFila({ ...base, largoMedidoM: 65.145 + 0.1 });
    expect(c.cierra).toBe(true);
  });
});
