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
  MINUTOS_POR_BATERIA,
  OPCIONES_POR_DEFECTO,
  planByBlock,
  planByGroup,
  planMission,
  SOLAPES,
  toKml,
  toWaypointCsv,
  type MissionOptions,
} from "../mission";
import type { StoredFarm } from "../storage";

export function Flight({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [camIndex, setCamIndex] = useState(0);
  const [o, setO] = useState(OPCIONES_POR_DEFECTO);
  const [porBloque, setPorBloque] = useState(true);
  const [baterias, setBaterias] = useState(4);
  const [bloqueAbierto, setBloqueAbierto] = useState<string | null>(null);
  const [agrupar, setAgrupar] = useState(true);

  const opts: MissionOptions = { camera: CAMARAS[camIndex]!, ...o };

  const farm = useMemo<CompiledFarm | null>(() => {
    try { return compileFarm(stored.profile, stored.rows); } catch { return null; }
  }, [stored]);

  const plan = useMemo(
    () => planByBlock(stored.rows, stored.profile, opts, baterias),
    [stored.rows, stored.profile, opts.camera, o, baterias],
  );

  const agrupado = useMemo(
    () => planByGroup(stored.rows, stored.profile, opts, baterias),
    [stored.rows, stored.profile, opts.camera, o, baterias],
  );

  const entero = useMemo(
    () => planMission(stored.rows, stored.profile, opts),
    [stored.rows, stored.profile, opts.camera, o],
  );

  // Las salidas que se van a volar: agrupadas o bloque por bloque.
  const salidas = porBloque
    ? agrupar
      ? agrupado.grupos.map((g) => ({ clave: g.bloques.join("+"), nombre: g.bloques.join(", "), filas: g.filas, mission: g.mission, baterias: g.baterias }))
      : plan.bloques.map((b) => ({ clave: b.block, nombre: b.block, filas: b.filas, mission: b.mission, baterias: b.baterias }))
    : [];
  const total = porBloque ? (agrupar ? agrupado : plan) : null;

  const mission = porBloque
    ? salidas.find((s) => s.clave === bloqueAbierto)?.mission ?? null
    : entero;
  const etiqueta =
    porBloque && bloqueAbierto
      ? `bloque${bloqueAbierto.includes("+") ? "s" : ""} ${bloqueAbierto.replace(/\+/g, ", ")}`
      : "todo el parque";

  /**
   * Que cuesta cada configuracion, en horas.
   *
   * Sin esto hay que ir tocando numeros de a uno para descubrir que el solape
   * lateral es el que manda. Con la tabla se ve de una.
   */
  const alternativas = useMemo(() => {
    const casos: Array<[string, Partial<typeof o>]> = [
      ["Como esta ahora", {}],
      ["Con RTK: solape 45 %", SOLAPES.conRtk],
      ["Con RTK + 8 m/s", { ...SOLAPES.conRtk, speedMps: 8 }],
      ["Con RTK + 8 m/s, a 60 m", { ...SOLAPES.conRtk, speedMps: 8, altitudeM: 60 }],
    ];
    return casos.map(([nombre, cambio]) => {
      const p = agrupar
        ? planByGroup(stored.rows, stored.profile, { ...opts, ...cambio }, baterias)
        : planByBlock(stored.rows, stored.profile, { ...opts, ...cambio }, baterias);
      const m = planMission(stored.rows.slice(0, 1), stored.profile, { ...opts, ...cambio });
      return {
        nombre,
        horas: p.totalMinutos / 60,
        salidas: p.salidas,
        gsdCm: m?.stats.gsdCm ?? 0,
      };
    });
  }, [stored.rows, stored.profile, opts.camera, o, baterias]);

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

        <label className="check">
          <input
            type="checkbox" checked={o.rtk}
            onChange={(e) => setO((p) => ({
              ...p, rtk: e.target.checked,
              ...(e.target.checked ? SOLAPES.conRtk : SOLAPES.sinRtk),
            }))}
          />
          <span>
            El dron tiene RTK
            <em>
              Es el interruptor que mas cambia las horas, y no por la precision sino por el SOLAPE.
              El 70 % que viene por defecto es el que pide la fotogrametria para coser las fotos en
              un mosaico — algo que esta app no hace: proyecta cada foto por separado sobre el
              parque, que ya esta medido. El solape solo tiene que alcanzar para que no queden
              huecos cuando el dron se corre de la linea. Con RTK se corre centimetros y 45 % sobra;
              sin RTK se puede ir varios metros y hace falta el 70 %.
            </em>
          </span>
        </label>
      </section>

      <section className="card">
        <h2>Como se organiza el trabajo</h2>
        <p>
          Un parque entero no es una mision, es un proyecto: {stored.profile.name} da{" "}
          <strong>{(plan.totalMinutos / 60).toFixed(1)} horas</strong> de vuelo. La unidad util es
          el <strong>bloque</strong> — que ademas es la unidad en la que ya piensa la planta: los
          bloques tienen nombre, los defectos se reportan por bloque y la cuadrilla trabaja por
          bloque.
        </p>

        <div className="stats">
          <div><b>{salidas.length || plan.bloques.length}</b><span>vuelos</span></div>
          <div><b>{((total?.totalMinutos ?? plan.totalMinutos) / 60).toFixed(1)} h</b><span>de vuelo en total</span></div>
          <div><b>{total?.totalBaterias ?? plan.totalBaterias}</b><span>baterias</span></div>
          <div><b>{total?.salidas ?? plan.salidas}</b><span>salidas de campo</span></div>
        </div>

        {agrupado.bloquesAgrupados > 0 && (
          <p className={agrupar ? "note good" : "note bad"}>
            {agrupar ? (
              <>
                {agrupado.bloquesAgrupados} bloques comparten pasada con algun vecino y se vuelan
                juntos. Eso ahorra <strong>{(agrupado.ahorroMinutos / 60).toFixed(1)} horas</strong>{" "}
                contra volarlos por separado.
              </>
            ) : (
              <>
                {agrupado.bloquesAgrupados} bloques se pisan con algun vecino. Volandolos por
                separado se repiten las mismas pasadas:{" "}
                <strong>{(agrupado.ahorroMinutos / 60).toFixed(1)} horas de mas</strong>.
              </>
            )}
          </p>
        )}

        <div className="grid-2">
          <div className="field">
            <label htmlFor="f-bat">Baterias que llevas por salida</label>
            <input
              id="f-bat" type="number" min={1} max={20} value={baterias}
              onChange={(e) => setBaterias(Math.max(1, Number(e.target.value) || 1))}
            />
            <span className="help">
              Se cuentan {MINUTOS_POR_BATERIA} minutos utiles por bateria, ya descontada la reserva
              y el traslado hasta el bloque.
            </span>
          </div>
        </div>

        <label className="check">
          <input
            type="checkbox" checked={porBloque}
            onChange={(e) => { setPorBloque(e.target.checked); setBloqueAbierto(null); }}
          />
          <span>
            Planificar bloque por bloque
            <em>
              Ademas de hacerlo manejable, sale mas corto: volando el parque entero se cruza el
              campo vacio de punta a punta en cada pasada.
            </em>
          </span>
        </label>

        {porBloque && (
          <label className="check">
            <input
              type="checkbox" checked={agrupar}
              onChange={(e) => { setAgrupar(e.target.checked); setBloqueAbierto(null); }}
            />
            <span>
              Juntar los bloques que comparten pasada
              <em>
                Los bloques de una planta no son rectangulos prolijos: se escalonan y se meten unos
                entre otros. Dos que ocupan la misma franja repiten las mismas pasadas si se vuelan
                por separado. Volarlos juntos no mezcla nada — cada foto se ubica sola contra la
                geometria, asi que el informe sigue saliendo por bloque.
              </em>
            </span>
          </label>
        )}

        {porBloque && salidas.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th></th><th>{agrupar ? "Bloques" : "Bloque"}</th><th>Filas</th><th>Pasadas</th><th>Fotos</th><th>Minutos</th><th>Baterias</th></tr>
              </thead>
              <tbody>
                {salidas.map((b) => (
                  <tr key={b.clave} className={bloqueAbierto === b.clave ? "top" : ""}>
                    <td>
                      <input
                        type="radio" name="bloque" checked={bloqueAbierto === b.clave}
                        onChange={() => setBloqueAbierto(b.clave)}
                        aria-label={`Bloque ${b.nombre}`}
                      />
                    </td>
                    <td><code>{b.nombre}</code></td>
                    <td>{b.filas}</td>
                    <td>{b.mission.stats.lineas}</td>
                    <td>{b.mission.stats.fotos}</td>
                    <td>{b.mission.stats.minutos.toFixed(0)}</td>
                    <td>{b.baterias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {porBloque && !bloqueAbierto && (
          <p className="note">Elegi una fila de la tabla para ver su ruta y exportarla.</p>
        )}

        <h3>Que cuesta cada configuracion</h3>
        <p className="help">
          Las horas las manda el solape lateral, no la altura ni la velocidad. Cada pasada de menos
          es un kilometro de menos.
        </p>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Configuracion</th><th>cm/px</th><th>Horas</th><th>Salidas</th></tr></thead>
            <tbody>
              {alternativas.map((a, i) => (
                <tr key={a.nombre} className={i === 0 ? "top" : ""}>
                  <td>{a.nombre}</td>
                  <td>{a.gsdCm.toFixed(1)}</td>
                  <td><strong>{a.horas.toFixed(1)} h</strong></td>
                  <td>{a.salidas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {s && mission && (
        <>
          <section className="card">
            <h2>Como queda — {etiqueta}</h2>
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
                de ancho, y el vuelo entra en {Math.max(1, Math.ceil(s.minutos / MINUTOS_POR_BATERIA))} bateria(s).
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
              <button onClick={() => download(`${stored.profile.id}-${bloqueAbierto ?? "todo"}-vuelo.kml`, toKml(mission, `${stored.profile.name} — ${etiqueta}`), "application/vnd.google-earth.kml+xml")}>
                Exportar KML
              </button>
              <button className="ghost" onClick={() => download(`${stored.profile.id}-${bloqueAbierto ?? "todo"}-waypoints.csv`, toWaypointCsv(mission, opts), "text/csv")}>
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
