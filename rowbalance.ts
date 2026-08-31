/**
 * El cuadre de la fila: sumar el fierro y compararlo con lo que mide.
 *
 * Esta pieza existe por un error que costo meses y conviene dejarlo escrito
 * para no repetirlo.
 *
 * Las cantidades de una fila estan atadas:
 *
 *     modulos + huecos + bahia + 2 x offset  =  largo de pica a pica
 *
 * Conociendo todas menos una, la que falta SALE DESPEJADA. Y ahi esta la
 * trampa: un numero despejado siempre cierra, porque se calculo justamente
 * para cerrar. Cerrar no lo hace correcto — no es evidencia de nada.
 *
 * En Edenvale se despejo una bahia de motor de 3713 mm suponiendo que el
 * modulo sobresalia 1464 mm de la pica. El total daba exacto en las 3182
 * filas, asi que parecia confirmado. Despues la cinta dijo que la bahia mide
 * 555 mm. Los dos modelos cierran los 65145 mm y colocan cada modulo con
 * metro y medio de diferencia: el total nunca los pudo distinguir.
 *
 * Por eso este modulo no despeja nada. Suma lo que hay, lo compara con lo
 * medido, y dice cuanto sobra o falta — en milimetros y en posiciones de
 * modulo, que es la unidad en la que se nota el error en el campo.
 */

export interface ParteDeFila {
  concepto: string;
  cantidad: number;
  cadaUnoMm: number;
  totalMm: number;
  /** Si el numero salio de una cinta o de una suposicion. */
  medido: boolean;
}

export interface EntradaCuadre {
  modulosPorFila: number;
  stringsPorFila: number;
  anchoModuloMm: number;
  huecoEntreModulosMm: number;
  /** El hueco entre un string y el siguiente. Se ignora si vienen `huecos`. */
  bahiaMm: number;
  /**
   * Los huecos grandes uno por uno, cuando no caen en los limites de string.
   *
   * Si vienen, mandan sobre `bahiaMm` y `stringsPorFila`: hay trackers donde
   * el primer panel va solo y el hueco esta despues del modulo 1, no en el
   * medio de la fila.
   */
  huecos?: Array<{ afterModule: number; mm: number }>;
  /**
   * Distancia de la pica al borde del modulo mas cercano.
   * Positivo = la pica queda por FUERA, los modulos entran.
   * Negativo = la pica queda por DENTRO, los modulos sobresalen.
   */
  offsetMm: number;
  /**
   * A que puntas aplica el offset, igual que `geometry.endpointOffsetMode`.
   *
   * Esto NO es un detalle de presentacion. El cuadre sumaba siempre dos veces
   * el offset declarado, pero el motor no lo usa asi: en `origin` lo aplica en
   * una sola punta y en `centered` lo IGNORA por completo y reparte lo que
   * sobra. Con el preset PVH —que viene centrado— la tabla mostraba un offset
   * de -25 mm que no movia un solo modulo, y el residuo que mostraba no era el
   * residuo real. Un cuadre que miente es peor que no tener cuadre.
   */
  modo?: "both" | "origin" | "none" | "centered";
  /** Largo real de pica a pica, en metros. */
  largoMedidoM: number;
  /** Cuales de los parametros se midieron con cinta. */
  medidos?: Partial<Record<"ancho" | "hueco" | "bahia" | "offset", boolean>>;
}

export interface CuadreDeFila {
  partes: ParteDeFila[];
  /** Lo que suma el fierro, sin contar el offset. */
  fierroMm: number;
  /** Lo que deberia medir de pica a pica con el offset declarado. */
  predichoMm: number;
  medidoMm: number;
  /** Medido menos predicho. Cero es que cierra. */
  residuoMm: number;
  residuoEnModulos: number;
  cierra: boolean;
  /** Cuantos de los parametros vienen de una cinta. */
  medidos: number;
  total: number;
  /**
   * En modo centrado el residuo se reparte solo, asi que el cuadre cierra
   * siempre. Esto es lo que de verdad hay que mirar ahi: cuanto se esta
   * repartiendo en cada punta. `null` en los demas modos.
   */
  repartoPorPuntaMm: number | null;
  notas: string[];
}

/** Cuanto puede sobrar sin que importe: un decimo de modulo. */
const TOLERANCIA_MM = 120;

export function cuadreDeFila(e: EntradaCuadre): CuadreDeFila {
  const m = e.medidos ?? {};
  // Los huecos grandes: enumerados si vienen, o los limites de string si no.
  const grandes = e.huecos?.length
    ? e.huecos.map((h) => h.mm)
    : Array.from({ length: Math.max(0, e.stringsPorFila - 1) }, () => e.bahiaMm);
  // Cada hueco grande reemplaza a un huequito, no se le suma.
  const huecosInternos = Math.max(0, e.modulosPorFila - 1 - grandes.length);

  const partes: ParteDeFila[] = [
    {
      concepto: "Modulos",
      cantidad: e.modulosPorFila,
      cadaUnoMm: e.anchoModuloMm,
      totalMm: e.modulosPorFila * e.anchoModuloMm,
      medido: !!m.ancho,
    },
    {
      concepto: "Huecos entre modulos",
      cantidad: huecosInternos,
      cadaUnoMm: e.huecoEntreModulosMm,
      totalMm: huecosInternos * e.huecoEntreModulosMm,
      medido: !!m.hueco,
    },
  ];
  // Se agrupan por tamano: dos bahias de 555 son una linea, y una de 900 con
  // otra de 540 son dos. Asi el cuadre se lee igual en el caso normal y no
  // esconde que los huecos son distintos cuando lo son.
  const porTamano = new Map<number, number>();
  for (const mm of grandes) porTamano.set(mm, (porTamano.get(mm) ?? 0) + 1);
  // "Bahia entre strings" solo cuando de verdad lo son. Si los huecos se
  // enumeraron es porque NO caen en los limites de string — llamarlos igual
  // seria describir mal justo el caso raro que se declaro para no equivocarse.
  const enumerados = !!e.huecos?.length;
  const variosTamanos = porTamano.size > 1;
  for (const [mm, cantidad] of [...porTamano].sort((a, b) => b[0] - a[0])) {
    partes.push({
      concepto: !enumerados
        ? "Bahia entre strings"
        : variosTamanos ? `Huecos grandes de ${mm} mm` : "Huecos grandes",
      cantidad,
      cadaUnoMm: mm,
      totalMm: cantidad * mm,
      medido: !!m.bahia,
    });
  }

  const fierroMm = partes.reduce((s, p) => s + p.totalMm, 0);
  const medidoMm = e.largoMedidoM * 1000;
  const modo = e.modo ?? "both";

  // Cuantas puntas se llevan el offset, y con que valor. Centrado no usa el
  // valor declarado: lo despeja de lo que sobra, que es exactamente lo que
  // hace el motor.
  const puntas = modo === "none" ? 0 : modo === "origin" ? 1 : 2;
  const repartoPorPuntaMm = modo === "centered" ? (medidoMm - fierroMm) / 2 : null;
  const offsetEfectivoMm = repartoPorPuntaMm ?? e.offsetMm;

  if (puntas > 0) {
    partes.push({
      concepto:
        modo === "centered"
          ? "Se reparte solo en las dos puntas (centrado)"
          : offsetEfectivoMm >= 0
            ? `Pica por fuera del modulo${puntas === 1 ? " (solo la punta de conteo)" : ""}`
            : `Modulo sobresale de la pica${puntas === 1 ? " (solo la punta de conteo)" : ""}`,
      cantidad: puntas,
      cadaUnoMm: offsetEfectivoMm,
      totalMm: puntas * offsetEfectivoMm,
      // Centrado despeja el numero, asi que no puede venir de una cinta por
      // mas que la casilla este tildada: marcarlo como medido seria contar
      // como evidencia justo lo que se calculo para que cierre.
      medido: modo === "centered" ? false : !!m.offset,
    });
  }

  const predichoMm = fierroMm + puntas * offsetEfectivoMm;
  const residuoMm = medidoMm - predichoMm;
  const paso = e.anchoModuloMm + e.huecoEntreModulosMm;
  const residuoEnModulos = residuoMm / Math.max(1, paso);
  const cierra = Math.abs(residuoMm) <= TOLERANCIA_MM;

  const medidos = partes.filter((p) => p.medido).length;
  const total = partes.length;

  return {
    partes, fierroMm, predichoMm, medidoMm, residuoMm, residuoEnModulos, cierra,
    medidos, total, repartoPorPuntaMm,
    notas: notasDe({
      cierra, residuoMm, residuoEnModulos, medidos, total,
      offsetMm: offsetEfectivoMm, paso, repartoPorPuntaMm,
    }),
  };
}

function notasDe(x: {
  cierra: boolean; residuoMm: number; residuoEnModulos: number;
  medidos: number; total: number; offsetMm: number; paso: number;
  repartoPorPuntaMm?: number | null;
}): string[] {
  const notas: string[] = [];

  // Centrado cierra por construccion. Decir "la fila cierra" seria el peor
  // resultado posible de esta pantalla: el numero que la hace cerrar es el
  // unico que no se comparo con nada. Lo util es el tamano del reparto.
  if (x.repartoPorPuntaMm != null) {
    const porPunta = x.repartoPorPuntaMm;
    const enModulos = Math.abs(porPunta) / Math.max(1, x.paso);
    notas.push(
      `Este parque esta en modo centrado: los modulos se acomodan solos adentro del largo real de ` +
      `cada fila, asi que el numero de arriba NO se usa y esta cuenta cierra siempre. Cerrar aca no ` +
      `prueba nada. Lo que hay que mirar es cuanto se esta repartiendo: ` +
      `${porPunta.toFixed(0)} mm en cada punta.`,
    );
    if (enModulos >= 0.5) {
      notas.push(
        `Y eso es mucho: ${enModulos.toFixed(1)} de un modulo por punta. El centrado lo va a tapar ` +
        `igual, pero significa que falta un hueco por declarar o que sobra o falta un modulo por ` +
        `string. Revisalo antes de salir a campo.`,
      );
    } else {
      notas.push(
        `Son ${enModulos.toFixed(2)} de un modulo, o sea que la geometria declarada explica la fila ` +
        `entera. Igual, lo unico que decide de que punta se empieza a contar es un conteo en campo.`,
      );
    }
    return notas;
  }

  if (x.cierra) {
    notas.push(
      x.medidos >= x.total
        ? "La fila cierra y todos los numeros vienen de una cinta. Esto si es evidencia."
        : `La fila cierra, pero solo ${x.medidos} de ${x.total} numeros estan medidos. ` +
          "Un valor que se despejo para que cierre siempre cierra: no confirma nada. " +
          "Cerrar con numeros supuestos es lo mismo que no haber chequeado.",
    );
    return notas;
  }

  const cuantos = Math.abs(x.residuoEnModulos);
  const falta = x.residuoMm > 0;
  notas.push(
    `${falta ? "Sobran" : "Faltan"} ${Math.abs(x.residuoMm).toFixed(0)} mm, que son ` +
    `${cuantos.toFixed(1)} posiciones de modulo. Con esta diferencia, un modulo del medio de ` +
    `la fila se reporta con ${cuantos < 1.5 ? "uno o dos" : Math.round(cuantos)} numeros de error.`,
  );

  if (cuantos >= 0.5) {
    notas.push(
      falta
        ? "En la fila hay mas largo del que explican los modulos: o hay un hueco que no esta " +
          "declarado, o la pica cae mas afuera de lo que dice el offset."
        : "Los modulos no entran en el largo que tiene la fila: o el paso o la cantidad de " +
          "modulos por string estan de mas, o la pica cae mas adentro de lo que dice el offset.",
    );
    notas.push(
      "No lo arregles cambiando el numero que menos mediste hasta que cierre — asi se llego " +
      "a esto. Anda a la fila y mira donde esta ese largo.",
    );
  }
  return notas;
}
