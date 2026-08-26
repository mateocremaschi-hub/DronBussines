/**
 * El vuelo entero, analizado en el navegador.
 *
 * Aca se junta todo lo anterior: se cargan las fotos del vuelo, se lee la
 * temperatura de cada una, se mide cada modulo del parque y se lo compara
 * contra sus vecinos del mismo string.
 *
 * Es la pantalla que reemplaza a la plataforma que se paga por megavatio. Y
 * puede hacerlo por una sola razon: el parque ya esta cargado, medido y
 * verificado. Sin eso habria que adivinar que hay en cada foto; con eso, es
 * una resta.
 */

import { useEffect, useMemo, useState } from "react";
import { compileFarm, makeFrame } from "@locator";
import type { CompiledFarm } from "@locator";
import { ThermalMap } from "../components/ThermalMap";
import { download } from "../inspection";
import { camaraDesdeEquivalente35, type Camera } from "../mission";
import { readPhoto, type PhotoFix } from "../photos";
import { readRadiometric } from "../thermal";
import {
  Acumulador,
  CELDA_M,
  comparar,
  eventosDeString,
  resumir,
  UMBRALES,
  type Hallazgo,
  type Muestra,
  type Umbrales,
} from "../detect";
import type { Ajuste } from "../projection";
import { saveAnalysis, type StoredFarm } from "../storage";

/** Largo del modulo sobre el eje corto de la fila, en metros. Un panel tipico. */
const LARGO_MODULO_M = 2.28;

interface Props {
  farm: StoredFarm;
  onBack: () => void;
  /** Ir a armar los reclamos con lo que salio de este vuelo. */
  onWarranty?: () => void;
}

export function Analysis({ farm: stored, onBack, onWarranty }: Props) {
  const [archivos, setArchivos] = useState<File[]>([]);
  const [muestras, setMuestras] = useState<Muestra[]>([]);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [gsdCm, setGsdCm] = useState(0);
  const [enElBorde, setEnElBorde] = useState(0);
  const [progreso, setProgreso] = useState<{ hecho: number; total: number } | null>(null);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [ajuste, setAjuste] = useState<Ajuste>({ dxM: 0, dyM: 0 });
  const [umbrales, setUmbrales] = useState<Umbrales>(UMBRALES);
  const [elegido, setElegido] = useState<Hallazgo | null>(null);

  const farm = useMemo<CompiledFarm | null>(() => {
    try { return compileFarm(stored.profile, stored.rows); } catch { return null; }
  }, [stored]);

  const anchoM = stored.profile.module.widthMm / 1000;

  const hallazgos = useMemo(
    () => (muestras.length ? comparar(muestras, umbrales) : []),
    [muestras, umbrales],
  );
  const eventos = useMemo(
    () => eventosDeString(hallazgos, stored.profile.topology.modulesPerString),
    [hallazgos, stored.profile.topology.modulesPerString],
  );
  const totalModulos =
    stored.rows.length *
    stored.profile.topology.modulesPerString *
    stored.profile.topology.stringsPerRow;
  const resumen = useMemo(
    () => (hallazgos.length ? resumir(hallazgos, totalModulos, eventos, gsdCm, enElBorde) : null),
    [hallazgos, totalModulos, eventos, gsdCm, enElBorde],
  );

  /**
   * Guarda la lista corta apenas termina el analisis.
   *
   * Solo lo que no es normal: los sanos son cientos de miles y no se
   * clasifican. Lo que se guarda es lo que despues se mira de a uno.
   */
  useEffect(() => {
    const cortos = hallazgos.filter((h) => h.peor !== "normal");
    if (!cortos.length) return;
    void saveAnalysis({
      farmId: stored.profile.id,
      hallazgos: cortos,
      gsdCm,
      fotos: archivos.length,
      savedAt: new Date().toISOString(),
    });
  }, [hallazgos, gsdCm, archivos.length, stored.profile.id]);

  /**
   * Procesa el vuelo foto por foto.
   *
   * Se lee, se mide y se descarta la matriz de temperaturas antes de pasar a
   * la siguiente: todas juntas no entran en memoria.
   */
  async function analizar(files: File[], conAjuste: Ajuste) {
    if (!farm) return;
    setProgreso({ hecho: 0, total: files.length });
    setProblemas([]);
    setElegido(null);

    const frame = makeFrame(farm.origin.lat, farm.origin.lon);
    let acc: Acumulador | null = null;
    let cam: Camera | null = null;
    let sumaGsd = 0;
    let nGsd = 0;
    const fallos: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const buf = await file.arrayBuffer();
        const radio = readRadiometric(buf);
        if (!radio) { setProgreso({ hecho: i + 1, total: files.length }); continue; }

        const leida = await readPhoto(file);
        const fix = leida.fix;
        if (!fix) { fallos.push(`${file.name}: ${leida.error ?? "sin coordenada"}`); continue; }

        if (!cam) {
          cam = camaraFrom(fix, radio.width, radio.height);
          if (!cam) { fallos.push(`${file.name}: no declara distancia focal equivalente`); continue; }
          setCamera(cam);
          acc = new Acumulador(farm, frame, {
            camera: cam,
            moduloAnchoM: anchoM,
            moduloLargoM: LARGO_MODULO_M,
            ajuste: conAjuste,
            // El lado de la celda lo declara el perfil del parque: cambia
            // entre fabricantes y decide si este vuelo puede ver una celda.
            celdaM: (stored.profile.module.cellMm ?? CELDA_M * 1000) / 1000,
          });
        }

        const agl = fix.relativeAltitudeM;
        if (agl == null) { fallos.push(`${file.name}: no trae altura sobre el terreno`); continue; }

        sumaGsd += ((2 * agl * Math.tan((cam.hfovDeg * Math.PI) / 360)) / cam.imageW) * 100;
        nGsd++;

        acc!.agregar({
          fileName: file.name,
          radio,
          pose: {
            lat: fix.lat, lon: fix.lon, altitudeAglM: agl,
            ...(fix.gimbalYawDeg != null ? { gimbalYawDeg: fix.gimbalYawDeg } : {}),
            ...(fix.gimbalPitchDeg != null ? { gimbalPitchDeg: fix.gimbalPitchDeg } : {}),
          },
        });
      } catch (e) {
        fallos.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      setProgreso({ hecho: i + 1, total: files.length });
    }

    setGsdCm(nGsd ? sumaGsd / nGsd : 0);
    setEnElBorde(acc ? acc.soloEnElBorde() : 0);
    setMuestras(acc ? acc.muestras() : []);
    setProblemas(fallos);
    setProgreso(null);
  }

  if (!farm) {
    return (
      <div className="screen">
        <p className="alert">El perfil de este parque no compila. Recargalo desde el asistente.</p>
        <button className="ghost" onClick={onBack}>Volver</button>
      </div>
    );
  }

  const mover = (dx: number, dy: number) => {
    const nuevo = { dxM: ajuste.dxM + dx, dyM: ajuste.dyM + dy };
    setAjuste(nuevo);
    void analizar(archivos, nuevo);
  };

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">{stored.profile.name}</p>
          <h1>Analizar un vuelo</h1>
        </div>
        <button className="ghost" onClick={onBack}>Parques</button>
      </header>

      <section className="card">
        <h2>Las fotos del vuelo</h2>
        <p>
          Elegí las fotos tal como salieron de la tarjeta. La app lee la temperatura de cada
          termica, mide cada modulo del parque y lo compara contra los otros de su mismo string.
          Las visibles se descartan solas.
        </p>
        <label className="drop">
          <input
            type="file" accept="image/jpeg" multiple
            onChange={(e) => {
              const f = [...(e.target.files ?? [])];
              setArchivos(f);
              if (f.length) void analizar(f, ajuste);
            }}
          />
          <strong>Elegir fotos</strong>
          <span className="muted">{archivos.length ? `${archivos.length} archivos` : "JPEG del dron"}</span>
        </label>
        {progreso && (
          <p className="muted">Leyendo {progreso.hecho} de {progreso.total}…</p>
        )}
        {problemas.length > 0 && (
          <div className="warnbox">
            <h3>{problemas.length} fotos que no pude usar</h3>
            <ul>{problemas.slice(0, 6).map((p, i) => (<li key={i}><code>{p}</code></li>))}</ul>
          </div>
        )}
      </section>

      {resumen && camera && (
        <>
          <section className="card">
            <h2>Que encontro</h2>
            <div className="stats">
              <div><b>{resumen.modulosMedidos}</b><span>modulos medidos</span></div>
              <div className={resumen.leves ? "alerta" : ""}><b>{resumen.leves}</b><span>leves</span></div>
              <div className={resumen.moderadas ? "alerta" : ""}><b>{resumen.moderadas}</b><span>moderadas</span></div>
              <div className={resumen.criticas ? "alerta" : ""}><b>{resumen.criticas}</b><span>criticas</span></div>
            </div>
            <p className="muted small">
              Camara deducida de las propias fotos: {camera.hfovDeg.toFixed(1)}° de campo horizontal
              sobre {camera.imageW}×{camera.imageH} px · {gsdCm.toFixed(1)} cm por pixel en este vuelo ·{" "}
              {resumen.conChequeoDeCelda
                ? `${resumen.conChequeoDeCelda} modulos chequeados tambien por adentro`
                : "sin resolucion para buscar celdas calientes"}.
            </p>

            {resumen.eventosDeString > 0 && (
              <div className="warnbox">
                <h3>{resumen.eventosDeString} string(s) calientes enteros</h3>
                <p>
                  No son defectos de modulo: un string entero por encima de sus vecinos es una
                  conexion, un fusible o un tramo desconectado. Se arregla en otro lado.
                </p>
                <div className="tablewrap">
                  <table>
                    <thead><tr><th>Bloque</th><th>Tracker</th><th>String</th><th>Modulos</th><th>ΔT medio</th></tr></thead>
                    <tbody>
                      {eventos.slice(0, 10).map((e) => (
                        <tr key={`${e.rowId}-${e.stringNumber}`}>
                          <td>{e.block}</td><td><code>{e.tracker}</code></td>
                          <td><code>{e.stringLabel ?? e.stringNumber}</code></td>
                          <td>{e.modulos}</td><td>{e.deltaTMedio.toFixed(1)} °C</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {resumen.limitaciones.length > 0 && (
              <div className="warnbox">
                <h3>Lo que este vuelo NO permite afirmar</h3>
                {resumen.limitaciones.map((l, i) => (<p key={i}>{l}</p>))}
              </div>
            )}
          </section>

          <section className="card">
            <h2>El parque, modulo por modulo</h2>
            <ThermalMap
              hallazgos={hallazgos} anchoM={anchoM} largoM={LARGO_MODULO_M}
              onPick={setElegido} seleccion={elegido}
            />

            {elegido && (
              <div className="note">
                <strong>
                  Bloque {elegido.modulo.block}, tracker {elegido.modulo.tracker}
                  {elegido.modulo.row ? ` ${elegido.modulo.row}` : ""}, string{" "}
                  {elegido.modulo.stringLabel ?? elegido.modulo.stringNumber}, modulo{" "}
                  {elegido.modulo.module}
                </strong>
                <br />
                {elegido.celsius.toFixed(1)} °C · <strong>{elegido.deltaT >= 0 ? "+" : ""}
                {elegido.deltaT.toFixed(1)} °C</strong> contra sus {elegido.vecinos} vecinos
                {elegido.ambito === "string" ? " del mismo string" : ` (comparado por ${elegido.ambito})`}
                {" "}· medido sobre {elegido.pixeles} pixeles de <code>{elegido.fileName}</code>
                {elegido.deltaInterno != null && (
                  <>
                    <br />
                    Su zona mas caliente esta <strong>+{elegido.deltaInterno.toFixed(1)} °C</strong>{" "}
                    por encima del propio modulo
                    {elegido.origen === "celda" && " — eso es una celda, no el modulo entero"}.
                  </>
                )}
              </div>
            )}

            <h3>Si la grilla no coincide con el parque</h3>
            <p className="help">
              El GPS del dron se equivoca parejo: todo el vuelo corrido para el mismo lado. Movelo
              una vez y se corrige entero. Corrimiento actual:{" "}
              <strong>{ajuste.dxM.toFixed(1)} m este · {ajuste.dyM.toFixed(1)} m norte</strong>.
            </p>
            <div className="row">
              <button className="ghost" onClick={() => mover(0, 1)} disabled={!!progreso}>↑ 1 m norte</button>
              <button className="ghost" onClick={() => mover(0, -1)} disabled={!!progreso}>↓ 1 m sur</button>
              <button className="ghost" onClick={() => mover(-1, 0)} disabled={!!progreso}>← 1 m oeste</button>
              <button className="ghost" onClick={() => mover(1, 0)} disabled={!!progreso}>→ 1 m este</button>
              <button className="link" onClick={() => mover(-ajuste.dxM, -ajuste.dyM)} disabled={!!progreso}>
                Volver a cero
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Los hallazgos</h2>
            <div className="row">
              {(["leve", "moderada", "critica"] as const).map((k) => (
                <label className="inline" key={k}>
                  ΔT {k} (°C)
                  <input
                    type="number" min={0} step={1} value={umbrales[k]}
                    onChange={(e) => setUmbrales((u) => ({ ...u, [k]: Number(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
            <p className="help">
              Los umbrales son una convencion de trabajo, no una cita de la norma: la IEC clasifica
              por patron y contexto, no por un numero suelto. Sirven para ordenar la lista.
            </p>

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Bloque</th><th>Tracker</th><th>String</th><th>Modulo</th>
                    <th>°C</th><th>ΔT modulo</th><th>ΔT celda</th>
                    <th>Comparado contra</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {hallazgos
                    .filter((h) => h.peor !== "normal")
                    .sort((a, b) => Math.max(b.deltaT, b.deltaInterno ?? -99) - Math.max(a.deltaT, a.deltaInterno ?? -99))
                    .slice(0, 30)
                    .map((h) => (
                      <tr
                        key={`${h.modulo.rowId}#${h.modulo.positionInRow}`}
                        className={elegido === h ? "top" : ""}
                        onClick={() => setElegido(h)}
                      >
                        <td>{h.modulo.block}</td>
                        <td><code>{h.modulo.tracker}</code></td>
                        <td><code>{h.modulo.stringLabel ?? h.modulo.stringNumber}</code></td>
                        <td>{h.modulo.module}</td>
                        <td>{h.celsius.toFixed(1)}</td>
                        <td className={h.origen === "modulo" ? "top" : ""}>
                          <strong>{h.deltaT >= 0 ? "+" : ""}{h.deltaT.toFixed(1)}</strong>
                        </td>
                        <td className={h.origen === "celda" ? "top" : "flojo"}>
                          {h.deltaInterno != null
                            ? <strong>+{h.deltaInterno.toFixed(1)}</strong>
                            : "no resuelve"}
                        </td>
                        <td className={h.ambito === "string" ? "" : "flojo"}>
                          {h.ambito === "string"
                            ? `su string (${h.vecinos})`
                            : `${h.ambito} (${h.vecinos}) — flojo`}
                        </td>
                        <td>{h.peor}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <div className="actions">
              <button onClick={() => download(`${stored.profile.id}-hallazgos.csv`, toCsv(hallazgos), "text/csv")}>
                Exportar CSV
              </button>
              {onWarranty && (
                <button className="ghost" onClick={onWarranty}>
                  Armar los reclamos →
                </button>
              )}
            </div>
            <p className="help">
              La lista de arriba dice que esta caliente. Lo que le devuelve plata al cliente es la
              de al lado: quien lo paga. Esta guardada, asi que podes cerrar y seguir despues.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/** Arma la camara con lo que declara la propia foto. */
function camaraFrom(fix: PhotoFix, w: number, h: number): Camera | null {
  if (!fix.equiv35mm) return null;
  return camaraDesdeEquivalente35(fix.sensor ?? "camara del vuelo", fix.equiv35mm, w, h);
}

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(hallazgos: Hallazgo[]): string {
  const head = [
    "bloque", "tracker", "fila", "string", "modulo_desde_caja_dc",
    "celsius", "delta_t", "referencia_c", "vecinos", "comparado_por", "severidad",
    "punto_caliente_c", "delta_interno", "severidad_celda", "que_lo_disparo",
    "pixeles", "foto",
  ];
  const lines = [head.join(",")];
  for (const h of [...hallazgos].sort(
    (a, b) => Math.max(b.deltaT, b.deltaInterno ?? -99) - Math.max(a.deltaT, a.deltaInterno ?? -99),
  )) {
    lines.push([
      h.modulo.block, h.modulo.tracker, h.modulo.row ?? "",
      h.modulo.stringLabel ?? h.modulo.stringNumber, h.modulo.module,
      h.celsius.toFixed(1), h.deltaT.toFixed(1), h.referenciaC.toFixed(1),
      h.vecinos, h.ambito, h.severidad,
      h.puntoCalienteC?.toFixed(1) ?? "", h.deltaInterno?.toFixed(1) ?? "",
      h.severidadInterna ?? "no resuelve", h.origen,
      h.pixeles, h.fileName,
    ].map(esc).join(","));
  }
  return lines.join("\n");
}
