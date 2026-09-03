/**
 * Que defecto es, sacado de la FORMA de la mancha caliente.
 *
 * De donde sale esto: la empresa de termografia que trabaja en Edenvale
 * entrega 3.156 hallazgos clasificados, y al mirar el archivo aparecio lo
 * unico que hacia falta saber — NO clasifican por temperatura. Las medianas de
 * ΔT por tipo se pisan todas entre si:
 *
 *     Foreign object   2,6 K   (0,5 a 49,0)
 *     Multi hotspot    2,6 K   (0,5 a 22,2)
 *     Isolated         5,1 K   (0,6 a 10,6)
 *     Bypass diode     5,3 K   (1,3 a 10,3)
 *
 * Un "foreign object" de 49 K y un "isolated" de 0,6 K en el mismo archivo. Si
 * el criterio fuera un umbral, eso seria imposible. Lo que los separa es la
 * GEOMETRIA del patron, que es la que delata la falla electrica:
 *
 *     una celda caliente                 -> punto caliente
 *     varias celdas dispersas            -> celda multiple
 *     una franja de 1/3 o 1/2 del modulo -> diodo de bypass (es una substring)
 *     el modulo entero, parejo           -> modulo completo, circuito abierto
 *
 * Y eso el motor lo puede medir, porque ya tiene los pixeles crudos de cada
 * modulo. Es la diferencia entre revisar tres mil paneles a mano y revisar una
 * muestra.
 *
 * Lo que NO se clasifica aca, a proposito
 * ---------------------------------------
 * Suciedad, objeto encima, vegetacion y vidrio roto dan manchas termicamente
 * IGUALES a las de arriba: lo unico que las separa es lo que el analista ve en
 * la foto visible. Y la verificacion de campo del propio archivo dice cuanto
 * vale eso: de 16 "foreign object" revisados, los 16 eran suciedad. 16 de 16.
 * Inventar esa etiqueta desde la termica seria copiar el error de otro.
 *
 * Cuando el patron es de celda o de celdas, esta funcion dice "punto caliente"
 * o "celda multiple" —que es lo que la termica sabe— y deja que la persona
 * decida, mirando la foto, si ademas es suciedad o algo apoyado encima.
 */

/** El patron que se ve, no la causa. */
export type Patron =
  | "punto-caliente"
  | "celda-multiple"
  | "diodo"
  | "modulo-completo"
  | "sin-patron";

/**
 * Cuanta confianza tiene la clasificacion.
 *
 * No es un adorno: decide que se acepta sin mirar y que va si o si a la
 * revision humana. Y las tres categorias no valen lo mismo — la verificacion
 * de campo del informe de la otra empresa lo muestra:
 *
 *     diodo de bypass   151 de 155 confirmados
 *     multi hotspot      41 de 71 confirmados (17 "nada visible", 11 suciedad)
 *
 * O sea: la franja del diodo es geometria dura y aguanta. Un punto caliente
 * chico es justo lo que se confunde con una mancha de tierra.
 */
export type Confianza = "alta" | "media" | "baja";

export interface Clasificacion {
  patron: Patron;
  confianza: Confianza;
  /** La anomalia de la lista de la app, para poder precargarla. */
  anomalia?: string;
  /** Por que dio eso. Va en pantalla: una etiqueta sin motivo no se puede discutir. */
  porQue: string;
  /** Que fraccion del modulo esta caliente, de 0 a 1. */
  fraccionCaliente: number;
  /** Cuantas manchas separadas hay. */
  grumos: number;
}

export interface Retrato {
  /** Temperaturas del modulo, en una grilla de su propio marco. */
  celdas: Float32Array;
  /** A lo largo del lado LARGO del modulo (donde caen las substrings). */
  filas: number;
  /** A lo ancho del lado corto. */
  columnas: number;
}

/**
 * Cuanto tiene que despegarse un pedazo del modulo para contarlo caliente.
 *
 * Tres kelvin sobre la mediana del PROPIO modulo. Es deliberadamente mas alto
 * que el ruido de una termica de esta clase (unos 50 mK de NETD) y mas bajo
 * que cualquiera de los patrones reales: una franja de diodo corre 5 a 10 K
 * sobre el resto y una celda en corto, decenas.
 */
export const UMBRAL_PATRON_K = 3;

/**
 * Desde que fraccion se considera que el modulo entero esta caliente.
 *
 * Con dos tercios de la superficie despegada ya no hay "una mancha": el modulo
 * no esta entregando corriente. Es el patron mas frecuente del informe real
 * —768 de 3.156— y el unico que la norma marca como critico.
 */
export const FRACCION_MODULO_ENTERO = 0.66;

/**
 * La temperatura de referencia DENTRO del modulo: el percentil 25.
 *
 * Estaba la mediana y tiene un punto ciego que aparecio probando: la mediana
 * sigue a la mayoria. Si dos de las tres substrings estan puenteadas, dos
 * tercios del modulo estan calientes, la mediana cae ADENTRO de esa zona, y el
 * modulo aparece sin ninguna mancha — justo el defecto mas grande no se ve.
 *
 * El percentil 25 se queda en la parte fria mientras haya al menos un cuarto de
 * modulo sano, que es lo que pasa en todos los patrones reales. Y cuando NO
 * queda nada frio —el modulo entero caliente y parejo— tampoco hace falta:
 * ese caso se reconoce desde afuera, comparandolo con sus hermanos de string.
 */
const referencia = (a: ArrayLike<number>): number => {
  const v = Array.from(a).sort((x, y) => x - y);
  if (!v.length) return NaN;
  return v[Math.min(v.length - 1, Math.round((v.length - 1) * 0.25))]!;
};

/**
 * Cuantas manchas separadas hay, por vecindad de a cuatro.
 *
 * De a cuatro y no de a ocho: dos celdas que solo se tocan por la esquina son
 * dos defectos, no uno. Con vecindad de ocho, una diagonal de celdas sueltas
 * —el caso tipico de "celda multiple"— se cuenta como una sola mancha y se
 * clasifica como punto caliente.
 */
function contarGrumos(calientes: boolean[], filas: number, columnas: number): number {
  const visto = new Array(filas * columnas).fill(false);
  let grumos = 0;
  for (let i = 0; i < filas * columnas; i++) {
    if (!calientes[i] || visto[i]) continue;
    grumos++;
    const pila = [i];
    visto[i] = true;
    while (pila.length) {
      const p = pila.pop()!;
      const f = Math.floor(p / columnas), c = p % columnas;
      for (const [df, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nf = f + df, nc = c + dc;
        if (nf < 0 || nf >= filas || nc < 0 || nc >= columnas) continue;
        const q = nf * columnas + nc;
        if (calientes[q] && !visto[q]) { visto[q] = true; pila.push(q); }
      }
    }
  }
  return grumos;
}

/**
 * Si las celdas calientes forman una FRANJA a lo ancho del modulo.
 *
 * Es la firma del diodo de bypass y la mas confiable de todas: un diodo puentea
 * una substring entera, que fisicamente es un bloque de celdas que ocupa TODO
 * el ancho del modulo y un tercio (o la mitad) de su largo. Ninguna otra falla
 * dibuja eso.
 *
 * Se pide que la franja cruce el modulo entero —no basta con que sea alargada—
 * y que ocupe entre un sexto y dos tercios del otro lado. Menos de un sexto es
 * una celda estirada; mas de dos tercios ya es el modulo entero.
 */
function franja(
  calientes: boolean[],
  filas: number,
  columnas: number,
): { hay: boolean; desde: number; hasta: number; de: number } {
  /*
    Se prueban los DOS sentidos.

    Antes se buscaba la franja en un solo eje del retrato, y eso da por sentado
    como estan cableadas las substrings y como esta montado el modulo — dos
    cosas que cambian entre fabricantes y entre parques. Un modulo de media
    celda tiene seis substrings en vez de tres, y montado de la otra manera la
    franja cruza el retrato al reves.

    Costo real de suponerlo: en el vuelo del 3 de septiembre, la franja de
    diodo que Mateo fotografio a mano cruzaba el retrato en el eje que no se
    miraba. Salio clasificada como "punto caliente, mancha chica" y con la
    confianza en baja.
  */
  const derecho = franjaEnUnEje(calientes, filas, columnas, false);
  if (derecho.hay) return derecho;
  return franjaEnUnEje(calientes, filas, columnas, true);
}

function franjaEnUnEje(
  calientes: boolean[],
  filas: number,
  columnas: number,
  transpuesto: boolean,
): { hay: boolean; desde: number; hasta: number; de: number } {
  const largoDelEje = transpuesto ? columnas : filas;
  const anchoDelEje = transpuesto ? filas : columnas;
  const esta = (a: number, b: number) =>
    transpuesto ? calientes[b * columnas + a]! : calientes[a * columnas + b]!;

  const cruza = Array.from({ length: largoDelEje }, (_, f) => {
    let n = 0;
    for (let c = 0; c < anchoDelEje; c++) if (esta(f, c)) n++;
    return n >= Math.ceil(anchoDelEje * 0.8);
  });

  let mejor = { hay: false, desde: -1, hasta: -1, de: largoDelEje };
  let desde = -1;
  for (let f = 0; f <= largoDelEje; f++) {
    if (f < largoDelEje && cruza[f]) { if (desde < 0) desde = f; continue; }
    if (desde >= 0) {
      const largo = f - desde;
      const frac = largo / largoDelEje;
      if (frac >= FRACCION_MINIMA_DE_FRANJA && frac <= FRACCION_MODULO_ENTERO &&
          largo > (mejor.hasta - mejor.desde)) {
        mejor = { hay: true, desde, hasta: f - 1, de: largoDelEje };
      }
      desde = -1;
    }
  }
  return mejor;
}

/**
 * Lo mas angosta que puede ser una franja y seguir siendo una substring.
 *
 * Un quinto. Se probo bajarlo a un sexto para que entraran los modulos de
 * media celda, que tienen seis substrings en vez de tres, y sobre el vuelo
 * real eso llevo los hallazgos de 7 a 20 — y diecisiete de los veinte decian
 * exactamente "17 % del largo", o sea UNA celda del retrato.
 *
 * No eran substrings: era el borde de la caja. La caja mide el 60 % central
 * del modulo, asi que su borde cae adentro del panel y cualquier gradiente
 * —el riel, la sombra del marco, el hueco al vecino— dibuja ahi una raya
 * angosta que cruza de lado a lado y se parece a una substring.
 *
 * O sea que a esta resolucion no se puede distinguir una substring de media
 * celda del borde de la propia caja. Con un quinto la franja tiene que ocupar
 * al menos dos celdas del retrato, y eso el borde no lo hace.
 */
const FRACCION_MINIMA_DE_FRANJA = 0.2;

/**
 * Que defecto es, mirando la forma.
 *
 * `deltaTContraElString` entra porque una de las cuatro respuestas no se puede
 * ver adentro del modulo: un modulo desconectado esta caliente y PAREJO, o sea
 * que su retrato interno no tiene ninguna mancha. Se lo reconoce por estar
 * entero por encima de sus hermanos de string, que es una comparacion de
 * afuera. Sin ese dato, un modulo entero caliente se clasificaria "sin patron".
 */
export function clasificarPatron(
  retrato: Retrato,
  deltaTContraElString: number,
  opts: { umbralK?: number; umbralModuloEnteroK?: number } = {},
): Clasificacion {
  const { celdas, filas, columnas } = retrato;
  const umbral = opts.umbralK ?? UMBRAL_PATRON_K;
  const umbralEntero = opts.umbralModuloEnteroK ?? 2;

  const base = referencia(celdas);
  const calientes = Array.from(celdas, (t) => t - base >= umbral);
  const n = calientes.filter(Boolean).length;
  const fraccionCaliente = n / celdas.length;
  const grumos = contarGrumos(calientes, filas, columnas);

  const sinMancha = { fraccionCaliente, grumos };

  /*
    El modulo entero primero, porque es el unico que se ve de AFUERA.

    Un modulo desconectado esta caliente y parejo: adentro no hay ninguna
    mancha que encontrar. Buscarle forma primero lo dejaria en "sin patron", y
    es justo el caso mas frecuente y el unico critico.
  */
  if (fraccionCaliente >= FRACCION_MODULO_ENTERO || (n === 0 && deltaTContraElString >= umbralEntero)) {
    return {
      ...sinMancha,
      patron: "modulo-completo",
      confianza: deltaTContraElString >= umbralEntero ? "alta" : "media",
      anomalia: "Modulo completo",
      porQue:
        `El módulo está caliente, ${deltaTContraElString.toFixed(1)} °C por encima de sus ` +
        `hermanos de string, y sin ninguna mancha adentro. Eso es un módulo que no entrega ` +
        `corriente: circuito abierto.`,
    };
  }

  if (n === 0) {
    return {
      ...sinMancha,
      patron: "sin-patron",
      confianza: "baja",
      porQue:
        "No se ve ninguna zona despegada adentro del módulo ni el módulo entero está por encima " +
        "de sus vecinos. Puede ser un hallazgo de borde o una diferencia de encuadre.",
    };
  }

  const banda = franja(calientes, filas, columnas);
  if (banda.hay) {
    const parte = (banda.hasta - banda.desde + 1) / banda.de;
    return {
      ...sinMancha,
      patron: "diodo",
      // Es el patron mas duro que hay: en el informe real, 151 de 155
      // confirmados en campo.
      confianza: "alta",
      anomalia: "Diodo de bypass",
      porQue:
        `Hay una franja caliente que cruza el módulo de lado a lado y ocupa ` +
        `${Math.round(parte * 100)} % de su largo. Eso es una substring entera, que es lo que ` +
        `puentea un diodo de bypass.`,
    };
  }

  if (grumos >= 2) {
    return {
      ...sinMancha,
      patron: "celda-multiple",
      // La verificacion de campo del informe real: 41 de 71 confirmados, 17
      // "nada visible" y 11 eran suciedad. Casi un 40 % mal.
      confianza: "baja",
      anomalia: "Celda multiple",
      porQue:
        `Hay ${grumos} zonas calientes separadas, sin forma de franja. Puede ser celdas fisuradas, ` +
        `pero también suciedad o algo apoyado encima: eso solo se decide mirando la foto.`,
    };
  }

  return {
    ...sinMancha,
    patron: "punto-caliente",
    confianza: fraccionCaliente <= 0.08 ? "media" : "baja",
    anomalia: "Punto caliente",
    porQue:
      `Hay una sola zona caliente, chica (${Math.round(fraccionCaliente * 100)} % del módulo) y ` +
      `sin cruzar de lado a lado. Mirá la foto: una mancha de tierra se ve igual en la térmica.`,
  };
}


// ---------------------------------------------------------------------------
// Que tan urgente es
// ---------------------------------------------------------------------------

/**
 * La clase IEC, que es lo que el cliente de verdad usa.
 *
 * La pregunta fue "esta parte no la entiendo para que sirve", y la respuesta es
 * que es la columna mas util de todo el entregable — y estaba mal puesta.
 *
 * La anomalia dice QUE tiene el panel; la clase dice QUE HACER y CUANDO:
 *
 *     1  no hay nada que hacer, queda de linea de base
 *     2  se arregla en el proximo mantenimiento programado
 *     3  hay que ir ahora
 *
 * El que recibe el informe no sale a caminar por "diodo de bypass": sale por
 * los de clase 3. Es lo que convierte una lista de defectos en un plan de
 * trabajo.
 *
 * Por que dejo de preguntarse
 * ---------------------------
 * Porque no es una decision: sale de lo que ya esta medido. La forma dice
 * cuanto del modulo se perdio y el ΔT dice si ademas hay riesgo. Pedirla a mano
 * en tres mil paneles es el mismo trabajo que se acaba de sacar con la anomalia
 * — y encima invita a lo que hace la empresa de al lado, que la resuelve con
 * una tabla fija por tipo de anomalia: en sus 3.156 filas, Severity e IEC salen
 * 1 a 1 del Anomaly Type, sin una sola excepcion. O sea que su columna no
 * aporta NADA que no estuviera en la anterior: un multi hotspot de 22 K les
 * queda "Minor" y un isolated de 0,6 K "Critical". No sirve para priorizar en
 * campo, que es para lo unico que existe la columna.
 *
 * Aca sale de la forma Y del numero, asi que dos hallazgos del mismo tipo con
 * temperaturas distintas pueden caer en clases distintas — que es justamente lo
 * que se le pide.
 */
export interface ClaseSugerida {
  klass: 1 | 2 | 3;
  porQue: string;
}

export function claseSugerida(args: {
  patron: Patron;
  /** Cuanto se despega el modulo de sus hermanos de string. */
  deltaT: number;
  /** Cuanto se despega el punto mas caliente del propio modulo. */
  deltaInterno?: number;
  /** Los mismos umbrales con los que se clasifica la severidad del vuelo. */
  criticaModulo: number;
  criticaInterna: number;
}): ClaseSugerida {
  const { patron, deltaT, deltaInterno, criticaModulo, criticaInterna } = args;

  if (patron === "sin-patron") {
    return {
      klass: 1,
      porQue: "No se le encontró ningún patrón ni diferencia sostenida contra sus vecinos.",
    };
  }

  /*
    Clase 3 por TEMPERATURA, no por tipo.

    Una celda muy caliente es un riesgo fisico —se degrada el encapsulante y
    puede terminar en incendio—, y eso no depende de si la mancha es una celda o
    tres. Por eso el umbral manda sobre la forma.
  */
  if (deltaInterno != null && deltaInterno >= criticaInterna) {
    return {
      klass: 3,
      porQue:
        `El punto más caliente está ${deltaInterno.toFixed(0)} °C por encima del propio módulo. ` +
        `A esa temperatura el defecto no solo produce menos: degrada el panel y es riesgo de ` +
        `incendio. Hay que ir ahora.`,
    };
  }
  if (deltaT >= criticaModulo) {
    return {
      klass: 3,
      porQue:
        `El módulo está ${deltaT.toFixed(0)} °C por encima de sus hermanos de string, que es ` +
        `mucho más que una diferencia de producción. Hay que ir ahora.`,
    };
  }

  if (patron === "modulo-completo") {
    return {
      klass: 2,
      porQue:
        "El módulo no entrega corriente: se perdió entero, pero sin riesgo agudo. Se reemplaza en " +
        "el próximo mantenimiento programado.",
    };
  }
  if (patron === "diodo") {
    return {
      klass: 2,
      porQue:
        "Con el diodo puenteando, ese tercio del módulo dejó de producir y no se recupera solo. " +
        "Se arregla en el próximo mantenimiento programado.",
    };
  }

  return {
    klass: 2,
    porQue:
      "Hay una diferencia sostenida contra sus vecinos, pero sin llegar al umbral de acción " +
      "inmediata. Se revisa en el próximo mantenimiento.",
  };
}
