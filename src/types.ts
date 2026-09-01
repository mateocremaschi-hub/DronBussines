/**
 * Tipos publicos del motor.
 *
 * Regla estructural: este archivo no importa nada. El motor entero es una
 * funcion pura sobre estos tipos — sin red, sin base de datos, sin UI.
 */

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Un punto medido: foto del dron, GPS del celular, o coordenada pegada a mano. */
export interface Fix {
  lat: number;
  lon: number;
  /** Radio de error 1-sigma en metros. Sin RTK ronda 2-5 m. Default: `matching.defaultAccuracyM`. */
  accuracyM?: number;
  /** ISO 8601. Solo se arrastra al diagnostico; no afecta el calculo. */
  takenAt?: string;
}

// ---------------------------------------------------------------------------
// Geometria de entrada (lo que produce la capa de ingesta)
// ---------------------------------------------------------------------------

export type EndRef = "start" | "end";
export type Cardinal = "north" | "south" | "east" | "west";

/**
 * Una fila de modulos: el segmento fisico entre las dos picas.
 *
 * Es la unidad atomica de geometria. Una farm de 400.000 modulos son unos
 * 6.000 de estos — unos pocos MB, que entran enteros en un celular.
 */
export interface TrackerRow {
  /** Identificador estable. Sugerido: `${block}-${tracker}-${row}`. */
  id: string;
  block: string;
  tracker: string;
  /** Etiqueta de fila dentro del tracker: "R1", "R4"... Ausente si el parque no las usa. */
  row?: string;

  /** Pica A. El orden de los extremos es arbitrario: lo normaliza el motor. */
  start: { lat: number; lon: number };
  /** Pica B. */
  end: { lat: number; lon: number };

  /** Lado de la calle donde esta el tracker. Lo usa la estrategia `dc-box-end`. */
  side?: Cardinal;

  /** Posicion del tracker dentro de su linea electrica, 1-based. Lo usa `piercing-chain`. */
  pos?: number;
  /** Cantidad total de trackers en esa linea. Lo usa `piercing-chain`. */
  posTotal?: number;

  /** Numeros de string presentes en esta fila, en cualquier orden. Ej: [5, 6]. */
  stringNumbers?: number[];
  /** Etiquetas completas de esos strings, en el MISMO orden. Ej: ["S-1.2.15.1", …]. */
  stringLabels?: string[];

  /**
   * Los strings de esta fila ordenados DESDE EL NORTE, medidos contra el plano.
   *
   * Existe porque el orden no se puede deducir del numero. El compilador
   * ordenaba ascendente asumiendo "el menor va primero", que era cierto
   * mientras el conteo arrancara en la caja de continua. Contando desde el
   * norte, esa suposicion da vuelta la etiqueta del string en toda fila cuya
   * caja este al sur: el mismo panel pasa de "string 5, modulo 1" a "string 6,
   * modulo 28". El numero de modulo es una convencion que se puede declarar;
   * la etiqueta del string es un dato del cliente y no se puede inventar.
   *
   * Y tampoco alcanza con invertir la convencion, porque no hay una: Edenvale
   * y Wellington numeran distinto. El plano de interconexion dibuja cada
   * etiqueta encima de la mitad que le toca, asi que se mide. Ver
   * `app/cajas.ts`.
   */
  stringsDesdeElNorte?: string[];

  /**
   * Como se llama la caja de continua de la que cuelga esta fila. Ej: DCB-5.1.3.
   *
   * Es por donde se entra caminando. El plano de interconexion la trae, y hasta
   * ahora se la contaba —"N filas con caja de continua"— y se la tiraba: no
   * quedaba en ningun lado, ni en la fila, ni en la direccion, ni en el CSV.
   */
  dcBoxLabel?: string;

  /**
   * Cual de las geometrias del parque es esta fila, si el parque tiene varias.
   *
   * Un parque puede mezclar dos tipos de tracker en los mismos bloques, en la
   * misma lista de strings y en los mismos planos: unos largos de 56 modulos y
   * otros cortos de 28. Partirlo en dos parques significaria subir los planos
   * dos veces y cortar la lista de strings a mano, asi que el tipo va por fila.
   *
   * Casi nunca hace falta escribirlo: si no viene, el compilador elige la
   * variante cuyo largo predicho se parece mas al largo MEDIDO de la fila, que
   * es un dato que ya esta en el archivo de picas. Un tracker de 28 mide 32 m y
   * uno de 56 mide 65: no hay forma de confundirlos.
   */
  variantId?: string;

  /** Salida de emergencia de `per-row-flag`: que extremo del segmento es el origen. */
  originEnd?: EndRef;
  /**
   * Salida de emergencia de `per-string-flag`: por cada chunk de la fila
   * (0 = el mas cercano al origen), si cuenta invertido.
   */
  stringInverted?: boolean[];

  /** Paso a medida real de esta fila, si difiere del perfil. En milimetros. */
  pitchMmOverride?: number;
}

// ---------------------------------------------------------------------------
// Perfil de parque
// ---------------------------------------------------------------------------

/**
 * Un tipo de tracker distinto dentro del mismo parque.
 *
 * Solo lo que cambia. Lo que no se declara se hereda del tipo principal.
 */
export interface TopologyVariant {
  /** Identificador corto y estable. Ej: "corto". */
  id: string;
  /** Como llamarlo en pantalla. Ej: "Tracker corto de 28". */
  name?: string;
  modulesPerString?: number;
  stringsPerRow?: number;
  stringGapMm?: number;
  gaps?: Array<{ afterModule: number; mm: number }>;
  /** Ancho del modulo sobre el eje, si esta variante usa otro panel. */
  moduleWidthMm?: number;
  /** Paso explicito, si difiere. */
  pitchMm?: number | null;
  /** Offset de pica, si difiere. */
  endpointOffsetMm?: number;
}

export type OriginStrategyName = "fixed-end" | "dc-box-end" | "per-row-flag";
export type InversionStrategyName = "none" | "piercing-chain" | "per-string-flag";

export interface FarmProfile {
  id: string;
  name: string;
  profileVersion: number;
  timezone?: string;

  crs?:
    | { type: "wgs84" }
    | { type: "utm"; zone: number; hemisphere: "N" | "S" };

  module: {
    /** Medida del modulo a lo largo del eje del tracker, en mm. */
    widthMm: number;
    /** Hueco entre modulos consecutivos, en mm. */
    gapMm: number;
    /** Solo informativo: cual lado del modulo va sobre el eje. */
    orientation?: "portrait" | "landscape";
    /**
     * Paso explicito en mm. `null` = widthMm + gapMm.
     * `"derive"` = calcularlo del largo real de cada segmento.
     */
    pitchMm?: number | null | "derive";
    /**
     * Largo del modulo sobre el eje CORTO de la fila, en mm.
     *
     * Es la otra dimension del panel: si `widthMm` es lo que ocupa a lo largo
     * del tracker, esta es lo que sobresale hacia los costados. Un panel comun
     * mide 2278 x 1134, asi que segun como se monte una de las dos es el ancho
     * y la otra este largo.
     *
     * No es decorativo: es la mitad de la caja con la que se mide la
     * temperatura de cada modulo en la foto termica. Estuvo como constante
     * 2.28 adentro del codigo de analisis, y en un parque con paneles apaisados
     * la caja salia cuadrada sobre un modulo que no lo es.
     */
    lengthMm?: number;
    /**
     * Lado de una celda, en mm. Por defecto 160.
     *
     * No es decorativo: es lo que decide si un vuelo puede ver un punto
     * caliente de una sola celda o no. Una celda de 160 mm a 10 cm por pixel
     * entra en un pixel y medio, y a esa resolucion el defecto llega al sensor
     * ya promediado con lo que lo rodea. Se declara porque cambia entre
     * fabricantes —M6 son 166, M10 son 182, las de media celda la mitad— y
     * porque de aca sale el limite de altura del vuelo.
     */
    cellMm?: number;
  };

  topology: {
    modulesPerString: number;
    stringsPerRow: number;
    /**
     * Los OTROS tipos de tracker del mismo parque.
     *
     * Un parque real no siempre es un solo racking. Hay sitios con trackers
     * largos en el campo abierto y cortos contra el limite del terreno o en las
     * puntas de fila, mezclados en los mismos bloques, en la misma lista de
     * strings y en los mismos planos de interconexion.
     *
     * Sin esto habia que dar de alta el parque DOS VECES: subir los mismos
     * planos dos veces, cortar la lista de strings a mano, y terminar con dos
     * parques en la app para un solo sitio — con los vuelos y los informes
     * partidos al medio. Eso no es una limitacion tecnica, es un dia
     * de trabajo perdido cada vez.
     *
     * Los campos que no se declaran en una variante se heredan del tipo
     * principal: casi siempre cambia la cantidad de modulos y los huecos, no el
     * panel ni el offset de pica.
     */
    variants?: TopologyVariant[];
    /**
     * Espacio libre entre un string y el siguiente de la misma fila, en mm.
     *
     * No es el huequito entre modulos: es el bahia donde va el motor que mueve
     * el tracker. En Edenvale son 3.7 m — mas de tres posiciones de modulo
     * vacias. Ignorarlo desplaza los modulos del string lejano por esa
     * distancia entera.
     */
    stringGapMm?: number;
    /**
     * Los huecos grandes, uno por uno, cuando no caen en los limites de string.
     *
     * Hay trackers donde el primer panel va solo, despues un hueco, despues
     * todos los demas, y otro hueco antes del ultimo — el accionamiento o los
     * apoyos estan en las puntas, no en el medio. Eso no se puede escribir con
     * `stringGapMm`, que reparte huecos iguales entre strings iguales.
     *
     * Cada entrada dice despues de que modulo de la fila cae el hueco, contando
     * desde el extremo de conteo, y cuanto mide. Una fila de 30 con el primero
     * y el ultimo aparte:
     *
     *     gaps: [ { afterModule: 1, mm: 900 }, { afterModule: 29, mm: 900 } ]
     *
     * Si se declara, MANDA sobre `stringGapMm`. Para un parque normal no hace
     * falta: dos strings iguales con una bahia en el medio se siguen
     * declarando con dos numeros y se expanden solos.
     */
    gaps?: Array<{ afterModule: number; mm: number }>;
    rowNaming?: {
      pattern?: string;
      motorized?: string[];
      slave?: string[];
      /**
       * Cual de las filas de un tracker es la motorizada, cuando la lista de
       * strings y la geometria no comparten vocabulario.
       *
       * En Edenvale la lista numera las filas de corrido por bloque —el
       * tracker 33 tiene la R1, el 34 la R2 y la R3, el 35 la R4 y la R5— asi
       * que ninguna lista de R fijas las une con motorizada/esclava: cambiaria
       * en cada bloque. Lo que si se conserva es el orden adentro del tracker.
       */
      orderWithinTracker?: "lowest-first" | "highest-first";
    };
  };

  geometry: {
    source?: "survey-stakes" | "cad" | "orthomosaic" | "manual";
    /**
     * Distancia de la pica al borde del primer modulo, en mm.
     *
     * NEGATIVO si los modulos sobresalen mas alla de la pica, que es el caso
     * de Edenvale: la pica queda 1464 mm adentro, debajo del segundo modulo.
     */
    endpointOffsetMm: number;
    /**
     * A que extremos se aplica el offset:
     * `both` en las dos puntas, `origin` solo en el extremo de conteo,
     * `none` si los modulos arrancan pegados al punto del archivo.
     *
     * `centered` es distinto: no usa `endpointOffsetMm` para nada. Calcula
     * cuanto miden los modulos con el paso declarado y los centra en el largo
     * real de cada fila, repartiendo la diferencia entre las dos puntas.
     *
     * Sirve para el caso mas comun y mas confuso: un archivo de replanteo que
     * marca las PUNTAS DE LA FILA. Ahi el offset es un residuo de pocos
     * milimetros que no vale la pena declarar, y peor todavia, invita a
     * confundirlo con la distancia a la primera pila —que es otra cosa, porque
     * el modulo de la punta va en voladizo sobre ella—. Centrando, ese numero
     * deja de existir y cada fila se acomoda sola.
     */
    endpointOffsetMode?: "both" | "origin" | "none" | "centered";
    /**
     * Tolerancia al comparar el largo predicho por el paso contra el largo
     * real del segmento, en mm por modulo. Arriba de esto se emite un warning.
     */
    lengthToleranceMmPerModule?: number;
  };

  addressing: {
    originStrategy: OriginStrategyName;
    /** Config de `fixed-end`: que extremo geografico es el origen. */
    fixedEnd?: Cardinal;
    /**
     * Config de `dc-box-end`: donde estan las cajas DC respecto de los dos
     * lados. `"center-road"` = en la calle del medio, asi que el extremo de
     * conteo es el opuesto al lado del tracker.
     */
    dcBoxPlacement?: "center-road" | "outer-edge";

    inversionStrategy: InversionStrategyName;
  };

  matching?: {
    /** Distancia maxima plausible al eje de una fila. Arriba de esto no se responde. */
    maxDistanceM?: number;
    /** Cuantos modulos vecinos devolver a cada lado del mejor resultado. */
    neighborhood?: number;
    /** Cuantas filas candidatas evaluar ademas de la mejor. */
    maxRowCandidates?: number;
    /** Precision asumida cuando el Fix no la trae, en metros. */
    defaultAccuracyM?: number;
  };

  calibration?: {
    status?: "unverified" | "partial" | "field-verified";
    verifiedCases?: string[];
    unverified?: string[];
    notes?: string;
  };
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

/** Desde que extremo del string se contaron los modulos hasta llegar a este. */
export type CountedFrom = "near-dc" | "far-end";

export interface Address {
  rowId: string;
  block: string;
  tracker: string;
  row?: string;

  /** Indice del chunk dentro de la fila: 0 = el mas cercano al origen. */
  chunkIndex: number;
  /** Numero de string real, si la ingesta lo trajo. Si no, `chunkIndex + 1`. */
  stringNumber: number;
  /** Etiqueta completa del string, solo si hay lista de strings importada. */
  stringLabel?: string;
  /** Nombre de la caja de continua por la que se entra, si el plano la trajo. */
  dcBoxLabel?: string;
  /** Serial, solo si hay lista de paneles importada. */
  serial?: string;

  /** 1 … modulesPerString. */
  module: number;
  countedFrom: CountedFrom;
  /**
   * Desde que punta FISICA de la fila se conto este modulo, dicha por su rumbo.
   *
   * `countedFrom` dice "cerca de la caja" o "en la punta lejana", y eso solo es
   * cierto cuando el parque cuenta desde la caja de continua. Un parque que
   * cuenta desde el norte —lo normal, porque la punta norte sale de las dos
   * picas y no depende de ningun plano— hacia que esa frase mintiera: mandaba
   * a contar desde la caja una fila que se numera al reves. En una fila de
   * 65 m eso es el error mas caro que puede cometer la app, porque es la unica
   * frase que el tecnico ejecuta caminando.
   *
   * Este campo no interpreta nada: mira las dos puntas de la fila y dice cual
   * es la que se uso.
   */
  origenGeografico?: "norte" | "sur" | "este" | "oeste";

  /** Posicion cruda dentro de la fila, 1 … modulesPerString * stringsPerRow. */
  positionInRow: number;

  /** Centro estimado del modulo. */
  center: { lat: number; lon: number };
  /** Distancia del Fix al centro del modulo, en metros. */
  distanceM: number;
  /** Distancia del Fix al eje de la fila, en metros. */
  offAxisM: number;
  /** 0 … 1, normalizada sobre el conjunto de candidatos. */
  confidence: number;
}

export type WarningCode =
  | "no-row-within-range"
  | "outside-row-extent"
  | "length-mismatch"
  | "low-confidence"
  | "ambiguous"
  | "missing-side"
  | "missing-chain-position"
  | "missing-flag"
  | "in-string-gap"
  /** La coordenada cae al costado del eje de la fila, no sobre la mesa. */
  | "off-axis"
  /** El modulo elegido esta mas lejos de lo que explica el error del GPS. */
  | "far-from-module"
  /**
   * Se pidio contar desde un rumbo geografico, pero la fila casi no corre en
   * ese eje: sus dos puntas estan a la misma latitud (o longitud) y elegir
   * "la punta norte" seria decidirlo con el ruido del relevamiento.
   */
  | "origin-ambiguous";

export interface Warning {
  code: WarningCode;
  message: string;
  rowId?: string;
}

export interface Diagnostics {
  farmId: string;
  profileVersion: number;
  /** Marco local usado para proyectar. */
  origin: { lat: number; lon: number };
  /** Punto del Fix en metros dentro del marco local. */
  local: { x: number; y: number };
  /** Filas evaluadas tras el descarte por caja envolvente. */
  rowsConsidered: number;
  /**
   * La fila mas cercana de todo el parque, cuando no hubo ninguna en rango.
   *
   * Solo se calcula cuando hace falta: es lo que permite distinguir "te faltan
   * 30 metros" de "estas del otro lado del mundo porque la zona UTM esta mal".
   */
  nearestRow?: { rowId: string; distanceM: number };
  /** Detalle del calculo sobre la fila ganadora. */
  winner?: {
    rowId: string;
    /** Parametro normalizado 0-1 a lo largo del segmento, desde `start`. */
    t: number;
    /** Distancia recorrida desde el origen de conteo, en metros. */
    alongFromOriginM: number;
    /** Largo del segmento pica a pica, en metros. */
    segmentLengthM: number;
    /** Paso efectivamente usado, en metros. */
    pitchM: number;
    /** Offset de pica aplicado en el extremo de origen, en metros. */
    originOffsetM: number;
    /** Que extremo del segmento resulto ser el origen de conteo. */
    originEnd: EndRef;
    originStrategy: OriginStrategyName;
    inversionStrategy: InversionStrategyName;
    inverted: boolean;
    /** Residuo entre el largo predicho y el real, en mm por modulo. */
    lengthResidualMmPerModule: number;
  };
}

export interface LocateResult {
  best: Address | null;
  candidates: Address[];
  diagnostics: Diagnostics;
  warnings: Warning[];
}

// ---------------------------------------------------------------------------
// Perfil compilado
// ---------------------------------------------------------------------------

export interface CompiledRow {
  source: TrackerRow;
  /** Extremos en el marco local, en metros. */
  a: { x: number; y: number };
  b: { x: number; y: number };
  lengthM: number;
  /** Vector unitario de a hacia b. */
  ux: number;
  uy: number;
  /** Caja envolvente en el marco local, ya expandida por maxDistanceM. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Paso resuelto para esta fila, en metros. */
  pitchM: number;

  /**
   * La geometria de ESTA fila, ya resuelta.
   *
   * Antes estos tres numeros se leian del perfil del parque en cada consulta,
   * lo que daba por sentado que todas las filas eran iguales. Con dos tipos de
   * tracker mezclados eso numera los cortos como si fueran largos.
   */
  modulesPerString: number;
  stringsPerRow: number;
  modulesPerRow: number;
  /** Los huecos grandes de esta fila, en metros. */
  huecosM: Array<{ afterModule: number; m: number }>;
  /** Ancho del modulo de esta fila, en metros. */
  moduleWidthM: number;
  /** Que variante se le aplico, y si se eligio sola o vino declarada. */
  variantId?: string;
  variantName?: string;
  originOffsetM: number;
  farOffsetM: number;
  /** Numeros de string ordenados ascendente: el menor es el mas cercano al origen. */
  stringNumbers: number[];
  /** Etiquetas completas, reordenadas junto con los numeros. */
  stringLabels?: string[];
  lengthResidualMmPerModule: number;

  /**
   * Extremo de conteo ya resuelto. La capa de estrategias corre entera al
   * compilar, no al consultar: si a una fila le falta un dato, te enteras al
   * cargar el parque y no con el tecnico parado en el campo.
   */
  originEnd: EndRef;
  /** Por cada chunk (0 = el mas cercano al origen), si cuenta invertido. */
  inverted: boolean[];
  /** Lo que dijo la capa de estrategias al resolver esta fila. */
  strategyWarnings: Warning[];
}

export interface CompiledFarm {
  profile: Required<Pick<FarmProfile, "id" | "name" | "profileVersion">> & FarmProfile;
  rows: CompiledRow[];
  origin: { lat: number; lon: number };
  /** Escalas del marco local equirectangular, en metros por radian. */
  scale: { east: number; north: number };
  modulesPerRow: number;
  /** Medida del modulo a lo largo del eje, en metros. */
  moduleWidthM: number;
  maxDistanceM: number;
  /**
   * Cuanto puede diferir el largo medido de una fila del largo que sale de la
   * geometria, por modulo, antes de avisar. Resuelto al compilar para que el
   * motor no tenga que volver a decidir el valor por omision.
   */
  lengthToleranceMmPerModule: number;
  neighborhood: number;
  maxRowCandidates: number;
  defaultAccuracyM: number;
  /** Warnings detectados al compilar, no al consultar. */
  buildWarnings: Warning[];
}
