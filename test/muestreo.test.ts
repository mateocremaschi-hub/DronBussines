/**
 * Revisar por muestreo en vez de panel por panel.
 *
 * "Imaginate revisar mas de 3000 paneles a mano, me tardaria una eternidad."
 *
 * La salida no es revisar mas rapido: es revisar menos y poder defenderlo. Lo
 * que se prueba aca es que la muestra sea honesta —que no deje tipos enteros
 * sin mirar, que no muestree justo lo que se sabe que falla, y que de igual
 * cada vez que se abre el vuelo— y que la tasa de acuerdo cuente lo que dice
 * contar.
 */

import { describe, expect, it } from "vitest";
import { acuerdoDeLaMuestra, muestraARevisar } from "../app/muestreo";
import type { Clasificacion } from "../app/patron";
import type { Finding } from "../app/inspection";

const patron = (p: Clasificacion["patron"], confianza: Clasificacion["confianza"], anomalia: string): Clasificacion =>
  ({ patron: p, confianza, anomalia, porQue: "", fraccionCaliente: 0.02, grumos: 1 });

const hallazgo = (id: string, p?: Clasificacion, extra: Partial<Finding> = {}): Finding => ({
  id, fileName: `${id}.jpg`, address: null, candidates: [], warnings: [],
  status: "pendiente", ...(p ? { patron: p, anomaly: p.anomalia } : {}), ...extra,
});

/** 40 diodos (confianza alta) y 40 modulos completos (alta). */
const muchos = [
  ...Array.from({ length: 40 }, (_, i) => hallazgo(`d${i}`, patron("diodo", "alta", "Diodo de bypass"))),
  ...Array.from({ length: 40 }, (_, i) => hallazgo(`m${i}`, patron("modulo-completo", "alta", "Modulo completo"))),
];

describe("que se manda a revisar", () => {
  it("un porcentaje de cada tipo, no los primeros N", () => {
    const m = muestraARevisar(muchos, 0.2, "vuelo-1");
    expect(m.porSorteo).toBeGreaterThan(0);

    const tipos = new Set(
      [...m.aRevisar].map((id) => (id.startsWith("d") ? "diodo" : "modulo")),
    );
    // Los dos tipos tienen que estar representados. Revisar "los primeros 16"
    // dejaria los 40 modulos completos sin mirar nunca.
    expect(tipos).toEqual(new Set(["diodo", "modulo"]));
    expect(m.aRevisar.size).toBeGreaterThanOrEqual(14);
    expect(m.aRevisar.size).toBeLessThanOrEqual(20);
  });

  /*
    Lo que la maquina marca con poca confianza NO se muestrea: va entero.
    Muestrear justo lo que uno sabe que falla es elegir no enterarse — y el
    informe de la otra empresa muestra exactamente eso: de 71 "multi hotspot"
    revisados, 30 estaban mal.
  */
  it("lo de poca confianza va entero, no muestreado", () => {
    const flojos = Array.from({ length: 30 }, (_, i) =>
      hallazgo(`c${i}`, patron("celda-multiple", "baja", "Celda multiple")));
    const m = muestraARevisar([...muchos, ...flojos], 0.1, "vuelo-1");
    for (const f of flojos) expect(m.aRevisar.has(f.id)).toBe(true);
    expect(m.porConfianza).toBe(30);
  });

  it("lo que no se pudo clasificar tambien va entero", () => {
    const sinForma = [hallazgo("x1"), hallazgo("x2")];
    const m = muestraARevisar([...muchos, ...sinForma], 0.1, "vuelo-1");
    expect(m.aRevisar.has("x1")).toBe(true);
    expect(m.aRevisar.has("x2")).toBe(true);
    expect(m.sinClasificar).toBe(2);
  });

  /*
    Abrir el mismo vuelo dos veces tiene que dar la misma muestra. Con
    Math.random, lo que ya se reviso se cae de la muestra al recargar y el
    informe no se puede reproducir.
  */
  it("el mismo vuelo sortea siempre igual", () => {
    const a = muestraARevisar(muchos, 0.2, "vuelo-1");
    const b = muestraARevisar(muchos, 0.2, "vuelo-1");
    expect([...a.aRevisar].sort()).toEqual([...b.aRevisar].sort());
  });

  it("y dos vuelos distintos sortean distinto", () => {
    const a = muestraARevisar(muchos, 0.2, "vuelo-1");
    const b = muestraARevisar(muchos, 0.2, "vuelo-2");
    expect([...a.aRevisar].sort()).not.toEqual([...b.aRevisar].sort());
  });

  it("al menos uno de cada tipo aunque el porcentaje de cero", () => {
    const uno = [hallazgo("z1", patron("punto-caliente", "media", "Punto caliente"))];
    const m = muestraARevisar(uno, 0.01, "vuelo-1");
    expect(m.aRevisar.size).toBe(1);
  });

  it("con el 100 % se revisa todo", () => {
    const m = muestraARevisar(muchos, 1, "vuelo-1");
    expect(m.aRevisar.size).toBe(muchos.length);
  });
});

describe("cuanto le acerto la maquina", () => {
  /*
    Es el numero que hace defendible clasificar por muestreo. Sin el, "lo
    clasifico una maquina" no tiene respaldo.
  */
  it("cuenta solo lo que una persona cerro", () => {
    const revisados = [
      hallazgo("d0", patron("diodo", "alta", "Diodo de bypass"), { status: "confirmado" }),
      hallazgo("d1", patron("diodo", "alta", "Diodo de bypass"), { status: "confirmado" }),
      hallazgo("d2", patron("diodo", "alta", "Diodo de bypass")),   // sin cerrar
    ];
    const a = acuerdoDeLaMuestra(revisados, new Set(["d0", "d1", "d2"]));
    expect(a.revisados).toBe(2);
    expect(a.faltan).toBe(1);
  });

  it("no coincide cuando la persona cambio la anomalia", () => {
    const f = [
      hallazgo("d0", patron("diodo", "alta", "Diodo de bypass"), { status: "confirmado" }),
      hallazgo("c0", patron("celda-multiple", "baja", "Celda multiple"),
               { status: "confirmado", anomaly: "Suciedad" }),
    ];
    const a = acuerdoDeLaMuestra(f, new Set(["d0", "c0"]));
    expect(a.revisados).toBe(2);
    expect(a.coinciden).toBe(1);
    expect(a.tasa).toBeCloseTo(0.5, 5);
  });

  /*
    Abierto por tipo, que es donde se ve cual falla. En el informe de la otra
    empresa el diodo aguantaba 151 de 155 y el multi hotspot 41 de 71: un
    promedio global habria escondido eso.
  */
  it("la tasa se abre por tipo", () => {
    const f = [
      ...Array.from({ length: 4 }, (_, i) =>
        hallazgo(`d${i}`, patron("diodo", "alta", "Diodo de bypass"), { status: "confirmado" })),
      ...Array.from({ length: 4 }, (_, i) =>
        hallazgo(`c${i}`, patron("celda-multiple", "baja", "Celda multiple"),
                 { status: "confirmado", anomaly: "Suciedad" })),
    ];
    const a = acuerdoDeLaMuestra(f, new Set(f.map((x) => x.id)));
    const diodo = a.porTipo.find((t) => t.patron === "diodo")!;
    const celda = a.porTipo.find((t) => t.patron === "celda-multiple")!;
    expect(diodo.coinciden).toBe(4);
    expect(celda.coinciden).toBe(0);
  });

  it("sin nada revisado no inventa una tasa", () => {
    const a = acuerdoDeLaMuestra(muchos, new Set(muchos.map((f) => f.id)));
    expect(a.tasa).toBeNull();
  });
});
