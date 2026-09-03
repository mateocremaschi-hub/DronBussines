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
import { claseSugerida, clasificarPatron } from "./patron";
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
}

/**
 * Que fraccion del modulo se mide, para no tocar el marco ni el suelo.
 *
 * El borde de un modulo tiene marco de aluminio, que al sol esta a otra
 * temperatura que la celda. Midiendo el 60 % central se evita.
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
export class Acumulador {
  private mejor = new Map<string, Muestra>();
  /** Fotos que llegaron sin rumbo o sin angulo de gimbal, por motivo. */
  private posesIncompletas = new Map<string, number>();
  /** Modulos que quedaron cortados por el borde del cuadro y no se midieron. */
  private recortados = new Set<string>();

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
        const previo = this.mejor.get(clave);
        if (previo && previo.distanciaAlCentroM <= d) continue;

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
        const hit = medirCaja(foto.radio, cx, cy, largoCaja, cruzadoCaja, celdaPx, anguloEnImagen);
        // El modulo tiene que haber entrado casi entero. Medio modulo apoyado
        // en el borde del sensor no es una medicion, es el borde del cuadro.
        if (!hit || hit.pixeles < hit.esperados * FRACCION_MINIMA_MEDIDA) {
          this.recortados.add(clave);
          continue;
        }

        // La forma de la mancha, para poder decir QUE defecto es y no solo
        // cuanto se despega.
        const retrato = retratoDeCaja(
          foto.radio, cx, cy, largoCaja, cruzadoCaja, anguloEnImagen,
        );

        medidos++;
        this.mejor.set(clave, {
          modulo: m,
          ...(retrato ? { retrato } : {}),
          ...(foto.cuando != null ? { cuando: foto.cuando } : {}),
          celsius: hit.celsius,
          pixeles: hit.pixeles,
          puntoCalienteC: hit.puntoCalienteC,
          pixelesPorCelda: ladoCeldaPx * ladoCeldaPx,
          fileName: foto.fileName,
          distanciaAlCentroM: d,
          caja: { cx, cy, largo: largoCaja, cruzado: cruzadoCaja, rotRad: anguloEnImagen },
        });
      }
    }
    return medidos;
  }

  muestras(): Muestra[] {
    return [...this.mejor.values()];
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
}

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

  return muestras.map((m) => {
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

    const deltaT = m.celsius - referenciaC;
    /*
      Que defecto es. Se hace aca y no al medir porque hace falta el ΔT contra
      el string, que solo existe una vez que estan todas las muestras: un modulo
      desconectado no tiene ninguna mancha adentro y solo se reconoce desde
      afuera, comparandolo con sus hermanos.
    */
    const patron = m.retrato ? clasificarPatron(m.retrato, deltaT) : undefined;

    return {
      ...m,
      deltaT,
      referenciaC,
      vecinos,
      ambito,
      ...(patron ? { patron } : {}),
      ...clasificar({ ...m, deltaT }, umbrales, internos),
    };
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
    deltaInterno != null ? severidadDe(deltaInterno, internos) : undefined;

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
 * Cuatro grados. Un string desconectado no entrega corriente, asi que toda la
 * energia que le entra se va en calor: en la practica corre bastante mas que
 * eso sobre sus vecinos. El umbral esta bajo a proposito — perder un string
 * entero es lo mas caro de esta lista, no es un panel, son 28, y un falso
 * positivo se descarta mirando una foto.
 */
export const DELTA_STRING_ENTERO = 4;

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
