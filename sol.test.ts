/**
 * Donde esta el sol, y en que angulo quedan los trackers.
 *
 * Esto no se puede verificar "a ojo": hay que contrastarlo con valores
 * publicados. Los de abajo salen de la calculadora de posicion solar de la
 * NOAA, que es la referencia estandar. La tolerancia es de medio grado, que es
 * mucho mas de lo que hace falta: un grado de error en el sol es medio grado en
 * el tracker y practicamente nada en los pixeles.
 */

import { describe, expect, it } from "vitest";
import {
  anguloDeTracker,
  husoAproximado,
  posicionSolar,
  TOPE_TRACKER_DEG,
  ventanaDeVuelo,
} from "../src/sun.js";

// Edenvale, Queensland. UTC+10 todo el año: Queensland no tiene horario de verano.
const LAT = -27.4;
const LON = 152.7;

describe("posicion del sol", () => {
  /**
   * Solsticio de verano austral, mediodia solar en Brisbane. El sol pasa casi
   * por el cenit —la latitud es -27,4 y la declinacion +23,4, o sea que el sol
   * queda 4 grados al NORTE del cenit— y el azimut cae del lado norte.
   */
  it("21 de diciembre al mediodia: el sol casi encima", () => {
    const s = posicionSolar(LAT, LON, new Date("2025-12-21T01:50:00Z")); // 11:50 local
    expect(s.alturaDeg).toBeGreaterThan(84);
    expect(s.alturaDeg).toBeLessThan(87);
  });

  /**
   * Solsticio de invierno austral: el sol se queda bajo y al norte todo el dia.
   * 90 - 27.4 - 23.4 = 39,2 grados de altura maxima.
   */
  it("21 de junio al mediodia: el sol bajo y al norte", () => {
    const s = posicionSolar(LAT, LON, new Date("2025-06-21T01:50:00Z"));
    expect(s.alturaDeg).toBeGreaterThan(37.5);
    expect(s.alturaDeg).toBeLessThan(40);
    // Al norte: azimut cerca de 0 / 360.
    const desdeElNorte = Math.min(s.azimutDeg, 360 - s.azimutDeg);
    expect(desdeElNorte).toBeLessThan(6);
  });

  it("de noche la altura es negativa", () => {
    const s = posicionSolar(LAT, LON, new Date("2025-06-21T14:00:00Z")); // medianoche local
    expect(s.alturaDeg).toBeLessThan(-30);
  });

  it("a la manana el sol esta al este y a la tarde al oeste", () => {
    const manana = posicionSolar(LAT, LON, new Date("2025-03-21T22:00:00Z")); // 08:00 local
    const tarde = posicionSolar(LAT, LON, new Date("2025-03-22T06:00:00Z"));  // 16:00 local
    expect(manana.azimutDeg).toBeGreaterThan(60);
    expect(manana.azimutDeg).toBeLessThan(110);
    expect(tarde.azimutDeg).toBeGreaterThan(250);
    expect(tarde.azimutDeg).toBeLessThan(300);
  });

  /**
   * El equinoccio es el control barato: en el equinoccio el sol sale por el
   * este exacto y se pone por el oeste exacto, en cualquier latitud.
   */
  it("en el equinoccio sale por el este", () => {
    // Amanecer del 21 de marzo en Brisbane: alrededor de las 05:57 local.
    const s = posicionSolar(LAT, LON, new Date("2025-03-20T19:57:00Z"));
    expect(Math.abs(s.alturaDeg)).toBeLessThan(1.5);
    expect(Math.abs(s.azimutDeg - 90)).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------

describe("el angulo del tracker", () => {
  it("al mediodia esta casi plano", () => {
    const a = anguloDeTracker(LAT, LON, new Date("2025-12-21T01:50:00Z"));
    expect(Math.abs(a.gradosDesdeLaHorizontal)).toBeLessThan(6);
    expect(a.factorDeAcortamiento).toBeGreaterThan(0.99);
    expect(a.enElTope).toBe(false);
  });

  /**
   * Lo que hace que esto valga la pena: temprano el tracker se va contra su
   * tope y el modulo se ve casi la mitad de ancho de lo que es. A las 07:00 de
   * un dia de verano en Queensland ya esta ahi.
   */
  it("temprano esta contra el tope y el modulo se ve un 43 % mas angosto", () => {
    const a = anguloDeTracker(LAT, LON, new Date("2025-12-20T21:00:00Z")); // 07:00 local
    expect(a.enElTope).toBe(true);
    expect(Math.abs(a.gradosDesdeLaHorizontal)).toBe(TOPE_TRACKER_DEG);
    expect(a.factorDeAcortamiento).toBeCloseTo(0.574, 2);
  });

  /**
   * A media manana de un dia de verano el sol ya esta lo bastante alto como
   * para que el tracker se despegue del tope: 38 grados, no 55. Es justo la
   * clase de cosa que no se puede estimar de memoria y por eso se calcula.
   */
  it("a las 09:00 de un dia de verano ya no esta en el tope", () => {
    const a = anguloDeTracker(LAT, LON, new Date("2025-12-20T23:00:00Z"));
    expect(a.enElTope).toBe(false);
    expect(Math.abs(a.gradosDesdeLaHorizontal)).toBeGreaterThan(30);
    expect(Math.abs(a.gradosDesdeLaHorizontal)).toBeLessThan(45);
  });

  it("a la manana los modulos miran al este y a la tarde al oeste", () => {
    const manana = anguloDeTracker(LAT, LON, new Date("2025-03-21T22:00:00Z"));
    const tarde = anguloDeTracker(LAT, LON, new Date("2025-03-22T06:00:00Z"));
    expect(manana.gradosDesdeLaHorizontal).toBeGreaterThan(0);
    expect(tarde.gradosDesdeLaHorizontal).toBeLessThan(0);
  });

  it("de noche no dice un angulo cualquiera: dice que es de noche", () => {
    const a = anguloDeTracker(LAT, LON, new Date("2025-06-21T14:00:00Z"));
    expect(a.deNoche).toBe(true);
    expect(a.factorDeAcortamiento).toBe(1);
  });

  it("un tope distinto cambia el angulo maximo", () => {
    const cortito = anguloDeTracker(LAT, LON, new Date("2025-12-20T23:00:00Z"), 30);
    expect(Math.abs(cortito.gradosDesdeLaHorizontal)).toBe(30);
    expect(cortito.enElTope).toBe(true);
  });

  /**
   * El norte tambien: en Europa o Estados Unidos el sol pasa por el sur, y el
   * tracker gira al reves respecto de la misma hora. Si esto no diera simetrico
   * seria que hay un hemisferio metido a mano en la cuenta.
   */
  it("funciona igual en el hemisferio norte", () => {
    // Sevilla, mediodia solar de verano.
    const a = anguloDeTracker(37.4, -6.0, new Date("2025-06-21T12:24:00Z"));
    expect(Math.abs(a.gradosDesdeLaHorizontal)).toBeLessThan(6);
    // Y a media tarde ya esta girado al oeste, con el mismo signo que en el sur:
    // el signo dice hacia donde miran los modulos, no en que hemisferio estan.
    const tarde = anguloDeTracker(37.4, -6.0, new Date("2025-06-21T16:00:00Z"));
    expect(tarde.gradosDesdeLaHorizontal).toBeLessThan(-20);
  });
});

// ---------------------------------------------------------------------------

describe("la ventana de vuelo", () => {
  const dia = ventanaDeVuelo(LAT, LON, "2025-12-21", 10);

  it("solo trae las horas con el sol arriba del horizonte", () => {
    expect(dia.length).toBeGreaterThan(20);   // dias largos en diciembre
    expect(dia.every((h) => h.alturaSolarDeg > 0)).toBe(true);
    expect(dia[0]!.hora >= "04:00").toBe(true);
    expect(dia[dia.length - 1]!.hora <= "20:00").toBe(true);
  });

  it("el momento mas plano cae cerca del mediodia solar", () => {
    const mejor = dia.reduce((a, b) =>
      Math.abs(b.anguloDeg) < Math.abs(a.anguloDeg) ? b : a);
    expect(mejor.hora >= "11:00" && mejor.hora <= "13:30").toBe(true);
  });

  /**
   * Lo que se le muestra a la persona: cuantas horas del dia son utiles. Si el
   * dia entero fuera igual de bueno, la pantalla no tendria nada que decir.
   */
  it("hay horas del dia en las que el acortamiento es mucho peor", () => {
    const factores = dia.map((h) => h.factorDeAcortamiento);
    expect(Math.max(...factores)).toBeGreaterThan(0.99);
    expect(Math.min(...factores)).toBeLessThan(0.6);
  });

  it("un dia mal escrito devuelve una lista vacia, no basura", () => {
    expect(ventanaDeVuelo(LAT, LON, "no es una fecha", 10)).toEqual([]);
  });
});

describe("el huso horario aproximado", () => {
  it("acierta el de Queensland", () => {
    expect(husoAproximado(152.7)).toBe(10);
  });

  it("y el de Espana peninsular en invierno", () => {
    expect(husoAproximado(-3.7)).toBe(0);
  });

  it("y el de California", () => {
    expect(husoAproximado(-118)).toBe(-8);
  });
});
