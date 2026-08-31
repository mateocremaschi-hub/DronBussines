/**
 * Una fila que no cierra con la geometria del parque tiene que avisar CADA VEZ.
 *
 * En Edenvale hay una fila (la esclava del 24-3) que mide 57,59 m en vez de
 * 65,145. El aviso existia, pero vivia solo en `buildWarnings`: aparecia una
 * vez, truncado, en la pantalla de alta del parque, meses antes del vuelo.
 * Parado sobre esa fila con el telefono en la mano, la app contestaba un modulo
 * corrido tres posiciones, con confianza normal y cero avisos.
 *
 * El tecnico que esta en el campo no vio esa pantalla y no la va a ver. El
 * aviso tiene que reaparecer cuando la fila rota es la que gana la consulta.
 */

import { describe, expect, it } from "vitest";
import profileJson from "../farms/edenvale.json" with { type: "json" };
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, nominalLengthM, pointAtSlot } from "./helpers/synthetic.js";

const profile = profileJson as unknown as FarmProfile;
const base = { azimuthDeg: 180, block: "24", row: "R1", side: "north", pos: 1, posTotal: 3 } as const;

const sana = makeRow(
  { ...base, id: "24-002-R1", tracker: "24-002", anchor: { lat: -27.4, lon: 152.7 }, stringNumbers: [1, 2] },
  profile,
);

// La esclava real: 57,59 m donde la geometria predice 65,145.
const rota = makeRow(
  {
    ...base,
    id: "24-003-R1",
    tracker: "24-003",
    anchor: { lat: -27.4, lon: 152.701 },
    stringNumbers: [3, 4],
    lengthM: 57.59,
  },
  profile,
);

const farm = compileFarm(profile, [sana, rota]);

function avisosEn(row: typeof sana, slot: number) {
  const fix = pointAtSlot(row, slot, profile, "start");
  return locate({ ...fix, accuracyM: 0.5 }, farm).warnings;
}

describe("una fila que no cierra con la geometria", () => {
  it("la geometria sintetica es la que se cree que es", () => {
    // 65,195 m es lo que ocupan los 56 modulos con su bahia. Las picas reales
    // miden 65,145: los 25 mm por punta de diferencia son el `endpointOffsetMm`
    // negativo del perfil, que la fila sintetica no aplica.
    expect(nominalLengthM(profile)).toBeCloseTo(65.195, 2);
  });

  it("avisa al consultar, no solo al compilar el parque", () => {
    const codigos = avisosEn(rota, 20).map((w) => w.code);
    expect(codigos).toContain("length-mismatch");
  });

  it("el aviso dice cuanto se puede haber corrido el modulo, en metros y en posiciones", () => {
    const aviso = avisosEn(rota, 20).find((w) => w.code === "length-mismatch");
    // 7,5 m de faltante repartidos en dos puntas: casi 4 m por punta.
    expect(aviso?.message).toMatch(/3,?\.\d m de corrimiento por punta|3\.\d m/);
    expect(aviso?.message).toMatch(/posiciones/);
    expect(aviso?.message).toMatch(/Cont[aá] desde la caja/);
  });

  it("la fila sana no arrastra el aviso de la rota", () => {
    const codigos = avisosEn(sana, 20).map((w) => w.code);
    expect(codigos).not.toContain("length-mismatch");
  });

  /**
   * Lo que hacia inutil al aviso viejo: aparecia una sola vez para todo el
   * parque. Si el tecnico camina de una fila rota a otra, las dos tienen que
   * avisar.
   */
  it("el aviso vuelve en cada consulta sobre la fila rota", () => {
    expect(avisosEn(rota, 5).some((w) => w.code === "length-mismatch")).toBe(true);
    expect(avisosEn(rota, 50).some((w) => w.code === "length-mismatch")).toBe(true);
  });
});
