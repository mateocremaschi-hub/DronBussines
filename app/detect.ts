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
import { medirCaja, percentil, type Radiometric } from "./thermal";
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
  /** Distancia del modulo al centro del cuadro. Cerca del borde la termica miente mas. */
  distanciaAlCentroM: number;
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

/** Cuantos pixeles tendria la caja si entrara entera en el cuadro. */
function pixelesEsperados(cx: number, cy: number, anchoPx: number, altoPx: number): number {
  const spanX = Math.round(cx + anchoPx / 2) - Math.round(cx - anchoPx / 2) + 1;
  const spanY = Math.round(cy + altoPx / 2) - Math.round(cy - altoPx / 2) + 1;
  return Math.max(1, spanX) * Math.max(1, spanY);
}

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
  /** Modulos que quedaron cortados por el borde del cuadro y no se midieron. */
  private recortados = new Set<string>();

  constructor(
    private farm: CompiledFarm,
    private frame: LocalFrame,
    private opts: OpcionesMuestreo,
  ) {}

  /** Mide los modulos que caen en esta foto. Devuelve cuantos. */
  agregar(foto: FotoTermica): number {
    const { camera, moduloAnchoM, moduloLargoM } = this.opts;
    const huella = aplicarAjuste(
      footprint(this.frame, foto.pose, camera),
      this.opts.ajuste ?? SIN_AJUSTE,
    );

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
      for (const m of modulesOfRow(row, this.farm)) {
        const px = pixelOf(huella, { x: m.x, y: m.y }, camera);
        if (!px) continue;

        const d = Math.hypot(m.x - huella.centre.x, m.y - huella.centre.y);
        const clave = `${m.rowId}#${m.positionInRow}`;
        const previo = this.mejor.get(clave);
        if (previo && previo.distanciaAlCentroM <= d) continue;

        const cx = px.px * escalaX;
        const cy = px.py * escalaY;
        const anchoCaja = ((moduloAnchoM * FRACCION_UTIL) / mPorPx) * escalaX;
        const altoCaja = ((moduloLargoM * FRACCION_UTIL) / mPorPx) * escalaY;

        // Cuantos pixeles cubre una celda: es el tamaño del parche mas caliente
        // que se busca adentro del modulo, y tambien el que decide si se puede
        // ver o no.
        const ladoCeldaPx = ((this.opts.celdaM ?? CELDA_M) / mPorPx) * escalaX;
        const hit = medirCaja(foto.radio, cx, cy, anchoCaja, altoCaja, ladoCeldaPx * ladoCeldaPx);
        // El modulo tiene que haber entrado casi entero. Medio modulo apoyado
        // en el borde del sensor no es una medicion, es el borde del cuadro.
        if (!hit || hit.pixeles < pixelesEsperados(cx, cy, anchoCaja, altoCaja) * FRACCION_MINIMA_MEDIDA) {
          this.recortados.add(clave);
          continue;
        }

        medidos++;
        this.mejor.set(clave, {
          modulo: m,
          celsius: hit.celsius,
          pixeles: hit.pixeles,
          puntoCalienteC: hit.puntoCalienteC,
          pixelesPorCelda: ladoCeldaPx * ladoCeldaPx,
          fileName: foto.fileName,
          distanciaAlCentroM: d,
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

/** Minimo de vecinos para que una mediana signifique algo. */
const VECINOS_MINIMOS = 5;

export function comparar(
  muestras: Muestra[],
  umbrales: Umbrales = UMBRALES,
  internos: Umbrales = UMBRALES_INTERNOS,
): Hallazgo[] {
  // Vecindarios, del mas significativo al mas suelto.
  const porString = new Map<string, number[]>();
  const porFila = new Map<string, number[]>();
  const todo: number[] = [];

  const claveString = (m: Muestra) => `${m.modulo.rowId}#${m.modulo.chunkIndex}`;

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
    const severidad = severidadDe(deltaT, umbrales);

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
    const mideElPanel = deltaT > -umbrales.leve;
    const deltaInterno =
      resuelve && mideElPanel && m.puntoCalienteC != null
        ? m.puntoCalienteC - m.celsius
        : undefined;
    const severidadInterna =
      deltaInterno != null ? severidadDe(deltaInterno, internos) : undefined;

    const peor = peorDe(severidad, severidadInterna ?? "normal");
    return {
      ...m,
      deltaT,
      referenciaC,
      vecinos,
      ambito,
      severidad,
      ...(deltaInterno != null ? { deltaInterno } : {}),
      ...(severidadInterna ? { severidadInterna } : {}),
      peor,
      origen:
        peor === "normal" ? "ninguno"
        : peor === severidad ? "modulo"
        : "celda",
    };
  });
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
}

/**
 * Junta los strings donde la anomalia no es de un modulo sino de todo el string.
 *
 * Un modulo caliente es un modulo. Un STRING entero caliente es otra cosa: una
 * conexion, un fusible, un tramo desconectado. Se arregla en otro lado y a
 * veces lo paga otro. Reportar 28 hallazgos donde hay uno solo es lo que hace
 * que un informe de 3000 filas sea inutilizable.
 */
export function eventosDeString(
  hallazgos: Hallazgo[],
  modulosPorString: number,
  fraccionMinima = 0.5,
): EventoDeString[] {
  const grupos = new Map<string, Hallazgo[]>();
  for (const h of hallazgos) {
    if (h.severidad === "normal") continue;
    push2(grupos, `${h.modulo.rowId}#${h.modulo.chunkIndex}`, h);
  }

  const out: EventoDeString[] = [];
  for (const g of grupos.values()) {
    const fraccion = g.length / modulosPorString;
    if (fraccion < fraccionMinima) continue;
    const m = g[0]!.modulo;
    const ev: EventoDeString = {
      rowId: m.rowId, block: m.block, tracker: m.tracker,
      stringNumber: m.stringNumber,
      modulos: g.length,
      fraccion,
      deltaTMedio: g.reduce((s, h) => s + h.deltaT, 0) / g.length,
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
function alturaParaCelda(gsdCm: number): string {
  const ladoPx = (CELDA_M * 100) / Math.max(gsdCm, 0.01);
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
): ResumenDeteccion {
  // Se cuenta por la PEOR de las dos comparaciones: al que tiene que salir a
  // caminar el parque no le importa cual de los dos chequeos disparo.
  const n = (s: Severidad) => hallazgos.filter((h) => h.peor === s).length;
  const limitaciones: string[] = [];

  // Cuantos modulos pudieron chequearse por adentro. Es lo que decide si este
  // vuelo puede hablar de celdas o solo de modulos y strings.
  const conCelda = hallazgos.filter((h) => h.deltaInterno != null).length;
  const ladoPx = (CELDA_M * 100) / Math.max(gsdCm, 0.01);
  const pxPorCelda = ladoPx * ladoPx;

  // Dos cosas distintas y conviene no mezclarlas. La primera es fisica y sale
  // de la altura del vuelo: a esta resolucion, ¿una celda llega al sensor o
  // llega promediada? La segunda es de este lote de muestras.
  if (pxPorCelda < PIXELES_POR_CELDA_MINIMO) {
    limitaciones.push(
      `A ${gsdCm.toFixed(1)} cm por pixel una celda de ${(CELDA_M * 100).toFixed(0)} cm entra en ` +
      `${pxPorCelda.toFixed(1)} pixeles. Por debajo de ${PIXELES_POR_CELDA_MINIMO} el defecto ` +
      `llega al sensor ya promediado con lo que lo rodea, asi que NO se busco el punto caliente ` +
      `de celda: este vuelo detecta modulos y strings, no celdas. Para verlas hay que volar a ` +
      `${alturaParaCelda(gsdCm)} de la altura de este vuelo.`,
    );
  } else if (hallazgos.length && conCelda < hallazgos.length / 2) {
    limitaciones.push(
      `La altura daba para buscar celdas calientes, pero solo ${conCelda} de ${hallazgos.length} ` +
      `modulos traen la medicion del punto caliente. En el resto no se busco.`,
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
