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
import { Acumulador, comparar, eventosDeString, resumir, UMBRALES, type Muestra } from "../app/detect";
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
