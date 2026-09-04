/**
 * Un string entero desconectado: el defecto que era invisible.
 *
 * Salio de una pregunta suya —"le saque una foto a dos strings que estaban de
 * diferente color porque estaban desconectados, que puedo probar con eso"— y de
 * ir a mirar el codigo antes de contestar.
 *
 * El motor compara cada modulo contra sus hermanos del MISMO string. Si el
 * string entero esta desconectado, todos sus modulos estan igual de calientes:
 * la mediana del string sube con ellos, cada modulo da ΔT cero, ninguno sale
 * anomalo. Cero hallazgos y cero eventos, con dos strings apagados delante de
 * la camara.
 *
 * Y no es un panel: son 28. Es el defecto mas caro que puede haber en la lista.
 */

import { describe, expect, it } from "vitest";
import { comparar, eventosDeString, UMBRALES, type Muestra } from "../app/detect";

/** Un modulo del string `chunk` de la fila `05-042-R1`. */
const m = (pos: number, celsius: number, chunk = 0, rowId = "05-042-R1"): Muestra => ({
  modulo: {
    rowId, block: rowId.slice(0, 2), tracker: rowId.slice(0, 6), row: "R1",
    chunkIndex: chunk, stringNumber: chunk + 1, module: pos, positionInRow: pos + chunk * 28,
    x: pos * 1.14, y: 0,
  },
  celsius, pixeles: 600, fileName: "t.jpg", distanciaAlCentroM: 1,
});

/** Una fila con dos strings: el 1 desconectado a 60 °C, el 2 sano a 45 °C. */
const unoApagado = [
  ...Array.from({ length: 28 }, (_, i) => m(i + 1, 60, 0)),
  ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45, 1)),
];

describe("un string entero mas caliente que sus vecinos", () => {
  /*
    Esto es lo que el motor NO puede ver, y esta bien que no lo vea asi: la
    comparacion contra los hermanos del propio string es la que encuentra el
    modulo suelto, y por definicion no puede encontrar algo que le pasa a todo
    el string. El test lo deja fijado para que quede claro por que hace falta
    el segundo nivel de comparacion.
  */
  it("ningun modulo sale anomalo, porque se comparan entre ellos", () => {
    const h = comparar(unoApagado, UMBRALES);
    expect(h.filter((x) => x.severidad !== "normal")).toHaveLength(0);
    expect(h.find((x) => x.modulo.chunkIndex === 0)!.deltaT).toBeCloseTo(0, 5);
  });

  it("pero el string SI sale, comparado contra el otro string de su fila", () => {
    const ev = eventosDeString(comparar(unoApagado, UMBRALES), 28);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.motivo).toBe("string-entero");
    expect(ev[0]!.stringNumber).toBe(1);
    expect(ev[0]!.deltaTMedio).toBeCloseTo(15, 0);
    expect(ev[0]!.modulos).toBe(28);
  });

  it("y no reporta el string sano", () => {
    const ev = eventosDeString(comparar(unoApagado, UMBRALES), 28);
    expect(ev.every((e) => e.stringNumber === 1)).toBe(true);
  });

  /*
    Sacarse a si mismo del vecindario importa. Con dos strings por fila,
    incluirse es compararse contra el promedio de uno mismo y el vecino — la
    diferencia se parte al medio y con un umbral de 4 °C un caso real de 8 °C
    se cae.
  */
  it("se compara contra los OTROS, no contra el promedio que lo incluye", () => {
    const ochoGrados = [
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 53, 0)),
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45, 1)),
    ];
    const ev = eventosDeString(comparar(ochoGrados, UMBRALES), 28);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.deltaTMedio).toBeCloseTo(8, 0);
  });

  /*
    El caso de verdad, medido. El 3 de septiembre saco una foto de un string
    desconectado en Edenvale: la fila mala dio 45,2 °C y las cinco sanas de la
    misma foto entre 40,7 y 41,5. ΔT = 4,0 contra un umbral que era de 4 — un
    decimo menos y el defecto mas caro de la lista se perdia en silencio.

    Este test fija ese numero. Si alguien vuelve a subir el umbral, se rompe
    aca con la foto real de por medio.
  */
  it("el string desconectado que medimos en el campo se reporta", () => {
    const comoEnEdenvale = [
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45.2, 0)),
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 41.2, 1)),
    ];
    const ev = eventosDeString(comparar(comoEnEdenvale, UMBRALES), 28);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.motivo).toBe("string-entero");
    expect(ev[0]!.stringNumber).toBe(1);
    expect(ev[0]!.deltaTMedio).toBeCloseTo(4, 1);
  });

  /*
    Y la contracara: las filas sanas de esa misma foto se despegan hasta 0,8 °C
    entre si. Esa dispersion no puede reportar nada.
  */
  it("la dispersion entre filas sanas de esa misma foto no reporta nada", () => {
    const sanas = [
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 41.5, 0)),
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 40.7, 1)),
    ];
    expect(eventosDeString(comparar(sanas, UMBRALES), 28)).toHaveLength(0);
  });

  it("dos strings sanos no reportan nada", () => {
    const sanos = [
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45.2, 0)),
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45, 1)),
    ];
    expect(eventosDeString(comparar(sanos, UMBRALES), 28)).toHaveLength(0);
  });

  /*
    Sin vecinos en la fila se sube a los del bloque. Un tracker de un solo
    string existe —las filas cortas de las puntas— y no puede quedar sin
    chequear por eso.
  */
  it("un string solo en su fila se compara contra los del bloque", () => {
    const muestras = [
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 60, 0, "05-042-R1")),
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45, 0, "05-043-R1")),
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45, 0, "05-044-R1")),
    ];
    const ev = eventosDeString(comparar(muestras, UMBRALES), 28);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.rowId).toBe("05-042-R1");
  });

  it("con pocos modulos medidos no se le cree a la temperatura del string", () => {
    const pocos = [
      ...Array.from({ length: 3 }, (_, i) => m(i + 1, 70, 0)),
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45, 1)),
    ];
    expect(eventosDeString(comparar(pocos, UMBRALES), 28)
      .filter((e) => e.motivo === "string-entero")).toHaveLength(0);
  });

  /*
    El camino viejo, que estaba muerto.

    Agrupaba modulos anomalos cuando pasaban de la MITAD del string, y eso era
    inalcanzable: medido, con 13 de 28 calientes salen 13 hallazgos anomalos y
    ningun evento —13/28 no llega a la mitad— y con 14 de 28 la mediana del
    string se corre a la zona caliente, todos los ΔT dan cero y no queda un solo
    modulo anomalo que agrupar. El umbral solo se alcanzaba justo donde el
    sintoma desaparece.

    Con un tercio se alcanza de verdad, y dice algo: cuando un tercio del string
    esta anomalo, el problema es del string y no de N paneles.
  */
  it("con un tercio del string anomalo se reporta el string, no los modulos", () => {
    const desparejo = [
      ...Array.from({ length: 12 }, (_, i) => m(i + 1, 62, 0)),
      ...Array.from({ length: 16 }, (_, i) => m(i + 13, 45, 0)),
      ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45, 1)),
    ];
    const ev = eventosDeString(comparar(desparejo, UMBRALES), 28);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.motivo).toBe("modulos-calientes");
    expect(ev[0]!.modulos).toBe(12);
  });

  /*
    Y el punto de todo esto: los dos caminos juntos cubren el rango entero. Con
    la mediana corrida —de la mitad para arriba— entra el camino nuevo; abajo,
    el viejo. Sin el nuevo, un string apagado de 14 modulos para arriba no
    aparecia en ningun lado.
  */
  it("los dos caminos cubren todas las fracciones", () => {
    for (const n of [10, 12, 14, 18, 24, 28]) {
      const ms = [
        ...Array.from({ length: n }, (_, i) => m(i + 1, 62, 0)),
        ...Array.from({ length: 28 - n }, (_, i) => m(i + n + 1, 45, 0)),
        ...Array.from({ length: 28 }, (_, i) => m(i + 1, 45, 1)),
      ];
      const ev = eventosDeString(comparar(ms, UMBRALES), 28);
      expect(ev, `con ${n} de 28 calientes`).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Un diodo de bypass no se quema en fila.
 *
 * Una caja de medicion mal puesta dibuja una franja caliente en su borde, y
 * como el error de encuadre es de la FILA, la dibuja en todos los modulos de
 * esa fila y siempre en el mismo extremo. Sobre el vuelo real del 3 de
 * septiembre eso ponia seis "diodos de bypass" en una misma fila, los seis con
 * la franja en las primeras dos celdas del retrato.
 *
 * Mirando un modulo solo no hay forma de saberlo: esa franja se ve igual que
 * la substring mas angosta que existe. Se ve mirando la fila.
 */
describe("una fila entera con la misma franja es el recuadro, no diodos", () => {
  /** Un retrato con una franja caliente en las primeras `alto` celdas. */
  const conFranja = (alto: number) => {
    const filas = 12, columnas = 6;
    const celdas = new Float32Array(filas * columnas).fill(42);
    for (let f = 0; f < alto; f++) for (let c = 0; c < columnas; c++) celdas[f * columnas + c] = 50;
    return { celdas, filas, columnas };
  };

  /*
    Los modulos con franja se reparten SALTEADOS, no seguidos.

    Dos modulos pegados con la misma franja en el mismo extremo ya no son dos
    diodos: es el borde del panel, y `comparar` los baja de categoria por
    vecindad. Ponerlos seguidos hacia que esta prueba midiera el filtro de
    vecinos creyendo que medía el de fila.
  */
  const fila = (cuantosConFranja: number) =>
    Array.from({ length: 20 }, (_, i) => ({
      ...m(i + 1, 45, 0),
      fileName: "DJI_0001_T.JPG",
      pixelesPorCelda: 9,
      puntoCalienteC: 45,
      ...(i % 2 === 0 && i / 2 < cuantosConFranja
        ? { retrato: conFranja(3) }
        : { retrato: conFranja(0) }),
    }));

  it("dos modulos de veinte con franja se reportan", () => {
    const hs = comparar(fila(2), UMBRALES);
    expect(hs.filter((h) => h.patron?.patron === "diodo")).toHaveLength(2);
  });

  it("diez de veinte no: eso es el borde del recuadro", () => {
    const hs = comparar(fila(10), UMBRALES);
    expect(hs.filter((h) => h.patron?.patron === "diodo")).toHaveLength(0);
    // Y lo dice, en vez de borrarlos en silencio.
    const uno = hs.find((h) => h.patron?.patron === "sin-patron")!;
    expect(uno.patron!.porQue).toContain("fila");
  });
});
