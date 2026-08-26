/**
 * Leer la temperatura de una foto termica.
 *
 * Esto se creia imposible sin el SDK nativo del fabricante. No lo es: los
 * valores crudos viajan en segmentos APP3 del propio JPEG, dos bytes por
 * pixel. Verificado contra 8 fotos reales de Edenvale del 25 de marzo, donde
 * da 23-28 C de suelo, 38-43 C de modulo y 52-56 C en los puntos calientes.
 *
 * Los tests de aca arman un JPEG a mano, porque una foto real pesa 1,5 MB y no
 * tiene por que vivir en el repositorio. La prueba contra las fotos de verdad
 * la hace scripts/leer-termicas.mjs.
 */

import { describe, expect, it } from "vitest";
import { elegirEscala, medianaEnCaja, readRadiometric, percentil } from "../app/thermal";

/**
 * Un JPEG minimo con su cabecera de dimensiones y el crudo termico en APP3.
 *
 * No tiene imagen comprimida y no hace falta: el lector se detiene en el SOS.
 */
function jpegTermico(w: number, h: number, crudo: Uint16Array, trozos = 1): ArrayBuffer {
  const partes: number[] = [0xff, 0xd8];

  // SOF0: alto y ancho.
  // FFC0 · largo 17 · precision · alto · ancho · 3 componentes de 3 bytes.
  partes.push(0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03);
  for (let i = 0; i < 9; i++) partes.push(0);

  const bytes = new Uint8Array(crudo.length * 2);
  for (let i = 0; i < crudo.length; i++) {
    bytes[i * 2] = crudo[i]! & 255;
    bytes[i * 2 + 1] = crudo[i]! >> 8;
  }
  const porTrozo = Math.ceil(bytes.length / trozos);
  for (let t = 0; t < trozos; t++) {
    const slice = bytes.subarray(t * porTrozo, Math.min(bytes.length, (t + 1) * porTrozo));
    const len = slice.length + 2;
    partes.push(0xff, 0xe3, len >> 8, len & 255, ...slice);
  }

  partes.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);
  return new Uint8Array(partes).buffer;
}

/** Escena en 1/64 de kelvin: fondo a `base` grados con un punto caliente. */
function escena(w: number, h: number, base: number, calienteC?: { x: number; y: number; c: number }) {
  const a = new Uint16Array(w * h);
  const k = (c: number) => Math.round((c + 273.15) * 64);
  a.fill(k(base));
  // Un poco de textura, si no la escena no tiene contraste y se rechaza.
  for (let i = 0; i < a.length; i += 3) a[i] = k(base + 2);
  if (calienteC) a[calienteC.y * w + calienteC.x] = k(calienteC.c);
  return a;
}

// ---------------------------------------------------------------------------

describe("lectura del crudo termico", () => {
  it("saca las dimensiones del propio JPEG y devuelve un valor por pixel", () => {
    const r = readRadiometric(jpegTermico(8, 4, escena(8, 4, 40)))!;
    expect(r.width).toBe(8);
    expect(r.height).toBe(4);
    expect(r.celsius).toHaveLength(32);
  });

  // El caso real: 640x512 no entra en un segmento de 64 kB, viene partido en 10.
  it("junta el crudo repartido en varios segmentos APP3", () => {
    const a = escena(64, 32, 41);
    const uno = readRadiometric(jpegTermico(64, 32, a, 1))!;
    const diez = readRadiometric(jpegTermico(64, 32, a, 10))!;
    expect([...diez.celsius]).toEqual([...uno.celsius]);
  });

  it("reconoce la escala y da temperaturas de este mundo", () => {
    const r = readRadiometric(jpegTermico(32, 32, escena(32, 32, 42, { x: 10, y: 10, c: 61 })))!;
    expect(r.escala).toBe("1/64 de kelvin");
    expect(percentil([...r.celsius], 50)).toBeCloseTo(42, 0);
    expect(Math.max(...r.celsius)).toBeCloseTo(61, 0);
  });

  // En un lote mezclado la mitad de las fotos son visibles. No es una falla.
  it("una foto sin crudo termico devuelve null, no un error", () => {
    const sinApp3 = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]).buffer;
    expect(readRadiometric(sinApp3)).toBeNull();
    expect(readRadiometric(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
  });

  it("no acepta un crudo mas corto que la imagen", () => {
    expect(readRadiometric(jpegTermico(64, 64, escena(8, 8, 40)))).toBeNull();
  });
});

describe("elegir la escala", () => {
  it("rechaza las que dan temperaturas imposibles", () => {
    const a = new Uint16Array(400);
    for (let i = 0; i < a.length; i++) a[i] = 20000 + (i % 100);
    // 20000/64 - 273.15 = 39 C. Las otras escalas dan 1727 C o -73 C.
    expect(elegirEscala(a)!.nombre).toBe("1/64 de kelvin");
  });

  // Si toda la escena da el mismo numero, el delta T seria basura.
  it("rechaza una escena sin contraste en vez de devolver algo", () => {
    expect(elegirEscala(new Uint16Array(400).fill(20000))).toBeNull();
  });
});

describe("medir un modulo", () => {
  // Mediana y no promedio: en el borde entran pixeles de suelo, y uno solo
  // corre el promedio varios grados.
  it("un pixel de suelo no corre la medicion", () => {
    const a = escena(20, 20, 45);
    a[10 * 20 + 10] = Math.round((5 + 273.15) * 64); // un pixel helado
    const r = readRadiometric(jpegTermico(20, 20, a))!;
    const m = medianaEnCaja(r, 10, 10, 6, 6)!;
    expect(m.celsius).toBeGreaterThan(44);
    expect(m.pixeles).toBe(49);
  });

  it("recorta la caja al borde de la imagen en vez de salirse", () => {
    const r = readRadiometric(jpegTermico(20, 20, escena(20, 20, 45)))!;
    expect(medianaEnCaja(r, 0, 0, 10, 10)!.pixeles).toBe(36);
    expect(medianaEnCaja(r, -50, -50, 4, 4)).toBeNull();
  });
});
