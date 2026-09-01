/**
 * El sentido de conteo medido contra la caja dibujada.
 *
 * Lo que se prueba aca es la diferencia entre "el plano dice donde estan las
 * calles" y "el plano dice donde esta la caja". Con lo primero, un bloque que
 * marca dos calles internas queda sin resolver: la app no sabe cual de las dos
 * lleva las cajas. Con lo segundo la pregunta desaparece, porque la caja tiene
 * coordenada propia.
 *
 * En Wellington North esos eran 18 bloques de 52, 5340 filas de 13606.
 */

import { describe, expect, it } from "vitest";
import type { TrackerRow } from "../src/types.js";
import { acordar, sentidoDesdeLasCajas, type BloqueConCajas } from "../app/cajas";
import { aplicarPlano, type PlanoDeParque } from "../app/plans";

/*
  Un bloque de cuatro bancos con DOS calles internas — la forma que no se podia
  resolver. Medidas realistas: tracker de 65 m, bancos cada 80 m, trackers cada
  6 m. La lamina esta a 0,2 m por unidad.

      banco A   cy  200   caja afuera, al sur      (y   20)
      ---- calle 1 (cy 800) ----
      banco B   cy  600   caja en la calle 1       (y  800)
      banco C   cy 1000   caja en la calle 1       (y  800)
      ---- calle 2 ----
      banco D   cy 1400   caja afuera, al norte    (y 1580)

  Con las marcas de perimetro hay dos bordes N|S y no se puede elegir. Con las
  cajas cada tracker tiene la suya y no hay nada que elegir.
*/
const ESCALA = 0.2; // metros por unidad de lamina
const CY: Record<number, number> = { 1: 200, 2: 200, 3: 600, 4: 600, 5: 1000, 6: 1000, 7: 1400, 8: 1400 };
const CX = (k: number) => 500 + k * 30;
const CAJA: Record<number, string> = {
  1: "DCB-SUR", 2: "DCB-SUR", 3: "DCB-C1", 4: "DCB-C1",
  5: "DCB-C1", 6: "DCB-C1", 7: "DCB-NORTE", 8: "DCB-NORTE",
};
const CAJAS = [
  { name: "DCB-SUR", x: 600, y: 20 },
  { name: "DCB-C1", x: 600, y: 800 },
  { name: "DCB-NORTE", x: 600, y: 1580 },
];

const bloque = (over: Partial<BloqueConCajas> = {}): BloqueConCajas => ({
  block: "07",
  trackers: Object.keys(CY).map((k) => ({
    tracker: `07-${k.padStart(3, "0")}`,
    cx: CX(Number(k)),
    cy: CY[Number(k)]!,
    caja: CAJA[Number(k)]!,
  })),
  cajas: CAJAS,
  ...over,
});

const LAT0 = -32.5, LON0 = 148.94;
const M_LAT = 110_540;
const M_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

/**
 * La geometria de verdad. `norteArriba` decide si la lamina esta con el norte
 * hacia arriba o al reves — que es justo lo que no se puede asumir y por eso se
 * mide apoyando el dibujo sobre las coordenadas.
 */
function filas(norteArriba = true): TrackerRow[] {
  const s = norteArriba ? 1 : -1;
  const medio = 65 / 2;
  return Object.keys(CY).map(Number).map((k) => {
    const norte = s * CY[k]! * ESCALA;
    const este = s * CX(k) * ESCALA;
    return {
      id: `07-07-${String(k).padStart(3, "0")}-R1`,
      block: "07",
      tracker: `07-${String(k).padStart(3, "0")}`,
      row: "R1",
      start: { lat: LAT0 + (norte - medio) / M_LAT, lon: LON0 + este / M_LON },
      end: { lat: LAT0 + (norte + medio) / M_LAT, lon: LON0 + este / M_LON },
    };
  });
}

/** Que punta quedo como origen, por numero de tracker. */
function puntas(rows: TrackerRow[], origins: Map<string, "start" | "end">) {
  const m = new Map<number, "start" | "end">();
  for (const r of rows) {
    const o = origins.get(r.id);
    if (o) m.set(Number(r.tracker.split("-").pop()), o);
  }
  return m;
}

describe("la punta de entrada medida contra la caja", () => {
  it("resuelve un bloque con dos calles internas, que la marca de perimetro no puede", () => {
    const rows = filas();
    const { origins, bloques } = sentidoDesdeLasCajas(rows, [bloque()]);
    expect(bloques[0]!.motivo).toBe("resuelto");
    expect(origins.size).toBe(8);

    const p = puntas(rows, origins);
    // En estas filas `end` es la punta de mayor latitud, o sea la del norte.
    // Banco A (1-2): la caja les queda al sur -> "start".
    expect(p.get(1)).toBe("start");
    expect(p.get(2)).toBe("start");
    // Banco B (3-4): la calle 1 les queda al norte -> "end".
    expect(p.get(3)).toBe("end");
    expect(p.get(4)).toBe("end");
    // Banco C (5-6): la MISMA calle, pero les queda al sur -> "start".
    expect(p.get(5)).toBe("start");
    expect(p.get(6)).toBe("start");
    // Banco D (7-8): caja afuera, al norte -> "end".
    expect(p.get(7)).toBe("end");
    expect(p.get(8)).toBe("end");
  });

  it("no asume que la lamina tenga el norte para arriba: lo mide", () => {
    const rows = filas(false); // el mismo parque, dibujado al reves
    const { origins } = sentidoDesdeLasCajas(rows, [bloque()]);
    const p = puntas(rows, origins);
    // Todo espejado respecto del caso anterior. Si esto no cambiara seria que
    // la orientacion esta clavada, y el proximo parque saldria invertido entero.
    expect(p.get(1)).toBe("end");
    expect(p.get(3)).toBe("start");
    expect(p.get(5)).toBe("end");
    expect(p.get(7)).toBe("start");
  });

  it("se planta si el dibujo no se apoya sobre las coordenadas", () => {
    // Trackers barajados: el cruce esta emparejando el dibujo de uno con las
    // coordenadas de otro. Ahi el signo que saldria seria una moneda al aire
    // con cara de dato.
    const orden = [5, 2, 8, 1, 7, 4, 3, 6];
    const base = filas();
    const rows = base.map((r, i) => ({ ...r, start: base[orden[i]! - 1]!.start, end: base[orden[i]! - 1]!.end }));
    const { origins, bloques } = sentidoDesdeLasCajas(rows, [bloque()]);
    expect(bloques[0]!.motivo).toBe("lamina-sin-orientar");
    expect(origins.size).toBe(0);
  });

  it("saltea la caja que cae encima del centro de su tracker en vez de inventarle un lado", () => {
    const b = bloque();
    // La caja del tracker 3 queda a la altura de su propio centro: eso es lo que
    // pasa cuando la asignacion se cruzo de calle, y de ahi no sale ninguna punta.
    b.cajas = [...CAJAS, { name: "DCB-ENCIMA", x: 600, y: 600 }];
    b.trackers.find((t) => t.tracker === "07-003")!.caja = "DCB-ENCIMA";
    const rows = filas();
    const { origins } = sentidoDesdeLasCajas(rows, [b]);
    expect(puntas(rows, origins).has(3)).toBe(false);
    expect(origins.size).toBe(7);
  });

  it("un punado de trackers mal emparejados no condena al bloque entero", () => {
    /*
      Esto salio de los bloques 15 y 16 de Wellington North, con el plano de
      interconexion de verdad: 125 de 130 trackers calzan sobre las coordenadas
      con centimetros de error, y un punado quedo emparejado con el tracker
      equivocado. Midiendo la calidad con la media cuadratica, esos pocos daban
      58 m de error sobre 148 m de bloque y el bloque se descartaba entero —o
      sea, 520 filas sin resolver por cinco etiquetas. Con la mediana no.
    */
    const rows = filas();
    const roto = rows.map((r, i) =>
      i === 1
        ? { ...r, start: { ...r.start, lat: r.start.lat + 0.004 }, end: { ...r.end, lat: r.end.lat + 0.004 } }
        : r);
    const { origins, bloques } = sentidoDesdeLasCajas(roto, [bloque()]);
    expect(bloques[0]!.motivo).toBe("resuelto");
    expect(origins.size).toBeGreaterThanOrEqual(7);
    // Y los que si calzan siguen dando la misma punta que sin el intruso.
    const p = puntas(roto, origins);
    expect(p.get(1)).toBe("start");
    expect(p.get(5)).toBe("start");
    expect(p.get(7)).toBe("end");
  });

  it("un bloque dibujado en dos pedazos de la hoja se resuelve igual", () => {
    /*
      Un bloque no siempre se dibuja de una pieza. El 06 de Wellington tiene 130
      trackers y una sola lamina, pero esta partido para que entre en la hoja
      —como un texto que sigue en la columna de al lado—, y cada pedazo esta en
      su lugar con su propia escala. Un solo mapa no puede describir a los dos:
      el ajuste de compromiso quedaba en 69,8 m y el bloque entero se
      descartaba. Con un mapa por pedazo: 1,4 m y 246 de 260 filas.

      Aca se arma un bloque de cuatro bancos de a diez, y los dos bancos del
      norte se dibujan corridos y a otra escala, como la segunda columna de la
      hoja.
    */
    const bancos = [200, 600, 1000, 1400];
    const mover = (x: number, y: number): [number, number] => [x * 0.8 + 4000, (y - 1000) * 0.8 + 100];
    const cajas = [
      { name: "SUR", x: 600, y: 20 },
      { name: "C1-abajo", x: 600, y: 800 },
      { name: "C1-arriba", x: 600, y: 800 },
      { name: "NORTE", x: 600, y: 1580 },
    ].map((c) => (c.name === "C1-arriba" || c.name === "NORTE"
      ? { ...c, x: mover(c.x, c.y)[0], y: mover(c.x, c.y)[1] }
      : c));

    const trackers: BloqueConCajas["trackers"] = [];
    const rows: TrackerRow[] = [];
    const esperado = new Map<number, "start" | "end">();
    let n = 0;
    for (let b = 0; b < bancos.length; b++) {
      for (let i = 0; i < 10; i++) {
        n++;
        const cx = 500 + i * 30;
        const cy = bancos[b]!;
        const segundo = cy >= 1000;
        const [px, py] = segundo ? mover(cx, cy) : [cx, cy];
        trackers.push({
          tracker: `07-${String(n).padStart(3, "0")}`,
          cx: px, cy: py,
          caja: ["SUR", "C1-abajo", "C1-arriba", "NORTE"][b]!,
        });
        const norte = cy * 0.2, este = cx * 0.2;
        rows.push({
          id: `07-07-${String(n).padStart(3, "0")}-R1`,
          block: "07", tracker: `07-${String(n).padStart(3, "0")}`, row: "R1",
          start: { lat: LAT0 + (norte - 32.5) / M_LAT, lon: LON0 + este / M_LON },
          end: { lat: LAT0 + (norte + 32.5) / M_LAT, lon: LON0 + este / M_LON },
        });
        // La caja del banco 0 y del 2 les queda al sur; la del 1 y el 3, al norte.
        esperado.set(n, b === 0 || b === 2 ? "start" : "end");
      }
    }

    const { origins, bloques } = sentidoDesdeLasCajas(rows, [{ block: "07", trackers, cajas }]);
    expect(bloques[0]!.motivo).toBe("resuelto");
    expect(bloques[0]!.detail).toMatch(/dibujado en 2 pedazos/);
    const p = puntas(rows, origins);
    expect(p.size).toBe(40);
    for (const [k, v] of esperado) expect(p.get(k)).toBe(v);
  });

  it("dice que le falta el plano de interconexion en vez de quedarse callado", () => {
    const { origins, bloques } = sentidoDesdeLasCajas(filas(), [bloque({ cajas: [] })]);
    expect(origins.size).toBe(0);
    expect(bloques[0]!.motivo).toBe("sin-cajas");
    expect(bloques[0]!.detail).toMatch(/interconexion/i);
  });
});

describe("la caja que manda es la de la lista del cliente", () => {
  /*
    El plano asigna la caja por geometria: el string mas cercano nombra el
    inversor y la columna, y despues gana la caja alineada con la fila. Eso
    falla en las esquinas y con las calles torcidas. La lista de strings del
    cliente no adivina — es la documentacion electrica del parque.

    En Wellington las dos difieren en 113 de 132 trackers del bloque 29, y
    varias de esas diferencias son cajas de OTRA COLUMNA, o sea del otro lado
    de una calle: la punta contraria. Del dibujo se usa lo que el dibujo sabe
    de verdad, que es donde esta cada caja.
  */
  it("con la caja del cliente da la otra punta que con la del plano", () => {
    const b = bloque();
    // Al tracker 3 el plano le adjudico la caja de la calle 1 (al norte).
    // La lista del cliente dice que cuelga de la caja del borde sur.
    const rows = filas().map((r) =>
      r.tracker === "07-003" ? { ...r, dcBoxLabel: "DCB-SUR" } : r);
    const p = puntas(rows, sentidoDesdeLasCajas(rows, [b]).origins);
    expect(p.get(3)).toBe("start");                 // manda el cliente
    expect(p.get(4)).toBe("end");                   // su hermano sigue con la del plano
  });

  it("si la fila trae una caja que el plano no dibuja, usa la del plano", () => {
    const rows = filas().map((r) =>
      r.tracker === "07-003" ? { ...r, dcBoxLabel: "DCB-QUE-NO-ESTA" } : r);
    const p = puntas(rows, sentidoDesdeLasCajas(rows, [bloque()]).origins);
    expect(p.get(3)).toBe("end");
  });
});

describe("en que mitad de la fila vive cada string", () => {
  /*
    El compilador ordenaba los strings por numero ascendente, asumiendo que el
    menor va primero. Eso era cierto mientras el conteo arrancara en la caja de
    continua. Contando desde el norte, la suposicion da vuelta la etiqueta en
    toda fila cuya caja este al sur: el mismo panel pasa de "string 5, modulo 1"
    a "string 6, modulo 28".

    Y no alcanza con invertir la convencion, porque no hay una. Medido contra
    los planos de Wellington, el string menor queda al norte en el 75% de las
    filas del bloque 29, el 87% del 34 y el 100% del 47 — no es ruido, es la
    simetria real: los bancos de un lado de la calle son el espejo de los del
    otro. Ninguna regla fija puede describir las dos mitades.

    El plano dibuja cada etiqueta encima de la mitad que le toca, asi que se
    mide. Contra 1506 filas reales, el orden medido coincide con el lado de la
    caja en 1504.
  */
  const conStrings = (): BloqueConCajas => ({
    ...bloque(),
    strings: [
      // El tracker 1 tiene el string 9 al norte y el 4 al sur: al reves de lo
      // que diria "el menor primero".
      { n: "S-1.9", t: "07-001", r: "R1", x: CX(1), y: 200 + 120 },
      { n: "S-1.4", t: "07-001", r: "R1", x: CX(1), y: 200 - 120 },
    ],
  });

  it("los ordena por donde estan dibujados, no por su numero", () => {
    const rows = filas().map((r) =>
      r.tracker === "07-001" ? { ...r, stringLabels: ["S-1.4", "S-1.9"] } : r);
    const { stringsDesdeElNorte } = sentidoDesdeLasCajas(rows, [conStrings()]);
    // En este bloque la lamina tiene el norte hacia +y, asi que el 9 va primero.
    expect(stringsDesdeElNorte.get("07-07-001-R1")).toEqual(["S-1.9", "S-1.4"]);
  });

  it("no opina si las dos etiquetas caen casi en el mismo punto", () => {
    const b = conStrings();
    b.strings = b.strings!.map((s) => ({ ...s, y: 200 }));
    const rows = filas().map((r) =>
      r.tracker === "07-001" ? { ...r, stringLabels: ["S-1.4", "S-1.9"] } : r);
    const { stringsDesdeElNorte } = sentidoDesdeLasCajas(rows, [b]);
    expect(stringsDesdeElNorte.has("07-07-001-R1")).toBe(false);
  });

  it("no inventa un orden para una etiqueta que el plano no dibuja", () => {
    const rows = filas().map((r) =>
      r.tracker === "07-001" ? { ...r, stringLabels: ["S-1.4", "S-QUE-NO-ESTA"] } : r);
    const { stringsDesdeElNorte } = sentidoDesdeLasCajas(rows, [conStrings()]);
    expect(stringsDesdeElNorte.has("07-07-001-R1")).toBe(false);
  });
});

describe("cruzar las dos lecturas", () => {
  const rows = filas();
  const ids = rows.map((r) => r.id);

  it("cuando coinciden, no cambia nada", () => {
    const a = new Map(ids.map((id) => [id, "start" as const]));
    const r = acordar(rows, a, new Map(a));
    expect(r.difieren).toBe(0);
    expect(r.bloquesAlReves).toEqual([]);
    expect([...r.origins.values()].every((v) => v === "start")).toBe(true);
  });

  it("si un bloque entero se contradice, el que esta al reves es el ajuste y mandan las cajas", () => {
    const perimetro = new Map(ids.map((id) => [id, "start" as const]));
    const cajas = new Map(ids.map((id) => [id, "end" as const]));
    const r = acordar(rows, perimetro, cajas);
    expect(r.bloquesAlReves).toEqual(["07"]);
    expect([...r.origins.values()].every((v) => v === "end")).toBe(true);
  });

  it("si se mezclan dentro del bloque es ruido de asignacion: queda el perimetro y se avisa", () => {
    const perimetro = new Map(ids.map((id) => [id, "start" as const]));
    const cajas = new Map(ids.map((id, i) => [id, (i < 4 ? "end" : "start") as "start" | "end"]));
    const r = acordar(rows, perimetro, cajas);
    expect(r.bloquesMezclados).toEqual(["07"]);
    expect(r.bloquesAlReves).toEqual([]);
    expect([...r.origins.values()].every((v) => v === "start")).toBe(true);
  });

  it("las cajas rellenan las filas que el perimetro no alcanzo", () => {
    const cajas = new Map(ids.map((id) => [id, "end" as const]));
    const r = acordar(rows, new Map(), cajas);
    expect(r.origins.size).toBe(ids.length);
  });

  it("lo que la fila ya traia no ensucia el cruce: la caja lo corrige y se cuenta aparte", () => {
    /*
      Son dos comparaciones distintas. La marca de perimetro es otra lectura
      del plano, independiente: si coincide con la caja, el dato es bueno. Lo
      que la fila traia de antes suele venir del heuristico que mide huecos
      entre picas — el que en Wellington erraba en los 52 bloques de 52. Que la
      caja lo contradiga es lo ESPERADO. Contarlo junto con lo otro bajaba el
      porcentaje de acuerdo y llenaba la lista de "bloques para mirar" con
      bloques donde no hay nada que mirar.
    */
    const previo = new Map(ids.map((id) => [id, "start" as const]));
    const cajas = new Map(ids.map((id) => [id, "end" as const]));
    const r = acordar(rows, new Map(), cajas, previo);
    expect(r.difieren).toBe(0);          // el perimetro no opino: no hay cruce
    expect(r.bloquesMezclados).toEqual([]);
    expect(r.bloquesAlReves).toEqual([]);
    expect(r.corregidas).toBe(ids.length);
    // Y la caja le gana igual: una esta dibujada, la otra salio de medir huecos.
    expect([...r.origins.values()].every((v) => v === "end")).toBe(true);
  });
});

describe("de punta a punta, con el plano entero", () => {
  it("un bloque de dos calles internas queda resuelto al aplicar el plano", () => {
    const rows = filas();
    const plano: PlanoDeParque = {
      "07": {
        trackers: Object.fromEntries(
          Object.keys(CY).map(Number).map((n) => {
            // Marcas que dan DOS bordes N|S, a proposito: por perimetro este
            // bloque no tiene salida.
            const perimetro = (["norte", "sur", "norte", "sur", "norte", "sur", "norte", "sur"] as const)[n - 1]!;
            return [
              `07-${String(n).padStart(3, "0")}`,
              { rows: ["R1"], cx: CX(n), cy: CY[n]!, side: "North", dcbox: CAJA[n]!, perimetro },
            ];
          }),
        ),
        dcbox: CAJAS,
        strings: [],
        road: 800,
        axis: "y",
      },
    };

    const a = aplicarPlano(rows, plano);
    // La marca de perimetro sola no alcanza en este bloque.
    expect(a.sinCalleEnElPlano).toContain("07");
    // Las cajas lo cierran igual.
    expect(a.conSentido).toBe(8);
    expect(a.rows.every((r) => r.originEnd)).toBe(true);
    expect(a.notas.join(" ")).toMatch(/se midio contra la caja/);
  });

  it("los planos de fundacion y los de interconexion se suman entre tandas", () => {
    const rows = filas();
    const marcas = (["norte", "sur", "norte", "sur", "norte", "sur", "norte", "sur"] as const);

    // Tanda 1: fundaciones. Traen la marca de perimetro, ninguna caja.
    const fundaciones: PlanoDeParque = {
      "07": {
        trackers: Object.fromEntries(Object.keys(CY).map(Number).map((n) => [
          `07-${String(n).padStart(3, "0")}`,
          { rows: ["R1"], cx: CX(n), cy: CY[n]!, side: "North", perimetro: marcas[n - 1]! },
        ])),
        dcbox: [], strings: [], road: 800, axis: "y",
      },
    };
    const a1 = aplicarPlano(rows, fundaciones);
    // Dos calles internas: por perimetro no sale, y lo dice.
    expect(a1.sinCalleEnElPlano).toContain("07");
    expect(a1.rows.some((r) => r.originEnd)).toBe(false);
    expect(a1.notas.join(" ")).toMatch(/UN dato para todo el parque/);

    // Tanda 2: interconexion. Trae las cajas, ninguna marca.
    const interconexion: PlanoDeParque = {
      "07": {
        trackers: Object.fromEntries(Object.keys(CY).map(Number).map((n) => [
          `07-${String(n).padStart(3, "0")}`,
          { rows: ["R1"], cx: CX(n), cy: CY[n]!, side: "North", dcbox: CAJA[n]! },
        ])),
        dcbox: CAJAS, strings: [], road: 800, axis: "y",
      },
    };
    const a2 = aplicarPlano(a1.rows, interconexion);
    expect(a2.rows.every((r) => r.originEnd)).toBe(true);
    // Y ya no pide ir al campo a confirmar de que lado van las cajas.
    expect(a2.notas.join(" ")).not.toMatch(/UN dato para todo el parque/);
    expect(a2.notas.join(" ")).toMatch(/no depende de si las cajas/);
  });
});
