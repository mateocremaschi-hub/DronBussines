/**
 * Modo campo: coordenada -> donde esta el panel.
 *
 * Regla que atraviesa toda la pantalla: nunca una sola respuesta. Sin RTK el
 * GPS tiene entre 2 y 5 m de error, o sea entre 2 y 4 modulos. La lista de
 * vecinos no es un extra — es lo que el tecnico usa para confirmar contra la
 * foto termica.
 */

import { useEffect, useMemo, useState } from "react";
import { compileFarm, formatAddress, locate, parseCoordinate } from "@locator";
import type { CompiledFarm, LocateResult } from "@locator";
import { checkFromResult, resolverSentidoPorGeometria, summarize, toCalibration } from "../checks";
import { veredictoDeOffset } from "../solveoffset";
import { calidadDeCoordenada, comoArreglarlo } from "../gpsquality";
import { diagnosticoDeReglas, pareceEspejado, voltearLadoDelBloque } from "../diagnostico";
import { saveFarm, type StoredFarm } from "../storage";

/** Por debajo de esta precision ya sirve para contar modulos. */
const SUFICIENTE_M = 8;
/** Cuanto se espera a que entre el satelite antes de usar lo que haya. */
const ESPERA_MS = 20000;

export function Locate({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [text, setText] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  /** La mejor precision conseguida mientras el GPS todavia esta convergiendo. */
  const [buscando, setBuscando] = useState<number | null>(null);
  const [sentido, setSentido] = useState<string | null>(null);
  const [result, setResult] = useState<LocateResult | null>(null);
  const [coord, setCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [checks, setChecks] = useState(stored.checks ?? []);
  /**
   * El parque VIVO de esta pantalla.
   *
   * `stored` es la foto que le paso la pantalla de Parques al abrir esta, y no
   * se refresca nunca. Todo lo que se guardaba aca partia de esa foto, asi que
   * resolver el sentido de todo el parque y despues registrar un conteo
   * revertia lo primero en silencio: el segundo guardado escribia las filas
   * viejas. Y el mapa compilado tampoco se rehacia, asi que el mensaje decia
   * "N filas resueltas" mientras el proximo Localizar usaba las de antes.
   */
  const [parque, setParque] = useState(stored);
  const [contado, setContado] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [registrado, setRegistrado] = useState<"match" | "mismatch" | null>(null);

  const farm = useMemo<CompiledFarm | null>(() => {
    try {
      return compileFarm(parque.profile, parque.rows);
    } catch {
      return null;
    }
  }, [parque]);

  useEffect(() => {
    setParque(stored);
    setResult(null); setError(null); setChecks(stored.checks ?? []);
  }, [stored]);

  /** Guarda y deja la pantalla mirando lo que acaba de guardar. */
  async function guardar(siguiente: typeof stored) {
    await saveFarm(siguiente);
    setParque(siguiente);
    setChecks(siguiente.checks ?? []);
  }

  function run(input: string, acc: number | null) {
    if (!farm) return;
    setError(null);
    setRegistrado(null);
    setContado("");
    try {
      const coords = parseCoordinate(input);
      setCoord(coords);
      setResult(locate(acc ? { ...coords, accuracyM: acc } : coords, farm));
    } catch (e) {
      setResult(null);
      setCoord(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Guarda lo que se conto a mano.
   *
   * Se guarda tambien cuando NO coincide, y eso es a proposito: un choque sin
   * explicar es justamente el dato que evita que el parque figure como
   * verificado y que alguien le mande un informe a un cliente con eso adentro.
   */
  /**
   * Aplica el arreglo que salio del diagnostico.
   *
   * Se borran los desacuerdos de ese bloque a proposito: quedaron explicados
   * por el lado que estaba al reves y dejarlos ahi haria que el parque figure
   * en parcial para siempre por un problema que ya no existe. Los conteos que
   * coincidian se conservan — esos siguen valiendo.
   */
  /**
   * Resolver el sentido del conteo de TODO el parque, por geometria.
   *
   * Es lo que corresponde en vez de dar vuelta un bloque a la vez: la punta que
   * da a la calle se mide, no se declara, asi que sale igual en los 36 bloques
   * sin caminar ninguno. Dar vuelta bloque por bloque queda para el caso raro
   * en que la geometria no alcance.
   */
  async function resolverSentido() {
    setRegistrando(true);
    const r = resolverSentidoPorGeometria(stored);
    const quedan = checks.filter((c) => c.outcome !== "mismatch");
    await guardar({
      ...parque,
      rows: r.rows,
      profile: {
        ...r.profile,
        calibration: {
          ...(parque.profile.calibration ?? { status: "partial" }),
          verifiedCases: [
            ...(parque.profile.calibration?.verifiedCases ?? []),
            `El sentido del conteo se resolvio por geometria en ${r.resueltas} filas: la punta ` +
            "que da a la calle de las cajas se mide, no se declara.",
          ],
        },
      },
      checks: quedan,
      savedAt: new Date().toISOString(),
    });
    setSentido(`${r.resueltas} filas resueltas` + (r.sinResolver.length ? ` · ${r.sinResolver.length} bloque(s) sin resolver` : ""));
    setRegistrando(false);
    setResult(null);
  }

  async function voltearLado(bloque: string) {
    setRegistrando(true);
    const filas = voltearLadoDelBloque(parque.rows, bloque);
    const quedan = checks.filter((c) => !(c.block === bloque && c.outcome === "mismatch"));
    await guardar({
      ...parque,
      rows: filas,
      checks: quedan,
      savedAt: new Date().toISOString(),
      profile: {
        ...parque.profile,
        calibration: {
          ...(parque.profile.calibration ?? { status: "partial" }),
          verifiedCases: [
            ...(parque.profile.calibration?.verifiedCases ?? []),
            `Bloque ${bloque}: el lado de la calle estaba deducido al reves y se dio vuelta a ` +
            `partir de ${checks.filter((c) => c.block === bloque).length} conteos de campo que ` +
            "salian espejados.",
          ],
        },
      },
    });
    setRegistrando(false);
    setResult(null);
    setError(null);
  }

  async function registrar(outcome: "match" | "mismatch") {
    if (!result?.best || !coord) return;
    setRegistrando(true);
    const row = parque.rows.find((r) => r.id === result.best!.rowId);
    const n = Number(contado);
    const check = checkFromResult(result, coord, formatAddress(result.best), row, outcome, {
      accuracyM: accuracy,
      ...(outcome === "mismatch" && Number.isFinite(n) && n > 0 ? { countedModule: n } : {}),
    });
    if (!check) { setRegistrando(false); return; }

    const nuevos = [...checks, check];
    const cal = toCalibration(nuevos, parque.rows);
    await guardar({
      ...parque,
      checks: nuevos,
      savedAt: new Date().toISOString(),
      profile: { ...parque.profile, calibration: { ...parque.profile.calibration, ...cal } },
    });
    setRegistrado(outcome);
    setRegistrando(false);
  }

  /**
   * Esperar a que el GPS converja, en vez de quedarse con la primera lectura.
   *
   * `getCurrentPosition` devuelve apenas tiene ALGO, y lo primero que tiene el
   * telefono es la posicion por antena de telefonia: 50, 90, 200 metros. El
   * satelite tarda entre cinco y quince segundos en entrar, y recien ahi baja a
   * 3-8 m. Con una sola lectura eso no pasa nunca — hay que tocar el boton una
   * y otra vez a ver si sale mejor, que es lo que hacia perder la tarde.
   *
   * `watchPosition` entrega las lecturas a medida que mejoran. Se queda con la
   * mejor, muestra el progreso para que se vea que esta trabajando, y corta
   * sola cuando llega a algo que sirve para contar modulos.
   */
  function useGps() {
    if (!navigator.geolocation) {
      setError("Este dispositivo no expone GPS al navegador.");
      return;
    }
    setError(null);
    setGpsBusy(true);
    setBuscando(null);

    let mejor: { lat: number; lon: number; acc: number } | null = null;
    let id: number | null = null;
    let corte: ReturnType<typeof setTimeout> | null = null;

    const terminar = () => {
      if (id != null) navigator.geolocation.clearWatch(id);
      if (corte) clearTimeout(corte);
      setGpsBusy(false);
      setBuscando(null);
      if (!mejor) return;
      const t = `${mejor.lat}, ${mejor.lon}`;
      setText(t);
      setAccuracy(mejor.acc);
      run(t, mejor.acc);
    };

    id = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = Math.max(1, Math.round(pos.coords.accuracy));
        if (!mejor || acc < mejor.acc) {
          mejor = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc };
        }
        setBuscando(mejor.acc);
        // Por debajo de esto ya sirve para contar: no tiene sentido hacer
        // esperar mas a alguien parado al sol.
        if (mejor.acc <= SUFICIENTE_M) terminar();
      },
      (err) => {
        if (mejor) { terminar(); return; }
        if (id != null) navigator.geolocation.clearWatch(id);
        if (corte) clearTimeout(corte);
        setGpsBusy(false);
        setBuscando(null);
        setError(`No pude leer el GPS: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: ESPERA_MS, maximumAge: 0 },
    );

    // Aunque no llegue a la precision buena, en algun momento hay que cortar y
    // usar lo mejor que haya — con el aviso de que no alcanza, si no alcanza.
    corte = setTimeout(terminar, ESPERA_MS);
  }

  if (!farm) {
    return (
      <div className="screen">
        <p className="alert">El perfil de este parque no compila. Volve a cargarlo desde el asistente.</p>
        <button className="ghost" onClick={onBack}>Volver</button>
      </div>
    );
  }

  const best = result?.best;
  // El veredicto de la propia coordenada. Va antes que cualquier resultado:
  // con una coordenada de 800 m de error, no encontrar fila no dice nada del
  // parque — dice que esa coordenada no es una medicion de GPS.
  const calidad = useMemo(
    () => (result || accuracy != null
      ? calidadDeCoordenada(accuracy, parque.profile.matching?.maxDistanceM ?? 30)
      : null),
    [result, accuracy, parque.profile.matching?.maxDistanceM],
  );

  // Que regla explica los desacuerdos. Es la promesa que la app venia haciendo
  // —"un desacuerdo es un dato, no un error"— y que hasta ahora no cumplia.
  const diag = useMemo(
    () => diagnosticoDeReglas(checks, parque.profile, parque.rows),
    [checks, parque.profile, parque.rows],
  );
  // El N con el que se compara sale de la fila de cada conteo, no del perfil:
  // en un parque que mezcla trackers de 56 con trackers de 28, el N del perfil
  // no es el de la fila donde se conto.
  const espejo = useMemo(() => pareceEspejado(checks, farm), [checks, farm]);

  const resumen = useMemo(() => summarize(checks, parque.rows), [checks, parque.rows]);

  // Lo que los conteos dicen sobre el offset de punta. Es el unico numero del
  // modelo que no se puede medir con cinta: la pila de punta y el punto que
  // trae el archivo no son el mismo lugar, y solo contando modulos parado en
  // la fila se sabe cual de los dos usa el relevamiento.
  const offset = useMemo(
    () => veredictoDeOffset(checks, parque.profile, parque.rows),
    [checks, parque.profile, parque.rows],
  );

  /** El rango de modulos que cubre el 85 % de la probabilidad, dentro de la fila ganadora. */
  const range = useMemo(() => {
    if (!result?.best) return null;
    const bestRow = result.best.rowId;
    const sameRow = result.candidates.filter((c) => c.rowId === bestRow);
    let mass = 0;
    const kept: typeof sameRow = [];
    for (const c of sameRow) {
      kept.push(c);
      mass += c.confidence;
      if (mass >= 0.85) break;
    }
    const modules = kept.map((c) => c.module);
    const strings = new Set(kept.map((c) => c.stringNumber));
    return {
      lo: Math.min(...modules),
      hi: Math.max(...modules),
      singleString: strings.size === 1,
      stringNumber: result.best.stringNumber,
    };
  }, [result]);

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>Localizar</h1>
        </div>
        <button className="ghost" onClick={onBack}>Parques</button>
      </header>

      <section className="card">
        <div className="field">
          <label>Coordenada</label>
          <textarea
            rows={2}
            value={text}
            placeholder={`-27.504333, 152.752833\no bien:  27°30'15.6"S 152°45'10.2"E`}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="help">
            Pegala tal como sale de Google Maps. No la conviertas a mano: la app entiende grados,
            minutos y segundos.
          </span>
        </div>

        <div className="row">
          <button onClick={() => run(text, accuracy)} disabled={!text.trim()}>Localizar</button>
          <button className="ghost" onClick={useGps} disabled={gpsBusy}>
            {gpsBusy
              ? buscando != null ? `Buscando satelites… ±${buscando} m` : "Buscando satelites…"
              : "Usar mi ubicacion"}
          </button>
          {accuracy != null && <span className="muted small">precision ±{accuracy} m</span>}
        </div>
        <p className="help">
          El boton espera hasta veinte segundos a que entre el satelite. La primera lectura que da
          el telefono es la de la antena de telefonia —cincuenta, noventa metros— y recien despues
          baja a menos de diez. Quedate quieto mientras busca; corta solo cuando llega.
        </p>
        <div className="row" style={{ display: "none" }}>
        </div>

        {error && <p className="alert">{error}</p>}
      </section>

      {calidad && !calidad.sirve && (
        <section className="card">
          <div className="cuadre no">
            <h3>{calidad.titulo}</h3>
            <p>{calidad.detalle}</p>
            <h3 style={{ marginTop: 10 }}>Como arreglarlo</h3>
            <ul>{comoArreglarlo().map((x, i) => (<li key={i}>{x}</li>))}</ul>
          </div>
        </section>
      )}

      {calidad && calidad.sirve && calidad.calidad !== "gps" && (
        <p className="note bad">
          <strong>{calidad.titulo}</strong> — {calidad.detalle}
        </p>
      )}

      {result && (
        <section className="card">
          {best ? (
            <>
              <p className="eyebrow">Resultado mas probable</p>
              <p className="answer">{formatAddress(best)}</p>
              <p className="muted">
                {(best.confidence * 100).toFixed(0)} % de probabilidad ·
                {" "}a {best.distanceM.toFixed(1)} m del centro del modulo ·
                {" "}{best.offAxisM.toFixed(1)} m del eje de la fila
              </p>

              {range && range.lo !== range.hi && (
                // Lo honesto cuando el GPS no da para senalar un modulo solo:
                // un rango acotado dentro de una fila que si es confiable.
                <p className="range">
                  Con la precision de esta coordenada, el modulo esta entre el{" "}
                  <strong>{range.lo}</strong> y el <strong>{range.hi}</strong> del{" "}
                  {range.singleString ? `string ${range.stringNumber}` : "tracker"}.
                  El tracker y la fila si son confiables.
                </p>
              )}

              <h3>Vecinos, para confirmar contra la foto</h3>
              <ul className="cands">
                {result.candidates.slice(0, 12).map((c) => {
                  // Si el candidato esta en otro tracker hay que decirlo: es la
                  // diferencia entre confirmar el panel de al lado y caminar
                  // hasta la fila equivocada.
                  const otherRow = c.rowId !== best.rowId;
                  return (
                    <li key={`${c.rowId}#${c.positionInRow}`} className={c === best ? "top" : ""}>
                      <span className="bar" style={{ width: `${Math.max(2, c.confidence * 100)}%` }} />
                      <span className="cand-label">
                        {otherRow && (
                          <strong className="cand-row">
                            {c.tracker}{c.row ? ` ${c.row}` : ""} ·{" "}
                          </strong>
                        )}
                        string {c.stringNumber} · modulo {c.module}
                        <em>{c.countedFrom === "near-dc" ? "desde la caja DC" : "desde la punta lejana"}</em>
                      </span>
                      <span className="mono">{(c.confidence * 100).toFixed(0)} %</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="answer muted">Sin resultado.</p>
          )}

          {result.warnings.length > 0 && (
            <div className="warnbox">
              {result.warnings.map((w, i) => (<p key={i}>{w.message}</p>))}
            </div>
          )}

          {best && (
            // El momento en que la verificacion es barata: la persona ya esta
            // parada ahi. Un dia despues cuesta un viaje.
            <div className="verify">
              <h3>¿Contaste los modulos?</h3>
              {registrado ? (
                <p className={registrado === "match" ? "note good" : "note bad"}>
                  {registrado === "match"
                    ? "Anotado. Queda guardado en el parque como prueba de campo."
                    : "Anotado el desacuerdo. El parque no va a figurar como verificado hasta que se entienda por que."}
                </p>
              ) : (
                <>
                  <p className="help">
                    Es lo unico que separa "el calculo da" de "el calculo es correcto". Si ya contaste
                    parado ahi, dejalo asentado ahora: mañana cuesta un viaje.
                  </p>
                  <div className="row">
                    <button onClick={() => void registrar("match")} disabled={registrando}>
                      Conte y coincide
                    </button>
                    <label className="inline">
                      No coincide, conte el
                      <input
                        type="number" min={1} value={contado} placeholder="modulo"
                        onChange={(e) => setContado(e.target.value)}
                      />
                    </label>
                    <button
                      className="ghost"
                      onClick={() => void registrar("mismatch")}
                      disabled={registrando || !contado.trim()}
                    >
                      Anotar el desacuerdo
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <button className="link" onClick={() => setDetails((d) => !d)}>
            {details ? "Ocultar" : "Ver"} el detalle del calculo
          </button>
          {details && result.diagnostics.winner && (
            <dl className="diag">
              <dt>Fila</dt><dd>{result.diagnostics.winner.rowId}</dd>
              <dt>Largo del segmento</dt><dd>{result.diagnostics.winner.segmentLengthM.toFixed(2)} m</dd>
              <dt>Avance desde el origen</dt><dd>{result.diagnostics.winner.alongFromOriginM.toFixed(2)} m</dd>
              <dt>Paso usado</dt><dd>{(result.diagnostics.winner.pitchM * 1000).toFixed(0)} mm</dd>
              <dt>Extremo de conteo</dt>
              <dd>{result.diagnostics.winner.originEnd} ({result.diagnostics.winner.originStrategy})</dd>
              <dt>String invertido</dt>
              <dd>{result.diagnostics.winner.inverted ? "si" : "no"} ({result.diagnostics.winner.inversionStrategy})</dd>
              <dt>Residuo de largo</dt>
              <dd>{result.diagnostics.winner.lengthResidualMmPerModule.toFixed(1)} mm por modulo</dd>
              <dt>Filas evaluadas</dt><dd>{result.diagnostics.rowsConsidered}</dd>
            </dl>
          )}
        </section>
      )}

      <section className="card">
        <h2>Que esta probado en este parque</h2>
        {resumen.status === "field-verified" ? (
          <p className="note good">
            Las tres reglas estan probadas contando modulos a mano, y no hay ningun desacuerdo sin
            explicar. Este parque se puede reportar.
          </p>
        ) : (
          <p className="note bad">
            {resumen.matches === 0
              ? "Todavia no hay ningun punto contado a mano. Los resultados sirven para orientarse, pero no para reportarle a un cliente."
              : `${resumen.matches} punto(s) contados a mano. Todavia no alcanza: no basta con verificar varias veces lo mismo.`}
          </p>
        )}

        <ul className="rules">
          {resumen.coverage.map((r) => (
            <li key={r.key} className={r.covered ? "ok" : ""}>
              <span className="tick">{r.covered ? "✓" : "○"}</span>
              <span>
                <strong>{r.label}</strong>
                <em>{r.why}</em>
              </span>
            </li>
          ))}
        </ul>

        {checks.length > 0 && (
          <div className={offset.actualSirve ? "cuadre" : "cuadre no"}>
            <h3>Que dicen tus conteos sobre el arranque de la fila</h3>
            <p className="help">
              A que distancia del punto que trae el archivo empieza el primer modulo es el unico
              numero del modelo que no se puede medir con cinta — la pila de punta y el punto del
              relevamiento no tienen por que ser el mismo lugar. Contando modulos si se despeja.
            </p>
            {offset.comun && (
              <p>
                <strong>
                  Entre {offset.comun.desdeMm} y {offset.comun.hastaMm} mm
                </strong>{" "}
                · el perfil tiene {offset.actualMm} mm
              </p>
            )}
            {offset.notas.map((n, i) => (<p key={i} className="small">{n}</p>))}
          </div>
        )}

        {diag.usados > 0 && diag.actual < diag.usados && (
          <div className={diag.mejor ? "cuadre" : "cuadre no"}>
            <h3>Que regla explica los desacuerdos</h3>
            {espejo.espejado && (
              <p>
                <strong>Esta espejado.</strong>{" "}
                {espejo.esperada != null ? (
                  <>
                    En un string de {espejo.esperada - 1} modulos, contar desde la otra punta
                    convierte el modulo k en el {espejo.esperada} − k. Tus sumas dan{" "}
                    <strong>{espejo.sumas.join(", ")}</strong> — o sea {espejo.esperada}, con el
                    ruido del GPS.
                  </>
                ) : (
                  <>
                    Contar desde la otra punta convierte el modulo k en el N+1 − k, con el N del
                    tracker donde estes parado. Tus sumas dan{" "}
                    <strong>{espejo.sumas.join(", ")}</strong>, y cada una da el N+1 de SU fila
                    (<strong>{espejo.esperadas.join(", ")}</strong>) con el ruido del GPS: este
                    parque mezcla dos largos de tracker.
                  </>
                )}{" "}
                Y como los conteos cubren las dos puntas de la fila, eso ademas descarta un error
                de paso: si el paso estuviera mal, las sumas se irian corriendo.
              </p>
            )}
            <div className="tablewrap">
              <table>
                <thead><tr><th>Hipotesis</th><th className="num">Explica</th></tr></thead>
                <tbody>
                  {diag.hipotesis.map((h) => (
                    <tr key={h.id} className={diag.mejor?.id === h.id ? "top" : ""}>
                      <td>{h.titulo}</td>
                      <td className="num">{h.aciertos} de {h.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {diag.notas.map((n, i) => (<p key={i} className="small">{n}</p>))}
            {diag.bloquesParaVoltear.length > 0 && (
              <>
                <p className="small">
                  <strong>Pero no lo arregles bloque por bloque.</strong> Que punta de la fila da a
                  la calle de las cajas se puede MEDIR, y sale igual en todos los bloques sin
                  caminar ninguno. Resolvelo de una vez para el parque entero; dar vuelta un bloque
                  suelto queda para el caso raro en que la geometria no alcance.
                </p>
                <div className="actions">
                  <button disabled={registrando} onClick={() => void resolverSentido()}>
                    Resolver el sentido de todo el parque
                  </button>
                  {diag.bloquesParaVoltear.map((b) => (
                    <button key={b} className="ghost" disabled={registrando} onClick={() => void voltearLado(b)}>
                      Solo dar vuelta el bloque {b}
                    </button>
                  ))}
                </div>
                {sentido && <p className="note ok">{sentido}</p>}
              </>
            )}
          </div>
        )}

        {resumen.mismatches > 0 && (
          <div className="warnbox">
            <h3>{resumen.mismatches} desacuerdo(s) sin explicar</h3>
            <ul>
              {checks.filter((c) => c.outcome === "mismatch").slice(-4).map((c) => (
                <li key={c.id}>
                  <code>{c.said}</code> — contaste el {c.countedModule ?? "?"}
                </li>
              ))}
            </ul>
            <p>
              Mientras haya uno de estos, el parque queda en parcial por mas puntos que coincidan.
              Un desacuerdo es un dato, no un error: casi siempre hay una regla que falta declarar.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
