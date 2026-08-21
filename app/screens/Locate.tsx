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
import type { StoredFarm } from "../storage";

export function Locate({ farm: stored, onBack }: { farm: StoredFarm; onBack: () => void }) {
  const [text, setText] = useState("");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [result, setResult] = useState<LocateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  const farm = useMemo<CompiledFarm | null>(() => {
    try {
      return compileFarm(stored.profile, stored.rows);
    } catch {
      return null;
    }
  }, [stored]);

  useEffect(() => { setResult(null); setError(null); }, [stored]);

  function run(input: string, acc: number | null) {
    if (!farm) return;
    setError(null);
    try {
      const coords = parseCoordinate(input);
      setResult(locate(acc ? { ...coords, accuracyM: acc } : coords, farm));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
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

      {stored.profile.calibration?.status !== "field-verified" && (
        <p className="note bad">
          Este parque todavia no tiene ninguna regla verificada en campo. Los resultados sirven para
          orientarse, pero antes de reportarle algo a un cliente conviene confirmar unos puntos
          contando modulos a mano.
        </p>
      )}
    </div>
  );
}
