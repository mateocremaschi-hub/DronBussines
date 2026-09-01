/**
 * El teclado de la revision.
 *
 * Un vuelo de un bloque grande deja cientos de modulos para mirar, y el
 * operador los revisa sentado en la computadora, uno atras del otro. Con el
 * mouse eso son cuatro clicks por hallazgo —elegirlo, elegir la anomalia,
 * elegir la clase, confirmar— repetidos cuatrocientas veces. Con el teclado son
 * tres teclas sin sacar la vista de la foto.
 *
 * La logica vive aca afuera del componente por dos razones: se puede probar sin
 * navegador, y —mas importante— la lista de atajos deja de estar escondida
 * adentro de un `switch` en medio del render. La ayuda que se muestra en
 * pantalla sale de la MISMA tabla, asi que no puede quedar desactualizada.
 */

/** Las anomalias que tienen tecla propia, en orden. */
export const ANOMALIAS_RAPIDAS = [
  // El `patron` es como se ve en la foto. Es lo que decide cual es, y va en el
  // boton en vez de en un parrafo abajo de cada imagen: se lee cuando se lo
  // necesita y no ocupa lugar el resto del tiempo.
  { tecla: "q", nombre: "Punto caliente", patron: "una celda puntual, mucho mas caliente que el resto" },
  { tecla: "w", nombre: "Diodo de bypass", patron: "un tercio de la placa parejo, mas caliente" },
  { tecla: "e", nombre: "Modulo completo", patron: "el modulo entero tibio: suele estar desconectado" },
  { tecla: "r", nombre: "String completo", patron: "toda la corrida caliente: es una conexion, no el panel" },
] as const;

export type Accion =
  | { tipo: "mover"; delta: number }
  | { tipo: "confirmar" }
  | { tipo: "descartar" }
  | { tipo: "clase"; klass: 1 | 2 | 3 }
  | { tipo: "anomalia"; nombre: string }
  | { tipo: "nota" }
  | { tipo: "salir" }
  | { tipo: "ayuda" };

/** Lo que se muestra en la barra de ayuda. Sale de la misma tabla que actua. */
export const AYUDA: Array<{ teclas: string; hace: string }> = [
  { teclas: "↑ ↓", hace: "moverse por la lista" },
  { teclas: "Enter", hace: "confirmar y pasar al siguiente" },
  { teclas: "X", hace: "descartar y pasar al siguiente" },
  { teclas: "1 2 3", hace: "clase IEC" },
  ...ANOMALIAS_RAPIDAS.map((a) => ({ teclas: a.tecla.toUpperCase(), hace: a.nombre.toLowerCase() })),
  { teclas: "N", hace: "escribir una nota" },
  { teclas: "Esc", hace: "salir del campo de texto" },
  { teclas: "?", hace: "mostrar u ocultar esta ayuda" },
];

/** Si el foco esta en algo donde las letras son texto y no atajos. */
export function escribiendo(el: unknown): boolean {
  const e = el as { tagName?: string; isContentEditable?: boolean } | null;
  if (!e) return false;
  if (e.isContentEditable) return true;
  const t = (e.tagName ?? "").toUpperCase();
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
}

export interface TeclaLeida {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Donde estaba el foco. Con el foco en un campo, las letras se escriben. */
  target?: unknown;
}

/**
 * Que hay que hacer con esta tecla, o `null` si no es un atajo.
 *
 * Con el foco adentro de un campo de texto lo unico que sigue vivo es Escape:
 * si no, escribir "no se ve bien" en la nota descarta el hallazgo con la x,
 * le pone clase 3 con el 3 y salta cuatro veces con las flechas.
 */
export function accionDeTecla(e: TeclaLeida): Accion | null {
  // Los atajos del navegador y del sistema no se tocan.
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  if (escribiendo(e.target)) return e.key === "Escape" ? { tipo: "salir" } : null;

  switch (e.key) {
    case "ArrowDown": case "j": case "J": return { tipo: "mover", delta: 1 };
    case "ArrowUp": case "k": case "K": return { tipo: "mover", delta: -1 };
    case "PageDown": return { tipo: "mover", delta: 10 };
    case "PageUp": return { tipo: "mover", delta: -10 };
    case "Enter": return { tipo: "confirmar" };
    case "x": case "X": case "Delete": case "Backspace": return { tipo: "descartar" };
    case "1": return { tipo: "clase", klass: 1 };
    case "2": return { tipo: "clase", klass: 2 };
    case "3": return { tipo: "clase", klass: 3 };
    case "n": case "N": return { tipo: "nota" };
    case "?": return { tipo: "ayuda" };
    case "Escape": return { tipo: "salir" };
  }

  const rapida = ANOMALIAS_RAPIDAS.find((a) => a.tecla === e.key.toLowerCase());
  return rapida ? { tipo: "anomalia", nombre: rapida.nombre } : null;
}
