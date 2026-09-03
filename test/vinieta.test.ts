/**
 * El borde del cuadro lee mas caliente que el centro.
 *
 * Salio del primer vuelo real con el Matrice 4T. Sobre pixeles de panel
 * solamente, la misma foto da 42,1 °C en el centro y 46,0 °C en las esquinas:
 * casi cuatro grados de sesgo del instrumento, contra un umbral de anomalia
 * leve de tres.
 *
 * Con eso alcanza para inventar defectos. Los hermanos de un string casi nunca
 * caen a la misma distancia del centro del cuadro, asi que un modulo
 * fotografiado en una esquina se compara contra hermanos fotografiados en el
 * medio y sale con tres grados que no existen. Fue exactamente lo que paso: un
 * modulo del borde de arriba leyo 45,0 °C contra 41,9 de sus hermanos y salio
 * como "modulo completo, circuito abierto".
 */

import { describe, expect, it } from "vitest";
import { correccion, medirVinieta, radioNormalizado } from "../app/vinieta";

/** Una foto de modulos todos iguales, con el vinieteo de la camara encima. */
function conVinieteo(baseC: number, enLaEsquinaC: number) {
  const puntos: Array<{ r: number; celsius: number }> = [];
  for (let cy = 20; cy < 512; cy += 24) {
    for (let cx = 20; cx < 640; cx += 24) {
      const r = radioNormalizado(cx, cy, 640, 512);
      // Sube con el cuadrado del radio, que es como se comporta de verdad.
      puntos.push({ r, celsius: baseC + enLaEsquinaC * (r / Math.SQRT2) ** 2 });
    }
  }
  return puntos;
}

describe("sacarle el vinieteo a una foto", () => {
  it("el centro no se toca y la esquina se corrige casi entera", () => {
    const v = medirVinieta(conVinieteo(42, 4))!;
    expect(v, "tenia que medir el vinieteo").not.toBeNull();
    expect(correccion(v, 0)).toBe(0);
    // El maximo es el del centro del anillo de afuera, no el de la esquina
    // misma: mas afuera no hay modulos con que medirlo y no se extrapola.
    expect(v.maximoC).toBeGreaterThan(2.5);
    expect(v.maximoC).toBeLessThan(4.5);
  });

  it("despues de corregir, el cuadro queda parejo", () => {
    const puntos = conVinieteo(42, 4);
    const v = medirVinieta(puntos)!;
    const corregidos = puntos.map((p) => p.celsius - correccion(v, p.r));
    const min = Math.min(...corregidos), max = Math.max(...corregidos);
    // Antes habia cuatro grados de diferencia entre el centro y la esquina.
    expect(max - min).toBeLessThan(0.8);
    // Sin corregir eran cuatro grados enteros.
    const sin = puntos.map((p) => p.celsius);
    expect(Math.max(...sin) - Math.min(...sin)).toBeGreaterThan(3.5);
  });

  it("una camara sin vinieteo no se corrige", () => {
    expect(medirVinieta(conVinieteo(42, 0))).toBeNull();
  });

  /*
    El freno que hace que esto sea seguro. La correccion solo va en el sentido
    fisico —el borde mas caliente que el centro— asi que una foto con el centro
    caliente no se toca. Sin eso, un string desconectado cerca del medio del
    cuadro se veria como "centro caliente" y la correccion se lo comeria.

    Verificado ademas contra las dos fotos reales que tienen un string
    desconectado cerca del centro: la correccion da cero en todos los anillos.
  */
  it("una foto con el centro caliente no se corrige: ahi vive el defecto", () => {
    const puntos: Array<{ r: number; celsius: number }> = [];
    for (let cy = 20; cy < 512; cy += 24) {
      for (let cx = 20; cx < 640; cx += 24) {
        const r = radioNormalizado(cx, cy, 640, 512);
        puntos.push({ r, celsius: r < 0.5 ? 46 : 42 });
      }
    }
    expect(medirVinieta(puntos)).toBeNull();
  });

  it("con pocos modulos no inventa una correccion", () => {
    expect(medirVinieta([
      { r: 0.1, celsius: 42 }, { r: 0.5, celsius: 43 }, { r: 1.2, celsius: 46 },
    ])).toBeNull();
  });

  /*
    El caso real, con los numeros que dio la foto del 3 de septiembre: 41,9 °C
    de hermanos medidos cerca del centro y 45,0 en el borde de arriba. Sin
    corregir son +3,1 °C y un hallazgo de clase 2; corrigiendo no queda nada.
  */
  it("el falso positivo del vuelo real desaparece", () => {
    const v = medirVinieta(conVinieteo(41.9, 4))!;
    const enElBorde = radioNormalizado(107, 4, 640, 512);
    const leido = 41.9 + 4 * (enElBorde / Math.SQRT2) ** 2;
    expect(leido).toBeGreaterThan(44.5);           // lo que reporto la app
    expect(leido - correccion(v, enElBorde)).toBeCloseTo(41.9, 0);
  });
});
