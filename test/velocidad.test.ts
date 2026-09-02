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
  DERIVA_CON_RTK,
  DERIVA_SIN_RTK,
  MINUTOS_POR_BATERIA,
  SOLAPES,
  huella,
  jornadaDeCampo,
  minutosUtiles,
  pasoEntreFilas,
  solapeLateral,
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

// ---------------------------------------------------------------------------

/**
 * La jornada de campo: lo que se puede volar en un dia, y que lo limita.
 *
 * El modelo anterior contaba las baterias como si fueran de un solo uso —
 * `viajes = baterias que gasta el parque / baterias que llevas`. El operador lo
 * volteo con una frase: "puedo estar cargando las baterias que vienen vacias
 * mientras el dron vuela". Tiene razon: con cargador las baterias circulan, no
 * se gastan.
 */
describe("cuanto se vuela en un dia de campo", () => {
  const base = { camera: m4t, minutosDeSol: 210, minutosDelParque: 19 * 60 };

  /*
    Los 20 minutos por bateria eran de la epoca del Mavic 3T y encima cortos.
    El Matrice 4T da 49 de ficha: con 25 % de reserva y 4 minutos de traslado
    quedan 32. Contar 20 pedia un 60 % mas de baterias de las que hacen falta.
  */
  it("los minutos utiles salen del dron y no de una constante", () => {
    expect(minutosUtiles(m4t)).toBe(Math.round(49 * 0.75 - 4));
    expect(minutosUtiles(m4t)).toBeGreaterThan(30);
    expect(minutosUtiles(m3t)).toBeLessThan(minutosUtiles(m4t));
  });

  it("una camara sin ficha cae en el respaldo conservador", () => {
    expect(minutosUtiles({ ...m4t, minutosDeVuelo: undefined })).toBe(MINUTOS_POR_BATERIA);
  });

  it("sin cargador, las baterias son lo unico que hay", () => {
    const j = jornadaDeCampo({ ...base, baterias: 5, cargaEnElCampo: false });
    expect(j.minutosPorBaterias).toBe(5 * minutosUtiles(m4t));
    expect(j.elCargadorAlcanza).toBe(false);
  });

  /*
    El caso que motivo el cambio: las mismas cinco baterias rinden mucho mas si
    se cargan mientras el dron vuela, aunque el cargador no llegue a seguirle
    el ritmo.
  */
  it("cargando en el campo las mismas baterias rinden mas", () => {
    const sin = jornadaDeCampo({ ...base, baterias: 5, cargaEnElCampo: false });
    const con = jornadaDeCampo({ ...base, baterias: 5, cargaEnElCampo: true });
    expect(con.minutosPorBaterias).toBeGreaterThan(sin.minutosPorBaterias);
  });

  /*
    Pero no es magia: el hub del Matrice 4T carga de a UNA bateria y tarda 60
    minutos en dejarla lista, contra 32 minutos de vuelo. Repone a la mitad de
    velocidad de la que se quema, asi que el colchon igual se vacia.
  */
  it("el hub del M4T no le sigue el ritmo al dron", () => {
    const j = jornadaDeCampo({ ...base, baterias: 5, cargaEnElCampo: true });
    expect(j.elCargadorAlcanza).toBe(false);
    expect(Number.isFinite(j.minutosPorBaterias)).toBe(true);
  });

  it("un cargador que repone mas rapido de lo que se quema saca el techo", () => {
    const rapido = { ...m4t, minutosDeCarga: 20 };
    const j = jornadaDeCampo({ ...base, camera: rapido, baterias: 3, cargaEnElCampo: true });
    expect(j.elCargadorAlcanza).toBe(true);
    expect(j.minutosPorBaterias).toBe(Infinity);
    // Y ahi lo unico que queda limitando es el sol.
    expect(j.limita).toBe("sol");
    expect(j.minutosPorJornada).toBe(210);
  });

  /*
    Lo que de verdad manda casi siempre. La norma pide 600 W/m² y los trackers
    tienen que estar casi planos: son unas pocas horas al mediodia. Tener
    bateria para seis horas no sirve si la ventana son tres y media.
  */
  it("con baterias de sobra, el que limita es el sol", () => {
    const j = jornadaDeCampo({ ...base, baterias: 12, cargaEnElCampo: true });
    expect(j.limita).toBe("sol");
    expect(j.minutosPorJornada).toBe(210);
  });

  it("con pocas baterias, el que limita son las baterias", () => {
    const j = jornadaDeCampo({ ...base, baterias: 2, cargaEnElCampo: false });
    expect(j.limita).toBe("baterias");
    expect(j.minutosPorJornada).toBe(2 * minutosUtiles(m4t));
  });

  it("las jornadas salen de lo que se vuela por dia, no de las baterias sueltas", () => {
    const j = jornadaDeCampo({ ...base, baterias: 12, cargaEnElCampo: true });
    // 19 h de parque con 3.5 h utiles por dia.
    expect(j.jornadas).toBe(Math.ceil((19 * 60) / 210));
  });

  it("un dia sin ventana util no da una jornada de cero minutos", () => {
    const j = jornadaDeCampo({ ...base, baterias: 5, cargaEnElCampo: true, minutosDeSol: 0 });
    expect(j.minutosPorJornada).toBeGreaterThan(0);
    expect(Number.isFinite(j.jornadas)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

/**
 * El solape lateral, calculado en vez de elegido de dos presets.
 *
 * "¿Por que con el RTK se tiene que solapar tanto la foto, si se supone que es
 * ultra preciso? ¿Por que no se puede solapar solo un diez por ciento y ahi
 * seria mucho mas rapido todo?"
 *
 * La respuesta es que en esta app el solape no compra cobertura, compra
 * medicion: el motor se queda con la foto que tiene al modulo mas cerca del
 * centro, porque en el borde la termica miente varios grados. Pero el 45 % que
 * habia era igual de arbitrario que el 5 m/s.
 */
describe("el solape lateral", () => {
  const base = { camera: m4t, altitudeM: 50, fraccionDelCuadro: 0.7 };

  it("la regla de calidad es lo que pone el piso", () => {
    const s = solapeLateral({ ...base, derivaM: 0, desnivelM: 0 });
    // "No medir mas alla del 70 % del cuadro" son 30 % de solape, exacto.
    expect(s.porCalidad).toBeCloseTo(0.3, 5);
    expect(s.solape).toBeCloseTo(0.3, 5);
    expect(s.manda).toBe("calidad");
  });

  /*
    El caso que pedia: RTK y terreno plano. Tiene que dar bastante menos que el
    45 % que venia de preset — si no, todo esto no sirvio de nada.
  */
  it("con RTK y terreno plano baja bien debajo del 45 % que venia puesto", () => {
    const s = solapeLateral({ ...base, derivaM: DERIVA_CON_RTK, desnivelM: 2 });
    expect(s.solape).toBeLessThan(SOLAPES.conRtk.sideOverlap);
    expect(s.solape).toBeGreaterThan(0.3);
  });

  it("sin RTK, la deriva del dron pesa y sube el solape", () => {
    const con = solapeLateral({ ...base, derivaM: DERIVA_CON_RTK, desnivelM: 2 });
    const sin = solapeLateral({ ...base, derivaM: DERIVA_SIN_RTK, desnivelM: 2 });
    expect(sin.solape).toBeGreaterThan(con.solape);
    expect(sin.porDeriva).toBeGreaterThan(con.porDeriva);
  });

  /*
    Lo que el RTK NO arregla. La altura es sobre el punto de despegue: si el
    terreno sube tres metros, se vuela a 47 y la pasada se angosta sola.
  */
  it("el terreno pesa aunque haya RTK", () => {
    const plano = solapeLateral({ ...base, derivaM: DERIVA_CON_RTK, desnivelM: 2 });
    const feo = solapeLateral({ ...base, derivaM: DERIVA_CON_RTK, desnivelM: 12 });
    expect(feo.solape).toBeGreaterThan(plano.solape);
    // Con la regla de calidad floja, el terreno pasa a ser el que manda — y ahi
    // comprar RTK no arregla nada: hay que volar mas alto o seguir el terreno.
    const flojo = solapeLateral({
      ...base, fraccionDelCuadro: 0.9, derivaM: DERIVA_CON_RTK, desnivelM: 12,
    });
    expect(flojo.manda).toBe("terreno");
  });

  it("volar mas alto diluye la deriva pero no el terreno", () => {
    const bajo = solapeLateral({ ...base, altitudeM: 30, derivaM: DERIVA_SIN_RTK, desnivelM: 6 });
    const alto = solapeLateral({ ...base, altitudeM: 90, derivaM: DERIVA_SIN_RTK, desnivelM: 6 });
    // Mas alto la huella es mas ancha, asi que los mismos metros de deriva son
    // una fraccion menor. Y el desnivel tambien pesa menos, por la misma razon.
    expect(alto.porDeriva).toBeLessThan(bajo.porDeriva);
    expect(alto.porTerreno).toBeLessThan(bajo.porTerreno);
  });

  it("pedir una regla mas exigente sube el solape", () => {
    const flojo = solapeLateral({ ...base, fraccionDelCuadro: 0.9, derivaM: 0, desnivelM: 0 });
    const duro = solapeLateral({ ...base, fraccionDelCuadro: 0.5, derivaM: 0, desnivelM: 0 });
    expect(duro.solape).toBeGreaterThan(flojo.solape);
  });

  /*
    El 10 % que preguntaba se puede pedir, y la app lo va a dar — pero solo si
    se declara que se acepta medir hasta el borde mismo del cuadro. Que es
    justamente la decision que antes estaba escondida adentro de un preset.
  */
  it("un solape del 10 % exige aceptar medir al 90 % del cuadro", () => {
    const s = solapeLateral({
      ...base, fraccionDelCuadro: 0.9, derivaM: DERIVA_CON_RTK, desnivelM: 0,
    });
    expect(s.solape).toBeLessThan(0.15);
  });

  it("nunca devuelve un plan sin solape ni uno que no termina nunca", () => {
    const nada = solapeLateral({ ...base, fraccionDelCuadro: 1, derivaM: 0, desnivelM: 0 });
    expect(nada.solape).toBeGreaterThanOrEqual(0.05);
    const todo = solapeLateral({ ...base, fraccionDelCuadro: 0, derivaM: 20, desnivelM: 40 });
    expect(todo.solape).toBeLessThanOrEqual(0.85);
  });
});
