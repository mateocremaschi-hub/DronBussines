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
  planByBlock,
  planMission,
  toKml,
  toWaypointCsv,
  type MissionOptions,
} from "../app/mission";
import { makeFrame, toLocal } from "../src/index.js";
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const termica = CAMARAS[0]!; // Mavic 3T termica: 40 mm eq -> HFOV 45.8
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
  // De nada sirve que la foto exista si la celda son dos pixeles.
  it("dice cuantos pixeles le tocan a cada modulo", () => {
    // Con la termica real del M3T (HFOV 45.8, medida contra fotos de Edenvale)
    // a 40 m: huella de 33.8 m sobre 640 px son 5.3 cm/px.
    const m = planMission(bloque(6), profile, opts({ altitudeM: 40 }))!;
    expect(m.stats.gsdCm).toBeGreaterThan(4.5);
    expect(m.stats.gsdCm).toBeLessThan(6);
    expect(m.stats.pixelesPorModulo).toBeGreaterThan(18);
    expect(m.stats.pixelesPorModulo).toBeLessThan(26);
  });

  // El caso que el limite viejo dejaba pasar. Son los numeros REALES del vuelo
  // que ya se hizo en Edenvale: 113 m de altura, 14.9 cm por pixel. Cada modulo
  // sale en 8 pixeles y parece razonable, pero la celda —que es donde nace el
  // punto caliente— queda en uno solo.
  it("avisa cuando la celda deja de resolverse, aunque el modulo parezca bien", () => {
    const m = planMission(bloque(6), profile, opts({ altitudeM: 113 }))!;
    expect(m.stats.pixelesPorModulo).toBeGreaterThan(7);
    expect(m.stats.gsdCm).toBeCloseTo(14.9, 0);
    expect(16 / m.stats.gsdCm).toBeLessThan(1.5); // la celda, en pixeles
    expect(m.stats.avisos.join(" ")).toMatch(/celda de 16 cm/);
  });

  it("el aviso dice a que altura hay que bajar", () => {
    const m = planMission(bloque(6), profile, opts({ altitudeM: 113 }))!;
    const alt = Number(m.stats.avisos.join(" ").match(/Bajá a (\d+) m/)?.[1]);
    expect(alt).toBeGreaterThan(30);
    expect(alt).toBeLessThan(120);
    // Y un metro por debajo de esa altura ya no avisa.
    expect(planMission(bloque(6), profile, opts({ altitudeM: alt - 1 }))!.stats.avisos
      .join(" ")).not.toMatch(/celda/);
  });

  it("no avisa de nada cuando el vuelo esta bien planteado", () => {
    const m = planMission(bloque(4), profile, opts({ altitudeM: 25 }))!;
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

// ---------------------------------------------------------------------------
// Por bloque
//
// Edenvale entero da 23 horas de vuelo. No es un error del calculo: la
// empresa que lo hizo tardo cuatro dias. Lo que hace manejable el trabajo no
// es volar mas rapido sino partirlo por la unidad en la que ya piensa la
// planta.
// ---------------------------------------------------------------------------

describe("plan por bloque", () => {
  /** Filas repartidas en `b` bloques de `n` filas cada uno, separados 300 m. */
  function parque(b: number, n: number): TrackerRow[] {
    const out: TrackerRow[] = [];
    const mPerLon = 111320 * Math.cos((-27.4 * Math.PI) / 180);
    for (let k = 0; k < b; k++) {
      for (let i = 0; i < n; i++) {
        out.push(
          makeRow(
            {
              id: `${k}-${i}`, block: String(k + 1).padStart(2, "0"), tracker: `t${i}`,
              anchor: { lat: -27.4, lon: 152.7 + (k * 300 + i * 6) / mPerLon },
              azimuthDeg: 180,
            },
            profile,
          ),
        );
      }
    }
    return out;
  }

  it("hace una mision por bloque y las ordena", () => {
    const { bloques } = planByBlock(parque(4, 10), profile, opts());
    expect(bloques.map((b) => b.block)).toEqual(["01", "02", "03", "04"]);
    expect(bloques.every((b) => b.filas === 10)).toBe(true);
  });

  // El valor de partirlo: cada bloque entra en una o dos baterias.
  it("cada bloque queda en un vuelo manejable", () => {
    const { bloques } = planByBlock(parque(6, 12), profile, opts());
    for (const b of bloques) {
      expect(b.mission.stats.minutos).toBeLessThan(30);
      expect(b.baterias).toBeLessThanOrEqual(2);
    }
  });

  it("partirlo NO alarga el trabajo: sale parecido al vuelo entero", () => {
    const rows = parque(4, 10);
    const entero = planMission(rows, profile, opts())!;
    const { totalMinutos } = planByBlock(rows, profile, opts());
    // Por bloque se vuela menos, porque no se cruza el campo vacio de punta a punta.
    expect(totalMinutos).toBeLessThan(entero.stats.minutos);
  });

  it("cuenta baterias y salidas de campo con las que uno tiene", () => {
    const p = planByBlock(parque(8, 12), profile, opts(), 4);
    expect(p.totalBaterias).toBeGreaterThanOrEqual(p.bloques.length);
    expect(p.salidas).toBe(Math.ceil(p.totalBaterias / 4));
    // Con mas baterias, menos viajes.
    expect(planByBlock(parque(8, 12), profile, opts(), 8).salidas).toBeLessThan(p.salidas);
  });

  it("un parque sin bloques cargados no rompe nada", () => {
    const p = planByBlock([], profile, opts());
    expect(p.bloques).toEqual([]);
    expect(p.totalMinutos).toBe(0);
  });
});
