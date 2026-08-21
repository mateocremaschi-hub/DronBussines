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
 *      los modulos sobresalen                 son 3.7 m donde va el motor
 *      1464 mm mas alla de la pica            que mueve el tracker
 */

export interface RowLayout {
  /** Modulos por string. */
  modulesPerString: number;
  /** Strings por fila. */
  stringsPerRow: number;
  /** Paso entre modulos consecutivos del mismo string, en metros. */
  pitchM: number;
  /** Ancho del modulo sobre el eje, en metros. */
  moduleWidthM: number;
  /** Largo de un string completo, en metros. */
  stringSpanM: number;
  /** Del arranque de un string al arranque del siguiente, en metros. */
  periodM: number;
  /** Del extremo de conteo al borde del primer modulo. Negativo = voladizo. */
  originOffsetM: number;
}

export function makeRowLayout(args: {
  modulesPerString: number;
  stringsPerRow: number;
  pitchM: number;
  moduleGapM: number;
  moduleWidthM: number;
  stringGapM: number;
  originOffsetM: number;
}): RowLayout {
  // n modulos con n-1 huequitos entre ellos.
  const stringSpanM = args.modulesPerString * args.pitchM - args.moduleGapM;
  return {
    modulesPerString: args.modulesPerString,
    stringsPerRow: args.stringsPerRow,
    pitchM: args.pitchM,
    moduleWidthM: args.moduleWidthM,
    stringSpanM,
    periodM: stringSpanM + args.stringGapM,
    originOffsetM: args.originOffsetM,
  };
}

/** Largo total que ocupan los modulos, de borde a borde, sin los offsets. */
export function moduleExtentM(l: RowLayout): number {
  return l.stringsPerRow * l.stringSpanM + (l.stringsPerRow - 1) * (l.periodM - l.stringSpanM);
}

export interface PositionHit {
  /** 1 … modulesPerString × stringsPerRow, contada desde el extremo de origen. */
  positionInRow: number;
  /** `true` si la distancia cae en la bahia del motor, entre dos strings. */
  inGap: boolean;
  /** Posicion continua sin recortar; util para detectar que el punto cae afuera. */
  raw: number;
}

/** Distancia desde el extremo de conteo → que modulo es. */
export function positionAtDistance(l: RowLayout, dFromOriginM: number): PositionHit {
  const total = l.modulesPerString * l.stringsPerRow;
  const dm = dFromOriginM - l.originOffsetM;

  const rawString = dm / l.periodM;
  const s = Math.min(Math.max(Math.floor(rawString), 0), l.stringsPerRow - 1);
  const within = dm - s * l.periodM;

  const inGap = within > l.stringSpanM && s < l.stringsPerRow - 1;
  const k = Math.floor(within / l.pitchM) + 1;

  const raw = s * l.modulesPerString + within / l.pitchM + 1;
  return {
    positionInRow: Math.min(Math.max(s * l.modulesPerString + k, 1), total),
    inGap,
    raw,
  };
}

/** Que modulo es → distancia de su centro desde el extremo de conteo. */
export function distanceAtPosition(l: RowLayout, positionInRow: number): number {
  const s = Math.floor((positionInRow - 1) / l.modulesPerString);
  const k = positionInRow - s * l.modulesPerString;
  return l.originOffsetM + s * l.periodM + (k - 1) * l.pitchM + l.moduleWidthM / 2;
}
