/**
 * La bahia de la fila esclava es mas chica, y no se modela. Por que.
 *
 * Mateo midio con cinta las dos: 555 mm en la fila motorizada y 540-545 en la
 * esclava. El perfil declara UN solo numero por parque, asi que la mitad de las
 * filas de Edenvale se calculan con unos 13 mm de mas. La pregunta —que la hizo
 * el— es si eso hace errar un modulo.
 *
 * Se contesta caminando la fila entera de a 10 cm y comparando las respuestas,
 * no argumentando. Da que cambia en 6 de 648 puntos, y los 6 caen sobre una
 * junta entre dos modulos que se estan tocando. Y se compara `positionInRow`, que es lo que el motor
 * devuelve: la primera version de esta prueba miraba un `moduleIndex` que no
 * existe, asi que comparaba undefined contra undefined y pasaba siempre —
 * incluso con la bahia de 3713 mm que se sabe que rompia todo. Una prueba que
 * no puede fallar es peor que ninguna: ocupa el lugar de la que si mide.
 */

import { describe, expect, it } from "vitest";
import edenvale from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile } from "../src/types.js";
import { makeRow } from "./helpers/synthetic.js";
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import { makeFrame, toGeo, toLocal } from "../src/geo/frame.js";

const base = edenvale as unknown as FarmProfile;
const con = (bahiaMm: number): FarmProfile => ({
  ...base, topology: { ...base.topology, stringGapMm: bahiaMm },
});

/** La fila esclava de un tracker doble, con su largo real medido. */
const SPEC = {
  id: "04-018-esclava", block: "04", tracker: "04-018", row: "esclava",
  anchor: { lat: -26.9, lon: 150.58 }, azimuthDeg: 0,
  side: "north" as const, lengthM: 65.145,
};

/** Camina la fila de a 10 cm y cuenta en cuantos puntos los dos perfiles discrepan. */
function discrepancias(
  bahiaA: number, bahiaB: number,
): { total: number; distintos: Array<{ mm: number; salto: number }> } {
  const row = makeRow(SPEC, con(bahiaA));
  const a = compileFarm(con(bahiaA), [row]);
  const b = compileFarm(con(bahiaB), [row]);

  const frame = makeFrame(SPEC.anchor.lat, SPEC.anchor.lon);
  const p0 = toLocal(frame, row.start.lat, row.start.lon);
  const p1 = toLocal(frame, row.end.lat, row.end.lon);

  let total = 0;
  const distintos: Array<{ mm: number; salto: number }> = [];
  for (let mm = 200; mm < 64_945; mm += 100) {
    const f = mm / 65_145;
    const g = toGeo(frame, p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f);
    const uno = locate({ ...g, accuracyM: 0.2 }, a).best;
    const otro = locate({ ...g, accuracyM: 0.2 }, b).best;
    if (!uno || !otro) continue;
    total++;
    const d = (otro.positionInRow ?? 0) - (uno.positionInRow ?? 0);
    if (d !== 0) distintos.push({ mm, salto: d });
  }
  return { total, distintos };
}

describe("la bahia mas chica de la fila esclava", () => {
  it("solo cambia la respuesta si estas parado JUSTO sobre una junta", () => {
    const { total, distintos } = discrepancias(555, 542);
    expect(total).toBeGreaterThan(600);

    // Los 13 mm corren cada string 6,5 mm. Eso solo cambia la respuesta en los
    // puntos que caen a menos de 6,5 mm de la junta entre dos modulos: 6,5 de
    // 1155, o sea medio punto por ciento de la fila. Y ahi los dos modulos se
    // estan tocando, asi que las dos respuestas son correctas al centimetro.
    expect(distintos.length / total).toBeLessThan(0.02);

    // Y cuando cambia, cambia al modulo de al lado. Nunca salta.
    for (const d of distintos) {
      expect(Math.abs(d.salto), `a los ${d.mm} mm de la punta salta ${d.salto}`).toBe(1);
    }
  });

  /**
   * El contraste, que es lo que le da sentido al numero de arriba.
   *
   * Centrar reparte cualquier error de bahia entre las dos puntas, asi que cada
   * string se corre la mitad: con 13 mm de error el corrimiento es de 6,5 mm y
   * no lo ve nadie. Los 3713 mm que estuvieron declarados durante meses corren
   * cada string 1579 mm — mas de un modulo entero. La diferencia entre los dos
   * casos no es de grado.
   */
  it("y la bahia que estuvo mal de verdad —3713 mm— cambia casi toda la fila", () => {
    const { total, distintos } = discrepancias(555, 3713);
    expect(distintos.length / total).toBeGreaterThan(0.5);
  });
});
