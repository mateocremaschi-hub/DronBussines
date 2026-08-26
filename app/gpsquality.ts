/**
 * Que tan buena es la coordenada que devolvio el navegador.
 *
 * Esto existe por una tarde perdida en el campo. La app decia "no hay ninguna
 * fila de trackers a menos de 30 m de esa coordenada" y no habia forma de
 * saber por que, estando parado abajo del panel.
 *
 * La respuesta estaba en un numero que ya se mostraba, en gris y en chiquito,
 * al lado del boton: la precision. Si la coordenada trae 800 m de error, no
 * hay ninguna busqueda de 30 m que pueda encontrar nada — el problema no es la
 * geometria del parque ni el radio, es que esa coordenada no es una medicion
 * de GPS.
 *
 * De donde salen los numeros:
 *
 *   - Un celular con GPS al aire libre da 3 a 10 m.
 *   - Un celular con la ubicacion precisa apagada da cientos de metros: iOS
 *     entrega la celda de telefonia en vez del GPS, y Safari no avisa.
 *   - Una notebook no tiene GPS. Ubica por las redes WiFi que ve, asi que en
 *     el medio de un parque solar —donde no hay ninguna— da kilometros o falla.
 *
 * Los tres casos dan exactamente el mismo sintoma. La precision los separa.
 */

export type Calidad = "gps" | "justa" | "aproximada" | "inservible";

export interface Veredicto {
  calidad: Calidad;
  titulo: string;
  detalle: string;
  /** Si con esta coordenada tiene sentido siquiera buscar una fila. */
  sirve: boolean;
}

/** Arriba de esto ya no es una medicion de satelite. */
const LIMITE_GPS_M = 12;
const LIMITE_JUSTA_M = 30;
const LIMITE_APROX_M = 200;

export function calidadDeCoordenada(accuracyM: number | null, radioBusquedaM: number): Veredicto {
  if (accuracyM == null) {
    return {
      calidad: "justa",
      titulo: "Coordenada escrita a mano",
      detalle:
        "No vino de ningun GPS, asi que la app no sabe cuanto puede estar errada. Si la copiaste " +
        "de otro lado, fijate que sea de este parque.",
      sirve: true,
    };
  }

  if (accuracyM <= LIMITE_GPS_M) {
    return {
      calidad: "gps",
      titulo: `GPS bueno · ±${accuracyM} m`,
      detalle: `Son unos ${Math.max(1, Math.round(accuracyM / 1.155))} modulos de incertidumbre. Sirve para contar.`,
      sirve: true,
    };
  }

  if (accuracyM <= LIMITE_JUSTA_M) {
    return {
      calidad: "justa",
      titulo: `GPS flojo · ±${accuracyM} m`,
      detalle:
        `Son unos ${Math.round(accuracyM / 1.155)} modulos de incertidumbre — mas de media fila. ` +
        "Alcanza para saber en que tracker estas, no para el numero de modulo. Esperá unos " +
        "segundos parado quieto y probá de nuevo: la primera lectura casi siempre es la peor.",
      sirve: true,
    };
  }

  // El caso que importa: el error de posicion es mayor que el radio con el que
  // se busca, asi que no encontrar nada esta garantizado de antemano.
  const masGrandeQueElRadio = accuracyM > radioBusquedaM;
  const comun =
    "Eso no es una medicion de satelite. Las dos causas habituales: la ubicacion precisa esta " +
    "apagada para el navegador, o el dispositivo no tiene GPS y esta ubicando por redes WiFi " +
    "—una notebook en el medio de un parque no tiene ninguna cerca—.";

  if (accuracyM <= LIMITE_APROX_M) {
    return {
      calidad: "aproximada",
      titulo: `Ubicacion aproximada · ±${accuracyM} m`,
      detalle:
        comun +
        (masGrandeQueElRadio
          ? ` Y como el error es mas grande que los ${radioBusquedaM} m con los que la app busca, ` +
            "no encontrar ninguna fila no dice nada del parque: dice que la coordenada no sirve."
          : ""),
      sirve: false,
    };
  }

  return {
    calidad: "inservible",
    titulo: `Sin GPS · ±${(accuracyM / 1000).toFixed(1)} km`,
    detalle:
      `Con ese error la coordenada puede caer en cualquier parte del parque, o afuera. ` + comun,
    sirve: false,
  };
}

/**
 * Como se arregla, segun el dispositivo.
 *
 * Va aparte del veredicto porque son pasos para hacer ahi mismo, y en el campo
 * lo que hace falta es la instruccion, no el diagnostico.
 */
export function comoArreglarlo(): string[] {
  return [
    "En iPhone: Ajustes → Privacidad y seguridad → Localizacion → Safari → activá «Ubicacion precisa». Con eso apagado, iOS entrega la antena de telefonia en vez del GPS.",
    "En Android: Ajustes → Ubicacion → Precision → activá la ubicacion por GPS.",
    "Salí de abajo del panel unos metros: la estructura tapa parte del cielo y el GPS pierde satelites.",
    "Esperá diez o quince segundos parado quieto antes de tocar el boton. La primera lectura sale de la antena; recien despues entra el satelite.",
    "Si estas usando una notebook, no va a funcionar: no tienen GPS y ubican por WiFi. En el campo hay que usar el celular.",
  ];
}
