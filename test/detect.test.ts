/**
 * Deteccion por comparacion con los vecinos.
 *
 * Lo que se prueba no es que encuentre calor: es que compare contra lo que
 * corresponde. Un modulo a 60 grados no es una anomalia si todo el string
 * esta a 60 —eso es un mediodia de verano— y uno a 45 si es una anomalia
 * cuando sus 27 vecinos estan a 40.
 *
 * Por eso el vecindario es ELECTRICO y no geometrico: los modulos de un mismo
 * string comparten corriente, orientacion, edad y suciedad. Es la comparacion
 * que aisla el defecto de todo lo demas.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { Acumulador, clasificar, comparar, eventosDeString, resumir, UMBRALES, type Muestra } from "../app/detect";
import { camaraDesdeEquivalente35 } from "../app/mission";
import { compileFarm, makeFrame, modulesOfRow, toGeo } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { applyStrings } from "../app/strings";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const N = profile.topology.modulesPerString; // 28

const row = makeRow(
  {
    id: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north",
  },
  profile,
);
const conStrings = applyStrings([row], {
  fieldIndex: 3,
  byRow: new Map([["05-042-R1", { labels: ["S-1.2.15.1", "S-1.2.15.2"], dcBox: "DCB-1.2.15" }]]),
  chains: new Map([["05-042-R1", { pos: 1, posTotal: 1 }]]),
});
const farm = compileFarm(profile, conStrings);
const modulos = modulesOfRow(farm.rows[0]!, farm);

/** Muestras de toda la fila a una temperatura base, con los retoques que se pidan. */
const muestras = (
  base: number,
  retoques: Record<number, number> = {},
  /** Cuanto se despega el punto mas caliente del propio modulo. */
  calientes: Record<number, number> = {},
): Muestra[] =>
  modulos.map((m) => {
    const celsius = base + (retoques[m.positionInRow] ?? 0);
    return {
      modulo: m,
      celsius,
      pixeles: 40,
      // Una muestra real siempre trae las dos cosas. Por defecto el modulo es
      // parejo por dentro: su zona mas caliente esta a su propia temperatura.
      puntoCalienteC: celsius + (calientes[m.positionInRow] ?? 0),
      pixelesPorCelda: 12,
      fileName: "DJI_0001_T.JPG",
      distanciaAlCentroM: 3,
    };
  });

// ---------------------------------------------------------------------------

describe("recorrer los modulos de una fila", () => {
  it("los enumera todos, una vez cada uno", () => {
    expect(modulos).toHaveLength(N * profile.topology.stringsPerRow);
    expect(new Set(modulos.map((m) => m.positionInRow)).size).toBe(modulos.length);
  });

  it("les pone la etiqueta real del string", () => {
    expect(modulos[0]!.stringLabel).toBeTruthy();
    expect(new Set(modulos.map((m) => m.stringLabel)).size).toBe(2);
  });

  // El recorrido de ida y el de vuelta tienen que dar lo mismo. Si no, la
  // deteccion mediría un modulo y lo reportaría como otro.
  it("cada modulo numera del 1 al 28 dentro de su string", () => {
    for (const chunk of [0, 1]) {
      const nums = modulos.filter((m) => m.chunkIndex === chunk).map((m) => m.module).sort((a, b) => a - b);
      expect(nums).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    }
  });
});

// ---------------------------------------------------------------------------

describe("comparar contra los vecinos", () => {
  it("un parque entero caliente no tiene ninguna anomalia", () => {
    // Mediodia de verano: todo a 62 grados. No hay nada que reportar.
    const h = comparar(muestras(62));
    expect(h.every((x) => x.severidad === "normal")).toBe(true);
    expect(h.every((x) => Math.abs(x.deltaT) < 0.001)).toBe(true);
  });

  it("un modulo por encima de sus vecinos si lo es, aunque el parque este frio", () => {
    const h = comparar(muestras(22, { 5: 15 }));
    const caliente = h.find((x) => x.modulo.positionInRow === 5)!;
    expect(caliente.deltaT).toBeCloseTo(15, 1);
    expect(caliente.severidad).toBe("moderada");
    expect(h.filter((x) => x.severidad !== "normal")).toHaveLength(1);
  });

  it("gradua la severidad por cuanto se despega", () => {
    const h = comparar(muestras(40, { 3: 4, 7: 12, 11: 25 }));
    const pos = (p: number) => h.find((x) => x.modulo.positionInRow === p)!.severidad;
    expect(pos(3)).toBe("leve");
    expect(pos(7)).toBe("moderada");
    expect(pos(11)).toBe("critica");
  });

  // El punto entero del vecindario electrico.
  it("compara contra el propio string, no contra la fila entera", () => {
    // El string lejano entero 8 grados mas caliente que el cercano.
    const m = muestras(40).map((x) =>
      x.modulo.chunkIndex === 1 ? { ...x, celsius: 48 } : x,
    );
    const h = comparar(m);
    // Ningun modulo se despega DE SU STRING, asi que no hay anomalias de modulo.
    expect(h.every((x) => x.severidad === "normal")).toBe(true);
    expect(h.every((x) => x.ambito === "string")).toBe(true);
  });

  it("dice contra que se comparo cuando no alcanzan los vecinos", () => {
    const h = comparar(muestras(40).slice(0, 3));
    expect(h.every((x) => x.ambito === "vuelo")).toBe(true);
    expect(h[0]!.vecinos).toBe(2);
  });

  /*
    Y sin hermanos no hace hallazgo. En el vuelo del bloque 2 las filas del
    bloque 1 asoman por el borde del cuadro y leen 44-47 °C con los trackers
    en otra posicion; un modulo de ahi, visto una sola vez y sin hermanos
    medidos, salia a +9 °C contra la mediana del vuelo. Eso no es comparar.
  */
  /*
    Una sola medicion desde la esquina del cuadro tampoco hace hallazgo de
    modulo: ahi la correccion de vinieteo deja hasta tres grados y medio sin
    corregir, y en el vuelo del bloque 2 tres modulos de una fila vecina
    salieron "modulo completo" a +3 desde una esquina, sin verse en ninguna
    otra foto. Vista dos veces, o cerca del centro, la misma medicion cuenta.
  */
  it("una sola medicion desde la esquina del cuadro no hace hallazgo de modulo", () => {
    const caja = (cx: number, cy: number) => ({ cx, cy, largo: 14, cruzado: 28, rotRad: 0, ancho: 640, alto: 512 });
    const enLaEsquina = muestras(40, { 3: 5 }).map((x) =>
      x.modulo.positionInRow === 3 ? { ...x, caja: caja(600, 480) } : x);
    expect(comparar(enLaEsquina).find((x) => x.modulo.positionInRow === 3)!.severidad).toBe("normal");

    const enElCentro = muestras(40, { 3: 5 }).map((x) =>
      x.modulo.positionInRow === 3 ? { ...x, caja: caja(330, 250) } : x);
    expect(comparar(enElCentro).find((x) => x.modulo.positionInRow === 3)!.severidad).toBe("leve");

    const vistaDosVeces = muestras(40, { 3: 5 }).map((x) =>
      x.modulo.positionInRow === 3 ? { ...x, caja: caja(600, 480), otrasC: [45] } : x);
    expect(comparar(vistaDosVeces).find((x) => x.modulo.positionInRow === 3)!.severidad).toBe("leve");
  });

  it("sin hermanos de string ni de fila, el ΔT no hace hallazgo", () => {
    const m = muestras(40, { 1: 12 }).slice(0, 3);
    const h = comparar(m);
    const caliente = h.find((x) => x.modulo.positionInRow === 1)!;
    expect(caliente.ambito).toBe("vuelo");
    expect(caliente.deltaT).toBeGreaterThan(5);
    expect(caliente.severidad).toBe("normal");
    expect(caliente.peor).toBe("normal");
  });
});

// ---------------------------------------------------------------------------

describe("cuando el problema es del string entero", () => {
  it("junta un string caliente en un solo evento", () => {
    // Todo el string cercano 12 grados arriba: una conexion, no 28 modulos.
    const m = muestras(40).map((x) =>
      x.modulo.chunkIndex === 0 ? { ...x, celsius: 52 } : x,
    );
    // Comparado contra su propio string no se ve; contra la fila si.
    const h = comparar(m).map((x) =>
      x.modulo.chunkIndex === 0 ? { ...x, deltaT: 12, severidad: "moderada" as const } : x,
    );
    const ev = eventosDeString(h, N);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.modulos).toBe(N);
    expect(ev[0]!.fraccion).toBeCloseTo(1, 3);
    expect(ev[0]!.deltaTMedio).toBeCloseTo(12, 3);
    expect(ev[0]!.stringLabel).toBeTruthy();
  });

  it("no junta unos pocos modulos sueltos, que si son defectos de modulo", () => {
    const h = comparar(muestras(40, { 2: 12, 9: 12, 15: 12 }));
    expect(eventosDeString(h, N)).toHaveLength(0);
  });

  /**
   * El largo del string se puede preguntar por FILA.
   *
   * Salia de `profile.topology.modulesPerString`, un solo numero para todo el
   * parque, y un parque puede mezclar trackers largos con cortos. Dividir los
   * hallazgos de un tracker corto por el largo del otro tipo lo muestra medio
   * apagado cuando esta apagado entero, y con un poco menos lo saca del
   * agrupamiento: vuelven a leerse como veinte defectos de modulo sueltos.
   */
  it("acepta el largo del string por fila, para un parque de dos tipos de tracker", () => {
    const m = muestras(40).map((x) => (x.modulo.chunkIndex === 0 ? { ...x, celsius: 52 } : x));
    const h = comparar(m).map((x) =>
      x.modulo.chunkIndex === 0 ? { ...x, deltaT: 12, severidad: "moderada" as const } : x,
    );

    const largoDeLaFila = (rowId: string) => (rowId === "05-042-R1" ? N : 56);
    expect(eventosDeString(h, largoDeLaFila)[0]!.fraccion).toBeCloseTo(1, 3);
    // Con el largo del otro tipo de tracker, los mismos 28 dan media fila.
    expect(eventosDeString(h, 56)[0]!.fraccion).toBeCloseTo(0.5, 3);

    /*
      Y con un poco menos ya no hay evento: 15 de 28 es medio tracker, 15 de 56
      es un cuarto. El numero se movio de 20 a 15 cuando el umbral bajo de la
      mitad a un tercio — la mitad era inalcanzable, porque al llegar ahi la
      mediana del string se corre a la zona caliente y no queda ningun modulo
      anomalo que agrupar.
    */
    const parcial = h.map((x) =>
      x.modulo.chunkIndex === 0 && x.modulo.positionInRow > 15
        ? { ...x, severidad: "normal" as const }
        : x,
    );
    /*
      Se filtra por MOTIVO. Desde que existe la deteccion del string entero, un
      string caliente sale igual aunque ningun modulo llegue a la fraccion —
      porque se lo compara contra los otros strings, no contra el conteo. Lo
      que este test mira es el otro camino, el que agrupa modulos anomalos, y
      ese si depende del largo del string de la fila.
    */
    const porConteo = (largo: Parameters<typeof eventosDeString>[1]) =>
      eventosDeString(parcial, largo).filter((e) => e.motivo === "modulos-calientes");
    expect(porConteo(largoDeLaFila)).toHaveLength(1);
    expect(porConteo(56)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("declarar lo que el vuelo NO permite afirmar", () => {
  it("avisa que a esa resolucion no se ven celdas", () => {
    // 14.9 cm/px: el vuelo real de Edenvale a 113 m.
    const r = resumir(comparar(muestras(40)), 56, [], 14.9);
    expect(r.limitaciones.join(" ")).toMatch(/una celda de 16 cm entra en 1\.2 pixeles/);
    expect(r.limitaciones.join(" ")).toMatch(/no celdas/);
  });

  it("no se queja cuando el vuelo si resuelve la celda", () => {
    const r = resumir(comparar(muestras(40)), 56, [], 4.5);
    expect(r.limitaciones.join(" ")).not.toMatch(/celda/);
  });

  it("cuenta los modulos que no cayeron en ninguna foto", () => {
    const r = resumir(comparar(muestras(40).slice(0, 20)), 56, [], 4.5);
    expect(r.sinMedir).toBe(36);
    expect(r.limitaciones.join(" ")).toMatch(/36 modulos del parque no cayeron/);
  });

  it("cuenta bien las severidades", () => {
    const h = comparar(muestras(40, { 3: 4, 7: 12, 11: 25, 19: 22 }));
    const r = resumir(h, 56, [], 4.5);
    expect(r).toMatchObject({ leves: 1, moderadas: 1, criticas: 2, modulosMedidos: 56 });
  });
});

describe("los umbrales son una convencion declarada, no la norma", () => {
  it("se pueden cambiar sin tocar el codigo", () => {
    const estricto = comparar(muestras(40, { 5: 4 }), { leve: 2, moderada: 3, critica: 4 });
    expect(estricto.find((x) => x.modulo.positionInRow === 5)!.severidad).toBe("critica");
    expect(UMBRALES.leve).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// El borde del cuadro
// ---------------------------------------------------------------------------

/**
 * Un modulo cortado por el borde no se mide.
 *
 * Esta es la regla que decide si los hallazgos son defectos o son el borde de
 * la foto, y hace falta probarla con una camara de verdad y no con muestras
 * escritas a mano, porque el error nacia en el muestreo y no en la comparacion.
 *
 * `pixelOf` acepta un modulo cuando su CENTRO cae adentro. Un modulo cuyo
 * centro esta a un centimetro del borde pasaba ese filtro y despues se medía
 * sobre la ultima fila de pixeles del sensor — que es donde el barril de la
 * lente irradia y donde el vidrio visto de costado refleja el cielo. De ahi
 * salian diferencias de varios grados que no eran ningun defecto.
 */
describe("el borde del cuadro", () => {
  const camara = camaraDesdeEquivalente35("prueba", 40, 640, 512);
  const marco = makeFrame(farm.origin.lat, farm.origin.lon);
  const centroFila = farm.rows[0]!;

  /** Una termica pareja, sin ninguna anomalia. Todo el cuadro a la misma temperatura. */
  const termicaPareja = (c: number) => ({
    width: 640, height: 512,
    celsius: new Float32Array(640 * 512).fill(c),
    escala: "de prueba",
    escalaAuto: "de prueba",
    topeC: 999,
    fraccionEnElTope: 0,
  });

  /** El centro geometrico de la fila, en latitud y longitud. */
  const centro = (() => {
    const ms = modulesOfRow(centroFila, farm);
    const x = ms.reduce((a, m) => a + m.x, 0) / ms.length;
    const y = ms.reduce((a, m) => a + m.y, 0) / ms.length;
    return toGeo(marco, x, y);
  })();

  const volar = (lat: number, lon: number, altura: number) => {
    const acc = new Acumulador(farm, marco, {
      camera: camara, moduloAnchoM: profile.module.widthMm / 1000, moduloLargoM: 2.28,
    });
    acc.agregar({
      fileName: "T.JPG",
      radio: termicaPareja(45),
      pose: { lat, lon, altitudeAglM: altura, gimbalYawDeg: 0, gimbalPitchDeg: -90 },
    });
    return acc;
  };

  it("mide los modulos que entran enteros", () => {
    const acc = volar(centro.lat, centro.lon, 60);
    expect(acc.muestras().length).toBeGreaterThan(0);
  });

  /**
   * La prueba que importa: sobre una termica PAREJA —todo el cuadro a 45
   * grados, sin una sola anomalia— no puede salir ningun hallazgo. Si sale
   * alguno, lo invento el borde.
   */
  it("sobre una termica pareja no inventa ni un hallazgo", () => {
    const acc = volar(centro.lat, centro.lon, 60);
    const hallazgos = comparar(acc.muestras()).filter((h) => h.severidad !== "normal");
    expect(hallazgos).toEqual([]);
  });

  /*
    La falla que no daba ni un sintoma.

    Con el parque equivocado cargado —o con uno viejo, guardado antes de
    corregirle las coordenadas— la huella de la foto no toca ninguna fila. No
    hay ni una caja que medir, el vuelo termina con cero modulos y cero
    hallazgos, y eso en el campo se lee como "esta todo sano".

    Pasó de verdad, y con las fotos buenas: el parque que estaba cargado era de
    tres semanas antes y las fotos de Edenvale caian noventa metros al este de
    la fila mas cercana. La app no dijo absolutamente nada.
  */
  it("una foto que cae afuera del parque se cuenta y se dice, con la distancia", () => {
    // Un kilometro al norte del parque: ni la huella mas grande llega.
    const acc = volar(centro.lat + 0.009, centro.lon, 60);
    expect(acc.muestras().length).toBe(0);
    const fuera = acc.fotosSinParque();
    expect(fuera.length, "la foto de afuera no se registro").toBe(1);
    expect(fuera[0]!.fileName).toBe("T.JPG");
    // La distancia es lo que separa "el GPS anduvo mal" de "es otro parque".
    expect(fuera[0]!.metros).toBeGreaterThan(500);
  });

  it("una foto que cae sobre el parque no se cuenta como afuera", () => {
    expect(volar(centro.lat, centro.lon, 60).fotosSinParque()).toEqual([]);
  });

  it("los que quedan cortados los cuenta aparte en vez de medirlos", () => {
    // Volando bajo, la fila no entra entera y algun modulo cae partido por el
    // borde. A que altura pasa exactamente depende de la geometria del parque,
    // asi que se busca en vez de fijar un numero magico que se rompa cada vez
    // que se corrige una medida de campo.
    const acc = [18, 20, 22, 25, 28, 32, 36, 40]
      .map((h) => volar(centro.lat, centro.lon, h))
      .find((a) => a.soloEnElBorde() > 0 && a.muestras().length > 0);
    expect(acc, "ninguna altura dejo un modulo partido por el borde").toBeDefined();
    expect(acc!.soloEnElBorde()).toBeGreaterThan(0);
    // Y ninguno de los medidos puede tener menos pixeles que los que le tocan.
    const minimo = Math.min(...acc!.muestras().map((m) => m.pixeles));
    const maximo = Math.max(...acc!.muestras().map((m) => m.pixeles));
    expect(minimo).toBeGreaterThanOrEqual(maximo * 0.5);
  });

  // Con solape, un modulo cortado en el borde de una foto cae comodo en el
  // centro de la siguiente. Ese es el trabajo del solape y no se puede contar
  // como perdido.
  it("no cuenta como perdido lo que otra foto midio bien", () => {
    const acc = new Acumulador(farm, marco, {
      camera: camara, moduloAnchoM: profile.module.widthMm / 1000, moduloLargoM: 2.28,
    });
    const pose = (alt: number) => ({
      lat: centro.lat, lon: centro.lon, altitudeAglM: alt,
      gimbalYawDeg: 0, gimbalPitchDeg: -90,
    });
    // Una altura a la que algo queda partido, buscada igual que arriba.
    const baja = [18, 20, 22, 25, 28, 32, 36, 40].find(
      (h) => volar(centro.lat, centro.lon, h).soloEnElBorde() > 0,
    )!;
    acc.agregar({ fileName: "baja.JPG", radio: termicaPareja(45), pose: pose(baja) });
    const cortadosSolo = acc.soloEnElBorde();
    expect(cortadosSolo).toBeGreaterThan(0);
    acc.agregar({ fileName: "alta.JPG", radio: termicaPareja(45), pose: pose(200) });
    expect(acc.soloEnElBorde()).toBeLessThan(cortadosSolo);
  });
});

// ---------------------------------------------------------------------------
// La celda caliente
// ---------------------------------------------------------------------------

/**
 * El defecto mas comun de todos, y el que la otra comparacion no puede ver.
 *
 * Un modulo se mide por su MEDIANA, que es lo correcto para ignorar el pasto y
 * el marco de aluminio. Pero por eso mismo es ciega a una celda caliente: una
 * celda ocupa el 3 % del area del modulo y la mediana no se mueve un decimo de
 * grado. Un modulo con una celda en corto se ve, contra sus 27 hermanos de
 * string, exactamente igual que uno sano.
 *
 * Por eso hace falta la segunda comparacion, y es contra el PROPIO modulo: la
 * suciedad, la irradiancia y la edad afectan al modulo entero por igual y se
 * cancelan solas en la resta.
 */
describe("la celda caliente adentro del modulo", () => {
  it("la mediana del modulo no la ve — por eso hace falta la otra comparacion", () => {
    const h = comparar(muestras(40, {}, { 7: 30 }));
    const m = h.find((x) => x.modulo.positionInRow === 7)!;
    // Contra sus hermanos de string el modulo esta impecable...
    expect(m.deltaT).toBeCloseTo(0, 1);
    expect(m.severidad).toBe("normal");
    // ...y sin embargo tiene una celda 30 grados por encima de si mismo.
    expect(m.deltaInterno).toBeCloseTo(30, 1);
    expect(m.severidadInterna).toBe("critica");
    expect(m.peor).toBe("critica");
    expect(m.origen).toBe("celda");
  });

  it("un modulo parejo por dentro no dispara nada", () => {
    const h = comparar(muestras(40));
    expect(h.every((x) => x.peor === "normal")).toBe(true);
    expect(h.every((x) => x.origen === "ninguno")).toBe(true);
  });

  // Adentro de un modulo sano ya hay varios grados entre la celda mas caliente
  // y la mediana: el marco disipa y los bordes ven cielo. Por eso el umbral
  // interno es mas alto que el de modulo contra string.
  it("no confunde la dispersion normal de un modulo con un defecto", () => {
    const h = comparar(muestras(40, {}, { 7: 5 }));
    const m = h.find((x) => x.modulo.positionInRow === 7)!;
    expect(m.deltaInterno).toBeCloseTo(5, 1);
    expect(m.peor).toBe("normal");
  });

  /**
   * La regla que evita repetir el error del borde del cuadro: si la foto no
   * resuelve la celda, no se afirma nada sobre celdas.
   */
  it("sin resolucion para ver la celda, no inventa el hallazgo", () => {
    const flojas = muestras(40, {}, { 7: 30 }).map((m) => ({ ...m, pixelesPorCelda: 1.5 }));
    const m = comparar(flojas).find((x) => x.modulo.positionInRow === 7)!;
    expect(m.deltaInterno).toBeUndefined();
    expect(m.severidadInterna).toBeUndefined();
    expect(m.peor).toBe("normal");
  });

  it("cuando las dos disparan, manda la peor y dice cual fue", () => {
    // Modulo entero 12 grados arriba (moderada) y ademas celda a 30 (critica).
    const h = comparar(muestras(40, { 7: 12 }, { 7: 30 }));
    const m = h.find((x) => x.modulo.positionInRow === 7)!;
    expect(m.severidad).toBe("moderada");
    expect(m.severidadInterna).toBe("critica");
    expect(m.peor).toBe("critica");
    expect(m.origen).toBe("celda");
  });

  it("el resumen cuenta por la peor de las dos y dice cuantos chequeo", () => {
    const h = comparar(muestras(40, {}, { 7: 30 }));
    const r = resumir(h, 56, [], 4.5);
    expect(r.criticas).toBe(1);
    expect(r.conChequeoDeCelda).toBe(h.length);
    expect(r.limitaciones.join(" ")).not.toMatch(/celda/);
  });

  it("a poca resolucion avisa a cuanto de la altura hay que volar", () => {
    // A 14.9 cm por pixel una celda de 16 cm entra en poco mas de un pixel:
    // la muestra tiene que decir eso, no un numero de otro vuelo.
    const flojas = muestras(40).map((m) => ({ ...m, pixelesPorCelda: 1.15 }));
    const r = resumir(comparar(flojas), 56, [], 14.9);
    expect(r.conChequeoDeCelda).toBe(0);
    expect(r.limitaciones.join(" ")).toMatch(/volar a 5[0-9] % de la altura/);
  });
});

/**
 * La punta de la fila: la misma trampa que el borde del cuadro, corrida de lugar.
 *
 * En el ultimo modulo de una fila la caja de medicion queda medio sobre el
 * panel y medio sobre el pasto. La mediana sale la del pasto —varios grados
 * por debajo del string— y la zona mas caliente de adentro es, simplemente, el
 * panel. Sin esta regla el vuelo de prueba devolvia diez "leves" que eran
 * todos modulo 1 o modulo 28.
 */
describe("un modulo mas frio que su string no esta midiendo el panel", () => {
  it("no le busca la celda caliente al que lee mas frio que sus hermanos", () => {
    // La firma exacta: 10 grados por debajo del string, 10 por encima adentro.
    const h = comparar(muestras(40, { 1: -10 }, { 1: 10.5 }));
    const punta = h.find((x) => x.modulo.positionInRow === 1)!;
    expect(punta.deltaT).toBeCloseTo(-10, 1);
    expect(punta.deltaInterno).toBeUndefined();
    expect(punta.peor).toBe("normal");
  });

  it("pero al que esta a la par de sus hermanos si", () => {
    const h = comparar(muestras(40, {}, { 1: 30 }));
    const m = h.find((x) => x.modulo.positionInRow === 1)!;
    expect(m.deltaInterno).toBeCloseTo(30, 1);
    expect(m.peor).toBe("critica");
  });
});

// ---------------------------------------------------------------------------

describe("un solo lado de celda para todo", () => {
  /**
   * El lado de la celda se usaba para dos cosas con dos numeros distintos: la
   * medicion tomaba el del perfil del parque y el informe la constante de
   * 160 mm. En un parque de celdas M10 (182 mm) la app buscaba puntos calientes
   * con una caja y despues informaba si se podian ver o no con otra.
   */
  it("por defecto sigue hablando de la celda de 16 cm", () => {
    expect(resumir([], 100, [], 9.0).limitaciones.join(" ")).toMatch(/celda de 16 cm/);
  });

  it("con celdas M10 el informe habla de 18 cm, no de 16", () => {
    expect(resumir([], 100, [], 15, 0, [], 0.182).limitaciones.join(" ")).toMatch(/celda de 18 cm/);
  });

  /**
   * Y no es cosmetico: con celdas mas grandes el mismo vuelo SI las resuelve.
   * A 9 cm por pixel una celda de 16 cm entra en 3,2 pixeles de area —no
   * alcanza— y una de 18,2 en 4,1, que si. La frontera se mueve con la celda,
   * y el informe tiene que moverse con ella.
   */
  it("la misma altura resuelve una celda M10 y no una de 16 cm", () => {
    expect(resumir([], 100, [], 9.0).limitaciones.join(" ")).toMatch(/NO se busco el punto caliente/);
    expect(resumir([], 100, [], 9.0, 0, [], 0.182).limitaciones.join(" "))
      .not.toMatch(/NO se busco el punto caliente/);
  });

  it("y la altura que hace falta se calcula con la celda del parque", () => {
    const chica = resumir([], 100, [], 15).limitaciones.join(" ");
    const grande = resumir([], 100, [], 15, 0, [], 0.182).limitaciones.join(" ");
    expect(chica).toMatch(/de la altura de este vuelo/);
    expect(grande).toMatch(/de la altura de este vuelo/);
    expect(chica).not.toBe(grande);
  });
});

/**
 * Donde cae el modulo dentro de la foto.
 *
 * Se guarda al medir porque el informe lo necesita para marcar el panel sobre
 * la imagen, y recalcularlo despues exigiria tener otra vez la pose, la camara,
 * el ajuste y el acortamiento del tracker en ESE instante. Un recuadro dibujado
 * con uno de esos mal senala el panel de al lado con la misma seguridad — que
 * es justo el error que hace que una cuadrilla deje de creerle al informe.
 */
describe("la caja del modulo en la foto", () => {
  const camara = camaraDesdeEquivalente35("prueba", 40, 640, 512);
  const marco = makeFrame(farm.origin.lat, farm.origin.lon);
  const centroFila = farm.rows[0]!;
  const centro = (() => {
    const ms = modulesOfRow(centroFila, farm);
    const x = ms.reduce((a, m) => a + m.x, 0) / ms.length;
    const y = ms.reduce((a, m) => a + m.y, 0) / ms.length;
    return toGeo(marco, x, y);
  })();

  function medir() {
    const acc = new Acumulador(farm, marco, {
      camera: camara, moduloAnchoM: profile.module.widthMm / 1000, moduloLargoM: 2.28,
    });
    acc.agregar({
      fileName: "T.JPG",
      radio: {
        width: 640, height: 512,
        celsius: new Float32Array(640 * 512).fill(45),
        escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0,
      },
      pose: { lat: centro.lat, lon: centro.lon, altitudeAglM: 60, gimbalYawDeg: 0, gimbalPitchDeg: -90 },
    });
    return acc.muestras();
  }

  it("queda guardada en cada muestra", () => {
    const ms = medir();
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((m) => m.caja != null)).toBe(true);
  });

  it("cae adentro de la imagen, no en el borde ni afuera", () => {
    for (const m of medir()) {
      expect(m.caja!.cx).toBeGreaterThan(0);
      expect(m.caja!.cx).toBeLessThan(640);
      expect(m.caja!.cy).toBeGreaterThan(0);
      expect(m.caja!.cy).toBeLessThan(512);
    }
  });

  /*
    La caja es el 60 % util del modulo, no el modulo entero: el marco de
    aluminio al sol esta a otra temperatura que la celda. Si esta relacion se
    rompe, lo que se marca en la foto deja de ser lo que se midio.
  */
  it("es el 60 % del modulo, y el largo va por el lado corto", () => {
    const ms = medir();
    const m = ms[0]!;
    const anchoM = profile.module.widthMm / 1000;
    // largo/cruzado tiene que dar la misma proporcion que ancho/largo del modulo.
    expect(m.caja!.largo / m.caja!.cruzado).toBeCloseTo(anchoM / 2.28, 2);
  });

  /*
    Y con el tracker inclinado la caja se angosta. Sin esto, media caja cae
    sobre el pasto — que al sol lee muy distinto y le baja la mediana al modulo.
  */
  it("con el tracker inclinado la caja se angosta, y el largo no cambia", () => {
    const acc = new Acumulador(farm, marco, {
      camera: camara, moduloAnchoM: profile.module.widthMm / 1000, moduloLargoM: 2.28,
    });
    const foto = {
      fileName: "T.JPG",
      radio: {
        width: 640, height: 512,
        celsius: new Float32Array(640 * 512).fill(45),
        escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0,
      },
      pose: { lat: centro.lat, lon: centro.lon, altitudeAglM: 60, gimbalYawDeg: 0, gimbalPitchDeg: -90 },
    };
    acc.agregar(foto, 0.57); // tracker contra su tope de 55 grados
    const inclinado = acc.muestras()[0]!;
    const plano = medir()[0]!;

    expect(inclinado.caja!.cruzado).toBeLessThan(plano.caja!.cruzado);
    expect(inclinado.caja!.cruzado / plano.caja!.cruzado).toBeCloseTo(0.57, 2);
    expect(inclinado.caja!.largo).toBeCloseTo(plano.caja!.largo, 6);
  });
});

// ---------------------------------------------------------------------------

/**
 * Una franja de diodo no se mide con la vara de una celda.
 *
 * Son dos fisicas distintas y no dan numeros parecidos. Una celda en corto se
 * come toda la corriente del string en dos centimetros cuadrados y corre 15,
 * 25, 40 grados por encima del modulo. Una substring puenteada por su diodo
 * disipa lo mismo repartido en un tercio del panel: corre unos pocos grados, y
 * ademas arrastra hacia arriba la mediana del propio modulo contra la que se
 * la compara.
 *
 * Con un solo umbral pasa lo que paso en el vuelo del 3 de septiembre: una
 * franja de diodo medida en +6,2 °C sobre su modulo quedaba debajo de los 8
 * que pide una celda y se reportaba como normal. El motor la habia medido, la
 * habia dibujado y la habia clasificado como diodo — y despues la llamo sana.
 */
describe("la vara depende de la forma", () => {
  const medido = (patron: "diodo" | "punto-caliente" | undefined) => ({
    celsius: 45,
    deltaT: 0,
    puntoCalienteC: 50,   // +5 °C adentro del propio modulo
    pixelesPorCelda: 9,
    ...(patron ? { patron } : {}),
  });

  it("cinco grados adentro de una franja ya es un hallazgo", () => {
    expect(clasificar(medido("diodo")).severidadInterna).not.toBe("normal");
  });

  it("los mismos cinco grados en una celda no alcanzan", () => {
    expect(clasificar(medido("punto-caliente")).severidadInterna).toBe("normal");
  });

  it("sin forma conocida se sigue exigiendo lo de una celda", () => {
    expect(clasificar(medido(undefined)).severidadInterna).toBe("normal");
  });
});

// ---------------------------------------------------------------------------

/**
 * Las filas que el parque dice que existen y en el campo no estan.
 *
 * Salio del bloque 1 de Wellington, volado entero el 4 de septiembre. Hay
 * fotos donde las cajas de una fila caen ENTERAS sobre pasto —el parque dice
 * que ahi hay una fila y en la imagen no hay nada— y esa misma fila, en la
 * foto siguiente, cae perfecta sobre los paneles. Una de cada cuatro cajas
 * medidas de esas dos fotos no tenia un solo pixel de panel adentro, y de ahi
 * salieron casi todos los hallazgos que quedaban.
 *
 * Lo que decide es la TEXTURA, y esa eleccion no es de estilo.
 *
 * Por temperatura no se puede: en las fotos del 3 de septiembre el string
 * desconectado corre a 44,5 °C, mas caliente que el pasto de su propia foto.
 * Cualquier corte por temperatura lo tira junto con el pasto — y es el
 * hallazgo mas caro de la lista. Probado y descartado, dos veces.
 *
 * Un panel es una superficie lisa, este frio o caliente. Medido sobre las dos
 * salidas: las filas de paneles dan entre 0,21 y 0,84 de desvio local tipico
 * —incluido el string desconectado, que da 0,21— y las dos filas fantasma dan
 * 1,02 y 1,09.
 */
describe("una fila que el parque dice y en el campo no esta", () => {
  const camara = camaraDesdeEquivalente35("prueba", 40, 640, 512);

  /*
    Dos filas pegadas, para que la foto tenga una fila buena y una fantasma a
    la vez. Con una sola fila el caso no existe: la foto entera se cae por el
    freno de arriba y no se llega a probar este.
  */
  const dos = [
    makeRow({ id: "A", block: "05", tracker: "05-A", row: "R1",
      anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north" }, profile),
    makeRow({ id: "B", block: "05", tracker: "05-B", row: "R1",
      anchor: { lat: -26.92, lon: 150.58 + 0.000055 }, azimuthDeg: 180, side: "north" }, profile),
  ];
  const parque = compileFarm(profile, dos);
  const marco = makeFrame(parque.origin.lat, parque.origin.lon);
  const centro = (() => {
    const ms = [...modulesOfRow(parque.rows[0]!, parque), ...modulesOfRow(parque.rows[1]!, parque)];
    const x = ms.reduce((a, m) => a + m.x, 0) / ms.length;
    const y = ms.reduce((a, m) => a + m.y, 0) / ms.length;
    return toGeo(marco, x, y);
  })();

  /**
   * Un cuadro liso de un lado y con textura de pasto del otro.
   *
   * `corte` es la columna donde cambia: a la izquierda panel, a la derecha
   * pasto. Con las filas norte-sur y la camara mirando al norte, cada mitad
   * del cuadro cae sobre una fila distinta.
   */
  function mitadYMitad(corte: number, celsiusPanel: number, celsiusPasto: number) {
    const celsius = new Float32Array(640 * 512);
    let semilla = 20260904;
    const ruido = () => {
      semilla = (semilla * 1664525 + 1013904223) >>> 0;
      return semilla / 0xffffffff - 0.5;
    };
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 640; x++) {
        celsius[y * 640 + x] = x < corte
          ? celsiusPanel + ruido() * 0.4
          : celsiusPasto + ruido() * 8;
      }
    }
    return {
      width: 640, height: 512, celsius,
      escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0,
    };
  }

  function volarDos(radio: ReturnType<typeof mitadYMitad>) {
    const acc = new Acumulador(parque, marco, {
      camera: camara, moduloAnchoM: profile.module.widthMm / 1000, moduloLargoM: 2.28,
    });
    acc.agregar({
      fileName: "T.JPG",
      radio,
      pose: { lat: centro.lat, lon: centro.lon, altitudeAglM: 45, gimbalYawDeg: 0, gimbalPitchDeg: -90 },
    });
    return acc;
  }

  /*
    La prueba que importa: la foto sirve —media foto es panel de verdad— y aun
    asi la fila que cae sobre pasto no se mide. Antes se median las dos y la
    del pasto daba los hallazgos.
  */
  it("la fila que cae sobre pasto no se mide, y la de al lado si", () => {
    // Las dos filas caen en x = 210 y x = 302 del cuadro; el corte va en medio.
    const acc = volarDos(mitadYMitad(260, 45, 45));
    const filas = new Map<string, number>();
    for (const m of acc.muestras()) filas.set(m.modulo.rowId, (filas.get(m.modulo.rowId) ?? 0) + 1);
    expect([...filas.keys()], "la que se midio tiene que ser la del panel").toEqual(["A"]);
    expect(acc.muestras().length, "la fila buena tenia que medirse").toBeGreaterThan(5);
    expect(filas.size, "solo una de las dos filas es panel").toBe(1);
  });

  const marco2 = makeFrame(farm.origin.lat, farm.origin.lon);
  const fila = farm.rows[0]!;
  const centroUna = (() => {
    const ms = modulesOfRow(fila, farm);
    const x = ms.reduce((a, m) => a + m.x, 0) / ms.length;
    const y = ms.reduce((a, m) => a + m.y, 0) / ms.length;
    return toGeo(marco2, x, y);
  })();

  /** Un cuadro entero, con la textura que se le pida y a la temperatura que se le pida. */
  function cuadro(celsiusBase: number, ruidoC: number) {
    const celsius = new Float32Array(640 * 512);
    let semilla = 20260904;
    const ruido = () => {
      semilla = (semilla * 1664525 + 1013904223) >>> 0;
      return semilla / 0xffffffff - 0.5;
    };
    for (let i = 0; i < celsius.length; i++) celsius[i] = celsiusBase + ruido() * ruidoC;
    return {
      width: 640, height: 512, celsius,
      escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0,
    };
  }

  const volar = (radio: ReturnType<typeof cuadro>) => {
    const acc = new Acumulador(farm, marco2, {
      camera: camara, moduloAnchoM: profile.module.widthMm / 1000, moduloLargoM: 2.28,
    });
    acc.agregar({
      fileName: "T.JPG",
      radio,
      pose: { lat: centroUna.lat, lon: centroUna.lon, altitudeAglM: 60, gimbalYawDeg: 0, gimbalPitchDeg: -90 },
    });
    return acc;
  };

  it("sobre una superficie lisa se mide", () => {
    // Un panel: liso. El ruido queda muy por debajo del limite.
    expect(volar(cuadro(45, 0.4)).muestras().length).toBeGreaterThan(10);
  });

  /*
    El caso que hizo el desastre: el parque pone una fila donde hay pasto. El
    pasto no es liso, y esa es toda la diferencia.
  */
  it("una foto que es toda pasto no mide nada, y lo dice", () => {
    const acc = volar(cuadro(45, 8));
    expect(acc.muestras().length).toBe(0);
    // No se pierde en silencio: la foto sale nombrada en el informe.
    expect(acc.fotosQueNoEngancharon().length).toBe(1);
  });

  /*
    Y el freno que se le puso al freno. Un string desconectado esta MAS
    CALIENTE que el pasto de su propia foto —44,5 contra 42,4 en la foto real—
    y sigue siendo un panel: liso. Si esto se filtrara por temperatura, el
    hallazgo mas caro de la lista se perderia sin que nadie se entere.
  */
  it("un panel muy caliente se sigue midiendo: lo que se mira es la textura", () => {
    const caliente = volar(cuadro(60, 0.4));
    expect(caliente.muestras().length).toBeGreaterThan(10);
    expect(caliente.muestras()[0]!.celsius).toBeGreaterThan(55);
  });
});
