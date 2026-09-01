/**
 * Estrategias de origen: desde que extremo fisico del segmento se cuenta.
 *
 * Es una de las dos unicas cosas que pueden requerir codigo nuevo al dar de
 * alta un parque. Por eso son un registro de estrategias con nombre y no
 * condicionales sueltos: un segundo parque con el mismo racking hereda la
 * estrategia gratis.
 */

import type { EndRef, FarmProfile, TrackerRow, Warning } from "../types.js";

export interface OriginContext {
  row: TrackerRow;
  /** `true` si el extremo `start` esta mas al norte que `end`. */
  startIsNorth: boolean;
  /** `true` si el extremo `start` esta mas al este que `end`. */
  startIsEast: boolean;
  /**
   * Cuanto de la fila corre en cada eje, como fraccion de su largo (0 a 1).
   *
   * Sirve para saber si el rumbo pedido esta bien definido. En un parque de
   * trackers la fila SIEMPRE corre norte-sur —el eje tiene que girar de este a
   * oeste para seguir al sol— asi que `norteSur` va a dar casi 1. Si alguna vez
   * entra un parque de estructura fija, donde las filas corren este-oeste,
   * "la punta norte" deja de significar algo y hay que decirlo en vez de
   * contestar cualquier cosa.
   */
  alineacion?: { norteSur: number; esteOeste: number };
}

export interface OriginResult {
  end: EndRef;
  warnings: Warning[];
}

/**
 * Cuanto tiene que correr la fila sobre el eje pedido para que el rumbo
 * signifique algo. 0,25 son unos 75 grados de desvio: una fila de trackers da
 * casi 1, y una de estructura fija puesta al reves da casi 0.
 */
const ALINEACION_MINIMA = 0.25;

/** Que extremo del segmento apunta al rumbo pedido. */
function endTowards(ctx: OriginContext, dir: "north" | "south" | "east" | "west"): EndRef {
  switch (dir) {
    case "north":
      return ctx.startIsNorth ? "start" : "end";
    case "south":
      return ctx.startIsNorth ? "end" : "start";
    case "east":
      return ctx.startIsEast ? "start" : "end";
    case "west":
      return ctx.startIsEast ? "end" : "start";
  }
}

/** El rumbo opuesto: hacia donde queda la calle si el tracker esta en `side`. */
const opposite = { north: "south", south: "north", east: "west", west: "east" } as const;

export function resolveOriginEnd(
  ctx: OriginContext,
  addressing: FarmProfile["addressing"],
): OriginResult {
  const warnings: Warning[] = [];
  const rowId = ctx.row.id;

  switch (addressing.originStrategy) {
    // -----------------------------------------------------------------------
    case "fixed-end": {
      // El caso simple: todo el parque cuenta desde el mismo extremo geografico.
      const dir = addressing.fixedEnd;
      if (!dir) {
        warnings.push({
          code: "missing-flag",
          rowId,
          message:
            'La estrategia "fixed-end" necesita addressing.fixedEnd (north | south | east | west). Uso el extremo `start`.',
        });
        return { end: "start", warnings };
      }
      /*
        La guarda: que el rumbo pedido este bien definido para esta fila.

        No se asume que la fila corra norte-sur: se mide. Si las dos puntas
        estan casi a la misma latitud, "la punta norte" la decide el ruido del
        relevamiento, y de ahi sale un numero de modulo que puede estar dado
        vuelta entero. Es preferible avisar.
      */
      const eje = dir === "north" || dir === "south" ? "norteSur" : "esteOeste";
      const alineado = ctx.alineacion?.[eje];
      if (alineado != null && alineado < ALINEACION_MINIMA) {
        warnings.push({
          code: "origin-ambiguous",
          rowId,
          message:
            `La fila no corre ${dir === "north" || dir === "south" ? "norte-sur" : "este-oeste"}: ` +
            `sus dos puntas estan casi a la misma ${dir === "north" || dir === "south" ? "latitud" : "longitud"}. ` +
            `Contar "desde el ${dir}" en esta fila es arbitrario.`,
        });
      }
      return { end: endTowards(ctx, dir), warnings };
    }

    // -----------------------------------------------------------------------
    case "dc-box-end": {
      // El modulo 1 se cuenta desde la caja DC de la fila. Con las cajas en la
      // calle del medio, el extremo de conteo es el OPUESTO al lado del
      // tracker: un tracker del lado norte cuenta desde su punta sur, y al
      // reves del otro lado de la calle.
      const side = ctx.row.side;
      if (!side) {
        warnings.push({
          code: "missing-side",
          rowId,
          message:
            'La estrategia "dc-box-end" necesita el campo `side` de la fila. Uso el extremo `start`.',
        });
        return { end: "start", warnings };
      }
      const placement = addressing.dcBoxPlacement ?? "center-road";
      const towards = placement === "center-road" ? opposite[side] : side;
      return { end: endTowards(ctx, towards), warnings };
    }

    // -----------------------------------------------------------------------
    case "per-row-flag": {
      // La salida de emergencia: si un parque tiene una regla que todavia no
      // entendemos, se expresa como dato en vez de esperar codigo nuevo.
      const flag = ctx.row.originEnd;
      if (!flag) {
        warnings.push({
          code: "missing-flag",
          rowId,
          message:
            'La estrategia "per-row-flag" necesita `originEnd` en la fila. Uso el extremo `start`.',
        });
        return { end: "start", warnings };
      }
      return { end: flag, warnings };
    }
  }
}
