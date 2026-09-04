import { describe, expect, it } from "vitest";
import type { Radiometric } from "../app/thermal";
import {
  corrimientoEsperado,
  decidirElGiro,
  normalizarAzimut,
  rumboDeLaFoto,
  votoDeUnPar,
  type VotoDeUnPar,
} from "../app/rumbo";

const W = 160, H = 160;

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
    expect(voto!.giroDeg).toBe(180);
    expect(voto!.margen).toBeGreaterThan(0.15);
  });

  it("no inventa un giro cuando el EXIF ya estaba bien", () => {
    const a = foto(0, 0);
    const b = foto(0, 40);
    const voto = votoDeUnPar({
      a, b, dEsteM: 0, dNorteM: 2, mPorPx: 0.05, gimbalYawDeg: 0,
    });
    expect(voto!.giroDeg).toBe(0);
    expect(voto!.margen).toBeGreaterThan(0.15);
  });

  it("no contesta cuando el dron no se movio o cuando las fotos no se pisan", () => {
    const a = foto(0, 0), b = foto(0, 4);
    expect(votoDeUnPar({ a, b, dEsteM: 0, dNorteM: 0.2, mPorPx: 0.05, gimbalYawDeg: 0 })).toBeNull();
    expect(votoDeUnPar({ a, b, dEsteM: 0, dNorteM: 40, mPorPx: 0.05, gimbalYawDeg: 0 })).toBeNull();
  });

  const firme = (giroDeg: number): VotoDeUnPar => ({ giroDeg, puntaje: 0.9, margen: 0.4 });
  const flojo = (giroDeg: number): VotoDeUnPar => ({ giroDeg, puntaje: 0.9, margen: 0.02 });

  it("decide con los pares que deciden y descarta los que no", () => {
    const giro = decidirElGiro([firme(180), firme(180), firme(180), flojo(0), flojo(90)]);
    expect(giro).toEqual({ giroDeg: 180, votos: 3, aFavor: 3, mirados: 5 });
  });

  it("no decide nada si los pares se contradicen", () => {
    expect(decidirElGiro([firme(180), firme(180), firme(0), firme(90)])).toBeNull();
  });

  it("no decide nada con dos pares, por mas de acuerdo que esten", () => {
    expect(decidirElGiro([firme(180), firme(180)])).toBeNull();
  });

  it("sin medicion, el rumbo sigue siendo el del EXIF", () => {
    expect(rumboDeLaFoto(null, -178.9)).toBe(-178.9);
    expect(rumboDeLaFoto(null, null)).toBeNull();
  });

  it("con medicion, el angulo fino lo pone el EXIF y el lado lo pone la foto", () => {
    const giro = { giroDeg: 180, votos: 4, aFavor: 4, mirados: 14 };
    // Las dos pasadas del bloque 1: el EXIF dice cosas opuestas y las dos
    // terminan mirando al mismo lado, que es lo que se midio.
    expect(rumboDeLaFoto(giro, -178.9)).toBeCloseTo(1.1, 6);
    expect(rumboDeLaFoto(giro, 1.3)).toBeCloseTo(181.3, 6);
    expect(normalizarAzimut(-1)).toBe(359);
  });
});
