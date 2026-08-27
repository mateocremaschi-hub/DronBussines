/**
 * Donde esta el sol, y por lo tanto en que angulo estan los trackers.
 *
 * Esta pieza contesta una pregunta que hasta ahora la app no se hacia y que
 * decide si un vuelo sirve: **los trackers no estan planos**. Se mueven de -55
 * a +55 grados siguiendo al sol, asi que a las nueve de la manana los modulos
 * estan casi de canto. Desde arriba, un modulo inclinado 55 grados se ve un
 * 43 % mas angosto de lo que es.
 *
 * Eso tiene tres consecuencias, todas practicas:
 *
 *  1. La celda, vista desde el dron, se achica en la misma proporcion. Un
 *     vuelo que a mediodia resuelve una celda, a las nueve no.
 *  2. La caja con la que se mide la temperatura de cada modulo tiene que
 *     achicarse igual, o entra suelo en la medicion y baja la mediana.
 *  3. Hay horas mejores que otras para volar, y se pueden calcular ANTES de
 *     viajar en vez de descubrirlo en el campo.
 *
 * Lo que NO cambia: la posicion del modulo a lo largo de la fila. El tracker
 * gira alrededor de su eje, que corre por el centro de la fila, asi que visto
 * desde arriba el centro de cada modulo se queda donde estaba. Por eso toda la
 * geometria de conteo sigue valiendo con los trackers en cualquier angulo.
 *
 * El algoritmo de posicion solar es el de la NOAA, que da el orden del
 * centesimo de grado — mucho mas de lo que hace falta aca, donde un grado de
 * error en el sol es medio grado en el tracker y nada en los pixeles.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface PosicionSolar {
  /** Altura sobre el horizonte, en grados. Negativa de noche. */
  alturaDeg: number;
  /** Rumbo del sol, en grados desde el norte hacia el este. */
  azimutDeg: number;
}

/** Dias julianos desde el 1 de enero de 2000 al mediodia. */
function siglosJulianos(fecha: Date): number {
  return (fecha.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545) / 36_525;
}

/**
 * Posicion del sol para una coordenada y un instante.
 *
 * `fecha` es un instante absoluto: la zona horaria del parque entra al armarlo,
 * no aca. Asi esta funcion no necesita saber nada del reloj de nadie.
 */
export function posicionSolar(lat: number, lon: number, fecha: Date): PosicionSolar {
  const t = siglosJulianos(fecha);

  // Geometria orbital media.
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  // Ecuacion del centro: la orbita no es un circulo.
  const C =
    Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * M * RAD) * 0.000289;

  const longitudVerdadera = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = longitudVerdadera - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  // Oblicuidad de la ecliptica: cuanto esta inclinado el eje de la Tierra.
  const e0 =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = e0 + 0.00256 * Math.cos(omega * RAD);

  const declinacion = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;

  // Ecuacion del tiempo: el sol verdadero adelanta y atrasa respecto del medio.
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTiempo =
    4 *
    DEG *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD));

  // Minutos desde la medianoche UTC.
  const minutosUtc =
    fecha.getUTCHours() * 60 + fecha.getUTCMinutes() + fecha.getUTCSeconds() / 60;

  // Angulo horario: 0 al mediodia solar, positivo a la tarde.
  let horario = (minutosUtc + eqTiempo + 4 * lon) / 4 - 180;
  while (horario < -180) horario += 360;
  while (horario > 180) horario -= 360;

  const latR = lat * RAD;
  const decR = declinacion * RAD;
  const hR = horario * RAD;

  const cosZenit =
    Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(hR);
  const zenit = Math.acos(Math.min(1, Math.max(-1, cosZenit)));

  // Azimut desde el norte hacia el este.
  const sinAz = -Math.sin(hR) * Math.cos(decR);
  const cosAz = Math.sin(decR) * Math.cos(latR) - Math.cos(decR) * Math.sin(latR) * Math.cos(hR);
  let azimut = Math.atan2(sinAz, cosAz) * DEG;
  azimut = (azimut + 360) % 360;

  return { alturaDeg: 90 - zenit * DEG, azimutDeg: azimut };
}

// ---------------------------------------------------------------------------
// El angulo del tracker
// ---------------------------------------------------------------------------

export interface AnguloDeTracker {
  /**
   * Giro del tracker respecto de la horizontal, en grados.
   *
   * Positivo cuando los modulos miran al ESTE (manana) y negativo cuando miran
   * al oeste (tarde), en los dos hemisferios. Cero es plano. Para los pixeles
   * lo que importa es el valor absoluto.
   */
  gradosDesdeLaHorizontal: number;
  /**
   * Cuanto se achica el modulo visto desde arriba: el coseno del giro.
   *
   * 1 con los trackers planos, 0.57 a 55 grados. Multiplica el ancho aparente
   * de todo lo que este sobre el modulo — el modulo, la celda, el punto
   * caliente — en el sentido transversal a la fila.
   */
  factorDeAcortamiento: number;
  /** `true` si el tracker esta contra su tope mecanico. */
  enElTope: boolean;
  /** `true` si el sol esta bajo el horizonte: de noche no hay que volar. */
  deNoche: boolean;
  /** Altura del sol, para poder decir cuanto falta para que valga la pena. */
  alturaSolarDeg: number;
}

/** Tope mecanico tipico de un tracker de un eje. */
export const TOPE_TRACKER_DEG = 55;

/**
 * En que angulo esta el tracker en un momento dado.
 *
 * Modelo: un eje horizontal norte-sur que gira para apuntar los modulos lo mas
 * de frente posible al sol, con un tope mecanico. Es el racking de casi
 * cualquier parque grande, incluido el de Edenvale.
 *
 * No modela el backtracking —la maniobra de aplanarse de mas al amanecer y al
 * atardecer para que una fila no le haga sombra a la siguiente— porque para lo
 * que se usa aca, backtracking siempre acerca el tracker a la horizontal: o
 * sea, el angulo real es MENOR o igual al que da esta cuenta. Como el angulo es
 * lo que empeora la resolucion, esta es la estimacion pesimista, que es la que
 * conviene tener antes de viajar.
 */
export function anguloDeTracker(
  lat: number,
  lon: number,
  fecha: Date,
  /** Tope mecanico del racking, en grados. */
  topeDeg = TOPE_TRACKER_DEG,
  /**
   * Rumbo del eje del tracker, en grados desde el norte. 0 = eje norte-sur, que
   * es el caso normal. 90 seria un eje este-oeste, que casi no se usa.
   */
  ejeDeg = 0,
): AnguloDeTracker {
  const sol = posicionSolar(lat, lon, fecha);
  if (sol.alturaDeg <= 0) {
    return {
      gradosDesdeLaHorizontal: 0,
      factorDeAcortamiento: 1,
      enElTope: false,
      deNoche: true,
      alturaSolarDeg: sol.alturaDeg,
    };
  }

  // Vector al sol, en el marco del eje del tracker: `x` es transversal al eje
  // (es hacia donde el tracker puede girar) y `z` es arriba.
  const zenitR = (90 - sol.alturaDeg) * RAD;
  const rumboRelativo = (sol.azimutDeg - ejeDeg) * RAD;
  const x = Math.sin(zenitR) * Math.sin(rumboRelativo);
  const z = Math.cos(zenitR);

  const ideal = Math.atan2(x, z) * DEG;
  const limitado = Math.max(-topeDeg, Math.min(topeDeg, ideal));

  return {
    gradosDesdeLaHorizontal: limitado,
    factorDeAcortamiento: Math.cos(limitado * RAD),
    enElTope: Math.abs(ideal) > topeDeg,
    deNoche: false,
    alturaSolarDeg: sol.alturaDeg,
  };
}

// ---------------------------------------------------------------------------
// La ventana de vuelo
// ---------------------------------------------------------------------------

export interface VentanaDeVuelo {
  /** Hora local, en formato HH:MM. */
  hora: string;
  /** El instante absoluto correspondiente. */
  cuando: Date;
  anguloDeg: number;
  factorDeAcortamiento: number;
  alturaSolarDeg: number;
}

/**
 * Como se ve el parque a lo largo del dia, de media hora en media hora.
 *
 * Sirve para elegir la hora de vuelo antes de viajar. Las dos condiciones
 * tiran para el mismo lado y por eso hay una ventana clara: el sol tiene que
 * estar alto (para que los modulos trabajen y el defecto se vea) y los
 * trackers cerca de planos (para que la celda entre en pixeles suficientes).
 * Las dos cosas pasan alrededor del mediodia solar.
 *
 * `offsetHorasUtc` es el huso del parque. Se pide explicito porque el
 * dispositivo puede estar en otro lado — planificar desde casa un vuelo en
 * Queensland es el caso normal, no el raro.
 */
export function ventanaDeVuelo(
  lat: number,
  lon: number,
  /** Dia local del vuelo, en formato YYYY-MM-DD. */
  dia: string,
  offsetHorasUtc: number,
  topeDeg = TOPE_TRACKER_DEG,
): VentanaDeVuelo[] {
  const [y, m, d] = dia.split("-").map(Number);
  if (!y || !m || !d) return [];

  const out: VentanaDeVuelo[] = [];
  for (let minutos = 0; minutos < 24 * 60; minutos += 30) {
    // Medianoche local, expresada en UTC.
    const cuando = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetHorasUtc * 3_600_000);
    cuando.setUTCMinutes(cuando.getUTCMinutes() + minutos);

    const a = anguloDeTracker(lat, lon, cuando, topeDeg);
    if (a.deNoche) continue;

    const hh = String(Math.floor(minutos / 60)).padStart(2, "0");
    const mm = String(minutos % 60).padStart(2, "0");
    out.push({
      hora: `${hh}:${mm}`,
      cuando,
      anguloDeg: a.gradosDesdeLaHorizontal,
      factorDeAcortamiento: a.factorDeAcortamiento,
      alturaSolarDeg: a.alturaSolarDeg,
    });
  }
  return out;
}

/**
 * El huso horario del parque, deducido de su longitud.
 *
 * Es una aproximacion —los husos politicos no siguen los meridianos y el
 * horario de verano los corre una hora mas— pero sirve de valor inicial para
 * que la persona no tenga que buscarlo. Lo que se muestra despues es
 * corregible a mano.
 */
export function husoAproximado(lon: number): number {
  // El `|| 0` no es cosmetico: `Math.round(-0.2)` da -0, que se imprime "-0".
  return Math.round(lon / 15) || 0;
}
