/**
 * La velocidad de vuelo, que hasta ahora no la calculaba nadie.
 *
 * Era un 5 m/s escrito a mano en las opciones por defecto. Alimentaba la cuenta
 * de minutos y se copiaba al archivo del dron, y ningun lado la cruzaba contra
 * la camara. El operador preguntó "¿por qué definís que el dron tiene que volar
 * a la velocidad que dice la app?" — y la respuesta honesta era que no la
 * definía: la suponía.
 *
 * Con el Matrice 4T a 50 m el techo real es 4,2 m/s. O sea que el valor por
 * defecto ya estaba por encima del límite, y el error solo se descubría
 * volando.
 */

import { describe, expect, it } from "vitest";
import {
  CAMARAS,
  OPCIONES_POR_DEFECTO,
  SEGUNDOS_DE_INTEGRACION,
  huella,
  pasoEntreFilas,
  velocidades,
} from "../app/mission";

const m4t = CAMARAS.find((c) => c.djiId === "m4t")!;
const m3t = CAMARAS.find((c) => c.djiId === "m3t" && c.imageW === 640)!;

describe("el dron que hay", () => {
  /*
    El primero de la lista no es una sugerencia: es lo que va a volar el que no
    toca nada. Estaba el Mavic 3T, que es el dron con el que se construyo el
    lector — no el que se compro.
  */
  it("el Matrice 4T es el que viene elegido", () => {
    expect(CAMARAS[0]!.djiId).toBe("m4t");
  });

  it("su termica es mas angosta que la del Mavic 3T", () => {
    // 35.4 grados contra 45.8: la pasada es un tercio mas angosta, y eso son
    // un tercio mas de pasadas para el mismo parque.
    expect(m4t.hfovDeg).toBeLessThan(m3t.hfovDeg);
    expect(m4t.hfovDeg).toBeCloseTo(35.4, 0);
  });

  it("declara los intervalos de disparo que acepta", () => {
    expect(Math.min(...m4t.intervalosS!)).toBeCloseTo(0.7, 5);
  });
});

describe("que velocidad aguanta el vuelo", () => {
  it("con el M4T a 50 m manda el arrastre, no el obturador", () => {
    const v = velocidades(m4t, 50, 0.7, 5);
    // La camara dispara cada 0.7 s, asi que el obturador da de sobra; lo que
    // limita es que la termica barre terreno mientras se lee.
    expect(v.manda).toBe("arrastre");
    expect(v.maximaMps).toBeCloseTo(4.2, 1);
  });

  /*
    El caso que motivo todo esto: el valor por defecto quedaba por encima del
    techo del dron que se compro. Si este test se pone en verde solo, es que
    alguien subio el default sin recalcular.
  */
  it("el 5 m/s que venia por defecto NO entra con el M4T a 50 m", () => {
    const v = velocidades(m4t, 50, 0.7, OPCIONES_POR_DEFECTO.speedMps);
    expect(OPCIONES_POR_DEFECTO.speedMps).toBeGreaterThan(v.maximaMps);
    expect(v.arrastrePx).toBeGreaterThan(1);
  });

  it("con el Mavic 3T manda el obturador, que no baja de 2 s", () => {
    const v = velocidades(m3t, 50, 0.7, 5);
    expect(v.manda).toBe("obturador");
    expect(v.intervaloMinimoS).toBe(2);
    expect(v.porObturadorMps).toBeCloseTo(v.disparoCadaM / 2, 5);
  });

  it("subir la altura sube el techo, por los dos motivos a la vez", () => {
    const bajo = velocidades(m4t, 40, 0.7, 5);
    const alto = velocidades(m4t, 80, 0.7, 5);
    // Mas alto: la huella es mas grande (menos fotos por metro) y el pixel
    // cubre mas terreno (el arrastre pesa menos).
    expect(alto.porObturadorMps).toBeGreaterThan(bajo.porObturadorMps);
    expect(alto.porArrastreMps).toBeGreaterThan(bajo.porArrastreMps);
  });

  it("mas solape frontal exige ir mas despacio", () => {
    const poco = velocidades(m4t, 50, 0.5, 5);
    const mucho = velocidades(m4t, 50, 0.85, 5);
    expect(mucho.disparoCadaM).toBeLessThan(poco.disparoCadaM);
    expect(mucho.porObturadorMps).toBeLessThan(poco.porObturadorMps);
  });

  it("el arrastre se mide en pixeles del terreno, no en metros", () => {
    const v = velocidades(m4t, 50, 0.7, 4);
    const gsdM = huella(50, m4t.hfovDeg) / m4t.imageW;
    expect(v.arrastrePx).toBeCloseTo((4 * SEGUNDOS_DE_INTEGRACION) / gsdM, 5);
    // A la velocidad maxima el arrastre es exactamente un pixel.
    expect(velocidades(m4t, 50, 0.7, v.porArrastreMps).arrastrePx).toBeCloseTo(1, 5);
  });

  /*
    Sin lista de intervalos hay que suponer, y hay que suponer EN CONTRA: dar
    por sentado que la camara dispara rapido es lo que deja huecos.
  */
  it("una camara que no declara intervalos se supone lenta", () => {
    const sinDatos = { ...m4t, intervalosS: undefined };
    expect(velocidades(sinDatos, 50, 0.7, 5).intervaloMinimoS).toBe(2);
  });
});

describe("el paso entre filas, medido del parque", () => {
  const fila = (x: number) => ({ a: { x, y: 0 }, b: { x, y: 60 } });

  it("saca la separacion tipica de las filas", () => {
    const filas = [0, 5, 10, 15, 20].map(fila);
    expect(pasoEntreFilas(filas)).toBeCloseTo(5, 5);
  });

  /*
    La mediana y no el promedio: un parque tiene calles internas, y una calle
    de veinte metros en el medio le sube el promedio a todas las filas.
  */
  it("una calle en el medio no le mueve el paso", () => {
    const filas = [0, 5, 10, 15, 45, 50, 55, 60].map(fila);
    expect(pasoEntreFilas(filas)).toBeCloseTo(5, 5);
  });

  it("dos filas sobre el mismo eje no cuentan como separacion", () => {
    // R1 y R2 del mismo tracker caen en la misma linea: si contaran, el paso
    // daria cero.
    const filas = [0, 0, 5, 5, 10, 10].map(fila);
    expect(pasoEntreFilas(filas)).toBeCloseTo(5, 5);
  });

  it("sin filas suficientes no inventa un numero", () => {
    expect(pasoEntreFilas([fila(0), fila(5)])).toBeNull();
  });
});
