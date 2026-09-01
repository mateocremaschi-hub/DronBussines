/**
 * El mapa como navegacion: parque -> bloque -> modulo.
 *
 * El dibujo no se prueba; lo que se prueba son los datos que lo sostienen, que
 * es donde estan los errores caros. Un hallazgo ubicado en el bloque de al lado
 * manda a alguien a caminar el bloque equivocado, y en un parque de mil
 * hectareas eso es media manana.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { compileFarm } from "../src/index.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow } from "./helpers/synthetic.js";
import { bloquesDelParque, partirId, puntosDeHallazgos, unirCajas } from "../app/mapa";
import { idDeModulo } from "../app/vuelo";
import type { Finding } from "../app/inspection";

const profile = edenvaleJson as unknown as FarmProfile;

const filas = [
  makeRow({ id: "05-042-R1", block: "05", tracker: "05-042", row: "R1",
    anchor: { lat: -26.92, lon: 150.58 }, azimuthDeg: 180, side: "north" }, profile),
  makeRow({ id: "05-043-R1", block: "05", tracker: "05-043", row: "R1",
    anchor: { lat: -26.92, lon: 150.5806 }, azimuthDeg: 180, side: "north" }, profile),
  makeRow({ id: "07-001-R1", block: "07", tracker: "07-001", row: "R1",
    anchor: { lat: -26.93, lon: 150.59 }, azimuthDeg: 180, side: "north" }, profile),
];
const farm = compileFarm(profile, filas);

const hallazgo = (id: string, extra: Partial<Finding> = {}): Finding => ({
  id, fileName: "DJI_0001_T.JPG", address: null, candidates: [], warnings: [],
  status: "pendiente", ...extra,
});

describe("el id de un hallazgo", () => {
  it("se parte por el ultimo numeral", () => {
    expect(partirId("05-042-R1#17")).toEqual({ rowId: "05-042-R1", positionInRow: 17 });
  });

  /*
    Los rowId salen del Excel del cliente y pueden traer cualquier cosa. Partir
    por el PRIMER numeral perderia la fila entera y el hallazgo no se dibujaria
    en ningun lado, sin un solo error en la consola.
  */
  it("aguanta un rowId con numeral adentro", () => {
    expect(partirId("bloque#3/05-042-R1#17")).toEqual({ rowId: "bloque#3/05-042-R1", positionInRow: 17 });
  });

  it("rechaza lo que no nombra un modulo", () => {
    expect(partirId("05-042-R1")).toBeNull();
    expect(partirId("#4")).toBeNull();
    expect(partirId("05-042-R1#0")).toBeNull();
    expect(partirId("05-042-R1#x")).toBeNull();
  });
});

describe("donde cae cada hallazgo", () => {
  it("ubica el modulo en su fila y su bloque", () => {
    const puntos = puntosDeHallazgos(farm, [hallazgo(idDeModulo("05-042-R1", 3))]);
    const p = puntos.get(idDeModulo("05-042-R1", 3));
    expect(p?.block).toBe("05");
    expect(Number.isFinite(p?.x)).toBe(true);
    expect(Number.isFinite(p?.y)).toBe(true);
  });

  /*
    Dos modulos de la misma fila tienen que caer en puntos distintos y en el
    orden del conteo. Si cayeran todos en el mismo lugar el mapa dibujaria un
    solo punto donde hay veinte, y nadie lo notaria mirandolo.
  */
  it("los modulos consecutivos caen separados y en orden", () => {
    const ids = [3, 4, 20].map((n) => idDeModulo("05-042-R1", n));
    const puntos = puntosDeHallazgos(farm, ids.map((id) => hallazgo(id)));
    const [a, b, c] = ids.map((id) => {
      const p = puntos.get(id);
      expect(p).toBeDefined();
      return p!;
    });
    const d = (u: { x: number; y: number }, v: { x: number; y: number }) =>
      Math.hypot(u.x - v.x, u.y - v.y);
    expect(d(a!, b!)).toBeGreaterThan(0.5);
    expect(d(a!, c!)).toBeGreaterThan(d(a!, b!));
  });

  it("un hallazgo de una fila que el parque no tiene no se inventa", () => {
    const puntos = puntosDeHallazgos(farm, [hallazgo(idDeModulo("99-999-R1", 3))]);
    expect(puntos.size).toBe(0);
  });
});

describe("los bloques del parque", () => {
  it("salen del parque y no de los hallazgos", () => {
    const bloques = bloquesDelParque(farm, [], new Map());
    expect(bloques.map((b) => b.block)).toEqual(["05", "07"]);
    // Un bloque sin anomalias aparece igual, en cero: esconderlo haria que el
    // mapa mienta por omision.
    expect(bloques.every((b) => b.total === 0)).toBe(true);
  });

  it("cuenta lo pendiente y lo critico de cada bloque", () => {
    const findings = [
      hallazgo(idDeModulo("05-042-R1", 3), { medicion: { peor: "critica" } as never }),
      hallazgo(idDeModulo("05-043-R1", 5), { status: "confirmado" }),
      hallazgo(idDeModulo("07-001-R1", 9)),
    ];
    const puntos = puntosDeHallazgos(farm, findings);
    const bloques = bloquesDelParque(farm, findings, puntos);
    const b05 = bloques.find((b) => b.block === "05")!;
    const b07 = bloques.find((b) => b.block === "07")!;

    expect(b05.total).toBe(2);
    expect(b05.pendientes).toBe(1);
    expect(b05.criticas).toBe(1);
    expect(b07.total).toBe(1);
    expect(b05.tramos.length).toBe(2);
  });

  /*
    Un hallazgo que no se pudo ubicar no se cuenta en ningun bloque. Meterlo en
    uno cualquiera es peor que dejarlo afuera: el mapa diria que hay trabajo en
    un bloque donde no lo hay.
  */
  it("lo que no se pudo ubicar no cae en ningun bloque", () => {
    const findings = [hallazgo("no-existe#4")];
    const bloques = bloquesDelParque(farm, findings, puntosDeHallazgos(farm, findings));
    expect(bloques.every((b) => b.total === 0)).toBe(true);
  });

  it("la caja del bloque contiene sus dos filas", () => {
    const bloques = bloquesDelParque(farm, [], new Map());
    const b05 = bloques.find((b) => b.block === "05")!;
    for (const t of b05.tramos) {
      expect(t.ax).toBeGreaterThanOrEqual(b05.caja.minX - 1e-6);
      expect(t.ax).toBeLessThanOrEqual(b05.caja.maxX + 1e-6);
    }
  });
});

describe("unirCajas", () => {
  it("sin cajas no hay caja", () => {
    expect(unirCajas([])).toBeNull();
  });
  it("envuelve a todas", () => {
    expect(unirCajas([
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      { minX: -2, minY: 3, maxX: 0.5, maxY: 4 },
    ])).toEqual({ minX: -2, minY: 0, maxX: 1, maxY: 4 });
  });
});
