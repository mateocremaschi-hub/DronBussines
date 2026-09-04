/**
 * La mision en el formato que entiende el dron.
 *
 * El KML que ya se exportaba sirve para mirar el plan en Google Earth antes de
 * ir, pero no se puede volar: DJI Pilot 2 no importa KML suelto. Lo que come es
 * un KMZ —un ZIP— con dos archivos adentro y con estas rutas exactas:
 *
 *   wpmz/template.kml     lo que Pilot 2 DIBUJA en la pantalla
 *   wpmz/waylines.wpml    lo que el dron EJECUTA
 *
 * Y la trampa que hace fallar la mitad de los generadores caseros: los
 * waypoints tienen que estar en LOS DOS. Si solo se escribe waylines, Pilot 2
 * muestra el plan del template —vacio o viejo— y al guardar pisa el vuelo con
 * eso. Por eso aca los dos archivos se generan del mismo recorrido y hay una
 * prueba que compara que tengan los mismos puntos.
 *
 * Las fotos NO salen poniendo un waypoint por foto. Un bloque de Edenvale son
 * miles de disparos y esa mision no entra ni es manejable. Se ponen waypoints
 * solo en las puntas de cada pasada y se dispara por DISTANCIA recorrida
 * (`multipleDistance`), que es como trabaja cualquier vuelo de mapeo.
 */

import type { LatLon } from "@locator";
import type { Mission, MissionOptions } from "./mission";
import { zip } from "./zip";

const NS = 'xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2"';

/**
 * Que numero tiene cada dron y cada camara para DJI.
 *
 * Son enteros arbitrarios de DJI: si van mal, Pilot 2 abre la mision pero la
 * rechaza al querer volarla. Se declaran en una tabla y no se adivinan, y cada
 * uno dice si esta confirmado contra la documentacion o no — el Matrice 4T es
 * posterior a la tabla publicada, asi que su numero hay que confirmarlo
 * exportando una mision desde el propio Pilot 2 y mirandola.
 */
export interface PerfilDji {
  id: string;
  nombre: string;
  droneEnum: number;
  droneSubEnum: number;
  payloadEnum: number;
  /** Si los numeros salen de la documentacion de DJI o estan por confirmar. */
  confirmado: boolean;
  nota?: string;
}

export const PERFILES_DJI: PerfilDji[] = [
  {
    id: "m3t",
    nombre: "Mavic 3T (termica)",
    droneEnum: 77, droneSubEnum: 1, payloadEnum: 66,
    confirmado: true,
  },
  {
    id: "m30t",
    nombre: "Matrice 30T",
    droneEnum: 67, droneSubEnum: 1, payloadEnum: 53,
    confirmado: true,
  },
  {
    id: "m4t",
    nombre: "Matrice 4T",
    droneEnum: 99, droneSubEnum: 1, payloadEnum: 99,
    confirmado: false,
    nota:
      "El Matrice 4T es posterior a la tabla publicada por DJI y estos numeros son " +
      "provisorios. Antes de volar: exporta cualquier mision desde Pilot 2 con el 4T, " +
      "abri el KMZ y copia de ahi droneEnumValue, droneSubEnumValue y payloadEnumValue.",
  },
];

export interface OpcionesKmz {
  nombre: string;
  perfil: PerfilDji;
  /** Altura de seguridad para el despegue, en metros. */
  alturaDespegueM?: number;
  /** Altura de vuelta a casa, en metros. Por encima de cualquier cosa del parque. */
  alturaRegresoM?: number;
  fecha: Date;
}

/** El KMZ listo para copiar al controlador. */
export function toKmz(mission: Mission, opts: MissionOptions, kmz: OpcionesKmz): Uint8Array<ArrayBuffer> {
  return zip(
    [
      { ruta: "wpmz/template.kml", contenido: templateKml(mission, opts, kmz) },
      { ruta: "wpmz/waylines.wpml", contenido: waylinesWpml(mission, opts, kmz) },
    ],
    kmz.fecha,
  );
}

// ---------------------------------------------------------------------------

/**
 * La configuracion que comparten los dos archivos.
 *
 * `finishAction` va en `goHome` y `exitOnRCLost` en `goContinue`: en un parque
 * de doscientas hectareas el dron se aleja lo suficiente como para perder el
 * control remoto en alguna pasada, y lo que corresponde ahi es que siga la
 * linea y vuelva, no que se quede flotando en el medio del campo.
 */
function missionConfig(opts: MissionOptions, k: OpcionesKmz): string {
  const p = k.perfil;
  return `    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>${k.alturaDespegueM ?? alturaDeTraslado(opts)}</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${Math.max(opts.speedMps, 8)}</wpml:globalTransitionalSpeed>
      <wpml:globalRTHHeight>${k.alturaRegresoM ?? Math.max(opts.altitudeM + 20, 80)}</wpml:globalRTHHeight>
      <wpml:droneInfo>
        <wpml:droneEnumValue>${p.droneEnum}</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>${p.droneSubEnum}</wpml:droneSubEnumValue>
      </wpml:droneInfo>
      <wpml:payloadInfo>
        <wpml:payloadEnumValue>${p.payloadEnum}</wpml:payloadEnumValue>
        <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
      </wpml:payloadInfo>
    </wpml:missionConfig>`;
}

/**
 * A que altura sube antes de irse al primer waypoint.
 *
 * Estaba en 30 m fijos. El dron despega, sube a esa altura y recien ahi sale
 * en horizontal hacia el primer punto de la mision — y el primer punto de un
 * bloque cae contra el borde del parque, que es justo donde estan el alambrado
 * y los arboles. Treinta metros no es poco, pero no hay ninguna razon para
 * cruzar por debajo de la altura a la que se va a volar igual.
 *
 * Sube a la altura de la mision, con un piso de 30 para que un vuelo bajo no
 * empeore esto, y un techo de 120 que es el limite legal de la categoria
 * excluida.
 */
function alturaDeTraslado(opts: MissionOptions): number {
  return Math.round(Math.min(120, Math.max(30, opts.altitudeM)));
}

const punto = (w: LatLon) => `<Point><coordinates>${w.lon.toFixed(8)},${w.lat.toFixed(8)}</coordinates></Point>`;

/**
 * Lo que Pilot 2 dibuja.
 *
 * La altura va `relativeToStartPoint`: los 50 metros del plan son sobre el
 * punto de despegue, que es como los piensa el que vuela. Con `EGM96` serian
 * sobre el nivel del mar y el dron volaria a la altura del terreno mas la
 * cota, que en un parque en pendiente es cualquier cosa.
 *
 * ESTE ARCHIVO DECIDE LA ALTURA, aunque el que se ejecuta sea el otro.
 * =========================================================================
 * Los waypoints de este template no llevaban ninguna altura. Llevaban
 * `wpml:executeHeight`, que es un elemento de waylines.wpml y aca no existe:
 * Pilot 2 lo ignora. Y sin `wpml:useGlobalHeight` tampoco tenia como saber
 * que debia usar el `globalHeight` de la carpeta. O sea que el plan que Pilot
 * 2 lee de aca —y con el que rearma la linea de vuelo al guardar o al volar—
 * tenia catorce waypoints sin altura.
 *
 * Lo que hace el dron con eso lo vimos en el campo, el 4 de septiembre, en el
 * bloque 1 de Wellington: despego solo con la mision, subio a la altura de
 * seguridad, se fue al primer waypoint —que cae contra el alambrado y los
 * arboles— y ahi BAJO a unos cinco metros. Mateo tuvo que sacarlo a mano. El
 * archivo decia 52 m en waylines.wpml y el dron volo a la altura que no
 * estaba escrita en el template.
 *
 * Por eso ahora cada waypoint lleva los cuatro `useGlobal*` que la
 * documentacion de DJI marca como obligatorios y su propia altura escrita al
 * lado. Las dos alturas —`height` y `ellipsoidHeight`— van con el mismo
 * numero: DJI las define como la misma altura en dos planos de referencia
 * distintos, no sabemos la cota del terreno sobre el elipsoide, y con
 * `heightMode` en `relativeToStartPoint` la que manda es `height`. Lo que no
 * se puede volver a hacer es dejar el campo vacio.
 */
function templateKml(m: Mission, opts: MissionOptions, k: OpcionesKmz): string {
  const t = k.fecha.getTime();
  const puntos = m.waypoints
    .map(
      (w, i) => `      <Placemark>
        ${punto(w)}
        <wpml:index>${i}</wpml:index>
        <wpml:ellipsoidHeight>${opts.altitudeM}</wpml:ellipsoidHeight>
        <wpml:height>${opts.altitudeM}</wpml:height>
        <wpml:useGlobalHeight>1</wpml:useGlobalHeight>
        <wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>
        <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>
        <wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>
        <wpml:gimbalPitchAngle>-90</wpml:gimbalPitchAngle>
      </Placemark>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml ${NS}>
  <Document>
    <wpml:author>Pica</wpml:author>
    <wpml:createTime>${t}</wpml:createTime>
    <wpml:updateTime>${t}</wpml:updateTime>
${missionConfig(opts, k)}
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineCoordinateSysParam>
        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
        <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
        <wpml:positioningType>GPS</wpml:positioningType>
      </wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${opts.speedMps}</wpml:autoFlightSpeed>
      <wpml:globalHeight>${opts.altitudeM}</wpml:globalHeight>
      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
      <wpml:globalWaypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
      </wpml:globalWaypointHeadingParam>
      <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>
${puntos}
    </Folder>
  </Document>
</kml>`;
}

/**
 * Lo que el dron ejecuta.
 *
 * Dos grupos de acciones y cada uno resuelve una cosa distinta:
 *
 *   - Al empezar, girar el gimbal a −90°. Mirando derecho para abajo es la
 *     unica posicion en la que la foto se puede proyectar sobre el parque como
 *     un rectangulo; con el gimbal inclinado el modulo fotografiado no es el
 *     que esta debajo.
 *   - En cada pasada, disparar cada N metros por distancia recorrida. El N
 *     sale del solape frontal que ya calculo el planificador.
 */
function waylinesWpml(m: Mission, opts: MissionOptions, k: OpcionesKmz): string {
  const cada = Math.max(1, Math.round(m.stats.disparoCadaM * 10) / 10);

  const puntos = m.waypoints
    .map((w, i) => {
      // Las pasadas son pares de waypoints: 0-1, 2-3, 4-5. El disparo se
      // programa en el punto par y corre hasta el impar siguiente.
      const abrePasada = i % 2 === 0 && i + 1 < m.waypoints.length;
      const disparo = abrePasada
        ? `
        <wpml:actionGroup>
          <wpml:actionGroupId>${i}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${i + 1}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType>
            <wpml:actionTriggerParam>${cada}</wpml:actionTriggerParam>
          </wpml:actionTrigger>
          <wpml:action>
            <wpml:actionId>0</wpml:actionId>
            <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            </wpml:actionActuatorFuncParam>
          </wpml:action>
        </wpml:actionGroup>`
        : "";

      return `      <Placemark>
        ${punto(w)}
        <wpml:index>${i}</wpml:index>
        <wpml:executeHeight>${opts.altitudeM}</wpml:executeHeight>
        <wpml:waypointSpeed>${opts.speedMps}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
        <wpml:useStraightLine>1</wpml:useStraightLine>
        <wpml:isRisky>0</wpml:isRisky>${disparo}
      </Placemark>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml ${NS}>
  <Document>
${missionConfig(opts, k)}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:autoFlightSpeed>${opts.speedMps}</wpml:autoFlightSpeed>
      <wpml:startActionGroup>
        <wpml:actionGroupId>1000</wpml:actionGroupId>
        <wpml:actionGroupStartIndex>0</wpml:actionGroupStartIndex>
        <wpml:actionGroupEndIndex>0</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
        <wpml:actionTrigger>
          <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
        </wpml:actionTrigger>
        <wpml:action>
          <wpml:actionId>0</wpml:actionId>
          <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>
          <wpml:actionActuatorFuncParam>
            <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            <wpml:gimbalHeadingYawBase>aircraft</wpml:gimbalHeadingYawBase>
            <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>
            <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
            <wpml:gimbalPitchRotateAngle>-90</wpml:gimbalPitchRotateAngle>
            <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>
            <wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>
            <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>
            <wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>
            <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>
            <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>
          </wpml:actionActuatorFuncParam>
        </wpml:action>
      </wpml:startActionGroup>
${puntos}
    </Folder>
  </Document>
</kml>`;
}

// ---------------------------------------------------------------------------

/**
 * Lo que hay que mirar antes de copiar el archivo al controlador.
 *
 * No es decorativo: cada uno de estos avisos corresponde a algo que hace que
 * la mision se abra pero no vuele, y descubrirlo en el campo cuesta el viaje.
 */
/**
 * Los elementos que cada waypoint del template TIENE que llevar.
 *
 * No es una lista de estilo: son los que DJI marca como obligatorios, y el que
 * faltaba —`useGlobalHeight`, con la altura al lado— es el que mando al dron a
 * cinco metros contra el alambrado del bloque 1. Un waypoint sin altura no da
 * error en ningun lado: Pilot 2 abre la mision, la dibuja, y el dron baja.
 */
const OBLIGATORIOS_DEL_TEMPLATE = [
  "wpml:index",
  "wpml:height",
  "wpml:ellipsoidHeight",
  "wpml:useGlobalHeight",
  "wpml:useGlobalSpeed",
  "wpml:useGlobalHeadingParam",
  "wpml:useGlobalTurnParam",
];

/** Los que tiene que llevar cada waypoint del archivo que se ejecuta. */
const OBLIGATORIOS_DE_LA_LINEA = [
  "wpml:index",
  "wpml:executeHeight",
  "wpml:waypointSpeed",
  "wpml:waypointHeadingParam",
  "wpml:waypointTurnParam",
];

/**
 * Revisa el archivo generado contra la lista de obligatorios de DJI.
 *
 * Se corre sobre el texto que se acaba de armar, no sobre el codigo que lo
 * arma: lo que importa es lo que va a leer el dron. Devuelve lo que falta, y
 * vacio es que esta completo.
 */
export function loQueFaltaEnElKmz(templateKmlTexto: string, waylinesTexto: string): string[] {
  const faltan: string[] = [];
  const revisar = (texto: string, archivo: string, obligatorios: string[]) => {
    const bloques = texto.split("<Placemark>").slice(1);
    if (!bloques.length) { faltan.push(`${archivo}: no tiene ningun waypoint`); return; }
    for (const etiqueta of obligatorios) {
      const conEl = bloques.filter((b) => b.includes(`<${etiqueta}>`)).length;
      if (conEl < bloques.length) {
        faltan.push(
          `${archivo}: ${bloques.length - conEl} de ${bloques.length} waypoints no llevan ` +
          `<${etiqueta}>`,
        );
      }
    }
  };
  revisar(templateKmlTexto, "template.kml", OBLIGATORIOS_DEL_TEMPLATE);
  revisar(waylinesTexto, "waylines.wpml", OBLIGATORIOS_DE_LA_LINEA);
  return faltan;
}

/** Los dos archivos del KMZ como texto, para poder revisarlos. */
export function archivosDelKmz(
  mission: Mission,
  opts: MissionOptions,
  kmz: OpcionesKmz,
): { template: string; waylines: string } {
  return {
    template: templateKml(mission, opts, kmz),
    waylines: waylinesWpml(mission, opts, kmz),
  };
}

export function avisosDeKmz(m: Mission, opts: MissionOptions, k: OpcionesKmz): string[] {
  const avisos: string[] = [];

  /*
    Lo primero: que el archivo este completo.

    Va antes que cualquier otro aviso porque es el unico de esta lista que ya
    hizo bajar un dron. Si algo de esto sale, el archivo NO se vuela.
  */
  const { template, waylines } = archivosDelKmz(m, opts, k);
  const faltan = loQueFaltaEnElKmz(template, waylines);
  if (faltan.length) {
    avisos.push(
      "ESTE ARCHIVO NO SE VUELA. Le faltan datos que DJI marca como obligatorios y un waypoint " +
      "sin altura no da error: Pilot 2 abre la mision igual y el dron baja hasta el suelo. " +
      `Falta: ${faltan.join("; ")}.`,
    );
  }

  if (!k.perfil.confirmado) avisos.push(k.perfil.nota ?? `Los numeros de ${k.perfil.nombre} estan sin confirmar.`);

  if (m.waypoints.length < 2) {
    avisos.push("Una mision necesita al menos dos waypoints. Esta tiene menos y Pilot 2 la rechaza.");
  }
  if (m.waypoints.length > 400) {
    avisos.push(
      `Son ${m.waypoints.length} waypoints. Pilot 2 los acepta pero se vuelve lento; ` +
      "conviene exportar bloque por bloque en vez de el parque entero.",
    );
  }
  if (opts.altitudeM > 120) {
    avisos.push(
      `La altura planificada es de ${opts.altitudeM} m y el limite de la categoria excluida ` +
      "de CASA son 120 m. Asi como esta, el vuelo no es legal.",
    );
  }
  avisos.push(
    "La altura es sobre el punto de despegue, no sobre el nivel del mar: despega desde el " +
    "bloque que vas a volar y no desde otro lado.",
  );
  /*
    La revision de treinta segundos que hay que hacer con el dron todavia en el
    suelo. Sale del vuelo del bloque 1: el archivo decia 52 m y el dron bajo a
    cinco. Mirando la lista de waypoints en Pilot 2 antes de despegar se veia.
  */
  avisos.push(
    `Antes de despegar, abri la mision en Pilot 2 y mira la altura de los waypoints en la ` +
    `lista: los ${m.waypoints.length} tienen que decir ${opts.altitudeM} m. Si alguno dice 0 o ` +
    "esta vacio, no despegues — el dron va a bajar hasta ahi cuando llegue al primer punto.",
  );
  return avisos;
}
