/**
 * El test que le da sentido a todo el diseno.
 *
 * Northfield no existe. Esta construido para no parecerse a Edenvale en
 * ninguna de las decisiones que podrian haber quedado hardcodeadas: modulos
 * apaisados, 30 por string, un solo string por fila, conteo siempre desde el
 * norte, sin inversion y sin offset de pica.
 *
 * Si el motor lo resuelve sin tocar una linea de codigo, entonces dar de alta
 * un parque nuevo es llenar un JSON — que es la premisa entera del negocio.
 */

import { describe, expect, it } from "vitest";
import northfieldJson from "../farms/northfield-synthetic.json" with { type: "json" };
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import { formatAddress } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, nominalLengthM, pointAtSlot } from "./helpers/synthetic.js";

const profile = northfieldJson as unknown as FarmProfile;

// Filas este-oeste, no norte-sur: otra suposicion menos.
const rowA = makeRow(
  {
    id: "A-01",
    block: "A",
    tracker: "A-01",
    anchor: { lat: -27.3, lon: 152.5 },
    azimuthDeg: 0, // de sur a norte: la pica `start` es la del SUR
  },
  profile,
);

const rowB = makeRow(
  {
    id: "A-02",
    block: "A",
    tracker: "A-02",
    anchor: { lat: -27.3, lon: 152.5008 },
    azimuthDeg: 0,
  },
  profile,
);

const farm = compileFarm(profile, [rowA, rowB]);

describe("Northfield: reglas completamente distintas a Edenvale", () => {
  it("compila sin warnings", () => {
    expect(farm.buildWarnings).toEqual([]);
  });

  it("usa el paso apaisado, no el de Edenvale", () => {
    expect(farm.rows[0]?.pitchM).toBeCloseTo(2.305, 9);
    expect(farm.modulesPerRow).toBe(30);
    // 30 modulos con 29 huequitos entre ellos, sin bahia de motor.
    expect(nominalLengthM(profile)).toBeCloseTo(69.125, 6);
  });

  it("no aplica offset de pica", () => {
    expect(farm.rows[0]?.originOffsetM).toBe(0);
    expect(farm.rows[0]?.farOffsetM).toBe(0);
  });

  it("cuenta desde el extremo norte, que aca es la pica `end`", () => {
    expect(farm.rows[0]?.originEnd).toBe("end");
  });

  it("no invierte ningun string", () => {
    expect(farm.rows[0]?.inverted).toEqual([false]);
  });

  it("localiza el modulo 1 en la punta norte y el 30 en la punta sur", () => {
    // `pointAtSlot` cuenta desde `start`, que aca es la pica sur.
    const south = pointAtSlot(rowA, 1, profile);
    const north = pointAtSlot(rowA, 30, profile);

    expect(locate({ ...south, accuracyM: 0.3 }, farm).best).toMatchObject({
      tracker: "A-01",
      stringNumber: 1,
      module: 30,
      countedFrom: "near-dc",
    });
    expect(locate({ ...north, accuracyM: 0.3 }, farm).best).toMatchObject({
      tracker: "A-01",
      stringNumber: 1,
      module: 1,
    });
  });

  it("resuelve los 30 modulos sin repetir ni saltear", () => {
    const seen = new Set<number>();
    for (let slot = 1; slot <= 30; slot++) {
      const fix = pointAtSlot(rowA, slot, profile);
      const best = locate({ ...fix, accuracyM: 0.3 }, farm).best;
      expect(best, `slot ${slot}`).not.toBeNull();
      expect(best!.module).toBe(30 - slot + 1);
      seen.add(best!.module);
    }
    expect(seen.size).toBe(30);
  });

  it("distingue las dos filas vecinas", () => {
    const onB = pointAtSlot(rowB, 15, profile);
    expect(locate({ ...onB, accuracyM: 0.3 }, farm).best?.tracker).toBe("A-02");
  });
});

describe("aislamiento entre parques", () => {
  it("el mismo motor sirve a los dos parques a la vez, sin estado compartido", () => {
    const eden = edenvaleJson as unknown as FarmProfile;
    const edenRow = makeRow(
      {
        id: "01-001-R1",
        block: "01",
        tracker: "01-001",
        row: "R1",
        anchor: { lat: -27.4, lon: 152.7 },
        azimuthDeg: 180,
        side: "north",
        pos: 2,
        posTotal: 4,
        stringNumbers: [1, 2],
      },
      eden,
    );
    const edenFarm = compileFarm(eden, [edenRow]);

    const a = locate(
      { ...pointAtSlot(edenRow, 1, eden), accuracyM: 0.3 },
      edenFarm,
    );
    const b = locate({ ...pointAtSlot(rowA, 1, profile), accuracyM: 0.3 }, farm);

    expect(a.best?.module).toBe(1);
    expect(a.best?.countedFrom).toBe("far-end");
    expect(b.best?.module).toBe(30);
    expect(b.best?.countedFrom).toBe("near-dc");

    /*
      La punta se dice por RUMBO, no por su relacion con la caja.

      Antes esto decia "desde la punta lejana" y "desde la caja DC". Esas dos
      frases solo son ciertas mientras el parque cuente desde la caja de
      continua; en un parque que cuenta desde el norte mandan a contar desde la
      punta contraria de una fila de 65 metros, y es la unica frase que el
      tecnico ejecuta caminando. Ahora la direccion dice cual punta es, medida
      contra las coordenadas de la propia fila, y la caja queda como lo que es:
      por donde se entra.
    */
    expect(formatAddress(a.best!)).toBe(
      "Bloque 01, tracker 01-001 R1, string 2, modulo 1 (contando desde la punta sur)",
    );
    expect(formatAddress(b.best!)).toBe(
      "Bloque A, tracker A-01, string 1, modulo 30 (contando desde la punta norte)",
    );
  });
});
