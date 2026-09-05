/**
 * La caja con la que se mide cada modulo tiene que ser la del modulo.
 *
 * Un panel es rectangular: unos 1135 mm a lo largo del tracker y 2278 mm hacia
 * los costados. La caja se armaba sobre los ejes de la IMAGEN y con las dos
 * dimensiones cambiadas — el ancho sobre X y el largo sobre Y — asi que en un
 * parque de filas norte-sur, que es el caso de Edenvale, la caja de 2,28 m caia
 * A LO LARGO de la fila y cubria casi dos modulos.
 *
 * El sintoma no es que falle: es que el punto caliente de un modulo aparece
 * como defecto interno del VECINO SANO, con la misma confianza. La cuadrilla
 * sale a caminar hasta el panel equivocado, no lo encuentra roto, y deja de
 * creerle al informe.
 *
 * Ademas la caja no giraba con la fila, asi que solo coincidia con el modulo
 * volando exactamente paralelo o perpendicular a los trackers.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile } from "../src/types.js";
import { compileFarm } from "../src/profile/compile.js";
import { makeFrame, toGeo, toLocal } from "../src/geo/frame.js";
import { modulesOfRow } from "../src/index.js";
import { Acumulador, comparar } from "../app/detect";
import { camaraDesdeEquivalente35 } from "../app/mission";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const ANCHO_M = profile.module.widthMm / 1000;   // 1.135, a lo largo de la fila
const LARGO_M = 2.278;                            // cruzado
const camara = camaraDesdeEquivalente35("prueba", 40, 640, 512);

const fila = makeRow({
  id: "r", block: "04", tracker: "04-018", row: "R1",
  anchor: { lat: -26.9, lon: 150.58 }, azimuthDeg: 0,
  side: "north", stringNumbers: [1, 2],
}, profile);
const farm = compileFarm(profile, [fila]);
const marco = makeFrame(farm.origin.lat, farm.origin.lon);

/**
 * Una termica donde UN modulo esta caliente y todo lo demas parejo.
 *
 * Se pinta proyectando cada pixel al terreno con la misma huella que usa la
 * medicion, asi que la escena es coherente con la geometria del parque en vez
 * de ser un rectangulo dibujado a ojo.
 */
function escena(posCaliente: number, alturaM: number, yawDeg: number) {
  const mods = modulesOfRow(farm.rows[0]!, farm);
  const objetivo = mods.find((m) => m.positionInRow === posCaliente)!;

  const anchoM = 2 * alturaM * Math.tan((camara.hfovDeg * Math.PI) / 360);
  const altoM = 2 * alturaM * Math.tan((camara.vfovDeg * Math.PI) / 360);

  // La foto centrada sobre el modulo objetivo.
  const centro = { x: objetivo.x, y: objetivo.y };
  const celsius = new Float32Array(640 * 512).fill(45);
  const yaw = (yawDeg * Math.PI) / 180;
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);

  // El rumbo de la fila en el terreno, para pintar el rectangulo del modulo.
  const rux = farm.rows[0]!.ux, ruy = farm.rows[0]!.uy;

  for (let py = 0; py < 512; py++) {
    for (let px = 0; px < 640; px++) {
      const u = (px / 640 - 0.5) * anchoM;
      const v = (0.5 - py / 512) * altoM;
      // De ejes de imagen al terreno (inversa de pixelOf).
      const dx = u * cosY + v * sinY;
      const dy = -u * sinY + v * cosY;
      const gx = centro.x + dx, gy = centro.y + dy;
      // Coordenadas respecto del modulo, en el marco de la fila.
      const ex = gx - objetivo.x, ey = gy - objetivo.y;
      const aLargo = ex * rux + ey * ruy;          // a lo largo de la fila
      const cruzado = -ex * ruy + ey * rux;        // hacia los costados
      if (Math.abs(aLargo) <= ANCHO_M / 2 && Math.abs(cruzado) <= LARGO_M / 2) {
        celsius[py * 640 + px] = 65;
      }
    }
  }
  const g = toGeo(marco, centro.x, centro.y);
  return {
    fileName: "T.JPG",
    radio: { width: 640, height: 512, celsius, escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0 },
    pose: { lat: g.lat, lon: g.lon, altitudeAglM: alturaM, gimbalYawDeg: yawDeg, gimbalPitchDeg: -90 },
  };
}

function medir(posCaliente: number, alturaM: number, yawDeg: number, acortamiento = 1) {
  const acc = new Acumulador(farm, marco, {
    camera: camara, moduloAnchoM: ANCHO_M, moduloLargoM: LARGO_M,
  });
  acc.agregar(escena(posCaliente, alturaM, yawDeg), acortamiento);
  return comparar(acc.muestras());
}

/**
 * La escena con el tracker INCLINADO: el modulo pintado se ve mas angosto en
 * el sentido transversal, que es lo que pasa de verdad cuando el tracker gira.
 */
function escenaInclinada(posCaliente: number, alturaM: number, factor: number, sueloC = 70) {
  const foto = escena(posCaliente, alturaM, 0);
  // El suelo pelado al mediodia lee MAS caliente que un modulo trabajando: 70
  // contra 45. Es el caso de Queensland y el que rompe la medicion.
  /*
    Y el suelo tiene TEXTURA. Un suelo pintado parejo a 70 grados no existe: la
    tierra, el pasto y las piedras leen distinto pixel a pixel —en los vuelos
    reales el desvio local del suelo esta arriba de 1, contra 0,2 a 0,7 del
    panel— y es esa aspereza, no la temperatura, lo que la compuerta de panel
    usa para no medir fuera de un panel. Sin textura, el suelo a 70 pasaria
    por un panel muy caliente.
  */
  const celsius = new Float32Array(640 * 512);
  let semilla = 17;
  for (let i = 0; i < celsius.length; i++) {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
    celsius[i] = sueloC + (semilla / 0x7fffffff - 0.5) * 6;
  }
  const anchoM = 2 * alturaM * Math.tan((camara.hfovDeg * Math.PI) / 360);
  const altoM = 2 * alturaM * Math.tan((camara.vfovDeg * Math.PI) / 360);
  const rux = farm.rows[0]!.ux, ruy = farm.rows[0]!.uy;

  for (let py = 0; py < 512; py++) {
    for (let px = 0; px < 640; px++) {
      const u = (px / 640 - 0.5) * anchoM;
      const v = (0.5 - py / 512) * altoM;
      const ex = u - 0, ey = v - 0;
      const aLargo = ex * rux + ey * ruy;
      const cruzado = -ex * ruy + ey * rux;
      // Igual que la escena derecha, pero el modulo mide `factor` de su ancho.
      /*
        La fila ENTERA de modulos, no uno solo.

        Antes se pintaba un solo modulo sobre un campo de suelo pelado. Eso no
        puede pasar: la fila esta ahi. Y el motor ahora mira todas las cajas de
        una foto juntas para decidir si estan cayendo sobre paneles, asi que
        una escena con un panel y cien cajas sobre tierra la descarta entera —
        con razon.
      */
      const enLaFila =
        Math.abs(cruzado) <= (LARGO_M * factor) / 2 &&
        Math.abs(aLargo) <= (ANCHO_M * 28) / 2;
      if (enLaFila) celsius[py * 640 + px] = 45; // los modulos, trabajando y sanos
    }
  }
  return { ...foto, radio: { ...foto.radio, celsius } };
}

// ---------------------------------------------------------------------------

describe("el modulo caliente es el que se reporta", () => {
  it("volando paralelo a las filas, el vecino sano queda sano", () => {
    const hs = medir(28, 25, 0);
    const caliente = hs.find((h) => h.modulo.positionInRow === 28);
    const vecino = hs.find((h) => h.modulo.positionInRow === 27);

    expect(caliente, "el modulo 28 tiene que estar medido").toBeDefined();
    expect(caliente!.celsius).toBeGreaterThan(60);

    // Lo que fallaba: el 27, que esta a 45 grados, salia con 20 de punto
    // caliente interno y severidad moderada.
    if (vecino) {
      expect(vecino.celsius, "el vecino no puede leer caliente").toBeLessThan(50);
      expect(vecino.peor, `el modulo 27 salio ${vecino.peor}`).toBe("normal");
    }
  });

  /**
   * Y volando en diagonal. Aca la caja alineada a los ejes de la imagen cubre
   * esquinas de cuatro modulos, asi que este caso no lo salvaba ni acertar con
   * las dimensiones.
   */
  it("volando en diagonal tambien", () => {
    const hs = medir(28, 25, 35);
    const caliente = hs.find((h) => h.modulo.positionInRow === 28);
    expect(caliente, "el modulo 28 tiene que estar medido").toBeDefined();
    expect(caliente!.celsius).toBeGreaterThan(58);
    for (const p of [26, 27, 29, 30]) {
      const v = hs.find((h) => h.modulo.positionInRow === p);
      if (v) expect(v.celsius, `el modulo ${p} leyo caliente`).toBeLessThan(52);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Los trackers no estan planos.
 *
 * Giran de -55 a +55 grados siguiendo al sol. Un modulo fotografiado con el
 * tracker contra su tope se ve al 57 % de su ancho, y la caja de medicion —que
 * se dibujaba SIEMPRE del ancho del modulo acostado— le sobra por los dos
 * costados. Lo que sobra cae sobre el suelo, que al sol lee muy distinto, y le
 * baja la mediana al modulo entero: un modulo caliente puede pasar por sano.
 */
describe("con los trackers inclinados", () => {
  const acortamiento = Math.cos((55 * Math.PI) / 180); // 0.574

  function medirInclinado(conCorreccion: boolean) {
    const acc = new Acumulador(farm, marco, {
      camera: camara, moduloAnchoM: ANCHO_M, moduloLargoM: LARGO_M,
    });
    acc.agregar(escenaInclinada(28, 25, acortamiento), conCorreccion ? acortamiento : 1);
    return comparar(acc.muestras()).find((h) => h.modulo.positionInRow === 28);
  }

  /**
   * El modulo esta sano, a 45 °C. El suelo pelado al lado esta a 70. Con la
   * caja dibujada del ancho del modulo ACOSTADO, los pixeles mas calientes de
   * la caja son suelo, y el chequeo interno los reporta como una celda a 70
   * grados: un modulo sano sale como defecto critico.
   *
   * La compuerta de panel NO frena este caso, y esta bien que no lo frene: la
   * caja se pasa del panel medio pixel por lado —el 4 % de la caja— y una
   * compuerta que tirara cajas con el 96 % sobre panel tiraria tambien los
   * diodos de bypass reales, que ensucian mas que eso. Lo que arregla este
   * caso es la correccion por el angulo del tracker, que es lo que fija la
   * prueba siguiente. Esta queda para que se sepa por que existe aquella.
   */
  it("sin corregir, el suelo caliente entra a la caja y se reporta como celda", () => {
    const sin = medirInclinado(false);
    expect(sin, "el modulo tiene que estar medido igual").toBeDefined();
    expect(sin!.puntoCalienteC ?? 0).toBeGreaterThan(60);
  });

  it("corrigiendo por el angulo, la caja se queda adentro del modulo", () => {
    const con = medirInclinado(true);
    expect(con).toBeDefined();
    expect(con!.puntoCalienteC ?? 99).toBeLessThan(55);
    expect(con!.celsius).toBeGreaterThan(40);
    expect(con!.celsius).toBeLessThan(50);
  });

  it("la diferencia entre las dos es la que separa un sano de un critico", () => {
    const sin = medirInclinado(false)!;
    const con = medirInclinado(true)!;
    expect((sin.puntoCalienteC ?? 0) - (con.puntoCalienteC ?? 0)).toBeGreaterThan(10);
    expect(con.peor).toBe("normal");
  });
});

// ---------------------------------------------------------------------------

/**
 * La caja tiene que saber en que cuadro estan sus coordenadas.
 *
 * Sin eso es un par de numeros sin unidad, y eso costo caro. El recuadro se
 * dibuja sobre el JPEG, y con "Super Resolution" prendida el JPEG mide
 * 1280x1024 mientras que la caja esta en el marco de la termica cruda,
 * 640x512. La pantalla escalaba con el tamano del JPEG y dibujaba TODOS los
 * recuadros a la mitad de su posicion — exactamente la mitad — asi que un
 * defecto real aparecia senalado sobre el pasto.
 *
 * La medicion estaba bien todo el tiempo. Lo que estaba mal era el dibujo, que
 * es lo unico que una persona puede mirar para creerle al informe.
 */
describe("la caja guarda su propio marco", () => {
  it("trae el tamaño de la termica, no el del archivo", () => {
    const hs = medir(28, 25, 0);
    const uno = hs.find((h) => h.caja)!;
    expect(uno.caja!.ancho).toBe(640);
    expect(uno.caja!.alto).toBe(512);
  });

  /*
    El caso que rompio: la termica cruda entra a 640x512 aunque el JPEG venga
    al doble. La caja tiene que quedar en el marco de la termica.
  */
  it("con el JPEG al doble, la caja sigue en el marco de la termica", () => {
    const acc = new Acumulador(farm, marco, {
      camera: camara, moduloAnchoM: ANCHO_M, moduloLargoM: LARGO_M,
    });
    const foto = escena(28, 25, 0);
    // El lector devuelve el crudo a 640x512 y marca la foto como super
    // resolucion: el archivo media 1280x1024.
    acc.agregar({ ...foto, radio: { ...foto.radio, superResolucion: true } });
    const uno = acc.muestras().find((m) => m.caja)!;
    expect(uno.caja!.ancho).toBe(640);
    expect(uno.caja!.alto).toBe(512);
  });
});
