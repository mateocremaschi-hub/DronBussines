/**
 * Las juntas entre modulos, que son lo que dice donde empieza cada panel.
 *
 * La prueba que importa es la ultima: una rejilla corrida medio modulo tiene
 * que volver a su lugar. Es el caso real —el diodo de bypass del modulo 26 que
 * el informe llamaba 25— y es el unico error de esta app que un cliente puede
 * ver sin instrumentos: cuenta paneles desde la punta y encuentra uno sano.
 */
import { describe, expect, it } from "vitest";
import { bordeDelPanel, corrimientoDeLaRejilla, perfilALoLargo, periodicidadDeModulos, tieneBordesCruzados } from "../app/juntas";

const PASO = 25;

/**
 * Una fila de modulos vista por las dos reglas.
 *
 * `c` es la temperatura: panel a 38 grados y junta a 34, que es lo que dan las
 * fotos de Wellington. `aspero` es el desvio local: 0,3 sobre el panel —lo que
 * da un modulo sano de los vuelos reales— y 2 sobre la junta, que es un
 * escalon.
 */
function fila(n: number, fase: number, ruido = 0, juntaCaliente = false) {
  const c = new Float64Array(n), aspero = new Float64Array(n);
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(((i - fase) % PASO + PASO + PASO / 2) % PASO - PASO / 2);
    const enJunta = d < 1.5;
    c[i] = (enJunta ? (juntaCaliente ? 44 : 34) : 38) + azar() * ruido;
    aspero[i] = (enJunta ? 2 : 0.3) + azar() * ruido * 0.2;
  }
  return { c, aspero };
}

describe("corrimientoDeLaRejilla", () => {
  it("no encuentra nada donde no hay juntas", () => {
    const plano = new Float64Array(300).fill(38);
    const planoAspero = new Float64Array(300).fill(0.3);
    const centros = Array.from({ length: 10 }, (_, i) => i * PASO);
    expect(corrimientoDeLaRejilla(plano, planoAspero, 0, centros, PASO)).toBeNull();
  });

  it("una rejilla ya alineada no se mueve", () => {
    const { c, aspero } = fila(300, PASO / 2);           // juntas en 12.5, 37.5...
    const centros = Array.from({ length: 10 }, (_, i) => i * PASO + 25);
    const j = corrimientoDeLaRejilla(c, aspero, 0, centros, PASO)!;
    expect(j).not.toBeNull();
    expect(Math.abs(j.corrimientoPx)).toBeLessThan(1);
  });

  it("una rejilla corrida vuelve a su lugar", () => {
    // El caso del modulo 26: la rejilla del parque cae 11 px tarde, casi medio
    // modulo, y por eso la caja del 25 se comia la franja del 26.
    const { c, aspero } = fila(300, PASO / 2);
    const centros = Array.from({ length: 10 }, (_, i) => i * PASO + 25 + 11);
    const j = corrimientoDeLaRejilla(c, aspero, 0, centros, PASO)!;
    expect(j).not.toBeNull();
    expect(j.corrimientoPx).toBeCloseTo(-11, 0);
    expect(Math.abs(j.corrimientoModulos)).toBeCloseTo(11 / PASO, 1);
  });

  it("nunca corrige mas de medio modulo, asi que no puede renumerar", () => {
    // Con la rejilla corrida DOS TERCIOS de modulo, lo correcto no es correrla
    // dos tercios para atras —eso seria decir que el modulo 25 es el 26— sino
    // un tercio para adelante, hasta el panel que ya tenia mas cerca.
    const { c, aspero } = fila(300, PASO / 2);
    const centros = Array.from({ length: 10 }, (_, i) => i * PASO + 25 + 17);
    const j = corrimientoDeLaRejilla(c, aspero, 0, centros, PASO)!;
    expect(Math.abs(j.corrimientoPx)).toBeLessThanOrEqual(PASO / 2);
    expect(j.corrimientoPx).toBeCloseTo(PASO - 17, 0);
  });

  it("aguanta ruido de camara", () => {
    const { c, aspero } = fila(300, PASO / 2, 0.3);
    const centros = Array.from({ length: 10 }, (_, i) => i * PASO + 25 + 8);
    const j = corrimientoDeLaRejilla(c, aspero, 0, centros, PASO)!;
    expect(j).not.toBeNull();
    /*
      Lo que hay que exigirle al ruido no es el pixel exacto: es que la caja no
      se acerque al panel de al lado. Con un octavo de modulo de margen, la
      caja —que mide seis decimos del paso— sigue entera adentro del suyo.
    */
    expect(Math.abs(j.corrimientoPx + 8)).toBeLessThan(PASO / 8);
  });

  it("no se deja arrastrar por el hueco entre dos strings", () => {
    /*
      Entre el modulo 28 de un string y el 1 del siguiente hay 555 mm sin
      panel: un pozo frio de un ancho que no es el de una junta. Si se lo
      contara como junta, la fase saldria un poco corrida hacia el. Se
      construye el perfil con ese hueco adentro y se pide la misma respuesta.
    */
    const { c, aspero } = fila(400, PASO / 2);
    for (let i = 137; i < 150; i++) { c[i] = 30; aspero[i] = 2.5; }
    const centros: number[] = [];
    for (let i = 0; i < 6; i++) centros.push(i * PASO + 25);
    for (let i = 0; i < 6; i++) centros.push(150 + i * PASO + 25);
    const j = corrimientoDeLaRejilla(c, aspero, 0, centros, PASO)!;
    expect(j).not.toBeNull();
    expect(Math.abs(j.corrimientoPx)).toBeLessThan(2);
  });

  it("con las juntas CALIENTES no se alinea al reves", () => {
    /*
      Es el error que no da ningun sintoma. Entre modulo y modulo hay suelo, y
      al mediodia el suelo lee por encima del panel. Buscando la junta como un
      pozo frio, la respuesta sale medio modulo corrida y cada caja queda
      apoyada justo en el hueco entre dos paneles — con las cajas pareciendo
      igual de bien puestas que siempre.

      Lo que lo resuelve es la aspereza, que no cambia de signo: el panel es
      liso y el hueco no.
    */
    const { c, aspero } = fila(300, PASO / 2, 0, true);
    const centros = Array.from({ length: 10 }, (_, i) => i * PASO + 25);
    const j = corrimientoDeLaRejilla(c, aspero, 0, centros, PASO)!;
    expect(j).not.toBeNull();
    expect(Math.abs(j.corrimientoPx)).toBeLessThan(PASO / 8);
  });

  it("con pocos modulos no contesta", () => {
    const { c, aspero } = fila(300, PASO / 2);
    expect(corrimientoDeLaRejilla(c, aspero, 0, [25, 50, 75], PASO)).toBeNull();
  });
});

describe("perfilALoLargo", () => {
  it("toma la mediana cruzada, asi que un defecto no le tapa la junta", () => {
    const w = 60, h = 60;
    const sd = new Float32Array(w * h).fill(0.3);
    // Junta aspera cruzada en y=30, y un defecto que tambien levanta el desvio
    // pero solo en una franja angosta a lo ancho.
    for (let x = 0; x < w; x++) sd[30 * w + x] = 2;
    for (let y = 0; y < h; y++) for (let x = 28; x < 32; x++) sd[y * w + x] = 5;
    const p = perfilALoLargo(sd, w, h, 30, 30, Math.PI / 2, 30, -10, 10);
    // t=0 es y=30: la junta. La mediana cruzada la ve pese al defecto.
    expect(p[10]!).toBeCloseTo(2, 1);
    expect(p[0]!).toBeCloseTo(0.3, 1);
  });
});

describe("bordeDelPanel", () => {
  /**
   * Una fila que termina: panel liso con juntas, y despues de la ultima, el
   * suelo. Los numeros son de desvio local. El borde fisico esta en `fin`.
   */
  const filaQueTermina = (n: number, fin: number, hacia: 1 | -1) => {
    const p = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const afuera = hacia > 0 ? i > fin : i < fin;
      if (afuera) { p[i] = 2.2; continue; }
      const d = Math.abs(((i - fin) % PASO + PASO) % PASO);
      // Junta cada PASO contando desde el borde, de 3 px, aspera pero corta.
      p[i] = d < 1.5 || d > PASO - 1.5 ? 1.3 : 0.3;
    }
    // La celda pegada al borde no tiene junta EN el borde: es el marco.
    return p;
  };

  it("encuentra el final de la fila, para los dos lados", () => {
    const fin = 200;
    const p = filaQueTermina(300, fin, 1);
    // El ultimo modulo predicho por el parque esta centrado medio paso adentro.
    const b = bordeDelPanel(p, 0, fin - PASO / 2, 1, PASO)!;
    expect(b).not.toBeNull();
    expect(Math.abs(b - fin)).toBeLessThan(3);

    const q = filaQueTermina(300, 100, -1);
    const c = bordeDelPanel(q, 0, 100 + PASO / 2, -1, PASO)!;
    expect(c).not.toBeNull();
    expect(Math.abs(c - 100)).toBeLessThan(3);
  });

  it("no confunde una junta con el final", () => {
    // El parque cree que la fila termina dos modulos antes de donde termina.
    const fin = 200;
    const p = filaQueTermina(300, fin, 1);
    const b = bordeDelPanel(p, 0, fin - PASO / 2 - 1.2 * PASO, 1, PASO)!;
    expect(b).not.toBeNull();
    expect(Math.abs(b - fin)).toBeLessThan(3);
  });

  it("si el final no entro en el cuadro, no contesta", () => {
    const p = new Float64Array(120).fill(0.3);
    expect(bordeDelPanel(p, 0, 100, 1, PASO)).toBeNull();
  });
});

/**
 * La prueba rapida de "¿esto son modulos?": cuanto se repite el perfil cada
 * paso. Es la que elige, entre las bandas lisas al alcance de una fila, la
 * que tiene juntas — la sombra del panel es lisa pero no se repite.
 */
describe("la repeticion del modulo", () => {
  it("una fila de paneles se repite; una sombra pareja no", () => {
    const { c } = fila(300, 0, 0.6);
    expect(periodicidadDeModulos(c, PASO)).toBeGreaterThan(0.3);
    const sombra = new Float64Array(300);
    let semilla = 3;
    for (let i = 0; i < 300; i++) {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      sombra[i] = 29 + (semilla / 0x7fffffff - 0.5) * 0.6;
    }
    expect(Math.abs(periodicidadDeModulos(sombra, PASO))).toBeLessThan(0.15);
  });

  /*
    El caso que dejo la prueba muda en el vuelo del bloque 2: una fila que
    cruza la foto entera pide el perfil medio modulo mas alla del cuadro, y
    ahi no hay pixeles. Con las puntas en NaN la repeticion daba cero en todas
    las filas y la sombra ganaba por lisura.
  */
  it("lo que cae fuera del cuadro se recorta, no anula", () => {
    const { c } = fila(300, 0, 0.6);
    const conPuntas = new Float64Array(330).fill(NaN);
    conPuntas.set(c, 15);
    expect(periodicidadDeModulos(conPuntas, PASO)).toBeGreaterThan(0.3);
  });

  it("un hueco en el medio si anula", () => {
    const { c } = fila(300, 0, 0.6);
    const roto = Float64Array.from(c);
    roto[150] = NaN;
    expect(periodicidadDeModulos(roto, PASO)).toBe(0);
  });
});

/**
 * Lo que distingue un modulo de un pedazo de suelo liso: los dos costados.
 * Salio de la foto 0215 del bloque 2, donde un parche de tierra pisada
 * pegado a la punta de la fila 2-8-esclava se tomo por el modulo 1.
 */
describe("un modulo tiene dos costados", () => {
  const W = 300, H = 200;
  /** Mapa de desvio local: pasto en todos lados y una banda de panel vertical en x = [100, 147]. */
  const mapa = (conBanda: boolean, parche = false) => {
    const sd = new Float32Array(W * H).fill(1.3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (conBanda && x >= 100 && x <= 147) sd[y * W + x] = x <= 101 || x >= 146 ? 2.0 : 0.25;
        if (parche && x >= 90 && x <= 160 && y >= 80 && y <= 120) sd[y * W + x] = 0.7;
      }
    }
    return sd;
  };
  // Fila vertical: el eje a lo largo es y, el cruzado es x. Modulo de 47 px cruzado, paso 25.
  it("la banda de un panel, con sus costados, es un modulo", () => {
    expect(tieneBordesCruzados(mapa(true), W, H, 123.5, 100, Math.PI / 2, 47, 25)).toBe(true);
  });

  it("un parche liso sin costados no lo es", () => {
    expect(tieneBordesCruzados(mapa(false, true), W, H, 125, 100, Math.PI / 2, 47, 25)).toBe(false);
  });

  it("si un costado quedo fuera del cuadro, no se puede saber y se da por bueno", () => {
    expect(tieneBordesCruzados(mapa(false, true), W, H, 10, 100, Math.PI / 2, 47, 25)).toBe(true);
  });
});
