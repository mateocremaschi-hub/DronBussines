/**
 * Planificacion del vuelo: de la geometria del parque a la ruta del dron.
 *
 * Esto se puede hacer bien porque el parque ya esta cargado. No hay que
 * dibujar un poligono a mano sobre un mapa satelital: las filas de modulos
 * dicen exactamente donde estan los paneles y hacia donde apuntan, asi que las
 * lineas de vuelo salen paralelas a las filas solas.
 *
 * Dos decisiones que estan metidas en el codigo y conviene que se vean:
 *
 *   - Se planifica para la camara TERMICA, no para la visible. La termica es
 *     de mucha menor resolucion, asi que su huella en el suelo es mas chica y
 *     necesita mas lineas. Un vuelo planificado con la visible deja huecos en
 *     la termica, que es la que importa.
 *   - Se informa cuantos PIXELES le tocan a cada modulo. Es el numero que
 *     decide si el vuelo sirve: con pocos pixeles por modulo, un punto
 *     caliente de una celda no se distingue del ruido por mas que la foto
 *     exista.
 */

import { makeFrame, toGeo, toLocal } from "@locator";
import type { FarmProfile, LatLon, TrackerRow } from "@locator";

const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Camara
// ---------------------------------------------------------------------------

export interface Camera {
  name: string;
  /** Ancho de la imagen en pixeles. */
  imageW: number;
  imageH: number;
  /** Campo de vision horizontal y vertical, en grados. */
  hfovDeg: number;
  vfovDeg: number;
  /**
   * Que aeronave lleva esta camara, por el id de `PERFILES_DJI`.
   *
   * La camara y el dron no son dos elecciones: son una. La pantalla tenia dos
   * listas sueltas —el sensor con el que se planifica y el dron con el que se
   * exporta— y se podia planificar con la huella de un 4T y exportar el archivo
   * de un Mavic 3T. Eso no falla al exportar: falla en el campo, con las lineas
   * separadas para una camara y el dron llevando otra.
   *
   * Sin id, la camara vuela en algo que este archivo no sabe describir en WPML
   * —el H30T va en un Matrice 350 o 400— y ahi hay que decirlo en vez de
   * ofrecer el perfil equivocado.
   */
  djiId?: string;
  /**
   * Los intervalos de disparo que acepta la camara, en segundos.
   *
   * No es un dato de ficha tecnica al pedo: es lo que pone el TECHO a la
   * velocidad de vuelo. El plan pide una foto cada tantos metros, y si a la
   * velocidad elegida eso cae por debajo del intervalo mas corto que la camara
   * sabe hacer, el dron simplemente saca menos fotos que las que el plan
   * supone. No da error: deja huecos.
   */
  intervalosS?: number[];
  /**
   * Minutos que vuela una bateria llena, sin viento, segun la ficha.
   *
   * Es el numero de la ficha y no el util: el util se deriva abajo, para que
   * la reserva y el traslado se vean como decisiones y no queden escondidos
   * adentro de una constante.
   */
  minutosDeVuelo?: number;
  /** Minutos que tarda el cargador en dejar una bateria lista para volar. */
  minutosDeCarga?: number;
}

/**
 * Cuanto tarda un microbolometro sin refrigerar en "ver" la escena, en
 * segundos.
 *
 * Una termica no tiene obturador: cada pixel es un termistor que se calienta y
 * se enfria, y tarda del orden de 10 ms en llegar a su valor. Durante esos 10
 * ms el dron se movio, asi que cada pixel promedia una franja de terreno.
 *
 * Y el arrastre no molesta por "salir movida": APLANA EL PICO. La celda
 * caliente es lo mas chico y lo mas caliente de la escena, o sea justo lo que
 * un promedio se come primero — y ese pico es la medicion.
 *
 * El numero conservador para un VOx sin refrigerar es 12 ms; se usa ese y no
 * el optimista de 8 para que el aviso salte antes y no despues.
 */
export const SEGUNDOS_DE_INTEGRACION = 0.012;

/**
 * Presets sacados de las fichas oficiales.
 *
 * OJO con el dato que se carga: las fichas publican el campo de vision
 * DIAGONAL (DFOV) y lo que necesita el calculo es el horizontal y el vertical.
 * Confundirlos infla la huella y separa las lineas de mas — o sea, deja
 * HUECOS. Y un hueco no falla el dia del vuelo: aparece meses despues, cuando
 * alguien busca un panel y no hay foto. Por eso se derivan del diagonal con
 * la relacion de aspecto del sensor, en vez de cargarse a mano.
 */
function desdeDiagonal(name: string, dfovDeg: number, imageW: number, imageH: number, djiId?: string): Camera {
  const d = Math.hypot(imageW, imageH);
  const t = Math.tan((dfovDeg * Math.PI) / 180 / 2);
  const grados = (x: number) => (2 * Math.atan(t * x)) / RAD;
  return { name, imageW, imageH, hfovDeg: grados(imageW / d), vfovDeg: grados(imageH / d), ...(djiId ? { djiId } : {}) };
}

/** Diagonal de un cuadro de 35 mm, que es la referencia de la equivalencia. */
const DIAGONAL_35MM = Math.hypot(36, 24);

/**
 * La camara, sacada de la propia foto.
 *
 * Toda camara escribe en el EXIF su distancia focal equivalente a 35 mm, y de
 * ahi sale el campo de vision exacto sin depender de ninguna ficha. Es la
 * unica forma de no equivocarse: las fichas publican el angulo DIAGONAL, las
 * paginas de terceros lo copian mal, y un angulo mal cargado separa las lineas
 * de mas y deja huecos.
 *
 * Verificado contra las fotos reales de Edenvale: la camara visible del M3T
 * declara 24 mm y da DFOV 84.1, que es exactamente lo que publica DJI. Y la
 * termica declara 40 mm, o sea DFOV 56.8 — no los 41.2 que figuraban aca,
 * que venian de una pagina de terceros y estaban mal.
 */
export function camaraDesdeEquivalente35(
  name: string,
  mm35: number,
  imageW: number,
  imageH: number,
  djiId?: string,
): Camera {
  const t = DIAGONAL_35MM / (2 * mm35);
  const d = Math.hypot(imageW, imageH);
  const grados = (x: number) => (2 * Math.atan(t * x)) / RAD;
  return {
    name, imageW, imageH,
    hfovDeg: grados(imageW / d), vfovDeg: grados(imageH / d),
    ...(djiId ? { djiId } : {}),
  };
}

export const CAMARAS: Camera[] = [
  /*
    El Matrice 4T va PRIMERO porque es el dron que hay.

    Estaba segundo, y la pantalla abria configurada en un Mavic 3T. Un valor
    por defecto no es una sugerencia: es lo que va a volar el que no toca nada.
  */
  {
    ...desdeDiagonal("Matrice 4T · termica 640x512 (DFOV 45°)", 45, 640, 512, "m4t"),
    intervalosS: [0.7, 1, 2, 3, 5, 7, 10, 15, 20, 30, 60],
    // Ficha DJI: 49 min con helices estandar. El hub carga de a UNA bateria por
    // vez: 78 min al 100 %, o 60 min al 90 % en modo "lista para volar", que es
    // el que se usa en el campo.
    minutosDeVuelo: 49,
    minutosDeCarga: 60,
  },
  { ...camaraDesdeEquivalente35("Mavic 3T · termica 640x512 (40 mm eq)", 40, 640, 512, "m3t"),
    intervalosS: [2, 3, 5, 7, 10, 15, 20, 30, 60],
    minutosDeVuelo: 45, minutosDeCarga: 70 },
  // El H30T no lleva id: va colgado de un Matrice 350 o 400, que no estan en
  // PERFILES_DJI. Inventarle uno seria peor que no tenerlo.
  desdeDiagonal("Zenmuse H30T · termica 1280x1024 (DFOV 45.2°)", 45.2, 1280, 1024),
  camaraDesdeEquivalente35("Mavic 3T · visible 4000x3000 (24 mm eq)", 24, 4000, 3000, "m3t"),
];

export const huella = (alturaM: number, fovDeg: number) => 2 * alturaM * Math.tan((fovDeg * RAD) / 2);

/**
 * Cada cuantos metros se repite una fila de trackers, medido del parque.
 *
 * Hace falta para DIBUJAR las pasadas sobre las filas a escala: sin el paso
 * real, la figura muestra un solape que no es el que va a haber.
 *
 * Se mide en vez de declararse. Se proyecta el centro de cada fila sobre el eje
 * PERPENDICULAR a la direccion media de las filas, se ordenan, y se toma la
 * MEDIANA de los saltos: la mediana aguanta que el parque tenga calles en el
 * medio, que meten saltos de veinte metros que un promedio se comeria.
 */
export function pasoEntreFilas(rows: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>): number | null {
  if (rows.length < 3) return null;

  let ux = 0, uy = 0;
  for (const r of rows) {
    let dx = r.b.x - r.a.x, dy = r.b.y - r.a.y;
    const n = Math.hypot(dx, dy);
    if (!n) continue;
    dx /= n; dy /= n;
    // Todas las filas al mismo semiplano: una fila dibujada al reves apunta
    // para el otro lado y cancelaria a su vecina en el promedio.
    if (dy < 0 || (dy === 0 && dx < 0)) { dx = -dx; dy = -dy; }
    ux += dx; uy += dy;
  }
  const n = Math.hypot(ux, uy);
  if (!n) return null;
  ux /= n; uy /= n;

  // El perpendicular, que es sobre el que se separan las filas.
  const px = -uy, py = ux;
  const cortes = rows
    .map((r) => ((r.a.x + r.b.x) / 2) * px + ((r.a.y + r.b.y) / 2) * py)
    .sort((x, y) => x - y);

  const saltos: number[] = [];
  for (let i = 1; i < cortes.length; i++) {
    const d = cortes[i]! - cortes[i - 1]!;
    if (d > 0.5) saltos.push(d);   // dos filas al mismo corte son el mismo eje
  }
  if (!saltos.length) return null;
  saltos.sort((x, y) => x - y);
  return saltos[Math.floor(saltos.length / 2)]!;
}

// ---------------------------------------------------------------------------
// La velocidad, que hasta ahora era un numero escrito a mano
// ---------------------------------------------------------------------------

export interface Velocidades {
  /** Cada cuantos metros tiene que disparar la camara. */
  disparoCadaM: number;
  /** Cuantos segundos hay entre foto y foto a la velocidad elegida. */
  segundosEntreFotos: number;
  /** Lo mas rapido que se puede ir sin que la camara se quede atras. */
  porObturadorMps: number;
  /** Lo mas rapido que se puede ir sin barrer mas de un pixel de terreno. */
  porArrastreMps: number;
  /** El menor de los dos: el techo de verdad. */
  maximaMps: number;
  /** Cual de los dos manda. Sirve para explicar POR QUE, no solo cuanto. */
  manda: "obturador" | "arrastre";
  /** Cuantos pixeles de terreno barre la imagen a la velocidad elegida. */
  arrastrePx: number;
  /** El intervalo mas corto que la camara acepta, en segundos. */
  intervaloMinimoS: number;
}

/**
 * Que velocidad aguanta este vuelo, y por que.
 *
 * La velocidad era el unico numero del plan que no salia de ningun lado: un 5
 * escrito a mano que alimentaba la cuenta de minutos y se copiaba al archivo
 * del dron. Nada la cruzaba contra la camara. Y hay dos cosas que la limitan,
 * las dos silenciosas:
 *
 *   OBTURADOR  el plan pide una foto cada N metros; a v m/s eso es un intervalo
 *              de N/v segundos. Si es mas corto que lo que la camara sabe
 *              hacer, el dron saca menos fotos y quedan HUECOS.
 *   ARRASTRE   cada pixel promedia lo que vio durante su tiempo de integracion.
 *              A v m/s eso es v*t metros de terreno por pixel. Pasado un pixel
 *              de GSD, el promedio se empieza a comer el pico de la celda
 *              caliente — que es la medicion.
 *
 * Ninguno de los dos falla el dia del vuelo. Los dos fallan despues.
 */
export function velocidades(
  camera: Camera,
  altitudeM: number,
  frontOverlap: number,
  speedMps: number,
): Velocidades {
  const largoHuella = huella(altitudeM, camera.vfovDeg);
  const disparoCadaM = Math.max(0.5, largoHuella * (1 - frontOverlap));
  const gsdM = huella(altitudeM, camera.hfovDeg) / camera.imageW;

  // Sin lista de intervalos se toma 2 s, que es lo que suele aceptar una
  // termica de esta clase. Suponer 0.7 seria suponer a favor.
  const intervaloMinimoS = camera.intervalosS?.length
    ? Math.min(...camera.intervalosS)
    : 2;

  const porObturadorMps = disparoCadaM / intervaloMinimoS;
  const porArrastreMps = gsdM / SEGUNDOS_DE_INTEGRACION;
  const maximaMps = Math.min(porObturadorMps, porArrastreMps);

  return {
    disparoCadaM,
    segundosEntreFotos: speedMps > 0 ? disparoCadaM / speedMps : Infinity,
    porObturadorMps,
    porArrastreMps,
    maximaMps,
    manda: porObturadorMps <= porArrastreMps ? "obturador" : "arrastre",
    arrastrePx: (speedMps * SEGUNDOS_DE_INTEGRACION) / gsdM,
    intervaloMinimoS,
  };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface MissionOptions {
  camera: Camera;
  /** Altura sobre el terreno, en metros. */
  altitudeM: number;
  /** Solape entre fotos consecutivas de la misma linea, 0 a 1. */
  frontOverlap: number;
  /** Solape entre lineas vecinas, 0 a 1. */
  sideOverlap: number;
  speedMps: number;
  /** Cuanto se extiende el area mas alla de los modulos, en metros. */
  marginM: number;
  /** Volar a lo largo de las filas. Cruzarlas obliga a mas giros. */
  alongRows: boolean;
  /**
   * Si el dron sigue la linea con precision de centimetros.
   *
   * No es un dato de lujo: es lo que decide cuanto solape hace falta, y el
   * solape decide cuantas horas dura el trabajo. Sin RTK el dron se puede ir
   * varios metros de la linea, y el solape tiene que absorber esa deriva.
   */
  rtk: boolean;
}

/**
 * Solapes segun lo que el dron pueda seguir la linea.
 *
 * OJO con el numero de arriba: 70 % de solape lateral es lo que pide la
 * FOTOGRAMETRIA para poder coser las fotos en un mosaico. Esta app no cose
 * nada — proyecta cada foto por separado sobre el parque, que ya esta
 * medido — asi que ese solape no hace falta. Solo tiene que alcanzar para
 * que no queden huecos cuando el dron se corre de la linea.
 *
 * Con RTK se corre centimetros y 45 % sobra. Sin RTK se puede ir 2 a 5 metros,
 * y sobre una franja de 30 m eso es un 15 % para cada lado: hace falta el 70 %.
 * La diferencia, en un parque grande, es la mitad de los dias de trabajo.
 */
/**
 * El terreno, en palabras.
 *
 * Se pregunta asi y no en metros porque nadie sabe de memoria cuanto sube y
 * baja un parque, pero todo el mundo sabe si es una mesa o si tiene lomadas.
 * El numero de al lado es el desnivel tipico dentro de un bloque — no el del
 * parque entero, porque cada vuelo es un bloque.
 */
/**
 * La altura mas alta a la que este vuelo todavia resuelve una celda.
 *
 * Es LA altura, no una preferencia. Mas alto la pasada es mas ancha, o sea
 * menos pasadas y menos horas; el unico limite es que la celda —que es donde
 * nace el punto caliente— siga entrando en pixeles suficientes. Justo debajo de
 * ese limite esta el vuelo mas rapido que todavia sirve.
 *
 * Era un deslizador que arrancaba en 50 porque escribi 50. Con el Matrice 4T y
 * celdas de 16 cm, el numero que sale es 53: se estaba volando mas bajo que lo
 * necesario, o sea mas lento, sin ganar nada.
 */
export function alturaQueResuelveLaCelda(
  camera: Camera,
  celdaM: number,
  /**
   * Pixeles POR LADO de la celda, no de area.
   *
   * La distincion importa y ya me hizo equivocar: la constante del motor
   * —`PIXELES_POR_CELDA_MINIMO`— son cuatro pixeles de AREA, o sea dos de lado.
   * Metida aca como si fuera el lado, esta funcion mandaba a volar a la mitad
   * de la altura que corresponde: mas lento, mas pasadas, mas dias, sin ver
   * nada mejor.
   */
  pixelesPorLado: number,
): number {
  // gsd = 2*h*tan(hfov/2)/ancho, y se pide celdaM/gsd >= pixelesPorCelda.
  const porMetro = (2 * Math.tan((camera.hfovDeg * RAD) / 2)) / camera.imageW;
  const h = celdaM / (pixelesPorLado * porMetro);
  // Redondeada para abajo: quedarse un metro corto no cuesta nada, pasarse si.
  return Math.max(20, Math.min(120, Math.floor(h)));
}

export const TERRENOS = [
  { id: "plano", nombre: "Plano, como una mesa", desnivelM: 2 },
  { id: "lomadas", nombre: "Con lomadas suaves", desnivelM: 6 },
  { id: "ondulado", nombre: "Ondulado", desnivelM: 12 },
] as const;

export type TerrenoId = (typeof TERRENOS)[number]["id"];

/**
 * Cuanto se corre el dron de la linea, en metros.
 *
 * Con RTK son centimetros y no hay discusion.
 *
 * Sin RTK el numero honesto NO es el metro y medio que publica DJI para vuelo
 * estacionario: eso es quieto y sin viento. En una pasada de medio kilometro
 * con viento cruzado el error de seguimiento es mayor, y este comentario ya
 * decia "2 a 5 metros" cuando el solape era un preset. Se toman 3, del medio de
 * ese rango.
 *
 * Y se peca de conservador a proposito: quedarse corto aca no da un error el
 * dia del vuelo, deja una franja de paneles sin foto — y eso no se descubre
 * hasta que alguien los busca meses despues.
 */
export const DERIVA_CON_RTK = 0.1;
export const DERIVA_SIN_RTK = 3;

export interface SolapeDerivado {
  /** Lo que exige la regla de calidad de medicion. */
  porCalidad: number;
  /** Lo que exige que el dron se corra de la linea. */
  porDeriva: number;
  /** Lo que exige que el terreno suba y baje. */
  porTerreno: number;
  /** La suma, acotada a algo que se pueda volar. */
  solape: number;
  /** Cual de los tres pesa mas. Es lo que hay que atacar para ir mas rapido. */
  manda: "calidad" | "deriva" | "terreno";
}

/**
 * El solape lateral, calculado en vez de elegido de dos presets.
 *
 * Habia dos numeros escritos a mano —45 % con RTK, 70 % sin— y la pregunta que
 * los volteo fue la correcta: "si el RTK es ultra preciso, ¿por que no puedo
 * solapar diez por ciento y terminar mucho mas rapido?".
 *
 * Porque en esta app el solape no compra COBERTURA, compra MEDICION. El motor
 * ya se queda, de todas las fotos donde sale un modulo, con la que lo tiene mas
 * cerca del centro del cuadro — porque en el borde la termica miente: el barril
 * de la lente irradia sobre las esquinas y el vidrio visto de costado refleja
 * el cielo, y eso da diferencias de varios grados contra umbrales de dos o
 * tres. Con pasadas separadas `d = ancho * (1 - solape)`, el modulo peor
 * ubicado queda a `(1 - solape)` del centro hacia el borde:
 *
 *     solape 10 %  ->  hay modulos medidos al 90 % del camino al borde
 *     solape 30 %  ->  al 70 %
 *     solape 45 %  ->  al 55 %
 *
 * Asi que la regla no es "cuanto solapo" sino "hasta donde acepto medir", y de
 * ahi sale el solape. Encima se suman las dos cosas que el RTK NO arregla: que
 * el dron se corra de la linea (eso si lo arregla) y que el terreno suba —
 * la altura es sobre el punto de despegue, asi que un metro de lomada es un
 * metro menos de altura y una pasada mas angosta.
 */
export function solapeLateral(args: {
  camera: Camera;
  altitudeM: number;
  /** Hasta que fraccion del cuadro se acepta medir un modulo, de 0 a 1. */
  fraccionDelCuadro: number;
  /** Cuanto se corre el dron de la linea, en metros. */
  derivaM: number;
  /** Cuanto sube y baja el terreno adentro del bloque, en metros. */
  desnivelM: number;
}): SolapeDerivado {
  const ancho = huella(args.altitudeM, args.camera.hfovDeg);

  const porCalidad = Math.max(0, 1 - args.fraccionDelCuadro);
  // Dos pasadas vecinas pueden correrse cada una para su lado: el hueco que se
  // abre entre ellas es del doble de la deriva.
  const porDeriva = (2 * args.derivaM) / ancho;
  // Si el terreno sube, se vuela mas bajo de lo pedido y la pasada se angosta
  // en la misma proporcion.
  const porTerreno = args.desnivelM / Math.max(1, args.altitudeM);

  const suma = porCalidad + porDeriva + porTerreno;
  const mayor = Math.max(porCalidad, porDeriva, porTerreno);

  return {
    porCalidad, porDeriva, porTerreno,
    // El piso evita un plan sin solape ninguno; el techo, uno que no termina
    // nunca.
    solape: Math.min(0.85, Math.max(0.05, suma)),
    manda: mayor === porCalidad ? "calidad" : mayor === porDeriva ? "deriva" : "terreno",
  };
}

export const SOLAPES = {
  conRtk: { sideOverlap: 0.45, frontOverlap: 0.5 },
  sinRtk: { sideOverlap: 0.7, frontOverlap: 0.7 },
};

export const OPCIONES_POR_DEFECTO: Omit<MissionOptions, "camera"> = {
  altitudeM: 50,
  ...SOLAPES.sinRtk,
  speedMps: 5,
  marginM: 10,
  alongRows: true,
  rtk: false,
};

export interface MissionLine {
  a: LatLon;
  b: LatLon;
  largoM: number;
}

export interface MissionStats {
  lineas: number;
  /** Separacion entre lineas vecinas, en metros. */
  separacionM: number;
  /** Cada cuantos metros dispara la camara. */
  disparoCadaM: number;
  fotos: number;
  distanciaM: number;
  minutos: number;
  /** Centimetros de terreno por pixel. */
  gsdCm: number;
  /** Cuantos pixeles de ancho ocupa un modulo. Es el numero que decide todo. */
  pixelesPorModulo: number;
  huellaAnchoM: number;
  huellaLargoM: number;
  /** Lo que hay que mirar antes de volar. */
  avisos: string[];
}

export interface Mission {
  lines: MissionLine[];
  /** Los vertices en orden de vuelo, ida y vuelta. */
  waypoints: LatLon[];
  stats: MissionStats;
}

/**
 * Centimetros por pixel por encima de los cuales una celda deja de verse.
 *
 * El limite no lo pone el modulo sino la CELDA, que es donde nace el punto
 * caliente. Una celda mide entre 15 y 20 cm, asi que para que se distinga del
 * ruido hacen falta unos 3 pixeles de ancho sobre ella: unos 5 cm por pixel.
 *
 * Medirlo en modulos engaña: a 120 m un modulo todavia da 10 pixeles y parece
 * suficiente, pero cada celda queda en uno y medio.
 */
const GSD_MAXIMO_CM = 5;

/**
 * Lo que cuesta cada giro de 180 grados al final de una pasada, en segundos.
 *
 * Frenar, girar y volver a acelerar no es instantaneo. El numero estaba suelto
 * en la cuenta de los minutos, y ademas hace falta en otro lado: es la vara
 * que decide si conviene PARTIR una pasada en dos. Los segundos que se ahorran
 * de no cruzar un hueco se comparan contra los segundos de este giro, asi que
 * tienen que ser el mismo numero — con dos copias, una se cambia y la otra no,
 * y el planificador empieza a partir pasadas que le salen mas caras.
 */
const SEGUNDOS_POR_GIRO = 30;

export function planMission(
  rows: TrackerRow[],
  profile: FarmProfile,
  opts: MissionOptions,
): Mission | null {
  if (!rows.length) return null;

  const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);
  const puntas = rows.flatMap((r) => [toLocal(frame, r.start.lat, r.start.lon), toLocal(frame, r.end.lat, r.end.lon)]);

  // Direccion media de las filas, con el signo normalizado para que no se
  // cancelen las que vienen con las picas al reves en el Excel.
  let ux = 0, uy = 0;
  for (const r of rows) {
    const a = toLocal(frame, r.start.lat, r.start.lon);
    const b = toLocal(frame, r.end.lat, r.end.lon);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const s = dy >= 0 ? 1 : -1;
    ux += (dx / len) * s;
    uy += (dy / len) * s;
  }
  const n = Math.hypot(ux, uy) || 1;
  ux /= n; uy /= n;

  // Eje de vuelo y su perpendicular.
  const [fx, fy] = opts.alongRows ? [ux, uy] : [-uy, ux];
  const [px, py] = [-fy, fx];

  const along = puntas.map((p) => p.x * fx + p.y * fy);
  const across = puntas.map((p) => p.x * px + p.y * py);
  const a0 = Math.min(...along) - opts.marginM;
  const a1 = Math.max(...along) + opts.marginM;
  const c0 = Math.min(...across) - opts.marginM;
  const c1 = Math.max(...across) + opts.marginM;

  const anchoHuella = huella(opts.altitudeM, opts.camera.hfovDeg);
  const largoHuella = huella(opts.altitudeM, opts.camera.vfovDeg);
  const separacion = Math.max(0.5, anchoHuella * (1 - opts.sideOverlap));
  const disparoCada = Math.max(0.5, largoHuella * (1 - opts.frontOverlap));

  const cantidad = Math.max(1, Math.ceil((c1 - c0) / separacion) + 1);
  // Centrar las lineas dentro del area en vez de arrancar pegado al borde.
  const sobra = (cantidad - 1) * separacion - (c1 - c0);
  const inicio = c0 - sobra / 2;

  /**
   * Cada linea se recorta a las filas que de verdad pasa por encima.
   *
   * Antes todas las lineas iban de punta a punta del rectangulo que envuelve al
   * bloque. Pero un bloque no es un rectangulo: se escalona, tiene caminos,
   * subestaciones, una laguna. Barrer el rectangulo entero manda al dron a
   * sacar fotos de tierra — sobre Edenvale, el 14 % de los disparos no tenian
   * un solo modulo debajo. Una hora de vuelo por medio parque, que es una
   * bateria entera.
   *
   * Se proyecta cada fila sobre los dos ejes una sola vez: dentro del bucle
   * seria recorrer las 3182 filas por cada linea.
   */
  const proy = rows.map((r) => {
    const a = toLocal(frame, r.start.lat, r.start.lon);
    const b = toLocal(frame, r.end.lat, r.end.lon);
    const aA = a.x * fx + a.y * fy, aB = b.x * fx + b.y * fy;
    const cA = a.x * px + a.y * py, cB = b.x * px + b.y * py;
    return {
      a0: Math.min(aA, aB), a1: Math.max(aA, aB),
      c0: Math.min(cA, cB), c1: Math.max(cA, cB),
    };
  });

  /**
   * Y cada pasada se parte en TRAMOS, no se vuela de una sola tirada.
   *
   * El recorte de arriba tomaba la primera y la ultima fila que la pasada
   * tocaba y volaba de una punta a la otra. Alcanzaba mientras se volara un
   * bloque solo, que es mas o menos macizo. Desde que se pueden elegir varios
   * bloques sueltos ya no alcanza: dos bloques separados por medio kilometro de
   * campo daban una pasada que cruzaba el vacio entera, con el dron volando y
   * DISPARANDO sobre el pasto del medio. Los minutos y las fotos que mostraba
   * la pantalla eran los del rectangulo que envuelve a todo, no los del vuelo
   * que hace falta — y encima se gastaba bateria en fotos de nada.
   *
   * Donde no hay filas debajo, no hay pasada.
   */
  interface Tramo { c: number; desde: number; hasta: number; }

  /**
   * Hueco a partir del cual conviene partir la pasada en dos.
   *
   * Partir no es gratis: son dos waypoints mas y un giro mas, y ese giro se
   * paga en los mismos segundos que se ahorran de no cruzar. Asi que el hueco
   * tiene que dar para volar mas de lo que cuesta el giro; si no, se cruza de
   * largo y se sacan las fotos de mas, que salen mas baratas. Los otros dos
   * pisos son geometricos: por debajo de una huella no se saltea ni un disparo,
   * y por debajo de dos margenes los dos tramos se tocan igual una vez que se
   * les suma el margen de las puntas.
   */
  const puente = Math.max(2 * opts.marginM, largoHuella, SEGUNDOS_POR_GIRO * opts.speedMps);

  const tramos: Tramo[] = [];
  const medio = anchoHuella / 2;
  for (let i = 0; i < cantidad; i++) {
    const c = inicio + i * separacion;

    // Que filas caen bajo la huella de esta pasada, y hasta donde llegan.
    const debajo: Array<[number, number]> = [];
    for (const r of proy) {
      if (r.c1 < c - medio || r.c0 > c + medio) continue;
      debajo.push([r.a0, r.a1]);
    }
    // Una pasada que no pasa por encima de ninguna fila no se vuela.
    if (!debajo.length) continue;

    // De izquierda a derecha, pegando lo que queda mas cerca que el puente.
    debajo.sort((x, y) => x[0] - y[0]);
    for (const [d, h] of debajo) {
      const ult = tramos[tramos.length - 1];
      if (ult && ult.c === c && d - ult.hasta <= puente) {
        if (h > ult.hasta) ult.hasta = h;
        continue;
      }
      tramos.push({ c, desde: d, hasta: h });
    }
  }

  for (const t of tramos) {
    t.desde = Math.max(a0, t.desde - opts.marginM);
    t.hasta = Math.min(a1, t.hasta + opts.marginM);
  }

  /**
   * Los tramos se juntan en BANDAS, y se vuela una banda entera antes de pasar
   * a la siguiente.
   *
   * Sin esto el partido no ahorraria un metro de vuelo: serpenteando pasada
   * por pasada, con dos bloques separados el dron cruza el hueco una vez por
   * pasada, y veinte pasadas son veinte cruces — lo mismo que antes, pero con
   * un giro de mas en cada una. Terminando un bloque antes de arrancar el otro
   * el hueco se cruza una sola vez.
   *
   * Una banda es un grupo de tramos que se pisan sobre el eje de vuelo, que es
   * justamente "lo que se puede volar sin cruzar ningun hueco".
   */
  const bandas: Tramo[][] = [];
  let finBanda = -Infinity;
  for (const t of [...tramos].sort((x, y) => x.desde - y.desde)) {
    if (bandas.length && t.desde <= finBanda) {
      bandas[bandas.length - 1]!.push(t);
      finBanda = Math.max(finBanda, t.hasta);
      continue;
    }
    bandas.push([t]);
    finBanda = t.hasta;
  }

  const lines: MissionLine[] = [];
  const waypoints: LatLon[] = [];
  let distancia = 0;
  let fotos = 0;
  /**
   * Por que punta se entra a cada tramo: por la que quedo mas cerca.
   *
   * Con una sola banda esto es el serpenteo de toda la vida —se termina una
   * pasada donde arranca la siguiente— y da exactamente lo mismo que alternar
   * por numero de linea. La diferencia aparece al saltar de una banda a la
   * otra: ahi la alternancia por numero de linea puede mandar al dron a la
   * punta lejana del bloque siguiente y hacerle volar el largo de un bloque de
   * mas, en vacio, porque si.
   */
  let ultimaPunta: number | null = null;
  bandas.forEach((banda, i) => {
    // La banda que sigue arranca por la pasada donde termino la anterior, en
    // vez de volver al principio a rehacer el mismo camino en vacio.
    banda.sort((x, y) => (i % 2 === 0 ? x.c - y.c : y.c - x.c));
    for (const t of banda) {
      const alReves =
        ultimaPunta !== null &&
        Math.abs(ultimaPunta - t.hasta) < Math.abs(ultimaPunta - t.desde);
      const [d0, d1] = alReves ? [t.hasta, t.desde] : [t.desde, t.hasta];
      ultimaPunta = d1;
      const A = toGeo(frame, fx * d0 + px * t.c, fy * d0 + py * t.c);
      const B = toGeo(frame, fx * d1 + px * t.c, fy * d1 + py * t.c);
      const largo = t.hasta - t.desde;
      lines.push({ a: A, b: B, largoM: largo });
      waypoints.push(A, B);
      distancia += largo;
      fotos += Math.floor(largo / disparoCada) + 1;
    }
  });

  if (!lines.length) return null;

  // El traslado entre tramos: la separacion entre pasadas vecinas, o el salto
  // de una banda a la otra, que se paga una sola vez.
  for (let i = 1; i < lines.length; i++) {
    const p1 = toLocal(frame, lines[i - 1]!.b.lat, lines[i - 1]!.b.lon);
    const p2 = toLocal(frame, lines[i]!.a.lat, lines[i]!.a.lon);
    distancia += Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }

  const cantidadReal = lines.length;
  const largoLinea = lines.reduce((s2, l) => s2 + l.largoM, 0) / cantidadReal;
  // Los giros no son gratis, y con las pasadas partidas hay uno por tramo.
  const minutos = distancia / opts.speedMps / 60 + ((cantidadReal - 1) * SEGUNDOS_POR_GIRO) / 60;

  const gsdCm = (anchoHuella * 100) / opts.camera.imageW;
  const pasoModulo = profile.module.widthMm / 1000;
  const pixelesPorModulo = pasoModulo / (gsdCm / 100);

  const avisos: string[] = [];

  /*
    La velocidad, que hasta ahora no la miraba nadie.

    Va PRIMERO en la lista de avisos a proposito: los otros avisos hablan de
    cuanto vas a ver, y este habla de si vas a tener las fotos.
  */
  const vel = velocidades(opts.camera, opts.altitudeM, opts.frontOverlap, opts.speedMps);
  if (opts.speedMps > vel.porObturadorMps) {
    avisos.push(
      `A ${opts.speedMps} m/s el plan pide una foto cada ${vel.segundosEntreFotos.toFixed(1)} s y ` +
      `esta camara no baja de ${vel.intervaloMinimoS} s. El dron va a sacar menos fotos que las ` +
      `que el plan cuenta y van a quedar franjas sin cubrir. Bajá la velocidad a ` +
      `${vel.porObturadorMps.toFixed(1)} m/s o menos, o subí la altura.`,
    );
  }
  if (opts.speedMps > vel.porArrastreMps) {
    avisos.push(
      `A ${opts.speedMps} m/s cada pixel de la termica barre ${vel.arrastrePx.toFixed(1)} pixeles de ` +
      `terreno mientras se lee. Eso no sale "movido": aplana el pico de la celda caliente, que es ` +
      `justo lo que se mide. Bajá la velocidad a ${vel.porArrastreMps.toFixed(1)} m/s o menos.`,
    );
  }
  if (gsdCm > GSD_MAXIMO_CM) {
    avisos.push(
      `A ${gsdCm.toFixed(1)} cm por pixel, una celda de 16 cm entra en ${(16 / gsdCm).toFixed(1)} ` +
      `pixeles. Un punto caliente de una sola celda no se va a distinguir del ruido. ` +
      `(El modulo entero igual da ${pixelesPorModulo.toFixed(0)} pixeles, que es el numero que ` +
      `engaña: lo que hay que resolver es la celda.) Bajá a ` +
      // Hacia ABAJO, no al entero mas cercano. Redondeando al mas cercano el
      // consejo se pasa de largo: a 70 m decia "bajá a 38" y a 38 m volvia a
      // avisar. Un consejo que, seguido al pie de la letra, sigue quejandose
      // no es un consejo — es ruido, y el que lo lee deja de leer los avisos.
      `${Math.floor(opts.altitudeM * GSD_MAXIMO_CM / gsdCm)} m o menos.`,
    );
  }
  // Sin RTK el dron se va metros de la linea, y el solape tiene que absorberlo.
  if (!opts.rtk && opts.sideOverlap < 0.6) {
    avisos.push(
      `Con ${Math.round(opts.sideOverlap * 100)} % de solape lateral y sin RTK las lineas quedan ` +
      `justas: el dron se puede ir varios metros y dejar huecos sin cubrir. Un hueco no se nota ` +
      `hasta que buscás un panel y no hay foto.`,
    );
  }
  if (opts.rtk && opts.sideOverlap < 0.3) {
    avisos.push(
      `${Math.round(opts.sideOverlap * 100)} % de solape es poco incluso con RTK: el terreno ` +
      `desparejo cambia la altura y con ella el ancho de la franja.`,
    );
  }
  if (minutos > 20) {
    avisos.push(
      `Son ${minutos.toFixed(0)} minutos de vuelo: no entra en una bateria. Hay que partirlo por ` +
      `bloques o llevar repuestos.`,
    );
  }

  return {
    lines,
    waypoints,
    stats: {
      lineas: cantidadReal,
      separacionM: separacion,
      disparoCadaM: disparoCada,
      fotos,
      distanciaM: distancia,
      minutos,
      gsdCm,
      pixelesPorModulo,
      huellaAnchoM: anchoHuella,
      huellaLargoM: largoHuella,
      avisos,
    },
  };
}

// ---------------------------------------------------------------------------
// Exportacion
// ---------------------------------------------------------------------------

/** KML: se abre en Google Earth y lo importan casi todas las apps de vuelo. */
export function toKml(mission: Mission, nombre: string): string {
  const coords = mission.waypoints.map((w) => `${w.lon},${w.lat},0`).join(" ");
  const lineas = mission.lines
    .map(
      (l, i) =>
        `    <Placemark><name>Linea ${i + 1}</name><LineString><coordinates>` +
        `${l.a.lon},${l.a.lat},0 ${l.b.lon},${l.b.lat},0` +
        `</coordinates></LineString></Placemark>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(nombre)}</name>
    <Placemark><name>Recorrido</name><LineString><tessellate>1</tessellate>
      <coordinates>${coords}</coordinates>
    </LineString></Placemark>
${lineas}
  </Document>
</kml>`;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));

/** Lista de waypoints en CSV, que es lo que come casi cualquier planificador. */
export function toWaypointCsv(mission: Mission, opts: MissionOptions): string {
  const head = ["n", "latitud", "longitud", "altura_m", "velocidad_mps", "gimbal_grados"];
  const lines = [head.join(",")];
  mission.waypoints.forEach((w, i) => {
    // -90 es mirando derecho para abajo, que es lo unico que sirve para mapear.
    lines.push([i + 1, w.lat, w.lon, opts.altitudeM, opts.speedMps, -90].join(","));
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Por bloque
// ---------------------------------------------------------------------------

/**
 * Un parque entero no es una mision: es un proyecto.
 *
 * Edenvale son 23 horas de vuelo. Nadie vuela eso de un saque — la empresa que
 * lo hizo tardo cuatro dias. La unidad util no es la farm sino el BLOQUE, y no
 * por una razon tecnica sino porque es la unidad en la que ya piensa todo el
 * mundo en la planta: los bloques tienen nombre, los defectos se reportan por
 * bloque y la cuadrilla trabaja por bloque.
 *
 * Ademas un bloque entra en una o dos baterias, que es la otra unidad real.
 */

export interface BlockPlan {
  block: string;
  filas: number;
  mission: Mission;
  baterias: number;
}

export interface BlockPlanSet {
  bloques: BlockPlan[];
  totalMinutos: number;
  totalFotos: number;
  totalBaterias: number;
  /** Cuantas salidas de campo, si en cada una se llevan las baterias que hay. */
  salidas: number;
}

/**
 * Cuanto de la bateria NO se vuela.
 *
 * Se declaran los dos descuentos por separado, en vez de escribir un "20
 * minutos utiles" ya masticado, porque son cosas distintas y se discuten
 * distinto: la reserva es una regla de seguridad y el traslado depende de
 * donde se despegue.
 */
export const RESERVA_DE_BATERIA = 0.25;
/** El respaldo para una camara que no declara su autonomia. */
export const MINUTOS_POR_BATERIA = 20;
/** Minutos de ir hasta el bloque y volver, que se pagan de la misma bateria. */
export const MINUTOS_DE_TRASLADO = 4;

/**
 * Minutos de vuelo util que da una bateria de este dron.
 *
 * Habia un `MINUTOS_POR_BATERIA = 20` fijo, de la epoca en que el unico dron a
 * la vista era un Mavic 3T. El Matrice 4T da 49 minutos de ficha: con la
 * reserva y el traslado descontados quedan unos 32, no 20. Con la constante
 * vieja el parque entero pedia un 60 % mas de baterias de las que necesita — y
 * de ahi salian viajes al campo que no hacen falta.
 */
export function minutosUtiles(camera: Camera): number {
  // Sin ficha no se deriva nada: se usa el numero conservador de siempre. Es
  // mejor sobrar baterias que quedarse en el campo con el trabajo a medias.
  if (camera.minutosDeVuelo == null) return MINUTOS_POR_BATERIA;
  return Math.max(
    5,
    Math.round(camera.minutosDeVuelo * (1 - RESERVA_DE_BATERIA) - MINUTOS_DE_TRASLADO),
  );
}

export interface Jornada {
  /** Vuelo util por bateria, en minutos. */
  minutosPorBateria: number;
  /** Lo que se puede volar en un dia con las baterias que hay. */
  minutosPorBaterias: number;
  /** Lo que deja volar el sol ese dia. */
  minutosDeSol: number;
  /** El menor de los dos: lo que de verdad se vuela en una jornada. */
  minutosPorJornada: number;
  /** Cual de los dos manda. Es lo unico que hay que hacer distinto. */
  limita: "baterias" | "sol";
  /** Si cargando en el campo el cargador llega a seguirle el ritmo al dron. */
  elCargadorAlcanza: boolean;
  /** Cuantas jornadas sale el parque entero. */
  jornadas: number;
}

/**
 * Cuanto se vuela en un dia de campo, y que es lo que lo limita.
 *
 * El modelo anterior contaba las baterias como si fueran de un solo uso:
 * `viajes = baterias que gasta el parque / baterias que llevas`. El operador lo
 * volteo con una frase — "puedo estar cargando las baterias que vienen vacias
 * mientras el dron vuela" — y tiene razon: con un cargador en la camioneta las
 * baterias no se gastan, CIRCULAN.
 *
 * Con carga en el campo lo que manda es el balance entre lo que el dron quema
 * y lo que el cargador repone:
 *
 *     quema     1 bateria cada `minutosPorBateria`
 *     repone    1 bateria cada `minutosDeCarga`
 *
 * Si el cargador repone mas rapido de lo que el dron quema, no hay techo: se
 * vuela hasta que se acabe el sol. Si no —y con el hub del Matrice 4T no
 * alcanza: carga de a una, 60 minutos, contra 32 de vuelo— las baterias que se
 * llevan son un COLCHON que se vacia despacio, y dura mucho mas que sin cargar.
 *
 * Y despues esta el otro techo, que casi siempre es el que manda de verdad: el
 * sol. La norma pide 600 W/m² y los trackers tienen que estar casi planos, y
 * eso deja unas pocas horas al mediodia. De nada sirve tener bateria para seis
 * horas si la ventana util son tres y media.
 */
export function jornadaDeCampo(args: {
  camera: Camera;
  baterias: number;
  cargaEnElCampo: boolean;
  /** Minutos de ventana util del dia, del calculo del sol. */
  minutosDeSol: number;
  /** Minutos de vuelo que pide el parque entero. */
  minutosDelParque: number;
}): Jornada {
  const minutosPorBateria = minutosUtiles(args.camera);
  const minutosDeCarga = args.camera.minutosDeCarga ?? 70;
  const baterias = Math.max(1, args.baterias);

  const quema = 1 / minutosPorBateria;
  const repone = args.cargaEnElCampo ? 1 / minutosDeCarga : 0;
  const elCargadorAlcanza = repone >= quema;

  const minutosPorBaterias = elCargadorAlcanza
    ? Infinity
    : baterias / (quema - repone);

  const minutosDeSol = Math.max(0, args.minutosDeSol);
  const minutosPorJornada = Math.max(1, Math.min(minutosPorBaterias, minutosDeSol));

  return {
    minutosPorBateria,
    minutosPorBaterias,
    minutosDeSol,
    minutosPorJornada,
    limita: minutosPorBaterias < minutosDeSol ? "baterias" : "sol",
    elCargadorAlcanza,
    jornadas: Math.max(1, Math.ceil(args.minutosDelParque / minutosPorJornada)),
  };
}

export function planByBlock(
  rows: TrackerRow[],
  profile: FarmProfile,
  opts: MissionOptions,
  bateriasDisponibles = 4,
): BlockPlanSet {
  const porBloque = new Map<string, TrackerRow[]>();
  for (const r of rows) porBloque.set(r.block, [...(porBloque.get(r.block) ?? []), r]);

  const bloques: BlockPlan[] = [];
  for (const [block, group] of [...porBloque.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  )) {
    const mission = planMission(group, profile, opts);
    if (!mission) continue;
    bloques.push({
      block,
      filas: group.length,
      mission,
      baterias: Math.max(1, Math.ceil(mission.stats.minutos / minutosUtiles(opts.camera))),
    });
  }

  const totalMinutos = bloques.reduce((s, b) => s + b.mission.stats.minutos, 0);
  const totalBaterias = bloques.reduce((s, b) => s + b.baterias, 0);

  return {
    bloques,
    totalMinutos,
    totalFotos: bloques.reduce((s, b) => s + b.mission.stats.fotos, 0),
    totalBaterias,
    salidas: Math.max(1, Math.ceil(totalBaterias / Math.max(1, bateriasDisponibles))),
  };
}

// ---------------------------------------------------------------------------
// Bloques que se pisan
// ---------------------------------------------------------------------------

/**
 * Eje de vuelo y su perpendicular, en el marco local del parque.
 *
 * Se saca aparte porque lo necesitan tanto la planificacion como la deteccion
 * de bloques que se solapan, y calcularlo dos veces por separado es como se
 * desincronizan las cosas.
 */
function ejeDe(rows: TrackerRow[], frame: ReturnType<typeof makeFrame>, alongRows: boolean) {
  let ux = 0, uy = 0;
  for (const r of rows) {
    const a = toLocal(frame, r.start.lat, r.start.lon);
    const b = toLocal(frame, r.end.lat, r.end.lon);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const s = dy >= 0 ? 1 : -1;
    ux += (dx / len) * s;
    uy += (dy / len) * s;
  }
  const n = Math.hypot(ux, uy) || 1;
  ux /= n; uy /= n;
  const [fx, fy] = alongRows ? [ux, uy] : [-uy, ux];
  return { fx, fy, px: -fy, py: fx };
}

/** Cuanto ocupa un bloque sobre el eje perpendicular al vuelo. */
function franjaDe(
  rows: TrackerRow[],
  frame: ReturnType<typeof makeFrame>,
  eje: ReturnType<typeof ejeDe>,
): { min: number; max: number } {
  const v = rows.flatMap((r) => [
    toLocal(frame, r.start.lat, r.start.lon),
    toLocal(frame, r.end.lat, r.end.lon),
  ]).map((p) => p.x * eje.px + p.y * eje.py);
  return { min: Math.min(...v), max: Math.max(...v) };
}

export interface GrupoDeVuelo {
  /** Los bloques que se vuelan juntos. */
  bloques: string[];
  filas: number;
  mission: Mission;
  baterias: number;
}

export interface PlanAgrupado {
  grupos: GrupoDeVuelo[];
  totalMinutos: number;
  totalBaterias: number;
  salidas: number;
  /** Cuantos bloques quedaron pegados a otro por pisarse. */
  bloquesAgrupados: number;
  /** Minutos que se ahorran contra volar bloque por bloque. */
  ahorroMinutos: number;
}

/**
 * Agrupa los bloques que comparten pasada.
 *
 * Los bloques de una planta no son rectangulos prolijos: se escalonan y se
 * meten unos entre otros. Cuando dos bloques ocupan la misma franja
 * perpendicular al vuelo, volarlos por separado repite las mismas pasadas dos
 * veces — y sumando los 36 bloques esa repeticion infla el total.
 *
 * Volarlos juntos no pierde nada: la unidad de REPORTE sigue siendo el bloque,
 * porque cada foto se ubica sola contra la geometria. Lo unico que cambia es
 * que el dron no pasa dos veces por el mismo lugar.
 */
export function planByGroup(
  rows: TrackerRow[],
  profile: FarmProfile,
  opts: MissionOptions,
  bateriasDisponibles = 4,
): PlanAgrupado {
  const porBloque = new Map<string, TrackerRow[]>();
  for (const r of rows) porBloque.set(r.block, [...(porBloque.get(r.block) ?? []), r]);
  const bloques = [...porBloque.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (!rows.length) {
    return { grupos: [], totalMinutos: 0, totalBaterias: 0, salidas: 1, bloquesAgrupados: 0, ahorroMinutos: 0 };
  }

  const frame = makeFrame(rows[0]!.start.lat, rows[0]!.start.lon);
  const eje = ejeDe(rows, frame, opts.alongRows);
  const franjas = new Map(bloques.map((b) => [b, franjaDe(porBloque.get(b)!, frame, eje)]));

  // Union-find sobre "comparten franja". Dos bloques que se pisan sobre el eje
  // perpendicular comparten pasadas, y volarlos aparte las repite.
  const padre = new Map(bloques.map((b) => [b, b]));
  const raiz = (b: string): string => {
    let x = b;
    while (padre.get(x) !== x) x = padre.get(x)!;
    return x;
  };
  for (let i = 0; i < bloques.length; i++) {
    for (let j = i + 1; j < bloques.length; j++) {
      const a = franjas.get(bloques[i]!)!;
      const c = franjas.get(bloques[j]!)!;
      const solape = Math.min(a.max, c.max) - Math.max(a.min, c.min);
      // Se agrupan solo si el solape es una parte real del bloque mas chico:
      // rozarse por un metro no justifica juntarlos.
      const menor = Math.min(a.max - a.min, c.max - c.min);
      if (solape > Math.max(opts.marginM, menor * 0.25)) {
        padre.set(raiz(bloques[i]!), raiz(bloques[j]!));
      }
    }
  }

  const juntos = new Map<string, string[]>();
  for (const b of bloques) {
    const r = raiz(b);
    juntos.set(r, [...(juntos.get(r) ?? []), b]);
  }

  const grupos: GrupoDeVuelo[] = [];
  for (const lista of [...juntos.values()].sort((a, b) =>
    a[0]!.localeCompare(b[0]!, undefined, { numeric: true }),
  )) {
    const filas = lista.flatMap((b) => porBloque.get(b)!);
    const mission = planMission(filas, profile, opts);
    if (!mission) continue;
    grupos.push({
      bloques: lista,
      filas: filas.length,
      mission,
      baterias: Math.max(1, Math.ceil(mission.stats.minutos / minutosUtiles(opts.camera))),
    });
  }

  const totalMinutos = grupos.reduce((s, g) => s + g.mission.stats.minutos, 0);
  const totalBaterias = grupos.reduce((s, g) => s + g.baterias, 0);
  const sueltos = planByBlock(rows, profile, opts, bateriasDisponibles);

  return {
    grupos,
    totalMinutos,
    totalBaterias,
    salidas: Math.max(1, Math.ceil(totalBaterias / Math.max(1, bateriasDisponibles))),
    bloquesAgrupados: grupos.filter((g) => g.bloques.length > 1).reduce((s, g) => s + g.bloques.length, 0),
    ahorroMinutos: sueltos.totalMinutos - totalMinutos,
  };
}
