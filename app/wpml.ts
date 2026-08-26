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
      <wpml:takeOffSecurityHeight>${k.alturaDespegueM ?? 30}</wpml:takeOffSecurityHeight>
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

const punto = (w: LatLon) => `<Point><coordinates>${w.lon.toFixed(8)},${w.lat.toFixed(8)}</coordinates></Point>`;

/**
 * Lo que Pilot 2 dibuja.
 *
 * La altura va `relativeToStartPoint`: los 50 metros del plan son sobre el
 * punto de despegue, que es como los piensa el que vuela. Con `EGM96` serian
 * sobre el nivel del mar y el dron volaria a la altura del terreno mas la
 * cota, que en un parque en pendiente es cualquier cosa.
 */
function templateKml(m: Mission, opts: MissionOptions, k: OpcionesKmz): string {
  const t = k.fecha.getTime();
  const puntos = m.waypoints
    .map(
      (w, i) => `      <Placemark>
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
      </wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${opts.speedMps}</wpml:autoFlightSpeed>
      <wpml:globalHeight>${opts.altitudeM}</wpml:globalHeight>
      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
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
export function avisosDeKmz(m: Mission, opts: MissionOptions, k: OpcionesKmz): string[] {
  const avisos: string[] = [];

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
  return avisos;
}
