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
import { fotoDelHallazgo, nombreDeLaFotoEntregada } from "../app/fotoEntregada";
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

beforeEach(() => {
  trazos = []; lienzos = []; blobs = 0;
  (globalThis as { document?: unknown }).document = {
    createElement(tag: string) {
      if (tag !== "canvas") throw new Error(`no esperaba un <${tag}>`);
      const ctx = contextoFalso();
      const c = {
        width: 0, height: 0,
        getContext: () => ctx,
        toBlob: (cb: (b: Blob) => void, tipo: string) => { blobs++; cb(new Blob(["x"], { type: tipo })); },
      };
      lienzos.push(c);
      return c;
    },
  };
});

afterEach(() => { delete (globalThis as { document?: unknown }).document; });

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
    const caja = trazos.find((t) => t.tipo === "strokeRect" && Number(t.args[2]) === 12 * 1.5 * 2);
    expect(caja).toBeTruthy();
    expect(caja!.args[3]).toBe(6 * 1.5 * 2);
    // Y centrado en el modulo: se traslada al centro de la caja antes de rotar.
    expect(trazos.find((t) => t.tipo === "translate")!.args).toEqual([60, 40]);
  });

  it("escribe los dos extremos de la escala en grados", async () => {
    await fotoDelHallazgo(termica(), f(), 0);
    expect(textos().filter((t) => /°C$/.test(t)).length).toBe(2);
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
