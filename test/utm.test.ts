import { describe, expect, it } from "vitest";
import { utmToWgs84 } from "../src/geo/utm.js";

/**
 * Errarle por una zona.
 *
 * Wellington North se cargó con la zona 56 —se la dije yo— y la correcta es la
 * 55. El parque quedó 560 km adentro del mar de Tasmania y no se notó hasta
 * exportar el KML a Google Earth, con los planos y los strings ya cargados
 * encima.
 *
 * Lo que hace que esto se pueda arreglar en la pantalla es una propiedad de la
 * proyeccion: cambiar de zona corre la longitud EXACTAMENTE 6 grados y no toca
 * la latitud. Asi las zonas vecinas se pueden mostrar sin volver a convertir el
 * archivo entero. Si esto dejara de valer, el atajo de la pantalla miente.
 */
describe("una zona de mas o de menos", () => {
  const wen = { easting: 682360, northing: 6404210, hemisphere: "S" as const };

  it("la zona 55 pone Wellington North en Wellington, NSW", () => {
    const p = utmToWgs84({ ...wen, zone: 55 });
    expect(p.lat).toBeCloseTo(-32.484, 2);
    expect(p.lon).toBeCloseTo(148.941, 2);
  });

  it("la 56 lo pone en el mar, a mas de 500 km", () => {
    const p = utmToWgs84({ ...wen, zone: 56 });
    expect(p.lon).toBeCloseTo(154.941, 2);
    // Mismo paralelo, otro oceano: por eso ninguna medida interna del parque
    // se rompe y el error sobrevive hasta el campo.
    expect(p.lat).toBeCloseTo(utmToWgs84({ ...wen, zone: 55 }).lat, 9);
  });

  it("una zona corre la longitud 6 grados exactos, y nada mas", () => {
    for (const z of [53, 54, 55, 56, 57]) {
      const a = utmToWgs84({ ...wen, zone: z });
      const b = utmToWgs84({ ...wen, zone: z + 1 });
      expect(b.lon - a.lon).toBeCloseTo(6, 9);
      expect(b.lat).toBeCloseTo(a.lat, 9);
    }
  });

  it("y vale igual en el hemisferio norte", () => {
    const n = { easting: 500000, northing: 4649776, hemisphere: "N" as const };
    const a = utmToWgs84({ ...n, zone: 31 });
    const b = utmToWgs84({ ...n, zone: 32 });
    expect(b.lon - a.lon).toBeCloseTo(6, 9);
    expect(b.lat).toBeCloseTo(a.lat, 9);
  });
});

/**
 * Corregir la zona de un parque YA cargado.
 *
 * Wellington North quedo guardado con la zona 56 y los planos y la lista de
 * strings aplicados encima. Volver a importar las coordenadas para arreglarlo
 * habria tirado todo eso, asi que la correccion mueve las filas guardadas en
 * vez de reproyectarlas desde el archivo.
 *
 * Eso se apoya en que sumarle 6 grados a la longitud da EXACTAMENTE lo mismo
 * que convertir el mismo este/norte con la zona de al lado. Si algun dia deja
 * de valer, la pantalla corrompe el parque sin decir nada — por eso se prueba
 * contra la conversion de verdad y no contra si misma.
 */
describe("mover un parque de zona sin el archivo original", () => {
  const casos = [
    { easting: 682360, northing: 6404210, hemisphere: "S" as const, de: 56, a: 55 },
    { easting: 210500, northing: 6404210, hemisphere: "S" as const, de: 56, a: 55 },
    { easting: 788000, northing: 5804210, hemisphere: "S" as const, de: 20, a: 23 },
    { easting: 500000, northing: 4649776, hemisphere: "N" as const, de: 31, a: 30 },
    { easting: 333333, northing: 1234567, hemisphere: "N" as const, de: 1, a: 60 },
  ];

  for (const c of casos) {
    it(`zona ${c.de} → ${c.a} (${c.hemisphere}): mover la longitud da lo mismo que reproyectar`, () => {
      const viejo = utmToWgs84({ easting: c.easting, northing: c.northing, zone: c.de, hemisphere: c.hemisphere });
      const bien = utmToWgs84({ easting: c.easting, northing: c.northing, zone: c.a, hemisphere: c.hemisphere });

      // Lo que hace la pantalla: correr la longitud 6 grados por zona.
      const movido = { lat: viejo.lat, lon: viejo.lon + (c.a - c.de) * 6 };

      expect(movido.lon).toBeCloseTo(bien.lon, 9);
      expect(movido.lat).toBeCloseTo(bien.lat, 9);
    });
  }

  it("el caso real: Wellington sale del mar y cae en Wellington", () => {
    const guardado = utmToWgs84({ easting: 682360, northing: 6404210, zone: 56, hemisphere: "S" });
    expect(guardado.lon).toBeCloseTo(154.94, 2); // mar de Tasmania
    const corregido = { lat: guardado.lat, lon: guardado.lon + (55 - 56) * 6 };
    expect(corregido.lat).toBeCloseTo(-32.484, 3);
    expect(corregido.lon).toBeCloseTo(148.941, 3); // Wellington, NSW
  });

  it("mover ida y vuelta deja el parque donde estaba", () => {
    const p = utmToWgs84({ easting: 682360, northing: 6404210, zone: 56, hemisphere: "S" });
    expect(p.lon + (55 - 56) * 6 + (56 - 55) * 6).toBeCloseTo(p.lon, 12);
  });
});
