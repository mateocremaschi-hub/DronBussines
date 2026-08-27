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
export interface Analisis {
  tipo: "tracker" | "caja" | "string";
  /** Bloque, ya normalizado a dos digitos. */
  bloque: string;
  /** Numero de tracker, sin ceros a la izquierda. Solo para trackers. */
  tracker?: string;
  /** Fila dentro del tracker: "R1", "R2"… Solo si la etiqueta la trae. */
  fila?: string;
}

/**
 * Como se lee UNA etiqueta del plano.
 *
 * Esto ESTABA escrito como tres expresiones regulares fijas —`bb-ttt-Rz`,
 * `DCB-i.c.n`, `S-i.c.n.x.y`—, que son los formatos de Edenvale. Cargar los
 * planos de otro parque devolvia "el archivo no tiene ningun bloque", que suena
 * a que el PDF esta mal cuando lo que estaba mal era la herramienta.
 *
 * El segundo intento fue una LISTA de formatos conocidos. Tampoco alcanza, y
 * los planos de Wellington North lo demuestran: sus etiquetas son
 *
 *     17-017-INT-R1-C-L-S2
 *
 * o sea bloque, tracker, tipo de pila, fila, y tres codigos mas atras. No hay
 * lista de formatos que cubra eso, porque cada proyecto agrega los campos que
 * se le ocurren.
 *
 * Asi que no se enumera: se PARSEA. Una etiqueta se parte por sus separadores y
 * se lee por lo que significa cada pedazo —el primer numero es el bloque, el
 * segundo el tracker, y el pedazo con forma de R+numero es la fila—, ignorando
 * todo lo demas. Eso lee Edenvale, Wellington, y los que vengan.
 */
export function analizarEtiqueta(
  texto: string,
  /**
   * La forma de una etiqueta que la persona copio del plano.
   *
   * Cambia el modo de lectura: sin ella se es ESTRICTO —la etiqueta tiene que
   * empezar por el numero de bloque— porque una lamina esta llena de textos que
   * traen numeros y no son etiquetas ("SHEET 3 OF 12", "Fan 9", una cota). Con
   * ella se es amplio, porque ya no hay que adivinar: se leen solo las
   * etiquetas que tienen exactamente esa forma.
   */
  forma?: string,
): Analisis | null {
  const t = texto.trim();
  if (!t || t.length > 60) return null;

  const dosDigitos = (n: number) => String(n).padStart(2, "0");

  /*
    Primero los strings y las cajas, que TAMBIEN traen numeros separados por
    puntos. Si se probara el tracker primero, "S-4.2.15.1.1" entraria como el
    tracker 2 del bloque 4 — un tracker que no existe, con toda confianza.
  */
  const mS = /^S[A-Z]?[-._/ ](\d+)[-._/ ](\d+)[-._/ ](\d+)(?:[-._/ ]\d+)*$/i.exec(t);
  if (mS) return { tipo: "string", bloque: dosDigitos(+mS[1]!) };

  const mC = /^[A-Z]{0,4}(?:CB|BOX)[-._/ ](\d+)[-._/ ](\d+)[-._/ ](\d+)$/i.exec(t);
  if (mC) return { tipo: "caja", bloque: dosDigitos(+mC[1]!) };

  // --- tracker: se lee por partes, no por formato ---------------------------
  const partes = t.split(/[-._/ ]+/).filter(Boolean);
  if (partes.length < 2) return null;
  if (forma && formaEstructural(t) !== forma) return null;

  /*
    Un pedazo que ES la fila no puede ser tambien el bloque.

    "R1-P2" —un rotulo de pila del plano de fundaciones— entraba como el tracker
    2 del bloque 1: la "R" pasaba por prefijo de letras y el "1" por numero de
    bloque. Seis bloques fantasma con un tracker cada uno, en un plano por lo
    demas perfecto.
  */
  if (/^R(?:OW)?\d{1,2}$/i.test(partes[0]!)) return null;

  /** La fila del TRACKER: la primera R+numero. Las de atras son codigos de pila. */
  let fila: string | undefined;
  for (const p of partes) {
    const mr = /^R(?:OW)?(\d{1,2})$/i.exec(p);
    if (mr) { fila = `R${Number(mr[1])}`; break; }
  }

  /*
    De donde salen el bloque y el tracker.

    Sin ejemplo: los dos primeros pedazos, y el primero tiene que EMPEZAR con el
    numero de bloque —admitiendo un prefijo corto de letras, como "T04"—. Es lo
    que separa una etiqueta de un texto de la lamina: "SHEET 3 OF 12" tambien
    tiene dos numeros, pero no empieza por uno.

    Con ejemplo: los dos primeros pedazos que traigan digitos, esten donde
    esten y mezclados con las letras que sea. Ahi ya no hace falta ser estricto
    porque la forma de la etiqueta la dio la persona.
  */
  const digitos = (p: string): string | null => {
    const m = /\d+/.exec(p);
    return m ? m[0]! : null;
  };

  let bNum: string | null;
  let tNum: string | null;
  if (forma) {
    const conDigitos = partes.map(digitos).filter((x): x is string => x != null);
    bNum = conDigitos[0] ?? null;
    tNum = conDigitos[1] ?? null;
  } else {
    // El bloque tiene que ser el primer pedazo, con a lo sumo unas letras adelante.
    if (!/^[A-Z]{0,3}\d{1,3}$/i.test(partes[0]!)) return null;
    bNum = digitos(partes[0]!);
    tNum = /^[A-Z]{0,3}\d{1,4}$/i.test(partes[1]!) ? digitos(partes[1]!) : null;
  }
  if (bNum == null || tNum == null) return null;

  const bloque = Number(bNum);
  const tracker = Number(tNum);
  if (!Number.isFinite(bloque) || !Number.isFinite(tracker)) return null;
  if (bloque < 1 || bloque > 999) return null;
  if (tracker < 1 || tracker > 9999) return null;

  /*
    El caso mas facil de confundir con una cota: dos pedazos, sin fila, como
    "1200-500". Se pide que el numero de tracker venga con ceros adelante, que
    es como se escriben en los planos y como no se escribe una medida.
  */
  if (!forma && !fila && partes.length < 3 && tNum.length < 2) return null;

  return {
    tipo: "tracker",
    bloque: dosDigitos(bloque),
    tracker: String(tracker),
    ...(fila ? { fila } : {}),
  };
}

/**
 * La forma estructural de una etiqueta, pedazo por pedazo.
 *
 * Cada pedazo se resume: los digitos a `#` con su cantidad, las letras a `A`,
 * y un pedazo que sea R+numero a `R`. Asi:
 *
 *     17-017-INT-R1-C-L-S2   ->  #2-#3-A-R-A-A-A#1
 *     TRK/B7/M01/W1          ->  A-A#1-A#2-A#1
 *
 * Comparar formas es lo que deja acotar la lectura a las etiquetas que se
 * parecen a la que la persona copio del plano.
 */
export function formaEstructural(texto: string): string {
  return texto
    .trim()
    .split(/[-._/ ]+/)
    .filter(Boolean)
    .map((p) =>
      /^R(?:OW)?\d{1,2}$/i.test(p)
        ? "R"
        : p.replace(/\d+/g, (d) => `#${d.length}`).replace(/[A-Za-z]+/g, "A"),
    )
    .join("-");
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
/** Reparte las etiquetas en trackers, cajas y strings. */
function repartir(etiquetas: Etiqueta[], soloComo?: string) {
  const trackers = new Map<string, Etiqueta[]>();
  const cajas = new Map<string, Etiqueta[]>();
  const strings = new Map<string, Etiqueta[]>();

  const empujar = (m: Map<string, Etiqueta[]>, k: string, e: Etiqueta) => {
    const v = m.get(k);
    if (v) v.push(e); else m.set(k, [e]);
  };

  for (const e of etiquetas) {
    const a = analizarEtiqueta(e.t, soloComo);
    if (!a) continue;
    if (a.tipo === "tracker") empujar(trackers, a.bloque, e);
    else if (a.tipo === "caja") empujar(cajas, a.bloque, e);
    else empujar(strings, a.bloque, e);
  }
  return { trackers, cajas, strings };
}

export interface OpcionesDePlano {
  /**
   * Una etiqueta de tracker copiada del plano.
   *
   * Con el lector parseando por partes casi nunca hace falta: sirve para acotar
   * la lectura a las etiquetas que se parecen a esa, cuando el plano mezcla
   * varias familias de rotulo y se colo alguna que no era un tracker.
   */
  ejemploDeTracker?: string;
}

export function planoDeEtiquetas(
  etiquetas: Etiqueta[],
  opts: OpcionesDePlano = {},
): ResultadoPdf {
  const avisos: string[] = [];

  /*
    No se prueban formatos: se parsea cada etiqueta por sus partes. El detalle
    esta en `analizarEtiqueta`, y el motivo tambien.
  */
  const ejemplo = opts.ejemploDeTracker?.trim();
  let forma: string | undefined;
  if (ejemplo) {
    // Se valida el ejemplo con SU PROPIA forma: si se lo pasa por el lector
    // estricto, cualquier etiqueta que no empiece por el numero de bloque se
    // rechaza — y esas son justo las que hacen falta enseñar.
    const a = analizarEtiqueta(ejemplo, formaEstructural(ejemplo));
    if (!a || a.tipo !== "tracker") {
      avisos.push(
        `De "${ejemplo}" no puedo sacar una etiqueta de tracker: tiene que traer al menos dos ` +
        "grupos de numeros — el bloque y el numero de tracker. Copiala tal cual esta en el plano.",
      );
    } else {
      forma = formaEstructural(ejemplo);
    }
  }

  const { trackers, cajas, strings } = repartir(etiquetas, forma);

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
    );
    if ("aviso" in armado) { avisos.push(`Bloque ${bloque}: ${armado.aviso}`); continue; }
    plano[bloque] = armado.bloque;
    avisos.push(...armado.avisos.map((a) => `Bloque ${bloque}: ${a}`));
  }

  return {
    plano,
    leidas,
    avisos,
    patron: forma ? `etiquetas como "${ejemplo}"` : "leido por partes",
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
  bnum: string, T: Etiqueta[], D: Etiqueta[], S: Etiqueta[],
): { bloque: PlanoDeParque[string]; avisos: string[] } | { aviso: string } {
  const avisos: string[] = [];
  const tmap = new Map<string, Tk>();

  for (const e of T) {
    const a = analizarEtiqueta(e.t) ?? analizarEtiqueta(e.t, formaEstructural(e.t))!;
    const k = `${a.bloque}-${a.tracker!.padStart(3, "0")}`;
    // Un plano sin filas R —hay parques donde el tracker es una sola fila— se
    // modela como si todos tuvieran R1: el resto del pipeline espera al menos
    // una, y inventar mas seria inventar geometria.
    const row = a.fila ?? "R1";
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
    const m = /^S[A-Z]?[-._/ ](\d+)[-._/ ](\d+)[-._/ ](\d+)(?:[-._/ ]\d+)*$/i.exec(s.n.trim());
    if (!m) { t.dcbox = null; continue; }
    const [inv, col, caja] = [+m[1]!, +m[2]!, +m[3]!];
    const cands = dl.filter((d) => {
      const mm = /^[A-Z]{0,4}(?:CB|BOX)[-._/ ](\d+)[-._/ ](\d+)[-._/ ](\d+)$/i.exec(d.name.trim());
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
    /*
      Sin cajas de continua NI strings, lo que se cargo no es el plano de
      interconexion: es el de fundaciones, el de montaje o el de implantacion.
      Eso NO es un error —de ahi salen el lado de la calle y las filas R, que es
      la mayor parte del valor— pero hay que decir que falta, porque el dato que
      no viene es justamente por donde se entra caminando.
    */
    avisos.push(
      `${tmap.size} trackers, pero ninguna caja de continua ni ningun string. Estos planos ` +
      "sirven igual: de aca salen el lado de la calle de cada tracker y sus filas R. Lo que no " +
      "sale es por que caja de continua se entra caminando — para eso hacen falta los planos de " +
      "INTERCONEXION, que son los que dibujan las cajas (DCB, CB) y los segmentos de string.",
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
