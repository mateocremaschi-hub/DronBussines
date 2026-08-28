import { describe, expect, it } from "vitest";
import { utmToWgs84, wgs84ToUtm, reproyectar, crsAparente } from "../src/geo/utm.js";

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

/**
 * Reproyectar un parque que entro con la zona Y el hemisferio equivocados.
 *
 * El caso real de Wellington North: entro como zona 33 NORTE y quedo en el mar
 * Baltico, cerca de Gotland — a 15.000 km de donde esta. Lo correcto era zona
 * 55 SUR.
 *
 * Yo habia asumido que era un error de una zona y le puse a la pantalla dos
 * botones de "moverlo 6 grados". No servian: el hemisferio cambia el signo de
 * la latitud y suma diez millones de metros al norte, y ningun corrimiento de
 * longitud tapa eso. Estos tests estan para que la proxima vez el arreglo no
 * dependa de mi suposicion sobre que se equivoco.
 */
describe("reproyectar un parque mal importado", () => {
  const E = 682360, N = 6404210; // una pica real de Wellington North

  /*
    Este test empezo afirmando que la zona aparente SIEMPRE es la real. Es
    falso, y el test lo cazo antes de que llegara a la pantalla: un este lejos
    del meridiano central empuja el punto mas alla del borde de su banda.
    Wellington, proyectado con la 33, cae en longitud 18.064 — y la banda de la
    33 termina en 18. La apuesta da 34.
  */
  it("la zona aparente es una apuesta, y puede errarle por una", () => {
    const malo = utmToWgs84({ easting: E, northing: N, zone: 33, hemisphere: "N" });
    expect(malo.lon).toBeGreaterThan(18);          // se paso de la banda de la 33
    expect(crsAparente(malo).zone).toBe(34);       // por eso apuesta 34
    expect(crsAparente(malo).hemisphere).toBe("N"); // el hemisferio si es seguro
  });

  it("el hemisferio sale del signo de la latitud, siempre", () => {
    for (const h of ["N", "S"] as const) {
      for (const z of [1, 20, 33, 55, 60]) {
        const p = utmToWgs84({ easting: E, northing: N, zone: z, hemisphere: h });
        expect(crsAparente(p).hemisphere).toBe(h);
      }
    }
  });

  it("el caso real: del mar Baltico a Wellington, NSW", () => {
    const malo = utmToWgs84({ easting: E, northing: N, zone: 33, hemisphere: "N" });
    expect(malo.lat).toBeCloseTo(57.743, 2);   // Gotland
    expect(malo.lon).toBeCloseTo(18.064, 2);

    // Con la zona de origen CORRECTA (33), no con la apuesta.
    const arreglado = reproyectar(malo, { zone: 33, hemisphere: "N" }, { zone: 55, hemisphere: "S" });
    expect(arreglado.lat).toBeCloseTo(-32.4844, 4);
    expect(arreglado.lon).toBeCloseTo(148.9408, 4);
  });

  it("recupera el este/norte original sin tener el archivo", () => {
    const malo = utmToWgs84({ easting: E, northing: N, zone: 33, hemisphere: "N" });
    const utm = wgs84ToUtm(malo.lat, malo.lon, 33);
    expect(utm.easting).toBeCloseTo(E, 2);
    expect(utm.northing).toBeCloseTo(N, 2);
  });

  it("anda para cualquier par de zona y hemisferio, en los dos sentidos", () => {
    const casos = [
      [{ zone: 33, hemisphere: "N" }, { zone: 55, hemisphere: "S" }],
      [{ zone: 55, hemisphere: "S" }, { zone: 33, hemisphere: "N" }],
      [{ zone: 1, hemisphere: "N" }, { zone: 60, hemisphere: "S" }],
      [{ zone: 20, hemisphere: "S" }, { zone: 21, hemisphere: "S" }],
      [{ zone: 31, hemisphere: "N" }, { zone: 31, hemisphere: "S" }],
    ] as const;
    for (const [mal, bien] of casos) {
      const p = utmToWgs84({ easting: E, northing: N, zone: mal.zone, hemisphere: mal.hemisphere });
      const esperado = utmToWgs84({ easting: E, northing: N, zone: bien.zone, hemisphere: bien.hemisphere });
      const dio = reproyectar(p, mal, bien);
      expect(dio.lat).toBeCloseTo(esperado.lat, 6);
      expect(dio.lon).toBeCloseTo(esperado.lon, 6);
    }
  });

  it("reproyectar al mismo sitio no mueve nada", () => {
    const p = utmToWgs84({ easting: E, northing: N, zone: 55, hemisphere: "S" });
    const igual = reproyectar(p, { zone: 55, hemisphere: "S" }, { zone: 55, hemisphere: "S" });
    expect(igual.lat).toBeCloseTo(p.lat, 9);
    expect(igual.lon).toBeCloseTo(p.lon, 9);
  });

  /*
    La primera version de este test medi la distancia con una formula plana
    —grados por 111320 y un coseno— y daba 28 cm de diferencia. No era la
    proyeccion: era mi regla. Esa aproximacion se desarma cuando los dos puntos
    estan a 90 grados de latitud de distancia, que es justo el caso.

    Lo que de verdad hay que probar es que el par este/norte no se toca. Si ese
    par sobrevive, el parque es identico adentro por construccion: todas las
    medidas de la app salen de ahi.
  */
  it("no deforma el parque: el este/norte de cada punta sobrevive intacto", () => {
    const largo = 65.018; // una fila Long de Wellington, de pica a pica
    const mal = { zone: 33, hemisphere: "N" } as const;
    const bien = { zone: 55, hemisphere: "S" } as const;

    const a = utmToWgs84({ easting: E, northing: N, ...mal });
    const b = utmToWgs84({ easting: E, northing: N + largo, ...mal });

    const a2 = reproyectar(a, mal, bien);
    const b2 = reproyectar(b, mal, bien);

    const ua = wgs84ToUtm(a2.lat, a2.lon, bien.zone);
    const ub = wgs84ToUtm(b2.lat, b2.lon, bien.zone);

    expect(ua.easting).toBeCloseTo(E, 3);
    expect(ub.easting).toBeCloseTo(E, 3);
    expect(ub.northing - ua.northing).toBeCloseTo(largo, 3);
  });
});
