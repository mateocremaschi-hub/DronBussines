/**
 * La foto termica del hallazgo, con el modulo medido marcado encima.
 *
 * Faltaba, y era el agujero entre lo que la app sabe y lo que el tecnico puede
 * decir. El motor contesta CUANTO —+14,3 °C contra sus 27 hermanos— y con eso
 * ordena la lista por prioridad. Pero lo que le pone NOMBRE al defecto es el
 * patron, y el patron solo se ve en la imagen:
 *
 *   una celda puntual        -> punto caliente / celda fisurada
 *   un tercio de la placa     -> diodo de bypass, un substring entero
 *   el modulo entero parejo   -> desconectado, circuito abierto
 *
 * Sin la foto, el informe puede decir "modulo 19 a +14 °C" y nada mas. Con la
 * foto se puede escribir "diodo de bypass", que es lo que el cliente necesita
 * y lo que un reclamo de garantia exige.
 *
 * El recuadro NO se recalcula aca: se dibuja la caja que se guardo al medir.
 * Recalcularla pediria la pose, la camara, el ajuste y el acortamiento del
 * tracker en ese instante, y equivocarle a uno de esos cuatro senala el panel
 * de al lado con la misma seguridad. Lo que se ve marcado es literalmente de
 * donde salio el numero.
 */

import { useEffect, useRef, useState } from "react";
import type { Caja } from "../detect";

/*
  Toma el nombre del archivo y la caja sueltos, no un `Hallazgo`.

  Los dos lugares que muestran la foto tienen la misma informacion guardada en
  tipos distintos: el paso de deteccion tiene un `Hallazgo` y la revision tiene
  un `Finding` con su `medicion`. Pidiendo las dos cosas que de verdad usa
  —el nombre y el recuadro— sirve a los dos sin que ninguno tenga que fabricar
  un objeto del otro tipo para poder llamarla.
*/
interface Props {
  fileName: string;
  /** El recuadro medido, en pixeles de la imagen termica. */
  caja?: Caja;
  /** Los archivos del vuelo, para encontrar el JPEG por nombre. */
  archivos: File[];
  /**
   * Si va el parrafo que explica como se lee un patron termico.
   *
   * En el paso de deteccion se mira UNA foto y el parrafo ensena a leerla. En
   * la revision se miran cuatrocientas seguidas: las mismas cuatro lineas
   * debajo de cada una empujan los botones fuera de la pantalla y ya no ensenan
   * nada. Ahi el mismo consejo vive en el `title` de cada boton de anomalia,
   * que es donde se lo necesita.
   */
  explicar?: boolean;
}

export function FotoDelHallazgo({ fileName, caja, archivos, explicar = true }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setError(null);
    setDim(null);
    const file = archivos.find((f) => f.name === fileName);
    if (!file) {
      setError(`No tengo el archivo ${fileName} a mano.`);
      setUrl(null);
      return;
    }
    /*
      Las R-JPEG de DJI son JPEG validos: traen la matriz de temperaturas en
      segmentos propios y la imagen coloreada como cualquier otra foto. Asi que
      el navegador la muestra sin decodificar nada.
    */
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [fileName, archivos]);

  return (
    <div className="foto-hallazgo">
      {error && <p className="note bad">{error}</p>}
      {url && (
        <div className="lienzo">
          <img
            ref={imgRef}
            src={url}
            alt={fileName}
            onLoad={(e) =>
              setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
          {/*
            El recuadro va en un SVG encima, con el mismo sistema de
            coordenadas que la imagen termica. `viewBox` hace la escala sola,
            asi que la marca sigue a la foto cuando cambia el tamano en
            pantalla — sin recalcular nada.
          */}
          {caja && dim && (
            /*
              El viewBox va en el marco de la CAJA, no en el del JPEG.

              Con "Super Resolution" prendida el JPEG mide 1280x1024 y la caja
              esta en el marco de la termica cruda, 640x512. Usando el tamano
              del JPEG, todos los recuadros se dibujaban a la mitad de su
              posicion — y ahi es donde una persona mira para decidir si le
              cree al informe. Las mediciones estaban bien todo el tiempo.

              Los vuelos viejos guardaron la caja sin su marco: para esos se
              cae al tamano del archivo, que es lo que se venia haciendo.
            */
            <svg
              className="marca"
              viewBox={`0 0 ${caja.ancho ?? dim.w} ${caja.alto ?? dim.h}`}
              preserveAspectRatio="none"
            >
              {/*
                Se remarca el MODULO ENTERO, no el pedazo que se midio.

                Medir toca solo la parte de adentro —el marco de aluminio esta
                a otra temperatura que la celda— pero dibujar esa parte era un
                rectangulito flotando entre los paneles, y con la rejilla
                corrida quedaba a caballo de dos. Justo la duda que la foto
                tiene que despejar. Marcado el modulo entero, el que mira
                cuenta paneles desde la punta y ve cual es sin adivinar.

                Los vuelos viejos guardaron la caja sin el tamaño del modulo:
                para esos se dibuja lo que hay, que es lo que se venia
                dibujando.
              */}
              <rect
                x={caja.cx - (caja.largoModulo ?? caja.largo) / 2}
                y={caja.cy - (caja.cruzadoModulo ?? caja.cruzado) / 2}
                width={caja.largoModulo ?? caja.largo}
                height={caja.cruzadoModulo ?? caja.cruzado}
                transform={`rotate(${(caja.rotRad * 180) / Math.PI} ${caja.cx} ${caja.cy})`}
                fill="none"
                stroke="#00e5ff"
                strokeWidth={Math.max(2, (caja.ancho ?? dim.w) / 320)}
              />
              {/*
                Y adentro, finita, la zona de la que salio el numero. Es la
                unica forma de que el ΔT del informe sea auditable: si alguien
                duda de la medicion, tiene que poder ver que se midio.
              */}
              {caja.largoModulo != null && (
                <rect
                  x={caja.cx - caja.largo / 2}
                  y={caja.cy - caja.cruzado / 2}
                  width={caja.largo}
                  height={caja.cruzado}
                  transform={`rotate(${(caja.rotRad * 180) / Math.PI} ${caja.cx} ${caja.cy})`}
                  fill="none"
                  stroke="#00e5ff"
                  strokeOpacity={0.45}
                  strokeDasharray="3 3"
                  strokeWidth={Math.max(1, (caja.ancho ?? dim.w) / 640)}
                />
              )}
            </svg>
          )}
        </div>
      )}
      <p className="help">
        {caja
          ? caja.largoModulo != null
            ? "El recuadro lleno es el modulo entero. El punteado de adentro es la zona de la que " +
              "salio el numero: se deja afuera el marco de aluminio, que al sol lee distinto que la celda."
            : "El recuadro es la zona que se midio, sin el marco de aluminio."
          : "Este hallazgo no guardo la posicion del modulo en la foto, asi que no se puede marcar."}
        {explicar && (
          <>
            {" "}Mira el <strong>patron</strong>, no solo el color: una celda puntual es un punto
            caliente; un tercio de la placa parejo es un diodo de bypass; el modulo entero tibio es
            que esta desconectado.
          </>
        )}
      </p>
    </div>
  );
}
