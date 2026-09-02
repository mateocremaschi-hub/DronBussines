/**
 * Que defecto es, sacado de la forma de la mancha.
 *
 * El dato que abrio esto: la empresa que hace la termografia en Edenvale
 * entrega 3.156 hallazgos y NO los clasifica por temperatura. Las medianas de
 * ΔT por tipo se pisan todas —un "foreign object" de 49 K y un "isolated" de
 * 0,6 K en el mismo archivo— asi que un umbral no puede ser el criterio. Lo que
 * los separa es la geometria del patron, que delata la falla electrica.
 *
 * Cada caso de aca es uno de esos patrones, dibujado a mano sobre una grilla
 * de 12 x 6 —que es la forma de un modulo de 72 celdas— para poder probar la
 * clasificacion sin una sola foto.
 */

import { describe, expect, it } from "vitest";
import { claseSugerida, clasificarPatron, type Retrato } from "../app/patron";

const FILAS = 12, COLUMNAS = 6;

/**
 * Un modulo dibujado con letras, para que el caso se LEA.
 *
 * Cada renglon es una fila de celdas a lo largo del modulo; un punto es celda
 * a temperatura normal y una `X` es celda caliente. Escribir el patron a mano
 * es la unica forma de que el test diga que esta probando.
 */
function retrato(dibujo: string, base = 45, calienteK = 12): Retrato {
  const filas = dibujo.trim().split("\n").map((l) => l.trim());
  expect(filas.length).toBe(FILAS);
  const celdas = new Float32Array(FILAS * COLUMNAS);
  filas.forEach((linea, f) => {
    expect(linea.length).toBe(COLUMNAS);
    for (let c = 0; c < COLUMNAS; c++) {
      celdas[f * COLUMNAS + c] = base + (linea[c] === "X" ? calienteK : 0);
    }
  });
  return { celdas, filas: FILAS, columnas: COLUMNAS };
}

const SANO = retrato(`
  ......
  ......
  ......
  ......
  ......
  ......
  ......
  ......
  ......
  ......
  ......
  ......`);

describe("el diodo de bypass", () => {
  /*
    El patron mas duro que hay, y el que mas aguanta la verificacion de campo:
    en el informe real, 151 de 155 confirmados. Un diodo puentea una substring
    entera, que fisicamente es un bloque que ocupa TODO el ancho del modulo y
    un tercio de su largo. Ninguna otra falla dibuja eso.
  */
  it("una franja de un tercio que cruza el modulo", () => {
    const c = clasificarPatron(retrato(`
      ......
      ......
      ......
      ......
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      ......
      ......
      ......
      ......`), 0.5);
    expect(c.patron).toBe("diodo");
    expect(c.confianza).toBe("alta");
    expect(c.anomalia).toBe("Diodo de bypass");
    expect(c.porQue).toMatch(/33 % de su largo/);
  });

  it("tambien la mitad del modulo", () => {
    const c = clasificarPatron(retrato(`
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      ......
      ......
      ......
      ......
      ......
      ......`), 0.5);
    expect(c.patron).toBe("diodo");
  });

  /*
    Que CRUCE es la mitad de la definicion. Una mancha alargada que va a lo
    largo del modulo, sin llegar a los dos bordes, no es una substring — y
    llamarla diodo manda a reclamar una garantia que va a rebotar.
  */
  it("una mancha alargada que no cruza no es un diodo", () => {
    const c = clasificarPatron(retrato(`
      ......
      ......
      ..XX..
      ..XX..
      ..XX..
      ..XX..
      ......
      ......
      ......
      ......
      ......
      ......`), 0.5);
    expect(c.patron).not.toBe("diodo");
  });

  it("una sola fila caliente es demasiado fina para ser una substring", () => {
    const c = clasificarPatron(retrato(`
      ......
      ......
      ......
      ......
      ......
      XXXXXX
      ......
      ......
      ......
      ......
      ......
      ......`), 0.5);
    expect(c.patron).not.toBe("diodo");
  });
});

describe("el modulo entero", () => {
  /*
    El caso mas frecuente del informe real —768 de 3.156— y el unico que la
    norma marca como critico. Y el que no se puede ver mirando ADENTRO del
    modulo: esta caliente y parejo, asi que su retrato interno no tiene ninguna
    mancha. Se lo reconoce por estar entero encima de sus hermanos de string.
  */
  it("sin mancha adentro pero caliente contra su string", () => {
    const c = clasificarPatron(SANO, 6.2);
    expect(c.patron).toBe("modulo-completo");
    expect(c.confianza).toBe("alta");
    expect(c.anomalia).toBe("Modulo completo");
    expect(c.porQue).toMatch(/circuito abierto/);
  });

  /*
    Dos de las tres substrings puenteadas: dos tercios del modulo calientes.

    Este caso rompio la primera version, y por una razon que valia la pena: la
    referencia interna era la MEDIANA, y la mediana sigue a la mayoria. Con dos
    tercios calientes la mediana cae adentro de la zona caliente y el modulo
    aparece sin ninguna mancha — el defecto mas grande, invisible. Ahora la
    referencia es el percentil 25, que se queda en la parte fria mientras quede
    un cuarto de modulo sano.
  */
  it("con dos tercios del modulo despegados", () => {
    const c = clasificarPatron(retrato(`
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      XXXXXX
      ......
      ......
      ......
      ......`), 4.5);
    expect(c.fraccionCaliente).toBeGreaterThan(0.6);
    expect(c.patron).toBe("modulo-completo");
  });

  /*
    Y el caso de al lado, que es el que importa no confundir: un modulo sin
    mancha y SIN despegarse de sus vecinos no es un defecto. Es lo que pasa con
    un hallazgo que quedo en el borde del cuadro.
  */
  it("sin mancha y sin despegarse del string no es nada", () => {
    const c = clasificarPatron(SANO, 0.3);
    expect(c.patron).toBe("sin-patron");
    expect(c.confianza).toBe("baja");
    expect(c.anomalia).toBeUndefined();
  });
});

describe("las celdas calientes", () => {
  it("una sola mancha chica es un punto caliente", () => {
    const c = clasificarPatron(retrato(`
      ......
      ......
      ......
      ...X..
      ......
      ......
      ......
      ......
      ......
      ......
      ......
      ......`), 0.8);
    expect(c.patron).toBe("punto-caliente");
    expect(c.anomalia).toBe("Punto caliente");
    expect(c.grumos).toBe(1);
  });

  it("varias manchas separadas son celda multiple", () => {
    const c = clasificarPatron(retrato(`
      ......
      .X....
      ......
      ......
      ....X.
      ......
      ......
      ..X...
      ......
      ......
      ......
      ......`), 0.8);
    expect(c.patron).toBe("celda-multiple");
    expect(c.grumos).toBe(3);
  });

  /*
    Vecindad de a cuatro y no de a ocho. Dos celdas que solo se tocan por la
    esquina son dos defectos; contandolas como uno, una diagonal de celdas
    sueltas —el caso tipico de celda multiple— saldria como punto caliente.
  */
  it("dos celdas en diagonal son dos manchas, no una", () => {
    const c = clasificarPatron(retrato(`
      ......
      ......
      ......
      ..X...
      ...X..
      ......
      ......
      ......
      ......
      ......
      ......
      ......`), 0.8);
    expect(c.grumos).toBe(2);
    expect(c.patron).toBe("celda-multiple");
  });

  /*
    La confianza no es un adorno: decide que se acepta sin mirar y que va si o
    si a la revision. La verificacion de campo del informe real dice cuanto vale
    cada una — el diodo, 151 de 155; el multi hotspot, 41 de 71, con 11 que eran
    suciedad. Una mancha chica es JUSTO lo que se confunde con tierra.
  */
  it("las manchas de celda salen con poca confianza y el diodo con mucha", () => {
    const punto = clasificarPatron(retrato(`
      ......
      ......
      ......
      ...X..
      ......
      ......
      ......
      ......
      ......
      ......
      ......
      ......`), 0.8);
    const multi = clasificarPatron(retrato(`
      ......
      .X....
      ......
      ....X.
      ......
      ......
      ......
      ......
      ......
      ......
      ......
      ......`), 0.8);
    expect(multi.confianza).toBe("baja");
    expect(punto.confianza).not.toBe("alta");
  });

  it("el motivo se puede leer y discutir", () => {
    const c = clasificarPatron(retrato(`
      ......
      ......
      ......
      ...X..
      ......
      ......
      ......
      ......
      ......
      ......
      ......
      ......`), 0.8);
    expect(c.porQue).toMatch(/una sola zona caliente/i);
    // Y avisa de lo que la termica NO puede saber.
    expect(c.porQue).toMatch(/tierra|foto/i);
  });
});

describe("el umbral", () => {
  /*
    Tres kelvin sobre la mediana del propio modulo: bien arriba del ruido de la
    camara y bien abajo de cualquier patron real. Una diferencia de un grado no
    es una mancha.
  */
  it("un grado de diferencia no dibuja ninguna mancha", () => {
    const c = clasificarPatron(retrato(`
      ......
      ......
      ......
      ...X..
      ......
      ......
      ......
      ......
      ......
      ......
      ......
      ......`, 45, 1), 0.2);
    expect(c.fraccionCaliente).toBe(0);
    expect(c.patron).toBe("sin-patron");
  });
});

// ---------------------------------------------------------------------------

/**
 * Que tan urgente es: la clase IEC.
 *
 * "Esta parte no la entiendo para que sirve." Sirve para lo mas util del
 * entregable: la anomalia dice QUE tiene el panel, la clase dice QUE HACER y
 * CUANDO. El que recibe el informe no sale a caminar por "diodo de bypass";
 * sale por los de clase 3.
 *
 * Lo que se prueba es que salga de lo MEDIDO y no de una tabla por tipo — que
 * es como la resuelve la empresa de al lado, donde Severity e IEC salen 1 a 1
 * del Anomaly Type en las 3.156 filas, sin una sola excepcion, y por eso un
 * multi hotspot de 22 K les queda "Minor".
 */
describe("que tan urgente es", () => {
  const base = { deltaT: 4, criticaModulo: 20, criticaInterna: 25 };

  it("sin patron no hay nada que hacer", () => {
    expect(claseSugerida({ ...base, patron: "sin-patron", deltaT: 0.2 }).klass).toBe(1);
  });

  it("un modulo entero perdido se arregla en el proximo mantenimiento", () => {
    const c = claseSugerida({ ...base, patron: "modulo-completo", deltaT: 6 });
    expect(c.klass).toBe(2);
    expect(c.porQue).toMatch(/no entrega corriente/);
  });

  /*
    El nucleo: la temperatura manda sobre el tipo. Una celda muy caliente es
    riesgo fisico —degrada el encapsulante y puede terminar en incendio— y eso
    no depende de si la mancha es una celda o tres.
  */
  it("una celda muy caliente es accion inmediata aunque sea un punto chico", () => {
    const c = claseSugerida({ ...base, patron: "punto-caliente", deltaInterno: 30 });
    expect(c.klass).toBe(3);
    expect(c.porQue).toMatch(/incendio/);
  });

  it("y la misma forma con poca temperatura, no", () => {
    const c = claseSugerida({ ...base, patron: "punto-caliente", deltaInterno: 6 });
    expect(c.klass).toBe(2);
  });

  /*
    La prueba de que NO es una tabla por tipo: dos hallazgos del MISMO tipo con
    temperaturas distintas caen en clases distintas. Con la tabla fija de la
    otra empresa esto seria imposible.
  */
  it("dos hallazgos del mismo tipo pueden caer en clases distintas", () => {
    const frio = claseSugerida({ ...base, patron: "celda-multiple", deltaInterno: 5 });
    const caliente = claseSugerida({ ...base, patron: "celda-multiple", deltaInterno: 40 });
    expect(frio.klass).not.toBe(caliente.klass);
  });

  it("un modulo muy por encima de su string tambien es inmediato", () => {
    expect(claseSugerida({ ...base, patron: "modulo-completo", deltaT: 25 }).klass).toBe(3);
  });

  /*
    La clase usa los MISMOS umbrales con los que se clasifica la severidad del
    vuelo. Si tuviera los suyos, mover un umbral dejaria un informe que se
    contradice: severidad critica y clase 2 en la misma fila.
  */
  it("mover el umbral del vuelo mueve la clase", () => {
    const conUmbralAlto = claseSugerida({ ...base, patron: "punto-caliente", deltaInterno: 30, criticaInterna: 50 });
    const conUmbralBajo = claseSugerida({ ...base, patron: "punto-caliente", deltaInterno: 30, criticaInterna: 25 });
    expect(conUmbralAlto.klass).toBe(2);
    expect(conUmbralBajo.klass).toBe(3);
  });

  it("siempre dice por que, para poder desmentirla", () => {
    for (const p of ["sin-patron", "diodo", "modulo-completo", "punto-caliente", "celda-multiple"] as const) {
      expect(claseSugerida({ ...base, patron: p }).porQue.length).toBeGreaterThan(20);
    }
  });
});
