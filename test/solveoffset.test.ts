/**
 * Despejar el offset con un conteo de campo.
 *
 * Es la salida al empate que trabo el modelo de Edenvale durante meses. La
 * cinta dice que la pila de punta esta 1464 mm adentro del primer panel y que
 * no hay ninguna mas afuera. La aritmetica del archivo dice que el offset es
 * cero. Las dos no pueden ser, y ninguna de las dos se puede refutar con otra
 * medicion de cinta.
 *
 * Pero ponen cada modulo con mas de un modulo de diferencia. Asi que un conteo
 * —una persona parada en la fila contando desde la caja DC— los separa. Esto
 * prueba que ese conteo alcanza.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { compileFarm, locate } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { offsetsQueCuadran, veredictoDeOffset } from "../app/solveoffset";
import type { FieldCheck } from "../app/checks";
import { makeRow } from "./helpers/synthetic.js";

const edenvale = edenvaleJson as unknown as FarmProfile;

/**
 * Para probar el buscador hace falta un perfil donde mover el offset CAMBIE
 * algo. Edenvale esta en modo centrado, donde el numero no se usa — asi que
 * aca se declara a mano. El caso centrado tiene su propia prueba al final.
 */
const profile: FarmProfile = {
  ...edenvale,
  geometry: { ...edenvale.geometry, endpointOffsetMm: -25, endpointOffsetMode: "both" },
};

const fila = makeRow(
  {
    id: "04-018-R1", block: "04", tracker: "04-018", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north",
    pos: 1, posTotal: 1,
  },
  profile,
);

/** Donde cae un modulo dado, con el offset que se le pase. */
function coordDeModulo(modulo: number, offsetMm: number): { lat: number; lon: number } {
  const p: FarmProfile = {
    ...profile,
    geometry: { ...profile.geometry, endpointOffsetMm: offsetMm, endpointOffsetMode: "both" },
  };
  const farm = compileFarm(p, [fila]);
  // Se camina el eje de la fila hasta dar con el modulo pedido. Es mas lento
  // que despejarlo, pero usa el mismo locate que usa el campo — asi la prueba
  // no puede pasar por un error de signo que la app tambien tenga.
  const a = fila.start, b = fila.end;
  for (let t = 0; t <= 1; t += 0.0005) {
    const lat = a.lat + (b.lat - a.lat) * t;
    const lon = a.lon + (b.lon - a.lon) * t;
    const r = locate({ lat, lon, accuracyM: 0.2 }, farm);
    if (r.best?.module === modulo && r.best.stringNumber === 1) return { lat, lon };
  }
  throw new Error(`no encontre el modulo ${modulo} con offset ${offsetMm}`);
}

/** Un conteo de campo hecho parado sobre un modulo real. */
function conteo(modulo: number, offsetReal: number): FieldCheck {
  const coord = coordDeModulo(modulo, offsetReal);
  return {
    id: `c${modulo}`, at: "2026-08-26T00:00:00Z", coord, accuracyM: 1,
    said: `modulo ${modulo}`, rowId: fila.id, block: "04", tracker: "04-018",
    stringNumber: 1, module: modulo, outcome: "match",
  };
}

// ---------------------------------------------------------------------------

describe("un conteo de campo acota el offset", () => {
  it("el rango que devuelve contiene al offset real", () => {
    const real = -1464;
    const r = offsetsQueCuadran(conteo(9, real), profile, [fila])!;
    expect(r).not.toBeNull();
    expect(real).toBeGreaterThanOrEqual(r.desdeMm);
    expect(real).toBeLessThanOrEqual(r.hastaMm);
  });

  // Un solo conteo no puede achicar mas que un modulo: adentro del panel,
  // cualquier offset devuelve el mismo numero. Decirlo importa tanto como el
  // rango, porque si no se lee como si el conteo hubiera fijado el valor.
  it("un conteo solo deja un rango del ancho de un modulo", () => {
    const r = offsetsQueCuadran(conteo(9, -1464), profile, [fila])!;
    const ancho = r.hastaMm - r.desdeMm;
    const paso = profile.module.widthMm + profile.module.gapMm;
    expect(ancho).toBeGreaterThan(paso * 0.6);
    expect(ancho).toBeLessThanOrEqual(paso + 2 * 5);
  });

  it("sin numero de modulo contado no puede decir nada", () => {
    const c = conteo(9, -1464);
    const sinModulo: FieldCheck = { ...c, module: undefined, outcome: "match" };
    expect(offsetsQueCuadran(sinModulo, profile, [fila])).toBeNull();
  });

  it("si la fila del conteo no esta cargada, no inventa", () => {
    const c = { ...conteo(9, -1464), rowId: "no-existe" };
    expect(offsetsQueCuadran(c, profile, [fila])).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("el empate de Edenvale se rompe con un conteo", () => {
  /**
   * La prueba que importa: si la realidad fuera offset -1464, un conteo en el
   * campo tiene que DESMENTIR al perfil que dice -25. Y al reves.
   */
  it("distingue el offset del archivo del offset de la pila", () => {
    const conPila = offsetsQueCuadran(conteo(9, -1464), profile, [fila])!;
    const conArchivo = offsetsQueCuadran(conteo(9, -25), profile, [fila])!;

    // Los dos rangos no se pisan: el conteo elige uno y descarta el otro.
    const sePisan = conPila.desdeMm <= conArchivo.hastaMm && conArchivo.desdeMm <= conPila.hastaMm;
    expect(sePisan).toBe(false);
  });

  it("dice sin vueltas cuando los conteos desmienten al perfil", () => {
    // El perfil trae -25; el campo se conto con la realidad en -1464.
    const v = veredictoDeOffset([conteo(9, -1464)], profile, [fila]);
    expect(v.usados).toBe(1);
    expect(v.actualMm).toBe(profile.geometry.endpointOffsetMm);
    expect(v.actualSirve).toBe(false);
    expect(v.notas.join(" ")).toMatch(/queda AFUERA del rango/);
    expect(v.notas.join(" ")).toMatch(/desmienten/);
  });

  it("y cuando lo respaldan, tambien", () => {
    const v = veredictoDeOffset([conteo(9, profile.geometry.endpointOffsetMm)], profile, [fila]);
    expect(v.actualSirve).toBe(true);
    expect(v.notas.join(" ")).toMatch(/lo respaldan/);
  });

  /** Dos conteos en puntas distintas achican el rango. */
  it("dos conteos separados acotan mas que uno", () => {
    const real = -1464;
    const uno = veredictoDeOffset([conteo(3, real)], profile, [fila]);
    const dos = veredictoDeOffset([conteo(3, real), conteo(26, real)], profile, [fila]);
    expect(dos.comun).not.toBeNull();
    expect(dos.comun!.hastaMm - dos.comun!.desdeMm)
      .toBeLessThanOrEqual(uno.comun!.hastaMm - uno.comun!.desdeMm);
    expect(real).toBeGreaterThanOrEqual(dos.comun!.desdeMm);
    expect(real).toBeLessThanOrEqual(dos.comun!.hastaMm);
  });

  // Dos conteos que no se explican con un mismo offset son un dato en si:
  // significa que hay otra cosa mal, y tocar el offset lo taparia.
  it("si dos conteos no se explican con un solo offset, lo dice en vez de promediar", () => {
    const v = veredictoDeOffset([conteo(3, -1464), conteo(26, 900)], profile, [fila]);
    expect(v.comun).toBeNull();
    expect(v.notas.join(" ")).toMatch(/no se explican con un solo offset/);
    expect(v.notas.join(" ")).toMatch(/Antes de tocar el offset/);
  });

  it("sin conteos no se pronuncia", () => {
    const v = veredictoDeOffset([], profile, [fila]);
    expect(v.comun).toBeNull();
    expect(v.notas.join(" ")).toMatch(/Todavia no hay ningun conteo/);
  });
});

// ---------------------------------------------------------------------------

/**
 * El caso centrado, que es como quedo Edenvale.
 *
 * Ahi el offset no es un parametro: el motor centra los modulos en cada fila y
 * el numero declarado ni se mira. El buscador igual sirve —dice cuanto se
 * corrio el centrado— pero no puede sugerir "poné este valor", porque no hay
 * donde ponerlo. Lo que estaria mal es otra cosa, y tiene que decirlo.
 */
describe("cuando el parque centra los modulos", () => {
  const centrado: FarmProfile = {
    ...edenvale,
    geometry: { ...edenvale.geometry, endpointOffsetMode: "centered" },
  };

  it("compara contra el centrado real y no contra el numero declarado", () => {
    const inventado: FarmProfile = {
      ...centrado,
      geometry: { ...centrado.geometry, endpointOffsetMm: 987654 },
    };
    const v = veredictoDeOffset([conteo(9, -25)], inventado, [fila]);
    // No puede repetir el disparate declarado: tiene que calcular el centrado.
    expect(v.actualMm).not.toBe(987654);
    expect(Math.abs(v.actualMm)).toBeLessThan(200);
  });

  it("si los conteos no cuadran, apunta al paso y no al offset", () => {
    const v = veredictoDeOffset([conteo(9, -1464)], centrado, [fila]);
    expect(v.actualSirve).toBe(false);
    expect(v.notas.join(" ")).toMatch(/no es un numero que se pueda corregir/);
    expect(v.notas.join(" ")).toMatch(/el paso, la cantidad de modulos/);
  });
});

/**
 * El centrado se mide fila por fila, no con la mediana de los largos.
 *
 * `centradoEfectivoMm` tomaba la mediana de los largos del parque y la
 * comparaba contra un unico "cuanto ocupan los modulos" sacado del perfil. En
 * un parque de un solo tipo de tracker da igual. En uno que mezcla largos de 56
 * con cortos de 28 —lo normal— la mediana de los largos cae ENTRE los dos
 * tamanos, y se la resta contra el ocupado del tipo principal: el numero que
 * sale no es el centrado de ninguna fila del parque.
 *
 * Y de ese numero sale el veredicto que le dice al operador si el offset que
 * tiene cargado es el correcto, asi que un parque mixto recibia un veredicto
 * calculado sobre una fila que no existe.
 */
describe("el centrado en un parque de dos tipos de tracker", () => {
  const mixto = (): FarmProfile => ({
    ...edenvale,
    geometry: { ...edenvale.geometry, endpointOffsetMode: "centered" },
    topology: {
      ...edenvale.topology,
      variants: [{ id: "corto", name: "Tracker corto", modulesPerString: 28, stringsPerRow: 1 }],
    },
  });

  it("un parque de puras filas cortas no se mide con la geometria de las largas", () => {
    const perfil = mixto();
    const corta = (n: number) => ({
      ...makeRow(
        {
          id: `C${n}`, block: "02", tracker: `02-00${n}`, row: "R1",
          anchor: { lat: -26.93 + n * 0.0002, lon: 150.59 }, azimuthDeg: 180, side: "north",
          lengthM: 32.84,
        },
        perfil,
      ),
      variantId: "corto",
    });

    /*
      El centrado tiene que ser una fraccion de modulo: es lo que sobra
      repartido entre las dos puntas. Con la cuenta vieja —el largo real de una
      fila corta contra lo que ocupan los modulos de una LARGA— daba decenas de
      metros negativos, un numero que no describe ninguna fila del parque y del
      que despues sale el veredicto que le dice al operador si su offset esta
      bien.
    */
    const v = veredictoDeOffset([], perfil, [corta(1), corta(2), corta(3)]);
    const medioModulo = (perfil.module.widthMm + perfil.module.gapMm) / 2;
    expect(Math.abs(v.actualMm)).toBeLessThan(medioModulo);
  });
});
