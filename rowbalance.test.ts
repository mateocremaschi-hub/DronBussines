/**
 * El cuadre de la fila.
 *
 * Lo que se prueba es la leccion que costo meses: que un numero DESPEJADO
 * siempre cierra, y que cerrar no es evidencia. El caso real de Edenvale entra
 * entero aca abajo — dos modelos que cuadran los mismos 65145 mm y que ponen
 * cada modulo con metro y medio de diferencia.
 */

import { describe, expect, it } from "vitest";
import { cuadreDeFila, type EntradaCuadre } from "../app/rowbalance";

/** Edenvale: 2 strings de 28, filas de 65,145 m de pica a pica. */
const base: EntradaCuadre = {
  modulosPorFila: 56,
  stringsPorFila: 2,
  anchoModuloMm: 1120,
  huecoEntreModulosMm: 20,
  bahiaMm: 555,
  offsetMm: 395,
  largoMedidoM: 65.145,
};

describe("sumar el fierro de una fila", () => {
  it("cuenta los huecos que hay, no uno por modulo", () => {
    const c = cuadreDeFila(base);
    const huecos = c.partes.find((p) => p.concepto.startsWith("Huecos"))!;
    // 27 huecos adentro de cada string, no 28.
    expect(huecos.cantidad).toBe(54);
    const bahia = c.partes.find((p) => p.concepto.startsWith("Bahia"))!;
    expect(bahia.cantidad).toBe(1);
  });

  it("con una fila de un solo string no inventa una bahia", () => {
    const c = cuadreDeFila({ ...base, stringsPorFila: 1, modulosPorFila: 28 });
    expect(c.partes.some((p) => p.concepto.startsWith("Bahia"))).toBe(false);
  });

  it("suma el fierro y le agrega el offset de las dos puntas", () => {
    const c = cuadreDeFila(base);
    expect(c.fierroMm).toBe(56 * 1120 + 54 * 20 + 555);
    expect(c.predichoMm).toBe(c.fierroMm + 2 * 395);
  });
});

// ---------------------------------------------------------------------------

describe("el caso real de Edenvale", () => {
  /** Lo que dice la cinta: bahia de 555 y la pica por fuera. */
  it("con las medidas de campo la fila cierra", () => {
    const c = cuadreDeFila(base);
    expect(c.cierra).toBe(true);
    expect(Math.abs(c.residuoMm)).toBeLessThan(120);
  });

  /**
   * El modelo viejo. Cierra igual de bien, y esa es toda la cuestion: el largo
   * total nunca pudo distinguirlos.
   */
  it("el modelo de la bahia de 3713 tambien cierra — por eso engaño", () => {
    const viejo = cuadreDeFila({
      ...base, anchoModuloMm: 1130, bahiaMm: 3713, offsetMm: -1464,
    });
    expect(viejo.cierra).toBe(true);
  });

  /**
   * Y sin embargo colocan los modulos en lugares distintos. Un cuadre que da
   * cero no dice nada sobre eso: por eso el aviso importa mas que el numero.
   */
  it("cuando cierra con numeros supuestos, avisa que no confirma nada", () => {
    const c = cuadreDeFila({ ...base, medidos: { ancho: true, hueco: true } });
    expect(c.cierra).toBe(true);
    expect(c.notas.join(" ")).toMatch(/no confirma nada/);
    expect(c.notas.join(" ")).toMatch(/2 de 4/);
  });

  it("cuando cierra y todo esta medido, ahi si lo llama evidencia", () => {
    const c = cuadreDeFila({
      ...base, medidos: { ancho: true, hueco: true, bahia: true, offset: true },
    });
    expect(c.notas.join(" ")).toMatch(/Esto si es evidencia/);
  });

  /**
   * La combinacion que destapo el problema: la bahia medida (555) junto con el
   * voladizo que se habia medido antes (−1464). No cierran, y faltan casi tres
   * modulos y medio.
   */
  it("mezclando las dos mediciones faltan 3,7 m y lo dice en modulos", () => {
    const c = cuadreDeFila({ ...base, bahiaMm: 555, offsetMm: -1464 });
    expect(c.cierra).toBe(false);
    expect(c.residuoMm).toBeCloseTo(3718, -1);
    expect(c.residuoEnModulos).toBeGreaterThan(3);
    expect(c.residuoEnModulos).toBeLessThan(3.5);
    expect(c.notas.join(" ")).toMatch(/Sobran 3718 mm/);
    expect(c.notas.join(" ")).toMatch(/hueco que no esta declarado/);
  });
});

// ---------------------------------------------------------------------------

describe("que dice cuando no cierra", () => {
  it("si sobra largo, apunta a un hueco sin declarar", () => {
    const c = cuadreDeFila({ ...base, largoMedidoM: 68 });
    expect(c.residuoMm).toBeGreaterThan(0);
    expect(c.notas.join(" ")).toMatch(/hueco que no esta declarado/);
  });

  it("si falta largo, apunta al paso o a la cantidad de modulos", () => {
    const c = cuadreDeFila({ ...base, largoMedidoM: 60 });
    expect(c.residuoMm).toBeLessThan(0);
    expect(c.notas.join(" ")).toMatch(/no entran en el largo/);
  });

  // La regla de oro, escrita en la propia app.
  it("dice explicitamente que no se arregla tocando el numero mas flojo", () => {
    const c = cuadreDeFila({ ...base, largoMedidoM: 68 });
    expect(c.notas.join(" ")).toMatch(/No lo arregles cambiando el numero que menos mediste/);
    expect(c.notas.join(" ")).toMatch(/Anda a la fila/);
  });

  it("una diferencia mas chica que un decimo de modulo no es un problema", () => {
    const c = cuadreDeFila({ ...base, largoMedidoM: 65.145 + 0.1 });
    expect(c.cierra).toBe(true);
  });
});

/**
 * El modo de las puntas.
 *
 * Esto salio de una pregunta de campo: "en este parque la coordenada se saco
 * desde el primer panel, no desde la pica; entonces pongo cero, no?". La
 * respuesta correcta era que con el preset PVH ese numero ya no se usaba para
 * nada —el modo es centrado— pero el cuadre lo seguia sumando dos veces y
 * mostraba un residuo que el motor no tenia. La tabla decia una cosa y la app
 * hacia otra.
 */
describe("a que puntas aplica el offset", () => {
  it("en modo centrado no usa el numero declarado: lo despeja del largo real", () => {
    const conUno = cuadreDeFila({ ...base, modo: "centered", offsetMm: -25 });
    const conOtro = cuadreDeFila({ ...base, modo: "centered", offsetMm: 9999 });
    // El offset declarado no mueve nada.
    expect(conOtro.predichoMm).toBe(conUno.predichoMm);
    expect(conOtro.repartoPorPuntaMm).toBe(conUno.repartoPorPuntaMm);
    // Y lo que reparte es exactamente lo que sobra, mitad y mitad.
    expect(conUno.repartoPorPuntaMm).toBeCloseTo((65145 - conUno.fierroMm) / 2, 6);
    expect(conUno.residuoMm).toBeCloseTo(0, 6);
  });

  it("centrado nunca se cuenta como medido, ni con la casilla tildada", () => {
    const c = cuadreDeFila({
      ...base, modo: "centered",
      medidos: { ancho: true, hueco: true, bahia: true, offset: true },
    });
    const punta = c.partes.find((p) => p.concepto.includes("reparte"))!;
    expect(punta.medido).toBe(false);
    expect(c.medidos).toBeLessThan(c.total);
  });

  it("centrado no dice 'la fila cierra': dice cuanto esta repartiendo", () => {
    const c = cuadreDeFila({ ...base, modo: "centered" });
    const texto = c.notas.join(" ");
    expect(texto).toMatch(/cierra siempre/);
    expect(texto).toMatch(/no prueba nada/i);
    expect(texto).not.toMatch(/Esto si es evidencia/);
  });

  it("centrado avisa cuando lo que reparte es medio modulo o mas", () => {
    // Un modulo de menos por string: el centrado lo taparia en silencio.
    const c = cuadreDeFila({ ...base, modo: "centered", modulosPorFila: 54 });
    expect(Math.abs(c.repartoPorPuntaMm!)).toBeGreaterThan(500);
    expect(c.notas.join(" ")).toMatch(/falta un hueco por declarar|sobra o falta un modulo/);
  });

  it("modo origin aplica el offset en una sola punta", () => {
    const c = cuadreDeFila({ ...base, modo: "origin" });
    const punta = c.partes.find((p) => p.concepto.includes("Pica por fuera"))!;
    expect(punta.cantidad).toBe(1);
    expect(c.predichoMm).toBe(c.fierroMm + base.offsetMm);
  });

  it("modo none no agrega ninguna linea de punta", () => {
    const c = cuadreDeFila({ ...base, modo: "none" });
    expect(c.partes.some((p) => p.concepto.includes("Pica") || p.concepto.includes("reparte"))).toBe(false);
    expect(c.predichoMm).toBe(c.fierroMm);
  });

  it("sin modo declarado se porta como antes: las dos puntas", () => {
    const c = cuadreDeFila(base);
    expect(c.predichoMm).toBe(c.fierroMm + 2 * base.offsetMm);
    expect(c.repartoPorPuntaMm).toBe(null);
  });
});

/**
 * El caso concreto de Wellington North, con los numeros del manual AXD.
 *
 * Sirve de red: si alguien vuelve a tocar el reparto, este test dice en
 * milimetros lo que el parque real tiene que dar.
 */
describe("Wellington North: la coordenada esta sobre el primer panel", () => {
  const wen: EntradaCuadre = {
    modulosPorFila: 56,
    stringsPorFila: 2,
    anchoModuloMm: 1134,
    huecoEntreModulosMm: 10,
    bahiaMm: 824,
    offsetMm: 0,
    modo: "centered",
    largoMedidoM: 65.018,
  };

  it("el fierro declarado da los 64,868 m del manual", () => {
    expect(cuadreDeFila(wen).fierroMm).toBeCloseTo(64868, 6);
  });

  it("lo que sobra son 75 mm por punta: menos de un decimo de modulo", () => {
    const c = cuadreDeFila(wen);
    expect(c.repartoPorPuntaMm).toBeCloseTo(75, 6);
    expect(Math.abs(c.repartoPorPuntaMm!) / (wen.anchoModuloMm + wen.huecoEntreModulosMm))
      .toBeLessThan(0.1);
    expect(c.notas.join(" ")).toMatch(/explica la fila entera/);
  });

  it("con los numeros de Edenvale en su lugar, el reparto se dispara", () => {
    const conEdenvale = cuadreDeFila({
      ...wen, anchoModuloMm: 1135, huecoEntreModulosMm: 20, bahiaMm: 555,
    });
    // 65145 predicho contra 65018 medido: el centrado lo tapa, pero el reparto
    // se va a negativo y eso es lo que hay que ver.
    expect(conEdenvale.repartoPorPuntaMm!).toBeLessThan(0);
    expect(Math.abs(conEdenvale.repartoPorPuntaMm!)).toBeGreaterThan(60);
  });
});
