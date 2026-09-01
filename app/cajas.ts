/**
 * El sentido de conteo sacado de DONDE ESTA DIBUJADA LA CAJA, no de suponerlo.
 *
 * Con las marcas de perimetro (`app/bancos.ts`) Wellington North resolvio 8266
 * de 13606 filas. Los 5340 que faltaban son 18 bloques que marcan MAS DE UNA
 * calle interna y uno que no marca ninguna: ahi la pregunta que quedaba abierta
 * era "cual de esas calles lleva las cajas", y no la contesta el plano de
 * fundaciones.
 *
 * La contesta el de interconexion, que ya esta cargado: dibuja cada caja de
 * continua con su posicion, y cada tracker con la suya. Teniendo las dos, la
 * punta por la que se entra no se deduce — se mide:
 *
 *     desplazamiento = (coordenada de la caja  -  coordenada del tracker)
 *                       a lo largo del eje largo del tracker
 *
 * El signo de ese numero ES la punta. No hace falta saber si las cajas van
 * sobre la calle del medio o en el borde de afuera (`dcBoxPlacement`), que era
 * el bit que hasta ahora se pedia confirmar contando en el campo: si la caja
 * esta dibujada, ese bit sobra.
 *
 * Lo unico que hay que traducir es el dibujo al terreno. Eso NO se asume —
 * ninguna lamina promete tener el norte para arriba— se calibra con los datos
 * que ya estan: se cruzan los trackers del plano con las filas del
 * relevamiento por numero y se mide cuanto correlaciona la coordenada del
 * dibujo con la latitud (o la longitud) de verdad. Con decenas de trackers por
 * bloque eso da |r| ~ 1, y el signo de r es la orientacion de la lamina.
 *
 * Lo que este modulo NO dice, y conviene no confundirlo: no dice desde que
 * punta numera los modulos el cliente. Dice donde esta la caja. Que la
 * numeracion arranque ahi es una convencion, y va escrita en el informe como
 * tal.
 */

import type { TrackerRow } from "../src/types.js";

/** Un tracker del plano, con su posicion en la lamina y su caja. */
export interface TrackerConCaja {
  tracker: string;
  cx: number;
  cy: number;
  caja?: string | null;
}

/** Un bloque del plano, con las cajas dibujadas. */
export interface BloqueConCajas {
  block: string;
  trackers: TrackerConCaja[];
  cajas: Array<{ name: string; x: number; y: number }>;
  /**
   * Los strings del bloque con la posicion donde estan DIBUJADOS en la lamina.
   *
   * De aca sale en que mitad de la fila vive cada string. La app lo decidia
   * hasta ahora con una convencion —"el numero menor esta mas cerca de la
   * caja"— que no es una regla del mundo: medida contra los planos de
   * Wellington se cumple en el 69%, 76% y 28% de las filas segun el bloque, y
   * Edenvale numera distinto que Wellington. El dibujo, en cambio, pone cada
   * etiqueta encima de la mitad que le toca.
   */
  strings?: Array<{ n: string; t?: string; r?: string; x?: number; y?: number }>;
}

export interface BloqueResuelto {
  block: string;
  filas: number;
  motivo: "resuelto" | "sin-cajas" | "sin-cruce" | "lamina-sin-orientar";
  detail: string;
}

export interface SentidoPorCajas {
  origins: Map<string, "start" | "end">;
  bloques: BloqueResuelto[];
  /**
   * Para cada fila, sus strings ordenados DESDE EL NORTE, medidos contra el
   * dibujo. El primero es el que ocupa la mitad norte.
   */
  stringsDesdeElNorte: Map<string, string[]>;
}

function numeroDeTracker(texto: string): number | null {
  const g = texto.match(/\d+/g);
  if (!g?.length) return null;
  const n = Number(g[g.length - 1]);
  return Number.isFinite(n) ? n : null;
}

function mediana(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Resolver un sistema 3x3 por eliminacion. `null` si esta degenerado. */
function resolver3(M: number[][], b: number[]): [number, number, number] | null {
  const a = M.map((f, i) => [...f, b[i]!]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let f = c + 1; f < 3; f++) if (Math.abs(a[f]![c]!) > Math.abs(a[piv]![c]!)) piv = f;
    if (Math.abs(a[piv]![c]!) < 1e-12) return null;
    [a[c], a[piv]] = [a[piv]!, a[c]!];
    for (let f = 0; f < 3; f++) {
      if (f === c) continue;
      const k = a[f]![c]! / a[c]![c]!;
      for (let j = c; j < 4; j++) a[f]![j]! -= k * a[c]![j]!;
    }
  }
  return [a[0]![3]! / a[0]![0]!, a[1]![3]! / a[1]![1]!, a[2]![3]! / a[2]![2]!];
}

/**
 * Apoyar el dibujo sobre el terreno: geo ~= A * plano + t, por PEDAZOS.
 *
 * Nada garantiza que una lamina tenga el norte para arriba, ni la misma escala
 * en las dos direcciones, ni que dos laminas del mismo parque esten giradas
 * igual. En vez de asumirlo se ajusta el mapa que lleva el centro de cada
 * tracker del plano al centro de sus filas de verdad, y el residuo dice si el
 * ajuste sirve.
 *
 * Lo que obligo a rehacer esto: un bloque no siempre se dibuja de una pieza. El
 * 06 de Wellington tiene 130 trackers y una sola lamina, pero esta partido en
 * mas de un pedazo para que entre en la hoja — como un texto que sigue en la
 * columna de al lado. Cada pedazo esta en su lugar de la hoja, asi que un solo
 * mapa no puede describirlos a los dos: el ajuste de compromiso quedaba en
 * 69,8 m y el bloque entero se descartaba.
 *
 * Asi que en vez de un mapa se buscan VARIOS, cada uno con los trackers que
 * explica. La busqueda es por consenso (RANSAC): se prueban tercetos de
 * trackers al azar, cada terceto define un mapa exacto, y gana el que deja mas
 * trackers cerca. Despues se saca ese grupo y se repite con lo que queda. Un
 * bloque de una pieza da un solo pedazo y se comporta igual que antes.
 *
 * Es al azar pero no es impredecible: el generador tiene semilla fija, asi que
 * el mismo plano da siempre el mismo resultado. Un parque que se lee dos veces
 * y contesta distinto no sirve para nada.
 */

export interface PuntoDelBloque { n: number; cx: number; cy: number; X: number; Y: number }

interface Pedazo {
  A: [[number, number], [number, number]];
  /** El corrimiento del mapa, para poder ubicar un punto y no solo una direccion. */
  t: [number, number];
  /** Numeros de tracker que este pedazo explica. */
  miembros: Set<number>;
  /** Mediana del residuo, en metros. */
  error: number;
}

/** Congruencial simple, con semilla: el mismo plano da siempre lo mismo. */
function dado(semilla: number): () => number {
  let x = semilla >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

function afinExacta(
  p: PuntoDelBloque[],
): { sx: [number, number, number]; sy: [number, number, number] } | null {
  const M = p.map((q) => [q.cx, q.cy, 1]);
  const sx = resolver3(M.map((f) => [...f]), p.map((q) => q.X));
  const sy = resolver3(M.map((f) => [...f]), p.map((q) => q.Y));
  return sx && sy ? { sx, sy } : null;
}

function afinMinimos(
  p: PuntoDelBloque[],
): { sx: [number, number, number]; sy: [number, number, number] } | null {
  if (p.length < 3) return null;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (const q of p) {
    const v = [q.cx, q.cy, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i]![j]! += v[i]! * v[j]!;
      bx[i]! += v[i]! * q.X;
      by[i]! += v[i]! * q.Y;
    }
  }
  const sx = resolver3(M.map((f) => [...f]), bx);
  const sy = resolver3(M.map((f) => [...f]), by);
  return sx && sy ? { sx, sy } : null;
}

const residuo = (
  q: PuntoDelBloque,
  f: { sx: [number, number, number]; sy: [number, number, number] },
) => Math.hypot(
  f.sx[0] * q.cx + f.sx[1] * q.cy + f.sx[2] - q.X,
  f.sy[0] * q.cx + f.sy[1] * q.cy + f.sy[2] - q.Y,
);

/**
 * Cuantos trackers tiene que explicar un pedazo para que cuente como pedazo.
 *
 * Ocho en un bloque de verdad —son de 130— para que un grupito de trackers mal
 * emparejados no invente un pedazo propio. Pero nunca mas de un cuarto del
 * bloque, porque si no un bloque chico no puede formar ninguno. Y nunca menos
 * de cuatro: con tres puntos una afin pasa exacta por cualquier terna, asi que
 * tres no es un consenso, es una coincidencia.
 */
const minimoPedazo = (n: number) => Math.max(4, Math.min(8, Math.floor(n / 4)));
const INTENTOS = 400;

function apoyarPorPartes(puntos: PuntoDelBloque[], tolerancia: number): Pedazo[] {
  const out: Pedazo[] = [];
  const MINIMO_PEDAZO = minimoPedazo(puntos.length);
  let quedan = puntos;
  const azar = dado(20260831);

  while (quedan.length >= MINIMO_PEDAZO) {
    let mejor: PuntoDelBloque[] = [];
    for (let intento = 0; intento < INTENTOS; intento++) {
      const i = Math.floor(azar() * quedan.length);
      const j = Math.floor(azar() * quedan.length);
      const k = Math.floor(azar() * quedan.length);
      if (i === j || j === k || i === k) continue;
      const tres = [quedan[i]!, quedan[j]!, quedan[k]!];
      // Un terceto casi alineado define un mapa inestable: no sirve de semilla.
      const area = Math.abs(
        (tres[1]!.cx - tres[0]!.cx) * (tres[2]!.cy - tres[0]!.cy) -
        (tres[2]!.cx - tres[0]!.cx) * (tres[1]!.cy - tres[0]!.cy));
      if (area < 1) continue;
      const f = afinExacta(tres);
      if (!f) continue;
      const dentro = quedan.filter((q) => residuo(q, f) <= tolerancia);
      if (dentro.length > mejor.length) mejor = dentro;
    }
    if (mejor.length < MINIMO_PEDAZO) break;

    // Refinar sobre el consenso y volver a contar: el terceto que lo encontro
    // no tiene por que ser el mejor ajuste de todo el grupo.
    let grupo = mejor;
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const f = afinMinimos(grupo);
      if (!f) break;
      const dentro = quedan.filter((q) => residuo(q, f) <= tolerancia);
      if (dentro.length <= grupo.length) { grupo = dentro.length ? dentro : grupo; break; }
      grupo = dentro;
    }
    const f = afinMinimos(grupo);
    if (!f) break;

    const res = grupo.map((q) => residuo(q, f)).sort((a, b) => a - b);
    out.push({
      A: [[f.sx[0], f.sx[1]], [f.sy[0], f.sy[1]]],
      t: [f.sx[2], f.sy[2]],
      miembros: new Set(grupo.map((q) => q.n)),
      error: res[res.length >> 1] ?? 0,
    });
    const fuera = new Set(grupo.map((q) => q.n));
    quedan = quedan.filter((q) => !fuera.has(q.n));
  }

  return out;
}

/**
 * Cuanto tiene que valer el desplazamiento para creerle al signo.
 *
 * Una caja asignada por error a un tracker del otro lado de la calle aparece
 * casi encima de su centro; una asignada bien aparece en una punta. Se pide que
 * el desplazamiento llegue a un cuarto del tipico del bloque, que es una medida
 * del propio dibujo y no un numero de laboratorio: sirve igual en una lamina a
 * escala 1:1000 que en una a 1:2500.
 */
const MINIMO_RELATIVO = 0.25;

/**
 * Y cuanto tiene que estar alineado con la fila.
 *
 * La caja de una fila cae en una de sus PUNTAS. Si el desplazamiento apunta
 * cruzado —la caja esta al costado, a la misma altura— entonces no dice ninguna
 * punta, y forzar un signo ahi es inventar. `cos < 0.2` son mas de 78 grados de
 * desvio: eso ya no es una punta.
 */
const MINIMO_COSENO = 0.2;

/** Que fraccion del bloque tienen que explicar los pedazos encontrados. */
const COBERTURA_MINIMA = 0.6;

/**
 * Escribir el sentido de conteo de cada fila usando la posicion de su caja.
 *
 * Devuelve solo lo que pudo medir. Un bloque sin cajas dibujadas, o cuyo plano
 * no se cruza con la geometria, sale listado con el motivo — no en silencio.
 */
export function sentidoDesdeLasCajas(
  rows: TrackerRow[],
  bloques: BloqueConCajas[],
): SentidoPorCajas {
  const origins = new Map<string, "start" | "end">();
  const stringsDesdeElNorte = new Map<string, string[]>();
  const detalles: BloqueResuelto[] = [];

  for (const b of bloques) {
    const filas = rows.filter((r) => r.block === b.block);
    if (!filas.length) {
      detalles.push({ block: b.block, filas: 0, motivo: "sin-cruce",
        detail: "La geometria cargada no tiene ninguna fila de este bloque." });
      continue;
    }

    /*
      Metros locales, no grados.

      Un grado de longitud no mide lo mismo que uno de latitud, y a -32 grados
      la diferencia es del 16%. Como aca se comparan direcciones, dejarlo en
      grados deforma los angulos justo en el paso que decide.
    */
    const lat0 = filas.reduce((s, r) => s + r.start.lat, 0) / filas.length;
    const lon0 = filas.reduce((s, r) => s + r.start.lon, 0) / filas.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const geo = (p: { lat: number; lon: number }) => ({
      X: (p.lon - lon0) * 111_320 * k,
      Y: (p.lat - lat0) * 110_540,
    });

    const posCaja = new Map(b.cajas.map((c) => [c.name, c]));
    const cajaDelPlano = new Map<number, string>();
    const centro = new Map<number, { cx: number; cy: number }>();
    for (const t of b.trackers) {
      const n = numeroDeTracker(t.tracker);
      if (n == null) continue;
      centro.set(n, { cx: t.cx, cy: t.cy });
      if (t.caja) cajaDelPlano.set(n, t.caja);
    }

    /*
      Que caja es la de cada fila.

      Primero la que trae la fila —que sale de la lista de strings del cliente,
      o sea de la documentacion electrica del parque— y solo si no la tiene, la
      que adivino el plano por cercania. En Wellington las dos difieren en 113
      de 132 trackers del bloque 29, y varias de esas diferencias son cajas de
      otra columna: otra calle, o sea la punta contraria. Del dibujo se usa lo
      que el dibujo sabe de verdad, que es DONDE esta cada caja.
    */
    const cajaDeLaFila = (r: TrackerRow): { dx: number; dy: number } | null => {
      const n = numeroDeTracker(r.tracker);
      if (n == null) return null;
      const c = centro.get(n);
      if (!c) return null;
      const nombre = (r.dcBoxLabel && posCaja.has(r.dcBoxLabel)) ? r.dcBoxLabel : cajaDelPlano.get(n);
      const p = nombre ? posCaja.get(nombre) : undefined;
      return p ? { dx: p.x - c.cx, dy: p.y - c.cy } : null;
    };

    if (!filas.some((r) => cajaDeLaFila(r))) {
      detalles.push({ block: b.block, filas: 0, motivo: "sin-cajas",
        detail:
          `Los ${b.trackers.length} trackers de este bloque no tienen caja de continua dibujada. ` +
          `Con el plano de interconexion de este bloque se resuelve solo.` });
      continue;
    }

    // Un punto por tracker: el centro del dibujo contra el centro de sus filas.
    const porTracker = new Map<number, { X: number[]; Y: number[] }>();
    for (const r of filas) {
      const n = numeroDeTracker(r.tracker);
      if (n == null || !centro.has(n)) continue;
      const g = porTracker.get(n) ?? { X: [], Y: [] };
      const a = geo(r.start), z = geo(r.end);
      g.X.push((a.X + z.X) / 2);
      g.Y.push((a.Y + z.Y) / 2);
      porTracker.set(n, g);
    }
    const puntos: PuntoDelBloque[] = [...porTracker.entries()].map(([n, g]) => ({
      n,
      ...centro.get(n)!,
      X: g.X.reduce((s, v) => s + v, 0) / g.X.length,
      Y: g.Y.reduce((s, v) => s + v, 0) / g.Y.length,
    }));

    if (puntos.length < 3) {
      detalles.push({ block: b.block, filas: 0, motivo: "sin-cruce",
        detail:
          `Solo ${puntos.length} trackers del plano se encontraron con la geometria cargada, y con ` +
          `menos de 3 no se puede apoyar la lamina sobre el terreno.` });
      continue;
    }

    /*
      La tolerancia sale del propio parque, no de un numero de laboratorio: la
      mitad de lo que separa un tracker de su vecino. Mas que eso y el ajuste
      empieza a "explicar" trackers que no le corresponden.
    */
    const separaciones = puntos.map((p, i) => {
      let d = Infinity;
      for (let j = 0; j < puntos.length; j++) {
        if (i === j) continue;
        d = Math.min(d, Math.hypot(puntos[j]!.X - p.X, puntos[j]!.Y - p.Y));
      }
      return d;
    }).filter(Number.isFinite);
    const tolerancia = Math.min(15, Math.max(1.5, mediana(separaciones) * 0.5));

    const pedazos = apoyarPorPartes(puntos, tolerancia);
    const explicados = pedazos.reduce((s, p) => s + p.miembros.size, 0);
    /*
      Cuanto del bloque tiene que quedar explicado.

      Con menos de esto, lo que se encontro no es "el dibujo con un par de
      etiquetas rotas": es un cruce que no corresponde —el plano y el
      relevamiento numerando distinto— y de ahi no sale ninguna punta, sale una
      moneda al aire con cara de dato. Un pedazo cualquiera siempre se puede
      encontrar; lo que tiene que cerrar es el bloque.
    */
    if (!pedazos.length || explicados < puntos.length * COBERTURA_MINIMA) {
      detalles.push({ block: b.block, filas: 0, motivo: "lamina-sin-orientar",
        detail:
          `El dibujo no se apoya sobre las coordenadas de este bloque: de ${puntos.length} trackers ` +
          `solo ${explicados} caen donde el dibujo dice. Puede ser que el plano y el relevamiento los ` +
          `numeren distinto. No se toca nada.`,
      });
      continue;
    }

    // Que pedazo del dibujo explica a cada tracker.
    const dePedazo = new Map<number, Pedazo>();
    for (const p of pedazos) for (const n of p.miembros) dePedazo.set(n, p);

    const enTerreno = (n: number, d: { dx: number; dy: number }) => {
      const p = dePedazo.get(n);
      if (!p) return null;
      return {
        X: p.A[0][0] * d.dx + p.A[0][1] * d.dy,
        Y: p.A[1][0] * d.dx + p.A[1][1] * d.dy,
      };
    };
    const errorTipico = mediana(pedazos.map((p) => p.error));

    /*
      En que mitad de la fila vive cada string, medido y no supuesto.

      El mismo mapa que lleva el dibujo al terreno ubica la etiqueta de cada
      string. Proyectada sobre el eje de la fila da una posicion a lo largo, y
      con eso los strings de la fila se ordenan de norte a sur. No hace falta
      ninguna convencion sobre como numera el parque: Edenvale y Wellington
      numeran distinto y los dos se leen igual.
    */
    const alTerreno = (n: number, p: { x: number; y: number }) => {
      const pz = dePedazo.get(n);
      if (!pz) return null;
      return {
        X: pz.A[0][0] * p.x + pz.A[0][1] * p.y + pz.t[0],
        Y: pz.A[1][0] * p.x + pz.A[1][1] * p.y + pz.t[1],
      };
    };
    /*
      Que strings tiene cada fila lo dice la LISTA DEL CLIENTE, no el dibujo.

      El plano tambien lo intenta —le adjudica cada etiqueta al tracker mas
      cercano— pero esa asignacion es ruidosa: en los planos de Wellington hay
      filas a las que les cae media docena de strings, cuando una fila tiene uno
      o dos. Usar eso para ordenar era heredar su ruido.

      La lista del cliente ya trae, fila por fila, sus strings. Del dibujo se usa
      lo unico que el dibujo sabe mejor que nadie: DONDE esta cada etiqueta. Las
      dos fuentes se juntan por el nombre del string.
    */
    const normalizar = (t: string) => t.trim().toUpperCase().replace(/[\s._/-]+/g, ".");
    const posDeString = new Map<string, { x: number; y: number }>();
    for (const st of b.strings ?? []) {
      if (st.x == null || st.y == null) continue;
      const k = normalizar(st.n);
      // Una etiqueta repetida en la lamina no sirve para ubicar nada.
      if (posDeString.has(k)) posDeString.set(k, { x: NaN, y: NaN });
      else posDeString.set(k, { x: st.x, y: st.y });
    }
    for (const fila of filas) {
      const n = numeroDeTracker(fila.tracker);
      const etiquetas = fila.stringLabels;
      if (n == null || !etiquetas || etiquetas.length < 2) continue;
      const a = geo(fila.start), z = geo(fila.end);
      // El eje de la fila, apuntando al NORTE.
      const haciaElNorte = a.Y >= z.Y
        ? { X: a.X - z.X, Y: a.Y - z.Y }
        : { X: z.X - a.X, Y: z.Y - a.Y };
      const largo = Math.hypot(haciaElNorte.X, haciaElNorte.Y);
      if (largo === 0) continue;
      const conPos: Array<{ n: string; u: number }> = [];
      for (const et of etiquetas) {
        const p = posDeString.get(normalizar(et));
        if (!p || !Number.isFinite(p.x)) continue;
        const g = alTerreno(n, p);
        if (!g) continue;
        // Proyeccion sobre el eje: cuanto mas grande, mas al norte.
        conPos.push({ n: et, u: (g.X * haciaElNorte.X + g.Y * haciaElNorte.Y) / largo });
      }
      if (conPos.length !== etiquetas.length) continue;
      const orden = conPos.sort((p, q) => q.u - p.u);
      /*
        Dos etiquetas practicamente encimadas no dicen quien va primero. Se pide
        que se separen al menos un cuarto del largo de la fila: dos strings de
        una fila larga estan a media fila uno del otro, asi que esto solo saca
        los casos en que el dibujo no distingue.
      */
      if (Math.abs(orden[0]!.u - orden[orden.length - 1]!.u) < largo * 0.25) continue;
      stringsDesdeElNorte.set(fila.id, orden.map((o) => o.n));
    }

    const largos: number[] = [];
    for (const r of filas) {
      const n = numeroDeTracker(r.tracker);
      const d = cajaDeLaFila(r);
      if (n == null || !d) continue;
      const v = enTerreno(n, d);
      if (v) largos.push(Math.hypot(v.X, v.Y));
    }
    const umbral = mediana(largos) * MINIMO_RELATIVO;

    let escritas = 0;
    let flojas = 0;
    let cruzadas = 0;
    let sinPedazo = 0;
    for (const fila of filas) {
      const n = numeroDeTracker(fila.tracker);
      const d = n == null ? null : cajaDeLaFila(fila);
      if (n == null || !d) continue;
      const v = enTerreno(n, d);
      if (!v) { sinPedazo++; continue; }
      const largo = Math.hypot(v.X, v.Y);
      if (largo < umbral || largo === 0) { flojas++; continue; }

      const a = geo(fila.start), z = geo(fila.end);
      const ex = z.X - a.X, ey = z.Y - a.Y;
      const lf = Math.hypot(ex, ey);
      if (lf === 0) continue;
      const proy = (v.X * ex + v.Y * ey) / (largo * lf);
      if (Math.abs(proy) < MINIMO_COSENO) { cruzadas++; continue; }

      origins.set(fila.id, proy > 0 ? "end" : "start");
      escritas++;
    }

    const salteadas = [
      flojas ? `${flojas} porque su caja cae casi sobre el centro del tracker` : "",
      cruzadas ? `${cruzadas} porque su caja cae al costado y no en una punta` : "",
      sinPedazo ? `${sinPedazo} porque su tracker no cae donde el dibujo lo pone` : "",
    ].filter(Boolean).join(", ");

    detalles.push({
      block: b.block,
      filas: escritas,
      motivo: escritas ? "resuelto" : "sin-cajas",
      detail: escritas
        ? `${escritas} filas quedaron con la punta de entrada medida contra la caja dibujada` +
          `; el dibujo calzo sobre las coordenadas con ${errorTipico.toFixed(1)} m de error` +
          (pedazos.length > 1
            ? `, y esta dibujado en ${pedazos.length} pedazos, cada uno en su lugar de la hoja`
            : "") +
          (salteadas ? `; se saltearon ${salteadas}` : "") + "."
        : `Ninguna caja de este bloque cae lo bastante lejos del centro de su tracker, y a lo largo ` +
          `de la fila, como para decir de que punta es.`,
    });
  }

  return { origins, bloques: detalles, stringsDesdeElNorte };
}

/**
 * Comparar las lecturas del mismo dato y decidir cual vale, bloque por bloque.
 *
 * No es una formalidad. Las rutas contestan lo mismo por caminos que no
 * comparten supuestos: una lee la marca de perimetro y le aplica el bit
 * `dcBoxPlacement`; otra mide donde esta dibujada la caja y no aplica ningun
 * bit; y en el fondo puede quedar lo que dedujo el heuristico de coordenadas.
 * Cuando dos coinciden, el dato es bueno. Cuando se contradicen ENTEROS, el que
 * esta mal es el bit — y eso es informacion, no ruido: significa que las cajas
 * estan del lado contrario al configurado.
 *
 * Orden de confianza, de menos a mas:
 *
 *   1. lo que ya traia la fila (medir huecos entre picas: una deduccion),
 *   2. la caja dibujada (una medicion sobre el plano, sin supuestos),
 *   3. la marca de perimetro de ESTA lectura (esta escrita en la etiqueta).
 *
 * Con una excepcion, que es todo el punto de cruzarlas: en un bloque donde las
 * cajas contradicen a la marca casi fila por fila, la marca pierde. Ahi lo que
 * falla no es la marca sino el bit que se le aplica encima, y la caja no lo usa.
 *
 * Y si se contradicen MEZCLADAS dentro de un mismo bloque, eso no es un bit al
 * reves: es que a algunos trackers se les asigno una caja del otro lado de una
 * calle. Queda la marca y se avisa cuales bloques mirar.
 */
export function acordar(
  rows: TrackerRow[],
  porPerimetro: Map<string, "start" | "end">,
  porCajas: Map<string, "start" | "end">,
  /** Lo que las filas ya traian de antes, si traian algo. */
  previo: Map<string, "start" | "end"> = new Map(),
): {
  origins: Map<string, "start" | "end">;
  coinciden: number;
  difieren: number;
  bloquesAlReves: string[];
  bloquesMezclados: string[];
  /** Filas donde la caja cambio lo que habia deducido el heuristico de huecos. */
  corregidas: number;
} {
  const bloqueDe = new Map<string, string>();
  for (const r of rows) bloqueDe.set(r.id, r.block);

  /*
    El cruce que vale es contra la MARCA DE PERIMETRO, no contra lo que la fila
    ya traia.

    Son dos comparaciones distintas y mezclarlas ensucia el numero. La marca es
    otra lectura del plano, independiente: si coincide con la caja, el dato es
    bueno. Lo que la fila traia de antes, en cambio, suele venir del heuristico
    que mide huecos entre picas — el que en Wellington erraba en los 52 bloques
    de 52. Que la caja lo contradiga es lo ESPERADO, no una alarma; contarlo
    junto con lo otro bajaba el porcentaje y llenaba la lista de bloques "para
    mirar" con bloques donde no hay nada que mirar.
  */
  const acuerdo = new Map<string, { si: number; no: number }>();
  let coinciden = 0, difieren = 0;
  for (const [id, a] of porPerimetro) {
    const b = porCajas.get(id);
    if (!b) continue;
    const bl = bloqueDe.get(id) ?? "?";
    const c = acuerdo.get(bl) ?? { si: 0, no: 0 };
    if (a === b) { c.si++; coinciden++; } else { c.no++; difieren++; }
    acuerdo.set(bl, c);
  }

  const alReves: string[] = [];
  const mezclados: string[] = [];
  for (const [bl, c] of acuerdo) {
    const total = c.si + c.no;
    if (!total) continue;
    if (c.no / total >= 0.8) alReves.push(bl);
    else if (c.no / total > 0.2) mezclados.push(bl);
  }

  const origins = new Map(previo);
  // La caja le gana a la deduccion por coordenadas siempre: una esta dibujada.
  let corregidas = 0;
  for (const [id, v] of porCajas) {
    if (previo.has(id) && previo.get(id) !== v) corregidas++;
    origins.set(id, v);
  }
  // Y la marca de perimetro le gana a la caja, salvo en los bloques donde las
  // cajas la desmienten entera: ahi el que esta mal es el bit, no la caja.
  const invertidos = new Set(alReves);
  for (const [id, v] of porPerimetro) {
    if (invertidos.has(bloqueDe.get(id) ?? "?")) continue;
    origins.set(id, v);
  }

  return {
    origins, coinciden, difieren, corregidas,
    bloquesAlReves: alReves.sort(), bloquesMezclados: mezclados.sort(),
  };
}
