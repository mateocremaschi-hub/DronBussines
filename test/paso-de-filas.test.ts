import { describe, expect, it } from "vitest";
import { desvioLocal, pasoDeFilasEnLaImagen } from "../app/encaje";
import type { Radiometric } from "../app/thermal";

const W = 640, H = 512;

/**
 * Un parque sintetico: franjas lisas de panel separadas por franjas de pasto
 * con textura, con el paso que se pida y a la inclinacion que se pida.
 */
function parque(pasoPx: number, anchoPanel: number, rotRad: number, fase = 0): Radiometric {
  const celsius = new Float32Array(W * H);
  const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
  let semilla = 12345;
  const azar = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cruce = -(x - W / 2) * sin + (y - H / 2) * cos + fase;
      const dentro = Math.abs(((cruce % pasoPx) + pasoPx) % pasoPx - pasoPx / 2) < anchoPanel / 2;
      celsius[y * W + x] = dentro ? 40 + azar() * 0.2 : 46 + azar() * 6;
    }
  }
  return { width: W, height: H, celsius } as unknown as Radiometric;
}

describe("el paso entre filas contado sobre la imagen", () => {
  it("lo cuenta con menos de un pixel de error", () => {
    for (const paso of [90, 110.4, 130]) {
      const r = parque(paso, paso * 0.4, Math.PI / 2);
      const p = pasoDeFilasEnLaImagen(r, desvioLocal(r), Math.PI / 2, paso * 0.95);
      expect(p, `paso ${paso}`).not.toBeNull();
      expect(Math.abs(p!.pasoPx - paso), `paso ${paso} dio ${p?.pasoPx}`).toBeLessThan(1);
    }
  });

  it("lo cuenta igual con las filas inclinadas", () => {
    const paso = 110;
    const rot = Math.PI / 2 + 0.15;
    const r = parque(paso, paso * 0.4, rot);
    const p = pasoDeFilasEnLaImagen(r, desvioLocal(r), rot, paso);
    expect(Math.abs(p!.pasoPx - paso)).toBeLessThan(1.5);
  });

  it("no salta al doble ni a la mitad, aunque le mientan lo esperado", () => {
    /*
      Un parque es periodico y el pico de dos pasos es casi tan alto como el de
      uno. Si la busqueda fuera ancha, la escala saldria al doble sin un solo
      sintoma: cada modulo se dibujaria en el lugar del de al lado.
    */
    const paso = 110;
    const r = parque(paso, paso * 0.4, Math.PI / 2);
    const sd = desvioLocal(r);
    // Lo esperado erra un 20 %: sigue encontrando el paso de verdad.
    expect(pasoDeFilasEnLaImagen(r, sd, Math.PI / 2, paso * 1.2)!.pasoPx).toBeCloseTo(paso, 0);
    // Lo esperado erra el doble: NO devuelve el doble, devuelve lo que hay
    // adentro de su ventana o nada, pero nunca 220.
    const doble = pasoDeFilasEnLaImagen(r, sd, Math.PI / 2, paso * 2);
    if (doble) expect(doble.pasoPx).toBeLessThan(paso * 1.6);
  });

  it("no contesta cuando la foto no es un parque de filas paralelas", () => {
    const celsius = new Float32Array(W * H);
    let s = 7;
    for (let i = 0; i < celsius.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      celsius[i] = 40 + (s / 0x7fffffff) * 8;
    }
    const r = { width: W, height: H, celsius } as unknown as Radiometric;
    expect(pasoDeFilasEnLaImagen(r, desvioLocal(r), Math.PI / 2, 110)).toBeNull();
  });

  it("no contesta cuando no entran tres filas en el cuadro", () => {
    const r = parque(260, 100, Math.PI / 2);
    expect(pasoDeFilasEnLaImagen(r, desvioLocal(r), Math.PI / 2, 260)).toBeNull();
  });
});
