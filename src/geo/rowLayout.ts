/**
 * El reparto de modulos a lo largo de una fila.
 *
 * Vive en un solo archivo y en un solo par de funciones —una de ida y otra de
 * vuelta— porque el mayor riesgo de este calculo es que la version que ubica un
 * modulo y la que lo interpreta se desincronicen. Cuando eso pasa, el error es
 * de metros y no lo ve nadie hasta que alguien cuenta paneles con la mano.
 *
 * El modelo, verificado en campo en Edenvale:
 *
 *   pica ──┬─ voladizo ─┬── string 1 (28 modulos) ──┬─ bahia del motor ─┬── string 2 ──┬── pica
 *          │            │                           │                   │              │
 *      puede ser negativo:                    NO es el huequito entre modulos:
 *      los modulos sobresalen                 son 555 mm donde va el motor
 *      25 mm mas alla de la pica              que mueve el tracker
 *
 * Los huecos grandes NO tienen por que caer en los limites de string. Hay
 * trackers donde el primer panel va solo, despues un hueco, despues todos los
 * demas, y otro hueco antes del ultimo — porque el accionamiento o los apoyos
 * estan en las puntas. Por eso el reparto no se calcula con una formula
 * periodica sino con una TABLA de bordes: se declara despues de que modulo cae
 * cada hueco y cuanto mide, y las dos funciones leen la misma tabla. Una
 * formula periodica no puede representar eso, y peor, invita a forzar el caso
 * raro moviendo el paso hasta que cierre.
 *
 * El caso comun —strings iguales separados por bahias iguales— sigue
 * declarandose con dos numeros y se expande a la tabla solo. No hay que
 * enumerar nada a mano para un parque normal.
 */

/** Un hueco grande: despues de que modulo de la fila cae, y cuanto mide. */
export interface Hueco {
  /** 1 … total−1, contando desde el extremo de conteo. */
  afterModule: number;
  m: number;
}

export interface RowLayout {
  modulesPerString: number;
  stringsPerRow: number;
  /** Paso entre modulos consecutivos, en metros. */
  pitchM: number;
  /** Ancho del modulo sobre el eje, en metros. */
  moduleWidthM: number;
  /** Del extremo de conteo al borde del primer modulo. Negativo = voladizo. */
  originOffsetM: number;
  /** Total de modulos de la fila. */
  total: number;
  /**
   * Borde de arranque de cada modulo medido desde el extremo de conteo, ya con
   * el offset adentro. Es la unica fuente de verdad del reparto: las dos
   * funciones de abajo la leen, ninguna recalcula.
   */
  bordesM: number[];
  /** Espacio libre despues del modulo i+1. Vale para saber si un punto cae en un hueco grande. */
  libreM: number[];
  /** Largo total que ocupan los modulos, de borde a borde, sin los offsets. */
  extentM: number;
}

/**
 * Los huecos del caso comun: strings iguales separados por bahias iguales.
 *
 * Con 2 strings de 28 da un hueco despues del modulo 28. Con 3, dos huecos:
 * despues del 28 y del 56. Es la expansion del par (stringsPerRow, stringGapM)
 * a la tabla general, y existe para que declarar un parque normal siga siendo
 * dos numeros.
 */
export function huecosDeStrings(
  modulesPerString: number, stringsPerRow: number, stringGapM: number,
): Hueco[] {
  const out: Hueco[] = [];
  for (let s = 1; s < stringsPerRow; s++) {
    out.push({ afterModule: s * modulesPerString, m: stringGapM });
  }
  return out;
}

export function makeRowLayout(args: {
  modulesPerString: number;
  stringsPerRow: number;
  pitchM: number;
  moduleGapM: number;
  moduleWidthM: number;
  /** Los huecos grandes. Si no vienen, se expanden de stringGapM. */
  huecosM?: Hueco[];
  stringGapM?: number;
  originOffsetM: number;
}): RowLayout {
  const total = args.modulesPerString * args.stringsPerRow;
  const huecos =
    args.huecosM ??
    huecosDeStrings(args.modulesPerString, args.stringsPerRow, args.stringGapM ?? 0);

  // Indexado por "despues del modulo k" para no recorrer la lista en cada paso.
  const porModulo = new Map<number, number>();
  for (const h of huecos) porModulo.set(h.afterModule, (porModulo.get(h.afterModule) ?? 0) + h.m);

  const bordesM: number[] = new Array(total);
  const libreM: number[] = new Array(Math.max(0, total - 1));
  let x = args.originOffsetM;
  for (let i = 0; i < total; i++) {
    bordesM[i] = x;
    if (i < total - 1) {
      // Un hueco grande REEMPLAZA al huequito entre modulos, no se suma:
      // donde entra el motor no hay dos paneles casi tocandose.
      const grande = porModulo.get(i + 1);
      const libre = grande ?? args.moduleGapM;
      libreM[i] = libre;
      x += args.moduleWidthM + libre;
    }
  }

  const extentM = total
    ? bordesM[total - 1]! + args.moduleWidthM - bordesM[0]!
    : 0;

  return {
    modulesPerString: args.modulesPerString,
    stringsPerRow: args.stringsPerRow,
    pitchM: args.pitchM,
    moduleWidthM: args.moduleWidthM,
    originOffsetM: args.originOffsetM,
    total,
    bordesM,
    libreM,
    extentM,
  };
}

/** Largo total que ocupan los modulos, de borde a borde, sin los offsets. */
export function moduleExtentM(l: RowLayout): number {
  return l.extentM;
}

export interface PositionHit {
  /** 1 … total, contada desde el extremo de origen. */
  positionInRow: number;
  /** `true` si la distancia cae en un hueco grande, no sobre un modulo. */
  inGap: boolean;
  /** Posicion continua sin recortar; util para detectar que el punto cae afuera. */
  raw: number;
}

/**
 * Distancia desde el extremo de conteo → que modulo es.
 *
 * Busqueda binaria sobre la tabla de bordes. Con 56 modulos la diferencia con
 * recorrerla entera no se mide, pero la binaria deja de importar cuantos
 * modulos tenga la fila, y una fila de 120 en un parque grande se consulta
 * miles de veces por vuelo.
 */
export function positionAtDistance(l: RowLayout, dFromOriginM: number): PositionHit {
  if (!l.total) return { positionInRow: 1, inGap: false, raw: 1 };

  let lo = 0;
  let hi = l.total - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (l.bordesM[mid]! <= dFromOriginM) lo = mid; else hi = mid - 1;
  }

  const dentro = dFromOriginM - l.bordesM[lo]!;
  const pasado = dentro > l.moduleWidthM;
  // Cae despues del modulo `lo+1`: es hueco solo si ese espacio es un hueco
  // grande. El huequito entre modulos no cuenta — a esa escala el punto es del
  // modulo mas cercano, no de "el aire entre dos paneles".
  const inGap = pasado && lo < l.total - 1 && l.libreM[lo]! > l.moduleWidthM / 2;

  // Posicion continua, para poder decir "esta 0.3 modulos pasado el 12".
  const raw = lo + 1 + Math.min(dentro / Math.max(l.moduleWidthM, 1e-9), 1);

  return { positionInRow: lo + 1, inGap, raw };
}

/** Que modulo es → distancia de su centro desde el extremo de conteo. */
export function distanceAtPosition(l: RowLayout, positionInRow: number): number {
  const i = Math.min(Math.max(Math.round(positionInRow), 1), Math.max(l.total, 1)) - 1;
  return (l.bordesM[i] ?? l.originOffsetM) + l.moduleWidthM / 2;
}
