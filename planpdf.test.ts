/**
 * Sacar el plano del PDF, que es lo que evita ir al campo a contar modulos.
 *
 * Estas reglas vienen de un extractor que ya corrio sobre los 36 bloques de
 * Edenvale. Lo que se prueba aca no es que "anden", es que sobrevivieron el
 * viaje: las dos que se dieron vuelta en el camino son las que tienen bug
 * silencioso —el norte, que no es el norte geografico sino el ala del tracker
 * mas bajo, y el desempate de la caja de continua, que en el script original
 * estaba escrito con dos ramas que dicen lo mismo—.
 */

import { describe, expect, it } from "vitest";
import {
  analizarEtiqueta,
  formaEstructural,
  huecoInterior,
  planoDeEtiquetas,
  type Etiqueta,
} from "../app/planpdf";

/**
 * Un bloque como los del plano: dos alas de trackers con la calle en el medio,
 * las cajas de continua sobre la calle y los segmentos de string encima de
 * cada fila.
 *
 * `desde` es el numero del primer tracker del ala de arriba. Ponerlo abajo en
 * vez de arriba es lo que decide cual ala se llama North, y hay una prueba que
 * depende de eso.
 */
function bloque(opts: {
  b: string;
  izquierda: number[];      // numeros de tracker del ala de x chico
  derecha: number[];        // numeros de tracker del ala de x grande
  cajas?: string[];
  strings?: Array<{ n: string; x: number; y: number }>;
}): Etiqueta[] {
  const out: Etiqueta[] = [];
  const ponerAla = (nums: number[], x0: number) => {
    nums.forEach((n, i) => {
      const x = x0 + i * 30;
      // Dos filas R por tracker, separadas en Y.
      out.push({ x, y: 100, t: `${opts.b}-${String(n).padStart(3, "0")}-R1` });
      out.push({ x, y: 160, t: `${opts.b}-${String(n).padStart(3, "0")}-R2` });
    });
  };
  ponerAla(opts.izquierda, 100);
  ponerAla(opts.derecha, 600);
  (opts.cajas ?? []).forEach((name, i) => out.push({ x: 400, y: 90 + i * 60, t: name }));
  for (const s of opts.strings ?? []) out.push({ x: s.x, y: s.y, t: s.n });
  return out;
}

/** El primer numero de la caja es el del bloque: estas son las del bloque 04. */
const CAJAS = ["DCB-4.2.14", "DCB-4.2.15", "DCB-4.2.16"];
const CAJAS12 = ["DCB-12.2.14", "DCB-12.2.15", "DCB-12.2.16"];

// ---------------------------------------------------------------------------

describe("encontrar la calle", () => {
  it("es el vacio grande del medio, no el de la punta", () => {
    // Un valor suelto lejos, como un rotulo perdido contra el borde de la
    // lamina. El hueco hasta el es enorme, pero esta afuera del 12–88 %.
    const g = huecoInterior([0, 10, 20, 30, 200, 210, 220, 230, 9000]);
    expect(g.pos).toBeGreaterThan(30);
    expect(g.pos).toBeLessThan(200);
  });

  it("con un solo valor no inventa un hueco", () => {
    expect(huecoInterior([42])).toEqual({ hueco: 0, pos: 42 });
  });
});

// ---------------------------------------------------------------------------

describe("armar el bloque", () => {
  const etiquetas = bloque({
    b: "04",
    izquierda: [1, 2, 3],
    derecha: [10, 11, 12],
    cajas: CAJAS,
    strings: [{ n: "S-4.2.15.1.1", x: 102, y: 100 }, { n: "S-4.2.14.1.1", x: 602, y: 160 }],
  });

  it("junta las filas R de cada tracker en un solo tracker", () => {
    const r = planoDeEtiquetas(etiquetas);
    const t = r.plano["04"]!.trackers!;
    expect(Object.keys(t)).toHaveLength(6);
    expect(t["04-001"]!.rows).toEqual(["R1", "R2"]);
  });

  it("cuenta lo que reconocio, para poder decir si el PDF servia", () => {
    const r = planoDeEtiquetas(etiquetas);
    expect(r.leidas.trackers).toBe(12);
    expect(r.leidas.cajas).toBe(3);
    expect(r.leidas.strings).toBe(2);
  });

  it("parte las dos alas por la calle", () => {
    const r = planoDeEtiquetas(etiquetas);
    const t = r.plano["04"]!.trackers!;
    const lados = new Set(Object.values(t).map((v) => v.side));
    expect(lados).toEqual(new Set(["North", "South"]));
    expect(r.plano["04"]!.axis).toBe("x");
    expect(r.plano["04"]!.road).toBeGreaterThan(160);
    expect(r.plano["04"]!.road).toBeLessThan(600);
  });

  /**
   * El norte no es el norte geografico: es el ala donde vive el tracker de
   * numero mas bajo. Anclarlo asi es lo que hace que no dependa de como quedo
   * orientada la lamina — que es lo unico que cambia entre un plano y otro.
   */
  it("el norte es el ala del tracker mas chico, no un lado del dibujo", () => {
    const conBajosIzquierda = planoDeEtiquetas(etiquetas).plano["04"]!.trackers!;
    expect(conBajosIzquierda["04-001"]!.side).toBe("North");
    expect(conBajosIzquierda["04-010"]!.side).toBe("South");

    // El mismo dibujo con la numeracion cambiada de ala: el norte se da vuelta.
    const alReves = planoDeEtiquetas(bloque({
      b: "04", izquierda: [10, 11, 12], derecha: [1, 2, 3], cajas: CAJAS,
    })).plano["04"]!.trackers!;
    expect(alReves["04-001"]!.side).toBe("North");
    expect(alReves["04-010"]!.side).toBe("South");
  });

  it("le pone a cada tracker la caja por la que se entra", () => {
    const t = planoDeEtiquetas(etiquetas).plano["04"]!.trackers!;
    for (const v of Object.values(t)) expect(v.dcbox).toMatch(/^DCB-/);
  });

  /**
   * La regla hibrida: el string mas cercano nombra el inversor y la columna,
   * y recien entre esa caja y sus vecinas ±2 gana la alineada con la fila.
   * Si fuera puramente geometrica agarraria la caja de al lado; si fuera
   * puramente electrica se correria de fila. Aca las tres candidatas son del
   * mismo inversor y decide la Y.
   */
  it("entre las cajas vecinas del mismo inversor, gana la alineada con la fila", () => {
    const t = planoDeEtiquetas(etiquetas).plano["04"]!.trackers!;
    // Las cajas estan en y = 90, 150, 210; el centro de los trackers en 130.
    // La mas alineada es la del medio.
    expect(t["04-001"]!.dcbox).toBe("DCB-4.2.15");
  });

  it("sin ningun string no adivina la caja: la deja en null", () => {
    const sinStrings = planoDeEtiquetas(bloque({
      b: "04", izquierda: [1, 2, 3], derecha: [10, 11, 12], cajas: CAJAS,
    }));
    const t = sinStrings.plano["04"]!.trackers!;
    expect(Object.values(t).every((v) => v.dcbox === null)).toBe(true);
    expect(sinStrings.avisos.join(" ")).toMatch(/sin caja de continua/);
  });

  it("a cada string le dice de que tracker y fila es", () => {
    const s = planoDeEtiquetas(etiquetas).plano["04"]!.strings!;
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ n: "S-4.2.15.1.1", t: "001", r: "R1" });
    expect(s[1]).toMatchObject({ n: "S-4.2.14.1.1", t: "010", r: "R2" });
  });

  it("y de que lado esta, con el mismo criterio que los trackers", () => {
    const s = planoDeEtiquetas(etiquetas).plano["04"]!.strings!;
    expect(s[0]!.s).toBe("North");
    expect(s[1]!.s).toBe("South");
  });
});

// ---------------------------------------------------------------------------

/**
 * Bloques sin calle en el medio.
 *
 * En Edenvale el 06 es una tira diagonal sola. Eso estaba escrito en el codigo
 * como `bnum === "06"`, que es el nombre de un bloque de UN parque metido en el
 * lector de planos: en el parque siguiente el 06 puede tener dos alas de verdad
 * (y se lo aplasta en una) y la tira sola puede ser el 11 (y se la parte al
 * medio). Se reconoce por la forma.
 */
describe("bloques que no tienen dos alas", () => {
  /** Una tira pareja: doce trackers uno al lado del otro, sin calle. */
  const tira = (b: string): Etiqueta[] => {
    const out: Etiqueta[] = [];
    for (let n = 1; n <= 12; n++) {
      const x = 100 + (n - 1) * 30;
      out.push({ x, y: 100, t: `${b}-${String(n).padStart(3, "0")}-R1` });
      out.push({ x, y: 160, t: `${b}-${String(n).padStart(3, "0")}-R2` });
    }
    for (let k = 0; k < 3; k++) out.push({ x: 250, y: 90 + k * 60, t: `DCB-${+b}.2.${14 + k}` });
    return out;
  };

  it("una tira pareja no se parte en dos alas inventadas", () => {
    const r = planoDeEtiquetas(tira("11"));
    const t = r.plano["11"]!.trackers!;
    const lados = new Set(Object.values(t).map((v) => v.side));
    expect(lados).toEqual(new Set(["South"]));
    expect(r.avisos.join(" ")).toMatch(/no tiene calle en el medio/);
  });

  it("y lo dice, en vez de devolver un lado inventado sin comentarios", () => {
    expect(planoDeEtiquetas(tira("11")).avisos.join(" ")).toMatch(/tira sola de 12 trackers/);
  });

  /**
   * El otro caso de tira: un tracker suelto lejos del grupo. El vacio es
   * enorme, pero de un lado hay uno solo — no es una calle, es un rotulo
   * perdido o un tracker de esquina.
   */
  it("un tracker suelto del otro lado de un vacio no es una calle", () => {
    const e = tira("13");
    e.push({ x: 2000, y: 100, t: "13-090-R1" });
    const t = planoDeEtiquetas(e).plano["13"]!.trackers!;
    expect(new Set(Object.values(t).map((v) => v.side))).toEqual(new Set(["South"]));
  });

  it("un bloque con dos alas de verdad sigue partiendose, se llame como se llame", () => {
    for (const b of ["06", "04", "11"]) {
      const r = planoDeEtiquetas(bloque({ b, izquierda: [1, 2, 3], derecha: [10, 11, 12] }));
      const lados = new Set(Object.values(r.plano[b]!.trackers!).map((v) => v.side));
      expect(lados, `bloque ${b}`).toEqual(new Set(["North", "South"]));
      expect(r.avisos.join(" "), `bloque ${b}`).not.toMatch(/no tiene calle/);
    }
  });
});

describe("bloques girados en la lamina", () => {
  /** El mismo bloque de arriba, rotado un cuarto de vuelta al dibujarlo. */
  function girado(e: Etiqueta[]): Etiqueta[] {
    return e.map((p) => ({ x: p.y, y: 1000 - p.x, t: p.t }));
  }

  const derecho = bloque({
    b: "04", izquierda: [1, 2, 3], derecha: [10, 11, 12], cajas: CAJAS,
    strings: [{ n: "S-4.2.15.1.1", x: 102, y: 100 }, { n: "S-4.2.14.1.1", x: 602, y: 160 }],
  });

  it("saca el mismo bloque que si estuviera derecho", () => {
    const a = planoDeEtiquetas(derecho).plano["04"]!;
    const b = planoDeEtiquetas(girado(derecho)).plano["04"]!;
    for (const k of Object.keys(a.trackers!)) {
      expect(b.trackers![k]!.side, `tracker ${k}`).toBe(a.trackers![k]!.side);
      expect(b.trackers![k]!.dcbox, `tracker ${k}`).toBe(a.trackers![k]!.dcbox);
      expect(b.trackers![k]!.rows, `tracker ${k}`).toEqual(a.trackers![k]!.rows);
    }
    expect(b.axis).toBe("x");
    expect(b.strings!.map((s) => [s.s, s.t, s.r]))
      .toEqual(a.strings!.map((s) => [s.s, s.t, s.r]));
  });
});

// ---------------------------------------------------------------------------

describe("varios PDF de una sola vez", () => {
  it("separa los bloques por el numero que trae el nombre del tracker", () => {
    const r = planoDeEtiquetas([
      ...bloque({ b: "04", izquierda: [1, 2, 3], derecha: [10, 11, 12], cajas: CAJAS }),
      ...bloque({ b: "12", izquierda: [1, 2, 3], derecha: [10, 11, 12], cajas: CAJAS12 }),
    ]);
    expect(Object.keys(r.plano).sort()).toEqual(["04", "12"]);
  });

  it("un bloque con un solo tracker no se arma, y lo dice", () => {
    const r = planoDeEtiquetas([{ x: 10, y: 10, t: "07-001-R1" }]);
    expect(r.plano["07"]).toBeUndefined();
    expect(r.avisos.join(" ")).toMatch(/un solo tracker/);
  });
});

// ---------------------------------------------------------------------------

describe("cuando el PDF no sirve", () => {
  /**
   * El caso que hay que decir bien: un plano escaneado, o aplanado a imagen,
   * se ve identico en pantalla y no tiene una sola letra adentro. Sin este
   * aviso el resultado es un plano vacio y parece que la app se colgo.
   */
  it("avisa que el texto puede estar dibujado en vez de escrito", () => {
    const r = planoDeEtiquetas([{ x: 1, y: 1, t: "SHEET 3 OF 12" }]);
    expect(r.plano).toEqual({});
    expect(r.avisos.join(" ")).toMatch(/escaneo o se aplano/);
    expect(r.leidas.trackers).toBe(0);
  });

  it("ignora el resto del texto de la lamina sin quejarse", () => {
    const r = planoDeEtiquetas([
      ...bloque({ b: "04", izquierda: [1, 2, 3], derecha: [10, 11, 12], cajas: CAJAS }),
      { x: 5, y: 5, t: "REV. C" },
      { x: 5, y: 15, t: "SCALE 1:2000" },
      { x: 5, y: 25, t: "DCB-4.2" },
    ]);
    expect(Object.keys(r.plano["04"]!.trackers!)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------

describe("lo que sale entra en el importador de planos", () => {
  it("tiene la forma del all_blocks.json que espera leerPlano", async () => {
    const { leerPlano } = await import("../app/plans");
    const r = planoDeEtiquetas(bloque({
      b: "04", izquierda: [1, 2, 3], derecha: [10, 11, 12], cajas: CAJAS,
      strings: [{ n: "S-4.2.15.1.1", x: 102, y: 100 }],
    }));
    const leido = leerPlano(JSON.stringify(r.plano));
    expect("resumen" in leido).toBe(true);
    if (!("resumen" in leido)) return;
    expect(leido.resumen.bloques).toBe(1);
    expect(leido.resumen.trackers).toBe(6);
    expect(leido.resumen.cajas).toBe(3);
  });

  /**
   * La trampa de plans.ts, del otro lado: el extractor no emite `pos`, asi que
   * no hay nada que copiar por accidente al `pos` electrico de Pica.
   */
  it("no emite el pos fisico, que es el que no hay que copiar", () => {
    const r = planoDeEtiquetas(bloque({ b: "04", izquierda: [1, 2], derecha: [10, 11] }));
    for (const t of Object.values(r.plano["04"]!.trackers!)) {
      expect(t.pos).toBeUndefined();
      expect(t.pos_total).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Otro parque nombra sus trackers distinto.
 *
 * Esto tumbo un supuesto en el campo: se cargaron los planos de otra farm y la
 * app contesto "el archivo no tiene ningun bloque". El lector tenia UN formato
 * escrito adentro —el de Edenvale, `bb-ttt-Rz`— que es la misma clase de error
 * que tener el bloque "06" hardcodeado: un parque metido adentro de una
 * herramienta que dice servir para cualquiera.
 */
describe("planos de un parque que nombra distinto", () => {
  /** Un bloque de dos alas con las etiquetas escritas de la forma que se pida. */
  const bloqueCon = (etiqueta: (n: number) => string, cajas: string[] = []): Etiqueta[] => {
    const out: Etiqueta[] = [];
    [1, 2, 3].forEach((n, i) => out.push({ x: 100 + i * 30, y: 100, t: etiqueta(n) }));
    [10, 11, 12].forEach((n, i) => out.push({ x: 600 + i * 30, y: 100, t: etiqueta(n) }));
    cajas.forEach((c, i) => out.push({ x: 400, y: 90 + i * 60, t: c }));
    return out;
  };

  it("con puntos en vez de guiones", () => {
    const r = planoDeEtiquetas(bloqueCon((n) => `04.${String(n).padStart(3, "0")}.R1`));
    expect(r.leidas.trackers).toBe(6);
    expect(Object.keys(r.plano)).toEqual(["04"]);
  });

  it("con la fila sin la R", () => {
    const r = planoDeEtiquetas(bloqueCon((n) => `04-${String(n).padStart(3, "0")}-1`));
    expect(r.leidas.trackers).toBe(6);
  });

  it("sin fila: un solo renglon de modulos por tracker", () => {
    const r = planoDeEtiquetas(bloqueCon((n) => `04-${String(n).padStart(3, "0")}`));
    expect(r.leidas.trackers).toBe(6);
  });

  it("con una letra adelante, como T04-001-R1", () => {
    const r = planoDeEtiquetas(bloqueCon((n) => `T04-${String(n).padStart(3, "0")}-R1`));
    expect(r.leidas.trackers).toBe(6);
  });

  it("las cajas se reconocen aunque el prefijo no sea DCB", () => {
    const r = planoDeEtiquetas(
      bloqueCon((n) => `04-${String(n).padStart(3, "0")}-R1`, ["CB-4.2.1", "CB-4.2.2", "CB-4.2.3"]),
    );
    expect(r.leidas.cajas).toBe(3);
  });

  it("y Edenvale sigue leyendose exactamente igual", () => {
    const r = planoDeEtiquetas(bloque({ b: "04", izquierda: [1, 2, 3], derecha: [10, 11, 12], cajas: CAJAS }));
    expect(r.leidas.trackers).toBe(12);
    expect(r.leidas.cajas).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe("cuando ningun formato conocido engancha", () => {
  /** Etiquetas con una forma que el lector no puede adivinar. */
  const raras = (): Etiqueta[] => {
    const out: Etiqueta[] = [];
    for (let n = 1; n <= 30; n++) {
      const izq = n <= 15;
      out.push({
        x: (izq ? 60 : 400) + (n % 15) * 12, y: 400,
        t: `TRK/B4/M${String(n).padStart(2, "0")}/W2`,
      });
    }
    for (let i = 0; i < 10; i++) out.push({ x: 30, y: 700 + i, t: `NOTA ${i} DE LA LAMINA` });
    return out;
  };

  /**
   * Lo que estaba mal no era solo no reconocer: era no DECIR que se vio. Con el
   * PDF abierto delante, "no reconoci ninguna etiqueta" no le deja a nadie
   * nada que hacer.
   */
  it("muestra las formas que si trae el archivo, con ejemplos", () => {
    const r = planoDeEtiquetas(raras());
    expect(r.leidas.trackers).toBe(0);
    const texto = r.avisos.join(" ");
    expect(texto).toMatch(/30 veces con la forma/);
    expect(texto).toMatch(/TRK\/B4\/M01\/W2/);
  });

  it("las formas tambien salen en el resultado, para poder mostrarlas aparte", () => {
    const r = planoDeEtiquetas(raras());
    expect(r.formas?.[0]).toMatchObject({ forma: "AAA/A#/A##/A#", veces: 30 });
  });

  /**
   * Y la salida de emergencia: se copia UNA etiqueta del plano y el lector
   * aprende el formato. Es lo que hace que esto no dependa de que yo haya
   * previsto el nombre que usa tu parque.
   */
  it("con una etiqueta de ejemplo, lee el plano entero", () => {
    const r = planoDeEtiquetas(raras(), { ejemploDeTracker: "TRK/B4/M01/W2" });
    expect(r.leidas.trackers).toBe(30);
    expect(r.patron).toMatch(/TRK\/B4\/M01\/W2/);
  });

  it("un ejemplo que no tiene forma de etiqueta lo dice, en vez de fallar callado", () => {
    const r = planoDeEtiquetas(raras(), { ejemploDeTracker: "el tracker de la esquina" });
    expect(r.avisos.join(" ")).toMatch(/no puedo sacar una etiqueta de tracker/);
  });

  it("un PDF escaneado se distingue de uno con etiquetas que no entiendo", () => {
    const r = planoDeEtiquetas([{ x: 1, y: 1, t: "SHEET 3 OF 12" }]);
    expect(r.avisos.join(" ")).toMatch(/se escaneo o se aplano/);
    expect(r.avisos.join(" ")).toMatch(/SHEET 3 OF 12/);
  });
});

// ---------------------------------------------------------------------------

/**
 * Las etiquetas de Wellington North, tal cual salen del PDF.
 *
 * Este es el caso que tumbo el diseño anterior. El lector tenia primero UN
 * formato (`bb-ttt-Rz`, el de Edenvale) y despues una LISTA de formatos
 * conocidos. Ninguna de las dos cosas alcanza, porque cada proyecto le agrega a
 * la etiqueta los campos que se le ocurren:
 *
 *     17-017-INT-R1-C-L-S2
 *
 * bloque, tracker, tipo de pila, fila, y tres codigos mas atras. Por eso ahora
 * no se enumera: se parte la etiqueta por sus separadores y se lee por lo que
 * significa cada pedazo.
 */
describe("etiquetas de un plano de fundaciones real", () => {
  it("saca bloque, tracker y fila de una etiqueta larga", () => {
    // El `C` de atras de la fila NO es basura: la leyenda de la lamina dice
    // que es ROW 1 - CENTER. Ver `Analisis.perimetro` — de ese campo sale la
    // calle del medio, que la app venia adivinando con las coordenadas.
    expect(analizarEtiqueta("17-017-INT-R1-C-L-S2")).toEqual({
      tipo: "tracker", bloque: "17", tracker: "17", fila: "R1", perimetro: "centro",
    });
    expect(analizarEtiqueta("19-062-INT-R1-P1S-S-S2")).toEqual({
      tipo: "tracker", bloque: "19", tracker: "62", fila: "R1", perimetro: "sur",
    });
    // La zona EXT no trae el campo, y eso esta bien: no se inventa uno.
    expect(analizarEtiqueta("19-061-EXT-R2-L-S2")).toEqual({
      tipo: "tracker", bloque: "19", tracker: "61", fila: "R2",
    });
  });

  /**
   * La fila del tracker es la PRIMERA R+numero. Mas atras vienen codigos de
   * pila como P1S y P1N que no son filas, y tomarlos partiria cada tracker en
   * filas que no existen.
   */
  it("no confunde los codigos de pila de atras con la fila", () => {
    expect(analizarEtiqueta("17-050-INT-R1-P1S-L-S1")!.fila).toBe("R1");
    expect(analizarEtiqueta("17-072-INT-R2-P1N-L-S1")!.fila).toBe("R2");
  });

  it("Edenvale se lee exactamente igual que antes", () => {
    expect(analizarEtiqueta("05-042-R1")).toEqual({
      tipo: "tracker", bloque: "05", tracker: "42", fila: "R1",
    });
    expect(analizarEtiqueta("DCB-5.1.3")).toEqual({ tipo: "caja", bloque: "05" });
    expect(analizarEtiqueta("S-5.1.3.2.1")).toEqual({ tipo: "string", bloque: "05" });
  });

  /**
   * Lo que NO tiene que entrar. Una lamina esta llena de textos con numeros, y
   * cada falso positivo es un bloque fantasma en el parque.
   */
  it("el texto de la lamina no entra como tracker", () => {
    for (const basura of [
      "SHEET 3 OF 12",   // dos numeros, pero no empieza por el bloque
      "Fan 9",
      "1200-500",        // una cota
      "40",
      "REV. C",
      "R1-C",
      "A1",
    ]) {
      expect(analizarEtiqueta(basura), `"${basura}" no es un tracker`).toBeNull();
    }
  });

  /**
   * "R1-P2" es un rotulo de pila, y entraba como el tracker 2 del bloque 1: la
   * "R" pasaba por prefijo de letras y el "1" por numero de bloque. En los tres
   * planos reales eso creaba seis bloques fantasma con un tracker cada uno.
   */
  it("un rotulo de pila que empieza con R no es el bloque 1", () => {
    expect(analizarEtiqueta("R1-P2")).toBeNull();
    expect(analizarEtiqueta("R2-P2")).toBeNull();
    expect(analizarEtiqueta("R1-P1N")).toBeNull();
  });

  it("la forma estructural distingue familias de rotulo", () => {
    expect(formaEstructural("17-017-INT-R1-C-L-S2")).toBe("#2-#3-A-R-A-A-A#1");
    expect(formaEstructural("05-042-R1")).toBe("#2-#3-R");
    // Dos etiquetas de la misma familia comparten forma; de familias distintas, no.
    expect(formaEstructural("17-017-INT-R1-C-L-S2"))
      .toBe(formaEstructural("03-116-INT-R2-C-L-S1"));
    expect(formaEstructural("17-050-INT-R1-P1S-L-S1"))
      .not.toBe(formaEstructural("17-017-INT-R1-C-L-S2"));
  });

  /**
   * Un plano de fundaciones no trae cajas de continua ni strings. Eso NO es un
   * error —de ahi salen el lado y las filas R, que es la mayor parte del valor—
   * pero hay que decir que falta, y que falta se arregla con otros planos.
   */
  it("un plano sin cajas dice que sirve igual y que le falta", () => {
    const e: Etiqueta[] = [];
    for (let n = 1; n <= 24; n++) {
      const izq = n <= 12;
      const i = izq ? n - 1 : n - 13;
      e.push({ x: (izq ? 60 : 400) + i * 12, y: 400, t: `17-${String(n).padStart(3, "0")}-INT-R1-C-L-S2` });
    }
    const r = planoDeEtiquetas(e);
    expect(r.leidas.trackers).toBe(24);
    expect(r.plano["17"]).toBeDefined();
    const texto = r.avisos.join(" ");
    expect(texto).toMatch(/ninguna caja de continua ni ningun string/);
    expect(texto).toMatch(/sirven igual/);
    expect(texto).toMatch(/INTERCONEXION/);
  });
});

/**
 * El rotulo del plano no es un tracker.
 *
 * En la lamina de interconexion de los bloques 15 y 16 de Wellington, el numero
 * de proyecto `P22-0009-ING` entraba como el tracker 9 del BLOQUE 22 — un
 * bloque que no existe, con un solo tracker, parado en la esquina de la hoja.
 * Sobre 52 laminas son decenas de bloques fantasma. Y si el codigo de proyecto
 * coincidiera con un bloque real, le inyecta un tracker en la posicion del
 * rotulo y le arruina la deteccion de la calle a un bloque bueno.
 *
 * La regla no es una lista de prefijos prohibidos —el proximo proyecto usa
 * otro— sino geometria: un tracker vive en una grilla y tiene vecinos; el
 * rotulo esta solo. En la lamina real el falso tiene su vecino mas cercano a
 * 929 puntos y la etiqueta REAL mas aislada lo tiene a 65.
 */
describe("los textos del rotulo de la lamina", () => {
  /** Una grilla de trackers como la de un plano de verdad. */
  const grilla = (bloque: string, n: number, x0 = 100, y0 = 100) =>
    Array.from({ length: n }, (_, i) => ({
      x: x0 + (i % 20) * 18,
      y: y0 + Math.floor(i / 20) * 18,
      t: `${bloque}-${String(i + 1).padStart(3, "0")}-INT-R1-C-L-S2`,
    }));

  it("descarta el numero de proyecto que quedaba solo en una esquina", () => {
    const r = planoDeEtiquetas([
      ...grilla("15", 60),
      { x: 2111, y: 1617, t: "P22-0009-ING" },   // el rotulo, en la esquina
    ]);
    expect(Object.keys(r.plano)).toEqual(["15"]);
    expect(r.avisos.join(" ")).toMatch(/P22-0009-ING/);
    expect(r.avisos.join(" ")).toMatch(/solos en la lamina/);
  });

  it("no toca ninguna etiqueta de la grilla, ni la del borde", () => {
    const g = grilla("15", 60);
    const r = planoDeEtiquetas(g);
    expect(Object.keys(r.plano["15"]!.trackers!)).toHaveLength(60);
    expect(r.avisos.join(" ")).not.toMatch(/solos en la lamina/);
  });

  it("con dos bloques en la misma lamina descarta el rotulo y deja los dos", () => {
    const r = planoDeEtiquetas([
      ...grilla("15", 60, 100, 100),
      ...grilla("16", 60, 100, 900),
      { x: 2111, y: 1617, t: "P22-0009-ING" },
    ]);
    expect(Object.keys(r.plano).sort()).toEqual(["15", "16"]);
  });

  /*
    Sin grilla no hay mediana que valga, y un plano chico de verdad no puede
    quedar vacio por esta regla.
  */
  it("con pocas etiquetas no descarta nada", () => {
    const r = planoDeEtiquetas(grilla("15", 4));
    expect(r.avisos.join(" ")).not.toMatch(/solos en la lamina/);
  });
});

/**
 * La marca del plano manda sobre el hueco mas grande.
 *
 * El bloque 06 de Wellington salia como "una tira sola de 130 trackers sin
 * calle en el medio" — y tiene calle. El heuristico busca el hueco mas grande
 * del dibujo y decide si eso es una calle; en un bloque de varios bancos, el
 * hueco mas grande puede ser cualquiera de las calles internas o un vacio del
 * trazado, y la respuesta sale de centimetros entre huecos parecidos.
 *
 * La marca de perimetro no se adivina: PERIMETER 1 NORTH / SOUTH, tracker por
 * tracker, y el borde donde un tramo sur toca uno norte ES la calle. Teniendo
 * eso, medir huecos es volver a adivinar lo que esta escrito — el mismo error
 * que costo los 52 bloques del sentido de conteo.
 */
describe("el lado sale de la marca, no del hueco", () => {
  /**
   * Un bloque de dos bancos casi pegados: el hueco entre ellos es apenas mas
   * grande que la separacion entre filas vecinas, asi que el heuristico lo lee
   * como una tira sola. La marca dice otra cosa.
   */
  const bloqueApretado = () => {
    const et: Array<{ x: number; y: number; t: string }> = [];
    const marca = (i: number) => (i < 20 ? "P1N" : i < 40 ? "C" : i < 60 ? "P1S" : i < 80 ? "P1N" : "C");
    for (let i = 0; i < 100; i++) {
      et.push({ x: 100 + i * 6, y: 200, t: `06-${String(i + 1).padStart(3, "0")}-INT-R1-${marca(i)}-L-S2` });
      et.push({ x: 100 + i * 6, y: 212, t: `06-${String(i + 1).padStart(3, "0")}-INT-R2-${marca(i)}-L-S2` });
    }
    return et;
  };

  it("parte el bloque por donde el plano dice, y no avisa de tira sola", () => {
    const r = planoDeEtiquetas(bloqueApretado());
    const t = Object.values(r.plano["06"]!.trackers!);
    const norte = t.filter((x) => x.side === "North").length;
    const sur = t.filter((x) => x.side === "South").length;
    expect(norte).toBe(60);   // tramos N + C + S, o sea los trackers 1..60
    expect(sur).toBe(40);
    expect(r.avisos.join(" ")).not.toMatch(/no tiene calle en el medio/);
  });

  /**
   * Varias calles internas NO es una tira sola.
   *
   * Son dos cosas distintas que la app confundia. Que no se pueda elegir cual
   * de las calles lleva las cajas no vuelve al bloque una hilera de 130
   * trackers pegados: la marca prueba lo contrario. Y declararlo tira sola
   * rompia dos cosas de verdad — mandaba todas las filas al mismo lado y
   * tiraba la asignacion hibrida de caja para poner "la mas cercana en Y".
   *
   * De que punta se entra en estos bloques lo contesta la posicion de la caja
   * (ver app/cajas.ts), que no necesita saber cual calle es cual.
   */
  it("varias calles internas no es una tira sola", () => {
    const et: Array<{ x: number; y: number; t: string }> = [];
    //  N N | S S | N N | S S  -> dos bordes S|N: el plano marca dos calles
    const marca = (i: number) => ["P1N", "P1S", "P1N", "P1S"][Math.floor(i / 25)]!;
    for (let i = 0; i < 100; i++) {
      et.push({ x: 100 + i * 6, y: 200, t: `29-${String(i + 1).padStart(3, "0")}-INT-R1-${marca(i)}-L-S2` });
      et.push({ x: 100 + i * 6, y: 212, t: `29-${String(i + 1).padStart(3, "0")}-INT-R2-${marca(i)}-L-S2` });
    }
    const r = planoDeEtiquetas(et);
    const texto = r.avisos.join(" ");
    expect(texto).not.toMatch(/es una tira sola/);
    expect(texto).toMatch(/marca mas de una calle interna/);
    // Y las filas no quedan todas del mismo lado.
    const t = Object.values(r.plano["29"]!.trackers!);
    expect(new Set(t.map((x) => x.side)).size).toBe(2);
  });

  /*
    Y un plano SIN la marca sigue funcionando como antes: Edenvale no la trae y
    no puede depender de ella.
  */
  it("sin marca de perimetro usa el heuristico de siempre", () => {
    const et: Array<{ x: number; y: number; t: string }> = [];
    for (let i = 0; i < 40; i++) {
      const y = i < 20 ? 100 : 600;          // dos alas separadas por una calle
      et.push({ x: 100 + (i % 20) * 20, y, t: `04-${String(i + 1).padStart(3, "0")}-R1` });
    }
    const r = planoDeEtiquetas(et);
    const t = Object.values(r.plano["04"]!.trackers!);
    expect(new Set(t.map((x) => x.side)).size).toBe(2);
  });
});

/**
 * Un bloque se arma en UN marco de coordenadas.
 *
 * Cada PDF tiene el suyo. Mientras cada bloque este en una sola lamina eso da
 * igual, pero varios aparecen en dos —la de fundaciones y la de
 * interconexion— y entonces sus etiquetas llegan en dos marcos distintos.
 * Promediarlas da un centro que no existe.
 *
 * Lo destapo el bloque 06 de Wellington: con su lamina sola el dibujo calza
 * sobre las coordenadas del relevamiento con 1,2 m de error; mezclado con la
 * otra queda en 69,8 m y el bloque se descarta entero. Y no habia forma de
 * verlo — el numero de trackers seguia dando bien.
 */
describe("un bloque se arma en un solo marco", () => {
  /** El mismo bloque en dos laminas: la segunda corrida y a otra escala. */
  const enDosLaminas = (soloEnLaPrimera = 0) => {
    const et: Array<{ x: number; y: number; t: string; hoja: string }> = [];
    for (let i = 0; i < 30; i++) {
      const nombre = `08-${String(i + 1).padStart(3, "0")}-INT-R1-C-L-S2`;
      const x = 100 + (i % 15) * 20;
      const y = i < 15 ? 100 : 400;
      et.push({ x, y, t: nombre, hoja: "fundaciones.pdf#1" });
      // La segunda lamina no trae los primeros, que es lo que rompe: unos
      // trackers quedan promediados entre dos marcos y otros no.
      if (i >= soloEnLaPrimera) {
        et.push({ x: x * 1.4 + 900, y: y * 1.4 + 250, t: nombre, hoja: "interconexion.pdf#1" });
      }
    }
    // Las cajas estan solo en la de interconexion, y por eso esa manda.
    for (let i = 0; i < 4; i++) {
      et.push({ x: 1000 + i * 60, y: 600, t: `DCB-8.1.${i + 1}`, hoja: "interconexion.pdf#1" });
    }
    return et;
  };

  it("se queda con la lamina que trae las cajas y lo dice", () => {
    const r = planoDeEtiquetas(enDosLaminas(5));
    const t = Object.values(r.plano["08"]!.trackers!);
    expect(t.length).toBe(25);          // los que estan en la lamina elegida
    expect(r.avisos.join(" ")).toMatch(/aparece en mas de una lamina/);
    /*
      Y las posiciones son EXACTAMENTE las de esa lamina, no un promedio de las
      dos. Se compara contra armar el bloque con esa lamina sola: si algun
      punto de la otra se cuela, este numero cambia.
    */
    const sola = planoDeEtiquetas(
      enDosLaminas(5).filter((e) => e.hoja === "interconexion.pdf#1"),
    ).plano["08"]!.trackers!;
    for (const [k, v] of Object.entries(r.plano["08"]!.trackers!)) {
      expect(v.cx).toBe(sola[k]!.cx);
      expect(v.cy).toBe(sola[k]!.cy);
    }
  });

  it("de las otras laminas se queda con la marca de perimetro, que no depende del marco", () => {
    const et = enDosLaminas(0).map((e) =>
      e.hoja === "fundaciones.pdf#1" && e.t.includes("-INT-")
        ? { ...e, t: e.t.replace("-C-L-S2", "-P1N-L-S2") }
        : e);
    const r = planoDeEtiquetas(et);
    const t = Object.values(r.plano["08"]!.trackers!);
    // La marca vino de la lamina que NO se uso para las coordenadas.
    expect(t.every((x) => x.perimetro === "centro")).toBe(true);
  });

  it("una sola lamina se comporta igual que siempre", () => {
    const et = enDosLaminas(0).filter((e) => e.hoja === "interconexion.pdf#1");
    const r = planoDeEtiquetas(et);
    expect(r.avisos.join(" ")).not.toMatch(/aparece en mas de una lamina/);
    expect(Object.keys(r.plano["08"]!.trackers!).length).toBe(30);
  });
});
