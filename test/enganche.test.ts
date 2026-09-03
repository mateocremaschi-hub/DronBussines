/**
 * Enganchar la rejilla de modulos a los paneles que se ven en la foto.
 *
 * Salio del primer vuelo real con el Matrice 4T. La app entrego 31 hallazgos
 * sobre 3 fotos y los 31 eran falsos: las cajas de medicion caian en la franja
 * de sombra fria al costado de cada fila, leian 31-34 °C cuando los paneles de
 * esa misma foto estaban a 41-42, y la textura del suelo salia reportada como
 * puntos calientes de celda de +15 °C.
 *
 * La causa no era el detector sino el GPS: un dron sin RTK trae 1 a 2 m de
 * error y la caja de medicion mide 1,3 m de ancho. Y lo peor es que no se
 * notaba: el error corre a TODAS las cajas de la foto por igual, asi que la
 * mediana del string se corre con ellas y cada modulo da delta T cero.
 */

import { describe, expect, it } from "vitest";
import {
  confianzaDeFoto,
  desvioLocal,
  engancharFoto,
  sondearCaja,
  pasoEnLaImagen,
  escalaDeLaImagen,
  LISO_C,
  type Caja,
} from "../app/encaje";
import type { Radiometric } from "../app/thermal";

const W = 320, H = 256;

/**
 * Una escena como la de verdad: filas de modulos lisas, separadas por pasto
 * ruidoso, con una franja fria pegada al borde de cada fila.
 *
 * Los numeros salen de las fotos reales de Edenvale del 3 de septiembre:
 * modulos a 42 °C con muy poca textura, pasto a 47 con mucha, y la sombra del
 * borde a 31.
 */
function parque(opciones: { pasoPx?: number; altoPx?: number } = {}): Radiometric {
  const paso = opciones.pasoPx ?? 64;
  const alto = opciones.altoPx ?? 26;
  const celsius = new Float32Array(W * H);
  // Ruido reproducible: si cambia entre corridas, cambia el resultado.
  let semilla = 12345;
  const ruido = () => {
    semilla = (semilla * 1664525 + 1013904223) >>> 0;
    return semilla / 0xffffffff - 0.5;
  };
  for (let y = 0; y < H; y++) {
    const enLaFila = y % paso;
    for (let x = 0; x < W; x++) {
      if (enLaFila < alto) celsius[y * W + x] = 42 + ruido() * 0.4;          // modulo: liso
      else if (enLaFila < alto + 6) celsius[y * W + x] = 31 + ruido() * 6;   // sombra del borde
      else celsius[y * W + x] = 47 + ruido() * 5;                            // pasto
    }
  }
  return {
    width: W, height: H, celsius,
    escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0,
  };
}

/** Las cajas de esa escena, corridas `corrimiento` pixeles cruzado a la fila. */
function cajas(corrimiento: number, paso = 64, alto = 26): Caja[] {
  const out: Caja[] = [];
  for (let y = alto / 2; y < H; y += paso) {
    for (let x = 20; x < W - 20; x += 24) {
      out.push({ cx: x, cy: y + corrimiento, largo: 20, cruzado: alto * 0.6, rotRad: 0 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("distinguir un panel del suelo", () => {
  it("un panel es liso y el pasto no, con mucho margen entre los dos", () => {
    const r = parque();
    const sd = desvioLocal(r);
    const panel = sondearCaja(r, sd, { cx: 160, cy: 13, largo: 20, cruzado: 16, rotRad: 0 })!;
    const pasto = sondearCaja(r, sd, { cx: 160, cy: 48, largo: 20, cruzado: 16, rotRad: 0 })!;
    // Lo que importa es que caigan de lados distintos del limite, con margen.
    expect(panel.liso).toBeLessThan(LISO_C * 0.7);
    expect(pasto.liso).toBeGreaterThan(LISO_C * 1.3);
    // Y la temperatura tambien los separa, en el otro sentido.
    expect(panel.celsius).toBeCloseTo(42, 0);
    expect(pasto.celsius).toBeGreaterThan(45);
  });

  it("una caja que se sale del cuadro no se juzga: eso lo decide el conteo de pixeles", () => {
    const r = parque();
    const sd = desvioLocal(r);
    expect(sondearCaja(r, sd, { cx: -50, cy: 13, largo: 20, cruzado: 16, rotRad: 0 })).toBeNull();
  });
});

describe("el corrimiento de una foto", () => {
  it("una foto bien puesta no se toca", () => {
    const r = parque();
    const sd = desvioLocal(r);
    expect(engancharFoto(r, sd, cajas(0), 20, 0.045)).toBeNull();
  });

  it("una foto corrida vuelve a caer sobre los paneles", () => {
    const r = parque();
    const sd = desvioLocal(r);
    const corridas = cajas(18);
    expect(confianzaDeFoto(corridas.map((c) => sondearCaja(r, sd, c))).sirve).toBe(false);

    const enc = engancharFoto(r, sd, corridas, 25, 0.045)!;
    expect(enc, "tenia que encontrar el corrimiento").not.toBeNull();
    expect(enc.despues).toBeGreaterThan(0.9);
    const puestas = corridas.map((c) => sondearCaja(r, sd, c, enc.dx, enc.dy));
    expect(confianzaDeFoto(puestas).sirve).toBe(true);
    expect(confianzaDeFoto(puestas).medianaC).toBeCloseTo(42, 0);
  });

  /*
    Este es el peor error posible de todos, y por eso el limite de busqueda no
    es negociable: la fila de al lado tambien es lisa y tambien es un panel, asi
    que si se la deja alcanzar, el enganche queda "perfecto" y todos los modulos
    del informe son el vecino. No hay ningun sintoma que lo delate despues.
  */
  it("nunca se corre hasta la fila de al lado, aunque ahi tambien haya panel", () => {
    const r = parque();
    const sd = desvioLocal(r);
    // Con el limite bien puesto —menos de media separacion entre filas— el
    // corrimiento que encuentra no puede llegar a la fila siguiente.
    const enc = engancharFoto(r, sd, cajas(18), 25, 0.045)!;
    expect(Math.abs(enc.dy)).toBeLessThan(64 / 2);
  });

  /*
    El objetivo cuenta cajas sobre panel en vez de promediar cuanta textura hay.
    Con el promedio, la busqueda se escapa de cualquier cosa que tenga
    estructura — y un modulo roto tiene estructura. Este test fija que un
    defecto no mueva la rejilla.
  */
  it("un modulo roto no corre la rejilla para dejarlo afuera", () => {
    const r = parque();
    // Una franja caliente que cruza un modulo: la firma de un diodo de bypass.
    for (let y = 6; y < 14; y++) for (let x = 150; x < 170; x++) r.celsius[y * W + x] = 56;
    const sd = desvioLocal(r);
    expect(engancharFoto(r, sd, cajas(0), 20, 0.045)).toBeNull();
  });
});

describe("cuando la foto no engancha", () => {
  it("se nota mirando todas las cajas juntas, que es donde se ve", () => {
    const r = parque();
    const sd = desvioLocal(r);
    const bien = confianzaDeFoto(cajas(0).map((c) => sondearCaja(r, sd, c)));
    const mal = confianzaDeFoto(cajas(18).map((c) => sondearCaja(r, sd, c)));
    expect(bien.fraccionLisa).toBeGreaterThan(0.9);
    expect(mal.fraccionLisa).toBeLessThan(0.5);
    expect(bien.sirve).toBe(true);
    expect(mal.sirve).toBe(false);
  });

  /*
    La franja de sombra es lo que estaba midiendo la app en el vuelo real: 31 °C
    contra 42 de los paneles. Se reconoce por FRIA, no por rara — un defecto
    siempre calienta, asi que descartar por frio no puede tirar un hallazgo.
  */
  it("la caja que cae en la sombra del borde lee diez grados por debajo de su foto", () => {
    const r = parque();
    const sd = desvioLocal(r);
    const foto = confianzaDeFoto(cajas(0).map((c) => sondearCaja(r, sd, c)));
    const sombra = sondearCaja(r, sd, { cx: 160, cy: 29, largo: 20, cruzado: 4, rotRad: 0 })!;
    expect(foto.medianaC - sombra.celsius).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------

/**
 * La escala del EXIF no es la de la imagen.
 *
 * La huella de una foto se calcula con la altura del EXIF y el campo de vision
 * de la camara. Contra las dos distancias que Mateo midio con cinta en
 * Edenvale —el paso entre modulos, 1155 mm, y la separacion entre filas, 5460—
 * el EXIF exagera la escala un 4 a 5 % en las tres fotos del Matrice 4T. La
 * causa mas probable es que la "altura relativa" se mide contra el punto de
 * despegue, que es el suelo, y los paneles estan dos metros mas arriba: a
 * cincuenta metros, dos metros son el 4 %.
 *
 * Y es el unico error que no arregla ni un corrimiento ni un giro, porque
 * crece desde el centro del cuadro hacia afuera.
 */
describe("contar el paso entre modulos en la propia imagen", () => {
  /** Una fila de modulos con juntas frias cada `paso` pixeles. */
  function fila(paso: number): Radiometric {
    const celsius = new Float32Array(W * H).fill(47);
    let semilla = 999;
    const ruido = () => { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 0xffffffff - 0.5; };
    for (let y = 100; y < 140; y++) {
      for (let x = 0; x < W; x++) {
        const enLaJunta = x % paso < 2;
        celsius[y * W + x] = (enLaJunta ? 39 : 42) + ruido() * 0.4;
      }
    }
    return {
      width: W, height: H, celsius,
      escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0,
    };
  }

  it("encuentra el paso que hay, no el que se le sugiere", () => {
    const r = fila(26);
    // Se le pide buscar alrededor de 22 px, que es lo que diria un EXIF con la
    // altura medida contra el suelo en vez de contra los paneles.
    const p = pasoEnLaImagen(r, { cx: W / 2, cy: 120 }, 0, W - 20, 36, 22)!;
    expect(p, "tenia que contar el paso").not.toBeNull();
    expect(p.pasoPx).toBe(26);
    expect(p.fuerza).toBeGreaterThan(0.3);
  });

  it("sobre una superficie sin juntas no inventa un paso", () => {
    const celsius = new Float32Array(W * H).fill(42);
    const liso: Radiometric = {
      width: W, height: H, celsius,
      escala: "de prueba", escalaAuto: "de prueba", topeC: 999, fraccionEnElTope: 0,
    };
    expect(pasoEnLaImagen(liso, { cx: W / 2, cy: 120 }, 0, W - 20, 36, 22)).toBeNull();
  });

  /*
    El factor solo se acepta si varias filas coinciden. Una fila sola puede
    engancharse en un armonico —contar dos modulos como uno— y eso corregiria
    la escala al doble.
  */
  it("con una sola fila no se decide, y un disparate se descarta", () => {
    expect(escalaDeLaImagen([{ pasoPx: 26, esperadoPx: 24 }])).toBeNull();
    expect(escalaDeLaImagen([
      { pasoPx: 26, esperadoPx: 24 },
      { pasoPx: 52, esperadoPx: 24 },   // el armonico: se descarta por absurdo
    ])).toBeNull();
  });

  it("con dos filas que coinciden, devuelve el factor", () => {
    const f = escalaDeLaImagen([
      { pasoPx: 26, esperadoPx: 24 },
      { pasoPx: 26, esperadoPx: 24.2 },
    ])!;
    expect(f).toBeCloseTo(24.1 / 26, 2);
  });
});
