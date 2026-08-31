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
 * Apoyar el dibujo sobre el terreno: geo ~= A * plano + t.
 *
 * Nada garantiza que una lamina tenga el norte para arriba, ni la misma escala
 * en las dos direcciones, ni que dos laminas del mismo parque esten giradas
 * igual. En vez de asumirlo, se ajusta por minimos cuadrados el mapa que lleva
 * el centro de cada tracker del plano al centro de sus filas de verdad. Con
 * decenas de trackers por bloque eso queda sobredeterminado y el residuo dice
 * si el ajuste sirve o si el cruce esta emparejando trackers equivocados.
 *
 * Despues, cualquier desplazamiento del dibujo —el que va del tracker a su
 * caja— se convierte en una direccion sobre el terreno multiplicandolo por la
 * parte lineal. Eso es todo lo que hace falta: no importa donde este el norte,
 * importa si la caja cae del lado de una punta de la fila o de la otra.
 *
 * El ajuste se hace dos veces y la calidad se mide con la MEDIANA del residuo.
 * Un punado de trackers mal emparejados —pasa: una etiqueta recortada, un
 * numero repetido en la lamina— arruina una media cuadratica y no mueve una
 * mediana. Con la media, cinco puntos de 130 alcanzaban para descartar el
 * bloque entero.
 */
function apoyar(
  puntos: Array<{ cx: number; cy: number; X: number; Y: number }>,
): { A: [[number, number], [number, number]]; error: number; escala: number; descartados: number } | null {
  if (puntos.length < 3) return null;

  const ajustar = (ps: typeof puntos) => {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const bx = [0, 0, 0];
    const by = [0, 0, 0];
    for (const p of ps) {
      const v = [p.cx, p.cy, 1];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) M[i]![j]! += v[i]! * v[j]!;
        bx[i]! += v[i]! * p.X;
        by[i]! += v[i]! * p.Y;
      }
    }
    const sx = resolver3(M.map((f) => [...f]), bx);
    const sy = resolver3(M.map((f) => [...f]), by);
    return sx && sy ? { sx, sy } : null;
  };
  const residuos = (ps: typeof puntos, f: NonNullable<ReturnType<typeof ajustar>>) =>
    ps.map((p) => Math.hypot(
      f.sx[0]! * p.cx + f.sx[1]! * p.cy + f.sx[2]! - p.X,
      f.sy[0]! * p.cx + f.sy[1]! * p.cy + f.sy[2]! - p.Y,
    ));

  let fit = ajustar(puntos);
  if (!fit) return null;

  const cX0 = puntos.reduce((s, p) => s + p.X, 0) / puntos.length;
  const cY0 = puntos.reduce((s, p) => s + p.Y, 0) / puntos.length;
  const tamano = Math.sqrt(
    puntos.reduce((s, p) => s + (p.X - cX0) ** 2 + (p.Y - cY0) ** 2, 0) / puntos.length);

  /*
    Sacar de a uno los trackers que no se corresponden, y volver a ajustar.

    Esto no es prolijidad: es lo que decide si el bloque se resuelve o no. En
    los bloques 15 y 16 de Wellington el dibujo cae sobre el terreno con
    centimetros de error en casi todos los trackers, y un punado quedo
    emparejado con el equivocado —una etiqueta recortada, un numero repetido en
    la lamina—. Esos pocos, dejados adentro, daban 58 m de error sobre 148 m de
    bloque y descartaban las 520 filas de los dos bloques.

    Se saca el peor mientras siga siendo un caso aparte —varias veces el resto—
    y mientras quede la mayoria de los trackers. Un bloque donde hay que tirar
    la mitad no es un bloque con un par de etiquetas rotas: es un cruce que no
    corresponde, y ese tiene que fallar.
  */
  let base = puntos;
  let descartados = 0;
  const minimo = Math.max(3, Math.ceil(puntos.length * 0.6));
  const CALZA = tamano * 0.01;

  /*
    Sacar los trackers que no se corresponden, en dos pasadas distintas.

    Esto no es prolijidad: decide si el bloque se resuelve o no. En los bloques
    15 y 16 de Wellington el dibujo cae sobre el terreno con centimetros de
    error en casi todos los trackers, y un punado quedo emparejado con el
    equivocado —una etiqueta recortada, un numero repetido en la lamina—. Esos
    pocos, dejados adentro, daban decenas de metros de error y descartaban las
    520 filas de los dos bloques.

    Primero se van en tanda los que quedan lejos de la mediana. Eso limpia el
    caso normal —un bloque grande con varios intrusos— en dos o tres vueltas.
  */
  for (let vuelta = 0; vuelta < 6 && base.length > minimo; vuelta++) {
    const res = residuos(base, fit);
    const med = mediana(res);
    if (med <= CALZA) break;
    const corte = Math.max(med * 3, CALZA);
    const podado = base.filter((_, i) => res[i]! <= corte);
    if (podado.length === base.length || podado.length < minimo) break;
    const otro = ajustar(podado);
    if (!otro) break;
    descartados += base.length - podado.length;
    base = podado;
    fit = otro;
  }

  /*
    Y despues, de a uno, el que mas mejore el ajuste.

    Con pocos puntos un minimo cuadrado reparte el error del intruso entre
    todos y el intruso deja de destacarse: la tanda de arriba no lo ve, porque
    su residuo termina pareciendose al de los demas. Probar de a uno cuesta un
    ajuste por punto —con 130 trackers son milisegundos— y lo encuentra igual.
  */
  while (base.length > minimo) {
    const med = mediana(residuos(base, fit));
    if (med <= CALZA) break;
    let mejor = -1;
    let mejorMed = med;
    for (let i = 0; i < base.length; i++) {
      const podado = base.filter((_, j) => j !== i);
      const otro = ajustar(podado);
      if (!otro) continue;
      const m = mediana(residuos(podado, otro));
      if (m < mejorMed) { mejorMed = m; mejor = i; }
    }
    // Se saca solo si la mejora es de otra escala. Bajar un 10% es el ajuste
    // acomodandose, no un tracker que sobra.
    if (mejor < 0 || mejorMed > med * 0.5) break;
    const podado = base.filter((_, j) => j !== mejor);
    const otro = ajustar(podado);
    if (!otro) break;
    base = podado;
    fit = otro;
    descartados++;
  }

  const res = residuos(base, fit);
  const cX = base.reduce((s, p) => s + p.X, 0) / base.length;
  const cY = base.reduce((s, p) => s + p.Y, 0) / base.length;
  const disp = base.reduce((s, p) => s + (p.X - cX) ** 2 + (p.Y - cY) ** 2, 0) / base.length;

  return {
    A: [[fit.sx[0]!, fit.sx[1]!], [fit.sy[0]!, fit.sy[1]!]],
    // La MEDIANA del residuo, no la media cuadratica: un tracker mal
    // emparejado no puede condenar un bloque que por lo demas calza exacto.
    error: mediana(res),
    escala: Math.sqrt(disp),
    descartados,
  };
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

/** El error de ajuste que se tolera, como fraccion del tamano del bloque. */
const ERROR_TOLERADO = 0.15;

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
    const puntos = [...porTracker.entries()].map(([n, g]) => ({
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

    const ajuste = apoyar(puntos);
    if (!ajuste || ajuste.escala <= 0 || ajuste.error > ajuste.escala * ERROR_TOLERADO) {
      detalles.push({ block: b.block, filas: 0, motivo: "lamina-sin-orientar",
        detail: ajuste
          ? `El dibujo no se apoya sobre las coordenadas de este bloque: quedan ${ajuste.error.toFixed(1)} m ` +
            `de error sobre ${ajuste.escala.toFixed(0)} m de bloque. Puede ser que el plano y el ` +
            `relevamiento numeren los trackers distinto. No se toca nada.`
          : `Los trackers de este bloque estan todos sobre una misma linea en el dibujo, asi que no ` +
            `alcanza para orientarlo. No se toca nada.`,
      });
      continue;
    }

    const { A } = ajuste;
    const enTerreno = (d: { dx: number; dy: number }) => ({
      X: A[0][0] * d.dx + A[0][1] * d.dy,
      Y: A[1][0] * d.dx + A[1][1] * d.dy,
    });
    const largos: number[] = [];
    for (const r of filas) {
      const d = cajaDeLaFila(r);
      if (d) { const v = enTerreno(d); largos.push(Math.hypot(v.X, v.Y)); }
    }
    const umbral = mediana(largos) * MINIMO_RELATIVO;

    let escritas = 0;
    let flojas = 0;
    let cruzadas = 0;
    for (const fila of filas) {
      const d = cajaDeLaFila(fila);
      if (!d) continue;
      const v = enTerreno(d);
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
    ].filter(Boolean).join(", ");

    detalles.push({
      block: b.block,
      filas: escritas,
      motivo: escritas ? "resuelto" : "sin-cajas",
      detail: escritas
        ? `${escritas} filas quedaron con la punta de entrada medida contra la caja dibujada` +
          (ajuste.descartados
            ? `; el dibujo calzo sobre las coordenadas con ${ajuste.error.toFixed(1)} m de error, dejando ` +
              `afuera ${ajuste.descartados} trackers que no se corresponden`
            : `; el dibujo calzo sobre las coordenadas con ${ajuste.error.toFixed(1)} m de error`) +
          (salteadas ? `; se saltearon ${salteadas}` : "") + "."
        : `Ninguna caja de este bloque cae lo bastante lejos del centro de su tracker, y a lo largo ` +
          `de la fila, como para decir de que punta es.`,
    });
  }

  return { origins, bloques: detalles };
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
