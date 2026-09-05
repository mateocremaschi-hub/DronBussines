/**
 * Deteccion de anomalias comparando cada modulo con sus vecinos.
 *
 * Esta es la pieza que se terceriza por megavatio, y no hace falta.
 *
 * Los detectores comerciales resuelven un problema dificil: encontrar manchas
 * calientes en una imagen sin saber que hay ahi. Tienen que segmentar modulos,
 * reconocer filas, descartar el suelo. Por eso usan redes neuronales.
 *
 * Aca el problema es mucho mas facil, porque el parque ya esta cargado. La
 * pregunta no es "que veo en esta foto" sino "este modulo, que se donde esta,
 * a que temperatura esta comparado con los otros 27 de su mismo string". Eso
 * es una resta.
 *
 * Y la comparacion es mejor que la de ellos, porque el vecindario es
 * ELECTRICO. Un modulo se compara contra los de su propio string —los que
 * comparten corriente, orientacion, edad y suciedad— y no contra lo que
 * casualmente cayo cerca en el cuadro.
 */

import { modulesOfRow } from "@locator";
import type { CompiledFarm, LocalFrame, ModuleRef } from "@locator";
import { medirCaja, percentil, retratoDeCaja, type Radiometric } from "./thermal";
import {
  confianzaDeFoto,
  desvioLocal,
  LISO_C,
  engancharFila,
  engancharFoto,
  escalaDeLaImagen,
  fraccionDelModuloEnElCuadro,
  fraccionLisaDeCaja,
  girar,
  pasoDeFilasEnLaImagen,
  pasoEnLaImagen,
  sondearCaja,
  FRIO_QUE_NO_ES_PANEL_C,
  type Caja as CajaDeMedicion,
} from "./encaje";
import { bordeDelPanel, corrimientoDeLaRejilla, perfilALoLargo, periodicidadDeModulos, tieneBordesCruzados, type Juntas } from "./juntas";
import { correccion, medirVinieta, radioNormalizado, type Vinieta } from "./vinieta";
import { calorDeLaPunta } from "./puntaDeFila";
import { claseSugerida, clasificarPatron, UMBRAL_PATRON_K } from "./patron";
import { aplicarAjuste, footprint, pixelOf, type Ajuste, type PhotoPose } from "./projection";
import type { Camera } from "./mission";
import { SIN_AJUSTE } from "./projection";

// ---------------------------------------------------------------------------
// Muestreo
// ---------------------------------------------------------------------------

export interface FotoTermica {
  fileName: string;
  pose: PhotoPose;
  radio: Radiometric;
  /**
   * Cuando se saco, en milisegundos. Sale del EXIF de la propia foto.
   *
   * Parece un dato de archivo y es de MEDICION. Los trackers giran y el parque
   * se calienta durante la mañana: el mismo modulo sano leido a las 9 y a las
   * 11 da dos temperaturas distintas. Comparar un modulo contra vecinos
   * fotografiados dos horas despues no mide un defecto, mide el paso del
   * tiempo.
   */
  cuando?: number;
}

export interface Muestra {
  modulo: ModuleRef;
  celsius: number;
  pixeles: number;
  /** La zona mas caliente del modulo, del tamaño de una celda. */
  puntoCalienteC?: number;
  /** Cuantos pixeles cubre una celda en esta foto. Menos de 2 y no se resuelve. */
  pixelesPorCelda?: number;
  /**
   * Cuan lisa es la caja: el desvio de cada pixel contra sus vecinos.
   *
   * Es lo que distingue un panel (0,6-1,2 °C) del pasto (1,9-2,5) y de la
   * sombra al borde de la fila (2,1-5,8). Se guarda para poder mostrar por que
   * una caja se descarto, y para que se vea si una foto entera vino mal.
   */
  textura?: number;
  /**
   * Que fraccion de la caja cayo sobre el panel, punto por punto.
   *
   * Uno significa que la caja entro entera en el modulo. Menos de uno
   * significa que algo de lo que se midio no era el panel — el riel, el hueco
   * al lado, el borde del cuadro — y eso importa sobre todo para el chequeo
   * interno: una caja que sobresale dibuja una franja caliente en su borde que
   * se parece muchisimo a una substring puenteada.
   */
  fraccionPanel?: number;
  fileName: string;
  /**
   * El modulo remuestreado en una grilla de su propio marco.
   *
   * Es lo que permite clasificar el defecto por su FORMA — una franja que cruza
   * el modulo es un diodo de bypass, tres manchitas sueltas son celdas. Se
   * guarda con la muestra y no se recalcula despues, por lo mismo que la caja:
   * recalcularlo exige la pose, la camara, el ajuste y el acortamiento de ESE
   * instante, y ya no estan a mano.
   */
  retrato?: { celdas: Float32Array; filas: number; columnas: number };
  /** Cuando se saco la foto de la que salio esta medicion, en milisegundos. */
  cuando?: number;
  /** Distancia del modulo al centro del cuadro. Cerca del borde la termica miente mas. */
  distanciaAlCentroM: number;
  /**
   * Lo que midio el mismo modulo en OTRAS fotos, en grados.
   *
   * Un defecto de verdad esta caliente en todas las fotos en que entra. Una
   * caja que cayo sobre la calle esta caliente en una sola. Sin esto no hay
   * forma de distinguirlas, porque las dos dan el mismo numero contra los
   * hermanos de string.
   */
  otrasC?: number[];
  /**
   * Donde cae este modulo DENTRO de la foto, en pixeles de la imagen termica.
   *
   * Se guarda al medir y no se recalcula despues. El motivo es que recalcularlo
   * exige tener otra vez la pose, la camara, el ajuste y el acortamiento del
   * tracker en ESE momento — cuatro cosas que ya no estan a mano cuando se
   * arma el informe. Un recuadro dibujado con una de esas mal es peor que no
   * dibujarlo: senala el panel de al lado con la misma seguridad.
   *
   * Es la misma caja que se midio, asi que lo que se ve marcado en la foto es
   * literalmente de donde salio el numero.
   */
  caja?: Caja;
}

/**
 * El recuadro del modulo dentro de la foto, en pixeles de la imagen termica.
 *
 * Estaba escrito a mano adentro de `Muestra` y no tenia nombre. Ahora viaja
 * mas lejos —el hallazgo revisado la guarda para poder marcar la foto meses
 * despues— y un tipo anonimo copiado en dos archivos es como se desincronizan
 * los ejes: alcanza con que uno diga `largo` donde el otro dice `ancho` para
 * que el recuadro senale el panel de al lado.
 */
export interface Caja {
  cx: number;
  cy: number;
  largo: number;
  cruzado: number;
  rotRad: number;
  /**
   * El cuadro en el que estan estas coordenadas, en pixeles.
   *
   * Sin esto la caja es un par de numeros sin unidad, y eso costo caro. El
   * recuadro se dibuja sobre el JPEG, y con "Super Resolution" prendida el
   * JPEG mide 1280x1024 mientras que la caja esta en el marco de la termica
   * cruda, 640x512. La pantalla usaba el tamano del JPEG para escalar, asi que
   * dibujaba TODOS los recuadros a la mitad de la posicion correcta —
   * exactamente la mitad— y cualquier defecto aparecia senalado sobre el pasto
   * de la fila de al lado.
   *
   * La medicion siempre estuvo bien; lo que estaba mal era el dibujo. Peor
   * todavia: es el dibujo lo unico que una persona puede mirar para creerle o
   * no al informe.
   */
  ancho?: number;
  alto?: number;
  /**
   * Cada cuantos pixeles se repite un modulo en esta fila, y para que lado
   * crece el numero de modulo sobre el eje `rotRad`.
   *
   * Hace falta para decidir a que modulo pertenece una mancha que cae cerca
   * del borde de la caja. Sin el paso no se sabe cuanto es "un modulo" en esta
   * foto, y sin el sentido la correccion corre el numero justo para el lado
   * contrario.
   */
  pasoPx?: number;
  sentido?: number;
  /**
   * El modulo ENTERO, no solo la parte que se midio.
   *
   * Se mide una parte de adentro del modulo para no tocar el marco de aluminio
   * ni el hueco de al lado, y durante mucho tiempo eso fue tambien lo unico
   * que se dibujaba. En la foto se veia un rectangulito flotando en el medio
   * de los paneles, y cuando la rejilla estaba corrida quedaba a caballo de
   * dos — que es exactamente la duda que la foto tenia que despejar.
   *
   * Marcar el modulo entero es lo que convierte la foto en prueba: el que la
   * mira cuenta paneles desde la punta y ve cual esta remarcado, sin tener que
   * adivinar a cual de los dos pertenece un recuadro chico.
   */
  largoModulo?: number;
  cruzadoModulo?: number;
}

/**
 * Que fraccion del modulo se mide, para no tocar el marco ni el suelo.
 *
 * El borde de un modulo tiene marco de aluminio, que al sol esta a otra
 * temperatura que la celda, y hay que dejarlo afuera. Y pegado al marco esta
 * la union con el modulo siguiente, que es un escalon.
 *
 * Seis decimos, y esta MEDIDO, no elegido. Con la rejilla ya alineada a lo
 * largo se probo agrandar la caja a 0,75 sobre el vuelo entero de Wellington:
 * los hallazgos pasaron de 3 a 17, y de esos 17, once tenian ΔT contra sus
 * hermanos de entre -1,0 y +0,7 °C — o sea, ninguna diferencia de temperatura.
 * Salieron por la FORMA: con la caja al 75 % el marco de aluminio entra en el
 * retrato y dibuja una franja que cruza el modulo de lado a lado, que es la
 * firma de un diodo de bypass. Peor todavia, el unico defecto de verdad del
 * vuelo volvia a salir en el modulo 25 en vez del 26, porque la caja mas
 * grande vuelve a agarrar panel del vecino.
 *
 * O sea que agrandar la caja no compra resolucion: compra el marco. Lo que si
 * se gano alineando la rejilla es que estos seis decimos caen ENTEROS adentro
 * del modulo — antes quedaban a caballo de dos.
 */
const FRACCION_UTIL = 0.6;

export interface OpcionesMuestreo {
  camera: Camera;
  moduloAnchoM: number;
  moduloLargoM: number;
  ajuste?: Ajuste;
  /** Lado de una celda en metros. Decide si el punto caliente se puede ver. */
  celdaM?: number;
}

/** Una foto termica con su pose. */

/** Lado de celda por defecto, en metros. Una celda entera tipica. */
export const CELDA_M = 0.16;

/**
 * Que fraccion del modulo tiene que haber entrado de verdad en el cuadro.
 *
 * Esta es la regla que separa una medicion de un numero inventado, y hace
 * falta explicarla porque no es evidente.
 *
 * `pixelOf` acepta un modulo cuando su CENTRO cae adentro de la foto. Un
 * modulo cuyo centro esta a un centimetro del borde pasa ese filtro, pero la
 * caja que se mide sobre el queda mitad afuera — y el recorte al tamaño de la
 * imagen la deja apoyada justo en la ultima fila de pixeles del sensor.
 *
 * Ahi es donde un microbolometro miente mas: el barril de la lente irradia
 * sobre las esquinas, y el vidrio del modulo visto de costado refleja el
 * cielo. Un modulo medido sobre cuatro pixeles del borde da diferencias de
 * varios grados contra sus vecinos medidos sobre setenta pixeles del centro,
 * y esa diferencia no es un defecto: es el borde del cuadro.
 *
 * Exigiendo que la caja entre casi entera, esos modulos no se miden. Es
 * preferible decir "no lo vi" a inventarle una temperatura.
 */
const FRACCION_MINIMA_MEDIDA = 0.9;


/**
 * Junta las muestras de un vuelo, foto por foto.
 *
 * Se procesa de a una y se descarta la matriz de temperaturas apenas se midio,
 * porque no entran todas juntas: 500 termicas de 640x512 en punto flotante son
 * 650 MB. Lo que queda es una muestra por modulo, que son unos pocos bytes.
 *
 * Cuando un modulo sale en varias fotos —con solape siempre pasa— se queda con
 * la que lo tiene mas cerca del centro del cuadro. No es un capricho: en el
 * borde la camara lo ve de costado, y una superficie de vidrio vista de
 * costado refleja el cielo y lee mas frio de lo que esta.
 */
/**
 * Cuantas cajas necesita una fila para juzgar si hay un tracker abajo.
 *
 * Con menos que esto no se la toca: la fila asoma por el borde del cuadro, y
 * el solape la va a agarrar entera en otra foto.
 */
const CAJAS_PARA_JUZGAR_LA_FILA = 6;

/**
 * Que parte de la caja tiene que caer sobre panel para que la medicion valga.
 *
 * Este es el freno que faltaba y es el que ordena la lista. Sobre los dos
 * vuelos reales, los modulos del MEDIO de una fila dan 0,63 en el peor decil y
 * 0,79 tipico: la caja cae entera sobre el panel y no hay nada que discutir.
 * Los modulos de la PUNTA dan 0,00 a 0,25 — y ahi es donde estaban casi todos
 * los hallazgos: 9 de 10 en un vuelo, 8 de 9 en el otro, todos en el modulo 28
 * o en el 1. Mirando la foto de cerca se ve por que: la ultima caja de la fila
 * no cae sobre un panel, cae sobre el motor del tracker y el hueco que hay
 * entre una fila y la siguiente. El parque dice que ahi hay un modulo mas de
 * los que hay.
 *
 * El corte va en 0,35 y no mas arriba a proposito. Un defecto DE VERDAD
 * tambien despega puntos de la mediana: un diodo de bypass caliente parte el
 * modulo al medio y deja la mitad de los sondeos afuera, o sea 0,5. Con el
 * corte en 0,6 —que es donde estaba en un intento anterior— ese diodo se
 * perdia, y perder un defecto de verdad cuesta mucho mas que reportar uno
 * falso. Entre 0,35 y 0,5 no hay nada medido: es tierra de nadie a proposito.
 */
const FRACCION_PANEL_MINIMA = 0.35;

/**
 * Que parte de lo que da un modulo normal se le pide a una punta de string.
 *
 * Tres cuartos. La caja de un modulo del medio cae sobre panel casi entera
 * —0,75 tipico sobre el vuelo entero— y la de una punta que TAMBIEN esta sobre
 * panel da lo mismo: la mediana de las puntas es 0,75 igual que la del medio.
 * Las que no llegan a tres cuartos de eso son las que estan mordiendo el hueco,
 * y son las que daban hallazgos que en el campo no existen.
 */
const PARTE_DE_UN_MODULO_NORMAL = 0.75;

/**
 * Cuantos modulos del medio hacen falta para saber que es "normal" en esta foto.
 *
 * Con menos, la mediana la puede mover un solo modulo raro y el freno de la
 * punta se vuelve arbitrario. Sin ellos se usa el minimo fijo, que es el que
 * habia antes.
 */
const MODULOS_PARA_JUZGAR_LA_PUNTA = 10;


/** Lo que se le corrigio a una fila en una foto, a lo largo. */
interface Alineacion {
  /** El corrimiento aplicado en el centro de la fila, en modulos, en el sentido en que crece la posicion. */
  modulos: number;
  /** Por cuanto hubo que estirar el paso del parque para que cayera en las juntas. */
  factor?: number;
  /**
   * El corrimiento VERDADERO de la fila, medido con su final, en modulos.
   *
   * Distinto de `modulos` cuando el final no se vio: ahi `modulos` es lo que
   * dijeron las juntas, que solo vale en medio modulo para cada lado.
   */
  anclaModulos?: number;
  contraste?: number;
}

export interface AlineacionDeFila {
  fileName: string;
  rowId: string;
  modulos: number;
  ancla?: number;
  contraste?: number;
  factor?: number;
}

/**
 * Cuanto pueden discrepar las medidas del final de una misma fila.
 *
 * Un tercio de modulo. El borde se ubica con dos pixeles de error sobre un
 * modulo de veinticinco, asi que dos medidas buenas caen a menos de un decimo
 * una de otra. Mas de un tercio quiere decir que en alguna foto se tomo por
 * final algo que no lo era —una sombra, un tracker girado— y con eso no se
 * renumera nada.
 */
const ANCLAS_QUE_NO_SE_PONEN_DE_ACUERDO = 0.33;

/**
 * Con cuanta caja sobre panel se mide, y cuantas cajas hacen una fila.
 *
 * Nueve decimos por fila: las filas del bloque que se vuela dan 0,97 a 0,98
 * de mediana en los dos vuelos reales, y las filas mal puestas de los bloques
 * vecinos 0,77 a 0,85. Nueve decimos deja pasar a las primeras con margen y
 * frena a todas las segundas. Medio por caja es el piso absoluto.
 */
const PANEL_MINIMO_DE_FILA = 0.9;
const PANEL_MINIMO_DE_CAJA = 0.5;
const CAJAS_PARA_JUZGAR_LA_COMPUERTA = 3;
/**
 * Con cuantos modulos en el cuadro se le exige a una fila que muestre sus
 * juntas. Cuatro, que es con cuantos la rejilla se puede buscar: menos que
 * eso y la fila se juzga caja por caja, con la compuerta de lisura.
 */
const MODULOS_PARA_EXIGIR_JUNTAS = 4;

export class Acumulador {
  private mejor = new Map<string, Muestra>();
  /** Cada medicion de cada modulo, de todas las fotos en que entro. */
  private todas: Muestra[] = [];
  /** Lo que la compuerta de panel no dejo medir: una caja por entrada. */
  private compuerta: Array<{ fileName: string; rowId: string; block: string; lisura: number }> = [];
  /** Por bloque: cuantas cajas se midieron y con cuanta caja sobre panel. */
  private auditoria = new Map<string, { medidas: number; sumaLisura: number; bajo90: number; fotos: Set<string> }>();
  /** Cuanto hubo que correr cada fila cruzado, aparte de la foto. */
  private enganchesDeFila: Array<{ fileName: string; rowId: string; px: number }> = [];
  /** Fotos que llegaron sin rumbo o sin angulo de gimbal, por motivo. */
  private posesIncompletas = new Map<string, number>();
  /** Modulos que quedaron cortados por el borde del cuadro y no se midieron. */
  private recortados = new Set<string>();
  /**
   * Cajas que cayeron sobre algo que no es un panel, y no se midieron.
   *
   * Antes se median igual. Lo que salia era la textura del pasto o de la
   * sombra reportada como puntos calientes de celda, y nada lo frenaba porque
   * la comparacion contra los hermanos de string es ciega a un error que
   * corre a todas las cajas de la foto por igual.
   */
  private sinPanel = new Set<string>();
  /** Los corrimientos que hubo que aplicar, por foto. */
  private encajes: Array<{ fileName: string; metros: number }> = [];
  /** Cuanto se despega la escala del EXIF de la contada en la imagen, por foto. */
  private escalas: Array<{ fileName: string; factor: number }> = [];
  /**
   * Lo que dice el paso ENTRE FILAS de cada foto sobre la escala del vuelo.
   *
   * Aparte de `escalas`, que cuenta el paso entre MODULOS. Son dos reglas
   * distintas y la de las filas es cinco veces mas larga, asi que decide ella.
   */
  private pasosDeFila: Array<{ fileName: string; factor: number }> = [];
  /**
   * Los modulos cuya caja no cayo sobre un panel.
   *
   * Se guarda CUAL modulo de la fila era, no solo cuantos. Si siempre es el
   * mismo numero —y lo es: el 28— no es un problema del vuelo, es que la fila
   * del parque tiene un modulo mas de los que hay en el campo, y eso se
   * arregla una vez en los datos en vez de una vez por vuelo.
   */
  private fueraDelPanel: Array<{ rowId: string; module: number; clave: string }> = [];
  /**
   * Cuanto habia que correr cada fila a lo largo para que las cajas cayeran
   * sobre los modulos, medido con las juntas de la propia foto. Ya aplicado.
   */
  private alineaciones: AlineacionDeFila[] = [];
  /** Fotos que no se pudieron enganchar a los paneles, y no se midieron. */
  private fotosSinEnganche: Array<{ fileName: string; fraccionLisa: number }> = [];
  /**
   * Fotos que no cayeron sobre NINGUN modulo del parque, y a que distancia
   * quedo el modulo mas cercano.
   *
   * Es la falla que no daba ni un sintoma. Con el parque equivocado cargado
   * —o con uno viejo, o con la geometria corrida— la huella de cada foto no
   * toca ninguna fila, no hay ninguna caja que medir, y el vuelo termina con
   * cero modulos y cero hallazgos. Eso en el campo se lee como "esta todo
   * sano", que es la conclusion mas cara posible.
   *
   * Perdi una hora con esto sobre las fotos de Edenvale: el parque que tenia
   * cargado era de tres semanas antes y las fotos caian noventa metros al
   * este de la fila mas cercana. La app no dijo absolutamente nada.
   */
  private fotosFueraDelParque: Array<{ fileName: string; metros: number }> = [];
  /** Cuanto vinieteo hubo que sacarle a cada foto, en grados en la esquina. */
  private vinietas: Array<{ fileName: string; maximoC: number }> = [];
  /**
   * Modulos medidos dos veces, desde fotos distintas, y cuanto se diferencian.
   *
   * Es la unica prueba de que el motor funciona que no necesita saber de
   * antemano que panel esta roto.
   */
  private repeticiones: Array<{ clave: string; diferencia: number }> = [];

  constructor(
    private farm: CompiledFarm,
    private frame: LocalFrame,
    private opts: OpcionesMuestreo,
  ) {}

  /** Mide los modulos que caen en esta foto. Devuelve cuantos. */
  /**
   * @param acortamiento Cuanto se ve del ancho transversal del modulo, de 0 a 1.
   *   Es el coseno del angulo del tracker en el momento de la foto: 1 con los
   *   trackers planos, 0.57 con el tracker contra su tope de 55 grados. Sin
   *   esto, la caja de medicion se dibuja del ancho del modulo acostado, y con
   *   el tracker inclinado casi la mitad de esa caja cae sobre el SUELO — que
   *   al sol lee muy distinto y le baja la mediana al modulo entero.
   */
  agregar(foto: FotoTermica, acortamiento = 1): number {
    const { camera, moduloAnchoM } = this.opts;
    const moduloLargoM = this.opts.moduloLargoM * Math.min(1, Math.max(0.2, acortamiento));
    const huella = aplicarAjuste(
      footprint(this.frame, foto.pose, camera),
      this.opts.ajuste ?? SIN_AJUSTE,
    );
    for (const f of huella.faltantes) {
      this.posesIncompletas.set(f, (this.posesIncompletas.get(f) ?? 0) + 1);
    }

    // Solo las filas que tocan la huella: sin esto se recorre el parque entero
    // por cada foto, y son decenas de miles de modulos.
    const r = Math.max(huella.anchoM, huella.altoM) / 2;
    const cerca = this.farm.rows.filter(
      (row) =>
        row.bbox.minX - r <= huella.centre.x && huella.centre.x <= row.bbox.maxX + r &&
        row.bbox.minY - r <= huella.centre.y && huella.centre.y <= row.bbox.maxY + r,
    );

    const escalaX = foto.radio.width / camera.imageW;
    const escalaY = foto.radio.height / camera.imageH;
    const mPorPx = huella.anchoM / camera.imageW;
    let medidos = 0;

    /**
     * Las cajas de esta foto, antes de medir ninguna.
     *
     * Se arma la lista entera primero porque el corrimiento se calcula con
     * TODAS las cajas juntas: una caja sola no puede decir si esta bien puesta
     * —tal vez ese modulo esta raro— pero cien cajas a la vez si.
     */
    const candidatos = this.candidatosDe(cerca, huella, foto, camera, escalaX, escalaY, acortamiento);

    if (!candidatos.length) {
      this.fotosFueraDelParque.push({
        fileName: foto.fileName,
        metros: this.distanciaAlParque(huella.centre),
      });
      return 0;
    }

    /*
      La escala, contada en la propia imagen. Se MIDE y se avisa; no se aplica.

      La huella se calcula con la altura del EXIF y el campo de vision, y sale
      mal. Contra las dos distancias que Mateo midio con cinta en Edenvale —el
      paso entre modulos, 1155 mm, y la separacion entre filas, 5460— el EXIF
      exagera la escala un 4 a 5 % en las tres fotos del Matrice 4T. La causa
      mas probable es que la "altura relativa" se mide contra el punto de
      despegue, que es el suelo, y los paneles estan dos metros mas arriba: a
      cincuenta metros, dos metros son exactamente el 4 %.

      No es un detalle. Cuatro por ciento sobre un cuadro de 640 px son 26 px
      en el borde, 1,3 m sobre el terreno — del tamaño del error de GPS. Y
      peor, porque un error de escala CRECE desde el centro hacia afuera: no lo
      arregla ningun corrimiento ni ningun giro, que es justamente por que
      quedaba un residuo despues de los dos.

      Corregirlo no se hace todavia, y esa decision es deliberada. Sobre tres
      fotos sueltas el paso se puede contar con confianza en una sola fila de
      cada foto, y el factor solo sale en una de las tres. Aplicarselo a una
      foto si y a dos no deja el vuelo con dos escalas distintas, que es peor
      que tener una sola escala mal. Se mide, se dice, y con un vuelo con
      solape —donde cada fila entra en varias fotos— habra con que decidir.
    */
    const desvioDeEscala = this.escalaSegunLaImagen(foto, candidatos, huella, camera, escalaX);
    if (desvioDeEscala && desvioDeEscala !== 1) {
      this.escalas.push({ fileName: foto.fileName, factor: desvioDeEscala });
    }

    const sd = desvioLocal(foto.radio);
    /*
      Y el mismo desvio con radio 1, para la compuerta de panel.

      El de radio 3 sirve para enganchar —desparrama el borde y hace la busqueda
      suave— pero para decidir si un pixel es panel desparrama de mas: a 3 px
      de un escalon ya todo lee aspero. En un modulo de 14 px con la caja de 9,
      no queda ni un pixel liso aunque la caja este perfecta. Con radio 1 el
      escalon sigue siendo escalon y el pasto sigue siendo pasto, pero un pixel
      de panel a 2 px del borde es panel.
    */
    const sdFino = desvioLocal(foto.radio, 1);

    const porFilas = this.escalaSegunLasFilas(candidatos, foto, sd);
    if (porFilas != null) this.pasosDeFila.push({ fileName: foto.fileName, factor: porFilas });

    const limites = this.limiteDeBusquedaPx(cerca, mPorPx, escalaX);
    const limitePx = limites.fotoPx;
    const mPorPxImagen = mPorPx / escalaX;

    /*
      El corrimiento se busca POR FILA, no por foto.

      Se hacia por foto y no alcanzaba. Mirando el retrato de los modulos de una
      fila real, el borde de la caja se despega de -3,5 °C en un extremo a +1,5
      en el otro, cambiando de a poco a lo largo de la fila: no es un
      corrimiento parejo de la foto, es que la linea de la fila que tiene el
      parque no cae exactamente sobre la fila que hay en el campo. Un metro de
      error repartido entre dos puntas es normal en un replanteo, y con la caja
      al 60 % del modulo no molestaba — pero es lo que impedia agrandarla.

      Cada fila trae veinte y pico de cajas en una foto, de sobra para
      estimarle su propio corrimiento. Las filas que asoman con pocos modulos
      caen al corrimiento general de la foto, que sigue calculandose con todas.
    */
    const encaje = engancharFoto(
      foto.radio, sd, candidatos.map((c) => c.caja), limitePx, mPorPxImagen,
    );
    if (encaje) this.encajes.push({ fileName: foto.fileName, metros: encaje.metros });

    const giro = encaje?.giroDeg ?? 0;
    const centroX = foto.radio.width / 2, centroY = foto.radio.height / 2;
    const puesta = (caja: CajaDeMedicion) => girar(caja, giro, centroX, centroY);
    const dx = encaje?.dx ?? 0;
    const dy = encaje?.dy ?? 0;

    /*
      Y despues de correrla, si la foto quedo bien puesta.

      Se mira el conjunto y no cada caja: la falla que esto ataca corre a todas
      las cajas de la foto por igual. Una foto que no engancho no da algunos
      hallazgos malos — los da todos malos, y con la seguridad de siempre.
    */
    /*
      Y AHORA la rejilla se acomoda tambien A LO LARGO de la fila.

      Es lo que faltaba, y es lo que rompia el informe de la peor manera: con
      el numero de panel corrido uno. `engancharFoto` solo corrige cruzado
      porque "una fila de modulos es igual a lo largo" — y no lo es. Cada 24,8
      px hay una junta, dos marcos de aluminio y el aire entre ellos, y en la
      termica lee de 2 a 4 grados mas fria que la celda. Con esa regla se puede
      preguntar si la rejilla del parque cae sobre los modulos o entre ellos.

      Se busca por FILA porque el error es de la fila: es donde quedo el
      replanteo, no como volo el dron. Y se busca en medio modulo para cada
      lado, asi que ninguna caja se puede ir al modulo de al lado — lo unico
      que cambia es que la caja del modulo 26 se apoya sobre el modulo 26.
    */
    /*
      Y cada fila termina de acomodarse CRUZADO por su cuenta.

      El enganche de la foto corre todas las cajas juntas. En las fotos del
      borde entran filas de dos bloques con replanteos distintos, el ajuste
      sigue a la mayoria y deja a las otras un quinto afuera del panel —
      medido: 98 % de caja sobre panel en las filas del bloque 2, 87 % en las
      del bloque 1 vistas desde el mismo vuelo, y de ahi 189 hallazgos con ΔT
      cero. Ver `engancharFila`.
    */
    const pasoDeLaFila = this.pasoPorFila(candidatos);
    const cruzadoPorFila = this.engancharCadaFila(candidatos, foto, sd, puesta, dx, dy, limites.filaPx, pasoDeLaFila);
    const puestaEnFila = (c: { m: ModuleRef; caja: CajaDeMedicion }): CajaDeMedicion => {
      const g = puesta(c.caja);
      const e = cruzadoPorFila.get(c.m.rowId);
      return e ? { ...g, cx: g.cx + e.ex, cy: g.cy + e.ey } : g;
    };

    const alineado = this.alinearALoLargo(candidatos, cerca, foto, sd, puestaEnFila, dx, dy, pasoDeLaFila);
    for (const [rowId, a] of alineado.filas) {
      this.alineaciones.push({
        fileName: foto.fileName,
        rowId,
        modulos: a.modulos,
        ...(a.contraste != null ? { contraste: a.contraste } : {}),
        ...(a.factor != null ? { factor: a.factor } : {}),
        ...(a.anclaModulos != null ? { ancla: a.anclaModulos } : {}),
      });
    }
    const corrX = (m: ModuleRef) =>
      dx + (cruzadoPorFila.get(m.rowId)?.ex ?? 0) + (alineado.cajas.get(m)?.ex ?? 0);
    const corrY = (m: ModuleRef) =>
      dy + (cruzadoPorFila.get(m.rowId)?.ey ?? 0) + (alineado.cajas.get(m)?.ey ?? 0);

    const sondeos = candidatos.map((c) =>
      sondearCaja(foto.radio, sd, puesta(c.caja), corrX(c.m), corrY(c.m)));
    const confianza = confianzaDeFoto(sondeos);
    if (!confianza.sirve) {
      this.fotosSinEnganche.push({
        fileName: foto.fileName,
        fraccionLisa: confianza.fraccionLisa,
      });
      return 0;
    }

    /**
     * Se mide todo primero y se guarda despues.
     *
     * En el medio va la correccion de vinieteo, que sale de las medianas de
     * los propios modulos de esta foto: no se puede aplicar hasta tenerlos
     * todos medidos.
     */
    const medidas: Array<{
      m: ModuleRef;
      clave: string;
      caja: CajaDeMedicion;
      hit: NonNullable<ReturnType<typeof medirCaja>>;
      retrato: ReturnType<typeof retratoDeCaja>;
      ladoCeldaPx: number;
      d: number;
      textura: number | undefined;
      fraccionPanel: number | undefined;
      /** Que fraccion de los pixeles de la caja son panel (lisos). */
      lisura: number;
      r: number;
    }> = [];

    /*
      Cual es el primer y el ultimo modulo de cada STRING.

      De cada string y no de cada fila, porque los huecos del campo estan en
      las dos puntas: al final de la fila esta el motor del tracker, y en el
      medio —entre un string y el siguiente— hay 555 mm de separacion. Los dos
      salieron en los hallazgos falsos de los vuelos reales, el 28 de un string
      y el 1 del otro, uno a cada lado del mismo hueco.

      Sale del parque entero y no de lo que entro en el cuadro: un string
      cortado por el borde de la foto tiene su propia primera caja, y esa no es
      una punta de string — es una punta de foto, que ya se descarta por otro
      lado.
    */
    const extremos = new Map<string, { min: number; max: number }>();
    for (const row of cerca) {
      for (const m of modulesOfRow(row, this.farm)) {
        const k = `${m.rowId}|${m.stringNumber}`;
        const e = extremos.get(k);
        if (!e) extremos.set(k, { min: m.module, max: m.module });
        else {
          if (m.module < e.min) e.min = m.module;
          if (m.module > e.max) e.max = m.module;
        }
      }
    }
    const esPunta = (m: ModuleRef) => {
      const e = extremos.get(`${m.rowId}|${m.stringNumber}`);
      return !!e && (m.module === e.min || m.module === e.max);
    };


    /*
      Cuanto tiene que caer sobre panel la caja de una PUNTA de string.

      Medido contra los modulos del MEDIO de esta misma foto, no contra un
      numero fijo. Un modulo del medio siempre cae sobre panel: sobre el vuelo
      entero de 453 fotos su fraccion tipica es 0,75 y solo el 5 % baja de
      0,58. Pedirle a la punta tres cuartos de lo que da un modulo normal la
      deja pasar cuando de verdad hay panel ahi, y la frena cuando la caja esta
      mordiendo el hueco.

      Con el corte fijo en 0,35 pasaban igual: de los 14 hallazgos del vuelo
      entero, 12 eran punta y sus cajas daban 0,38 a 0,50 — arriba del corte
      viejo y muy por debajo de lo que da un panel de verdad. Mateo los miro
      uno por uno: no habia defecto en ninguno.
    */
    const normales = candidatos
      .map((c, i) => (esPunta(c.m) ? null : sondeos[i]?.fraccionPanel))
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const minimoDePunta = normales.length >= MODULOS_PARA_JUZGAR_LA_PUNTA
      ? Math.max(FRACCION_PANEL_MINIMA, PARTE_DE_UN_MODULO_NORMAL * normales[normales.length >> 1]!)
      : FRACCION_PANEL_MINIMA;

    for (let i = 0; i < candidatos.length; i++) {
      const { m, clave, ladoCeldaPx, celdaPx, d } = candidatos[i]!;
      const caja = puesta(candidatos[i]!.caja);
      const cx = caja.cx + corrX(m);
      const cy = caja.cy + corrY(m);

      /*
        La caja suelta que quedo mucho mas fria que su propia foto.

        Solo el lado frio. Un defecto siempre calienta, asi que este freno no
        puede tirar un hallazgo; lo que si tira es la sombra del borde de la
        fila, que lee diez grados por debajo de los paneles de al lado.

        Una caja que se sale del cuadro no se juzga aca: mas abajo la descarta
        el conteo de pixeles, que sabe distinguir "cortada por el borde" de
        "mal puesta" — se descartan igual pero se cuentan y se dicen distinto.
      */
      const sondeo = sondeos[i];
      if (sondeo && sondeo.celsius < confianza.medianaC - FRIO_QUE_NO_ES_PANEL_C) {
        this.sinPanel.add(clave);
        continue;
      }

      /*
        Y la PUNTA de fila cuya caja no esta sobre un panel.

        El freno de arriba solo mira el lado frio, asi que dejaba pasar el
        hueco entre una fila y la siguiente —que al sol lee CALIENTE— y con el
        pasaba el motor del tracker, que es donde cae la ultima caja de cada
        fila. Eso no da una medicion mala: da un hallazgo, porque el suelo
        caliente contra los hermanos del string es exactamente lo que busca la
        deteccion.

        Solo la punta del string, y esto es lo importante. En el medio la caja
        SIEMPRE esta sobre un panel —medido: el 99 % de los modulos del medio
        dan mas de 0,6 de caja sobre panel en los dos vuelos reales— y ahi este
        freno no puede hacer mas que daño: un defecto grande tambien despega
        puntos de la mediana de su caja, asi que aplicarlo en el medio seria
        cambiar hallazgos falsos por defectos perdidos. En la punta es al
        reves: es donde el parque se equivoca y donde no hay panel que medir.
      */
      if (esPunta(m) && sondeo && sondeo.fraccionPanel < minimoDePunta) {
        this.sinPanel.add(clave);
        this.fueraDelPanel.push({ rowId: m.rowId, module: m.module, clave });
        continue;
      }

      // El modulo tiene que haber entrado casi entero — el MODULO, no la
      // caja, que es el 60 % de el. Medio modulo apoyado en el borde del
      // sensor no es una medicion, es el borde del cuadro.
      if (fraccionDelModuloEnElCuadro(caja, cx, cy, foto.radio.width, foto.radio.height) < FRACCION_MINIMA_MEDIDA) {
        this.recortados.add(clave);
        continue;
      }
      const hit = medirCaja(foto.radio, cx, cy, caja.largo, caja.cruzado, celdaPx, caja.rotRad);
      if (!hit || hit.pixeles < hit.esperados * FRACCION_MINIMA_MEDIDA) {
        this.recortados.add(clave);
        continue;
      }

      medidas.push({
        m, clave, ladoCeldaPx, d,
        caja: { ...caja, cx, cy },
        hit,
        lisura: fraccionLisaDeCaja(sdFino, foto.radio.width, foto.radio.height, { ...caja, cx, cy }) ?? 0,
        // La forma de la mancha, para poder decir QUE defecto es y no solo
        // cuanto se despega.
        retrato: retratoDeCaja(foto.radio, cx, cy, caja.largo, caja.cruzado, caja.rotRad),
        textura: sondeo?.liso,
        fraccionPanel: sondeo?.fraccionPanel,
        r: radioNormalizado(cx, cy, foto.radio.width, foto.radio.height),
      });
    }

    /*
      El vinieteo de ESTA foto, sacado de sus propios modulos.

      El borde del cuadro lee mas caliente que el centro —cuatro grados en esta
      camara— y los hermanos de un string casi nunca caen a la misma distancia
      del centro. Sin esto, un modulo fotografiado en una esquina sale con tres
      grados que no existen contra hermanos fotografiados en el medio.
    */
    /*
      Que FILAS de esta foto tienen un tracker de verdad abajo.

      El parque miente. En el bloque 1 de Wellington hay fotos donde las cajas
      de una fila caen enteras sobre pasto —el parque dice que ahi hay una fila
      y en la imagen no hay nada— y esa misma fila, en la foto siguiente, cae
      perfecta sobre los paneles. Medidas asi, esas cajas dan los hallazgos que
      llenaron el informe.

      Lo que decide es la TEXTURA, no la temperatura. Probado y descartado:
      separar por temperatura mata los hallazgos que mas importan. En las fotos
      del 3 de septiembre el string desconectado corre a 44,5 °C —mas caliente
      que el pasto de su propia foto— y cualquier corte por temperatura lo tira
      junto con el pasto. La textura no se deja engañar: ese string tiene 0,21
      de desvio local, igual que un panel sano, porque un panel caliente sigue
      siendo una superficie lisa. El pasto de las dos filas fantasma da 1,02 y
      1,09, el doble que cualquier fila de paneles de las dos salidas.

      Se juzga por fila y con la MEDIANA. Una caja sola puede caer en un parche
      raro; veinte cajas seguidas sobre pasto no pasan por casualidad. Y la
      mediana no la mueve un modulo roto: un diodo de bypass calienta uno de
      veintiocho.
    */
    const porFila = new Map<string, number[]>();
    for (const x of medidas) {
      if (x.textura != null) push2(porFila, x.m.rowId, x.textura);
    }
    const fantasmas = new Set<string>();
    for (const [id, texturas] of porFila) {
      // Una fila que asoma con pocas cajas no se juzga: no hay con que, y el
      // solape la va a agarrar entera en otra foto.
      if (texturas.length < CAJAS_PARA_JUZGAR_LA_FILA) continue;
      if (percentil(texturas, 50) >= LISO_C) fantasmas.add(id);
    }
    if (fantasmas.size) {
      for (let i = medidas.length - 1; i >= 0; i--) {
        if (!fantasmas.has(medidas[i]!.m.rowId)) continue;
        this.sinPanel.add(medidas[i]!.clave);
        medidas.splice(i, 1);
      }
    }

    /*
      La compuerta de panel: nunca se mide fuera de un panel.

      Pixel por pixel y POR FILA. Por fila, porque la falla que esto frena es
      de la fila entera —la caja corrida un quinto sobre el suelo, en todos los
      modulos de esa fila en esa foto— y porque un defecto de verdad tambien
      ensucia la lisura de SU caja: el diodo de bypass del modulo 26 da 0,70 de
      pixeles lisos, contra 1,00 de sus vecinos. Juzgar caja por caja tiraria
      el unico hallazgo real del vuelo junto con el suelo. La mediana de la
      fila no la mueve un modulo roto, y si la mueve una fila mal puesta.

      Las filas que asoman con pocas cajas se juzgan caja por caja, que es
      mas duro: ahi no hay mediana que proteja al defecto, y se prefiere
      perderlo en esta foto —el solape lo agarra en la siguiente— antes que
      medir suelo.

      Y un piso para todas: con menos de la mitad de la caja sobre panel no
      hay nada que medir, sea defecto o no.
    */
    const lisuraPorFila = new Map<string, number[]>();
    for (const x of medidas) push2(lisuraPorFila, x.m.rowId, x.lisura);
    const filasMalPuestas = new Set<string>();
    for (const [id, lisuras] of lisuraPorFila) {
      if (lisuras.length >= CAJAS_PARA_JUZGAR_LA_COMPUERTA && percentil(lisuras, 50) < PANEL_MINIMO_DE_FILA) {
        filasMalPuestas.add(id);
      }
    }
    /*
      Y la fila donde NO se ven las juntas entre modulos, con modulos de sobra
      para verlas, tampoco se mide. Una fila de paneles tiene una junta cada
      paso de modulo; la sombra del panel, la calle y el pasto no. Es la
      segunda mitad de "nunca medir fuera de un panel": la lisura dice que es
      una superficie pareja, las juntas dicen que esa superficie son modulos.
    */
    const enCuadroPorFila = new Map<string, number>();
    for (const c of candidatos) {
      const g = puestaEnFila(c);
      const cx = g.cx + dx, cy = g.cy + dy;
      if (cx < 0 || cy < 0 || cx >= foto.radio.width || cy >= foto.radio.height) continue;
      enCuadroPorFila.set(c.m.rowId, (enCuadroPorFila.get(c.m.rowId) ?? 0) + 1);
    }
    /*
      Solo si en ESTA foto las juntas se ven en alguna fila. Un vuelo mas alto,
      o una camara mas gruesa, puede no resolver las juntas en ninguna parte, y
      ahi la regla no puede decir nada: descartaria el parque entero. Con una
      fila que las muestra, la que no las muestra no es una fila.
    */
    const fotoVeJuntas = [...alineado.filas.values()].some((f) => f.contraste != null);
    if (fotoVeJuntas) {
      for (const [id, n] of enCuadroPorFila) {
        if (n >= MODULOS_PARA_EXIGIR_JUNTAS && alineado.filas.get(id)?.contraste == null) {
          filasMalPuestas.add(id);
        }
      }
    }
    for (let i = medidas.length - 1; i >= 0; i--) {
      const x = medidas[i]!;
      const pocas = (lisuraPorFila.get(x.m.rowId)?.length ?? 0) < CAJAS_PARA_JUZGAR_LA_COMPUERTA;
      const afuera =
        filasMalPuestas.has(x.m.rowId) ||
        x.lisura < PANEL_MINIMO_DE_CAJA ||
        (pocas && x.lisura < PANEL_MINIMO_DE_FILA);
      if (!afuera) continue;
      this.sinPanel.add(x.clave);
      this.compuerta.push({ fileName: foto.fileName, rowId: x.m.rowId, block: x.m.block, lisura: x.lisura });
      medidas.splice(i, 1);
    }
    for (const x of medidas) {
      const a = this.auditoria.get(x.m.block) ?? { medidas: 0, sumaLisura: 0, bajo90: 0, fotos: new Set<string>() };
      a.medidas++;
      a.sumaLisura += x.lisura;
      if (x.lisura < 0.9) a.bajo90++;
      a.fotos.add(foto.fileName);
      this.auditoria.set(x.m.block, a);
    }

    const vinieta = medirVinieta(medidas.map((x) => ({ r: x.r, celsius: x.hit.celsius })));
    if (vinieta) this.vinietas.push({ fileName: foto.fileName, maximoC: vinieta.maximoC });

    /*
      Y el calor que trae la PUNTA de la fila, que tampoco es del modulo.

      Se mide despues del vinieteo y sobre los valores ya corregidos: son dos
      sesgos distintos —uno crece con el radio en el cuadro, el otro con la
      cercania a la punta de la fila— y mezclarlos haria que cada uno se coma
      parte del otro.

      Esta correccion es POR FOTO y hay una segunda, la del vuelo entero, en
      `comparar`. No sobran: se probo dejar solo la del vuelo y la
      repetibilidad del motor empeoro de 0,41 a 0,58 °C, o sea que buena parte
      del calor de la punta depende de COMO se la mira —el angulo con que entra
      la calle en el cuadro— y eso solo lo puede ver la foto. Lo que la foto no
      puede ver es la parte pareja, porque para eso hace falta el string
      entero: en un vuelo a 52 m cada foto agarra cinco o seis modulos de cada
      fila. Cada una limpia lo que la otra no alcanza.
    */
    const punta = calorDeLaPunta(medidas.map((x) => ({
      string: `${x.m.rowId}|${x.m.stringNumber}`,
      posicion: x.m.module,
      celsius: x.hit.celsius - (vinieta ? correccion(vinieta, x.r) : 0),
    })));

    for (const x of medidas) {
      // Se le resta lo mismo a la mediana y al punto caliente: el chequeo
      // interno los compara entre si, y los dos estan al mismo radio, asi que
      // la diferencia tiene que quedar igual.
      const resta = (vinieta ? correccion(vinieta, x.r) : 0) + (punta.get(x.m.module) ?? 0);

      /*
        La misma medicion, hecha desde otra foto.

        Se guarda la diferencia ANTES de quedarse con una de las dos. Es la
        repetibilidad del instrumento entero —lector, enganche, vinieteo,
        geometria— medida sin ninguna verdad de campo: nadie tiene que saber
        que panel esta roto para que este numero signifique algo.
      */
      const previo = this.mejor.get(x.clave);
      const celsius = x.hit.celsius - resta;
      if (previo && previo.fileName !== foto.fileName) {
        this.repeticiones.push({
          clave: x.clave,
          diferencia: Math.abs(celsius - previo.celsius),
        });
      }
      // De las dos se guarda la que vio el modulo mas cerca del centro del
      // cuadro: en el borde la termica miente mas.
      const muestra: Muestra = {
        modulo: x.m,
        ...(x.retrato ? { retrato: x.retrato } : {}),
        ...(foto.cuando != null ? { cuando: foto.cuando } : {}),
        celsius,
        pixeles: x.hit.pixeles,
        puntoCalienteC: x.hit.puntoCalienteC - resta,
        pixelesPorCelda: x.ladoCeldaPx * x.ladoCeldaPx,
        ...(x.textura != null ? { textura: x.textura } : {}),
        ...(x.fraccionPanel != null ? { fraccionPanel: x.fraccionPanel } : {}),
        fileName: foto.fileName,
        distanciaAlCentroM: x.d,
        caja: {
          cx: x.caja.cx, cy: x.caja.cy,
          largo: x.caja.largo, cruzado: x.caja.cruzado, rotRad: x.caja.rotRad,
          ancho: foto.radio.width, alto: foto.radio.height,
          ...(x.caja.largoModulo != null ? { largoModulo: x.caja.largoModulo } : {}),
          ...(x.caja.cruzadoModulo != null ? { cruzadoModulo: x.caja.cruzadoModulo } : {}),
          /*
            El paso entre modulos, y hacia que lado crece el numero.

            Sin esto no se puede decir a que modulo pertenece una mancha que
            cae cerca del borde de la caja: hace falta saber cuanto mide un
            modulo en pixeles y para que lado se cuenta.
          */
          ...(pasoDeLaFila.get(x.m.rowId)
            ? {
                pasoPx: pasoDeLaFila.get(x.m.rowId)!.pasoPx,
                sentido: pasoDeLaFila.get(x.m.rowId)!.sentido,
              }
            : {}),
        },
      };
      /*
        Se guardan TODAS las mediciones, no solo la mejor.

        La mejor —la que vio el modulo mas cerca del centro— es la que se
        reporta. Las otras son la prueba: un defecto de verdad esta caliente
        en todas las fotos, y una caja que cayo sobre la calle esta caliente
        en una sola. `comparar` las usa para no reportar lo que no repite.
      */
      this.todas.push(muestra);
      if (previo && previo.distanciaAlCentroM <= x.d) continue;
      medidos++;
      this.sinPanel.delete(x.clave);
      this.mejor.set(x.clave, muestra);
    }

    return medidos;
  }


  /**
   * Donde cae cada modulo del vecindario dentro de esta foto.
   *
   * Es una funcion de la huella a proposito: se la llama dos veces, una con la
   * huella que sale del EXIF y otra con la huella ya corregida de escala. Que
   * sea la MISMA cuenta las dos veces es lo unico que garantiza que la
   * correccion se aplique de verdad y no a medias.
   */
  private candidatosDe(
    cerca: CompiledFarm["rows"],
    huella: ReturnType<typeof footprint>,
    foto: FotoTermica,
    camera: Camera,
    escalaX: number,
    escalaY: number,
    acortamiento: number,
  ): Array<{
    m: ModuleRef;
    clave: string;
    caja: CajaDeMedicion;
    ladoCeldaPx: number;
    celdaPx: number;
    d: number;
  }> {
    const { moduloAnchoM } = this.opts;
    const moduloLargoM = this.opts.moduloLargoM * Math.min(1, Math.max(0.2, acortamiento));
    const mPorPx = huella.anchoM / camera.imageW;
    const candidatos: Array<{
      m: ModuleRef;
      clave: string;
      caja: CajaDeMedicion;
      ladoCeldaPx: number;
      celdaPx: number;
      d: number;
    }> = [];

    for (const row of cerca) {
      /**
       * Hacia donde corre esta fila DENTRO de la imagen.
       *
       * No se deduce del rumbo: se proyecta el propio vector de la fila con la
       * misma cuenta que ubica los pixeles, asi que cualquier convencion de
       * signo o de yaw sale igual de los dos lados. Razonarlo aparte es como se
       * desincronizan estas cosas.
       */
      const yawRad = (huella.rotacionDeg * Math.PI) / 180;
      const cosY = Math.cos(yawRad), sinY = Math.sin(yawRad);
      const uImg = row.ux * cosY - row.uy * sinY;    // hacia la derecha de la imagen
      const vImg = row.ux * sinY + row.uy * cosY;    // hacia arriba de la imagen
      // px crece con u; py crece con -v.
      const anguloEnImagen = Math.atan2(
        (-vImg / huella.altoM) * camera.imageH * escalaY,
        (uImg / huella.anchoM) * camera.imageW * escalaX,
      );

      for (const m of modulesOfRow(row, this.farm)) {
        const px = pixelOf(huella, { x: m.x, y: m.y }, camera);
        if (!px) continue;

        const d = Math.hypot(m.x - huella.centre.x, m.y - huella.centre.y);
        const clave = `${m.rowId}#${m.positionInRow}`;
        /*
          Antes se salteaba el modulo que otra foto ya habia medido mejor.

          Ahora se mide igual, porque esa segunda medicion es la unica prueba
          que existe de que todo esto funciona: el MISMO panel, visto desde
          otra posicion del dron, en otra parte del cuadro y con otro angulo,
          tiene que dar la misma temperatura. Si las dos mediciones no
          coinciden, no hay ningun defecto que reportar — hay un pipeline roto,
          y sin esto no se enteraba nadie.

          Cuesta medir de mas los modulos que caen en dos fotos. Con el solape
          de un vuelo real eso es cerca del doble de mediciones, y vale la pena:
          es la diferencia entre entregar una lista y poder defenderla.
        */

        const cx = px.px * escalaX;
        const cy = px.py * escalaY;
        /**
         * La caja del modulo, en el marco de la FILA.
         *
         * `largoCaja` va a lo largo de la fila —es `widthMm`, lo que ocupa cada
         * modulo entre sus vecinos— y `cruzadoCaja` hacia los costados.
         *
         * Estaban puestas sobre los ejes de la IMAGEN y cambiadas entre si: el
         * ancho sobre X y el largo sobre Y. En un parque de filas norte-sur
         * —Edenvale— la caja de 2,28 m caia A LO LARGO de la fila y cubria casi
         * dos modulos. Medido con un solo modulo caliente en una escena
         * sintetica: el vecino SANO salia con severidad moderada. La cuadrilla
         * sale a caminar hasta el panel equivocado, no lo encuentra roto, y
         * deja de creerle al informe.
         */
        const mPorPxRadio = huella.anchoM / (camera.imageW * escalaX);
        const largoCaja = (moduloAnchoM * FRACCION_UTIL) / mPorPxRadio;
        const cruzadoCaja = (moduloLargoM * FRACCION_UTIL) / mPorPxRadio;

        // Cuantos pixeles cubre una celda: es el tamaño del parche mas caliente
        // que se busca adentro del modulo, y tambien el que decide si se puede
        // ver o no.
        // La celda tambien se acorta: es cuadrada sobre el modulo, asi que
        // vista desde arriba es un rectangulo del mismo largo y mas angosto.
        const ladoCeldaPx = ((this.opts.celdaM ?? CELDA_M) / mPorPx) * escalaX;
        const celdaPx = ladoCeldaPx * ladoCeldaPx * Math.min(1, Math.max(0.2, acortamiento));

        candidatos.push({
          m, clave, ladoCeldaPx, celdaPx, d,
          caja: {
            cx, cy, largo: largoCaja, cruzado: cruzadoCaja, rotRad: anguloEnImagen,
            largoModulo: moduloAnchoM / mPorPxRadio,
            cruzadoModulo: moduloLargoM / mPorPxRadio,
          },
        });
      }
    }

    return candidatos;
  }

  /**
   * El factor de escala que pide la propia imagen, contando el paso entre
   * modulos en unas cuantas filas.
   */
  /**
   * Cuanto mide un modulo en pixeles en cada fila, y para que lado se cuenta.
   *
   * Sale de las propias cajas ya proyectadas —la distancia entre dos modulos
   * consecutivos— asi que compara manzanas con manzanas con todo lo demas. El
   * SENTIDO es tan importante como el paso: el eje de la imagen a lo largo de
   * la fila apunta para un lado o para el otro segun como caiga la fila en el
   * cuadro, y sin saberlo, corregir un numero de modulo lo corre justo para el
   * lado contrario.
   */
  private pasoPorFila(
    candidatos: Array<{ m: ModuleRef; caja: CajaDeMedicion }>,
  ): Map<string, { pasoPx: number; sentido: number }> {
    const porFila = new Map<string, Array<{ m: ModuleRef; caja: CajaDeMedicion }>>();
    for (const c of candidatos) push2(porFila, c.m.rowId, c);
    const out = new Map<string, { pasoPx: number; sentido: number }>();
    for (const [rowId, lista] of porFila) {
      if (lista.length < 4) continue;
      lista.sort((a, b) => a.m.positionInRow - b.m.positionInRow);
      const rot = lista[0]!.caja.rotRad;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const u = (c: CajaDeMedicion) => c.cx * cos + c.cy * sin;
      const saltos: number[] = [];
      for (let i = 1; i < lista.length; i++) {
        if (lista[i]!.m.positionInRow - lista[i - 1]!.m.positionInRow !== 1) continue;
        saltos.push(Math.hypot(
          lista[i]!.caja.cx - lista[i - 1]!.caja.cx,
          lista[i]!.caja.cy - lista[i - 1]!.caja.cy,
        ));
      }
      if (saltos.length < 3) continue;
      saltos.sort((a, b) => a - b);
      const pasoPx = saltos[saltos.length >> 1]!;
      if (!(pasoPx > 6)) continue;
      const sentido = Math.sign(u(lista[lista.length - 1]!.caja) - u(lista[0]!.caja)) || 1;
      out.set(rowId, { pasoPx, sentido });
    }
    return out;
  }

  /**
   * El corrimiento cruzado de cada fila, despues del de la foto.
   *
   * Con un criterio mas que el de la foto: ademas de lisa, la banda tiene que
   * tener JUNTAS. Es lo que separa un panel de su propia sombra.
   *
   * Se vio en el vuelo del bloque 2, foto 0559: las cajas de las filas del
   * bloque 1 caian todas sobre la banda oscura que hay al lado de cada fila
   * — la sombra que tira el panel inclinado a las dos de la tarde. La sombra
   * es lisa, tan lisa como el panel, y la busqueda por lisura elige entre las
   * dos con el ruido. Elegida la sombra, el modulo mide 29 grados, sin
   * juntas, y sus hermanos medidos sobre el panel en otra foto salen a +16.
   * Lo que la sombra no tiene, ni la calle, ni el pasto, es la junta cada
   * 24,8 px. Asi que entre las bandas lisas que hay al alcance, gana la que
   * tiene juntas.
   *
   * Se guarda cuanto se corrio cada una: es el dato que dice que en el parque
   * esa fila esta en otro lado que en el campo, y con eso se arregla el parque.
   */
  private engancharCadaFila(
    candidatos: Array<{ m: ModuleRef; caja: CajaDeMedicion }>,
    foto: FotoTermica,
    sd: Float32Array,
    puesta: (c: CajaDeMedicion) => CajaDeMedicion,
    dx: number,
    dy: number,
    limitePx: number,
    pasoDeLaFila: Map<string, { pasoPx: number; sentido: number }>,
  ): Map<string, { ex: number; ey: number; conJuntas: boolean }> {
    const porFila = new Map<string, CajaDeMedicion[]>();
    for (const c of candidatos) {
      const g = puesta(c.caja);
      const caja = { ...g, cx: g.cx + dx, cy: g.cy + dy };
      if (caja.cx < 0 || caja.cy < 0 || caja.cx >= foto.radio.width || caja.cy >= foto.radio.height) continue;
      push2(porFila, c.m.rowId, caja);
    }
    const pasos = [...pasoDeLaFila.values()].map((p) => p.pasoPx).sort((a, b) => a - b);
    const pasoDeLaFoto = pasos.length ? pasos[pasos.length >> 1]! : null;
    const w = foto.radio.width, h = foto.radio.height;

    const out = new Map<string, { ex: number; ey: number; conJuntas: boolean }>();
    for (const [rowId, cajas] of porFila) {
      const paso = pasoDeLaFila.get(rowId)?.pasoPx ?? pasoDeLaFoto;

      /*
        Cuanto se repite el modulo con la fila corrida `t` pixeles cruzado.

        Es la pregunta que la lisura no puede contestar, y se hace con la
        prueba rapida —la autocorrelacion a un paso— porque hay que hacerla en
        cada corrimiento posible de cada fila. La rejilla entera, con fase y
        escala, se busca despues, una vez que la fila ya esta sobre los
        modulos.
      */
      const juntasEn = (t: number, ux: number, uy: number): { repeticion: number; celsius: number } => {
        if (paso == null || cajas.length < 4) return { repeticion: 0, celsius: NaN };
        const ddx = t * ux, ddy = t * uy;
        const rot = cajas[0]!.rotRad;
        const ax = Math.cos(rot), ay = Math.sin(rot);
        const cx = cajas.reduce((a, c) => a + c.cx, 0) / cajas.length + ddx;
        const cy = cajas.reduce((a, c) => a + c.cy, 0) / cajas.length + ddy;
        const ts = cajas.map((c) => (c.cx + ddx - cx) * ax + (c.cy + ddy - cy) * ay);
        const t0 = Math.min(...ts) - paso / 2, t1 = Math.max(...ts) + paso / 2;
        const pC = perfilALoLargo(foto.radio.celsius, w, h, cx, cy, rot, cajas[0]!.cruzado, t0, t1);
        let suma = 0, n = 0;
        for (const v of pC) if (Number.isFinite(v)) { suma += v; n++; }
        return { repeticion: periodicidadDeModulos(pC, paso), celsius: n ? suma / n : NaN };
      };

      const e = engancharFila(foto.radio, sd, cajas, limitePx, juntasEn);
      if (!e) continue;
      out.set(rowId, { ex: e.dx, ey: e.dy, conJuntas: e.conJuntas });
      this.enganchesDeFila.push({ fileName: foto.fileName, rowId, px: Math.hypot(e.dx, e.dy) });
    }

    return out;
  }

  /**
   * Cuanto hay que correr cada fila A LO LARGO para que las cajas caigan sobre
   * los modulos, medido en la propia foto.
   *
   * Se hace despues del enganche cruzado y sobre las cajas ya giradas y
   * corridas: son dos correcciones distintas —una es como volo el dron, la
   * otra es donde quedo el replanteo de la fila— y medir la segunda sobre las
   * cajas sin corregir la primera mezcla las dos.
   *
   * Dos reglas, cada una para lo que sirve:
   *
   *   - Las JUNTAS entre modulos dan la fase con menos de un pixel de error,
   *     pero solo en medio modulo para cada lado: no saben cual modulo es cual.
   *   - El FINAL de la fila da el numero. Donde el panel se termina hay un
   *     modulo con nombre —el 1 o el ultimo— y anclar ahi es contar desde la
   *     punta, que es lo que hace el cliente con el informe en la mano.
   *
   * Cuando estan las dos, el final decide el modulo entero y las juntas el
   * resto. Cuando solo esta el final —una fila que asoma con dos o tres
   * modulos en el borde del cuadro, que es justo donde viven el 1 y el 28—
   * alcanza con el final. Y lo que se midio del final se guarda por fila,
   * porque vale para las fotos donde el final NO se ve: ahi las juntas ponen
   * la caja sobre un panel, y con el final medido en otra foto se sabe cual.
   *
   * Devuelve el corrimiento ya descompuesto en pixeles de imagen, porque es
   * como se usa: se suma a `dx`/`dy` en todos los lugares donde se toca la
   * caja. Que salga de un solo lugar es lo que impide que la caja que se MIDE
   * y la que se DIBUJA terminen en sitios distintos.
   */
  private alinearALoLargo(
    candidatos: Array<{ m: ModuleRef; caja: CajaDeMedicion }>,
    cerca: CompiledFarm["rows"],
    foto: FotoTermica,
    sd: Float32Array,
    puesta: (c: { m: ModuleRef; caja: CajaDeMedicion }) => CajaDeMedicion,
    dx: number,
    dy: number,
    pasoDeLaFila: Map<string, { pasoPx: number; sentido: number }>,
  ): { cajas: Map<ModuleRef, { ex: number; ey: number }>; filas: Map<string, Alineacion> } {
    const porFila = new Map<string, Array<{ m: ModuleRef; caja: CajaDeMedicion }>>();
    for (const c of candidatos) push2(porFila, c.m.rowId, c);
    const out = {
      cajas: new Map<ModuleRef, { ex: number; ey: number }>(),
      filas: new Map<string, Alineacion>(),
    };

    /*
      El paso de la FOTO, para las filas que asoman con pocos modulos.

      El paso entre modulos es el mismo en toda la foto —misma escala, mismo
      parque— asi que una fila de la que entran dos modulos puede usar el que
      contaron las demas. Y hace falta, porque esas filas de dos modulos son
      exactamente las de la punta, donde estan el 1 y el 28.
    */
    const pasos = [...pasoDeLaFila.values()].map((p) => p.pasoPx).sort((a, b) => a - b);
    const pasoDeLaFoto = pasos.length ? pasos[pasos.length >> 1]! : null;

    const w = foto.radio.width, hh = foto.radio.height;
    for (const [rowId, lista] of porFila) {
      const paso = pasoDeLaFila.get(rowId)?.pasoPx ?? pasoDeLaFoto;
      if (paso == null || lista.length < 2) continue;
      const row = cerca.find((r) => r.source.id === rowId);
      if (!row) continue;

      lista.sort((a, b) => a.m.positionInRow - b.m.positionInRow);
      const todas = lista.map((c) => {
        const g = puesta(c);
        return { m: c.m, caja: { ...g, cx: g.cx + dx, cy: g.cy + dy } };
      });
      const rot = todas[0]!.caja.rotRad;
      const ux = Math.cos(rot), uy = Math.sin(rot);
      const cx = todas.reduce((a, c) => a + c.caja.cx, 0) / todas.length;
      const cy = todas.reduce((a, c) => a + c.caja.cy, 0) / todas.length;
      const t = (c: CajaDeMedicion) => (c.cx - cx) * ux + (c.cy - cy) * uy;
      // Para que lado de t crece el numero de posicion.
      const sentido = Math.sign(t(todas[todas.length - 1]!.caja) - t(todas[0]!.caja)) || 1;

      /*
        Solo las cajas que de verdad estan en el cuadro.

        `candidatos` trae todo lo que toca la huella, y la huella se calcula
        sobre el terreno: una fila que cruza la foto entera aporta veinte cajas
        de las que la mitad caen fuera del sensor. Esas no tienen imagen que
        mirar, asi que solo diluyen el perfil — y peor, arrastran el promedio
        de "centro" y el de "junta" hacia el mismo valor, que es exactamente lo
        que hace que la fila se descarte por falta de contraste.
      */
      const enCuadro = todas.filter((c) =>
        c.caja.cx >= 0 && c.caja.cy >= 0 && c.caja.cx < w && c.caja.cy < hh);
      if (!enCuadro.length) continue;
      const centros = enCuadro.map((c) => t(c.caja));
      const cruz = todas[0]!.caja.cruzado;

      // 1) Las juntas: la fase y la escala, en medio modulo para cada lado.
      let juntas: Juntas | null = null;
      if (enCuadro.length >= 4) {
        const t0 = Math.min(...centros) - paso, t1 = Math.max(...centros) + paso;
        const perfilC = perfilALoLargo(foto.radio.celsius, w, hh, cx, cy, rot, cruz, t0, t1);
        const perfilA = perfilALoLargo(sd, w, hh, cx, cy, rot, cruz, t0, t1);
        juntas = corrimientoDeLaRejilla(perfilC, perfilA, t0, centros, paso);
      }
      const f = juntas?.factor ?? 1;
      const pasoF = juntas?.pasoPx ?? paso;
      const fase = juntas?.corrimientoPx ?? 0;
      /** Donde queda cada caja despues de la escala y la fase. */
      const puesto = (tt: number) => tt * f + fase;

      // 2) El final de la fila: el numero.
      let residual: number | null = null;
      for (const punta of [enCuadro[0]!, enCuadro[enCuadro.length - 1]!]) {
        const esPrimera = punta.m.positionInRow === 1;
        const esUltima = punta.m.positionInRow === row.modulesPerRow;
        if (!esPrimera && !esUltima) continue;
        const hacia = ((esUltima ? 1 : -1) * sentido) as 1 | -1;
        const tc = puesto(t(punta.caja));
        const t0 = tc - 2.5 * pasoF, t1 = tc + 2.5 * pasoF;
        const perfilA = perfilALoLargo(sd, w, hh, cx, cy, rot, cruz, t0, t1);
        let borde = bordeDelPanel(perfilA, t0, tc, hacia, pasoF);
        if (borde == null) continue;
        /*
          Y que lo que queda adentro del borde sea un modulo. Si el ultimo
          "modulo" antes del borde no tiene los dos costados de un panel, el
          borde esta un modulo mas alla de la cuenta —suelo liso pegado a la
          fila— y se retrocede un modulo, hasta dos veces.
        */
        const cruzadoModulo = punta.caja.cruzadoModulo ?? cruz / FRACCION_UTIL;
        let intentos = 0;
        while (borde != null && intentos < 2) {
          const centro = borde - hacia * pasoF / 2;
          if (tieneBordesCruzados(sd, w, hh, cx + centro * ux, cy + centro * uy, rot, cruzadoModulo, pasoF)) break;
          borde -= hacia * pasoF;
          intentos++;
          if (intentos === 2) borde = null;
        }
        if (borde == null) continue;
        residual = borde - (tc + hacia * pasoF / 2);
        break;
      }

      /*
        Y las dos juntas. El final decide cuantos modulos ENTEROS hay que
        correr, las juntas afinan el resto. Sin juntas, el final solo: dos
        pixeles de precision, que sobran para saber cual panel es cual.
      */
      let entero = 0;
      if (juntas && residual != null) entero = Math.round(residual / pasoF) * pasoF;
      else if (!juntas && residual == null) continue;
      const corrido = (tt: number) => (juntas ? puesto(tt) + entero : tt + residual!);

      for (const c of todas) {
        const tt = t(c.caja);
        const d = corrido(tt) - tt;
        out.cajas.set(c.m, { ex: d * ux, ey: d * uy });
      }
      const lam = juntas ? (fase + entero) / pasoF : residual! / paso;
      out.filas.set(rowId, {
        modulos: lam * sentido,
        ...(residual != null
          ? { anclaModulos: ((juntas ? fase + residual : residual) / pasoF) * sentido }
          : {}),
        ...(juntas ? { contraste: juntas.contraste, factor: juntas.factor } : {}),
      });
    }
    return out;
  }

  /**
   * La escala de esta foto, contada con el paso ENTRE FILAS.
   *
   * Los dos lados de la comparacion salen del mismo lugar que las cajas: lo
   * que PREDICE la proyeccion es la separacion entre las lineas de fila ya
   * proyectadas, y lo que HAY es la repeticion del perfil de lisura cruzado.
   * Comparar la prediccion contra la imagen y no contra un numero de catalogo
   * es lo que hace que el resultado sea directamente el factor que le falta a
   * la huella.
   */
  private escalaSegunLasFilas(
    candidatos: Array<{ m: ModuleRef; caja: CajaDeMedicion }>,
    foto: FotoTermica,
    sd: Float32Array,
  ): number | null {
    if (!candidatos.length) return null;
    const rot = candidatos[0]!.caja.rotRad;
    const cos = Math.cos(rot), sin = Math.sin(rot);

    // Donde cae el eje de cada fila, cruzado.
    const porFila = new Map<string, { suma: number; n: number }>();
    for (const c of candidatos) {
      const cruce = -c.caja.cx * sin + c.caja.cy * cos;
      const v = porFila.get(c.m.rowId);
      if (v) { v.suma += cruce; v.n++; } else porFila.set(c.m.rowId, { suma: cruce, n: 1 });
    }
    // Con dos filas no hay paso; con tres hay uno solo y no hay mediana.
    if (porFila.size < 4) return null;

    const ejes = [...porFila.values()].map((v) => v.suma / v.n).sort((a, b) => a - b);
    const saltos: number[] = [];
    for (let i = 1; i < ejes.length; i++) {
      const d = ejes[i]! - ejes[i - 1]!;
      // Dos strings de la misma fila comparten eje: no son un paso.
      if (d > 1) saltos.push(d);
    }
    if (saltos.length < 3) return null;
    saltos.sort((a, b) => a - b);
    const esperadoPx = saltos[saltos.length >> 1]!;

    const medido = pasoDeFilasEnLaImagen(foto.radio, sd, rot, esperadoPx);
    if (!medido) return null;
    return esperadoPx / medido.pasoPx;
  }

  private escalaSegunLaImagen(
    foto: FotoTermica,
    candidatos: Array<{ m: ModuleRef; caja: CajaDeMedicion }>,
    huella: ReturnType<typeof footprint>,
    camera: Camera,
    escalaX: number,
  ): number | null {
    const porFila = new Map<string, Array<{ m: ModuleRef; caja: CajaDeMedicion }>>();
    for (const c of candidatos) {
      const l = porFila.get(c.m.rowId);
      if (l) l.push(c); else porFila.set(c.m.rowId, [c]);
    }

    const medidas: Array<{ pasoPx: number; esperadoPx: number }> = [];
    for (const [, lista] of porFila) {
      if (lista.length < 6) continue;
      lista.sort((a, b) => a.m.positionInRow - b.m.positionInRow);
      /*
        El paso que PREDICE la proyeccion, medido sobre la propia proyeccion:
        la distancia en pixeles entre dos modulos consecutivos de la fila. Sale
        de la misma cuenta que dibuja las cajas, asi que compara manzanas con
        manzanas — usar el ancho del modulo del perfil dejaba afuera el hueco
        de 20 mm entre paneles y metia un 2 % de error en la comparacion.
      */
      const saltos: number[] = [];
      for (let i = 1; i < lista.length; i++) {
        if (lista[i]!.m.positionInRow - lista[i - 1]!.m.positionInRow !== 1) continue;
        saltos.push(Math.hypot(
          lista[i]!.caja.cx - lista[i - 1]!.caja.cx,
          lista[i]!.caja.cy - lista[i - 1]!.caja.cy,
        ));
      }
      if (saltos.length < 4) continue;
      saltos.sort((a, b) => a - b);
      const esperadoPx = saltos[saltos.length >> 1]!;
      if (!Number.isFinite(esperadoPx) || esperadoPx < 6) continue;
      // El tramo que ocupa la fila adentro del cuadro, y su centro.
      const xs = lista.map((c) => c.caja.cx), ys = lista.map((c) => c.caja.cy);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const largoPx = Math.hypot(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      ) + esperadoPx;
      const uno = lista[0]!.caja;
      const p = pasoEnLaImagen(foto.radio, { cx, cy }, uno.rotRad, largoPx, uno.cruzado, esperadoPx);
      if (p) medidas.push({ pasoPx: p.pasoPx, esperadoPx });
    }
    return escalaDeLaImagen(medidas);
  }

  /**
   * Las muestras del vuelo, con cada fila contada desde su punta.
   *
   * Aca se cierra lo que `alinearALoLargo` deja abierto. En cada foto las
   * juntas ponen la caja sobre un panel, pero solo saben la fase: una fila
   * corrida medio modulo en el parque cae para un lado en una foto y para el
   * otro en la siguiente, y el mismo panel sale como 27 en una y 28 en otra.
   * El final de la fila, cuando se ve, dice cual es cual — y se ve en alguna
   * foto de casi todas las filas, porque el vuelo cubre el parque entero.
   *
   * Asi que se junta lo que dijo el final en todas las fotos donde se vio,
   * se saca UN corrimiento verdadero por fila, y con el se corrige el numero
   * de las muestras de esa fila en todas las fotos, se haya visto el final o
   * no. Si dos fotos llaman distinto al mismo panel, gana la que lo vio mas
   * cerca del centro del cuadro, igual que siempre.
   */
  muestras(): Muestra[] {
    const verdadero = this.corrimientoVerdaderoPorFila();
    const aplicado = new Map<string, number>();
    for (const a of this.alineaciones) aplicado.set(`${a.fileName}|${a.rowId}`, a.modulos);
    const refs = new Map<string, ModuleRef[]>();
    const refsDe = (rowId: string): ModuleRef[] => {
      let r = refs.get(rowId);
      if (!r) {
        const row = this.farm.rows.find((x) => x.source.id === rowId);
        r = row ? modulesOfRow(row, this.farm) : [];
        refs.set(rowId, r);
      }
      return r;
    };

    /*
      Primero cada medicion con su nombre definitivo, despues una por modulo.

      Gana la que vio el modulo mas cerca del centro del cuadro, como siempre.
      Pero las demas no se tiran: viajan con la ganadora como `otrasC`, porque
      son la unica prueba de que lo que midio la ganadora es del panel y no de
      la foto.
    */
    const porClave = new Map<string, Muestra[]>();
    for (const m of this.todas) {
      const s = verdadero.get(m.modulo.rowId);
      let ref = m.modulo;
      if (s != null) {
        /*
          En esta foto la caja "k" quedo sobre el panel que esta a `aplicado`
          modulos de donde el parque pone al k. El panel que de verdad esta ahi
          es el k + (aplicado - verdadero), que es entero salvo por el ruido.
        */
        const lam = aplicado.get(`${m.fileName}|${m.modulo.rowId}`) ?? 0;
        const n = Math.round(lam - s);
        if (n !== 0) {
          const nuevo = refsDe(m.modulo.rowId)[m.modulo.positionInRow + n - 1];
          // Se salio de la fila: era un modulo que el parque tiene de mas.
          if (!nuevo) continue;
          ref = nuevo;
        }
      }
      push2(porClave, `${ref.rowId}#${ref.positionInRow}`, ref === m.modulo ? m : { ...m, modulo: ref });
    }

    const salida: Muestra[] = [];
    for (const lista of porClave.values()) {
      lista.sort((a, b) => a.distanciaAlCentroM - b.distanciaAlCentroM);
      const mejor = lista[0]!;
      const otras = lista.slice(1).filter((o) => o.fileName !== mejor.fileName).map((o) => o.celsius);
      salida.push(otras.length ? { ...mejor, otrasC: otras } : mejor);
    }
    return salida;
  }

  /**
   * Cuanto esta corrida de verdad cada fila, en modulos, medido con su final.
   *
   * La mediana de todas las fotos donde se vio el final. Una fila cuyas
   * medidas no se ponen de acuerdo —mas de un tercio de modulo de dispersion—
   * no se corrige: mejor dejarla como esta, con el aviso, que renumerarla con
   * un dato que se contradice.
   */
  corrimientoVerdaderoPorFila(): Map<string, number> {
    const porFila = new Map<string, number[]>();
    for (const a of this.alineaciones) {
      if (a.ancla != null) push2(porFila, a.rowId, a.ancla);
    }
    const out = new Map<string, number>();
    for (const [rowId, v] of porFila) {
      v.sort((a, b) => a - b);
      const med = v[v.length >> 1]!;
      const mad = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b)[v.length >> 1]!;
      if (mad > ANCLAS_QUE_NO_SE_PONEN_DE_ACUERDO) continue;
      out.set(rowId, med);
    }
    return out;
  }

  /**
   * Cuantos modulos se descartaron por caer cortados en el borde.
   *
   * No se cuentan los que despues se midieron bien en otra foto: con solape,
   * un modulo cortado en el borde de una cae comodo en el centro de la
   * siguiente, y ese es justo el trabajo que hace el solape.
   */
  /**
   * Fotos que se ubicaron con un supuesto en vez de con el dato.
   *
   * No cambia ningun numero: cambia si se le puede creer. Una foto sin rumbo de
   * gimbal se ubica como si mirara al norte, y si el vuelo no era norte-sur los
   * modulos del borde caen en la fila de al lado — con la misma confianza que
   * los buenos.
   */
  posesSupuestas(): Array<{ motivo: string; fotos: number }> {
    return [...this.posesIncompletas].map(([motivo, fotos]) => ({ motivo, fotos }));
  }

  soloEnElBorde(): number {
    let n = 0;
    for (const k of this.recortados) if (!this.mejor.has(k)) n++;
    return n;
  }

  /**
   * Cuantos modulos cayeron siempre sobre algo que no es un panel.
   *
   * Un puñado es normal —las puntas de las filas, los modulos que asoman en el
   * borde del cuadro—. Muchos quiere decir que la rejilla no esta cayendo
   * donde estan los paneles, y eso hay que decirlo en vez de entregar una
   * lista de defectos que en realidad es la textura del suelo.
   *
   * Se cuenta cada MODULO una vez, no cada vez que su caja cayo mal: un modulo
   * que sale en cuatro fotos y en las cuatro cae sobre el motor del tracker es
   * un modulo sin medir, no cuatro.
   */
  cajasFueraDelPanel(): number {
    return new Set(this.fueraDelPanel.map((f) => f.clave)).size;
  }

  /**
   * En que posicion de la fila caen los modulos que quedaron fuera del panel.
   *
   * Ordenado de mas a menos. Lo que interesa es si se concentran: si siempre
   * es el mismo numero, el problema esta en los datos del parque y se arregla
   * una vez, no vuelo por vuelo.
   */
  modulosFueraDelPanel(): Array<{ module: number; casos: number }> {
    const vistos = new Set<string>();
    const porModulo = new Map<number, number>();
    for (const f of this.fueraDelPanel) {
      if (vistos.has(f.clave)) continue;
      vistos.add(f.clave);
      porModulo.set(f.module, (porModulo.get(f.module) ?? 0) + 1);
    }
    return [...porModulo]
      .map(([module, casos]) => ({ module, casos }))
      .sort((a, b) => b.casos - a.casos);
  }

  vinieteo(): Array<{ fileName: string; maximoC: number }> {
    return this.vinietas;
  }

  /**
   * La tabla de aceptacion, por bloque: cuantas cajas se midieron, con que
   * fraccion de panel adentro, y cuantas freno la compuerta.
   *
   * Es lo que hay que mirar antes que la lista de hallazgos. Un bloque cuyas
   * cajas medidas no estan sobre panel no tiene hallazgos: tiene ruido.
   */
  auditoriaPorBloque(): Array<{
    block: string;
    fotos: number;
    medidas: number;
    lisuraMedia: number;
    bajo90: number;
    descartadas: number;
  }> {
    const desc = new Map<string, number>();
    const fotosDesc = new Map<string, Set<string>>();
    for (const c of this.compuerta) {
      desc.set(c.block, (desc.get(c.block) ?? 0) + 1);
      const f = fotosDesc.get(c.block) ?? new Set<string>();
      f.add(c.fileName);
      fotosDesc.set(c.block, f);
    }
    const bloques = new Set([...this.auditoria.keys(), ...desc.keys()]);
    return [...bloques]
      .map((block) => {
        const a = this.auditoria.get(block);
        const fotos = new Set([...(a?.fotos ?? []), ...(fotosDesc.get(block) ?? [])]);
        return {
          block,
          fotos: fotos.size,
          medidas: a?.medidas ?? 0,
          lisuraMedia: a && a.medidas ? a.sumaLisura / a.medidas : 0,
          bajo90: a?.bajo90 ?? 0,
          descartadas: desc.get(block) ?? 0,
        };
      })
      .sort((x, y) => (Number(x.block) || 0) - (Number(y.block) || 0) || x.block.localeCompare(y.block));
  }

  /** Cuanto hubo que correr cada fila cruzado, aparte de lo que se corrio la foto. */
  enganchesPorFila(): Array<{ fileName: string; rowId: string; px: number }> {
    return this.enganchesDeFila;
  }

  /**
   * Cuanto habia que correr cada fila a lo largo, medido con sus juntas.
   *
   * Ya esta aplicado: esto es para poder decirlo. Un parque cuyas filas estan
   * medio modulo corridas en los datos se arregla una vez en las coordenadas y
   * no una vez por vuelo, y sin este numero nadie sabe que hay que arreglarlo.
   */
  alineacionesDeFila(): AlineacionDeFila[] {
    return this.alineaciones;
  }

  /**
   * Que tan repetible es la medicion: el mismo panel medido en dos fotos.
   *
   * Devuelve null si el vuelo no tiene solape —fotos sueltas, o una pasada sin
   * superposicion— y entonces no hay nada que comparar. Eso tambien hay que
   * decirlo: un vuelo sin solape no se puede auditar a si mismo.
   */
  repetibilidad(): { modulos: number; mediana: number; p90: number; peor: number } | null {
    if (this.repeticiones.length < REPETICIONES_MINIMAS) return null;
    const v = this.repeticiones.map((r) => r.diferencia).sort((a, b) => a - b);
    const en = (q: number) => v[Math.min(v.length - 1, Math.floor(v.length * q))]!;
    return { modulos: v.length, mediana: en(0.5), p90: en(0.9), peor: v[v.length - 1]! };
  }

  /**
   * Cuanto se despega la escala del EXIF de la que se cuenta en la imagen.
   *
   * Uno significa que coinciden. Se mide contando el paso entre modulos sobre
   * la propia foto y comparandolo con el que predice la proyeccion.
   */
  /**
   * Lo que cada foto dice de la escala contando el paso entre filas.
   *
   * Es lo que decide la escala del vuelo: es la regla mas larga de la foto y
   * la unica que sale en TODAS las fotos de un parque de filas paralelas.
   */
  desviosDeFila(): Array<{ fileName: string; factor: number }> {
    return this.pasosDeFila;
  }

  desviosDeEscala(): Array<{ fileName: string; factor: number }> {
    return this.escalas;
  }

  /** Los corrimientos que hubo que aplicarle a cada foto, en metros. */
  corrimientos(): Array<{ fileName: string; metros: number }> {
    return this.encajes;
  }

  /**
   * Las fotos que no se pudieron enganchar a los paneles.
   *
   * No se midieron. Antes se median igual y salian como hallazgos: eso es
   * exactamente lo que habia que dejar de hacer.
   */
  fotosQueNoEngancharon(): Array<{ fileName: string; fraccionLisa: number }> {
    return this.fotosSinEnganche;
  }

  /**
   * Las fotos que cayeron afuera del parque entero.
   *
   * Distinto de las que no engancharon: aquellas caen sobre el parque y no se
   * las puede alinear; estas no tocan ni una fila. Casi siempre es el parque
   * equivocado, o uno viejo — no es un problema del vuelo.
   */
  fotosSinParque(): Array<{ fileName: string; metros: number }> {
    return this.fotosFueraDelParque;
  }

  /** A que distancia quedo la fila mas cercana del centro de la huella. */
  private distanciaAlParque(centro: { x: number; y: number }): number {
    let mejor = Infinity;
    for (const row of this.farm.rows) {
      const dx = Math.max(row.bbox.minX - centro.x, 0, centro.x - row.bbox.maxX);
      const dy = Math.max(row.bbox.minY - centro.y, 0, centro.y - row.bbox.maxY);
      const d = Math.hypot(dx, dy);
      if (d < mejor) mejor = d;
    }
    return mejor;
  }

  /**
   * Hasta donde se puede buscar el corrimiento de una foto.
   *
   * El limite lo pone la separacion entre filas, no el error del GPS. Si se
   * deja buscar mas de MEDIA separacion, el mejor puntaje lo puede dar la fila
   * de al lado —tambien lisa, tambien un panel— y el informe entero sale
   * corrido una fila sin un solo sintoma. Un dron sin RTK trae 1 a 2 m de
   * error, asi que con 2 m de busqueda alcanza de sobra.
   */
  private limiteDeBusquedaPx(
    cerca: CompiledFarm["rows"],
    mPorPx: number,
    escalaX: number,
  ): { fotoPx: number; filaPx: number } {
    const mPorPxImagen = mPorPx / escalaX;
    let separacion = Infinity;
    if (cerca.length > 1) {
      const a = cerca[0]!;
      // La perpendicular a la fila: sobre ese eje se mide cuanto se separan.
      const nx = -a.uy, ny = a.ux;
      const centro = (r: CompiledFarm["rows"][number]) => ({
        x: (r.bbox.minX + r.bbox.maxX) / 2,
        y: (r.bbox.minY + r.bbox.maxY) / 2,
      });
      const proy = cerca.map((r) => {
        const c = centro(r);
        return c.x * nx + c.y * ny;
      }).sort((p, q) => p - q);
      for (let i = 1; i < proy.length; i++) {
        const dd = proy[i]! - proy[i - 1]!;
        if (dd > 0.5 && dd < separacion) separacion = dd;
      }
    }
    const metros = Math.min(BUSQUEDA_MAXIMA_M, Number.isFinite(separacion) ? separacion * 0.4 : BUSQUEDA_MAXIMA_M);
    /*
      La FILA busca mas lejos que la foto: media separacion entre filas, sin el
      tope de los dos metros.

      El tope de la foto esta pensado para el GPS. Pero lo que la fila tiene
      que poder hacer es saltar de su sombra al panel, y a las dos de la tarde
      la sombra esta a 50 px del panel: con el tope de 43 no llegaba, y las
      filas del bloque 1 se quedaban sobre la sombra a 28 grados. Media
      separacion alcanza para eso y no alcanza para llegar a la fila de al
      lado, que empieza a mas de 90.
    */
    const filaM = Number.isFinite(separacion) ? separacion * 0.5 : BUSQUEDA_MAXIMA_M;
    return { fotoPx: metros / mPorPxImagen, filaPx: filaM / mPorPxImagen };
  }
}

/**
 * Cuanto se permite corregir la posicion de una foto, en metros.
 *
 * Es el error de GPS que trae un dron sin RTK. Mas que esto no es una
 * correccion, es una adivinanza.
 */
export const BUSQUEDA_MAXIMA_M = 2;

/** Version de una sola pasada, para cuando el lote entra en memoria. */
export function muestrear(
  farm: CompiledFarm,
  frame: LocalFrame,
  fotos: FotoTermica[],
  camera: Camera,
  moduloAnchoM: number,
  moduloLargoM: number,
  ajuste: Ajuste = SIN_AJUSTE,
): Muestra[] {
  const acc = new Acumulador(farm, frame, { camera, moduloAnchoM, moduloLargoM, ajuste });
  for (const f of fotos) acc.agregar(f);
  return acc.muestras();
}

// ---------------------------------------------------------------------------
// Comparacion
// ---------------------------------------------------------------------------

export type Severidad = "normal" | "leve" | "moderada" | "critica";

export interface Hallazgo extends Muestra {
  /** Cuantos grados por encima de sus vecinos del mismo string. */
  deltaT: number;
  /** Contra que se comparo. */
  referenciaC: number;
  vecinos: number;
  ambito: "string" | "fila" | "vuelo";
  severidad: Severidad;

  /**
   * Cuanto se despega el punto mas caliente del propio modulo.
   *
   * Es la otra mitad de la deteccion y mide algo distinto: `deltaT` compara el
   * modulo entero contra sus hermanos y encuentra diodos de bypass y modulos
   * desconectados; `deltaInterno` mira adentro de un solo modulo y encuentra
   * la celda caliente, que es el defecto mas comun y el que la mediana del
   * modulo esconde por definicion.
   *
   * `undefined` cuando la foto no resuelve una celda: a esa altura el defecto
   * llega al sensor ya promediado, y afirmar algo seria inventar.
   */
  deltaInterno?: number;
  severidadInterna?: Severidad;
  /** La peor de las dos. Es la que ordena la lista. */
  peor: Severidad;
  /**
   * El modulo salio caliente en esta foto y normal en otra: no es del modulo.
   *
   * Se deja escrito en vez de borrado, para que se pueda ver por que un
   * modulo a +16 °C contra sus hermanos no esta en la lista.
   */
  contradicha?: boolean;
  /** Cual de las dos comparaciones la disparo. */
  origen: "modulo" | "celda" | "ninguno";

  /**
   * Que defecto es, sacado de la forma de la mancha.
   *
   * Ausente cuando el modulo no entro lo suficiente como para leerle la forma.
   * NO reemplaza a la persona: precarga la anomalia y dice por que, y despues
   * se revisa por muestreo. La diferencia es entre clasificar tres mil paneles
   * a mano y revisar una muestra de los que ya vienen clasificados.
   */
  patron?: import("./patron").Clasificacion;
  /**
   * Que tan urgente es, sugerido.
   *
   * Sale de la forma Y del numero, con los MISMOS umbrales con los que se
   * clasifica la severidad del vuelo — asi que mover un umbral mueve las dos
   * cosas juntas, en vez de dejar un informe que se contradice consigo mismo.
   */
  clase?: import("./patron").ClaseSugerida;
}

/**
 * Umbrales de delta T, en grados.
 *
 * Son una CONVENCION de trabajo, no una cita de la norma: la IEC TS 62446-3
 * clasifica por patron y contexto, no por un numero suelto. Sirven para
 * ordenar la lista y decidir a que se le presta atencion primero; la
 * clasificacion final la pone una persona mirando la foto.
 */
export interface Umbrales {
  leve: number;
  moderada: number;
  critica: number;
}

export const UMBRALES: Umbrales = { leve: 3, moderada: 10, critica: 20 };

/**
 * Umbrales del punto caliente contra el propio modulo, en grados.
 *
 * Son mas altos que los de modulo contra string y tienen que serlo: adentro de
 * un modulo sano ya hay varios grados de diferencia entre la celda mas
 * caliente y la mediana —el marco disipa, los bordes ven cielo, la union de
 * celdas conduce distinto—. Una celda de verdad en corto corre veinte grados
 * o mas por encima de su modulo.
 *
 * Igual que los otros, son una convencion de trabajo declarada, no una cita
 * de la norma.
 */
export const UMBRALES_INTERNOS: Umbrales = { leve: 8, moderada: 15, critica: 25 };

/**
 * Los mismos umbrales, para una FRANJA en vez de una celda.
 *
 * No es un ajuste fino, son dos fisicas distintas. Una celda en corto se come
 * toda la corriente del string en dos centimetros cuadrados y corre 15, 25, 40
 * grados por encima del modulo. Una substring puenteada por su diodo disipa lo
 * mismo repartido en un tercio del panel: corre unos pocos grados, y ademas
 * arrastra la mediana del propio modulo contra la que se la compara.
 *
 * Con un solo umbral pasa lo que paso en el vuelo del 3 de septiembre: la
 * franja de diodo que Mateo fotografio a mano dio +6,2 °C sobre su modulo,
 * quedo debajo de los 8 que pide una celda y no se reporto. El motor la habia
 * medido, la habia dibujado y la habia clasificado como diodo — y despues la
 * llamo normal.
 */
/**
 * Con menos repeticiones que esto no se dice nada de la repetibilidad.
 *
 * Veinte modulos vistos dos veces alcanzan para una mediana honesta y son
 * pocos: los da una sola pasada corta con el solape de siempre.
 */
const REPETICIONES_MINIMAS = 20;

/** Cuantos modulos de una fila hacen falta para poder juzgar si algo es de la fila. */
const MODULOS_PARA_JUZGAR_LA_FILA = 8;

/**
 * Que fraccion de una fila puede tener franja antes de dejar de creerle.
 *
 * Un quinto. Un diodo de bypass es un componente que falla solo; que le pase a
 * mas de un quinto de los modulos de una fila el mismo dia, y siempre en la
 * misma substring, es un problema de medicion.
 */
const FRACCION_DE_DIODOS_QUE_NO_EXISTE = 0.2;

export const UMBRALES_INTERNOS_DE_FRANJA: Umbrales = { leve: 4, moderada: 8, critica: 15 };

/**
 * Que umbrales internos le corresponden a esta forma.
 *
 * Solo la franja y el modulo entero bajan. Todo lo que sea una mancha del
 * tamano de una celda —o algo sin forma— sigue exigiendo los 8 °C, que es lo
 * que separa una celda en corto de una piedra al sol.
 */
function umbralesInternosDe(
  patron: import("./patron").Patron | undefined,
  internos: Umbrales,
): Umbrales {
  if (patron !== "diodo" && patron !== "modulo-completo") return internos;
  // Se respeta la proporcion si alguien movio los umbrales a mano.
  const factor = internos.leve ? UMBRALES_INTERNOS_DE_FRANJA.leve / UMBRALES_INTERNOS.leve : 1;
  return {
    leve: internos.leve * factor,
    moderada: internos.moderada * factor,
    critica: internos.critica * factor,
  };
}

/**
 * Cuantos pixeles por celda hacen falta para creerle al punto caliente.
 *
 * Con menos de cuatro pixeles —dos de lado— el defecto llega al sensor
 * mezclado con lo que lo rodea y lo que se mida no es la celda. Por debajo de
 * esto no se emite ningun hallazgo interno: es exactamente el error de medir
 * el borde del cuadro, con otro disfraz.
 */
export const PIXELES_POR_CELDA_MINIMO = 4;

/**
 * Lo mismo, en pixeles POR LADO. Son dos: la raiz de los cuatro de area.
 *
 * Existe porque la constante de arriba se presta a un error que ya cometi: es
 * un area —"cuatro pixeles, dos de lado"— y usada como si fuera el lado da una
 * altura de vuelo la mitad de la que corresponde. Al planificar se razona por
 * lado, asi que el numero por lado se declara en vez de deducirse en cada uso.
 */
export const PIXELES_POR_LADO_MINIMO = Math.sqrt(PIXELES_POR_CELDA_MINIMO);

/**
 * Con cuantos pixeles de lado se PLANIFICA un vuelo.
 *
 * El minimo de arriba es el piso del motor: por debajo no se emite ningun
 * hallazgo de celda. Pero planificar justo sobre el piso deja el vuelo entero
 * sin margen — basta que los trackers esten un poco inclinados, o que el
 * terreno suba, para caer abajo y perder las celdas del dia.
 *
 * Tres por lado es el numero de planificacion: un escalon arriba del piso, y
 * todavia bastante mas alto —o sea mas rapido— que planificar a ojo.
 */
export const PIXELES_POR_LADO_OBJETIVO = 3;

/** Minimo de vecinos para que una mediana signifique algo. */
const VECINOS_MINIMOS = 5;

/**
 * Que fraccion del umbral de patron tiene que despegarse el mismo extremo
 * del retrato del vecino para decir que la franja es de la fila. La mitad:
 * la raya del borde del panel le cae al vecino medio pixel corrida y llega a
 * uno y medio o dos grados donde al modulo le llego a tres.
 */
const FRACCION_DEL_UMBRAL_EN_EL_VECINO = 0.5;

/**
 * Desde que radio normalizado (0 en el centro, 1,41 en la esquina) una
 * medicion sola no hace hallazgo de modulo. Son los dos anillos de afuera de
 * la correccion de vinieteo, donde la correccion residual medida llega a los
 * tres grados y medio: en la foto 0462 del bloque 2 un modulo visto una sola
 * vez a 1,02 de radio, pegado al borde de abajo, salio a +3,8 °C.
 */
const ESQUINA_DEL_CUADRO_R = 1.0;

/**
 * Cuanto puede pasar entre dos fotos y seguir siendo "el mismo momento".
 *
 * Diez minutos. Adentro de una pasada las fotos salen cada pocos segundos, asi
 * que una pasada entera cae siempre en una sola tanda aunque el bloque sea
 * largo. Y en diez minutos ni los trackers giran lo suficiente ni el parque se
 * calienta lo suficiente como para mover el ΔT.
 *
 * El numero es de trabajo, no de norma: lo que importa es que separe dos
 * pasadas de un mismo string hechas con una carga de bateria de por medio.
 */
export const MINUTOS_DE_LA_MISMA_TANDA = 10;

/**
 * A que tanda pertenece cada muestra: string + pasaje del dron.
 *
 * Las muestras sin hora quedan todas juntas en la tanda del string, que es
 * exactamente como se comportaba antes. Sin fecha en el EXIF no se puede hacer
 * nada mejor, y romper el vecindario por las dudas seria peor.
 */
export function tandasPorString(muestras: Muestra[]): Map<Muestra, string> {
  const porString = new Map<string, Muestra[]>();
  for (const m of muestras) {
    const k = `${m.modulo.rowId}#${m.modulo.chunkIndex}`;
    const lista = porString.get(k);
    if (lista) lista.push(m); else porString.set(k, [m]);
  }

  const salida = new Map<Muestra, string>();
  const corte = MINUTOS_DE_LA_MISMA_TANDA * 60_000;
  for (const [k, lista] of porString) {
    const conHora = lista.filter((m) => m.cuando != null).sort((a, b) => a.cuando! - b.cuando!);
    const sinHora = lista.filter((m) => m.cuando == null);
    for (const m of sinHora) salida.set(m, k);

    let tanda = 0;
    let anterior: number | null = null;
    for (const m of conHora) {
      if (anterior != null && m.cuando! - anterior > corte) tanda++;
      anterior = m.cuando!;
      // Con una sola tanda la clave queda igual que antes: nada cambia en los
      // vuelos de una pasada, que son casi todos.
      salida.set(m, tanda === 0 ? k : `${k}@${tanda}`);
    }
  }
  return salida;
}

/**
 * Cuantos strings quedaron medidos en mas de una pasada.
 *
 * Se cuenta aparte de `tandasPorString` porque son dos preguntas: una es contra
 * quien comparar cada modulo —que ya se resuelve sola— y la otra es cuanto de
 * este vuelo hay que declarar como flojo en el informe.
 */
export function stringsEnVariasTandas(muestras: Muestra[]): number {
  const tandas = tandasPorString(muestras);
  const porString = new Map<string, Set<string>>();
  for (const m of muestras) {
    const k = `${m.modulo.rowId}#${m.modulo.chunkIndex}`;
    const set = porString.get(k) ?? new Set<string>();
    set.add(tandas.get(m) ?? k);
    porString.set(k, set);
  }
  let n = 0;
  for (const set of porString.values()) if (set.size > 1) n++;
  return n;
}

/**
 * A partir de cuantos grados vale la pena contar que la punta estaba caliente.
 *
 * Medio grado. El umbral de anomalia leve anda por los tres, asi que medio
 * grado no cambia ninguna clasificacion por si solo — pero sobre las puntas de
 * Wellington la correccion llega a tres, que si la cambia entera.
 */
export const PUNTA_QUE_SE_NOTA_C = 0.5;

/**
 * El calor que traen las puntas de fila EN ESTE PARQUE, medido con el vuelo
 * entero.
 *
 * Se hacia foto por foto y por eso no se aplicaba nunca. Para separar "esta
 * punta esta caliente" de "todas las puntas de aca estan calientes" hay que
 * ver el mismo numero de modulo en varias filas Y el string entero para saber
 * su nivel. En una foto a 52 m entran cinco o seis modulos de cada fila: no
 * alcanza para ninguna de las dos cosas. En el vuelo entran los veintiocho, y
 * cada posicion aparece en doscientas filas.
 *
 * La tanda va adentro de la clave del string a proposito: entre las nueve y
 * las once el parque se calienta, y un string medido en dos pasadas tiene dos
 * niveles distintos. Mezclarlos le pondria a la punta un calor que es del
 * reloj.
 */
export function sesgoDePunta(muestras: Muestra[]): Map<number, number> {
  const tandas = tandasPorString(muestras);
  return calorDeLaPunta(
    muestras.map((m) => ({
      string: tandas.get(m) ?? `${m.modulo.rowId}#${m.modulo.chunkIndex}`,
      posicion: m.modulo.module,
      celsius: m.celsius,
    })),
  );
}

export function comparar(
  muestras: Muestra[],
  umbrales: Umbrales = UMBRALES,
  internos: Umbrales = UMBRALES_INTERNOS,
): Hallazgo[] {
  // Vecindarios, del mas significativo al mas suelto.
  const porString = new Map<string, number[]>();
  const porFila = new Map<string, number[]>();
  const todo: number[] = [];

  /**
   * Contra quien se compara un modulo: sus hermanos de string, medidos EN LA
   * MISMA PASADA.
   *
   * El vecindario era solo `fila#string`, sin mirar la hora, y ahi habia un
   * error que no daba ningun sintoma. La pregunta que lo destapo: "¿que pasa si
   * vuelo por un lado del bloque con los paneles en una posicion, y despues por
   * el otro lado cuando ya giraron?".
   *
   * Pasa que ese string queda medido en dos momentos distintos. Y entre las
   * nueve y las once el parque se calienta: sube la irradiancia, sube la
   * ambiente, y el mismo modulo SANO lee varios grados mas tarde que temprano.
   * Al sacar la mediana de las dos mitades juntas:
   *
   *   - los modulos de la pasada tardia salen todos calientes (falsos
   *     positivos, la cuadrilla camina hasta paneles sanos);
   *   - y los de la pasada temprana salen todos frios, asi que un modulo
   *     REALMENTE quemado de ese grupo puede quedar debajo del umbral. Ese es
   *     el que duele: un defecto que no se reporta.
   *
   * Por eso el vecindario incluye la TANDA: las muestras del string se ordenan
   * por hora y se cortan donde hay un salto grande. Muestras del mismo pasaje
   * —segundos entre foto y foto— caen todas en la misma tanda y no cambia
   * nada; dos pasadas separadas por horas quedan separadas.
   */
  const tandas = tandasPorString(muestras);
  const claveString = (m: Muestra) => tandas.get(m) ?? `${m.modulo.rowId}#${m.modulo.chunkIndex}`;

  for (const m of muestras) {
    push(porString, claveString(m), m.celsius);
    push(porFila, m.modulo.rowId, m.celsius);
    todo.push(m.celsius);
  }

  const medianaGlobal = percentil(todo, 50);

  /*
    Y lo que traen las puntas de fila, que no es de esos modulos.

    Se calcula antes de clasificar porque el ΔT corregido entra en la
    clasificacion: un modulo entero "caliente y parejo" se reconoce justamente
    por su ΔT contra los hermanos, y con los tres grados de la punta adentro,
    el modulo 1 de cualquier fila se clasifica como circuito abierto.
  */
  const punta = sesgoDePunta(muestras);

  const crudos: Hallazgo[] = muestras.map((m) => {
    const s = porString.get(claveString(m)) ?? [];
    const f = porFila.get(m.modulo.rowId) ?? [];

    let referenciaC: number;
    let vecinos: number;
    let ambito: Hallazgo["ambito"];
    if (s.length >= VECINOS_MINIMOS) {
      referenciaC = percentil(s, 50); vecinos = s.length - 1; ambito = "string";
    } else if (f.length >= VECINOS_MINIMOS) {
      referenciaC = percentil(f, 50); vecinos = f.length - 1; ambito = "fila";
    } else {
      referenciaC = medianaGlobal; vecinos = todo.length - 1; ambito = "vuelo";
    }

    const deltaT = m.celsius - referenciaC - (punta.get(m.modulo.module) ?? 0);
    /*
      Que defecto es. Se hace aca y no al medir porque hace falta el ΔT contra
      el string, que solo existe una vez que estan todas las muestras: un modulo
      desconectado no tiene ninguna mancha adentro y solo se reconoce desde
      afuera, comparandolo con sus hermanos.
    */
    const patron = m.retrato ? clasificarPatron(m.retrato, deltaT) : undefined;
    const clase = clasificar({ ...m, deltaT, ...(patron ? { patron: patron.patron } : {}) }, umbrales, internos);

    /*
      Lo que no repite en otra foto, no se reporta.

      Un defecto de verdad esta caliente en todas las fotos en que entra el
      modulo. Una caja que cayo sobre la calle —lisa, a 46 grados, que pasa por
      un modulo en circuito abierto— esta caliente en UNA foto, y en la
      siguiente, donde la fila entro mejor en el cuadro, el mismo modulo mide
      como sus hermanos. En el vuelo del bloque 2 eso puso seis modulos
      seguidos de la fila 1-98 a +16 °C, todos de la misma foto y todos a
      menos de 90 px del borde del cuadro.

      No es un umbral nuevo: es la misma medicion hecha dos veces. Si otra
      medicion del mismo modulo queda por debajo de la mitad del umbral leve,
      la de esta foto no puede ser un defecto del modulo, porque el modulo no
      cambio entre foto y foto. Se deja como normal y se dice por que. Con una
      sola medicion no hay con que contradecir, y se reporta como siempre.
    */
    const contradicha =
      clase.severidad !== "normal" &&
      (m.otrasC ?? []).some((c) => c - referenciaC - (punta.get(m.modulo.module) ?? 0) < umbrales.leve / 2);

    /*
      Sin hermanos no hay ΔT de modulo.

      Comparar contra la mediana del vuelo entero no es comparar: en el vuelo
      del bloque 2 las filas del bloque 1, que asoman por el borde del cuadro,
      leen 44 a 47 °C con los trackers en otra posicion, y el bloque 2 lee 37.
      Un modulo del bloque 1 visto una sola vez, sin hermanos medidos, salia a
      +9 °C "modulo completo" contra la mediana del vuelo — un hallazgo
      inventado por falta de vecinos. El ΔT se informa igual, con su ambito,
      pero no hace hallazgo. El chequeo interno del modulo —la celda caliente
      contra su propio panel— no necesita hermanos y queda como esta.
    */
    const sinHermanos = ambito === "vuelo" && clase.severidad !== "normal";

    /*
      Y una sola medicion desde la esquina del cuadro tampoco alcanza.

      El vinieteo se corrige con la propia foto, pero en la esquina es donde
      menos modulos hay para medirlo y donde mas sube: en la foto 0045 del
      bloque 2, tres modulos de una fila vecina medidos a mas de 1,1 de radio
      normalizado —a 50 px de la esquina— quedaron a +3,1, +3,4 y +3,7 °C
      despues de la correccion, justo arriba del umbral leve, y no se vieron
      en ninguna otra foto. Un modulo del bloque que se vuela se ve varias
      veces y cerca del centro; el que solo se vio desde una esquina es de un
      bloque de al lado, y su ΔT se informa pero no hace hallazgo. El chequeo
      interno —la celda contra su propio panel— no depende de esto.
    */
    const r = m.caja?.ancho && m.caja.alto ? radioNormalizado(m.caja.cx, m.caja.cy, m.caja.ancho, m.caja.alto) : 0;
    const soloDesdeLaEsquina =
      clase.severidad !== "normal" && r >= ESQUINA_DEL_CUADRO_R && !(m.otrasC ?? []).length;

    const claseFinal: Clasificacion = sinHermanos || soloDesdeLaEsquina
      ? {
          ...clase,
          severidad: "normal",
          peor: clase.severidadInterna ?? "normal",
          origen: (clase.severidadInterna ?? "normal") === "normal" ? "ninguno" : "celda",
        }
      : clase;

    return {
      ...m,
      deltaT,
      referenciaC,
      vecinos,
      ambito,
      ...(patron ? { patron } : {}),
      /*
        Contradicha, se anula entera, tambien el chequeo interno. La mediana
        de la caja es lo que se contradijo, y si la mediana no es del panel,
        el punto mas caliente de esa misma caja tampoco.
      */
      ...(contradicha
        ? {
            ...claseFinal,
            severidad: "normal" as const,
            severidadInterna: "normal" as const,
            peor: "normal" as const,
            origen: "ninguno" as const,
            contradicha: true,
          }
        : claseFinal),
    };
  });

  /*
    Los diodos de bypass no vienen en fila.

    Una caja mal puesta dibuja una franja caliente en su borde, y como el error
    de encuadre es de la FILA, la dibuja en todos los modulos de esa fila y
    siempre en el mismo extremo. Sobre el vuelo real eso ponia seis "diodos" en
    una misma fila, todos con la franja en las primeras dos celdas del retrato.
    Seis diodos consecutivos en la misma substring no existen: es la caja.

    Un diodo de verdad es un componente que se quema solo. Que le pase a mas de
    un quinto de los modulos de una fila el mismo dia es la definicion de un
    problema de medicion, no de un hallazgo.

    Se hace despues de clasificar y no antes porque hace falta ver la fila
    entera: un modulo solo no puede saber que es lo raro y que es lo comun.
  */
  const porFilaYFoto = new Map<string, typeof crudos>();
  for (const h of crudos) {
    const k = `${h.fileName}|${h.modulo.rowId}`;
    const l = porFilaYFoto.get(k);
    if (l) l.push(h); else porFilaYFoto.set(k, [h]);
  }
  const enFila = new Set<string>();
  const enElVecino = new Set<string>();
  for (const [, lista] of porFilaYFoto) {
    if (lista.length >= MODULOS_PARA_JUZGAR_LA_FILA) {
      const diodos = lista.filter((h) => h.patron?.patron === "diodo");
      if (diodos.length / lista.length > FRACCION_DE_DIODOS_QUE_NO_EXISTE) {
        for (const h of diodos) enFila.add(`${h.fileName}|${h.modulo.rowId}#${h.modulo.positionInRow}`);
      }
    }

    /*
      Y el mismo argumento entre VECINOS, que es el que llega a disparar.

      El filtro de arriba pide ocho modulos de la misma fila en la misma foto,
      y a 52 m de altura cada foto agarra cinco o seis: sobre el vuelo de
      Wellington no se disparo ni una vez. Lo que si se puede ver con cinco
      modulos es el de al lado, y alcanza: la franja del borde del panel le
      sale a los DOS vecinos en el MISMO extremo, porque el borde es lo que
      comparten. Un diodo de bypass es un componente que se quema solo — que se
      quemen dos seguidos, los dos en el mismo tercio de la placa y el mismo
      dia, es la definicion de un problema de medicion.

      Se comparan el eje y el extremo, no solo el hecho de que haya franja. Dos
      diodos vecinos en tercios distintos de la placa siguen saliendo los dos.
    */
    const porPos = new Map<number, (typeof crudos)[number]>();
    for (const h of lista) porPos.set(h.modulo.positionInRow, h);
    for (const h of lista) {
      const f = h.patron?.franja;
      if (h.patron?.patron !== "diodo" || !f) continue;
      for (const d of [-1, 1]) {
        const v = porPos.get(h.modulo.positionInRow + d);
        const g = v?.patron?.franja;
        if (!g || v!.patron?.patron !== "diodo") continue;
        if (g.eje !== f.eje || g.de !== f.de) continue;
        if (Math.abs(g.desde - f.desde) > 1 || Math.abs(g.hasta - f.hasta) > 1) continue;
        enElVecino.add(`${h.fileName}|${h.modulo.rowId}#${h.modulo.positionInRow}`);
        enElVecino.add(`${v!.fileName}|${v!.modulo.rowId}#${v!.modulo.positionInRow}`);
      }

      /*
        Y la franja que esta pegada al borde del recuadro se le pregunta al
        vecino aunque el vecino no haya llegado a "diodo".

        En el vuelo del bloque 2, a las dos de la tarde, el borde bajo del
        panel inclinado lee cinco grados mas que el resto de la placa en TODA
        la fila: una raya de un par de pixeles del lado del suelo. Al modulo
        que le cae justo en las ultimas dos filas del retrato le sale "diodo";
        al de al lado la misma raya le cae medio pixel mas afuera y no llega a
        los tres grados. El de arriba no lo agarra porque pide que los dos sean
        diodo. Lo que se mira aca es el retrato crudo del vecino: si en las
        mismas celdas del mismo extremo el vecino tambien esta caliente contra
        su propia placa, esa raya es de la fila y no del modulo.
      */
      const pegadaAlBorde = f.desde === 0 || f.hasta === f.de - 1;
      if (!pegadaAlBorde) continue;
      for (const d of [-1, 1]) {
        const v = porPos.get(h.modulo.positionInRow + d);
        const rv = v?.retrato;
        if (!rv || rv.filas * rv.columnas !== rv.celdas.length) continue;
        const largoDelEje = f.eje === "largo" ? rv.filas : rv.columnas;
        if (largoDelEje !== f.de) continue;
        const propias = Array.from(rv.celdas).filter((x) => Number.isFinite(x));
        if (propias.length < rv.celdas.length / 2) continue;
        const base = percentil(propias, 25);
        const enFranja: number[] = [];
        for (let i = 0; i < rv.filas; i++) {
          for (let j = 0; j < rv.columnas; j++) {
            const k = f.eje === "largo" ? i : j;
            if (k < f.desde || k > f.hasta) continue;
            const x = rv.celdas[i * rv.columnas + j]!;
            if (Number.isFinite(x)) enFranja.push(x);
          }
        }
        if (!enFranja.length) continue;
        if (percentil(enFranja, 50) - base >= UMBRAL_PATRON_K * FRACCION_DEL_UMBRAL_EN_EL_VECINO) {
          enElVecino.add(`${h.fileName}|${h.modulo.rowId}#${h.modulo.positionInRow}`);
          break;
        }
      }
    }
  }

  return crudos.map((h) => {
    const clave = `${h.fileName}|${h.modulo.rowId}#${h.modulo.positionInRow}`;
    const porQue = enFila.has(clave)
      ? "Se le vio una franja caliente, pero a demasiados modulos de esta misma fila les salio " +
        "la misma franja en el mismo extremo. Un diodo de bypass no se quema en fila: eso es el " +
        "borde del recuadro, no un defecto."
      : "Se le vio una franja caliente, pero al modulo de al lado le salio la misma franja en el " +
        "mismo extremo. Un diodo de bypass no se quema de a dos en el mismo tercio de la placa: " +
        "eso es el borde del panel, no un defecto.";
    if (enFila.has(clave) || enElVecino.has(clave)) {
      const sinFranja: Hallazgo = {
        ...h,
        patron: {
          ...h.patron!,
          patron: "sin-patron",
          confianza: "baja",
          porQue,
        },
        severidadInterna: "normal",
        peor: h.severidad,
        origen: h.severidad === "normal" ? "ninguno" : "modulo",
      };
      delete (sinFranja.patron as { anomalia?: string }).anomalia;
      return sinFranja;
    }
    return h;
  }).map((h) => {
    // La clase necesita el delta interno, que lo pone `clasificar`: por eso va
    // en una segunda pasada y no adentro de la primera.
    if (!h.patron) return h;
    return {
      ...h,
      clase: claseSugerida({
        patron: h.patron.patron,
        deltaT: h.deltaT,
        ...(h.deltaInterno != null ? { deltaInterno: h.deltaInterno } : {}),
        criticaModulo: umbrales.critica,
        criticaInterna: internos.critica,
      }),
    };
  });
}

/**
 * Lo que midio el motor sobre un modulo, sin la clasificacion todavia.
 *
 * Es lo minimo que hace falta para volver a clasificar: la temperatura del
 * modulo, cuanto se despega de sus vecinos, la de su zona mas caliente y si la
 * foto resolvia una celda.
 */
export interface Medido {
  celsius: number;
  deltaT: number;
  puntoCalienteC?: number;
  pixelesPorCelda?: number;
  /**
   * Que forma tiene la mancha, si se le pudo mirar.
   *
   * Entra aca porque decide contra que umbral se compara el calentamiento
   * INTERNO del modulo, y eso no es un ajuste fino: una celda en corto y una
   * substring puenteada por su diodo son dos fisicas distintas y no dan
   * numeros parecidos.
   */
  patron?: import("./patron").Patron;
}

/** Como queda clasificada una medicion contra los umbrales de hoy. */
export interface Clasificacion {
  severidad: Severidad;
  deltaInterno?: number;
  severidadInterna?: Severidad;
  peor: Severidad;
  origen: "modulo" | "celda" | "ninguno";
}

/**
 * Clasifica una medicion ya hecha contra los umbrales que se le pasen.
 *
 * Vivia adentro de `comparar`, que ademas necesita TODAS las muestras del
 * vuelo para sacar la mediana de cada vecindario. Mientras las muestras vivian
 * en la memoria de la pantalla eso daba lo mismo; ahora un vuelo se guarda y
 * se vuelve a abrir, y lo unico que sobrevive es la lista corta de hallazgos
 * con su temperatura y su delta ya restados. Mover un umbral sobre esa lista
 * tiene que dar exactamente lo mismo que moverlo con las fotos a mano, y la
 * unica forma de garantizarlo es que sea esta misma funcion la que decide en
 * los dos casos.
 */
export function clasificar(
  m: Medido,
  umbrales: Umbrales = UMBRALES,
  internos: Umbrales = UMBRALES_INTERNOS,
): Clasificacion {
  const severidad = severidadDe(m.deltaT, umbrales);

  /**
   * El punto caliente adentro del modulo, con dos condiciones.
   *
   * La primera es que la foto resuelva la celda. La segunda es menos
   * evidente y sale de mirar los datos: un modulo que lee MAS FRIO que sus
   * hermanos de string no esta midiendo bien el panel.
   *
   * Pasa en las puntas de las filas. La caja de medicion queda medio sobre
   * el modulo y medio sobre el pasto; la mediana entonces es la del pasto
   * —varios grados por debajo del string— y la zona "mas caliente" que
   * aparece adentro es simplemente el panel. El resultado tiene la firma
   * inconfundible: delta T de modulo muy negativo y delta interno positivo
   * por casi exactamente lo mismo.
   *
   * Un modulo con una celda en corto nunca esta mas frio que sus hermanos.
   * Si lo esta, lo que sobra en la caja no es un defecto: es pasto.
   */
  const resuelve = (m.pixelesPorCelda ?? 0) >= PIXELES_POR_CELDA_MINIMO;
  const mideElPanel = m.deltaT > -umbrales.leve;
  const deltaInterno =
    resuelve && mideElPanel && m.puntoCalienteC != null
      ? m.puntoCalienteC - m.celsius
      : undefined;
  const severidadInterna =
    deltaInterno != null
      ? severidadDe(deltaInterno, umbralesInternosDe(m.patron, internos))
      : undefined;

  const peor = peorDe(severidad, severidadInterna ?? "normal");
  return {
    severidad,
    ...(deltaInterno != null ? { deltaInterno } : {}),
    ...(severidadInterna ? { severidadInterna } : {}),
    peor,
    origen:
      peor === "normal" ? "ninguno"
      : peor === severidad ? "modulo"
      : "celda",
  };
}

const ESCALA: Severidad[] = ["normal", "leve", "moderada", "critica"];
const peorDe = (a: Severidad, b: Severidad): Severidad =>
  ESCALA.indexOf(a) >= ESCALA.indexOf(b) ? a : b;

function severidadDe(deltaT: number, u: Umbrales): Severidad {
  if (deltaT >= u.critica) return "critica";
  if (deltaT >= u.moderada) return "moderada";
  if (deltaT >= u.leve) return "leve";
  return "normal";
}

function push<K>(m: Map<K, number[]>, k: K, v: number): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

// ---------------------------------------------------------------------------
// Lo que se junta en un solo problema
// ---------------------------------------------------------------------------

export interface EventoDeString {
  rowId: string;
  block: string;
  tracker: string;
  row?: string;
  stringNumber: number;
  stringLabel?: string;
  modulos: number;
  /** Cuantos de los modulos del string estan calientes. */
  fraccion: number;
  deltaTMedio: number;
  /**
   * Como se encontro. Los dos casos le piden cosas distintas al que lee:
   *
   * - `modulos-calientes`: la mayoria de los modulos del string dieron
   *   anomalia por su cuenta. El string esta caliente Y desparejo.
   * - `string-entero`: NINGUN modulo dio anomalia contra sus hermanos, pero el
   *   string completo esta por encima de los OTROS strings. Es el caso del
   *   string desconectado — el que era invisible.
   */
  motivo: "modulos-calientes" | "string-entero";
}

/**
 * Cuanto tiene que despegarse un string entero de los otros para reportarlo.
 *
 * Tres grados. Estaba en cuatro, apoyado en que un string desconectado corre
 * "bastante mas" que sus vecinos. La primera foto real de uno desconectado dijo
 * otra cosa: 45,2 °C contra cinco filas sanas entre 40,7 y 41,5. ΔT = 4,0 —
 * justo el umbral. Un decimo menos y el defecto mas caro de la lista no se
 * reportaba.
 *
 * Tres es seguro por lo de al lado: en esa misma foto las cinco filas sanas
 * caen dentro de 0,8 °C entre si. Tres grados es cuatro veces esa dispersion,
 * asi que sigue muy por arriba del ruido entre filas.
 *
 * El umbral esta bajo a proposito — perder un string entero es lo mas caro de
 * esta lista, no es un panel, son 28, y un falso positivo se descarta mirando
 * una foto.
 */
export const DELTA_STRING_ENTERO = 3;

/** Cuantos modulos medidos hacen falta para creerle a la temperatura de un string. */
const MODULOS_PARA_CREERLE_AL_STRING = 6;

/**
 * Cuantos modulos tiene un string.
 *
 * Un numero alcanza mientras el parque tenga una sola geometria. Un parque que
 * mezcla trackers largos de 56 modulos con cortos de 28 necesita preguntarlo
 * por fila, y ahi va una funcion: el largo ya lo resolvio el compilador fila
 * por fila y lo unico que falta es no tirarlo.
 */
export type ModulosPorString = number | ((rowId: string) => number | undefined);

/**
 * Junta los strings donde la anomalia no es de un modulo sino de todo el string.
 *
 * Un modulo caliente es un modulo. Un STRING entero caliente es otra cosa: una
 * conexion, un fusible, un tramo desconectado. Se arregla en otro lado y a
 * veces lo paga otro. Reportar 28 hallazgos donde hay uno solo es lo que hace
 * que un informe de 3000 filas sea inutilizable.
 */
/**
 * Desde que fraccion del string se deja de reportar modulos y se reporta el
 * string.
 *
 * Estaba en 0,5 y con ese numero este camino era INALCANZABLE. Medido: con 13
 * de 28 modulos calientes salen 13 hallazgos anomalos y ningun evento, porque
 * 13/28 no llega a la mitad; con 14 de 28 la mediana del string se corre a la
 * zona caliente, todos los ΔT dan cero y no queda un solo modulo anomalo que
 * agrupar. O sea que el umbral solo se alcanzaba justo donde el sintoma
 * desaparece.
 *
 * Un tercio es un umbral que se puede alcanzar de verdad, y ademas dice algo:
 * cuando un tercio del string esta anomalo, el problema es del string y no de
 * N paneles. Es lo que evita el informe de 767 filas para 15 trackers.
 */
export function eventosDeString(
  hallazgos: Hallazgo[],
  modulosPorString: ModulosPorString,
  fraccionMinima = 0.35,
): EventoDeString[] {
  const largoDe = (rowId: string): number | undefined =>
    typeof modulosPorString === "number" ? modulosPorString : modulosPorString(rowId);

  const grupos = new Map<string, Hallazgo[]>();
  for (const h of hallazgos) {
    if (h.severidad === "normal") continue;
    push2(grupos, `${h.modulo.rowId}#${h.modulo.chunkIndex}`, h);
  }

  const out: EventoDeString[] = [];
  const yaReportado = new Set<string>();
  for (const g of grupos.values()) {
    const m = g[0]!.modulo;
    // El largo del string de ESTA fila. Sin el no hay fraccion que calcular:
    // dividir por el largo del perfil en una fila corta la reporta como si
    // estuviera medio apagada cuando esta apagada entera.
    const largo = largoDe(m.rowId);
    if (!largo) continue;
    const fraccion = g.length / largo;
    if (fraccion < fraccionMinima) continue;
    const ev: EventoDeString = {
      rowId: m.rowId, block: m.block, tracker: m.tracker,
      stringNumber: m.stringNumber,
      modulos: g.length,
      fraccion,
      deltaTMedio: g.reduce((s, h) => s + h.deltaT, 0) / g.length,
      motivo: "modulos-calientes",
    };
    yaReportado.add(`${m.rowId}#${m.chunkIndex}`);
    if (m.row) ev.row = m.row;
    if (m.stringLabel) ev.stringLabel = m.stringLabel;
    out.push(ev);
  }
  /*
    El string entero, que era invisible por construccion.
    =========================================================================
    Cada modulo se compara contra sus hermanos del MISMO string. Si el string
    entero esta desconectado, todos sus modulos estan igual de calientes: la
    mediana del string sube con ellos, cada modulo da ΔT cero, ninguno sale
    anomalo — y el bucle de arriba, que agrupa hallazgos anomalos, no tiene
    nada que agrupar. Cero hallazgos y cero eventos, con dos strings apagados
    delante de la camara. Probado: 28 modulos a 60 °C contra 28 a 45 dan ΔT 0.

    Y es el defecto mas caro de la lista: no es un panel, son 28.

    La comparacion tiene que subir un nivel: el string contra los OTROS
    strings. Misma escalera que usan los modulos —primero los de su fila, si no
    los de su bloque, si no los del vuelo— porque dos strings de la misma fila
    estan bajo el mismo sol y con la misma suciedad.
  */
  const porString = new Map<string, Hallazgo[]>();
  for (const h of hallazgos) push2(porString, `${h.modulo.rowId}#${h.modulo.chunkIndex}`, h);

  const medianas = new Map<string, { t: number; h: Hallazgo[] }>();
  for (const [k, g] of porString) {
    if (g.length < MODULOS_PARA_CREERLE_AL_STRING) continue;
    medianas.set(k, { t: percentil(g.map((x) => x.celsius), 50), h: g });
  }

  const deLaFila = new Map<string, number[]>();
  const delBloque = new Map<string, number[]>();
  const todas: number[] = [];
  for (const [k, v] of medianas) {
    const m = v.h[0]!.modulo;
    push2(deLaFila, m.rowId, v.t);
    push2(delBloque, m.block, v.t);
    todas.push(v.t);
  }

  for (const [k, v] of medianas) {
    if (yaReportado.has(k)) continue;   // ya salio por sus modulos calientes
    const m = v.h[0]!.modulo;

    // Contra los OTROS strings, sacandose a si mismo del vecindario: con dos
    // strings por fila, incluirse es compararse contra el promedio de uno mismo
    // y el vecino, que parte la diferencia al medio.
    const otros = (lista: number[] | undefined) => (lista ?? []).filter((t) => t !== v.t);
    const fila = otros(deLaFila.get(m.rowId));
    const bloque = otros(delBloque.get(m.block));
    const vuelo = otros(todas);
    const contra = fila.length ? fila : bloque.length ? bloque : vuelo;
    if (!contra.length) continue;

    const delta = v.t - percentil(contra, 50);
    if (delta < DELTA_STRING_ENTERO) continue;

    const largo = largoDe(m.rowId) ?? v.h.length;
    const ev: EventoDeString = {
      rowId: m.rowId, block: m.block, tracker: m.tracker,
      stringNumber: m.stringNumber,
      modulos: v.h.length,
      fraccion: v.h.length / largo,
      deltaTMedio: delta,
      motivo: "string-entero",
    };
    if (m.row) ev.row = m.row;
    if (m.stringLabel) ev.stringLabel = m.stringLabel;
    out.push(ev);
  }

  return out.sort((a, b) => b.modulos - a.modulos);
}

function push2<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

// ---------------------------------------------------------------------------

/**
 * A que fraccion de la altura hay que volar para resolver una celda.
 *
 * La resolucion es proporcional a la altura, asi que es una regla de tres: si
 * hoy la celda entra en 1.5 pixeles y hacen falta 4, hay que bajar a la raiz
 * de 1.5/4 de la altura. Se da como fraccion y no como metros porque la altura
 * del vuelo la sabe el que volo, no este resumen.
 */
function alturaParaCelda(gsdCm: number, celdaM: number): string {
  const ladoPx = (celdaM * 100) / Math.max(gsdCm, 0.01);
  const factor = Math.sqrt((ladoPx * ladoPx) / PIXELES_POR_CELDA_MINIMO);
  return `${Math.round(Math.min(1, factor) * 100)} %`;
}

export interface ResumenDeteccion {
  modulosMedidos: number;
  sinMedir: number;
  leves: number;
  moderadas: number;
  criticas: number;
  eventosDeString: number;
  /** Cuantos pudieron chequearse por adentro, buscando la celda caliente. */
  conChequeoDeCelda: number;
  /** Lo que la resolucion del vuelo NO permite afirmar. */
  limitaciones: string[];
}

export function resumir(
  hallazgos: Hallazgo[],
  totalModulos: number,
  eventos: EventoDeString[],
  gsdCm: number,
  soloEnElBorde = 0,
  posesSupuestas: Array<{ motivo: string; fotos: number }> = [],
  /**
   * Lado de la celda del parque, en metros.
   *
   * Es el MISMO numero que usa el `Acumulador` para medir. Aca estaba fijo en
   * la constante de 160 mm mientras la medicion usaba el del perfil: en un
   * parque de celdas M10 (182 mm) la app buscaba puntos calientes con una caja
   * y despues informaba si se podian ver o no con otra. Los dos numeros tienen
   * que ser uno solo, y ese es el del perfil.
   */
  celdaM = CELDA_M,
  /** Cuantos strings quedaron medidos en dos pasadas separadas en el tiempo. */
  stringsPartidos = 0,
): ResumenDeteccion {
  // Se cuenta por la PEOR de las dos comparaciones: al que tiene que salir a
  // caminar el parque no le importa cual de los dos chequeos disparo.
  const n = (s: Severidad) => hallazgos.filter((h) => h.peor === s).length;
  const limitaciones: string[] = [];

  // Primero lo que afecta a DONDE estan las cosas: si la foto se ubico con un
  // supuesto, todo lo demas de este resumen habla de modulos que pueden no ser
  // los que se midieron.
  for (const p of posesSupuestas) {
    limitaciones.push(
      `${p.fotos} ${p.fotos === 1 ? "foto" : "fotos"}: ${p.motivo}. Revisá que el vuelo sea el ` +
      "correcto antes de mandar a nadie a caminar con esta lista.",
    );
  }

  // Cuantos modulos pudieron chequearse por adentro. Es lo que decide si este
  // vuelo puede hablar de celdas o solo de modulos y strings.
  const conCelda = hallazgos.filter((h) => h.deltaInterno != null).length;
  const ladoPx = (celdaM * 100) / Math.max(gsdCm, 0.01);
  const pxPorCelda = ladoPx * ladoPx;

  // Dos cosas distintas y conviene no mezclarlas. La primera es fisica y sale
  // de la altura del vuelo: a esta resolucion, ¿una celda llega al sensor o
  // llega promediada? La segunda es de este lote de muestras.
  if (pxPorCelda < PIXELES_POR_CELDA_MINIMO) {
    limitaciones.push(
      `A ${gsdCm.toFixed(1)} cm por pixel una celda de ${(celdaM * 100).toFixed(0)} cm entra en ` +
      `${pxPorCelda.toFixed(1)} pixeles. Por debajo de ${PIXELES_POR_CELDA_MINIMO} el defecto ` +
      `llega al sensor ya promediado con lo que lo rodea, asi que NO se busco el punto caliente ` +
      `de celda: este vuelo detecta modulos y strings, no celdas. Para verlas hay que volar a ` +
      `${alturaParaCelda(gsdCm, celdaM)} de la altura de este vuelo.`,
    );
  } else if (hallazgos.length && conCelda < hallazgos.length / 2) {
    limitaciones.push(
      `La altura daba para buscar celdas calientes, pero solo ${conCelda} de ${hallazgos.length} ` +
      `modulos traen la medicion del punto caliente. En el resto no se busco.`,
    );
  }
  /*
    Strings partidos entre dos pasadas.

    No es un detalle de bitacora: es la diferencia entre "este modulo esta mas
    caliente que sus hermanos" y "este modulo se fotografio dos horas despues
    que sus hermanos". La comparacion ya se hace por tanda, asi que el numero
    que sale es correcto — lo que hay que decir es que ese string se midio
    contra MENOS vecinos de los que tiene, y por que.
  */
  if (stringsPartidos) {
    limitaciones.push(
      `${stringsPartidos} ${stringsPartidos === 1 ? "string quedo medido" : "strings quedaron medidos"} ` +
      `en dos pasadas separadas por mas de ${MINUTOS_DE_LA_MISMA_TANDA} minutos. Entre pasada y ` +
      `pasada los trackers giran y el parque se calienta, asi que cada mitad se comparo solo ` +
      `contra los vecinos de SU pasada — mezclarlas daria calientes a todos los de la pasada ` +
      `tardia y taparia un defecto real de la temprana. Volar cada bloque de una sola vez lo evita.`,
    );
  }

  const flojos = hallazgos.filter((h) => h.ambito !== "string").length;
  if (flojos) {
    limitaciones.push(
      `${flojos} modulos se compararon contra un vecindario mas suelto que su propio string, ` +
      `porque no habia suficientes vecinos medidos. Su delta T es menos confiable.`,
    );
  }

  // Los que solo aparecieron cortados por el borde del cuadro. Decirlo importa
  // porque si son muchos, el vuelo tuvo poco solape y la solucion es volar
  // distinto, no bajar los umbrales.
  if (soloEnElBorde) {
    limitaciones.push(
      `${soloEnElBorde} modulos aparecieron solo cortados por el borde de alguna foto y no se ` +
      `midieron: en el borde del sensor la lectura se va varios grados y daria hallazgos falsos. ` +
      `Si son muchos, al vuelo le falto solape.`,
    );
  }

  // La comparacion necesita vecinos. Con pocos modulos medidos, cualquier
  // diferencia se compara contra casi nada.
  const conString = hallazgos.filter((h) => h.ambito === "string").length;
  if (hallazgos.length && conString / hallazgos.length < 0.5) {
    limitaciones.push(
      `Menos de la mitad de los modulos medidos tuvieron su propio string completo para ` +
      `compararse. Este vuelo cubrio parches sueltos, no un parque: sirve para probar la ` +
      `cadena, no para emitir un informe.`,
    );
  }
  if (totalModulos > hallazgos.length) {
    limitaciones.push(
      `${totalModulos - hallazgos.length} modulos del parque no cayeron en ninguna foto. ` +
      `No se puede afirmar nada sobre ellos.`,
    );
  }

  return {
    modulosMedidos: hallazgos.length,
    sinMedir: Math.max(0, totalModulos - hallazgos.length),
    leves: n("leve"),
    moderadas: n("moderada"),
    criticas: n("critica"),
    eventosDeString: eventos.length,
    conChequeoDeCelda: conCelda,
    limitaciones,
  };
}
