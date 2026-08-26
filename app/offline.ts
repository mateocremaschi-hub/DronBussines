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

  if (navigator.serviceWorker.controller) listo();
  else avisar("preparando");

  navigator.serviceWorker.addEventListener("controllerchange", listo);

  navigator.serviceWorker.register("/sw.js").then(
    (reg) => {
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
    navigator.serviceWorker.removeEventListener("controllerchange", listo);
  };
}
