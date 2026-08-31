/**
 * La camara y el dron son una sola eleccion.
 *
 * La pantalla de vuelo tenia dos listas sueltas: el sensor con el que se
 * planifica y el dron para el que se exporta. Se podia planificar con la huella
 * del Matrice 4T —campo de vision 35.8°, lineas cada 17.8 m— y exportar el
 * archivo del Mavic 3T, que ve 45.8° y necesita otra separacion.
 *
 * Eso no falla al exportar. Falla en el campo, meses despues, cuando alguien
 * busca un panel y no hay foto: el KMZ es valido, el dron lo vuela, y las
 * lineas estan separadas para una camara que no es la que lleva puesta.
 *
 * Por eso cada camara declara en que aeronave va, y la de exportar sale de ahi.
 */

import { describe, expect, it } from "vitest";
import { CAMARAS } from "../app/mission";
import { PERFILES_DJI } from "../app/wpml";

describe("cada camara sabe en que dron va", () => {
  it("los ids que declaran las camaras existen en los perfiles DJI", () => {
    for (const c of CAMARAS) {
      if (!c.djiId) continue;
      expect(
        PERFILES_DJI.find((p) => p.id === c.djiId),
        `la camara "${c.name}" dice ir en "${c.djiId}" y ese perfil no existe`,
      ).toBeDefined();
    }
  });

  it("las dos termicas de mano llevan su aeronave", () => {
    const m3t = CAMARAS.find((c) => /Mavic 3T · termica/.test(c.name))!;
    const m4t = CAMARAS.find((c) => /Matrice 4T/.test(c.name))!;
    expect(m3t.djiId).toBe("m3t");
    expect(m4t.djiId).toBe("m4t");
  });

  /**
   * El H30T va colgado de un Matrice 350 o 400, que no estan en la tabla.
   * Sin id, la pantalla apaga el KMZ y lo explica. Inventarle un id para que
   * el boton no quede gris seria justamente el bug que se esta arreglando.
   */
  it("la camara que no tiene aeronave conocida queda sin id, no con uno inventado", () => {
    const h30 = CAMARAS.find((c) => /H30T/.test(c.name))!;
    expect(h30.djiId).toBeUndefined();
  });

  /**
   * La prueba que muerde: las dos termicas tienen campos de vision distintos,
   * asi que cruzarlas cambia la separacion entre lineas. Si algun dia alguien
   * vuelve a soltar las dos listas, esto dice cuanto costaba.
   */
  it("cruzarlas no es cosmetico: cambian la huella y la separacion", () => {
    const m3t = CAMARAS.find((c) => /Mavic 3T · termica/.test(c.name))!;
    const m4t = CAMARAS.find((c) => /Matrice 4T/.test(c.name))!;
    const huella = (c: typeof m3t, h: number) => 2 * h * Math.tan((c.hfovDeg * Math.PI) / 360);
    const a = huella(m3t, 50);
    const b = huella(m4t, 50);
    expect(Math.abs(a - b)).toBeGreaterThan(8);   // ~10 m de diferencia a 50 m
  });
});
