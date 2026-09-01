/**
 * Centrar tiene que centrar contra el paso con el que despues se reparte.
 *
 * `endpointOffsetMode: "centered"` existe para que nadie tenga que declarar el
 * voladizo de la pica: se asume que los modulos ocupan lo que dice el paso y lo
 * que sobra del largo real se reparte entre las dos puntas. Eso solo es cierto
 * si "lo que ocupan los modulos" se mide con el MISMO paso que arma el reparto.
 *
 * No lo era: el centrado usaba el paso nominal —`ancho + hueco`— y el reparto
 * usaba el declarado (`module.pitchMm`, o `row.pitchMmOverride` de la fila).
 * En Edenvale los dos numeros coinciden, asi que el parque de control no podia
 * ver la diferencia. En un parque donde el paso declarado NO es ancho + hueco,
 * la fila entera arrancaba afuera de la pica.
 *
 * El escenario de abajo es el peor caso posible, y por eso esta escrito con
 * numeros y no con formulas: la fila mide EXACTAMENTE lo que predice el paso
 * declarado (54 x 1140 + 2 x 1135 + 555 = 64385 mm), asi que el aviso de largo
 * —que si mira el paso real— da cero y no salta. Geometria corrida 405 mm, y
 * cero cosas para revisar en pantalla.
 */

import { describe, expect, it } from "vitest";
import type { FarmProfile } from "../src/types.js";
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import { makeRow } from "./helpers/synthetic.js";
import { makeFrame, toGeo, toLocal } from "../src/geo/frame.js";

/** Panel de 1135 con 20 de hueco (nominal 1155) pero paso declarado 1140. */
const perfil = (): FarmProfile =>
  ({
    id: "paso-que-no-es-ancho-mas-hueco",
    name: "Paso declarado con centrado",
    profileVersion: 1,
    module: { widthMm: 1135, gapMm: 20, pitchMm: 1140 },
    topology: { modulesPerString: 28, stringsPerRow: 2, stringGapMm: 555 },
    geometry: { endpointOffsetMm: -25, endpointOffsetMode: "centered" },
    addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" },
  }) as unknown as FarmProfile;

/** 54 pasos de 1140 + los dos modulos que bordean la bahia + la bahia. */
const LARGO_M = 64.385;

function filaUnica() {
  const profile = perfil();
  const row = makeRow(
    {
      id: "r",
      block: "01",
      tracker: "01-1",
      anchor: { lat: -26.9, lon: 150.58 },
      azimuthDeg: 180, // start al norte, que es el extremo de conteo
      lengthM: LARGO_M,
    },
    profile,
  );
  return { profile, row, farm: compileFarm(profile, [row]) };
}

describe("centrado con un paso declarado que no es ancho + hueco", () => {
  it("no deja los modulos afuera de la pica: la fila cierra justo", () => {
    const { farm } = filaUnica();
    const fila = farm.rows[0]!;
    // La fila mide exactamente lo que ocupan sus modulos al paso declarado:
    // centrar no tiene nada que repartir y los dos voladizos son cero.
    // Centrando contra el nominal daban -405 mm cada uno. La tolerancia es de
    // decimas de milimetro y no cero exacto: la fila sintetica va y vuelve por
    // coordenadas geograficas, y de ahi salen unos micrones de redondeo.
    expect(fila.originOffsetM).toBeCloseTo(0, 4);
    expect(fila.farOffsetM).toBeCloseTo(0, 4);
  });

  it("y el modulo 1 empieza en la pica, no 405 mm antes", () => {
    const { row, farm } = filaUnica();
    const frame = makeFrame(row.start.lat, row.start.lon);
    const a = toLocal(frame, row.start.lat, row.start.lon);
    const b = toLocal(frame, row.end.lat, row.end.lon);
    const en = (m: number) => {
      const f = m / LARGO_M;
      const g = toGeo(frame, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      return locate({ ...g, accuracyM: 0.2 }, farm).best?.positionInRow;
    };

    // A un metro de la pica norte se esta parado sobre el primer modulo, que
    // ocupa de 0 a 1135. Con la fila corrida 405 mm afuera, ese metro caia
    // sobre el segundo (0735 a 1870) y el tecnico buscaba el panel de al lado.
    expect(en(1)).toBe(1);
    expect(en(0.2)).toBe(1);
    // Y la punta lejana sigue siendo el modulo 56, no un punto fuera de la fila.
    expect(en(LARGO_M - 0.2)).toBe(56);
  });

  it("el largo cierra sin avisos, que es lo que hacia invisible el corrimiento", () => {
    const { farm } = filaUnica();
    expect(farm.buildWarnings.filter((w) => w.code === "length-mismatch")).toHaveLength(0);
  });
});
