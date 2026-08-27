/**
 * Deduccion del lado de la calle a partir de la geometria.
 *
 * Existe porque el Excel de picas de Edenvale no trae la columna LADO, y sin
 * ella la estrategia de conteo desde la caja DC elige una punta al azar: le
 * pega en la mitad de los trackers y sale espejada en la otra mitad. Eso se
 * confirmo en el campo.
 *
 * La regla se puede verificar sola, que es lo que la hace usable: dentro de un
 * lado los centros de fila difieren unos metros, y entre lados difieren mas de
 * medio largo de fila. Si un bloque no se parte limpio, lo dice.
 */

import { describe, expect, it } from "vitest";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import { deriveSides } from "../app/ingest";
import { makeFrame, toGeo } from "../src/geo/frame.js";
import type { FarmProfile, TrackerRow } from "../src/types.js";
import { makeRow, nominalLengthM } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const LEN = nominalLengthM(profile); // 65.145 m
const M_PER_DEG_LAT = 110946;
const ROAD = 8;

/** Un bloque con `n` filas a cada lado de una calle central. */
function twoSidedBlock(block: string, n: number): TrackerRow[] {
  const rows: TrackerRow[] = [];
  for (const side of ["north", "south"] as const) {
    for (let i = 0; i < n; i++) {
      // Las del norte arrancan arriba; las del sur, del otro lado de la calle.
      const topOffset = side === "north" ? 0 : -(LEN + ROAD);
      rows.push(
        makeRow(
          {
            id: `${block}-${side}-${i}`,
            block,
            tracker: `${block}-${side}-${i}`,
            anchor: { lat: -27.4 + topOffset / M_PER_DEG_LAT, lon: 152.7 + i * 0.00006 },
            azimuthDeg: 180,
          },
          profile,
        ),
      );
    }
  }
  return rows;
}

describe("deriveSides", () => {
  it("parte un bloque en sus dos lados de la calle", () => {
    const rows = twoSidedBlock("04", 6);
    const { sides, blocks } = deriveSides(rows);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe("dos-lados");
    expect(blocks[0]!.detail).toMatch(/6 filas al norte y 6 al sur/);

    for (const r of rows) {
      expect(sides.get(r.id), r.id).toBe(r.id.includes("north") ? "north" : "south");
    }
  });

  it("no depende del orden en que vinieron las picas en el Excel", () => {
    const rows = twoSidedBlock("04", 4).map((r, i) =>
      // A la mitad de las filas se le dan vuelta las picas, como pasa de verdad.
      i % 2 === 0 ? r : { ...r, start: r.end, end: r.start },
    );
    const { sides } = deriveSides(rows);
    for (const r of rows) {
      expect(sides.get(r.id), r.id).toBe(r.id.includes("north") ? "north" : "south");
    }
  });

  // Lo importante no es que acierte siempre: es que avise cuando no puede.
  it("no le inventa lado a un bloque de un solo lado", () => {
    const rows = twoSidedBlock("07", 5).filter((r) => r.id.includes("north"));
    const { sides, blocks } = deriveSides(rows);

    expect(blocks[0]!.status).toBe("un-solo-lado");
    expect(blocks[0]!.detail).toMatch(/No le asigno lado/);
    for (const r of rows) expect(sides.has(r.id)).toBe(false);
  });

  it("resuelve cada bloque por separado", () => {
    const rows = [...twoSidedBlock("04", 3), ...twoSidedBlock("05", 4)];
    const { blocks } = deriveSides(rows);
    expect(blocks.map((b) => b.block)).toEqual(["04", "05"]);
    expect(blocks.every((b) => b.status === "dos-lados")).toBe(true);
    expect(blocks[1]!.detail).toMatch(/4 filas al norte y 4 al sur/);
  });

  it("no dice nada de un bloque con una sola fila", () => {
    const { blocks } = deriveSides([twoSidedBlock("09", 1)[0]!]);
    expect(blocks[0]!.status).toBe("ambiguo");
  });

  // La prueba de que sirve para lo que se construyo: con el lado puesto, la
  // estrategia dc-box-end deja de elegir una punta al azar.
  it("con el lado deducido, las dos mitades cuentan desde puntas opuestas", async () => {
    const { compileFarm } = await import("../src/profile/compile.js");
    const rows = twoSidedBlock("04", 3);
    const { sides } = deriveSides(rows);
    const conLado = rows.map((r) => ({ ...r, side: sides.get(r.id) }));

    const farm = compileFarm(profile, conLado);
    const norte = farm.rows.filter((r) => r.source.side === "north");
    const sur = farm.rows.filter((r) => r.source.side === "south");

    // Las picas se generaron todas de norte a sur, asi que los dos lados tienen
    // que resolver extremos de conteo opuestos.
    expect(norte.every((r) => r.originEnd === "end")).toBe(true);
    expect(sur.every((r) => r.originEnd === "start")).toBe(true);

    // Ya no queda ningun aviso de lado faltante. El de la posicion en la linea
    // sigue: ese dato es electrico y no se puede sacar de la geometria.
    const codes = farm.rows.flatMap((r) => r.strategyWarnings.map((w) => w.code));
    expect(codes).not.toContain("missing-side");
    expect(codes).toContain("missing-chain-position");
  });
});

// ---------------------------------------------------------------------------
// El caso que aparece cuando los datos llegan en dos archivos.
// ---------------------------------------------------------------------------

describe("un bloque partido entre dos archivos", () => {
  /** Bloque con `n` filas de cada lado de la calle, pero repartido en dos mitades. */
  function partido(block: string, n: number) {
    const todas: TrackerRow[] = [];
    for (const side of ["north", "south"] as const) {
      for (let i = 0; i < n; i++) {
        const topOffset = side === "north" ? 0 : -(LEN + ROAD);
        todas.push(
          makeRow(
            {
              id: `${block}-${side}-${i}`, block, tracker: `${block}-${side}-${i}`,
              anchor: { lat: -27.4 + topOffset / M_PER_DEG_LAT, lon: 152.7 + i * 0.00006 },
              azimuthDeg: 180,
            },
            profile,
          ),
        );
      }
    }
    // El primer archivo trae solo el lado norte; el segundo, solo el sur.
    return {
      archivo1: todas.filter((r) => r.id.includes("north")),
      archivo2: todas.filter((r) => r.id.includes("south")),
      todas,
    };
  }

  // Esta es la trampa: media calle no se parece a una calle. Deduciendo sobre
  // el archivo suelto, cada mitad se ve como un bloque de un solo lado.
  it("cada archivo por separado no alcanza para deducir el lado", () => {
    const { archivo1, archivo2 } = partido("04", 5);
    expect(deriveSides(archivo1).blocks[0]!.status).toBe("un-solo-lado");
    expect(deriveSides(archivo2).blocks[0]!.status).toBe("un-solo-lado");
  });

  it("fusionados primero, el bloque se parte bien", () => {
    const { todas } = partido("04", 5);
    const { sides, blocks } = deriveSides(todas);
    expect(blocks[0]!.status).toBe("dos-lados");
    for (const r of todas) {
      expect(sides.get(r.id), r.id).toBe(r.id.includes("north") ? "north" : "south");
    }
  });
});

// ---------------------------------------------------------------------------
// El caso real del bloque 6 de Edenvale.
//
// La app dijo "156 filas al norte y 30 al sur, separadas por 47 m de calle" y
// Mateo confirmo en el campo que estan TODAS del mismo lado. La aritmetica lo
// desmiente sola: dos filas de 65 m enfrentadas tienen los centros a mas de
// 65 m aunque la calle mida cero, asi que 47 m no puede ser una calle. Los dos
// grupos se solapan 18 m a lo largo — estan corridos, no enfrentados.
//
// El umbral viejo pedia medio largo de fila (32 m) y dejaba pasar esto. Darle
// lados opuestos a esos 30 trackers habria invertido su conteo entero.
// ---------------------------------------------------------------------------

describe("dos grupos del mismo lado, corridos entre si", () => {
  /** `n` filas en una franja, `m` filas corridas `desplazamiento` metros. */
  function escalonado(block: string, n: number, m: number, desplazamiento: number): TrackerRow[] {
    const rows: TrackerRow[] = [];
    const push = (i: number, offsetM: number, tag: string) =>
      rows.push(
        makeRow(
          {
            id: `${block}-${tag}-${i}`, block, tracker: `${block}-${tag}-${i}`,
            anchor: { lat: -27.4 + offsetM / M_PER_DEG_LAT, lon: 152.7 + i * 0.00006 },
            azimuthDeg: 180,
          },
          profile,
        ),
      );
    for (let i = 0; i < n; i++) push(i, 0, "a");
    for (let i = 0; i < m; i++) push(i, -desplazamiento, "b");
    return rows;
  }

  it("no los parte en dos lados: 47 m es menos de lo que ocupan las filas solas", () => {
    const { sides, blocks } = deriveSides(escalonado("06", 156, 30, 47));
    expect(blocks[0]!.status).toBe("escalonado");
    expect(sides.size).toBe(0); // ni un solo lado asignado
  });

  it("explica la contradiccion con los numeros a la vista", () => {
    const { blocks } = deriveSides(escalonado("06", 156, 30, 47));
    expect(blocks[0]!.detail).toContain("47 m");
    expect(blocks[0]!.detail).toContain("se solapan");
    expect(blocks[0]!.detail).toMatch(/invertiria el conteo/);
  });

  // El limite: apenas la separacion alcanza para que las filas no se solapen,
  // ya puede haber una calle, y entonces si se parte.
  it("con una calle de verdad sigue partiendo bien", () => {
    const { sides, blocks } = deriveSides(escalonado("06", 156, 30, LEN + 8));
    expect(blocks[0]!.status).toBe("dos-lados");
    expect(sides.size).toBe(186);
  });
});

// ---------------------------------------------------------------------------

describe("parques con las filas corriendo este-oeste", () => {
  /**
   * El signo del eje medio se normalizaba SIEMPRE por la componente norte-sur.
   * Con las filas corriendo este-oeste esa componente es casi cero, asi que el
   * sentido de cada fila lo decidian milimetros de ruido del relevamiento: unas
   * apuntaban a un lado y otras al opuesto, se cancelaban, y el eje salia de
   * cualquier lado. Y encima los dos lados se llamaban norte y sur, que en un
   * parque asi es directamente falso: la estrategia `dc-box-end` busca "el
   * extremo que apunta al norte" de una fila cuyas dos puntas estan a la misma
   * latitud, y lo elige por ruido.
   */
  const frame = makeFrame(-27.4, 152.7);
  /** Una fila que corre este-oeste: 65 m de largo sobre el eje X. */
  const filaEO = (id: string, yM: number, xDesde: number, alReves: boolean) => {
    // Ruido de relevamiento: unos milimetros de desnivel norte-sur en una fila
    // que corre este-oeste. Es lo que decidia el signo del eje medio cuando se
    // normalizaba siempre por la componente norte-sur, y por eso las filas se
    // cancelaban entre si.
    const ruido = ((Number(id.split("-")[1]) % 2) === 0 ? 1 : -1) * 0.004;
    const a = toGeo(frame, xDesde, yM);
    const b = toGeo(frame, xDesde + 65, yM + ruido);
    return {
      id, block: "01", tracker: id,
      start: alReves ? b : a,
      end: alReves ? a : b,
    };
  };

  // Dos alas de filas este-oeste enfrentadas a los lados de una calle que corre
  // norte-sur: las filas del oeste terminan en x = -8 y las del este arrancan
  // en x = +8. La mitad viene con las picas cargadas al reves, como en un Excel
  // real, que es justo lo que hacia que el eje medio se cancelara solo.
  const filas = [
    ...Array.from({ length: 6 }, (_, i) => filaEO(`e-${i}`, i * 7, 8, i % 2 === 0)),
    ...Array.from({ length: 6 }, (_, i) => filaEO(`o-${i}`, i * 7, -73, i % 3 === 0)),
  ];

  it("los llama este y oeste, no norte y sur", () => {
    const d = deriveSides(filas);
    const lados = new Set([...d.sides.values()]);
    expect(lados.size).toBe(2);
    expect(lados).toEqual(new Set(["east", "west"]));
  });

  it("y lo dice en el informe del bloque", () => {
    const d = deriveSides(filas);
    expect(d.blocks[0]!.detail).toMatch(/corren este-oeste/);
  });

  it("las picas al reves no desarman el agrupamiento", () => {
    const d = deriveSides(filas);
    expect(d.sides.size).toBe(12);
  });
});
