/**
 * La revision, hecha para una computadora y un teclado.
 *
 * Antes los hallazgos eran una pila de tarjetas, una abajo de la otra, cada una
 * con su miniatura y sus dos selectores. Para cuarenta esta bien. Para los
 * cuatrocientos que deja un bloque grande no: hay que scrollear a ciegas, la
 * foto es del tamaño de una estampilla —y la foto es lo unico que dice si es un
 * punto caliente o un diodo—, y clasificar uno son cuatro clicks.
 *
 * Cuando le pregunte donde iba a revisar, la respuesta fue "en la compu,
 * sentado". Eso decide todo el diseño:
 *
 *   - La lista a la izquierda, angosta, una linea por modulo. Se ve donde estas
 *     parado y cuanto falta.
 *   - La foto grande a la derecha, con el recuadro de lo que se midio. Es lo
 *     que hay que MIRAR, asi que se lleva el espacio.
 *   - El teclado hace el trabajo: flechas para moverse, una letra para la
 *     anomalia, un numero para la clase, Enter para confirmar y saltar al
 *     siguiente. Tres teclas por hallazgo, sin sacar la vista de la imagen.
 *
 * Lo que NO hace, y es a proposito: no decide nada por su cuenta. Confirmar es
 * siempre un gesto de una persona. La maquina ya dijo cuanto se despega ese
 * modulo de sus hermanos; que defecto es lo dice el que mira la foto.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { formatAddress } from "@locator";
import { FotoDelHallazgo } from "./FotoDelHallazgo";
import { AYUDA, ANOMALIAS_RAPIDAS, accionDeTecla } from "../atajos";
import { ANOMALIAS, CLASES, deltaTDe, type Finding } from "../inspection";

interface Props {
  /** Ya filtrados y ordenados por quien manda: aca no se reordena nada. */
  findings: Finding[];
  /** Los archivos del vuelo, para poder mostrar la foto. Puede estar vacio. */
  archivos: File[];
  seleccion: string | null;
  onSeleccion: (id: string) => void;
  onPatch: (id: string, cambio: Partial<Finding>) => void;
}

/** El renglon corto de la lista: lo que se lee de un vistazo. */
function corto(f: Finding): string {
  const a = f.address;
  if (!a) return "sin ubicar";
  const modulo = f.moduleCorregido ?? a.module;
  return `${a.tracker}${a.row ? " " + a.row : ""} · s${a.stringNumber} · m${modulo}`;
}

export function Revisor({ findings, archivos, seleccion, onSeleccion, onPatch }: Props) {
  const [ayuda, setAyuda] = useState(false);
  const notaRef = useRef<HTMLInputElement>(null);
  const filaRef = useRef<HTMLLIElement>(null);

  const indice = useMemo(
    () => Math.max(0, findings.findIndex((f) => f.id === seleccion)),
    [findings, seleccion],
  );
  const actual = findings[indice] ?? null;

  /**
   * Moverse por la lista. Vive aca y no adentro del teclado porque el boton de
   * "confirmar y seguir" tiene que hacer exactamente lo mismo que la tecla: dos
   * caminos que avanzan distinto es como se saltea un hallazgo sin notarlo.
   */
  function mover(delta: number) {
    const i = Math.min(Math.max(indice + delta, 0), findings.length - 1);
    const siguiente = findings[i];
    if (siguiente) onSeleccion(siguiente.id);
  }

  function marcar(estado: Finding["status"]) {
    const f = findings[indice];
    if (!f) return;
    onPatch(f.id, { status: estado });
    mover(1);
  }

  // Si la lista cambia debajo —un filtro, una corrida nueva— hay que quedar
  // parado en algo: sin esto la pantalla derecha queda vacia sin decir por que.
  useEffect(() => {
    if (!findings.length) return;
    if (!findings.some((f) => f.id === seleccion)) onSeleccion(findings[0]!.id);
  }, [findings, seleccion, onSeleccion]);

  // El renglon elegido siempre a la vista: moverse con el teclado sin que la
  // lista siga al cursor es moverse a ciegas.
  useEffect(() => {
    filaRef.current?.scrollIntoView({ block: "nearest" });
  }, [seleccion]);

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      const accion = accionDeTecla({
        key: e.key,
        ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
        target: e.target,
      });
      if (!accion) return;

      const f = findings[indice];

      switch (accion.tipo) {
        case "mover": e.preventDefault(); mover(accion.delta); break;
        case "salir": (e.target as HTMLElement | null)?.blur?.(); break;
        case "ayuda": e.preventDefault(); setAyuda((v) => !v); break;
        case "nota": e.preventDefault(); notaRef.current?.focus(); break;
        default: {
          if (!f) return;
          e.preventDefault();
          if (accion.tipo === "clase") onPatch(f.id, { klass: accion.klass });
          else if (accion.tipo === "anomalia") onPatch(f.id, { anomaly: accion.nombre });
          else if (accion.tipo === "confirmar") marcar("confirmado");
          else if (accion.tipo === "descartar") marcar("descartado");
        }
      }
    }
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [findings, indice, onPatch, onSeleccion]);

  if (!findings.length) {
    return (
      <p className="note">
        No hay hallazgos para revisar con este filtro.
      </p>
    );
  }

  const m = actual?.medicion;

  return (
    <div className="revisor">
      <ol className="revisor-lista">
        {findings.map((f, i) => (
          <li
            key={f.id}
            ref={f.id === seleccion ? filaRef : undefined}
            className={`${f.id === seleccion ? "elegido" : ""} ${f.status} ${f.medicion?.peor ?? ""}`}
          >
            <button onClick={() => onSeleccion(f.id)}>
              <span className="n">{i + 1}</span>
              <span className="donde">{corto(f)}</span>
              <span className="dt">
                {deltaTDe(f) != null ? `${deltaTDe(f)! >= 0 ? "+" : ""}${deltaTDe(f)!.toFixed(1)}°` : "—"}
              </span>
              <span className="estado" aria-label={f.status}>
                {f.status === "confirmado" ? "✓" : f.status === "descartado" ? "✕" : "·"}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="revisor-detalle">
        {!actual ? (
          <p className="note">Elegi un hallazgo de la lista.</p>
        ) : (
          <>
            <div className="revisor-cabeza">
              <div>
                <p className="answer">
                  {actual.address ? formatAddress(actual.address) : "Sin ubicar"}
                </p>
                <p className="eyebrow">
                  {actual.fileName}
                  {m && (
                    <>
                      {" · "}{m.celsius.toFixed(1)} °C ·{" "}
                      <strong>{m.deltaT >= 0 ? "+" : ""}{m.deltaT.toFixed(1)} °C</strong>{" "}
                      contra {m.vecinos}{" "}
                      {m.ambito === "string" ? "vecinos de su string" : `vecinos (por ${m.ambito})`}
                      {" · "}{m.peor}
                      {m.deltaInterno != null && (
                        <> · punto caliente <strong>+{m.deltaInterno.toFixed(1)} °C</strong> sobre el propio modulo
                          {m.origen === "celda" && " (es una celda)"}</>
                      )}
                    </>
                  )}
                </p>
              </div>
              <span className="muted small">{indice + 1} de {findings.length}</span>
            </div>

            {archivos.length ? (
              <FotoDelHallazgo fileName={actual.fileName} caja={m?.caja} archivos={archivos} explicar={false} />
            ) : (
              <p className="note">
                Las fotos no se guardan con el vuelo —son miles de archivos—, asi que para verlas
                hay que volver a elegir la carpeta arriba. La lista, la medicion y todo lo que
                clasificaste siguen igual.
              </p>
            )}

            {/*
              Lo que dijo la maquina, con el motivo.

              Va ARRIBA de los botones de anomalia y no adentro: lo que se hace
              con esto es desmentirlo o dejarlo, y para eso hay que poder leer
              por que lo dijo. Una etiqueta sin motivo no se puede discutir — es
              justo lo que tiene el informe de la otra empresa, y por eso su
              verificacion de campo encontro 30 de 71 mal en un tipo entero.
            */}
            {actual.patron && (
              <p className={`note ${actual.patron.confianza === "alta" ? "ok" : ""}`}>
                <strong>
                  {actual.patron.anomalia ?? "Sin clasificar"}
                  {actual.patron.confianza !== "alta" && (
                    <> — {actual.patron.confianza === "media" ? "a confirmar" : "poco confiable"}</>
                  )}
                </strong>{" "}
                {actual.patron.porQue}
              </p>
            )}

            {actual.warnings.length > 0 && (
              <div className="warnbox">
                {actual.warnings.map((w, i) => (<p key={i}>{w.message}</p>))}
              </div>
            )}

            {/*
              Corregir el modulo mirando la foto. Solo entre los vecinos del
              MISMO string: mezclar dos strings hace que el mismo numero
              signifique dos modulos distintos.
            */}
            {actual.candidates.length > 1 && actual.address && (
              <div className="row chips">
                <span className="muted small">Corregir el modulo:</span>
                {[...new Set(
                  actual.candidates
                    .filter((c) => c.rowId === actual.address!.rowId && c.stringNumber === actual.address!.stringNumber)
                    .map((c) => c.module),
                )].sort((a, b) => a - b).map((mod) => (
                  <button
                    key={mod}
                    className={actual.moduleCorregido === mod ? "" : "ghost"}
                    onClick={() => onPatch(actual.id, { moduleCorregido: actual.moduleCorregido === mod ? undefined : mod })}
                  >
                    {mod}
                  </button>
                ))}
              </div>
            )}

            <div className="row chips anomalias">
              {ANOMALIAS_RAPIDAS.map((a) => (
                <button
                  key={a.nombre}
                  className={actual.anomaly === a.nombre ? "" : "ghost"}
                  title={`En la foto: ${a.patron}`}
                  onClick={() => onPatch(actual.id, { anomaly: a.nombre })}
                >
                  <kbd>{a.tecla.toUpperCase()}</kbd> {a.nombre}
                </button>
              ))}
              <select
                aria-label="Anomalia"
                value={actual.anomaly ?? ""}
                onChange={(e) => onPatch(actual.id, { anomaly: e.target.value || undefined })}
              >
                <option value="">— otra —</option>
                {ANOMALIAS.map((a) => (<option key={a} value={a}>{a}</option>))}
              </select>
            </div>

            <div className="row chips">
              {CLASES.map((c) => (
                <button
                  key={c.id}
                  className={actual.klass === c.id ? "" : "ghost"}
                  title={c.hint}
                  onClick={() => onPatch(actual.id, { klass: actual.klass === c.id ? undefined : c.id })}
                >
                  <kbd>{c.id}</kbd> {c.label}
                </button>
              ))}
            </div>

            <div className="field">
              <label htmlFor="revisor-nota">Nota</label>
              <input
                id="revisor-nota"
                ref={notaRef}
                value={actual.note ?? ""}
                onChange={(e) => onPatch(actual.id, { note: e.target.value || undefined })}
              />
            </div>

            <div className="actions">
              <button onClick={() => marcar("confirmado")}>
                <kbd>Enter</kbd> Confirmar y seguir
              </button>
              <button className="ghost" onClick={() => marcar("descartado")}>
                <kbd>X</kbd> Descartar y seguir
              </button>
              <button className="link" onClick={() => setAyuda((v) => !v)}>
                {ayuda ? "ocultar atajos" : "atajos del teclado"}
              </button>
            </div>

            {ayuda && (
              <ul className="atajos">
                {AYUDA.map((a) => (
                  <li key={a.teclas}><kbd>{a.teclas}</kbd> {a.hace}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
