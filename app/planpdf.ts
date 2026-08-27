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

/**
 * Como nombra este parque a sus trackers, cajas y strings.
 *
 * Esto ESTABA escrito como tres constantes: `bb-ttt-Rz`, `DCB-i.c.n` y
 * `S-i.c.n.x.y`, que son los formatos de Edenvale. En otro parque el lector no
 * reconocia una sola etiqueta y contestaba "el archivo no tiene ningun bloque",
 * que es la misma clase de error que tener el bloque "06" escrito en el codigo:
 * un parque metido adentro de una herramienta que dice servir para cualquiera.
 *
 * Ahora hay una familia de formatos conocidos, se prueban todos y gana el que
 * reconoce mas etiquetas. Y si ninguno anda, el lector NO se queda en "no
 * reconoci nada": muestra las formas de texto que si encontro, con ejemplos,
 * para que se vea de una que hay adentro del PDF.
 */
export interface Patrones {
  nombre: string;
  /** Grupos: 1 = bloque, 2 = tracker, 3 = fila (opcional). */
  tracker: RegExp;
  /** Grupos: 1 = bloque/inversor, 2 = columna, 3 = numero de caja. */
  caja: RegExp;
  /** Grupos: 1 = bloque/inversor, 2 = columna, 3 = caja. */
  string: RegExp;
}

/**
 * Los separadores que aparecen en planos reales: guion, punto, guion bajo,
 * barra y espacio. Un mismo proyecto usa uno, pero no siempre el mismo.
 */
const SEP = "[-._/ ]";

export const PATRONES_CONOCIDOS: Patrones[] = [
  {
    // Edenvale y compania: 05-042-R1 · DCB-5.1.3 · S-5.1.3.2.1
    nombre: "bloque-tracker-Rfila",
    tracker: new RegExp(`^(\\d{1,3})${SEP}(\\d{1,4})${SEP}R\\s?(\\d{1,2})$`, "i"),
    caja: new RegExp(`^[A-Z]{0,4}CB${SEP}(\\d+)${SEP}(\\d+)${SEP}(\\d+)$`, "i"),
    string: new RegExp(`^S[A-Z]?${SEP}(\\d+)${SEP}(\\d+)${SEP}(\\d+)(?:${SEP}\\d+)*$`, "i"),
  },
  {
    // Sin la R: 05-042-1, o con la fila pegada al tracker.
    nombre: "bloque-tracker-fila",
    tracker: new RegExp(`^(\\d{1,3})${SEP}(\\d{1,4})${SEP}(\\d{1,2})$`),
    caja: new RegExp(`^[A-Z]{0,4}CB${SEP}(\\d+)${SEP}(\\d+)${SEP}(\\d+)$`, "i"),
    string: new RegExp(`^S[A-Z]?${SEP}(\\d+)${SEP}(\\d+)${SEP}(\\d+)(?:${SEP}\\d+)*$`, "i"),
  },
  {
    // Un tracker por fila: 05-042, sin fila R. El bloque sigue adelante.
    nombre: "bloque-tracker",
    tracker: new RegExp(`^(\\d{1,3})${SEP}(\\d{2,4})$`),
    caja: new RegExp(`^[A-Z]{0,4}CB${SEP}(\\d+)${SEP}(\\d+)${SEP}(\\d+)$`, "i"),
    string: new RegExp(`^S[A-Z]?${SEP}(\\d+)${SEP}(\\d+)${SEP}(\\d+)(?:${SEP}\\d+)*$`, "i"),
  },
  {
    // Con letras adelante: T05-042-R1, TRK-05-042-R1, MESA 05-042-R1.
    nombre: "prefijo-bloque-tracker-Rfila",
    tracker: new RegExp(`^[A-Z]{1,4}${SEP}?(\\d{1,3})${SEP}(\\d{1,4})${SEP}R\\s?(\\d{1,2})$`, "i"),
    caja: new RegExp(`^[A-Z]{0,4}CB${SEP}(\\d+)${SEP}(\\d+)${SEP}(\\d+)$`, "i"),
    string: new RegExp(`^S[A-Z]?${SEP}(\\d+)${SEP}(\\d+)${SEP}(\\d+)(?:${SEP}\\d+)*$`, "i"),
  },
];

/**
 * El formato deducido de UNA etiqueta que la persona lee del plano.
 *
 * La salida de emergencia que hace que esto no dependa de que yo haya previsto
 * el formato de tu parque: parado frente al plano, se copia una etiqueta de
 * tracker —la que sea— y de ahi sale el patron. Dos grupos de digitos son
 * bloque y tracker; tres, bloque, tracker y fila.
 */
export function patronDesdeEjemplo(ejemplo: string): Patrones | null {
  const t = ejemplo.trim();
  if (!t) return null;

  // Se reemplaza cada grupo de digitos por una captura y se escapa el resto,
  // asi el patron respeta EXACTAMENTE los separadores y las letras del ejemplo.
  const partes = t.split(/(\d+)/).filter((x) => x !== "");
  const grupos = partes.filter((x) => /^\d+$/.test(x)).length;
  if (grupos < 2 || grupos > 3) return null;

  const cuerpo = partes
    .map((x) => (/^\d+$/.test(x) ? "(\\d+)" : x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");

  const base = PATRONES_CONOCIDOS[0]!;
  return {
    nombre: `como "${t}"`,
    tracker: new RegExp(`^${cuerpo}$`, "i"),
    caja: base.caja,
    string: base.string,
  };
}

/** Una etiqueta de texto del plano, con su centro. Y crece hacia abajo. */
export interface Etiqueta {
  x: number;
  y: number;
  t: string;
}

export interface FormaDeEtiqueta {
  /** La forma, con # por cada digito y A por cada letra. Ej: "##-###-A#". */
  forma: string;
  veces: number;
  ejemplos: string[];
}

export interface ResultadoPdf {
  plano: PlanoDeParque;
  /** Cuantas etiquetas de cada tipo se reconocieron. */
  leidas: { trackers: number; cajas: number; strings: number; total: number };
  avisos: string[];
  /** Que formato de nombre se uso para leer el plano. */
  patron?: string;
  /**
   * Las formas de texto que trae el PDF, las mas repetidas primero.
   *
   * Existe para el caso que importa: cuando no se reconocio nada. Decir "no
   * reconoci ninguna etiqueta" y nada mas deja a la persona sin nada que hacer
   * — con el PDF abierto delante y una app que no le dice que vio. Con esto se
   * ve de una que hay adentro, y alcanza con copiar una etiqueta para que el
   * lector aprenda el formato.
   */
  formas?: FormaDeEtiqueta[];
}

/**
 * La forma de un texto: digitos a `#`, letras a `A`, el resto tal cual.
 *
 * "05-042-R1" da "##-###-A#". Agrupar por forma es lo que convierte 3458
 * etiquetas sueltas en una linea que se lee de un vistazo.
 */
export function formaDe(texto: string): string {
  return texto.trim().replace(/\d/g, "#").replace(/[A-Za-z]/g, "A");
}

/**
 * Las formas de etiqueta que trae el PDF, las mas repetidas primero.
 *
 * Se filtran las que aparecen una o dos veces —el rotulo de la lamina, el
 * numero de revision, el norte— porque lo que se busca es lo que se repite
 * cientos de veces, que es la grilla de trackers.
 */
export function formasDeEtiqueta(etiquetas: Etiqueta[], cuantas = 6): FormaDeEtiqueta[] {
  const m = new Map<string, { veces: number; ejemplos: string[] }>();
  for (const e of etiquetas) {
    const t = e.t.trim();
    if (!t || t.length > 40) continue;
    // Sin al menos un digito no es una etiqueta de grilla, es texto de la lamina.
    if (!/\d/.test(t)) continue;
    const f = formaDe(t);
    const v = m.get(f);
    if (v) { v.veces++; if (v.ejemplos.length < 3 && !v.ejemplos.includes(t)) v.ejemplos.push(t); }
    else m.set(f, { veces: 1, ejemplos: [t] });
  }
  return [...m.entries()]
    .map(([forma, v]) => ({ forma, veces: v.veces, ejemplos: v.ejemplos }))
    .filter((f) => f.veces >= 3)
    .sort((a, b) => b.veces - a.veces)
    .slice(0, cuantas);
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
/** Reparte las etiquetas en trackers, cajas y strings con un formato dado. */
function repartir(etiquetas: Etiqueta[], pat: Patrones) {
  const trackers = new Map<string, Etiqueta[]>();
  const cajas = new Map<string, Etiqueta[]>();
  const strings = new Map<string, Etiqueta[]>();

  const empujar = (m: Map<string, Etiqueta[]>, k: string, e: Etiqueta) => {
    const v = m.get(k);
    if (v) v.push(e); else m.set(k, [e]);
  };

  for (const e of etiquetas) {
    const t = e.t.trim();
    const mt = pat.tracker.exec(t);
    if (mt) { empujar(trackers, String(+mt[1]!).padStart(2, "0"), e); continue; }
    const mc = pat.caja.exec(t);
    if (mc) { empujar(cajas, String(+mc[1]!).padStart(2, "0"), e); continue; }
    const ms = pat.string.exec(t);
    if (ms) empujar(strings, String(+ms[1]!).padStart(2, "0"), e);
  }
  return { trackers, cajas, strings };
}

export interface OpcionesDePlano {
  /**
   * Una etiqueta de tracker copiada del plano, cuando ninguno de los formatos
   * conocidos engancha. De ahi sale el patron.
   */
  ejemploDeTracker?: string;
}

export function planoDeEtiquetas(
  etiquetas: Etiqueta[],
  opts: OpcionesDePlano = {},
): ResultadoPdf {
  const avisos: string[] = [];

  /*
    Se prueban todos los formatos conocidos y gana el que reconoce mas
    trackers. Antes habia UN formato —el de Edenvale— escrito como constante:
    en otro parque no enganchaba una sola etiqueta y la app contestaba "el
    archivo no tiene ningun bloque", que suena a que el PDF esta mal cuando lo
    que estaba mal era la herramienta.
  */
  const delEjemplo = opts.ejemploDeTracker ? patronDesdeEjemplo(opts.ejemploDeTracker) : null;
  if (opts.ejemploDeTracker && !delEjemplo) {
    avisos.push(
      `De "${opts.ejemploDeTracker}" no puedo sacar un formato: una etiqueta de tracker tiene que ` +
      "traer dos o tres grupos de numeros (bloque y tracker, o bloque, tracker y fila). " +
      "Copiá una etiqueta tal cual está en el plano.",
    );
  }

  const candidatos = delEjemplo ? [delEjemplo, ...PATRONES_CONOCIDOS] : PATRONES_CONOCIDOS;
  let mejor = { pat: candidatos[0]!, r: repartir(etiquetas, candidatos[0]!), n: 0 };
  for (const pat of candidatos) {
    const r = repartir(etiquetas, pat);
    const n = [...r.trackers.values()].reduce((s, v) => s + v.length, 0);
    if (n > mejor.n) mejor = { pat, r, n };
  }
  const { trackers, cajas, strings } = mejor.r;

  const cuenta = (m: Map<string, Etiqueta[]>) =>
    [...m.values()].reduce((s, v) => s + v.length, 0);
  const leidas = {
    trackers: cuenta(trackers),
    cajas: cuenta(cajas),
    strings: cuenta(strings),
    total: etiquetas.length,
  };

  const formas = formasDeEtiqueta(etiquetas);

  if (!leidas.trackers) {
    /*
      El mensaje que importa. Antes decia "no reconoci ninguna etiqueta con la
      forma bb-ttt-Rz" y se terminaba ahi: la persona queda con el PDF abierto
      delante y una app que no le dice que vio. Ahora se muestra lo que SI hay.
    */
    /*
      Una lamina de interconexion de verdad trae CIENTOS de etiquetas: una por
      tracker, una por caja, una por string. Con un punado de textos —el rotulo,
      el numero de revision, "SHEET 3 OF 12"— lo que hay adentro es un dibujo,
      no texto: el PDF esta escaneado o aplanado a imagen. Se ve identico en
      pantalla y no hay nada que extraer.
    */
    if (etiquetas.length < 20) {
      avisos.push(
        `El PDF trae ${etiquetas.length === 0 ? "cero" : "apenas " + etiquetas.length} textos ` +
        "adentro, y una lamina de interconexion tiene cientos. Casi siempre significa que el PDF " +
        "se escaneo o se aplano a imagen: se ve igual en pantalla, pero adentro es un dibujo y no " +
        "hay una sola letra que leer. Pedile al proyecto el PDF original, el que sale del CAD." +
        (etiquetas.length ? ` Lo unico que pude leer fue: ${etiquetas.slice(0, 5).map((e) => `"${e.t.trim()}"`).join(", ")}.` : ""),
      );
    } else if (!formas.length) {
      avisos.push(
        `Lei ${etiquetas.length} textos del PDF pero ninguno se repite lo suficiente como para ser ` +
        "una grilla de trackers. Puede que estos no sean los planos de interconexion sino otra " +
        "lamina del proyecto.",
      );
    } else {
      avisos.push(
        `Lei ${etiquetas.length} textos del PDF y ninguno tiene forma de etiqueta de tracker que yo ` +
        "conozca. Estas son las formas que mas se repiten en tu archivo — si alguna es la de los " +
        "trackers, copiala en el campo de abajo y vuelvo a leer el plano con ese formato:",
      );
      for (const f of formas) {
        avisos.push(`   ${f.veces} veces con la forma ${f.forma} — por ejemplo ${f.ejemplos.join(", ")}`);
      }
    }
  }

  const plano: PlanoDeParque = {};
  for (const bloque of [...trackers.keys()].sort()) {
    const armado = armarBloque(
      bloque,
      trackers.get(bloque)!,
      cajas.get(bloque) ?? [],
      strings.get(bloque) ?? [],
      mejor.pat,
    );
    if ("aviso" in armado) { avisos.push(`Bloque ${bloque}: ${armado.aviso}`); continue; }
    plano[bloque] = armado.bloque;
    avisos.push(...armado.avisos.map((a) => `Bloque ${bloque}: ${a}`));
  }

  return {
    plano,
    leidas,
    avisos,
    patron: mejor.pat.nombre,
    ...(leidas.trackers ? {} : { formas }),
  };
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
  bnum: string, T: Etiqueta[], D: Etiqueta[], S: Etiqueta[], pat: Patrones,
): { bloque: PlanoDeParque[string]; avisos: string[] } | { aviso: string } {
  const avisos: string[] = [];
  const tmap = new Map<string, Tk>();

  for (const e of T) {
    const m = pat.tracker.exec(e.t.trim())!;
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
    const m = pat.string.exec(s.n.trim());
    if (!m) { t.dcbox = null; continue; }
    const [inv, col, caja] = [+m[1]!, +m[2]!, +m[3]!];
    const cands = dl.filter((d) => {
      const mm = pat.caja.exec(d.name.trim());
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

  /**
   * Bloques que NO tienen dos alas.
   *
   * En Edenvale el bloque 06 es una tira diagonal unica: no hay calle en el
   * medio, asi que el "hueco mas grande" que encuentra el algoritmo es un vacio
   * cualquiera del dibujo, y partir por ahi inventa dos alas donde hay una.
   *
   * Esto estaba escrito como `bnum === "06"`. Nombrar un bloque de UN parque
   * dentro del lector de planos es exactamente el tipo de cosa que hace que la
   * app funcione en Edenvale y falle en el parque siguiente por dos motivos a
   * la vez: alla el bloque 06 puede tener dos alas de verdad (y se lo aplasta
   * en una), y la tira unica puede ser el 11 (y se la parte al medio).
   *
   * La tira unica se reconoce por su forma, no por su nombre:
   *
   *  - el corte deja un ala casi vacia — no es una calle, es un tracker suelto
   *    del otro lado de un vacio del dibujo; o
   *  - el hueco no es mucho mas grande que la separacion tipica entre filas
   *    vecinas, o sea no hay nada parecido a una calle.
   *
   * Una calle de verdad separa dos grupos parecidos y mide varias veces lo que
   * mide la separacion entre dos filas.
   */
  const centros = [...tmap.values()].map(perp).sort((a, b) => a - b);
  const deUnLado = centros.filter((c) => c >= road).length;
  const minoria = Math.min(deUnLado, centros.length - deUnLado) / centros.length;
  const separaciones = centros.slice(1).map((c, i) => c - centros[i]!).sort((a, b) => a - b);
  const tipica = separaciones[Math.floor(separaciones.length / 2)] ?? 0;
  const huecoElegido = axis === "x" ? gx.hueco : gy.hueco;

  const tiraUnica = minoria < 0.15 || (tipica > 0 && huecoElegido < tipica * 3);
  if (tiraUnica) {
    avisos.push(
      `El bloque ${bnum} no tiene calle en el medio: es una tira sola de ${tmap.size} trackers. ` +
      "Todas sus filas quedan del mismo lado y la caja de continua se asigna por cercania.",
    );
  }
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
