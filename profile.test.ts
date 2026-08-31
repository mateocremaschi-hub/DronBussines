/**
 * El perfil tiene que romper ruidosamente al cargarlo.
 *
 * Un perfil mal armado que no falla produce direcciones equivocadas en
 * silencio, y eso se descubre en el campo seis meses despues. Es exactamente
 * la clase de error que este diseno existe para evitar.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import northfieldJson from "../farms/northfield-synthetic.json" with { type: "json" };
import { ProfileError, validateProfile } from "../src/profile/validate.js";
import { compileFarm } from "../src/profile/compile.js";
import { modulesOfRow } from "../src/locate.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, nominalLengthM } from "./helpers/synthetic.js";

const edenvale = edenvaleJson as unknown as FarmProfile;

const clone = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...JSON.parse(JSON.stringify(edenvale)),
  ...over,
});

describe("validacion", () => {
  it("acepta los dos perfiles del repo", () => {
    expect(() => validateProfile(edenvaleJson)).not.toThrow();
    expect(() => validateProfile(northfieldJson)).not.toThrow();
  });

  it("junta todos los problemas en un solo error", () => {
    try {
      validateProfile({ id: "x" });
      expect.unreachable("tendria que haber tirado");
    } catch (err) {
      expect(err).toBeInstanceOf(ProfileError);
      expect((err as ProfileError).issues.length).toBeGreaterThan(3);
    }
  });

  it("exige fixedEnd cuando la estrategia es fixed-end", () => {
    const bad = clone({
      addressing: { originStrategy: "fixed-end", inversionStrategy: "none" },
    });
    expect(() => validateProfile(bad)).toThrow(/fixedEnd/);
  });

  it("rechaza estrategias que no existen", () => {
    const bad = clone({
      addressing: { originStrategy: "vibes", inversionStrategy: "none" },
    });
    expect(() => validateProfile(bad)).toThrow(/originStrategy/);
  });

  // La regla del piercing connector se verifico con dos strings por fila.
  // Extrapolarla a tres seria repetir el error que ya costo dos viajes al campo:
  // asumir un patron razonable y descubrir en el campo que no era.
  it("no deja usar piercing-chain con mas de dos strings por fila", () => {
    const bad = clone({
      topology: { modulesPerString: 28, stringsPerRow: 3 },
    });
    expect(() => validateProfile(bad)).toThrow(/per-string-flag/);
  });

  it("pero si deja tres strings por fila con la salida de emergencia", () => {
    const ok = clone({
      topology: { modulesPerString: 28, stringsPerRow: 3 },
      addressing: { originStrategy: "per-row-flag", inversionStrategy: "per-string-flag" },
    });
    expect(() => validateProfile(ok)).not.toThrow();
  });
});

describe("chequeo de coherencia geometrica al compilar", () => {
  const rowSpec = {
    id: "x",
    block: "01",
    tracker: "01-001",
    anchor: { lat: -27.4, lon: 152.7 },
    azimuthDeg: 180,
    side: "north" as const,
    pos: 1,
    posTotal: 2,
  };

  it("no dice nada cuando el largo cierra con el paso declarado", () => {
    const farm = compileFarm(edenvale, [makeRow(rowSpec, edenvale)]);
    expect(farm.buildWarnings).toEqual([]);
  });

  // Este es el chequeo que hubiera hecho saltar los bloques de trazado disperso
  // sin necesidad de mirar el mapa a ojo.
  it("avisa cuando el segmento importado no da el largo que el perfil predice", () => {
    const short = makeRow({ ...rowSpec, lengthM: nominalLengthM(edenvale) - 4 }, edenvale);
    const farm = compileFarm(edenvale, [short]);
    const w = farm.buildWarnings.find((x) => x.code === "length-mismatch");
    expect(w).toBeDefined();
    expect(w!.message).toMatch(/por modulo/);
  });

  it("con pitchMm derive el paso sale del largo real y nunca hay residuo", () => {
    // Derivar el paso no convive con centrar —seria circular y el compilador lo
    // rechaza— asi que aca se declara el offset a mano, que es el otro modo.
    const derived = {
      ...edenvale,
      module: { ...edenvale.module, pitchMm: "derive" as const },
      geometry: { ...edenvale.geometry, endpointOffsetMode: "both" as const },
    };
    const odd = makeRow({ ...rowSpec, lengthM: nominalLengthM(edenvale) - 4 }, edenvale);
    const farm = compileFarm(derived, [odd]);
    expect(farm.buildWarnings).toEqual([]);
    expect(farm.rows[0]!.lengthResidualMmPerModule).toBeCloseTo(0, 9);
    expect(farm.rows[0]!.pitchM).toBeLessThan(1.15);
  });

  it("rompe si las dos picas de una fila son el mismo punto", () => {
    const degenerate = makeRow(rowSpec, edenvale);
    degenerate.end = { ...degenerate.start };
    expect(() => compileFarm(edenvale, [degenerate])).toThrow(/mismo punto/);
  });

  it("rompe si el parque no tiene geometria", () => {
    expect(() => compileFarm(edenvale, [])).toThrow(/ninguna fila/);
  });

  it("avisa si a una fila le falta el `side` que la estrategia necesita", () => {
    const noSide = makeRow(rowSpec, edenvale);
    delete noSide.side;
    const farm = compileFarm(edenvale, [noSide]);
    expect(farm.rows[0]!.strategyWarnings.map((w) => w.code)).toContain("missing-side");
  });

  it("avisa si hay ids repetidos", () => {
    const a = makeRow(rowSpec, edenvale);
    const b = makeRow({ ...rowSpec, anchor: { lat: -27.41, lon: 152.7 } }, edenvale);
    const farm = compileFarm(edenvale, [a, b]);
    expect(farm.buildWarnings.some((w) => w.message.includes("mas de una fila"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// La geometria de Edenvale, cerrada con mediciones de campo.
// ---------------------------------------------------------------------------

describe("geometria de Edenvale confirmada en campo", () => {
  const stringSpanMm = () => {
    const { modulesPerString } = edenvale.topology;
    const w = edenvale.module.widthMm;
    const g = edenvale.module.gapMm;
    return modulesPerString * w + (modulesPerString - 1) * g;
  };

  /**
   * La geometria de Edenvale, con todo medido — y la trampa que costo meses.
   *
   * La palabra "pica" significa dos cosas distintas en este parque y por eso el
   * modelo estuvo mal tanto tiempo:
   *
   *   - El PUNTO DEL EXCEL, que marca la punta del recorrido de modulos.
   *   - La PILA de fundacion, que en Edenvale cae 1464 mm mas adentro, debajo
   *     del segundo modulo. Esta medida con cinta y hay foto.
   *
   * Las dos son ciertas. Tomar la segunda como si fuera la primera obligaba a
   * inventar 3,7 m de hueco en el medio de la fila para que la cuenta cerrara —
   * un hueco de tres modulos que nadie vio nunca, porque no existe.
   */
  it("todo medido, y la fila cierra en 25 mm sobre 65 metros", () => {
    const { modulesPerString, stringsPerRow, stringGapMm } = edenvale.topology;

    expect(modulesPerString).toBe(28);            // contados fisicamente
    expect(edenvale.module.widthMm).toBe(1135);   // cinta
    expect(edenvale.module.gapMm).toBe(20);       // cinta
    expect(stringGapMm).toBe(555);                // cinta: UN hueco por fila

    const extentMm = stringsPerRow * stringSpanMm() + (stringsPerRow - 1) * (stringGapMm ?? 0);
    expect(extentMm).toBe(65195);

    const puntoAPuntoMm = extentMm + 2 * edenvale.geometry.endpointOffsetMm;
    expect(puntoAPuntoMm / 1000).toBeCloseTo(65.145, 2);
  });

  /**
   * El unico numero despejado sale en 25 mm. Es lo que separa este modelo del
   * anterior: alla habia DOS despejados uno del otro y daban 3713 y -1464.
   */
  it("el offset contra el punto del archivo es practicamente cero", () => {
    expect(edenvale.geometry.endpointOffsetMm).toBe(-25);
    const pitch = edenvale.module.widthMm + edenvale.module.gapMm;
    expect(Math.abs(edenvale.geometry.endpointOffsetMm) / pitch).toBeLessThan(0.03);
  });

  it("el hueco entre strings es medio modulo, no tres", () => {
    const gap = edenvale.topology.stringGapMm ?? 0;
    const pitch = edenvale.module.widthMm + edenvale.module.gapMm;
    expect(gap / pitch).toBeLessThan(0.6);
    expect(gap / pitch).toBeGreaterThan(0.4);
  });

  // La pila esta anotada como lo que es: un dato de campo util para orientarse,
  // que NO es el offset. Si vuelve a confundirse, que sea leyendo esto.
  it("deja escrito que la pila y el punto del archivo son cosas distintas", () => {
    const casos = JSON.stringify(edenvale.calibration?.verifiedCases ?? []);
    expect(casos).toMatch(/PILA de punta esta debajo del segundo modulo/);
    expect(casos).toMatch(/No es el punto del Excel/);
  });

  it("una fila del largo real compila sin avisos", () => {
    const row = makeRow(
      {
        id: "x", block: "01", tracker: "01-001",
        anchor: { lat: -27.4, lon: 152.7 }, azimuthDeg: 180,
        side: "north" as const, pos: 1, posTotal: 2,
        lengthM: 65.145,
      },
      edenvale,
    );
    expect(compileFarm(edenvale, [row]).buildWarnings).toEqual([]);
  });

  /**
   * El chequeo de largo con el modelo viejo: 3713 mm de bahia sobre una fila de
   * 65145 mm sobran mas de tres modulos, y el compilador lo tiene que cazar.
   * Es la prueba de que la aritmetica sola alcanzaba para desconfiar.
   */
  /**
   * Hasta donde llega el chequeo aritmetico, dicho sin exagerar.
   *
   * El hueco fantasma de 3713 mm SI lo hubiera cazado: son mas de tres modulos
   * de sobra en una fila de 65 m. El hueco real de 555 mm NO: es medio modulo
   * repartido en 65 metros y entra en la tolerancia.
   *
   * O sea que la aritmetica alcanzaba para desconfiar del modelo viejo, pero no
   * alcanza para validar el nuevo. Eso lo tiene que hacer alguien contando
   * modulos parado en la fila.
   */
  const filaReal = () =>
    makeRow(
      {
        id: "x", block: "01", tracker: "01-001",
        anchor: { lat: -27.4, lon: 152.7 }, azimuthDeg: 180,
        side: "north" as const, pos: 1, posTotal: 2,
        lengthM: 65.145,
      },
      edenvale,
    );

  it("el hueco fantasma de 3713 mm sí saltaba el chequeo de largo", () => {
    const conFantasma = { ...edenvale, topology: { ...edenvale.topology, stringGapMm: 3713 } };
    const w = compileFarm(conFantasma, [filaReal()]).buildWarnings
      .find((x) => x.code === "length-mismatch");
    expect(w).toBeDefined();
  });

  it("pero olvidarse del hueco real de 555 mm NO lo salta: es medio modulo", () => {
    const sinHueco = { ...edenvale, topology: { ...edenvale.topology, stringGapMm: 0 } };
    const w = compileFarm(sinHueco, [filaReal()]).buildWarnings
      .find((x) => x.code === "length-mismatch");
    expect(w).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

/**
 * Centrar los modulos en la fila, para que el offset deje de ser un dato.
 *
 * Es la salida al lio que costo meses en Edenvale. La palabra "pica" nombra dos
 * lugares distintos —el punto que marca el archivo de replanteo y la pila de
 * fundacion, que queda adentro porque el modulo de punta va en voladizo sobre
 * ella— y confundirlos corrio el parque entero mas de un modulo.
 *
 * Centrando, ese numero no hay que saberlo: los modulos ocupan lo que dice el
 * paso declarado y se acomodan solos en el largo de cada fila.
 */
describe("centrar los modulos en la fila", () => {
  const centrado = {
    ...edenvale,
    geometry: { ...edenvale.geometry, endpointOffsetMm: 999999, endpointOffsetMode: "centered" as const },
  };

  const filaDe = (lengthM: number, profile: FarmProfile) =>
    makeRow(
      {
        id: "x", block: "01", tracker: "01-001",
        anchor: { lat: -27.4, lon: 152.7 }, azimuthDeg: 180,
        side: "north" as const, pos: 1, posTotal: 2, lengthM,
      },
      profile,
    );

  it("ignora por completo el offset declarado", () => {
    // 999999 mm es un disparate a proposito: si lo mirara, la fila explotaria.
    const farm = compileFarm(centrado, [filaDe(65.145, centrado)]);
    expect(farm.rows).toHaveLength(1);
    expect(farm.buildWarnings).toEqual([]);
  });

  it("pone los modulos donde los pondria el offset correcto", () => {
    const conNumero = compileFarm(edenvale, [filaDe(65.145, edenvale)]);
    const conCentrado = compileFarm(centrado, [filaDe(65.145, centrado)]);
    // El -25 mm del perfil ES el centrado: tienen que dar lo mismo.
    const a = modulesOfRow(conNumero.rows[0]!, conNumero);
    const b = modulesOfRow(conCentrado.rows[0]!, conCentrado);
    expect(b).toHaveLength(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y)).toBeLessThan(0.05);
    }
  });

  it("cada fila se acomoda sola aunque midan distinto", () => {
    const corta = compileFarm(centrado, [filaDe(64.5, centrado)]);
    const larga = compileFarm(centrado, [filaDe(65.8, centrado)]);
    // Las dos compilan y ninguna se queda sin lugar para los modulos.
    expect(modulesOfRow(corta.rows[0]!, corta)).toHaveLength(56);
    expect(modulesOfRow(larga.rows[0]!, larga)).toHaveLength(56);
  });

  // Centrar necesita el paso para saber cuanto ocupan los modulos, y derivar el
  // paso necesita saber donde arrancan. Juntos serian circulares.
  it("se niega a combinarse con derivar el paso, en vez de dar cualquier cosa", () => {
    const circular = {
      ...centrado,
      module: { ...centrado.module, pitchMm: "derive" as const },
    };
    expect(() => compileFarm(circular, [filaDe(65.145, circular)])).toThrow(/circular|Declara el paso/i);
  });
});
