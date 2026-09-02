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
  jornadaDeCampo,
  minutosUtiles,
  OPCIONES_POR_DEFECTO,
  planByBlock,
  planByGroup,
  planMission,
  DERIVA_CON_RTK,
  DERIVA_SIN_RTK,
  SOLAPES,
  TERRENOS,
  solapeLateral,
  type TerrenoId,
  toKml,
  toWaypointCsv,
  type MissionOptions,
} from "../mission";
import { avisosDeKmz, PERFILES_DJI, toKmz } from "../wpml";
import { huella, pasoEntreFilas, velocidades } from "../mission";
import { PIXELES_POR_CELDA_MINIMO, CELDA_M } from "../detect";
import { LoQueVeElDron } from "../components/LoQueVeElDron";
import { ZonaQueSeMide } from "../components/ZonaQueSeMide";
import { celdaDelParque, largoDelModulo } from "../vuelo";
import type { StoredFarm } from "../storage";

export function Flight({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [camIndex, setCamIndex] = useState(0);
  const [o, setO] = useState(OPCIONES_POR_DEFECTO);
  /**
   * La velocidad la pone la app salvo que alguien diga lo contrario.
   *
   * Era un 5 m/s escrito a mano que nadie chequeaba contra la camara — y con
   * el Matrice 4T a 50 m el techo real es 4,2, o sea que el valor por defecto
   * ya estaba por encima del limite. Un numero que hay que saber calcular para
   * poder poner bien no es una opcion: es una trampa. Se calcula, y el que
   * sabe lo que hace lo puede desactivar.
   */
  const [velocidadAuto, setVelocidadAuto] = useState(true);
  /**
   * El solape lateral tambien se calcula, por el mismo motivo que la velocidad.
   *
   * Eran dos numeros escritos a mano —45 % con RTK, 70 % sin— y la pregunta que
   * los volteo fue: "si el RTK es ultra preciso, ¿por que no puedo solapar diez
   * por ciento y terminar mucho mas rapido?". El 45 % tenia una razon buena
   * atras, pero la razon no estaba escrita en ningun lado y el numero tampoco
   * salia de ella.
   */
  const [solapeAuto, setSolapeAuto] = useState(true);
  /** Hasta que fraccion del cuadro se acepta medir un modulo. */
  const [fraccionDelCuadro, setFraccionDelCuadro] = useState(0.7);
  const [terreno, setTerreno] = useState<TerrenoId>("plano");
  /** Los numeros finos, escondidos hasta que alguien los pida. */
  const [verNumeros, setVerNumeros] = useState(false);
  /** Lo que se esta tipeando, mientras no sea todavia un numero valido. */
  const [crudos, setCrudos] = useState<Partial<Record<keyof typeof OPCIONES_POR_DEFECTO, string>>>({});
  const [baterias, setBaterias] = useState(4);
  /**
   * Si se cargan las baterias vacias en el campo mientras el dron vuela.
   *
   * Lo levanto el: "puedo estar cargando las baterias que vienen vacias
   * mientras el dron vuela". La app las contaba como de un solo uso —
   * viajes = baterias que gasta el parque / baterias que llevas— y con un
   * cargador en la camioneta eso es falso: las baterias circulan.
   */
  const [cargaEnElCampo, setCargaEnElCampo] = useState(true);
  const [agrupar, setAgrupar] = useState(true);
  /**
   * Los bloques marcados para este vuelo. Varios, los que uno quiera.
   *
   * Antes esto era UN bloque: `bloqueAbierto`, un string o nada, elegido con un
   * radio. Y como el radio se ponia sobre la lista de salidas, lo unico que se
   * podia elegir era un bloque suelto o el paquete entero de los que comparten
   * pasada — un paquete que arma la app, no el que uno mira en el plano. El que
   * planifica ya sabe que va a mandar tres bloques que estan pegados y quiere
   * armar ESE vuelo; con un radio no tenia como decirlo.
   *
   * Arranca vacio a proposito: no hay un bloque "por defecto" que uno quiera
   * volar, y con cero marcados no hay nada que exportar.
   */
  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(new Set());
  /**
   * La aeronave sale de la camara elegida, no de una segunda lista.
   *
   * Antes eran dos elecciones sueltas y se podian contradecir: planificar con
   * la huella del Matrice 4T y exportar el archivo del Mavic 3T. El KMZ salia
   * sin quejarse, y el error aparecia recien en el campo — con las lineas
   * separadas para una camara y el dron llevando otra.
   */
  const perfil = PERFILES_DJI.find((p) => p.id === CAMARAS[camIndex]!.djiId);

  const camara = CAMARAS[camIndex]!;

  /*
    El solape que hace falta, calculado. Va antes del plan porque, en
    automatico, es el que entra al plan.
  */
  const desnivelM = (TERRENOS.find((t) => t.id === terreno) ?? TERRENOS[0]).desnivelM;
  const solape = solapeLateral({
    camera: camara,
    altitudeM: o.altitudeM,
    fraccionDelCuadro,
    derivaM: o.rtk ? DERIVA_CON_RTK : DERIVA_SIN_RTK,
    desnivelM,
  });
  const solapeElegido = solapeAuto ? Math.round(solape.solape * 100) / 100 : o.sideOverlap;

  /*
    La velocidad que aguanta esta camara a esta altura.

    Se calcula ANTES de armar el plan, porque si esta en automatico es la que
    entra al plan: si se calculara despues, el plan diria una cosa y el aviso
    otra.
  */
  const techo = velocidades(camara, o.altitudeM, o.frontOverlap, o.speedMps);
  // Redondeada para abajo a medio metro por segundo: un numero redondo que se
  // puede tipear en el control del dron, y del lado seguro del limite.
  const velocidadElegida = velocidadAuto
    ? Math.max(1, Math.floor(techo.maximaMps * 2) / 2)
    : o.speedMps;

  const opts: MissionOptions = { camera: camara, ...o, speedMps: velocidadElegida, sideOverlap: solapeElegido };

  /*
    Lo que hace falta para DIBUJAR, que no es lo mismo que para volar.

    Sale de la camara y la altura nomas. Estaba tomado de las estadisticas del
    plan y eso ataba la figura a tener bloques marcados: uno movia la altura
    para ver que pasa, y no pasaba nada porque todavia no habia elegido que
    volar. La pregunta "¿voy a ver la celda?" no depende de que bloque vueles.
  */
  const anchoDeHuella = huella(o.altitudeM, camara.hfovDeg);
  const separacionDeHuella = Math.max(0.5, anchoDeHuella * (1 - o.sideOverlap));
  const gsdCmDeHuella = (anchoDeHuella * 100) / camara.imageW;

  const farm = useMemo<CompiledFarm | null>(() => {
    try { return compileFarm(stored.profile, stored.rows); } catch { return null; }
  }, [stored]);

  /** El paso real entre filas del parque, para dibujar las pasadas a escala. */
  const pasoDeFila = useMemo(() => (farm ? pasoEntreFilas(farm.rows) : null), [farm]);

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

  // Como quedaria organizado el parque entero, para las cuentas de arriba.
  const organizacion = agrupar ? agrupado : plan;

  /*
    Cuanto se vuela en un dia, y que lo limita.

    La ventana util del sol ya estaba calculada dos tarjetas mas arriba y no la
    usaba nadie para planificar el trabajo: las "salidas de campo" salian de
    dividir baterias por baterias. Son los dos techos de la misma jornada y hay
    que mirarlos juntos, porque el que manda casi siempre es el sol.
  */
  const jornada = jornadaDeCampo({
    camera: camara,
    baterias,
    cargaEnElCampo,
    minutosDeSol: horasBuenas.length * 30,   // la ventana viene en medias horas
    minutosDelParque: organizacion.totalMinutos,
  });
  const vuelos = agrupar ? agrupado.grupos.length : plan.bloques.length;

  /**
   * Con quien comparte pasada cada bloque, segun el agrupamiento automatico.
   *
   * El agrupamiento deja de ser una jaula y pasa a ser un CONSEJO: se muestra
   * al lado de cada bloque y hay un boton para sumar los companeros de una. El
   * dato sigue valiendo —dos bloques que ocupan la misma franja se vuelan dos
   * veces si van por separado— pero ahora avisa en vez de decidir.
   */
  const companeros = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of agrupado.grupos) {
      for (const b of g.bloques) m.set(b, g.bloques.filter((x) => x !== b));
    }
    return m;
  }, [agrupado]);

  const marcados = plan.bloques.filter((b) => elegidos.has(b.block));
  const filasElegidas = marcados.reduce((n, b) => n + b.filas, 0);
  const todosMarcados = plan.bloques.length > 0 && marcados.length === plan.bloques.length;

  /**
   * Los companeros de pasada de lo marcado que todavia no estan marcados.
   *
   * Sin el Set, un bloque que es companero de dos marcados aparecia dos veces y
   * el boton ofrecia "sumar 3" cuando eran 2.
   */
  const sueltos = [...new Set(
    marcados.flatMap((b) => companeros.get(b.block) ?? []).filter((b) => !elegidos.has(b)),
  )];

  const marcar = (block: string, si: boolean) =>
    setElegidos((prev) => {
      const s2 = new Set(prev);
      if (si) s2.add(block); else s2.delete(block);
      return s2;
    });

  /**
   * La mision del conjunto marcado, planificada de una.
   *
   * No es la suma de las misiones de cada bloque: se planifica sobre TODAS las
   * filas juntas, que es lo unico que evita repetir una pasada sobre dos
   * bloques que se pisan. Y con el parque entero marcado da exactamente el
   * mismo plan que daba el viejo modo "todo el parque", asi que ese modo dejo
   * de tener sentido como casilla aparte: es el boton "seleccionar todo".
   */
  const filas = useMemo(
    () => stored.rows.filter((r) => elegidos.has(r.block)),
    [stored.rows, elegidos],
  );
  const mission = useMemo(
    () => (filas.length ? planMission(filas, stored.profile, opts) : null),
    [filas, stored.profile, opts.camera, o],
  );

  const etiqueta = todosMarcados
    ? "todo el parque"
    : marcados.length === 0
      ? "nada elegido todavia"
      : `bloque${marcados.length > 1 ? "s" : ""} ${marcados.map((b) => b.block).join(", ")}`;
  // Para el nombre del archivo: sin comas ni espacios, que van a un disco.
  const slug = todosMarcados
    ? "todo"
    : marcados.map((b) => b.block).join("+").replace(/[^\w+-]/g, "") || "sin-bloques";

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
        // Lo que de verdad se paga son los DIAS, no las horas de vuelo: un dia
        // de campo es un viaje, un jornal y a veces alojamiento. Y el dia sale
        // de las horas de vuelo contra lo que se puede volar por jornada — que
        // casi siempre lo manda el sol, no las baterias.
        dias: jornadaDeCampo({
          camera: camara, baterias, cargaEnElCampo,
          minutosDeSol: horasBuenas.length * 30,
          minutosDelParque: p.totalMinutos,
        }).jornadas,
        baterias: p.totalBaterias,
        gsdCm: m?.stats.gsdCm ?? 0,
      };
    });
    // `agrupar` estaba usado adentro y faltaba aca: destildar la casilla no
    // recalculaba la tabla, asi que seguia mostrando las horas del otro modo.
  }, [stored.rows, stored.profile, opts.camera, o, baterias, agrupar, cargaEnElCampo, camara, horasBuenas.length]);

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

      {/*
        Una sola tarjeta, y en castellano.
        ====================================================================
        Habia dos —"La camara" y "El vuelo"— y entre las dos pedian: sensor,
        altura, velocidad, solape lateral, solape frontal y margen. Seis
        numeros, cuatro de los cuales solo significan algo si hiciste
        fotogrametria. El que va a volar esto no tiene por que haberla hecho:
        "solape frontal 0.7" no le dice a nadie si el vuelo va a servir.

        Ahora se eligen DOS cosas —el dron y la altura— y todo lo demas se
        calcula y se DIBUJA. Los seis numeros siguen estando, abajo, para el
        dia que alguien quiera discutirlos.
      */}
      <section className="card">
        <h2>Cómo vas a volar</h2>

        <div className="field">
          <label htmlFor="f-cam">Tu dron</label>
          <select id="f-cam" value={camIndex} onChange={(e) => setCamIndex(Number(e.target.value))}>
            {CAMARAS.map((c, i) => (<option key={c.name} value={i}>{c.name}</option>))}
          </select>
          <span className="help">
            Se planifica con la <strong>térmica</strong>, no con la cámara visible. La térmica ve
            una franja mucho más angosta: un vuelo planificado con la visible deja huecos en la
            térmica, que es la que importa.
          </span>
        </div>

        <div className="field">
          <label htmlFor="f-alt">Altura sobre el terreno: <strong>{o.altitudeM} m</strong></label>
          <input
            id="f-alt" type="range" min={20} max={120} step={1} value={o.altitudeM}
            onChange={(e) => setO((p) => ({ ...p, altitudeM: Number(e.target.value) }))}
          />
          <span className="help">
            Más bajo ves más detalle y tardás más, porque la franja de cada pasada es más angosta.
            Movelo y mirá las dos figuras de abajo: son lo que vas a tener.
          </span>
        </div>

        {/*
          La velocidad, que hasta ahora era un numero suelto que nadie miraba.

          No se pregunta: se calcula, y se dice de donde sale. Poner un numero
          aca exige saber el intervalo de disparo de la camara y el tiempo de
          integracion del microbolometro — o sea, exige ser la persona que ya
          no necesita esta pantalla.
        */}
        <label className="check">
          <input
            type="checkbox" checked={velocidadAuto}
            onChange={(e) => setVelocidadAuto(e.target.checked)}
          />
          <span>
            Que la app ponga la velocidad
            <em>
              La más rápida que esta cámara aguanta a esta altura. Ahora mismo son{" "}
              <strong>{velocidadElegida} m/s</strong>, y el techo lo pone{" "}
              {techo.manda === "obturador"
                ? `el disparo: el plan pide una foto cada ${techo.disparoCadaM.toFixed(1)} m y esta cámara no baja de ${techo.intervaloMinimoS} s entre foto y foto.`
                : "el barrido de la imagen: una térmica no tiene obturador, cada píxel tarda unos milisegundos en leerse y mientras tanto el dron se movió. Pasado un píxel de arrastre se empieza a aplanar el pico de la celda caliente, que es justo lo que se mide."}
            </em>
          </span>
        </label>

        {!velocidadAuto && (
          <div className="field">
            <label htmlFor="f-vel">
              Velocidad: <strong>{o.speedMps} m/s</strong>{" "}
              {o.speedMps > techo.maximaMps && <span className="mal">— pasada de {techo.maximaMps.toFixed(1)}</span>}
            </label>
            <input
              id="f-vel" type="range" min={1} max={15} step={0.5} value={o.speedMps}
              onChange={(e) => setO((p) => ({ ...p, speedMps: Number(e.target.value) }))}
            />
            <span className="help">
              El máximo que aguanta esta cámara a {o.altitudeM} m es{" "}
              <strong>{techo.maximaMps.toFixed(1)} m/s</strong>. Más rápido que eso{" "}
              {techo.manda === "obturador"
                ? "el dron no llega a sacar todas las fotos y quedan franjas sin cubrir."
                : "la imagen se barre y el punto caliente se aplana."}
            </span>
          </div>
        )}

        {/*
          La cobertura, que era dos numeros escritos a mano.
          ===================================================================
          "¿Por que con el RTK se tiene que solapar tanto la foto, si se supone
          que es ultra preciso? ¿Por que no un diez por ciento y ahi seria mucho
          mas rapido todo?"

          Porque en esta app el solape no compra COBERTURA, compra MEDICION: de
          todas las fotos donde sale un modulo, el motor se queda con la que lo
          tiene mas cerca del centro del cuadro, porque en el borde la termica
          miente varios grados y los umbrales son de dos o tres. Con pasadas
          separadas `ancho * (1 - solape)`, el modulo peor ubicado queda a
          `(1 - solape)` del centro hacia el borde: con 10 % de solape hay
          modulos medidos al 90 % del camino al borde.

          Asi que la pregunta no es cuanto solapar: es hasta donde se acepta
          medir. Eso se elige aca, y el solape sale de ahi mas lo que obligan la
          deriva del dron y el terreno.
        */}
        <label className="check">
          <input
            type="checkbox" checked={o.rtk}
            onChange={(e) => setO((p) => ({ ...p, rtk: e.target.checked }))}
          />
          <span>
            El dron tiene RTK
            <em>
              Clava la posicion del dron en centimetros, asi que el solape no
              tiene que absorber que se corra de la linea. Es lo que mas mueve las horas.
            </em>
          </span>
        </label>

        <div className="field">
          <label htmlFor="f-terreno">¿Cómo es el terreno del parque?</label>
          <select
            id="f-terreno" value={terreno}
            onChange={(e) => setTerreno(e.target.value as TerrenoId)}
          >
            {TERRENOS.map((t) => (<option key={t.id} value={t.id}>{t.nombre}</option>))}
          </select>
          <span className="help">
            El dron vuela a una altura sobre el punto de despegue, no sobre el suelo: donde el
            terreno sube {desnivelM} m estás volando {desnivelM} m más bajo, y la franja de esa
            pasada se angosta sola. Es lo único de acá que el RTK no arregla.
          </span>
        </div>

        <label className="check">
          <input
            type="checkbox" checked={solapeAuto}
            onChange={(e) => setSolapeAuto(e.target.checked)}
          />
          <span>
            Que la app calcule cuánto solapar
            <em>
              Ahora mismo da <strong>{Math.round(solapeElegido * 100)} %</strong>: {" "}
              {Math.round(solape.porCalidad * 100)} % para que ningún módulo se mida más allá del{" "}
              {Math.round(fraccionDelCuadro * 100)} % del cuadro,{" "}
              {Math.round(solape.porDeriva * 100)} % por lo que se corre el dron de la línea, y{" "}
              {Math.round(solape.porTerreno * 100)} % por el terreno.{" "}
              {solape.manda === "calidad"
                ? "Lo que más pesa es la regla de medición: para ir más rápido hay que aceptar medir más cerca del borde."
                : solape.manda === "deriva"
                  ? "Lo que más pesa es que el dron se corre de la línea: acá el RTK te ahorra horas de verdad."
                  : "Lo que más pesa es el terreno, y eso no lo arregla el RTK: volando más alto pesa menos."}
            </em>
          </span>
        </label>

        {solapeAuto && (
          <div className="field">
            {/*
              Esto decia "no medir ningun modulo mas alla del 65 % del cuadro" y
              la respuesta fue "esto no entiendo que es". Con razon: es una idea
              espacial escrita en palabras, y encima en mi idioma. Ahora se
              dibuja, y el texto pasa a explicar POR QUE, que es lo unico que un
              dibujo no puede decir solo.
            */}
            <label htmlFor="f-cuadro">Qué parte de cada foto se usa para medir</label>
            <ZonaQueSeMide fraccionDelCuadro={fraccionDelCuadro} />
            <input
              id="f-cuadro" type="range" min={0.5} max={0.95} step={0.05} value={fraccionDelCuadro}
              onChange={(e) => setFraccionDelCuadro(Number(e.target.value))}
            />
            <span className="help">
              Los costados de la foto se tiran. Ahí la térmica <strong>miente</strong>: el barril de
              la lente irradia sobre las esquinas y el vidrio del panel visto de costado refleja el
              cielo, así que un módulo medido ahí puede dar varios grados de diferencia contra sus
              vecinos — y esa diferencia no es un defecto, es el borde de la foto. Con umbrales de
              2 o 3 °C, eso son hallazgos falsos.
              {" "}<strong>Los módulos tachados no se pierden</strong>: los levanta la pasada de al
              lado, donde caen en el medio. Para eso es el solape. Correr el control a la derecha
              usa más de cada foto y el vuelo tarda menos, pero se mide más cerca del borde.
            </span>
          </div>
        )}

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
              Si llegás al parque y el RTK no engancha, destildá esta casilla: la app recalcula el
              solape sola y te dice cuánto tarda así. Vas a tardar bastante más, pero el vuelo sirve
              igual. La app no necesita RTK para
              ubicar los modulos — cada direccion sale de las picas del relevamiento, no del GPS del
              dron. Lo unico que cambia es que la grilla te va a quedar corrida unos metros al
              analizar, y eso se corrige de un arrastre.
            </p>
          </div>
        )}
      </section>

      {/*
        Lo que el vuelo va a ver, dibujado.

        Es la tarjeta que contesta las dos preguntas que de verdad se hacen
        antes de despegar, y las contesta con figuras a escala en vez de con
        centimetros por pixel.
      */}
      <section className="card">
          <h2>Qué vas a poder ver con este vuelo</h2>
          <LoQueVeElDron
            gsdCm={gsdCmDeHuella}
            celdaM={celdaDelParque(stored)}
            moduloAnchoM={stored.profile.module.widthMm / 1000}
            moduloLargoM={largoDelModulo(stored)}
            huellaAnchoM={anchoDeHuella}
            separacionM={separacionDeHuella}
            pasoDeFilaM={pasoDeFila ?? 5}
          />

          <button className="link" onClick={() => setVerNumeros((v) => !v)}>
            {verNumeros ? "ocultar los números" : "ver los números"}
          </button>

          {verNumeros && (
            <>
              <p className="help">
                Los mismos datos, para el día que haya que discutirlos. El arrastre se calcula con
                12 ms de tiempo de integración, que es el número conservador de un microbolómetro
                sin refrigerar — si medís el de tu cámara y es menor, se puede volar más rápido.
              </p>
              <div className="grid-2">
                {num("sideOverlap", "Solape lateral (0 a 1)", 0.3, 0.95, 0.05, "Entre lineas vecinas.")}
                {num("frontOverlap", "Solape frontal (0 a 1)", 0.3, 0.95, 0.05, "Entre fotos de la misma linea.")}
                {num("marginM", "Margen alrededor (m)", 0, 60, 5)}
              </div>
              <div className="stats">
                <div><b>{gsdCmDeHuella.toFixed(1)}</b><span>cm por pixel</span></div>
                <div><b>{techo.disparoCadaM.toFixed(1)} m</b><span>entre foto y foto</span></div>
                <div><b>{techo.segundosEntreFotos.toFixed(1)} s</b><span>a esta velocidad</span></div>
                <div><b>{techo.arrastrePx.toFixed(1)}</b><span>pixeles de arrastre</span></div>
                <div><b>{techo.porObturadorMps.toFixed(1)}</b><span>m/s techo por obturador</span></div>
                <div><b>{techo.porArrastreMps.toFixed(1)}</b><span>m/s techo por arrastre</span></div>
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
            </>
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
          <div><b>{vuelos}</b><span>vuelos</span></div>
          <div><b>{(organizacion.totalMinutos / 60).toFixed(1)} h</b><span>de vuelo en total</span></div>
          <div><b>{(jornada.minutosPorJornada / 60).toFixed(1)} h</b><span>que se vuelan por dia</span></div>
          <div className={jornada.jornadas > 1 ? "alerta" : ""}>
            <b>{jornada.jornadas}</b>
            <span>{jornada.jornadas === 1 ? "dia de campo" : "dias de campo"}</span>
          </div>
        </div>

        {/*
          Lo que la persona contesta, y la cuenta al lado.
          ==================================================================
          Antes esto era una division: baterias que gasta el parque sobre
          baterias que llevas. Contaba las baterias como de un solo uso, y con
          un cargador en la camioneta eso es falso — las baterias CIRCULAN.

          Y aun con el cargador, el techo que manda casi siempre es otro: el
          sol. La norma pide 600 W/m² y los trackers tienen que estar casi
          planos, asi que la ventana util son unas pocas horas al mediodia.
          Tener bateria para seis horas no sirve si el sol da tres y media.

          Por eso los dos numeros van juntos y la app dice CUAL manda: es lo
          unico que cambia lo que hay que hacer.
        */}
        <div className="field pregunta">
          <label htmlFor="f-bat">¿Cuántas baterías tenés?</label>
          <input
            id="f-bat" type="number" min={1} max={20} value={baterias}
            onChange={(e) => setBaterias(Math.max(1, Number(e.target.value) || 1))}
          />
          <label className="check">
            <input
              type="checkbox" checked={cargaEnElCampo}
              onChange={(e) => setCargaEnElCampo(e.target.checked)}
            />
            <span>Las cargo en el campo mientras el dron vuela</span>
          </label>

          <span className="help">
            Cada batería da <strong>{jornada.minutosPorBateria} minutos</strong> de vuelo útil, ya
            descontados el 25 % de reserva y los 4 minutos de ir hasta el bloque y volver.{" "}
            {cargaEnElCampo && !jornada.elCargadorAlcanza && (
              <>
                El cargador repone más despacio de lo que el dron gasta —{" "}
                {camara.minutosDeCarga} minutos por batería contra {jornada.minutosPorBateria} de
                vuelo — así que las baterías no son infinitas: son un colchón que se vacía despacio.{" "}
              </>
            )}
            {cargaEnElCampo && jornada.elCargadorAlcanza && (
              <>El cargador repone más rápido de lo que el dron gasta, así que las baterías no te
              van a frenar nunca.{" "}</>
            )}

            {jornada.limita === "sol" ? (
              <>
                <strong>Lo que te limita es el sol, no las baterías.</strong> La ventana con los
                trackers casi planos y el sol arriba de 30° son{" "}
                <strong>{(jornada.minutosDeSol / 60).toFixed(1)} h</strong> ese día
                {Number.isFinite(jornada.minutosPorBaterias) && (
                  <> y con {baterias} baterías te alcanza para{" "}
                    {(jornada.minutosPorBaterias / 60).toFixed(1)} h</>
                )}
                . Conseguir más baterías no te ahorra ningún día.
              </>
            ) : (
              <>
                <strong>Lo que te limita son las baterías.</strong> El sol te da{" "}
                <strong>{(jornada.minutosDeSol / 60).toFixed(1)} h</strong> útiles ese día y con{" "}
                {baterias} solo llegás a{" "}
                <strong>{(jornada.minutosPorBaterias / 60).toFixed(1)} h</strong>: estás dejando
                pasar sol bueno.{" "}
                {(() => {
                  const conMas = jornadaDeCampo({
                    camera: camara, baterias: baterias + 2, cargaEnElCampo,
                    minutosDeSol: jornada.minutosDeSol,
                    minutosDelParque: organizacion.totalMinutos,
                  });
                  return conMas.jornadas < jornada.jornadas
                    ? <>Con {baterias + 2} baterías el parque baja a{" "}
                        <strong>{conMas.jornadas} {conMas.jornadas === 1 ? "día" : "días"}</strong>.</>
                    : <>Con {baterias + 2} baterías seguirías en {jornada.jornadas}{" "}
                        {jornada.jornadas === 1 ? "día" : "días"}.</>;
                })()}
              </>
            )}
          </span>
        </div>

        <label className="check">
          <input
            type="checkbox" checked={agrupar}
            onChange={(e) => setAgrupar(e.target.checked)}
          />
          <span>
            Contar el parque juntando los bloques que comparten pasada
            <em>
              Los bloques de una planta no son rectangulos prolijos: se escalonan y se meten unos
              entre otros. Dos que ocupan la misma franja repiten las mismas pasadas si se vuelan
              por separado. Esta casilla cambia las cuentas de arriba; lo que vas a volar de verdad
              lo elegis vos en la tabla de abajo.
            </em>
          </span>
        </label>

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
                <th>Cargas de bateria</th><th>Dias de campo</th>
              </tr>
            </thead>
            <tbody>
              {alternativas.map((a, i) => (
                <tr key={a.nombre} className={i === 0 ? "top" : ""}>
                  <td>{a.nombre}</td>
                  <td className="num">{a.gsdCm.toFixed(1)}</td>
                  <td className="num"><strong>{a.horas.toFixed(1)} h</strong></td>
                  <td className="num">{a.baterias}</td>
                  <td className="num">{a.dias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/*
          La conclusion en plata, no en horas. Las horas de vuelo son un numero
          abstracto; los dias de campo son viajes, jornales y a veces alojamiento.
        */}
        {alternativas[1] && alternativas[0] && !o.rtk && (
          <p className="note">
            En este parque, pasar de 70 % a 45 % de solape —o sea, volar con RTK— son{" "}
            <strong>{(alternativas[0].horas - alternativas[1].horas).toFixed(1)} horas</strong>,{" "}
            <strong>{alternativas[0].baterias - alternativas[1].baterias} baterias</strong> y{" "}
            <strong>{alternativas[0].dias - alternativas[1].dias} dias de campo</strong>{" "}
            menos. Eso es lo que compra el RTK: no precision, tiempo. Y ojo, que no viene con el
            dron — mirá la nota de la casilla de RTK, mas arriba.
          </p>
        )}
      </section>

      {/*
        Que bloques entran en ESTE vuelo.
        =====================================================================
        Esta tabla tenia un radio: un bloque, o el paquete de los que comparten
        pasada, y nada mas. El que planifica mira el plano, ve tres bloques
        pegados y quiere mandar esos tres — no el bloque solo ni el paquete que
        arma la app. Ahora se marcan los que uno quiera y la mision se arma
        sobre el conjunto.

        Los numeros de cada renglon son los de volar ESE bloque solo. La suma
        de los renglones NO es el vuelo del conjunto y no se muestra como si lo
        fuera: dos bloques que se pisan comparten pasadas, asi que el conjunto
        sale mas corto que la suma. El numero del conjunto es el de la tarjeta
        de abajo, que sale de planificar todas las filas juntas.
      */}
      <section className="card">
        <h2>Que bloques vas a volar</h2>
        <p className="help">
          Marcá los que quieras. Si elegis bloques que no estan pegados, el vuelo no cruza el campo
          del medio: las pasadas se parten en tramos y el dron termina un bloque antes de arrancar
          el otro.
        </p>

        <div className="actions">
          <button
            className="ghost"
            disabled={todosMarcados}
            onClick={() => setElegidos(new Set(plan.bloques.map((b) => b.block)))}
          >
            Seleccionar todo
          </button>
          <button className="ghost" disabled={marcados.length === 0} onClick={() => setElegidos(new Set())}>
            Limpiar
          </button>
          <button
            className="ghost"
            disabled={sueltos.length === 0}
            onClick={() => setElegidos((prev) => new Set([...prev, ...sueltos]))}
          >
            Sumar los que comparten pasada ({sueltos.length})
          </button>
        </div>

        <div className="stats">
          <div><b>{marcados.length}</b><span>bloques marcados</span></div>
          <div><b>{filasElegidas}</b><span>filas</span></div>
          <div><b>{mission ? mission.stats.lineas : "—"}</b><span>pasadas del vuelo</span></div>
          <div><b>{mission ? mission.stats.minutos.toFixed(0) : "—"}</b><span>minutos</span></div>
        </div>

        {sueltos.length > 0 && (
          <p className="note">
            Lo que marcaste comparte pasada con {sueltos.join(", ")}. Volandolos aparte
            el dron repite esas pasadas dos veces.
          </p>
        )}

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th></th><th>Bloque</th><th>Filas</th><th>Pasadas</th><th>Fotos</th>
                <th>Minutos</th><th>Cargas de bateria</th><th>Comparte pasada con</th>
              </tr>
            </thead>
            <tbody>
              {plan.bloques.map((b) => (
                <tr key={b.block} className={elegidos.has(b.block) ? "top" : ""}>
                  <td>
                    <input
                      type="checkbox" checked={elegidos.has(b.block)}
                      onChange={(e) => marcar(b.block, e.target.checked)}
                      aria-label={`Bloque ${b.block}`}
                    />
                  </td>
                  <td><code>{b.block}</code></td>
                  <td>{b.filas}</td>
                  <td>{b.mission.stats.lineas}</td>
                  <td>{b.mission.stats.fotos}</td>
                  <td>{b.mission.stats.minutos.toFixed(0)}</td>
                  <td>{b.baterias}</td>
                  <td>{(companeros.get(b.block) ?? []).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="help">
          Cada renglon es lo que cuesta volar ese bloque SOLO. El conjunto sale mas corto que la
          suma cuando los bloques se pisan, porque comparten pasadas: el numero que vale es el de
          la tarjeta de abajo.
        </p>
      </section>

      <section className="card">
        <h2>Como queda — {etiqueta}</h2>
        {!(s && mission) ? (
          <p className="note">
            Todavia no marcaste ningun bloque. Elegi al menos uno arriba para ver la ruta, los
            minutos y poder exportarla.
          </p>
        ) : (
          <>
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
                de ancho, y el vuelo entra en {Math.max(1, Math.ceil(s.minutos / jornada.minutosPorBateria))} bateria(s).
              </p>
            )}
          </>
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

        {/*
          Con cero bloques marcados no hay mision, y los botones quedan apagados
          en vez de desaparecer. Antes la tarjeta entera no se dibujaba hasta
          elegir algo: quedaba una pantalla que terminaba en la nada y no decia
          que faltaba. Apagados se ve que el paso existe y que falta marcar.
        */}
        <div className="actions">
          <button
            disabled={!perfil || !mission}
            onClick={() => {
              if (!perfil || !mission) return;
              const bytes = toKmz(mission, opts, {
                nombre: `${stored.profile.name} — ${etiqueta}`,
                perfil,
                fecha: new Date(),
              });
              descargarBytes(
                `${stored.profile.id}-${slug}.kmz`,
                bytes,
                "application/vnd.google-earth.kmz",
              );
            }}
          >
            Exportar KMZ para DJI Pilot 2
          </button>
          <button
            className="ghost" disabled={!mission}
            onClick={() => mission && download(`${stored.profile.id}-${slug}-vuelo.kml`, toKml(mission, `${stored.profile.name} — ${etiqueta}`), "application/vnd.google-earth.kml+xml")}
          >
            KML para Google Earth
          </button>
          <button
            className="ghost" disabled={!mission}
            onClick={() => mission && download(`${stored.profile.id}-${slug}-waypoints.csv`, toWaypointCsv(mission, opts), "text/csv")}
          >
            Waypoints CSV
          </button>
        </div>

        {mission && (
          <div className="warnbox">
            <h3>Antes de copiarlo al controlador</h3>
            <ul>
              {(perfil
                ? avisosDeKmz(mission, opts, { nombre: etiqueta, perfil, fecha: new Date() })
                : []
              ).map((a, i) => (<li key={i}>{a}</li>))}
            </ul>
          </div>
        )}

        <p className="help">
          El KMZ va derecho a Pilot 2: copialo a la tarjeta del controlador, en{" "}
          <code>DJI/wpmz</code>, y aparece en la lista de misiones. El KML es para mirarlo en
          Google Earth antes de ir. Los disparos salen con el gimbal en −90°, que es lo unico
          que sirve para mapear: inclinado, la coordenada de la foto deja de ser la del panel.
        </p>
      </section>
    </div>
  );
}
