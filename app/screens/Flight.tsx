/**
 * Planificar el vuelo sobre el parque ya cargado.
 *
 * La ventaja de hacerlo aca y no en la app del dron es que aca el parque ya
 * esta: no hay que dibujar un poligono a mano sobre una imagen satelital ni
 * adivinar hacia donde corren las filas. Y sobre todo, se puede contestar la
 * unica pregunta que importa antes de despegar — cuantos pixeles le van a
 * tocar a cada modulo — que ninguna app de vuelo sabe, porque ninguna sabe
 * cuanto mide un modulo.
 */

import { useMemo, useState } from "react";
import { compileFarm } from "@locator";
import type { CompiledFarm } from "@locator";
import { GeometryPlot } from "../components/GeometryPlot";
import { download } from "../inspection";
import {
  CAMARAS,
  OPCIONES_POR_DEFECTO,
  planMission,
  toKml,
  toWaypointCsv,
  type MissionOptions,
} from "../mission";
import type { StoredFarm } from "../storage";

export function Flight({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [camIndex, setCamIndex] = useState(0);
  const [o, setO] = useState(OPCIONES_POR_DEFECTO);

  const opts: MissionOptions = { camera: CAMARAS[camIndex]!, ...o };

  const farm = useMemo<CompiledFarm | null>(() => {
    try { return compileFarm(stored.profile, stored.rows); } catch { return null; }
  }, [stored]);

  const mission = useMemo(
    () => planMission(stored.rows, stored.profile, opts),
    [stored.rows, stored.profile, opts.camera, o],
  );

  if (!farm) {
    return (
      <div className="screen">
        <p className="alert">El perfil de este parque no compila. Recargalo desde el asistente.</p>
        <button className="ghost" onClick={onBack}>Volver</button>
      </div>
    );
  }

  const s = mission?.stats;
  const num = (k: keyof typeof o, label: string, min: number, max: number, step: number, help?: string) => (
    <div className="field" key={k}>
      <label htmlFor={`f-${k}`}>{label}</label>
      <input
        id={`f-${k}`} type="number" min={min} max={max} step={step}
        value={o[k] as number}
        onChange={(e) => setO((p) => ({ ...p, [k]: Number(e.target.value) }))}
      />
      {help && <span className="help">{help}</span>}
    </div>
  );

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{stored.profile.name}</p>
          <h1>Planificar el vuelo</h1>
        </div>
        <button className="ghost" onClick={onBack}>Parques</button>
      </header>

      <section className="card">
        <h2>La camara</h2>
        <p className="help">
          Planificá con la <strong>termica</strong>, no con la visible. La termica tiene mucha menos
          resolucion, asi que su huella en el suelo es mas chica: un vuelo planificado con la camara
          visible deja huecos en la termica, que es la que importa.
        </p>
        <div className="field">
          <label htmlFor="f-cam">Sensor</label>
          <select id="f-cam" value={camIndex} onChange={(e) => setCamIndex(Number(e.target.value))}>
            {CAMARAS.map((c, i) => (<option key={c.name} value={i}>{c.name}</option>))}
          </select>
          <span className="help">
            Verificá el campo de vision contra la ficha de tu camara antes de volar. Un angulo mal
            cargado se traduce en huecos entre lineas.
          </span>
        </div>
      </section>

      <section className="card">
        <h2>El vuelo</h2>
        <div className="grid-2">
          {num("altitudeM", "Altura sobre el terreno (m)", 5, 120, 1, "Mas bajo: mas detalle y menos error de gimbal, pero mas lineas.")}
          {num("speedMps", "Velocidad (m/s)", 1, 15, 0.5)}
          {num("sideOverlap", "Solape lateral (0 a 1)", 0.3, 0.95, 0.05, "Entre lineas vecinas.")}
          {num("frontOverlap", "Solape frontal (0 a 1)", 0.3, 0.95, 0.05, "Entre fotos de la misma linea.")}
          {num("marginM", "Margen alrededor (m)", 0, 60, 5)}
        </div>
        <label className="check">
          <input
            type="checkbox" checked={o.alongRows}
            onChange={(e) => setO((p) => ({ ...p, alongRows: e.target.checked }))}
          />
          <span>
            Volar a lo largo de las filas
            <em>Cruzarlas obliga a muchos mas giros, y cada giro cuesta bateria.</em>
          </span>
        </label>
      </section>

      {s && mission && (
        <>
          <section className="card">
            <h2>Como queda</h2>
            <div className="stats">
              <div><b>{s.lineas}</b><span>pasadas</span></div>
              <div><b>{s.fotos}</b><span>fotos</span></div>
              <div><b>{s.minutos.toFixed(0)}</b><span>minutos</span></div>
              <div><b>{(s.distanciaM / 1000).toFixed(1)}</b><span>km de recorrido</span></div>
            </div>
            <div className="stats">
              <div><b>{s.gsdCm.toFixed(1)}</b><span>cm por pixel</span></div>
              <div className={s.pixelesPorModulo < 8 ? "alerta" : ""}>
                <b>{s.pixelesPorModulo.toFixed(0)}</b><span>pixeles por modulo</span>
              </div>
              <div><b>{s.huellaAnchoM.toFixed(0)} m</b><span>ancho de cada pasada</span></div>
              <div><b>{s.separacionM.toFixed(1)} m</b><span>entre pasadas</span></div>
            </div>

            {s.avisos.length > 0 ? (
              <div className="warnbox">
                {s.avisos.map((a, i) => (<p key={i}>{a}</p>))}
              </div>
            ) : (
              <p className="note good">
                El plan cierra: cada modulo va a quedar cubierto con {s.pixelesPorModulo.toFixed(0)} pixeles
                de ancho, y el vuelo entra en una bateria.
              </p>
            )}
          </section>

          <section className="card">
            <h2>La ruta sobre el parque</h2>
            <p className="help">
              La franja clara es lo que ve la camara en cada pasada. Si en algun lado se ve el
              parque asomando fuera de las franjas, ahi va a faltar foto.
            </p>
            <GeometryPlot farm={farm} mission={mission} height={480} />
            <div className="actions">
              <button onClick={() => download(`${stored.profile.id}-vuelo.kml`, toKml(mission, stored.profile.name), "application/vnd.google-earth.kml+xml")}>
                Exportar KML
              </button>
              <button className="ghost" onClick={() => download(`${stored.profile.id}-waypoints.csv`, toWaypointCsv(mission, opts), "text/csv")}>
                Exportar waypoints CSV
              </button>
            </div>
            <p className="help">
              El KML se abre en Google Earth para revisarlo antes de ir. Los waypoints salen con el
              gimbal en −90°, que es lo unico que sirve para mapear: inclinado, la coordenada de la
              foto deja de ser la del panel.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
