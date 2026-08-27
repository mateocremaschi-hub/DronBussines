import { describe, expect, it } from "vitest";
import edenvale from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile } from "../src/types.js";
import { CAMARAS, OPCIONES_POR_DEFECTO, planMission } from "../app/mission";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvale as unknown as FarmProfile;
const rows = Array.from({ length: 30 }, (_, i) =>
  makeRow({ id: `t${i}`, block: "04", tracker: `04-${i}`,
    anchor: { lat: -26.9, lon: 150.58 + i * 0.00006 }, azimuthDeg: 0 }, profile));

const plan = (altitudeM: number) =>
  planMission(rows, profile, {
    ...OPCIONES_POR_DEFECTO, altitudeM, camera: CAMARAS[0]!,
  })!;

describe("el consejo de altura", () => {
  /**
   * Encontrado usando la app de verdad: a 70 m decia "bajá a 38 m o menos",
   * y a 38 m volvia a avisar lo mismo. Redondeaba al entero MAS CERCANO, que
   * se pasa de largo del limite. Un consejo que seguido al pie de la letra
   * sigue quejandose entrena a no leer los avisos.
   */
  it("la altura que recomienda, volada, ya no dispara el aviso", () => {
    const alto = plan(70);
    const aviso = alto.stats.avisos.find((a) => /celda de 16 cm/.test(a));
    expect(aviso, "esperaba el aviso de resolucion a 70 m").toBeDefined();

    const m = /Bajá a (\d+) m/.exec(aviso!);
    expect(m, `no pude leer la altura del aviso: ${aviso}`).toBeTruthy();
    const recomendada = Number(m![1]);

    const bajo = plan(recomendada);
    expect(
      bajo.stats.avisos.filter((a) => /celda de 16 cm/.test(a)),
      `a ${recomendada} m sigue avisando: gsd ${bajo.stats.gsdCm.toFixed(2)} cm/px`,
    ).toEqual([]);
  });
});
