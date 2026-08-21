/**
 * Estrategias de inversion: si un string cuenta al reves que el resto de su fila.
 *
 * Contexto fisico verificado en campo (Edenvale, PVH):
 *
 * Una "linea" es una serie de trackers consecutivos alimentados por una misma
 * caja DC. Entre trackers consecutivos hay un piercing connector que lleva la
 * energia por un cable central. El modulo 1 de cada string se cuenta desde el
 * punto de conexion mas cercano: la caja DC para el string de aguas arriba, y
 * el piercing connector para el de aguas abajo.
 *
 * Consecuencia, y esto costo dos viajes al campo descubrirlo:
 *
 *   - Si el tracker NO es el ultimo de su linea, hay un piercing connector en
 *     su punta lejana, asi que el string lejano cuenta al reves: modulo 28
 *     cerca del medio, modulo 1 en la punta.
 *   - Si el tracker esta solo, o es el ultimo de su linea, no hay piercing
 *     propio en la punta y los dos strings cuentan en el mismo sentido.
 */

import type { FarmProfile, TrackerRow, Warning } from "../types.js";

export interface InversionResult {
  inverted: boolean;
  warnings: Warning[];
}

export function resolveInversion(
  row: TrackerRow,
  chunkIndex: number,
  addressing: FarmProfile["addressing"],
): InversionResult {
  const warnings: Warning[] = [];

  switch (addressing.inversionStrategy) {
    // -----------------------------------------------------------------------
    case "none":
      return { inverted: false, warnings };

    // -----------------------------------------------------------------------
    case "piercing-chain": {
      // El chunk pegado al origen siempre cuenta desde el origen.
      if (chunkIndex === 0) return { inverted: false, warnings };

      const { pos, posTotal } = row;
      if (pos == null || posTotal == null) {
        warnings.push({
          code: "missing-chain-position",
          rowId: row.id,
          message:
            'La estrategia "piercing-chain" necesita `pos` y `posTotal` en la fila para saber si el tracker es el ultimo de su linea. Asumo que no invierte.',
        });
        return { inverted: false, warnings };
      }

      // Ultimo de la linea (o solo) -> sin piercing propio en la punta.
      return { inverted: pos < posTotal, warnings };
    }

    // -----------------------------------------------------------------------
    case "per-string-flag": {
      const flags = row.stringInverted;
      const flag = flags?.[chunkIndex];
      if (flag == null) {
        warnings.push({
          code: "missing-flag",
          rowId: row.id,
          message: `La estrategia "per-string-flag" necesita stringInverted[${chunkIndex}] en la fila. Asumo que no invierte.`,
        });
        return { inverted: false, warnings };
      }
      return { inverted: flag, warnings };
    }
  }
}

/**
 * A que chunk (string) de la fila pertenece una posicion cruda.
 *
 * Se resuelve antes que la inversion, porque la inversion depende del chunk.
 */
export function chunkOf(positionInRow: number, modulesPerString: number): number {
  return Math.floor((positionInRow - 1) / modulesPerString);
}

/**
 * Traduce una posicion cruda dentro de la fila al par (chunk, modulo).
 *
 * `positionInRow` va de 1 a `modulesPerString * stringsPerRow`, contada
 * SIEMPRE desde el extremo de origen ya resuelto.
 */
export function splitPosition(
  positionInRow: number,
  modulesPerString: number,
  inverted: boolean,
): { chunkIndex: number; module: number } {
  const chunkIndex = Math.floor((positionInRow - 1) / modulesPerString);
  const withinChunk = positionInRow - chunkIndex * modulesPerString; // 1 … modulesPerString
  const module = inverted ? modulesPerString - withinChunk + 1 : withinChunk;
  return { chunkIndex, module };
}
