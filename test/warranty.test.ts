/**
 * El paquete de garantias.
 *
 * Lo que se prueba aca no es aritmetica: es criterio. Un informe dice que
 * esta roto; esto dice QUIEN LO PAGA, y esa es la parte del trabajo que le
 * devuelve plata al cliente.
 *
 * Las dos reglas que mas importan estan al final:
 *
 *   - Un string entero caliente NO es garantia de modulos, por mas que el
 *     tipo asignado lo sugiera. Veintiocho modulos sanos no fallan el mismo
 *     dia: el problema esta aguas arriba, y ese reclamo rebota.
 *   - Un reclamo sin la evidencia completa se marca ANTES de presentarlo. Un
 *     rechazo cuesta mas que no haberlo presentado, porque quema la relacion
 *     con el fabricante.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import {
  armarPaquete,
  canalDe,
  claveDe,
  dentroDePlazo,
  esDeStringEntero,
  resumirGarantias,
  toCsv,
  type Condiciones,
} from "../app/warranty";
import { comparar, type Muestra } from "../app/detect";
import { applyStrings } from "../app/strings";
import { compileFarm, modulesOfRow } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const N = profile.topology.modulesPerString;

const row = makeRow(
  { id: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north" },
  profile,
);
const conStrings = applyStrings([row], {
  fieldIndex: 3,
  byRow: new Map([["05-042-R1", { labels: ["S-1.2.15.1", "S-1.2.15.2"], dcBox: "DCB-1.2.15" }]]),
  chains: new Map([["05-042-R1", { pos: 1, posTotal: 1 }]]),
});
const farm = compileFarm(profile, conStrings);
const modulos = modulesOfRow(farm.rows[0]!, farm);

const muestras = (base: number, retoques: Record<number, number> = {}): Muestra[] =>
  modulos.map((m) => ({
    modulo: m,
    celsius: base + (retoques[m.positionInRow] ?? 0),
    pixeles: 40,
    fileName: "DJI_0001_T.JPG",
    distanciaAlCentroM: 3,
  }));

/** Un vuelo hecho como corresponde. */
const BUENAS: Condiciones = { irradianciaWm2: 820, fecha: "2026-03-25", cielo: "despejado" };
const COBERTURA = { puestaEnMarcha: "2021-06-01", aniosModulos: 12, aniosTrackers: 10 };

// ---------------------------------------------------------------------------

describe("a que bolsillo va cada cosa", () => {
  it("los defectos internos del modulo van al fabricante de modulos", () => {
    for (const a of ["Diodo de bypass", "Bypass diode activated module", "PID", "Vidrio roto"]) {
      expect(canalDe(a).canal).toBe("modulos");
    }
  });

  // La que nadie mas separa, y es justo la especialidad de Mateo.
  it("un tracker desalineado va al fabricante de trackers, no de modulos", () => {
    expect(canalDe("Wrongly inclined modules").canal).toBe("trackers");
    expect(canalDe("Motor del tracker").canal).toBe("trackers");
    expect(canalDe("Wrongly inclined modules").motivo).toMatch(/motor, inclinometro o transmision/);
  });

  it("lo que se resuelve limpiando o cortando pasto no es garantia", () => {
    for (const a of ["Suciedad", "Soiling causing hotspots", "Sombra", "Foreign object"]) {
      expect(canalDe(a).canal).toBe("operacion");
    }
  });

  it("lo que no reconoce no lo inventa", () => {
    expect(canalDe("algo raro").canal).toBe("sin-clasificar");
    expect(canalDe(undefined).canal).toBe("sin-clasificar");
    expect(canalDe(undefined).motivo).toMatch(/Sin tipo de anomalia/);
  });
});

// ---------------------------------------------------------------------------

describe("el plazo", () => {
  it("dice cuando vence y si el vuelo entra", () => {
    const p = dentroDePlazo("modulos", COBERTURA, "2026-03-25");
    expect(p.vigente).toBe(true);
    expect(p.detalle).toContain("2033-06-01");
  });

  it("marca el vencido en vez de dejarlo pasar", () => {
    const p = dentroDePlazo("modulos", { ...COBERTURA, aniosModulos: 3 }, "2026-03-25");
    expect(p.vigente).toBe(false);
    expect(p.detalle).toMatch(/FUERA DE PLAZO/);
  });

  // Trackers y modulos casi nunca tienen el mismo plazo.
  it("usa el plazo del canal que corresponde", () => {
    const c = { puestaEnMarcha: "2015-01-01", aniosModulos: 12, aniosTrackers: 5 };
    expect(dentroDePlazo("modulos", c, "2026-03-25").vigente).toBe(true);
    expect(dentroDePlazo("trackers", c, "2026-03-25").vigente).toBe(false);
  });

  it("sin los datos no afirma nada", () => {
    expect(dentroDePlazo("modulos", {}, "2026-03-25").vigente).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("la regla que evita el reclamo que rebota", () => {
  it("reconoce un string entero caliente", () => {
    expect(esDeStringEntero(N, N)).toBe(true);
    expect(esDeStringEntero(3, N)).toBe(false);
  });

  it("un string entero NO se reclama al fabricante de modulos", () => {
    const h = comparar(muestras(40, { 5: 15 }));
    const caliente = h.find((x) => x.modulo.positionInRow === 5)!;
    const k = claveDe(caliente);

    const solo = armarPaquete(h, {
      anomalias: new Map([[k, "Diodo de bypass"]]),
      cobertura: COBERTURA, condiciones: BUENAS, conRgb: new Set([k]),
    }).find((i) => claveDe(i.hallazgo) === k)!;
    expect(solo.canal).toBe("modulos");

    // El mismo hallazgo, pero con todo el string caliente.
    const enString = armarPaquete(h, {
      anomalias: new Map([[k, "Diodo de bypass"]]),
      deStringEntero: new Set([k]),
      cobertura: COBERTURA, condiciones: BUENAS, conRgb: new Set([k]),
    }).find((i) => claveDe(i.hallazgo) === k)!;
    expect(enString.canal).toBe("sin-clasificar");
    expect(enString.motivo).toMatch(/aguas arriba/);
    expect(enString.motivo).toMatch(/rebota/);
  });
});

// ---------------------------------------------------------------------------

describe("que le falta al reclamo", () => {
  const unItem = (cond: Condiciones, extra: Record<string, unknown> = {}) => {
    const h = comparar(muestras(40, { 5: 15 }));
    const caliente = h.find((x) => x.modulo.positionInRow === 5)!;
    const k = claveDe(caliente);
    return armarPaquete(h, {
      anomalias: new Map([[k, "Diodo de bypass"]]),
      cobertura: COBERTURA, condiciones: cond, conRgb: new Set([k]), ...extra,
    }).find((i) => claveDe(i.hallazgo) === k)!;
  };

  it("con todo en orden queda listo para presentar", () => {
    const it = unItem(BUENAS);
    expect(it.faltante).toEqual([]);
    expect(it.completo).toBe(true);
  });

  // El motivo por el que rebotan los reclamos, y esta en el archivo real de
  // Edenvale: el 41 % de los hallazgos no traia irradiancia.
  it("sin irradiancia el reclamo no es defendible", () => {
    const it = unItem({ fecha: "2026-03-25" });
    expect(it.completo).toBe(false);
    expect(it.faltante.join(" ")).toMatch(/Falta la irradiancia/);
  });

  it("con el vuelo por debajo del minimo de la norma, lo dice con el numero", () => {
    const it = unItem({ ...BUENAS, irradianciaWm2: 392 });
    expect(it.faltante.join(" ")).toMatch(/392 W\/m2/);
    expect(it.faltante.join(" ")).toMatch(/600/);
  });

  it("sin foto visible no se puede descartar un golpe externo", () => {
    const it = unItem(BUENAS, { conRgb: new Set<string>() });
    expect(it.faltante.join(" ")).toMatch(/foto visible/);
  });

  it("lo que invalida el reclamo va primero", () => {
    const it = unItem({ fecha: "2026-03-25" }, { cobertura: {} });
    expect(it.faltante[0]).toMatch(/puesta en marcha/);
  });
});

// ---------------------------------------------------------------------------

describe("el resumen", () => {
  const paquete = () => {
    const h = comparar(muestras(40, { 5: 15, 9: 12, 20: 25 }));
    const k = (p: number) => claveDe(h.find((x) => x.modulo.positionInRow === p)!);
    return armarPaquete(h, {
      anomalias: new Map([
        [k(5), "Diodo de bypass"],
        [k(9), "Wrongly inclined modules"],
        [k(20), "Suciedad"],
      ]),
      cobertura: COBERTURA, condiciones: BUENAS, conRgb: new Set([k(5), k(9), k(20)]),
    });
  };

  it("cuenta cuantos van a cada bolsillo", () => {
    const r = resumirGarantias(paquete());
    expect(r.total).toBe(3);
    expect(r.porCanal.modulos).toBe(1);
    expect(r.porCanal.trackers).toBe(1);
    expect(r.porCanal.operacion).toBe(1);
    expect(r.listos).toBe(3);
  });

  // Lo que hace accionable el resumen: que arreglar primero.
  it("ordena lo que le falta a mas reclamos primero", () => {
    const h = comparar(muestras(40, { 5: 15, 9: 12 }));
    const items = armarPaquete(h, { cobertura: {}, condiciones: {} });
    const r = resumirGarantias(items);
    expect(r.incompletos).toBe(2);
    expect(r.faltantesFrecuentes[0]!.reclamos).toBe(2);
  });
});

describe("el archivo que se entrega", () => {
  it("lleva la columna que dice por que rebotaria", () => {
    const h = comparar(muestras(40, { 5: 15 }));
    const items = armarPaquete(h, { cobertura: {}, condiciones: {} });
    const csv = toCsv(items, {});
    expect(csv.split("\n")[0]).toContain("que_le_falta");
    expect(csv.split("\n")[0]).toContain("por_que_este_canal");
    expect(csv).toMatch(/irradiancia/);
  });

  it("pone primero los que estan listos para presentar", () => {
    const h = comparar(muestras(40, { 5: 15, 9: 12 }));
    const k = (p: number) => claveDe(h.find((x) => x.modulo.positionInRow === p)!);
    const items = armarPaquete(h, {
      anomalias: new Map([[k(5), "Diodo de bypass"]]),
      cobertura: COBERTURA, condiciones: BUENAS, conRgb: new Set([k(5)]),
    });
    const filas = toCsv(items, BUENAS).split("\n");
    expect(filas[1]).toContain(",si,");
    expect(filas[2]).toContain(",no,");
  });
});
