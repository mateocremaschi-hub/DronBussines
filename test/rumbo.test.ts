import { describe, expect, it } from "vitest";
import type { Radiometric } from "../app/thermal";
import {
  corrimientoEsperado,
  GIROS,
  decidirElGiro,
  normalizarAzimut,
  rumboDeLaFoto,
  votoDeUnPar,
  type VotoDeUnPar,
} from "../app/rumbo";

const W = 160, H = 160;

/** El indice del puntaje mas alto. */
function mejorDe(puntajes: number[]): number {
  let m = 0;
  for (let i = 1; i < puntajes.length; i++) if (puntajes[i]! > puntajes[m]!) m = i;
  return m;
}

/** Un terreno con detalle en las dos direcciones, siempre el mismo. */
function terreno(): (x: number, y: number) => number {
  const crudo = (x: number, y: number) => {
    let h = ((x + 97) * 374761393 + (y + 31) * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    return ((h ^ (h >>> 16)) % 1000) / 1000;
  };
  // Suavizado: sin esto cada pixel es independiente y un corrimiento de un
  // pixel ya no correlaciona con nada, que no es como se ve un campo.
  return (x, y) => {
    let s = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += crudo(x + dx, y + dy);
    return 20 + s;
  };
}

function foto(desplazadaX: number, desplazadaY: number): Radiometric {
  const t = terreno();
  const celsius = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      celsius[y * W + x] = t(x + 300 - desplazadaX, y + 300 - desplazadaY);
    }
  }
  return { width: W, height: H, celsius } as unknown as Radiometric;
}

describe("hacia donde mira la foto", () => {
  it("el corrimiento y el azimut son la misma cuenta al derecho y al reves", () => {
    // Camara con el norte arriba, dron que va al norte: el contenido baja.
    const norte = corrimientoEsperado(0, 0, 2, 0.05);
    expect(norte.sx).toBeCloseTo(0, 6);
    expect(norte.sy).toBeCloseTo(40, 6);
    // La misma camara con el sur arriba: el contenido sube.
    const sur = corrimientoEsperado(180, 0, 2, 0.05);
    expect(sur.sy).toBeCloseTo(-40, 6);
    // Y volando al este con el norte arriba, se corre de costado.
    const este = corrimientoEsperado(0, 2, 0, 0.05);
    expect(este.sx).toBeCloseTo(-40, 6);
    expect(este.sy).toBeCloseTo(0, 6);
  });

  it("descubre que el rumbo del EXIF esta 180 grados corrido", () => {
    /*
      El caso del Matrice 4T. La camara mira al sur, el dron vuela al sur, y el
      EXIF declara que mira al norte. La foto de al lado lo desmiente: el
      terreno se corrio para el lado que corresponde al sur arriba.
    */
    const a = foto(0, 0);
    const b = foto(0, 40); // el contenido bajo 40 px
    const voto = votoDeUnPar({
      a, b, dEsteM: 0, dNorteM: -2, mPorPx: 0.05, gimbalYawDeg: 0,
    });
    expect(voto).not.toBeNull();
    expect(GIROS[mejorDe(voto!.puntajes)]).toBe(180);
  });

  it("no inventa un giro cuando el EXIF ya estaba bien", () => {
    const a = foto(0, 0);
    const b = foto(0, 40);
    const voto = votoDeUnPar({
      a, b, dEsteM: 0, dNorteM: 2, mPorPx: 0.05, gimbalYawDeg: 0,
    });
    expect(GIROS[mejorDe(voto!.puntajes)]).toBe(0);
  });

  it("no contesta cuando el dron no se movio o cuando las fotos no se pisan", () => {
    const a = foto(0, 0), b = foto(0, 4);
    expect(votoDeUnPar({ a, b, dEsteM: 0, dNorteM: 0.2, mPorPx: 0.05, gimbalYawDeg: 0 })).toBeNull();
    expect(votoDeUnPar({ a, b, dEsteM: 0, dNorteM: 40, mPorPx: 0.05, gimbalYawDeg: 0 })).toBeNull();
  });

  /** Un par que prefiere `giroDeg` por la diferencia dada. */
  const par = (giroDeg: number, ventaja: number): VotoDeUnPar => ({
    puntajes: GIROS.map((g) => (g === giroDeg ? 0.8 + ventaja : 0.8)),
  });

  it("suma pares que por su cuenta no deciden nada", () => {
    /*
      El caso del bloque 1: ningun par decide solo, pero todos prefieren lo
      mismo. Contando ganadores esto daba null y no se corregia nada.
    */
    const giro = decidirElGiro(Array.from({ length: 12 }, () => par(180, 0.1)));
    expect(giro?.giroDeg).toBe(180);
    expect(giro?.aFavor).toBe(12);
    expect(giro?.ventaja).toBeCloseTo(0.1, 6);
  });

  it("no decide nada si los pares se contradicen", () => {
    expect(decidirElGiro([par(180, 0.4), par(180, 0.4), par(0, 0.4), par(90, 0.4)])).toBeNull();
  });

  it("no decide nada cuando la ventaja promedio es un empate", () => {
    expect(decidirElGiro(Array.from({ length: 12 }, () => par(180, 0.01)))).toBeNull();
  });

  it("no decide nada con dos pares, por mas de acuerdo que esten", () => {
    expect(decidirElGiro([par(180, 0.5), par(180, 0.5)])).toBeNull();
  });

  it("sin medicion, el rumbo sigue siendo el del EXIF", () => {
    expect(rumboDeLaFoto(null, -178.9)).toBe(-178.9);
    expect(rumboDeLaFoto(null, null)).toBeNull();
  });

  it("con medicion, el angulo fino lo pone el EXIF y el lado lo pone la foto", () => {
    const giro = { giroDeg: 180, pares: 14, aFavor: 14, ventaja: 0.14 };
    // Las dos pasadas del bloque 1: el EXIF dice cosas opuestas y las dos
    // terminan mirando al mismo lado, que es lo que se midio.
    expect(rumboDeLaFoto(giro, -178.9)).toBeCloseTo(1.1, 6);
    expect(rumboDeLaFoto(giro, 1.3)).toBeCloseTo(181.3, 6);
    expect(normalizarAzimut(-1)).toBe(359);
  });
});
