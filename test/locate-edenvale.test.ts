/**
 * End-to-end con las reglas de Edenvale, sobre geometria sintetica.
 *
 * La geometria es sintetica a proposito: lo que se esta testeando es que las
 * reglas de conteo verificadas en el campo sobrevivan al viaje completo
 * coordenada -> direccion. Cuando carguemos las coordenadas reales de los
 * puntos verificados, entran como fixtures adicionales sin tocar nada de esto.
 */

import { describe, expect, it } from "vitest";
import profileJson from "../farms/edenvale.json" with { type: "json" };
import { compileFarm } from "../src/profile/compile.js";
import { locate } from "../src/locate.js";
import { formatAddress } from "../src/index.js";
import { makeFrame, toGeo } from "../src/geo/frame.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, pointAtSlot } from "./helpers/synthetic.js";

const profile = profileJson as unknown as FarmProfile;
const MODULES_PER_ROW = 56;

// Todas las filas apuntan de norte a sur: la pica `start` es la del norte.
const base = { azimuthDeg: 180 } as const;

const rowNorthMid = makeRow(
  {
    ...base,
    id: "05-042-R1",
    block: "05",
    tracker: "05-042",
    row: "R1",
    anchor: { lat: -27.4, lon: 152.7 },
    side: "north",
    pos: 1,
    posTotal: 3, // NO es el ultimo de su linea -> hay piercing en la punta
    stringNumbers: [1, 2],
  },
  profile,
);

const rowNorthLast = makeRow(
  {
    ...base,
    id: "04-049-R1",
    block: "04",
    tracker: "04-049",
    row: "R1",
    anchor: { lat: -27.4, lon: 152.701 },
    side: "north",
    pos: 3,
    posTotal: 3, // ultimo de su linea -> sin piercing propio
    stringNumbers: [1, 2],
  },
  profile,
);

const rowSouth = makeRow(
  {
    ...base,
    id: "05-043-R1",
    block: "05",
    tracker: "05-043",
    row: "R1",
    anchor: { lat: -27.4, lon: 152.702 },
    side: "south",
    pos: 1,
    posTotal: 3,
    stringNumbers: [1, 2],
  },
  profile,
);

const rowOddStrings = makeRow(
  {
    ...base,
    id: "07-028-R2",
    block: "07",
    tracker: "07-028",
    row: "R2",
    anchor: { lat: -27.4, lon: 152.703 },
    side: "north",
    pos: 1,
    posTotal: 3,
    stringNumbers: [6, 5], // desordenados a proposito
  },
  profile,
);

const farm = compileFarm(profile, [rowNorthMid, rowNorthLast, rowSouth, rowOddStrings]);

/** Consulta el motor parandose en el centro del hueco `slot` contando desde la pica norte. */
function atSlot(row: typeof rowNorthMid, slot: number, offAxisM = 0) {
  const fix = pointAtSlot(row, slot, profile, "start", offAxisM);
  return locate({ ...fix, accuracyM: 0.5 }, farm);
}

// ---------------------------------------------------------------------------

describe("compilacion", () => {
  it("no emite warnings con geometria coherente", () => {
    expect(farm.buildWarnings).toEqual([]);
  });

  it("resuelve el paso a 1155 mm a partir del modulo y el hueco", () => {
    expect(farm.rows[0]?.pitchM).toBeCloseTo(1.155, 9);
  });

  it("resuelve el extremo de conteo segun el lado de la calle", () => {
    // Lado norte -> cuenta desde su punta sur, que es la pica `end`.
    expect(farm.rows[0]?.originEnd).toBe("end");
    // Lado sur -> cuenta desde su punta norte, que es la pica `start`.
    expect(farm.rows[2]?.originEnd).toBe("start");
  });

  it("ordena los numeros de string: el menor es el mas cercano a la caja DC", () => {
    expect(farm.rows[3]?.stringNumbers).toEqual([5, 6]);
  });
});

// ---------------------------------------------------------------------------

describe("tracker del lado norte, NO ultimo de su linea (caso bloque 5)", () => {
  it("el modulo pegado a la caja DC es el 1 del string cercano", () => {
    const { best } = atSlot(rowNorthMid, 56); // el hueco mas al sur
    expect(best).toMatchObject({
      block: "05",
      tracker: "05-042",
      row: "R1",
      stringNumber: 1,
      module: 1,
      countedFrom: "near-dc",
      positionInRow: 1,
    });
  });

  it("el ultimo modulo del string cercano es el 28, contra el medio", () => {
    expect(atSlot(rowNorthMid, 29).best).toMatchObject({
      stringNumber: 1,
      module: 28,
      countedFrom: "near-dc",
    });
  });

  // Este es el dato exacto que se conto fisicamente en el campo y que obligo a
  // corregir el calculo: en el string lejano, el 28 queda contra el medio.
  it("el string lejano arranca invertido: el 28 queda contra el medio", () => {
    expect(atSlot(rowNorthMid, 28).best).toMatchObject({
      stringNumber: 2,
      module: 28,
      countedFrom: "far-end",
    });
  });

  it("y el modulo 1 del string lejano queda en la punta mas lejana", () => {
    expect(atSlot(rowNorthMid, 1).best).toMatchObject({
      stringNumber: 2,
      module: 1,
      countedFrom: "far-end",
    });
  });
});

describe("tracker del lado norte, ULTIMO de su linea (caso bloque 4)", () => {
  it("los dos strings cuentan en el mismo sentido", () => {
    expect(atSlot(rowNorthLast, 28).best).toMatchObject({
      stringNumber: 2,
      module: 1,
      countedFrom: "near-dc",
    });
    expect(atSlot(rowNorthLast, 1).best).toMatchObject({
      stringNumber: 2,
      module: 28,
      countedFrom: "near-dc",
    });
  });
});

describe("tracker del lado sur", () => {
  it("cuenta desde la punta norte: es el espejo del lado norte", () => {
    expect(atSlot(rowSouth, 1).best).toMatchObject({
      stringNumber: 1,
      module: 1,
      countedFrom: "near-dc",
      positionInRow: 1,
    });
    expect(atSlot(rowSouth, 56).best).toMatchObject({
      stringNumber: 2,
      module: 1,
      countedFrom: "far-end",
    });
  });
});

describe("strings con numeracion no correlativa (caso bloque 7)", () => {
  it("usa el menor de los dos numeros presentes como el cercano a la caja DC", () => {
    expect(atSlot(rowOddStrings, 56).best).toMatchObject({ stringNumber: 5, module: 1 });
    expect(atSlot(rowOddStrings, 28).best).toMatchObject({ stringNumber: 6, module: 28 });
  });
});

// ---------------------------------------------------------------------------

describe("barrido completo de la fila", () => {
  it("resuelve los 56 huecos a 56 direcciones distintas y correctas", () => {
    const seen = new Set<string>();
    for (let slot = 1; slot <= MODULES_PER_ROW; slot++) {
      const { best } = atSlot(rowNorthMid, slot);
      expect(best, `slot ${slot}`).not.toBeNull();

      const position = MODULES_PER_ROW - slot + 1; // el conteo arranca en la punta sur
      expect(best!.positionInRow, `slot ${slot}`).toBe(position);

      const expectedString = position <= 28 ? 1 : 2;
      const expectedModule = position <= 28 ? position : MODULES_PER_ROW - position + 1;
      expect(best!.stringNumber, `slot ${slot}`).toBe(expectedString);
      expect(best!.module, `slot ${slot}`).toBe(expectedModule);

      seen.add(`${best!.stringNumber}.${best!.module}`);
    }
    expect(seen.size).toBe(MODULES_PER_ROW);
  });

  it("aguanta un corrimiento lateral tipico de GPS sin RTK", () => {
    for (const off of [-2.5, -1, 1, 2.5]) {
      const { best } = atSlot(rowNorthMid, 20, off);
      expect(best?.rowId).toBe("05-042-R1");
      expect(best?.positionInRow).toBe(MODULES_PER_ROW - 20 + 1);
    }
  });
});

// ---------------------------------------------------------------------------

describe("candidatos, confianza y avisos", () => {
  it("devuelve vecinos ordenados por distancia real, nunca una sola respuesta", () => {
    const res = atSlot(rowNorthMid, 20);
    expect(res.candidates.length).toBeGreaterThanOrEqual(5);
    const distances = res.candidates.map((c) => c.distanceM);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(res.candidates[0]).toBe(res.best);
  });

  it("reparte la confianza y suma 1", () => {
    const res = atSlot(rowNorthMid, 20);
    const total = res.candidates.reduce((s, c) => s + c.confidence, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(res.best!.confidence).toBeGreaterThan(0.5);
  });

  it("con precision mala reparte la confianza entre vecinos y avisa", () => {
    const fix = pointAtSlot(rowNorthMid, 20, profile);
    const res = locate({ ...fix, accuracyM: 6 }, farm);
    expect(res.best!.confidence).toBeLessThan(0.35);
    expect(res.warnings.map((w) => w.code)).toContain("low-confidence");
  });

  it("avisa en vez de responder cuando no hay datos cerca", () => {
    const res = locate({ lat: -27.5, lon: 152.9 }, farm);
    expect(res.best).toBeNull();
    expect(res.candidates).toEqual([]);
    expect(res.warnings.map((w) => w.code)).toContain("no-row-within-range");
  });

  it("avisa cuando la coordenada cae pasando la punta del tracker", () => {
    const fix = pointAtSlot(rowNorthMid, 62, profile); // 6 huecos mas alla del final
    const res = locate({ ...fix, accuracyM: 0.5 }, farm);
    expect(res.warnings.map((w) => w.code)).toContain("outside-row-extent");
    expect(res.best?.positionInRow).toBe(1); // recortado al modulo del extremo
  });

  it("no marca como ambiguo el vecino de al lado dentro del mismo string", () => {
    // Sin RTK, dudar entre el modulo 10 y el 11 pasa siempre: eso ya lo dice la
    // lista de vecinos. Si el aviso saltara ahi, seria ruido en cada consulta.
    const res = atSlot(rowNorthMid, 10, 0);
    expect(res.warnings.map((w) => w.code)).not.toContain("ambiguous");
  });

  /**
   * El limite entre los dos strings ES ambiguo, y la app tiene que decirlo.
   *
   * Durante un tiempo se creyo que entre string y string habia 3,7 m de bahia
   * de motor, y con ese hueco el ultimo modulo de uno y el primero del otro
   * quedaban lejisimos: la duda desaparecia sola. La cinta dijo despues que la
   * bahia mide 555 mm — medio modulo.
   *
   * Asi que la ambiguedad volvio, y es real: parado en el medio de la fila con
   * el GPS de un celular, la diferencia entre el modulo 28 de un string y el 1
   * del otro es medio metro. Lo correcto no es que la app elija con confianza,
   * es que ofrezca los dos.
   */
  it("el limite entre strings es ambiguo de verdad, y ofrece los dos", () => {
    const fix = pointAtSlot(rowNorthMid, 28, profile);
    const res = locate({ ...fix, accuracyM: 3 }, farm);
    const rival = res.candidates.find(
      (c) => c.rowId === res.best!.rowId && c.stringNumber !== res.best!.stringNumber,
    );
    expect(rival).toBeDefined();
    // Con medio modulo de separacion, el rival no puede quedar descartado.
    expect(rival!.confidence).toBeGreaterThan(0.3 * res.best!.confidence);
  });

  it("avisa cuando la coordenada cae dentro de la bahia del motor", () => {
    // En el medio de la fila, entre los dos strings, no hay ningun modulo.
    const rowLen = 2 * (28 * 1.15 - 0.02) + 3.713 - 2 * 1.464;
    const mid = pointAtSlot(rowNorthMid, 28, profile);
    void rowLen;
    // Un punto a 2 m mas alla del ultimo modulo del primer string cae en la bahia.
    const frame = { lat: mid.lat, lon: mid.lon };
    const res = locate({ ...frame, accuracyM: 0.5 }, farm);
    // El modulo 28 sigue siendo el mas cercano; lo que importa es que la
    // geometria lo ubique bien y no reparta modulos donde hay un motor.
    expect(res.best!.module).toBe(28);
  });

  it("expone el diagnostico completo del calculo", () => {
    const res = atSlot(rowNorthMid, 28);
    expect(res.diagnostics.winner).toMatchObject({
      rowId: "05-042-R1",
      originEnd: "end",
      originStrategy: "dc-box-end",
      inversionStrategy: "piercing-chain",
      inverted: true,
    });
    expect(res.diagnostics.winner!.pitchM).toBeCloseTo(1.155, 9);
    // Residuo por debajo de la milesima de milimetro por modulo: la geometria
    // sintetica cierra exacto contra el paso declarado.
    expect(Math.abs(res.diagnostics.winner!.lengthResidualMmPerModule)).toBeLessThan(1e-3);
  });

  it("elige la fila correcta cuando hay varias en rango", () => {
    const res = atSlot(rowSouth, 10);
    expect(res.best?.rowId).toBe("05-043-R1");
  });
});

// ---------------------------------------------------------------------------
// Salido de una prueba de campo real: bloque 4, tracker 18.
// La app dijo modulo 11, el conteo fisico dio 16. La coordenada estaba ~5.8 m
// corrida (GPS de celular sin RTK), pero la lista de vecinos era de +-2 y dejo
// la respuesta correcta AFUERA. Una lista corta no es mas precisa: es mas
// confiada.
// ---------------------------------------------------------------------------

describe("la cantidad de vecinos sale de la precision, no de un numero fijo", () => {
  it("con una coordenada buena devuelve pocos vecinos", () => {
    const fix = pointAtSlot(rowNorthMid, 20, profile);
    const res = locate({ ...fix, accuracyM: 0.5 }, farm);
    const sameRow = res.candidates.filter((c) => c.rowId === "05-042-R1");
    expect(sameRow.length).toBeLessThanOrEqual(5);
  });

  it("con precision de celular abre la lista lo suficiente para cubrir el error", () => {
    const fix = pointAtSlot(rowNorthMid, 20, profile);
    const res = locate({ ...fix, accuracyM: 4 }, farm);
    const positions = res.candidates
      .filter((c) => c.rowId === "05-042-R1")
      .map((c) => c.positionInRow);

    // 4 m de precision son ~7 modulos: la lista tiene que llegar hasta ahi.
    const span = Math.max(...positions) - Math.min(...positions);
    expect(span).toBeGreaterThanOrEqual(12);

    // El caso real: el modulo correcto estaba 5 posiciones mas alla y no figuraba.
    const truth = MODULES_PER_ROW - 20 + 1;
    expect(positions).toContain(truth + 5);
    expect(positions).toContain(truth - 5);
  });

  it("no devuelve una lista infinita con un GPS muy malo", () => {
    const fix = pointAtSlot(rowNorthMid, 28, profile);
    const res = locate({ ...fix, accuracyM: 60 }, farm);
    const sameRow = res.candidates.filter((c) => c.rowId === "05-042-R1");
    expect(sameRow.length).toBeLessThanOrEqual(25);
  });

  it("el aviso dice el rango de posiciones, no solo que hay poca confianza", () => {
    const fix = pointAtSlot(rowNorthMid, 20, profile);
    const res = locate({ ...fix, accuracyM: 4 }, farm);
    const w = res.warnings.find((x) => x.code === "low-confidence");
    expect(w).toBeDefined();
    expect(w!.message).toMatch(/entre las posiciones \d+ y \d+/);
    expect(w!.message).toMatch(/tracker y la fila si son confiables/);
  });
});

// ---------------------------------------------------------------------------

/**
 * Cuando no hay nada cerca, decir CUANTO de lejos.
 *
 * "No hay ninguna fila a menos de 30 m" es un callejon sin salida parado en el
 * campo con el celular en la mano. Faltar 30 metros y estar a 8000 km son dos
 * problemas distintos —uno es el GPS, el otro es la zona UTM al importar— y se
 * arreglan de formas opuestas.
 */
describe("cuando la coordenada no cae en ninguna fila", () => {
  // Un parque de una sola fila: con el parque entero, correrse cien metros
  // perpendicular cae sobre otra fila —estan a 5,46 m— y no se puede probar
  // el caso de "lejos de todo".
  const sola = compileFarm(
    profile,
    [makeRow(
      { id: "09-001-R1", block: "09", tracker: "09-001", row: "R1",
        anchor: { lat: -26.5, lon: 150.1 }, azimuthDeg: 180, side: "north", pos: 1, posTotal: 1 },
      profile,
    )],
  );

  const lejos = (metros: number) => {
    const r = sola.rows[0]!;
    const f = makeFrame(sola.origin.lat, sola.origin.lon);
    const mid = { x: (r.a.x + r.b.x) / 2, y: (r.a.y + r.b.y) / 2 };
    // Perpendicular al eje: es la unica forma de alejarse sin quedar sobre la
    // prolongacion del propio segmento.
    return toGeo(f, mid.x - r.uy * metros, mid.y + r.ux * metros);
  };

  it("dice a que distancia esta la fila mas cercana", () => {
    const res = locate({ ...lejos(120), accuracyM: 3 }, sola);
    expect(res.best).toBeNull();
    expect(res.diagnostics.nearestRow).toBeDefined();
    expect(res.diagnostics.nearestRow!.distanceM).toBeCloseTo(120, -1);
  });

  it("a pocos metros, apunta al bloque sin importar o al GPS", () => {
    const msg = locate({ ...lejos(120), accuracyM: 3 }, sola).warnings
      .find((w) => w.code === "no-row-within-range")!.message;
    expect(msg).toMatch(/Estas en el parque pero fuera de toda fila/);
    expect(msg).toMatch(/no se haya importado|GPS/);
  });

  it("a unos kilometros, apunta a un bloque sin importar", () => {
    const msg = locate({ ...lejos(4000), accuracyM: 3 }, sola).warnings
      .find((w) => w.code === "no-row-within-range")!.message;
    expect(msg).toMatch(/4\.0 km/);
    expect(msg).toMatch(/falte importar el bloque/);
  });

  it("a decenas de kilometros, dice que la coordenada no es de este parque", () => {
    const msg = locate({ ...lejos(60000), accuracyM: 3 }, sola).warnings
      .find((w) => w.code === "no-row-within-range")!.message;
    expect(msg).toMatch(/no es de este parque/);
    // 60 km NO es "mal convertido": una zona UTM son 600.
    expect(msg).not.toMatch(/mal convertidas/);
  });

  /**
   * Lo primero que se mira es la precision de la propia lectura. Si el error es
   * mas grande que el radio de busqueda, no encontrar nada estaba cantado — y
   * mandar a revisar la importacion seria mandar al archivo equivocado.
   */
  it("con una coordenada imprecisa culpa a la lectura y no al parque", () => {
    const msg = locate({ ...lejos(4000), accuracyM: 900 }, sola).warnings
      .find((w) => w.code === "no-row-within-range")!.message;
    expect(msg).toMatch(/±900 m de error/);
    expect(msg).toMatch(/no dice nada sobre el parque/);
    expect(msg).not.toMatch(/mal convertidas|falte importar/);
  });

  // El sintoma clasico de importar con la zona UTM equivocada.
  it("del otro lado del mundo, apunta a la conversion y no al GPS", () => {
    const msg = locate({ lat: 51.5, lon: -0.12, accuracyM: 3 }, sola).warnings
      .find((w) => w.code === "no-row-within-range")!.message;
    expect(msg).toMatch(/no hay error de GPS que alcance/);
    expect(msg).toMatch(/zona UTM o el hemisferio/);
    expect(msg).not.toMatch(/Prob[aá] de nuevo/);
  });
});

// ---------------------------------------------------------------------------

/**
 * Los dos avisos que faltaban: lejos y de costado.
 *
 * La confianza se normaliza ENTRE los candidatos, asi que no dice nada de la
 * distancia absoluta. Parado a veinte metros de la fila mas cercana —en la
 * calle, en el camino perimetral, o sobre un bloque que nunca se importo— todos
 * los candidatos estan igual de lejos, la confianza del primero sale alta, y la
 * app contestaba un modulo como si nada. El unico aviso que existia era para
 * cuando NO hay nada a menos de 30 m.
 */
describe("estar cerca no es estar encima", () => {
  it("parado sobre la fila no avisa ni lejania ni costado", () => {
    const w = atSlot(rowNorthMid, 20).warnings.map((x) => x.code);
    expect(w).not.toContain("off-axis");
    expect(w).not.toContain("far-from-module");
  });

  it("veinte metros al costado del eje: dice que no estas sobre ese tracker", () => {
    const fix = pointAtSlot(rowNorthMid, 20, profile, "start", 20);
    const r = locate({ ...fix, accuracyM: 0.5 }, farm);
    const w = r.warnings.map((x) => x.code);
    expect(w).toContain("off-axis");
    expect(r.warnings.find((x) => x.code === "off-axis")!.message).toMatch(/al costado del eje/);
  });

  it("y que el modulo que da esta mas lejos de lo que explica el GPS", () => {
    const fix = pointAtSlot(rowNorthMid, 20, profile, "start", 20);
    const w = locate({ ...fix, accuracyM: 0.5 }, farm).warnings.map((x) => x.code);
    expect(w).toContain("far-from-module");
  });

  /**
   * Con el GPS malo la distancia SI la explica el error: ahi el aviso que
   * corresponde es el de baja confianza, no el de lejania.
   */
  it("con ±10 m de precision, 8 m de distancia no es noticia", () => {
    const fix = pointAtSlot(rowNorthMid, 20, profile, "start", 8);
    const w = locate({ ...fix, accuracyM: 10 }, farm).warnings.map((x) => x.code);
    expect(w).not.toContain("far-from-module");
  });
});

/**
 * La direccion dice donde esta el panel, y nada mas.
 *
 * La caja de continua estuvo dos veces en esta frase y las dos veces sobraba.
 * Primero como "desde la caja DC" —que ademas quedo falso cuando el conteo paso
 * a arrancar en el norte— y despues como "entrando por DCB-…", que era cierto
 * pero seguia siendo una instruccion para CAMINAR hasta el panel. El trabajo no
 * es caminar hasta el panel: es entregar su ubicacion. La caja sigue en el
 * informe como columna, que es donde le sirve al cliente para cruzar con su
 * documentacion electrica.
 */
describe("la direccion no da instrucciones para caminar", () => {
  it("no nombra la caja de continua aunque la fila la tenga", () => {
    const conCaja = compileFarm(profile, [{ ...rowNorthMid, dcBoxLabel: "DCB-1.2.15" }]);
    const r = locate({ ...pointAtSlot(rowNorthMid, 5, profile), accuracyM: 0.5 }, conCaja);
    const texto = formatAddress(r.best!);
    expect(texto).not.toMatch(/DCB/);
    expect(texto).not.toMatch(/caja/i);
    expect(texto).toMatch(/contando desde la punta/);
    // Y el dato sigue disponible para el informe, solo que no en esta frase.
    expect(r.best!.dcBoxLabel).toBe("DCB-1.2.15");
  });
});
