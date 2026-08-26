/**
 * Leer los planos de interconexion, en el navegador, sin terminal.
 *
 * Este es el ultimo paso para que dar de alta un parque no requiera ir al campo
 * ni correr un script. Los PDF de interconexion traen DIBUJADO lo que la app
 * venia deduciendo con heuristicas: de que lado de la calle esta cada tracker,
 * por que caja de continua se entra, y que filas R tiene cada uno.
 *
 * Lo que hace que esto entre en el navegador es una simplificacion, no un
 * atajo: el pipeline original rasterizaba las paginas con poppler porque
 * DIBUJABA los planos. Pica no los dibuja — le alcanza con las etiquetas y sus
 * coordenadas. Sin imagenes no hace falta poppler, y pdf.js da el texto con
 * posicion, que es exactamente lo que daba `pdftotext -bbox`.
 *
 * Este archivo es geometria pura: recibe etiquetas con coordenadas y devuelve
 * el plano. Quien abre los PDF es `pdftext.ts`. La separacion no es estetica —
 * es lo que permite probar estas reglas sin un PDF de por medio.
 *
 * Las reglas no son nuevas: son las del extractor ya validado sobre 3458
 * trackers de Edenvale sin un solo nulo. Estan portadas, no reinventadas, y
 * donde me aparte del original lo digo.
 *
 * Lo unico que se dejo afuera a proposito es el `pos` —el rango del tracker
 * contando desde la calle—. Se calculaba agrupando columnas con una tolerancia
 * en pixeles de una imagen a 300 dpi, y aca no hay imagen: el mismo numero
 * sobre coordenadas de PDF agruparia cualquier cosa. Y no se pierde nada,
 * porque Pica no lo usa: su `pos` es la posicion ELECTRICA en la linea, otra
 * cosa con el mismo nombre, y `plans.ts` tiene una prueba que impide copiarlo.
 */

import type { PlanoDeParque } from "./plans";

const TRACKER = /^(\d{2})-(\d{3})-R(\d)$/;
const CAJA = /^DCB-(\d+)\.(\d+)\.(\d+)$/;
const STRING = /^S-(\d+)\.(\d+)\.(\d+)\.\d+\.\d+$/;

/** Una etiqueta de texto del plano, con su centro. Y crece hacia abajo. */
export interface Etiqueta {
  x: number;
  y: number;
  t: string;
}

export interface ResultadoPdf {
  plano: PlanoDeParque;
  /** Cuantas etiquetas de cada tipo se reconocieron. */
  leidas: { trackers: number; cajas: number; strings: number; total: number };
  avisos: string[];
}

// ---------------------------------------------------------------------------

/**
 * El hueco mas grande del medio de una nube de valores.
 *
 * Sirve para encontrar la calle: entre las dos alas de trackers hay un vacio
 * mucho mayor que la separacion entre filas vecinas. Se ignoran los extremos
 * —el 12 % de cada punta— para que un tracker suelto o un rotulo perdido contra
 * un borde de la lamina no se confundan con la calle.
 */
export function huecoInterior(vals: number[]): { hueco: number; pos: number } {
  const v = [...vals].sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return { hueco: 0, pos: v[0] ?? 0 };
  const lo = v[Math.floor(n * 0.12)]!;
  const hi = v[Math.floor(n * 0.88)]!;
  let hueco = 0;
  let pos = (v[0]! + v[n - 1]!) / 2;
  for (let i = 1; i < n; i++) {
    const g = v[i]! - v[i - 1]!;
    const mid = (v[i]! + v[i - 1]!) / 2;
    if (mid >= lo && mid <= hi && g > hueco) { hueco = g; pos = mid; }
  }
  return { hueco, pos };
}

// ---------------------------------------------------------------------------

/**
 * De un monton de etiquetas sueltas al plano del parque.
 *
 * Las etiquetas pueden venir de varios PDF mezclados: el numero de bloque esta
 * adentro del nombre de cada tracker, asi que no importa en que lamina estaba
 * cada una ni en que orden llegan.
 *
 * Con las cajas y los strings el bloque sale del PRIMER numero del nombre —el
 * inversor de `DCB-4.2.14` y de `S-4.2.14.1.1`—, que en estos planos es el
 * mismo numero que el bloque. Es una convencion del proyecto, no una ley: si un
 * parque numera los inversores por su cuenta, los trackers se arman igual pero
 * las cajas quedan en null. Por eso se avisa cuando un bloque no encontro
 * ninguna, en vez de devolver el plano a medias en silencio.
 */
export function planoDeEtiquetas(etiquetas: Etiqueta[]): ResultadoPdf {
  const trackers = new Map<string, Etiqueta[]>();
  const cajas = new Map<string, Etiqueta[]>();
  const strings = new Map<string, Etiqueta[]>();
  const avisos: string[] = [];

  const empujar = (m: Map<string, Etiqueta[]>, k: string, e: Etiqueta) => {
    const v = m.get(k);
    if (v) v.push(e); else m.set(k, [e]);
  };

  for (const e of etiquetas) {
    const mt = TRACKER.exec(e.t);
    if (mt) { empujar(trackers, String(+mt[1]!).padStart(2, "0"), e); continue; }
    const mc = CAJA.exec(e.t);
    if (mc) { empujar(cajas, String(+mc[1]!).padStart(2, "0"), e); continue; }
    const ms = STRING.exec(e.t);
    if (ms) empujar(strings, String(+ms[1]!).padStart(2, "0"), e);
  }

  const cuenta = (m: Map<string, Etiqueta[]>) =>
    [...m.values()].reduce((s, v) => s + v.length, 0);
  const leidas = {
    trackers: cuenta(trackers),
    cajas: cuenta(cajas),
    strings: cuenta(strings),
    total: etiquetas.length,
  };

  if (!leidas.trackers) {
    avisos.push(
      "No reconoci ninguna etiqueta de tracker con la forma bb-ttt-Rz. O los PDF no son los de " +
      "interconexion, o el texto viene como dibujo en vez de como texto — eso pasa cuando el PDF " +
      "se escaneo o se aplano, y ahi no hay nada que extraer por mas que se vea igual en pantalla.",
    );
  }

  const plano: PlanoDeParque = {};
  for (const bloque of [...trackers.keys()].sort()) {
    const armado = armarBloque(
      bloque,
      trackers.get(bloque)!,
      cajas.get(bloque) ?? [],
      strings.get(bloque) ?? [],
    );
    if ("aviso" in armado) { avisos.push(`Bloque ${bloque}: ${armado.aviso}`); continue; }
    plano[bloque] = armado.bloque;
    avisos.push(...armado.avisos.map((a) => `Bloque ${bloque}: ${a}`));
  }

  return { plano, leidas, avisos };
}

// ---------------------------------------------------------------------------

interface Tk {
  rows: string[];
  pts: Array<[number, number]>;
  rowy: Record<string, [number, number]>;
  cx: number;
  cy: number;
  side?: string;
  dcbox?: string | null;
}

function armarBloque(
  bnum: string, T: Etiqueta[], D: Etiqueta[], S: Etiqueta[],
): { bloque: PlanoDeParque[string]; avisos: string[] } | { aviso: string } {
  const avisos: string[] = [];
  const tmap = new Map<string, Tk>();

  for (const e of T) {
    const m = TRACKER.exec(e.t)!;
    const k = `${m[1]}-${m[2]}`;
    const row = `R${m[3]}`;
    let t = tmap.get(k);
    if (!t) { t = { rows: [], pts: [], rowy: {}, cx: 0, cy: 0 }; tmap.set(k, t); }
    t.rows.push(row);
    t.pts.push([e.x, e.y]);
    t.rowy[row] = [e.x, e.y];
  }
  for (const t of tmap.values()) {
    t.cx = t.pts.reduce((s, p) => s + p[0], 0) / t.pts.length;
    t.cy = t.pts.reduce((s, p) => s + p[1], 0) / t.pts.length;
    t.rows = [...new Set(t.rows)].sort();
  }
  if (tmap.size < 2) {
    return { aviso: "reconoci un solo tracker, y con uno no hay calle que encontrar." };
  }

  /**
   * Bloques rotados.
   *
   * Un par de bloques estan dibujados girados en la lamina. Se detecta igual
   * que la calle: si el vacio grande esta sobre el eje vertical en vez del
   * horizontal, el bloque esta de costado. Se giran las coordenadas un cuarto
   * de vuelta y despues se procesa como todos.
   */
  const rot = huecoInterior([...tmap.values()].map((v) => v.cy)).hueco >
              huecoInterior([...tmap.values()].map((v) => v.cx)).hueco;
  const alto = [...T, ...D, ...S].reduce((m, e) => (e.y > m ? e.y : m), 0);
  const girar = (p: [number, number]): [number, number] => (rot ? [alto - p[1], p[0]] : p);
  if (rot) {
    for (const t of tmap.values()) {
      [t.cx, t.cy] = girar([t.cx, t.cy]);
      for (const r of Object.keys(t.rowy)) t.rowy[r] = girar(t.rowy[r]!);
    }
  }
  const dl = D.map((e) => { const [x, y] = girar([e.x, e.y]); return { name: e.t, x, y }; });
  const sl = S.map((e) => { const [x, y] = girar([e.x, e.y]); return { n: e.t, x, y }; });

  const gx = huecoInterior([...tmap.values()].map((v) => v.cx));
  const gy = huecoInterior([...tmap.values()].map((v) => v.cy));
  const axis: "x" | "y" = gx.hueco >= gy.hueco ? "x" : "y";
  const road = axis === "x" ? gx.pos : gy.pos;
  const perp = (v: { cx: number; cy: number }) => (axis === "x" ? v.cx : v.cy);
  const perpXY = (p: { x: number; y: number }) => (axis === "x" ? p.x : p.y);

  /**
   * La caja de continua por la que se entra: regla hibrida.
   *
   * Ni la duena electrica ni la mas cercana. Primero el string mas proximo al
   * centro del tracker nombra el inversor y la columna; despues, entre esa caja
   * y sus vecinas ±2 del mismo inversor, gana la alineada con la FILA del
   * tracker. Lo puramente geometrico falla en las esquinas, con cajas del otro
   * lado de una calle y con calles torcidas; lo puramente electrico se corre
   * una fila en algunos. La hibrida paso todos los casos.
   *
   * El desempate mira siempre la coordenada Y de despues del giro. En el script
   * original eso se escribia con dos ramas —X original si el bloque estaba
   * rotado, Y original si no— que son la misma coordenada dicha de dos maneras,
   * porque girar convierte una en la otra.
   */
  const nombres = new Set(dl.map((d) => d.name));
  for (const t of tmap.values()) {
    if (!sl.length || !nombres.size) { t.dcbox = null; continue; }
    const s = sl.reduce((a, b) =>
      (b.x - t.cx) ** 2 + (b.y - t.cy) ** 2 < (a.x - t.cx) ** 2 + (a.y - t.cy) ** 2 ? b : a);
    const m = STRING.exec(s.n);
    if (!m) { t.dcbox = null; continue; }
    const [inv, col, caja] = [+m[1]!, +m[2]!, +m[3]!];
    const cands = dl.filter((d) => {
      const mm = CAJA.exec(d.name);
      return mm && +mm[1]! === inv && +mm[2]! === col && Math.abs(+mm[3]! - caja) <= 2;
    });
    if (cands.length) {
      t.dcbox = cands.reduce((a, b) =>
        (Math.abs(b.y - t.cy) < Math.abs(a.y - t.cy) ? b : a)).name;
    } else {
      const nm = `DCB-${inv}.${col}.${caja}`;
      t.dcbox = nombres.has(nm) ? nm : null;
    }
  }

  /**
   * Norte y sur.
   *
   * No es el norte geografico: es el ala donde vive el tracker de numero mas
   * bajo. Anclarlo al tracker 1 en vez de a un eje del dibujo hace que la
   * asignacion no dependa de como quedo orientada la lamina, que es lo unico
   * que cambia de un plano a otro.
   */
  const nums = [...tmap.entries()]
    .map(([k, v]) => [+k.split("-")[1]!, perp(v) >= road] as const)
    .sort((a, b) => a[0] - b[0]);
  const ladoDelPrimero = nums[0]![1];
  for (const t of tmap.values()) {
    t.side = (perp(t) >= road) === ladoDelPrimero ? "North" : "South";
  }

  // Bloque 06 en Edenvale es una tira diagonal unica: no tiene dos alas, asi
  // que la calle que encuentra el hueco es un vacio cualquiera del dibujo.
  const tiraUnica = bnum === "06";
  if (tiraUnica) {
    for (const t of tmap.values()) {
      t.side = "South";
      if (dl.length) {
        t.dcbox = dl.reduce((a, b) => (Math.abs(b.y - t.cy) < Math.abs(a.y - t.cy) ? b : a)).name;
      }
    }
  }

  // Strings: de que lado estan, y a que tracker y fila pertenece cada segmento.
  const tpos: Array<[number, number, string, string]> = [];
  for (const [k, v] of tmap) {
    for (const [r, p] of Object.entries(v.rowy)) tpos.push([p[0], p[1], k.split("-")[1]!, r]);
  }
  const strings = sl.map((ss) => {
    const s = tiraUnica ? "South" : ((perpXY(ss) >= road) === ladoDelPrimero ? "North" : "South");
    if (!tpos.length) return { n: ss.n, s };
    // Se pesa diez veces mas la distancia en Y: los segmentos de una misma fila
    // estan alineados a lo largo, asi que lo que separa una fila de la de al
    // lado es la Y, y la X de un segmento no dice casi nada.
    const best = tpos.reduce((a, b) =>
      10 * Math.abs(b[1] - ss.y) + Math.abs(b[0] - ss.x) <
      10 * Math.abs(a[1] - ss.y) + Math.abs(a[0] - ss.x) ? b : a);
    return { n: ss.n, s, t: best[2], r: best[3] };
  });

  const sinCaja = [...tmap.values()].filter((t) => !t.dcbox).length;
  if (!dl.length) {
    avisos.push(
      `${tmap.size} trackers, pero ninguna caja de continua que empiece con DCB-${+bnum}. En ` +
      "estos planos el primer numero de la caja es el del bloque; si este parque numera los " +
      "inversores aparte, el lado y las filas R salen igual pero falta por donde se entra caminando.",
    );
  } else if (sinCaja) {
    avisos.push(
      `${sinCaja} de ${tmap.size} trackers quedaron sin caja de continua. El lado y las filas R ` +
      "igual sirven; lo que falta es por donde se entra caminando.",
    );
  }

  const trackersOut: Record<string, unknown> = {};
  for (const [k, t] of tmap) {
    trackersOut[k] = {
      rows: t.rows,
      cx: Math.round(t.cx * 10) / 10,
      cy: Math.round(t.cy * 10) / 10,
      side: t.side,
      dcbox: t.dcbox ?? null,
    };
  }

  return {
    bloque: {
      trackers: trackersOut as PlanoDeParque[string]["trackers"],
      dcbox: dl,
      strings,
      road: Math.round(road * 10) / 10,
      axis,
    },
    avisos,
  };
}
