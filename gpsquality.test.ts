/**
 * Que tan buena es la coordenada.
 *
 * Esto sale de una tarde perdida en el campo: la app decia "no hay ninguna
 * fila a menos de 30 m" estando parado abajo del panel, y no habia forma de
 * saber por que. La respuesta estaba en un numero que ya se mostraba en gris y
 * en chiquito — la precision.
 *
 * Lo que se prueba es que ese numero se convierta en una respuesta y no en un
 * dato mas: si el error de posicion es mas grande que el radio de busqueda, no
 * encontrar nada estaba garantizado de antemano y la app tiene que decirlo en
 * vez de dejar pensando que el parque esta mal cargado.
 */

import { describe, expect, it } from "vitest";
import { calidadDeCoordenada, comoArreglarlo } from "../app/gpsquality";

const RADIO = 30;

describe("leer la precision de la coordenada", () => {
  it("un GPS de celular al aire libre sirve para contar modulos", () => {
    const v = calidadDeCoordenada(5, RADIO);
    expect(v.calidad).toBe("gps");
    expect(v.sirve).toBe(true);
    // Traducido a la unidad que se usa parado en la fila.
    expect(v.detalle).toMatch(/modulos/);
  });

  it("con GPS flojo avisa que alcanza para el tracker, no para el modulo", () => {
    const v = calidadDeCoordenada(25, RADIO);
    expect(v.calidad).toBe("justa");
    expect(v.sirve).toBe(true);
    expect(v.detalle).toMatch(/en que tracker estas, no para el numero de modulo/);
    expect(v.detalle).toMatch(/parado quieto/);
  });

  /**
   * El caso que costo la tarde. Con 800 m de error no hay busqueda de 30 m que
   * encuentre nada, y eso no dice nada del parque.
   */
  it("con ubicacion aproximada dice que el problema es la coordenada, no el parque", () => {
    const v = calidadDeCoordenada(800, RADIO);
    expect(v.sirve).toBe(false);
    expect(v.detalle).toMatch(/no es una medicion de satelite/);
  });

  it("nombra las dos causas reales: ubicacion precisa apagada, o notebook sin GPS", () => {
    const v = calidadDeCoordenada(150, RADIO);
    expect(v.detalle).toMatch(/ubicacion precisa esta apagada/);
    expect(v.detalle).toMatch(/redes WiFi/);
    expect(v.detalle).toMatch(/notebook/);
  });

  it("cuando el error supera el radio de busqueda, lo dice explicitamente", () => {
    const v = calidadDeCoordenada(150, RADIO);
    expect(v.detalle).toMatch(/mas grande que los 30 m/);
    expect(v.detalle).toMatch(/no dice nada del parque/);
  });

  // Con un radio mas generoso que el error, la frase sobra y no aparece.
  it("pero no lo dice cuando el radio es mas grande que el error", () => {
    const v = calidadDeCoordenada(150, 400);
    expect(v.detalle).not.toMatch(/mas grande que los/);
  });

  it("con kilometros de error lo expresa en kilometros, no en metros", () => {
    const v = calidadDeCoordenada(4200, RADIO);
    expect(v.calidad).toBe("inservible");
    expect(v.titulo).toMatch(/4\.2 km/);
  });

  it("una coordenada escrita a mano no se juzga, pero se avisa", () => {
    const v = calidadDeCoordenada(null, RADIO);
    expect(v.sirve).toBe(true);
    expect(v.detalle).toMatch(/no sabe cuanto puede estar errada/);
  });
});

describe("que hacer al respecto", () => {
  // En el campo hace falta la instruccion, no el diagnostico.
  it("da pasos concretos y no consejos generales", () => {
    const pasos = comoArreglarlo().join(" ");
    expect(pasos).toMatch(/iPhone.*Ubicacion precisa/s);
    expect(pasos).toMatch(/Android/);
    expect(pasos).toMatch(/abajo del panel/);
    expect(pasos).toMatch(/notebook.*no va a funcionar/s);
  });
});
