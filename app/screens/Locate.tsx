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
import { checkFromResult, summarize, toCalibration } from "../checks";
import { saveFarm, type StoredFarm } from "../storage";

export function Locate({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [text, setText] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [result, setResult] = useState<LocateResult | null>(null);
  const [coord, setCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [checks, setChecks] = useState(stored.checks ?? []);
  const [contado, setContado] = useState("");
  const [registrando, setRegistrando] = useState(false);
  const [registrado, setRegistrado] = useState<"match" | "mismatch" | null>(null);

  const farm = useMemo<CompiledFarm | null>(() => {
    try {
      return compileFarm(stored.profile, stored.rows);
    } catch {
      return null;
    }
  }, [stored]);

  useEffect(() => {
    setResult(null); setError(null); setChecks(stored.checks ?? []);
  }, [stored]);

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
  async function registrar(outcome: "match" | "mismatch") {
    if (!result?.best || !coord) return;
    setRegistrando(true);
    const row = stored.rows.find((r) => r.id === result.best!.rowId);
    const n = Number(contado);
    const check = checkFromResult(result, coord, formatAddress(result.best), row, outcome, {
      accuracyM: accuracy,
      ...(outcome === "mismatch" && Number.isFinite(n) && n > 0 ? { countedModule: n } : {}),
    });
    if (!check) { setRegistrando(false); return; }

    const nuevos = [...checks, check];
    const cal = toCalibration(nuevos, stored.rows);
    await saveFarm({
      ...stored,
      checks: nuevos,
      savedAt: new Date().toISOString(),
      profile: { ...stored.profile, calibration: { ...stored.profile.calibration, ...cal } },
    });
    setChecks(nuevos);
    setRegistrado(outcome);
    setRegistrando(false);
  }

  function useGps() {
    if (!navigator.geolocation) {
      setError("Este dispositivo no expone GPS al navegador.");
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        const acc = Math.max(1, Math.round(pos.coords.accuracy));
        const t = `${pos.coords.latitude}, ${pos.coords.longitude}`;
        setText(t);
        setAccuracy(acc);
        run(t, acc);
      },
      (err) => { setGpsBusy(false); setError(`No pude leer el GPS: ${err.message}`); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
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
  const resumen = useMemo(() => summarize(checks, stored.rows), [checks, stored.rows]);

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
          <p className="eyebrow">{stored.profile.name}</p>
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
            {gpsBusy ? "Leyendo GPS…" : "Usar mi ubicacion"}
          </button>
          {accuracy != null && <span className="muted small">precision ±{accuracy} m</span>}
        </div>

        {error && <p className="alert">{error}</p>}
      </section>

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
