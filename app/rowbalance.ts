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
  /** El hueco entre un string y el siguiente. */
  bahiaMm: number;
  /**
   * Distancia de la pica al borde del modulo mas cercano.
   * Positivo = la pica queda por FUERA, los modulos entran.
   * Negativo = la pica queda por DENTRO, los modulos sobresalen.
   */
  offsetMm: number;
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
  notas: string[];
}

/** Cuanto puede sobrar sin que importe: un decimo de modulo. */
const TOLERANCIA_MM = 120;

export function cuadreDeFila(e: EntradaCuadre): CuadreDeFila {
  const m = e.medidos ?? {};
  const porString = Math.max(1, Math.round(e.modulosPorFila / Math.max(1, e.stringsPorFila)));
  const huecosInternos = (porString - 1) * e.stringsPorFila;
  const bahias = Math.max(0, e.stringsPorFila - 1);

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
  if (bahias > 0) {
    partes.push({
      concepto: "Bahia entre strings",
      cantidad: bahias,
      cadaUnoMm: e.bahiaMm,
      totalMm: bahias * e.bahiaMm,
      medido: !!m.bahia,
    });
  }

  const fierroMm = partes.reduce((s, p) => s + p.totalMm, 0);

  partes.push({
    concepto: e.offsetMm >= 0 ? "Pica por fuera del modulo" : "Modulo sobresale de la pica",
    cantidad: 2,
    cadaUnoMm: e.offsetMm,
    totalMm: 2 * e.offsetMm,
    medido: !!m.offset,
  });

  const predichoMm = fierroMm + 2 * e.offsetMm;
  const medidoMm = e.largoMedidoM * 1000;
  const residuoMm = medidoMm - predichoMm;
  const paso = e.anchoModuloMm + e.huecoEntreModulosMm;
  const residuoEnModulos = residuoMm / Math.max(1, paso);
  const cierra = Math.abs(residuoMm) <= TOLERANCIA_MM;

  const medidos = partes.filter((p) => p.medido).length;
  const total = partes.length;

  return {
    partes, fierroMm, predichoMm, medidoMm, residuoMm, residuoEnModulos, cierra,
    medidos, total,
    notas: notasDe({ cierra, residuoMm, residuoEnModulos, medidos, total, offsetMm: e.offsetMm, paso }),
  };
}

function notasDe(x: {
  cierra: boolean; residuoMm: number; residuoEnModulos: number;
  medidos: number; total: number; offsetMm: number; paso: number;
}): string[] {
  const notas: string[] = [];

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
