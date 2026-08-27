/**
 * Si la app va a abrir sin internet, y decirlo ANTES de ir al campo.
 *
 * La app se usa parado en una fila de paneles donde no hay señal. Los datos ya
 * vivian offline en IndexedDB, pero sin service worker el navegador no tenia de
 * donde levantar el HTML: en el campo abria en blanco. Eso se arreglo.
 *
 * Lo que queda es el problema de confianza, que es aparte y no menos
 * importante: no alcanza con que funcione, hay que poder saberlo estando
 * todavia donde hay señal. Descubrir que no bajo bien despues de manejar hasta
 * el parque es exactamente igual de inutil que no tenerlo.
 */

export type EstadoOffline =
  | "sin-soporte"   // el navegador no expone service workers
  | "preparando"    // se esta bajando la app al dispositivo
  | "listo"         // abre sin internet
  | "actualizada"   // entro una version nueva y esta pestana todavia corre la vieja
  | "fallo";        // el registro no funciono

export interface Offline {
  estado: EstadoOffline;
  /** Si el dispositivo tiene red AHORA. */
  enLinea: boolean;
  detalle: string;
}

export function detalleDe(estado: EstadoOffline, enLinea: boolean): string {
  switch (estado) {
    case "listo":
      return enLinea
        ? "La app quedo guardada en este dispositivo: en el campo abre aunque no haya señal."
        : "Sin internet, y funcionando: la app esta guardada en este dispositivo.";
    case "preparando":
      return "Bajando la app a este dispositivo. Esperá a que diga «lista» antes de salir al campo.";
    case "sin-soporte":
      return "Este navegador no puede guardar la app para usarla sin internet. En el campo no va a abrir.";
    case "actualizada":
      return "Se descargó una versión nueva de la app. Esta pestaña todavía está corriendo la anterior: recargá para usarla.";
    case "fallo":
      return "No se pudo guardar la app en este dispositivo. Sin señal no va a abrir — probá recargar.";
  }
}

/**
 * Registra el service worker y avisa cuando la app quedo utilizable offline.
 *
 * `controller` es la señal que importa: mientras sea null, el service worker
 * todavia no esta manejando las peticiones de esta pestaña, asi que la app
 * NO abriria sin red aunque el registro haya andado.
 *
 * Y `controllerchange` significa dos cosas distintas segun cuando pase, que es
 * justo lo que faltaba distinguir:
 *
 *   - Si NO habia controlador antes, es la primera instalacion: la app quedo
 *     lista para el campo.
 *   - Si YA habia uno, es que entro una version nueva y tomo el control. El
 *     JavaScript de esta pestaña sigue siendo el viejo hasta que se recargue.
 *
 * Sin esa distincion, despues de cada deploy la pantalla dice "lista para el
 * campo" mientras corre codigo viejo. Uno cambia algo, recarga, y ve lo mismo
 * de antes sin ninguna explicacion — y termina dudando del cambio en vez de
 * dudar del cache.
 */
export function registrarOffline(alCambiar: (o: Offline) => void): () => void {
  const enLinea = () => (typeof navigator === "undefined" ? true : navigator.onLine);
  const avisar = (estado: EstadoOffline) =>
    alCambiar({ estado, enLinea: enLinea(), detalle: detalleDe(estado, enLinea()) });

  const onRed = () => avisar(estadoActual);
  let estadoActual: EstadoOffline = "preparando";

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    estadoActual = "sin-soporte";
    avisar(estadoActual);
    return () => {};
  }

  window.addEventListener("online", onRed);
  window.addEventListener("offline", onRed);

  const listo = () => {
    estadoActual = "listo";
    avisar(estadoActual);
  };

  // Se anota ANTES de escuchar: si ya habia controlador, el proximo cambio es
  // una version nueva, no la primera instalacion.
  const habiaControlador = !!navigator.serviceWorker.controller;

  if (habiaControlador) listo();
  else avisar("preparando");

  const alCambiarControlador = () => {
    estadoActual = habiaControlador ? "actualizada" : "listo";
    avisar(estadoActual);
  };
  navigator.serviceWorker.addEventListener("controllerchange", alCambiarControlador);

  navigator.serviceWorker.register("/sw.js").then(
    (reg) => {
      // Si ya se aviso que hay version nueva, esto no puede pisarlo: el
      // registro resuelve despues del controllerchange y volveria a decir
      // "lista para el campo" tapando el aviso que importa.
      if (estadoActual === "actualizada") return;
      if (reg.active && navigator.serviceWorker.controller) listo();
    },
    () => {
      estadoActual = "fallo";
      avisar(estadoActual);
    },
  );

  return () => {
    window.removeEventListener("online", onRed);
    window.removeEventListener("offline", onRed);
    navigator.serviceWorker.removeEventListener("controllerchange", alCambiarControlador);
  };
}
