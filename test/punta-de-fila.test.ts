/**
 * El calor que trae la punta de la fila, y que no es del modulo.
 *
 * Es la correccion que ordena la lista corta. El motor compara cada modulo
 * contra sus hermanos de string —la comparacion correcta para un defecto
 * electrico— pero los hermanos no comparten AMBIENTE: los ultimos modulos de
 * una fila dan a la calle de servicio y se calientan solos. Sobre el vuelo de
 * Wellington, el modulo 1 de cuatro filas distintas de la MISMA foto marcaba
 * +2,06, +2,25, +2,50 y +3,15 contra sus hermanos. No son cuatro modulos en
 * circuito abierto: es la punta.
 */

import { describe, expect, it } from "vitest";
import { calorDeLaPunta } from "../app/puntaDeFila";

/** Un string de 28 modulos a una temperatura, con los retoques que se pidan. */
const string1 = (
  nombre: string,
  base: number,
  retoques: Record<number, number> = {},
) =>
  Array.from({ length: 28 }, (_, i) => ({
    string: nombre,
    posicion: i + 1,
    celsius: base + (retoques[i + 1] ?? 0),
  }));

describe("el calor de la punta de la fila", () => {
  it("lo mide cuando aparece en varias filas a la vez", () => {
    /*
      El caso real: cuatro filas del mismo cuadro, todas con la punta caliente
      y con un gradiente que se apaga en cinco modulos.
    */
    const gradiente = { 1: 2.4, 2: 1.2, 3: 0.6, 4: 0.3 };
    const medidas = [
      ...string1("A", 38, gradiente),
      ...string1("B", 39, gradiente),
      ...string1("C", 37.5, gradiente),
      ...string1("D", 38.5, gradiente),
    ];
    const base = calorDeLaPunta(medidas);
    expect(base.get(1)).toBeCloseTo(2.4, 1);
    expect(base.get(2)).toBeCloseTo(1.2, 1);
    expect(base.get(4)).toBeCloseTo(0.3, 1);
    // En el medio no hay nada que sacar.
    expect(Math.abs(base.get(14) ?? 0)).toBeLessThan(0.05);
  });

  it("NO se come el defecto de una sola fila", () => {
    /*
      Lo que no puede pasar: que un modulo caliente de verdad desaparezca
      porque se le resta su propio calor. La mediana de cuatro filas no se
      mueve porque una tenga un defecto.
    */
    const medidas = [
      ...string1("A", 38, { 14: 12 }),   // el defecto, en el medio
      ...string1("B", 39),
      ...string1("C", 37.5),
      ...string1("D", 38.5),
    ];
    const base = calorDeLaPunta(medidas);
    expect(Math.abs(base.get(14) ?? 0)).toBeLessThan(0.5);
  });

  it("y tampoco se come un defecto que este JUSTO en la punta", () => {
    const gradiente = { 1: 2.4, 2: 1.2 };
    const medidas = [
      ...string1("A", 38, { ...gradiente, 1: 2.4 + 10 }), // punta caliente Y rota
      ...string1("B", 39, gradiente),
      ...string1("C", 37.5, gradiente),
      ...string1("D", 38.5, gradiente),
    ];
    const base = calorDeLaPunta(medidas);
    // Se saca el ambiente (2,4) y quedan los 10 grados del defecto.
    expect(base.get(1)).toBeCloseTo(2.4, 1);
    expect(12.4 - (base.get(1) ?? 0)).toBeGreaterThan(9);
  });

  it("no inventa una correccion con dos filas", () => {
    const medidas = [...string1("A", 38, { 1: 2 }), ...string1("B", 39, { 1: 2 })];
    expect(calorDeLaPunta(medidas).size).toBe(0);
  });

  it("no le cree a un string del que se ven cuatro modulos", () => {
    /*
      Con pocos modulos a la vista, la mediana del string la puede fijar el
      propio defecto: ahi el nivel no significa nada y ese string no vota.
    */
    const cortos = ["A", "B", "C", "D"].flatMap((n) =>
      Array.from({ length: 4 }, (_, i) => ({ string: n, posicion: i + 1, celsius: 40 })),
    );
    expect(calorDeLaPunta(cortos).size).toBe(0);
  });
});
