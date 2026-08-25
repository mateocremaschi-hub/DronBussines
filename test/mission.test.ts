/**
 * La ruta de vuelo, sacada de la geometria del parque.
 *
 * Lo que importa que este bien no es que dibuje lineas: es que las lineas
 * CUBRAN todo. Un hueco entre dos lineas no falla nada el dia del vuelo — se
 * descubre meses despues, cuando alguien busca un panel y no hay foto.
 *
 * Por eso el test central es de cobertura: se recorre la huella de cada linea
 * y se verifica que ningun modulo del parque quede afuera.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import {
  CAMARAS,
  OPCIONES_POR_DEFECTO,
  planMission,
  toKml,
  toWaypointCsv,
  type MissionOptions,
} from "../app/mission";
import { makeFrame, toLocal } from "../src/index.js";
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const termica = CAMARAS[0]!;
const M_LAT = 110946;

const opts = (o: Partial<MissionOptions> = {}): MissionOptions => ({
  camera: termica,
  ...OPCIONES_POR_DEFECTO,
  ...o,
});

/** Un bloque de `n` filas norte-sur, separadas 6 m entre si. */
function bloque(n: number): TrackerRow[] {
  return Array.from({ length: n }, (_, i) =>
    makeRow(
      {
        id: `t${i}`, block: "05", tracker: `t${i}`,
        anchor: { lat: -27.4, lon: 152.7 + (i * 6) / (111320 * Math.cos(-27.4 * Math.PI / 180)) },
        azimuthDeg: 180,
      },
      profile,
    ),
  );
}

// ---------------------------------------------------------------------------

describe("la ruta", () => {
  it("sin filas cargadas no inventa un plan", () => {
    expect(planMission([], profile, opts())).toBeNull();
  });

  it("serpentea: cada linea arranca donde termino la anterior", () => {
    const m = planMission(bloque(10), profile, opts())!;
    for (let i = 1; i < m.lines.length; i++) {
      const finAnterior = m.lines[i - 1]!.b;
      const inicio = m.lines[i]!.a;
      const frame = makeFrame(finAnterior.lat, finAnterior.lon);
      const d = Math.hypot(...Object.values(toLocal(frame, inicio.lat, inicio.lon)) as [number, number]);
      // El salto entre lineas es la separacion lateral, no el largo del bloque.
      expect(d).toBeLessThan(m.stats.separacionM * 1.5);
    }
  });

  it("mas solape lateral son mas lineas", () => {
    const poco = planMission(bloque(10), profile, opts({ sideOverlap: 0.5 }))!;
    const mucho = planMission(bloque(10), profile, opts({ sideOverlap: 0.8 }))!;
    expect(mucho.stats.lineas).toBeGreaterThan(poco.stats.lineas);
  });

  it("mas altura son menos lineas, porque la huella es mas grande", () => {
    const bajo = planMission(bloque(10), profile, opts({ altitudeM: 20 }))!;
    const alto = planMission(bloque(10), profile, opts({ altitudeM: 60 }))!;
    expect(alto.stats.lineas).toBeLessThan(bajo.stats.lineas);
    expect(alto.stats.huellaAnchoM).toBeCloseTo(bajo.stats.huellaAnchoM * 3, 1);
  });
});

// ---------------------------------------------------------------------------

describe("cobertura: que no quede ningun modulo sin foto", () => {
  /**
   * Verifica que cada punta de cada fila caiga dentro de la huella de alguna
   * linea de vuelo. Es la prueba que importa: el resto son numeros lindos.
   */
  function todoCubierto(rows: TrackerRow[], o: MissionOptions): boolean {
    const m = planMission(rows, profile, o)!;
    const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);
    const mitad = m.stats.huellaAnchoM / 2;

    const puntos = rows.flatMap((r) => [
      toLocal(frame, r.start.lat, r.start.lon),
      toLocal(frame, r.end.lat, r.end.lon),
    ]);

    return puntos.every((p) =>
      m.lines.some((l) => {
        const A = toLocal(frame, l.a.lat, l.a.lon);
        const B = toLocal(frame, l.b.lat, l.b.lon);
        const dx = B.x - A.x, dy = B.y - A.y;
        const len = Math.hypot(dx, dy) || 1;
        const t = ((p.x - A.x) * dx + (p.y - A.y) * dy) / (len * len);
        const perp = Math.abs((p.x - A.x) * (-dy / len) + (p.y - A.y) * (dx / len));
        return t >= -0.01 && t <= 1.01 && perp <= mitad;
      }),
    );
  }

  it("cubre un bloque chico", () => {
    expect(todoCubierto(bloque(6), opts())).toBe(true);
  });

  it("cubre un bloque ancho, donde hacen falta muchas lineas", () => {
    expect(todoCubierto(bloque(40), opts())).toBe(true);
  });

  it("cubre igual volando bajo, que es cuando mas lineas hacen falta", () => {
    expect(todoCubierto(bloque(20), opts({ altitudeM: 15 }))).toBe(true);
  });

  it("cubre igual cruzando las filas en vez de seguirlas", () => {
    expect(todoCubierto(bloque(20), opts({ alongRows: false }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("el numero que decide si el vuelo sirve", () => {
  // De nada sirve que la foto exista si el modulo son cuatro pixeles.
  it("dice cuantos pixeles le tocan a cada modulo", () => {
    const m = planMission(bloque(6), profile, opts({ altitudeM: 40 }))!;
    // 40 m, 61 grados, 640 px -> ~7.4 cm/px; un modulo de 1130 mm son ~15 px.
    expect(m.stats.gsdCm).toBeGreaterThan(6);
    expect(m.stats.gsdCm).toBeLessThan(9);
    expect(m.stats.pixelesPorModulo).toBeGreaterThan(12);
    expect(m.stats.pixelesPorModulo).toBeLessThan(20);
  });

  it("avisa cuando se vuela tan alto que el modulo no se distingue", () => {
    const m = planMission(bloque(6), profile, opts({ altitudeM: 120 }))!;
    expect(m.stats.pixelesPorModulo).toBeLessThan(8);
    expect(m.stats.avisos.join(" ")).toMatch(/pixeles de ancho/);
  });

  it("no avisa de nada cuando el vuelo esta bien planteado", () => {
    const m = planMission(bloque(4), profile, opts({ altitudeM: 30 }))!;
    expect(m.stats.avisos).toEqual([]);
  });

  it("avisa si el solape lateral es tan bajo que el viento deja huecos", () => {
    const m = planMission(bloque(6), profile, opts({ sideOverlap: 0.4 }))!;
    expect(m.stats.avisos.join(" ")).toMatch(/huecos/);
  });

  it("avisa cuando el vuelo no entra en una bateria", () => {
    const m = planMission(bloque(200), profile, opts())!;
    expect(m.stats.avisos.join(" ")).toMatch(/bateria/);
  });
});

// ---------------------------------------------------------------------------

describe("exportacion", () => {
  it("el KML lleva el recorrido y una linea por pasada", () => {
    const m = planMission(bloque(4), profile, opts())!;
    const kml = toKml(m, "Edenvale bloque 5");
    expect(kml).toContain("<kml");
    expect(kml).toContain("Edenvale bloque 5");
    expect((kml.match(/<Placemark>/g) ?? []).length).toBe(m.lines.length + 1);
  });

  it("el CSV manda el gimbal a -90, que es lo unico que sirve para mapear", () => {
    const m = planMission(bloque(4), profile, opts())!;
    const csv = toWaypointCsv(m, opts());
    expect(csv.split("\n")[0]).toContain("gimbal_grados");
    expect(csv.split("\n")[1]).toContain("-90");
    expect(csv.split("\n")).toHaveLength(m.waypoints.length + 1);
  });
});
