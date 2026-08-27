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
import { compileFarm, husoAproximado, TOPE_TRACKER_DEG, ventanaDeVuelo } from "@locator";
import type { CompiledFarm } from "@locator";
import { GeometryPlot } from "../components/GeometryPlot";
import { descargarBytes, download } from "../inspection";
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
import { avisosDeKmz, PERFILES_DJI, toKmz } from "../wpml";
import { PIXELES_POR_CELDA_MINIMO, CELDA_M } from "../detect";
import type { StoredFarm } from "../storage";

export function Flight({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [camIndex, setCamIndex] = useState(0);
  const [o, setO] = useState(OPCIONES_POR_DEFECTO);
  /** Lo que se esta tipeando, mientras no sea todavia un numero valido. */
  const [crudos, setCrudos] = useState<Partial<Record<keyof typeof OPCIONES_POR_DEFECTO, string>>>({});
  const [porBloque, setPorBloque] = useState(true);
  const [baterias, setBaterias] = useState(4);
  const [bloqueAbierto, setBloqueAbierto] = useState<string | null>(null);
  const [agrupar, setAgrupar] = useState(true);
  /**
   * La aeronave sale de la camara elegida, no de una segunda lista.
   *
   * Antes eran dos elecciones sueltas y se podian contradecir: planificar con
   * la huella del Matrice 4T y exportar el archivo del Mavic 3T. El KMZ salia
   * sin quejarse, y el error aparecia recien en el campo — con las lineas
   * separadas para una camara y el dron llevando otra.
   */
  const perfil = PERFILES_DJI.find((p) => p.id === CAMARAS[camIndex]!.djiId);

  const opts: MissionOptions = { camera: CAMARAS[camIndex]!, ...o };

  const farm = useMemo<CompiledFarm | null>(() => {
    try { return compileFarm(stored.profile, stored.rows); } catch { return null; }
  }, [stored]);

  const plan = useMemo(
    () => planByBlock(stored.rows, stored.profile, opts, baterias),
    [stored.rows, stored.profile, opts.camera, o, baterias],
  );

  /**
   * La hora del vuelo, y el angulo en el que van a estar los trackers.
   *
   * Esto contesta una pregunta que la app no se hacia y que decide si el vuelo
   * sirve. El dia arranca en el de hoy segun el reloj del dispositivo, y el
   * huso sale de la longitud del parque — planificar desde casa un vuelo del
   * otro lado del mundo es el caso normal, no el raro.
   */
  const centro = useMemo(() => {
    if (!stored.rows.length) return { lat: 0, lon: 0 };
    let lat = 0, lon = 0;
    for (const r of stored.rows) {
      lat += (r.start.lat + r.end.lat) / 2;
      lon += (r.start.lon + r.end.lon) / 2;
    }
    return { lat: lat / stored.rows.length, lon: lon / stored.rows.length };
  }, [stored.rows]);

  const [diaDeVuelo, setDiaDeVuelo] = useState(() => new Date().toISOString().slice(0, 10));
  const [huso, setHuso] = useState(() => husoAproximado(centro.lon));

  const ventana = useMemo(
    () => ventanaDeVuelo(centro.lat, centro.lon, diaDeVuelo, huso),
    [centro, diaDeVuelo, huso],
  );

  /** La media hora del dia con los trackers mas planos. */
  const mejorHora = ventana.length
    ? ventana.reduce((a, b) => (Math.abs(b.anguloDeg) < Math.abs(a.anguloDeg) ? b : a))
    : null;

  /**
   * La ventana util: trackers a menos de 25 grados y sol a mas de 30.
   *
   * Los dos limites son de trabajo, no de norma. 25 grados de tracker dejan el
   * modulo al 90 % de su ancho aparente, que ya casi no mueve los pixeles por
   * celda; y con el sol a menos de 30 grados de altura no se llega a los
   * 600 W/m² que pide la norma para que la medicion valga.
   */
  const horasBuenas = ventana.filter(
    (h) => Math.abs(h.anguloDeg) <= 25 && h.alturaSolarDeg >= 30,
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
        // Las baterias y las salidas son lo que de verdad se paga: horas de
        // vuelo son un numero, pero cuatro salidas de campo menos son cuatro
        // viajes menos y varios dias de alguien.
        baterias: p.totalBaterias,
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

  const celdaM = (stored.profile.module.cellMm ?? CELDA_M * 1000) / 1000;
  /** Cuantos pixeles de area le tocan a una celda, con el modulo acortado. */
  const pixelesPorCelda = (factor: number) => {
    // Si todavia no se abrio ningun bloque, `s` es null: la resolucion sale
    // igual del plan del parque entero, que usa la misma altura y camara. Sin
    // esto la columna mostraba 0.0 pixeles por celda, que no es "todavia no se
    // calculo" sino "no se ve nada" — y son cosas bien distintas.
    const gsd = s?.gsdCm ?? entero?.stats.gsdCm ?? 0;
    if (gsd <= 0) return 0;
    const ladoLargo = (celdaM * 100) / gsd;
    return ladoLargo * ladoLargo * factor;
  };
  const celdaEnLaVentana = pixelesPorCelda(
    horasBuenas.length
      ? Math.max(...horasBuenas.map((h) => h.factorDeAcortamiento))
      : (mejorHora?.factorDeAcortamiento ?? 1),
  );


  /**
   * Un numero que NO puede quedar en cualquier valor.
   *
   * `min` y `max` en un `<input type=number>` son decoracion: el navegador no
   * impide escribir otra cosa y no impide borrar el campo. Borrar la altura
   * daba `Number("") === 0`, y con 0 m de altura la huella de la camara mide
   * centimetros: el planificador salia a generar decenas de miles de lineas y
   * el telefono se colgaba en el medio del campo, sin ningun mensaje.
   *
   * Ahora el valor que usa el plan siempre esta dentro del rango. Lo que se ve
   * mientras se escribe puede estar vacio o a medio tipear — si no, no se puede
   * ni borrar para escribir otro numero — y al salir del campo vuelve al valor
   * bueno, para que nunca quede en pantalla algo distinto de lo que se planifico.
   */
  const num = (k: keyof typeof o, label: string, min: number, max: number, step: number, help?: string) => (
    <div className="field" key={k}>
      <label htmlFor={`f-${k}`}>{label}</label>
      <input
        id={`f-${k}`} type="number" min={min} max={max} step={step}
        value={crudos[k] ?? String(o[k] as number)}
        onChange={(e) => {
          const texto = e.target.value;
          setCrudos((c) => ({ ...c, [k]: texto }));
          const v = Number(texto);
          if (texto.trim() !== "" && Number.isFinite(v)) {
            setO((p) => ({ ...p, [k]: Math.min(max, Math.max(min, v)) }));
          }
        }}
        onBlur={() => setCrudos((c) => { const { [k]: _, ...resto } = c; return resto; })}
      />
      <span className="help">
        {help ? help + " " : ""}
        <span className="muted">Entre {min} y {max}.</span>
      </span>
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

        {/*
          Lo que hay que saber ANTES de comprar, no despues.
          ===================================================================
          Esta casilla decide la mitad de las horas de vuelo del parque, y no
          decia en ningun lado que el RTK NO viene con el dron: hay que
          conseguirlo aparte, de una de dos formas, y una de las dos no anda sin
          señal de celular. Alguien que planifica con la casilla tildada, compra
          el dron y llega al parque sin torre y sin señal, se entera ahi.

          Y la otra mitad, que tambien hay que decir: sin RTK NO se pierde el
          trabajo. La direccion de cada modulo sale de las picas del
          relevamiento, no del GPS del dron. Se tarda el doble; no se pierde.
        */}
        {o.rtk && (
          <div className="note">
            <p>
              <strong>El RTK no viene con el dron.</strong> En el Matrice 4T hay que conseguirlo
              aparte, y hay dos caminos:
            </p>
            <ul>
              <li>
                <strong>Estacion base propia</strong> (la "torre" o "antena"): un tripode que
                plantas en el parque y le manda las correcciones al dron por radio. Es una compra
                unica y <strong>funciona sin señal de celular</strong>, que en una farm en el medio
                del campo no es un detalle menor.
              </li>
              <li>
                <strong>Red RTK por internet</strong> (NTRIP): no comprás hardware, pagás una
                suscripcion mensual y le das internet al control con un dongle 4G o el celular.{" "}
                <strong>Si en el parque no hay señal, no hay RTK.</strong>
              </li>
            </ul>
            <p className="help">
              Si llegás al parque y el RTK no engancha, destildá esta casilla y volá con 70 %: vas a
              tardar mas o menos el doble, pero el vuelo sirve igual. La app no necesita RTK para
              ubicar los modulos — cada direccion sale de las picas del relevamiento, no del GPS del
              dron. Lo unico que cambia es que la grilla te va a quedar corrida unos metros al
              analizar, y eso se corrige de un arrastre.
            </p>
          </div>
        )}
      </section>

      {/* --------------------------------------------------------------- */}
      <section className="card">
        <h2>A que hora volar</h2>
        <p>
          Los trackers no estan planos: giran de -{TOPE_TRACKER_DEG}° a +{TOPE_TRACKER_DEG}°
          siguiendo al sol. Desde arriba, un modulo inclinado {TOPE_TRACKER_DEG}° se ve un{" "}
          <strong>43 % mas angosto</strong> de lo que es, y la celda se achica igual. Un vuelo que
          a mediodia resuelve una celda, a las siete de la manana no.
        </p>

        <div className="row">
          <label className="inline">
            Dia del vuelo
            <input type="date" value={diaDeVuelo} onChange={(e) => setDiaDeVuelo(e.target.value)} />
          </label>
          <label className="inline">
            Huso del parque (UTC)
            <input
              type="number" min={-12} max={14} step={1} value={huso}
              onChange={(e) => setHuso(Math.max(-12, Math.min(14, Number(e.target.value) || 0)))}
            />
          </label>
        </div>
        <p className="help">
          El huso sale de la longitud del parque, asi que suele estar bien. Corregilo si el lugar
          tiene horario de verano — Queensland no tiene, la mayor parte de Australia si.
        </p>

        {ventana.length === 0 ? (
          <p className="note bad">
            No se pudo calcular el dia. Revisá la fecha.
          </p>
        ) : (
          <>
            <div className="stats">
              <div>
                <b>{mejorHora?.hora ?? "—"}</b>
                <span>la hora mas plana</span>
              </div>
              <div>
                <b>{horasBuenas.length ? `${horasBuenas[0]!.hora}–${horasBuenas[horasBuenas.length - 1]!.hora}` : "—"}</b>
                <span>ventana con los trackers a menos de 25°</span>
              </div>
              <div className={celdaEnLaVentana > 0 && celdaEnLaVentana < PIXELES_POR_CELDA_MINIMO ? "alerta" : ""}>
                <b>{celdaEnLaVentana > 0 ? celdaEnLaVentana.toFixed(1) : "—"}</b>
                <span>pixeles por celda en esa ventana</span>
              </div>
            </div>

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Hora local</th><th>Sol</th><th>Tracker</th>
                    <th>Modulo visto desde arriba</th><th>Pixeles por celda</th>
                  </tr>
                </thead>
                <tbody>
                  {ventana.filter((_, i) => i % 2 === 0).map((h) => {
                    const px = pixelesPorCelda(h.factorDeAcortamiento);
                    return (
                      <tr key={h.hora} className={h.hora === mejorHora?.hora ? "top" : ""}>
                        <td>{h.hora}</td>
                        <td className="num">{h.alturaSolarDeg.toFixed(0)}°</td>
                        <td className="num">{Math.abs(h.anguloDeg).toFixed(0)}° {h.anguloDeg > 0 ? "al este" : h.anguloDeg < 0 ? "al oeste" : ""}</td>
                        <td className="num">{(h.factorDeAcortamiento * 100).toFixed(0)} % de su ancho</td>
                        <td className="num">{px > 0 ? px.toFixed(1) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="help">
              La cuenta es pesimista a proposito: no incluye el <em>backtracking</em>, la maniobra
              con la que los trackers se aplanan de mas al amanecer y al atardecer para no darse
              sombra entre filas. Con backtracking el angulo real es igual o MENOR que este, nunca
              mayor. Y la irradiancia manda igual: la norma pide 600 W/m², que con el sol a menos de
              30° de altura no se alcanza aunque los trackers esten planos.
            </p>
          </>
        )}
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
            <thead>
              <tr>
                <th>Configuracion</th><th>cm/px</th><th>Horas</th>
                <th>Baterias</th><th>Salidas de campo</th>
              </tr>
            </thead>
            <tbody>
              {alternativas.map((a, i) => (
                <tr key={a.nombre} className={i === 0 ? "top" : ""}>
                  <td>{a.nombre}</td>
                  <td className="num">{a.gsdCm.toFixed(1)}</td>
                  <td className="num"><strong>{a.horas.toFixed(1)} h</strong></td>
                  <td className="num">{a.baterias}</td>
                  <td className="num">{a.salidas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/*
          La conclusion en plata, no en horas. Las horas de vuelo son un numero
          abstracto; las salidas de campo son viajes, dias y alojamiento.
        */}
        {alternativas[1] && alternativas[0] && !o.rtk && (
          <p className="note">
            En este parque, pasar de 70 % a 45 % de solape —o sea, volar con RTK— son{" "}
            <strong>{(alternativas[0].horas - alternativas[1].horas).toFixed(1)} horas</strong>,{" "}
            <strong>{alternativas[0].baterias - alternativas[1].baterias} baterias</strong> y{" "}
            <strong>{alternativas[0].salidas - alternativas[1].salidas} salidas de campo</strong>{" "}
            menos. Eso es lo que compra el RTK: no precision, tiempo. Y ojo, que no viene con el
            dron — mirá la nota de la casilla de RTK, mas arriba.
          </p>
        )}
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
            <h3>Llevarlo al dron</h3>
            {perfil ? (
              <p className="help">
                Se exporta para <strong>{perfil.nombre}</strong>, que es el dron de la cámara que
                elegiste arriba. No se elige aparte: si la huella con la que se planificó y el dron
                que vuela no son el mismo, las líneas quedan separadas para una cámara y el archivo
                sale para otra.
                {!perfil.confirmado && ` ${perfil.nota ?? ""}`}
              </p>
            ) : (
              <p className="alert">
                {CAMARAS[camIndex]!.name} no va en ninguno de los drones que esta app sabe escribir
                en WPML, así que no se puede exportar el KMZ. El plan es correcto: bajá el KML o los
                waypoints y armá la misión en Pilot 2 a mano, con esta separación entre líneas.
              </p>
            )}

            <div className="actions">
              <button
                disabled={!perfil}
                onClick={() => {
                  if (!perfil) return;
                  const bytes = toKmz(mission, opts, {
                    nombre: `${stored.profile.name} — ${etiqueta}`,
                    perfil,
                    fecha: new Date(),
                  });
                  descargarBytes(
                    `${stored.profile.id}-${bloqueAbierto ?? "todo"}.kmz`,
                    bytes,
                    "application/vnd.google-earth.kmz",
                  );
                }}
              >
                Exportar KMZ para DJI Pilot 2
              </button>
              <button className="ghost" onClick={() => download(`${stored.profile.id}-${bloqueAbierto ?? "todo"}-vuelo.kml`, toKml(mission, `${stored.profile.name} — ${etiqueta}`), "application/vnd.google-earth.kml+xml")}>
                KML para Google Earth
              </button>
              <button className="ghost" onClick={() => download(`${stored.profile.id}-${bloqueAbierto ?? "todo"}-waypoints.csv`, toWaypointCsv(mission, opts), "text/csv")}>
                Waypoints CSV
              </button>
            </div>

            <div className="warnbox">
              <h3>Antes de copiarlo al controlador</h3>
              <ul>
                {(perfil
                  ? avisosDeKmz(mission, opts, { nombre: etiqueta, perfil, fecha: new Date() })
                  : []
                ).map((a, i) => (<li key={i}>{a}</li>))}
              </ul>
            </div>

            <p className="help">
              El KMZ va derecho a Pilot 2: copialo a la tarjeta del controlador, en{" "}
              <code>DJI/wpmz</code>, y aparece en la lista de misiones. El KML es para mirarlo en
              Google Earth antes de ir. Los disparos salen con el gimbal en −90°, que es lo unico
              que sirve para mapear: inclinado, la coordenada de la foto deja de ser la del panel.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
