/**
 * El paquete de garantias: separar lo que paga otro.
 *
 * Un informe de inspeccion dice que esta roto. Este modulo dice QUIEN LO PAGA,
 * que es la unica parte del trabajo que le devuelve plata al cliente.
 *
 * Hay tres bolsillos distintos y se confunden todo el tiempo:
 *
 *   - El fabricante de MODULOS responde por defectos de fabricacion: diodos de
 *     bypass, celdas en corto, PID, vidrio fisurado sin golpe.
 *   - El fabricante de TRACKERS responde por motores, inclinometros y
 *     transmisiones. Un tracker parado en el angulo equivocado no es un
 *     problema de modulos por mas que el detector marque sus 56 paneles.
 *   - La OPERACION paga lo suyo: suciedad, sombra de vegetacion, objetos
 *     encima, daño por golpe.
 *
 * Y hay una cuarta cosa, que es la que hace que los reclamos prosperen o
 * reboten: la EVIDENCIA. Un reclamo sin irradiancia declarada, sin foto RGB o
 * fuera del plazo vuelve rechazado, y el rechazo cuesta mas que no haberlo
 * presentado. Por eso cada item lleva la lista de lo que le falta ANTES de
 * mandarlo.
 */

import type { Hallazgo } from "./detect";

export type Canal = "modulos" | "trackers" | "operacion" | "sin-clasificar";

export const CANALES: Record<Canal, string> = {
  modulos: "Garantia del fabricante de modulos",
  trackers: "Garantia del fabricante de trackers",
  operacion: "A cargo de la operacion",
  "sin-clasificar": "Sin clasificar",
};

/**
 * A que bolsillo va cada tipo de anomalia.
 *
 * Las claves cubren el vocabulario propio y el ingles que usan los informes
 * tercerizados, porque el mismo defecto llega escrito de las dos formas.
 */
const POR_ANOMALIA: Array<{ patron: RegExp; canal: Canal; motivo: string }> = [
  { patron: /diodo|bypass/i, canal: "modulos",
    motivo: "Diodo de bypass activado: es un defecto interno del modulo." },
  { patron: /vidrio|cracked|glass/i, canal: "modulos",
    motivo: "Vidrio fisurado. Reclamable si no hay señal de golpe externo — la foto RGB decide." },
  { patron: /pid/i, canal: "modulos",
    motivo: "Degradacion inducida por potencial: defecto de fabricacion o de diseño del sistema." },
  { patron: /corto|short.?circuit/i, canal: "modulos",
    motivo: "Celda en cortocircuito: defecto interno." },
  { patron: /celda|multi.?hotspot|multiple/i, canal: "modulos",
    motivo: "Varias celdas afectadas sin causa externa visible: apunta a defecto de fabricacion." },
  { patron: /caja de conexion|junction/i, canal: "modulos",
    motivo: "Caja de conexion del modulo. Ademas es riesgo de incendio: prioridad alta." },

  { patron: /inclinad|inclined|tracker|motor|inclinometro|transmision/i, canal: "trackers",
    motivo: "El tracker no esta en el angulo que corresponde. Es motor, inclinometro o transmision." },

  { patron: /suciedad|soiling/i, canal: "operacion",
    motivo: "Suciedad: es limpieza, no garantia." },
  { patron: /sombra|vegetacion|vegetation|shading/i, canal: "operacion",
    motivo: "Sombra de vegetacion: es control de vegetacion, no garantia." },
  { patron: /objeto|foreign/i, canal: "operacion",
    motivo: "Objeto sobre el modulo: se saca, no se reclama." },
];

export function canalDe(anomalia: string | undefined): { canal: Canal; motivo: string } {
  if (!anomalia) {
    return {
      canal: "sin-clasificar",
      motivo: "Sin tipo de anomalia asignado. Hay que mirarlo antes de decidir a quien se le reclama.",
    };
  }
  for (const r of POR_ANOMALIA) {
    if (r.patron.test(anomalia)) return { canal: r.canal, motivo: r.motivo };
  }
  return { canal: "sin-clasificar", motivo: `"${anomalia}" no cae en ninguna regla conocida.` };
}

/**
 * Un string entero caliente casi nunca es garantia de modulos.
 *
 * Cuando los 28 modulos de un string se despegan juntos, el problema esta
 * aguas arriba: una conexion, un fusible, un tramo abierto. Reclamarlo al
 * fabricante de modulos es el reclamo que rebota — 28 modulos sanos no fallan
 * el mismo dia.
 */
export function esDeStringEntero(modulosCalientes: number, modulosPorString: number): boolean {
  return modulosCalientes / modulosPorString >= 0.5;
}

// ---------------------------------------------------------------------------
// Plazo
// ---------------------------------------------------------------------------

export interface Cobertura {
  /** Cuando se puso en marcha la planta. */
  puestaEnMarcha?: string;
  /** Años de garantia de producto de los modulos. */
  aniosModulos?: number;
  /** Años de garantia de los trackers. */
  aniosTrackers?: number;
}

export function dentroDePlazo(
  canal: Canal,
  cobertura: Cobertura,
  fechaDelVuelo: string | undefined,
): { vigente: boolean | null; detalle: string } {
  const anios = canal === "trackers" ? cobertura.aniosTrackers : cobertura.aniosModulos;
  if (!cobertura.puestaEnMarcha || !anios) {
    return { vigente: null, detalle: "Falta la puesta en marcha o el plazo de garantia." };
  }
  const inicio = new Date(cobertura.puestaEnMarcha);
  const vuelo = fechaDelVuelo ? new Date(fechaDelVuelo) : new Date();
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(vuelo.getTime())) {
    return { vigente: null, detalle: "No pude leer alguna de las dos fechas." };
  }
  const vence = new Date(inicio);
  vence.setFullYear(vence.getFullYear() + anios);
  const vigente = vuelo <= vence;
  return {
    vigente,
    detalle: vigente
      ? `Dentro del plazo: vence el ${vence.toISOString().slice(0, 10)}.`
      : `FUERA DE PLAZO: vencio el ${vence.toISOString().slice(0, 10)}.`,
  };
}

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

/** Irradiancia minima que pide la norma para que la medicion valga. */
export const IRRADIANCIA_MINIMA = 600;

/**
 * Viento a partir del cual la medicion deja de ser defendible.
 *
 * El viento enfria el vidrio y aplana las diferencias: un punto caliente real
 * puede medir 3 °C de delta con viento donde sin viento medía 15. Por eso el
 * dato se pide en el reporte — y por eso, si es alto, el fabricante lo puede
 * usar para rechazar el reclamo o, peor, la anomalia directamente no se ve.
 *
 * 18 km/h son los 5 m/s que se usan como tope de trabajo. Es una convencion,
 * como los umbrales de delta T: sirve para avisar, no para citar.
 */
export const VIENTO_MAXIMO_KMH = 18;

export interface Condiciones {
  irradianciaWm2?: number;
  vientoKmh?: number;
  cielo?: string;
  fecha?: string;
}

export interface ItemDeGarantia {
  hallazgo: Hallazgo;
  anomalia?: string;
  canal: Canal;
  motivo: string;
  plazo: { vigente: boolean | null; detalle: string };
  /** Lo que le falta al reclamo para no rebotar. */
  faltante: string[];
  /** Si esta listo para presentar. */
  completo: boolean;
}

/**
 * Que le falta a este reclamo.
 *
 * El orden importa: primero lo que lo invalida de plano (fuera de plazo, sin
 * irradiancia) y despues lo que lo debilita. Un reclamo rechazado cuesta mas
 * que uno no presentado, porque quema la relacion con el fabricante.
 */
export function evidenciaFaltante(
  h: Hallazgo,
  anomalia: string | undefined,
  canal: Canal,
  cond: Condiciones,
  plazo: { vigente: boolean | null },
  tieneRgb: boolean,
): string[] {
  const falta: string[] = [];

  if (plazo.vigente === false) falta.push("El plazo de garantia esta vencido.");
  if (plazo.vigente === null) falta.push("Falta cargar la puesta en marcha y el plazo de garantia.");

  if (cond.irradianciaWm2 == null) {
    falta.push("Falta la irradiancia del vuelo: sin ese dato la medicion no es defendible.");
  } else if (cond.irradianciaWm2 < IRRADIANCIA_MINIMA) {
    falta.push(
      `El vuelo se hizo con ${cond.irradianciaWm2} W/m2, por debajo de los ${IRRADIANCIA_MINIMA} ` +
      "que pide la norma. El fabricante lo puede rechazar por eso solo.",
    );
  }

  /*
    El viento y el cielo se cargaban en la pantalla de garantias y no los
    miraba nadie: no salian en el CSV ni entraban en "que le falta". Dos campos
    que se completan en el campo, con frio, para nada. Ahora pesan.
  */
  if (cond.vientoKmh == null) {
    falta.push("Falta el viento del vuelo: la norma pide documentarlo y sin el dato el reclamo es mas facil de rebotar.");
  } else if (cond.vientoKmh > VIENTO_MAXIMO_KMH) {
    falta.push(
      `El vuelo se hizo con ${cond.vientoKmh} km/h de viento, arriba de los ${VIENTO_MAXIMO_KMH} ` +
      "de tope. El viento enfria el vidrio y achica el delta T: el fabricante puede decir que la " +
      "medicion no vale, y ademas puede haber anomalias que directamente no se vieron.",
    );
  }
  if (!cond.cielo) {
    falta.push("Falta el estado del cielo: con nubes pasajeras la irradiancia cambia entre foto y foto.");
  }

  if (!anomalia) falta.push("Falta clasificar el tipo de anomalia.");
  if (canal === "sin-clasificar") falta.push("Falta decidir a quien se le reclama.");
  if (!tieneRgb) falta.push("Falta la foto visible: es la que descarta un golpe externo.");
  if (!h.modulo.stringLabel) {
    falta.push("El modulo no tiene etiqueta de string del cliente: hay que cargar la lista de strings.");
  }
  if (h.ambito !== "string") {
    falta.push(
      "El delta T se comparo contra un vecindario mas suelto que el propio string. " +
      "Conviene revolarlo antes de presentarlo.",
    );
  }
  if (!cond.fecha) falta.push("Falta la fecha del vuelo.");

  return falta;
}

export interface OpcionesPaquete {
  /** Tipo de anomalia asignado a mano, por id de modulo. */
  anomalias?: Map<string, string>;
  /** Modulos que pertenecen a un string caliente entero. */
  deStringEntero?: Set<string>;
  cobertura: Cobertura;
  condiciones: Condiciones;
  /** Ids de modulo que tienen foto visible asociada. */
  conRgb?: Set<string>;
}

export const claveDe = (h: Hallazgo) => `${h.modulo.rowId}#${h.modulo.positionInRow}`;

export function armarPaquete(hallazgos: Hallazgo[], opts: OpcionesPaquete): ItemDeGarantia[] {
  return hallazgos
    .filter((h) => h.peor !== "normal")
    .map((h) => {
      const k = claveDe(h);
      const anomalia = opts.anomalias?.get(k);
      let { canal, motivo } = canalDe(anomalia);

      // Un string entero caliente no es garantia de modulos por mas que el
      // tipo asignado lo sugiera: 28 modulos sanos no fallan el mismo dia.
      if (opts.deStringEntero?.has(k) && canal === "modulos") {
        canal = "sin-clasificar";
        motivo =
          "Todo el string esta caliente, asi que el problema es aguas arriba — una conexion, " +
          "un fusible, un tramo abierto. Reclamarlo al fabricante de modulos rebota.";
      }

      const plazo = dentroDePlazo(canal, opts.cobertura, opts.condiciones.fecha);
      const faltante = evidenciaFaltante(
        h, anomalia, canal, opts.condiciones, plazo, opts.conRgb?.has(k) ?? false,
      );
      return { hallazgo: h, anomalia, canal, motivo, plazo, faltante, completo: faltante.length === 0 };
    });
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

export interface ResumenGarantias {
  total: number;
  porCanal: Record<Canal, number>;
  listos: number;
  incompletos: number;
  /** Lo que le falta a mas reclamos, primero. Es lo que conviene arreglar. */
  faltantesFrecuentes: Array<{ motivo: string; reclamos: number }>;
}

export function resumirGarantias(items: ItemDeGarantia[]): ResumenGarantias {
  const porCanal: Record<Canal, number> = {
    modulos: 0, trackers: 0, operacion: 0, "sin-clasificar": 0,
  };
  const cuenta = new Map<string, number>();

  for (const it of items) {
    porCanal[it.canal]++;
    for (const f of it.faltante) cuenta.set(f, (cuenta.get(f) ?? 0) + 1);
  }

  return {
    total: items.length,
    porCanal,
    listos: items.filter((i) => i.completo).length,
    incompletos: items.filter((i) => !i.completo).length,
    faltantesFrecuentes: [...cuenta.entries()]
      .map(([motivo, reclamos]) => ({ motivo, reclamos }))
      .sort((a, b) => b.reclamos - a.reclamos),
  };
}

// ---------------------------------------------------------------------------
// Exportacion
// ---------------------------------------------------------------------------

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Una fila por reclamo, con la evidencia y con lo que le falta.
 *
 * La columna "que le falta" es la que hace util el archivo: sin ella hay que
 * abrir los reclamos de a uno para descubrir por que rebotaron.
 */
export function toCsv(items: ItemDeGarantia[], cond: Condiciones): string {
  const head = [
    "canal", "bloque", "tracker", "fila", "string", "modulo_desde_caja_dc",
    "anomalia", "celsius", "delta_t", "referencia_c", "severidad",
    "irradiancia_wm2", "viento_kmh", "cielo", "fecha_vuelo", "plazo", "foto_termica",
    "listo_para_presentar", "que_le_falta", "por_que_este_canal",
  ];
  const lines = [head.join(",")];

  const orden = [...items].sort(
    (a, b) =>
      Number(b.completo) - Number(a.completo) ||
      a.canal.localeCompare(b.canal) ||
      b.hallazgo.deltaT - a.hallazgo.deltaT,
  );

  for (const it of orden) {
    const h = it.hallazgo;
    lines.push([
      CANALES[it.canal], h.modulo.block, h.modulo.tracker, h.modulo.row ?? "",
      h.modulo.stringLabel ?? h.modulo.stringNumber, h.modulo.module,
      it.anomalia ?? "", h.celsius.toFixed(1), h.deltaT.toFixed(1), h.referenciaC.toFixed(1),
      h.severidad, cond.irradianciaWm2 ?? "", cond.vientoKmh ?? "", cond.cielo ?? "",
      cond.fecha ?? "", it.plazo.detalle, h.fileName,
      it.completo ? "si" : "no", it.faltante.join(" · "), it.motivo,
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
