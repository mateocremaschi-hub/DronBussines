/**
 * Proyeccion de un punto sobre el segmento de una fila de modulos.
 *
 * Es el nucleo geometrico del motor y no cambia nunca entre parques.
 */

export interface Projection {
  /** Parametro normalizado a lo largo del segmento, SIN recortar. */
  t: number;
  /** Distancia desde `a` hasta el pie de la perpendicular, en metros. Sin recortar. */
  alongM: number;
  /** Distancia perpendicular del punto al eje, en metros. Siempre positiva. */
  offAxisM: number;
  /** Pie de la perpendicular, en coordenadas locales. */
  foot: { x: number; y: number };
}

/**
 * Proyecta `p` sobre el segmento `a`->`b`.
 *
 * `t` no se recorta a propósito: un `t` fuera de [0,1] es informacion util —
 * significa que el punto cae mas alla de la punta del tracker, y el llamador
 * decide si eso amerita un warning o un descarte.
 */
export function projectOnSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): Projection {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;

  if (len2 === 0) {
    return { t: 0, alongM: 0, offAxisM: Math.hypot(p.x - a.x, p.y - a.y), foot: { ...a } };
  }

  const len = Math.sqrt(len2);
  const ux = dx / len;
  const uy = dy / len;

  const px = p.x - a.x;
  const py = p.y - a.y;

  const alongM = px * ux + py * uy;
  const offAxisM = Math.abs(px * uy - py * ux); // magnitud del producto cruz 2D

  return {
    t: alongM / len,
    alongM,
    offAxisM,
    foot: { x: a.x + ux * alongM, y: a.y + uy * alongM },
  };
}
