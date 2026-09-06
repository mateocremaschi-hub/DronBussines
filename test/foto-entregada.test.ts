/**
 * La foto que se entrega.
 *
 * Hasta ahora viajaba el JPG crudo del dron: una termica en falso color, sin
 * saber cual de los paneles es el del hallazgo ni que temperatura es cada
 * color. Reenviada suelta —que es como viajan— no dice nada. Lo que se dibuja
 * acá tiene que defenderse solo, asi que estos tests miran las tres cosas que
 * hacen eso: el recuadro sobre EL modulo, la barra con los grados, y el pie
 * con la referencia que la ata a su fila del Excel.
 *
 * No hay canvas en node, asi que se le presta uno de mentira que anota lo que
 * le piden dibujar. Es suficiente: lo que se prueba es que se dibuje lo que
 * corresponde y donde, no como se ve el antialiasing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CALIDAD_ARCHIVO, CALIDAD_INFORME, fotoDelHallazgo, nombreDeLaFotoEntregada } from "../app/fotoEntregada";
import type { Finding } from "../app/inspection";

/** Un JPEG minimo con el crudo termico en APP3, como el de test/thermal. */
function jpegTermico(w: number, h: number, crudo: Uint16Array): ArrayBuffer {
  const partes: number[] = [0xff, 0xd8];
  partes.push(0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03);
  for (let i = 0; i < 9; i++) partes.push(0);
  const bytes = new Uint8Array(crudo.length * 2);
  for (let i = 0; i < crudo.length; i++) {
    bytes[i * 2] = crudo[i]! & 255;
    bytes[i * 2 + 1] = crudo[i]! >> 8;
  }
  const len = bytes.length + 2;
  partes.push(0xff, 0xe3, len >> 8, len & 255, ...bytes);
  partes.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);
  return new Uint8Array(partes).buffer;
}

function escena(w: number, h: number, base: number) {
  const a = new Uint16Array(w * h);
  const k = (c: number) => Math.round((c + 273.15) * 64);
  a.fill(k(base));
  for (let i = 0; i < a.length; i += 3) a[i] = k(base + 2);
  return a;
}

const termica = (w = 64, h = 48) =>
  new File([jpegTermico(w, h, escena(w, h, 40))], "DJI_0001_T.JPG");

const f = (o: Partial<Finding> = {}): Finding => ({
  id: "x", fileName: "DJI_0001_T.JPG", candidates: [], warnings: [], status: "pendiente",
  anomaly: "punto caliente",
  address: { rowId: "2-85", block: "2", tracker: "85", chunkIndex: 6, stringNumber: 7, module: 27,
    countedFrom: "near-dc", confidence: 1 } as Finding["address"],
  medicion: { celsius: 49.1, deltaT: 10.2, referenciaC: 38.9, vecinos: 26, ambito: "string",
    severidad: "leve", peor: "leve", origen: "modulo", pixeles: 40, deltaInterno: 4.5,
    caja: { cx: 30, cy: 20, largo: 12, cruzado: 6, rotRad: 0, largoModulo: 12, cruzadoModulo: 6 },
  } as Finding["medicion"],
  ...o,
});

// --- el canvas de mentira -------------------------------------------------

interface Trazo { tipo: string; args: unknown[] }

let trazos: Trazo[] = [];
let lienzos: Array<{ width: number; height: number }> = [];
let blobs = 0;
let calidadPedida: (q: number) => void = () => {};

function contextoFalso() {
  const anota = (tipo: string) => (...args: unknown[]) => { trazos.push({ tipo, args }); };
  return {
    fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "",
    imageSmoothingEnabled: false, imageSmoothingQuality: "",
    fillRect: anota("fillRect"),
    strokeRect: anota("strokeRect"),
    drawImage: anota("drawImage"),
    putImageData: anota("putImageData"),
    save: anota("save"),
    restore: anota("restore"),
    translate: anota("translate"),
    rotate: anota("rotate"),
    fillText: anota("fillText"),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
}

/** La imagen que la camara guardo adentro: 1280x1024, el doble del crudo. */
let hayFotoDelDron = true;

beforeEach(() => {
  trazos = []; lienzos = []; blobs = 0;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => {
    if (!hayFotoDelDron) throw new Error("no se pudo abrir");
    return { width: 1280, height: 1024, close() {} };
  };
  (globalThis as { document?: unknown }).document = {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`no esperaba un <${tag}>`);
      const ctx = contextoFalso();
      const c = {
        width: 0, height: 0,
        getContext: () => ctx,
        toBlob: (cb: (b: Blob) => void, tipo: string, q: number) => {
          blobs++; calidadPedida(q); cb(new Blob(["x"], { type: tipo }));
        },
      };
      lienzos.push(c);
      return c;
    },
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  hayFotoDelDron = true;
});

const textos = () => trazos.filter((t) => t.tipo === "fillText").map((t) => String(t.args[0]));

// ---------------------------------------------------------------------------

describe("la foto entregada", () => {
  it("deja lugar para la barra de escala y para el pie", async () => {
    await fotoDelHallazgo(termica(64, 48), f(), 0);
    // El lienzo grande es el de la entrega; el chico es la termica sin escalar.
    const grande = lienzos.find((c) => c.width > 64 * 2)!;
    expect(grande.width).toBeGreaterThan(64 * 2);
    expect(grande.height).toBeGreaterThan(48 * 2);
    expect(lienzos.some((c) => c.width === 64 && c.height === 48)).toBe(true);
  });

  /*
    Un recuadro pegado al borde tapa justo la fila de celdas donde suele estar
    el defecto. Mateo lo pidio mirando un hallazgo real: "el recuadro me tapa
    parte del panel y no puedo ver si tengo un error".
  */
  it("dibuja el recuadro mas grande que el modulo, no encima", async () => {
    await fotoDelHallazgo(termica(), f(), 0);
    // La escala del dibujo sale del traslado al centro de la caja (cx 30, cy 20).
    const centro = trazos.find((t) => t.tipo === "translate")!.args as number[];
    const escala = centro[0]! / 30;
    expect(centro).toEqual([30 * escala, 20 * escala]);
    const caja = trazos.find((t) => t.tipo === "strokeRect" && Number(t.args[2]) === 12 * 1.5 * escala);
    expect(caja, "el recuadro va a 1,5 veces el modulo").toBeTruthy();
    expect(caja!.args[3]).toBe(6 * 1.5 * escala);
  });

  it("escribe los dos extremos de la escala en grados", async () => {
    await fotoDelHallazgo(termica(), f(), 0);
    // Solo las dos puntas de la barra: "46.9 °C" y "27.8 °C". Las lineas de
    // la ficha tambien terminan en °C y no cuentan.
    expect(textos().filter((t) => /^-?\d+\.\d+ °C$/.test(t)).length).toBe(2);
  });

  it("el pie ata la foto a su fila del Excel y dice el ΔT", async () => {
    await fotoDelHallazgo(termica(), f(), 0);
    const pie = textos().join(" | ");
    expect(pie).toContain("001");
    expect(pie).toContain("Block 2");
    expect(pie).toContain("Tracker 85");
    expect(pie).toContain("String 7");
    expect(pie).toContain("module 27");
    expect(pie).toContain("+10.2 °C");
  });

  it("no inventa un numero de modulo cuando no esta confirmado", async () => {
    await fotoDelHallazgo(termica(), f({ moduloSinConfirmar: true }), 0);
    const pie = textos().join(" | ");
    expect(pie).toContain("module not confirmed");
    expect(pie).not.toContain("module 27");
  });

  /*
    La visible del par, o una termica que la camara guardo sin crudo. Devolver
    null es lo que deja al que llama entregar el original, que es mejor que
    entregar nada.
  */
  it("devuelve null si la foto no trae temperatura adentro", async () => {
    const sinCrudo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "DJI_0001_W.JPG");
    expect(await fotoDelHallazgo(sinCrudo, f(), 0)).toBeNull();
    expect(blobs).toBe(0);
  });

  it("sale un JPEG y con el mismo nombre que apunta el Excel", async () => {
    const b = await fotoDelHallazgo(termica(), f(), 0);
    expect(b?.type).toBe("image/jpeg");
    expect(nombreDeLaFotoEntregada(f(), 0)).toBe("001_B2_T85_S7_M27_+10.2C.jpg");
  });
});

/*
  El pie sale en ingles como todo el resto del entregable. El nombre interno
  del patron —"punto caliente"— no puede aparecer en una imagen que ve el
  cliente: salio asi en la primera entrega real y se ve en la foto 004.
*/
describe("el idioma del pie", () => {
  it("traduce el patron, no escribe el nombre interno", async () => {
    await fotoDelHallazgo(termica(), f({ anomaly: "Punto caliente" }), 0);
    const pie = textos().join(" | ");
    expect(pie).toContain("Hot spot");
    expect(pie).not.toContain("Punto caliente");
  });
});

/*
  Dos calidades a proposito.

  La de la carpeta es la copia de archivo. La del informe va mas comprimida
  porque ahi las fotos viajan adentro del HTML en base64: a calidad de archivo,
  un vuelo de sesenta hallazgos daria un informe de setenta megas que no se
  abre ni se manda por mail.
*/
describe("la calidad del JPEG", () => {
  it("la del informe pesa menos que la de la carpeta", () => {
    expect(CALIDAD_INFORME).toBeLessThan(CALIDAD_ARCHIVO);
    expect(CALIDAD_INFORME).toBeGreaterThan(0.8);
  });

  it("por defecto sale la de archivo", async () => {
    let pedida: number | undefined;
    const antes = calidadPedida;
    calidadPedida = (q) => { pedida = q; };
    await fotoDelHallazgo(termica(), f(), 0);
    expect(pedida).toBe(CALIDAD_ARCHIVO);
    await fotoDelHallazgo(termica(), f(), 0, CALIDAD_INFORME);
    expect(pedida).toBe(CALIDAD_INFORME);
    calidadPedida = antes;
  });
});

/*
  Las dos imagenes, y no es un adorno.

  La del dron es la que Mateo ve en el visor y tiene el doble de lado, pero la
  camara le mete realce local: la misma temperatura sale con hasta 78 de 255 de
  diferencia de color segun donde este en el cuadro, asi que sobre ESA imagen
  una barra de grados seria mentira. El mapa que pintamos nosotros tiene un
  solo mapeo para todo el cuadro, y por eso es el que lleva la barra.
*/
describe("la foto del dron al lado del mapa", () => {
  const imagenes = () => trazos.filter((t) => t.tipo === "drawImage");

  it("dibuja las dos: la del dron y el mapa", async () => {
    await fotoDelHallazgo(termica(), f(), 0);
    expect(imagenes()).toHaveLength(2);
    // La del dron arranca en 0 y ocupa sus 1280; el mapa va a la derecha.
    const [dron, mapa] = imagenes();
    expect(dron!.args.slice(1)).toEqual([0, 0, 1280, 1024]);
    expect(Number(mapa!.args[1])).toBe(1280);
  });

  it("el lienzo deja lugar para las dos y para la barra", async () => {
    await fotoDelHallazgo(termica(), f(), 0);
    const grande = lienzos.find((c) => c.width > 1280)!;
    // El ancho de la foto del dron mas la columna del mapa; el alto, el de la
    // foto: la ficha se acomoda en la columna y no agrega una banda al pie.
    expect(grande.width).toBeGreaterThan(1280);
    expect(grande.height).toBe(1024);
  });

  /*
    La caja se midio en pixeles del CRUDO. La del dron esta al doble, asi que
    el recuadro tiene que escalarse por lo que mida CADA imagen: dibujarlo con
    la misma escala en las dos lo dejaria fuera del panel en una.
  */
  it("el recuadro va en las dos, cada uno a su escala", async () => {
    await fotoDelHallazgo(termica(64, 48), f(), 0);
    const centros = trazos.filter((t) => t.tipo === "translate").map((t) => t.args as number[]);
    expect(centros).toHaveLength(2);
    // Crudo 64 de ancho, foto del dron 1280: veinte veces. Caja en cx 30.
    expect(centros[0]![0]).toBeCloseTo(30 * (1280 / 64), 1);
    // El mapa es mas chico y su recuadro va corrido a la derecha, donde empieza.
    expect(centros[1]![0]).toBeGreaterThan(1280);
  });

  it("la barra de grados va pegada al mapa, no a la del dron", async () => {
    await fotoDelHallazgo(termica(), f(), 0);
    const grados = trazos.filter((t) => t.tipo === "fillText" && /^-?\d+\.\d+ °C$/.test(String(t.args[0])));
    expect(grados).toHaveLength(2);
    for (const t of grados) expect(Number(t.args[1])).toBeGreaterThan(1280);
    expect(textos().join(" ")).toContain("colour = temperature");
  });

  /*
    Si el navegador no puede abrir la imagen del dron —un archivo raro, un
    Safari viejo— se entrega el mapa solo. Peor que con las dos, mucho mejor
    que nada.
  */
  it("sin la del dron entrega el mapa solo, y sigue midiendo", async () => {
    hayFotoDelDron = false;
    const b = await fotoDelHallazgo(termica(), f(), 0);
    expect(b).not.toBeNull();
    expect(imagenes()).toHaveLength(2);
    expect(textos().join(" | ")).toContain("Block 2");
  });

  it("el pie sigue diciendo de que panel es", async () => {
    await fotoDelHallazgo(termica(), f(), 0);
    const pie = textos().join(" | ");
    expect(pie).toContain("001");
    expect(pie).toContain("module 27");
    expect(pie).toContain("+10.2 °C");
  });
});
