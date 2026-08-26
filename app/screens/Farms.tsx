/** Lista de parques cargados en este dispositivo. */

import { useState } from "react";
import { deleteFarm, downloadFarm, saveFarm, type StoredFarm } from "../storage";
import { aplicarPlano, leerPlano } from "../plans";
import { resolverSentidoPorGeometria } from "../checks";

interface Props {
  farms: StoredFarm[];
  onNew: () => void;
  onOpen: (farm: StoredFarm) => void;
  onInspect: (farm: StoredFarm) => void;
  onAddGeometry: (farm: StoredFarm) => void;
  onParams: (farm: StoredFarm) => void;
  onStrings: (farm: StoredFarm) => void;
  onVendor: (farm: StoredFarm) => void;
  onFlight: (farm: StoredFarm) => void;
  onAnalysis: (farm: StoredFarm) => void;
  onWarranty: (farm: StoredFarm) => void;
  onChanged: () => void;
}

export function Farms({ farms, onNew, onOpen, onInspect, onAddGeometry, onParams, onStrings, onVendor, onFlight, onAnalysis, onWarranty, onChanged }: Props) {
  const [problema, setProblema] = useState<string | null>(null);
  const [plano, setPlano] = useState<{ farm: string; notas: string[]; avisos: string[] } | null>(null);
  // El problema del plano va aparte del de importar un parque: son dos botones
  // en dos puntas de la pantalla, y el error aparecia abajo de todo, lejos del
  // que lo habia apretado.
  const [problemaPlano, setProblemaPlano] = useState<string[] | null>(null);
  const [leyendo, setLeyendo] = useState<string | null>(null);

  /**
   * Cargar el plano de interconexion de un parque.
   *
   * Es lo que evita ir al campo a descubrir de que lado esta cada bloque: los
   * PDF del proyecto lo traen dibujado. Entran los PDF directo —se pueden
   * arrastrar los 36 juntos— y de paso se resuelve el sentido del conteo por
   * geometria, para que el parque quede listo en un solo paso.
   *
   * Tambien entra el all_blocks.json del extractor de escritorio, para los
   * parques que ya se procesaron asi. Se distingue por la extension, no se
   * pregunta.
   */
  async function cargarPlano(farm: StoredFarm, files: File[]) {
    setProblema(null); setPlano(null); setProblemaPlano(null);
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    const avisos: string[] = [];
    const previas: string[] = [];
    let leido: ReturnType<typeof leerPlano>;

    try {
      if (pdfs.length) {
        setLeyendo(`Abriendo ${pdfs.length} plano${pdfs.length > 1 ? "s" : ""}…`);
        // pdf.js pesa, y el que nunca carga un plano nunca lo baja.
        const { etiquetasDePdfs } = await import("../pdftext");
        const { planoDeEtiquetas } = await import("../planpdf");
        const lectura = await etiquetasDePdfs(pdfs, (hecho, total, archivo) => {
          setLeyendo(archivo ? `Leyendo ${hecho + 1} de ${total}: ${archivo}` : "Armando el plano…");
        });
        const extraido = planoDeEtiquetas(lectura.etiquetas);
        avisos.push(...lectura.avisos, ...extraido.avisos);
        previas.push(
          `De ${pdfs.length} PDF salieron ${extraido.leidas.total} textos: ` +
          `${extraido.leidas.trackers} etiquetas de tracker, ${extraido.leidas.cajas} de caja de ` +
          `continua y ${extraido.leidas.strings} de string. El resto es rotulado de la lamina.`,
        );
        leido = leerPlano(JSON.stringify(extraido.plano));
      } else {
        const f = files[0];
        if (!f) return;
        leido = leerPlano(await f.text());
      }
    } catch (e) {
      setProblemaPlano([`No pude leer el plano: ${e instanceof Error ? e.message : String(e)}`, ...avisos]);
      return;
    } finally {
      setLeyendo(null);
    }

    if ("error" in leido) { setProblemaPlano([leido.error, ...avisos]); return; }

    const a = aplicarPlano(farm.rows, leido.plano);
    const sentido = resolverSentidoPorGeometria({ profile: farm.profile, rows: a.rows });
    await saveFarm({
      ...farm,
      rows: sentido.rows,
      profile: sentido.profile,
      savedAt: new Date().toISOString(),
    });
    setPlano({
      farm: farm.profile.name,
      notas: [
        ...previas,
        `${leido.resumen.bloques} bloques, ${leido.resumen.trackers} trackers y ` +
        `${leido.resumen.cajas} cajas de continua leidos del plano.`,
        ...a.notas,
        `El sentido del conteo quedo resuelto en ${sentido.resueltas} filas.`,
      ],
      avisos,
    });
    onChanged();
  }

  async function importFarm(file: File) {
    setProblema(null);
    try {
      const farm = JSON.parse(await file.text()) as StoredFarm;
      // Sin esto, elegir el archivo equivocado no hace nada visible y parece
      // que la app se colgo.
      if (!farm?.profile?.id || !Array.isArray(farm.rows)) {
        setProblema(`"${file.name}" no es un parque exportado. Tiene que ser el .json que sale del boton Exportar.`);
        return;
      }
      await saveFarm(farm);
      onChanged();
    } catch {
      setProblema(`No pude leer "${file.name}". Si lo mandaste por mail o por chat, fijate que haya llegado entero.`);
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <p className="eyebrow">Pica</p>
          <h1>Parques</h1>
        </div>
        <button onClick={onNew}>Nuevo parque</button>
      </header>

      {farms.length === 0 ? (
        <section className="card empty">
          <h2>Todavia no hay ningun parque cargado</h2>
          <p>
            Un parque se da de alta una sola vez: cargas el archivo de coordenadas que te dio el
            cliente, confirmas que la app entendio bien las columnas, y queda listo para usar en el
            campo desde cualquier dispositivo.
          </p>
          <button onClick={onNew}>Cargar el primero</button>
        </section>
      ) : (
        <ul className="farms">
          {farms.map((f) => {
            const verified = f.profile.calibration?.status === "field-verified";
            const conStrings = f.rows.filter((r) => r.stringNumbers?.length).length;
            const conLinea = f.rows.filter((r) => r.pos != null && r.posTotal != null).length;
            const pct = (n: number) => Math.round((n / Math.max(1, f.rows.length)) * 100);
            return (
              <li key={f.profile.id}>
                <button className="farm-open" onClick={() => onOpen(f)}>
                  <strong>{f.profile.name}</strong>
                  <span className="mono">
                    {f.rows.length} filas en {new Set(f.rows.map((r) => r.block)).size} bloques ·{" "}
                    {f.profile.topology.modulesPerString} × {f.profile.topology.stringsPerRow} modulos por fila
                  </span>
                  <span className="mono muted">
                    paso {f.profile.module.widthMm + f.profile.module.gapMm} mm · bahia{" "}
                    {f.profile.topology.stringGapMm ?? 0} mm · offset{" "}
                    {f.profile.geometry.endpointOffsetMm} mm
                  </span>
                  <span className="mono muted">
                    {pct(conStrings)} % con numero de string · {pct(conLinea)} % con posicion en la linea
                  </span>
                  <span className={verified ? "chip ver" : "chip asm"}>
                    {verified ? "verificado en campo" : "sin verificar"}
                  </span>
                </button>
                <div className="farm-actions">
                  <button className="link" onClick={() => onFlight(f)}>Planificar vuelo</button>
                  <button className="link" onClick={() => onAnalysis(f)}>Analizar un vuelo</button>
                  <button className="link" onClick={() => onWarranty(f)}>Garantias</button>
                  <button className="link" onClick={() => onInspect(f)}>Inspecciones</button>
                  <button className="link" onClick={() => onParams(f)}>Ajustar parametros</button>
                  <button className="link" onClick={() => onAddGeometry(f)}>Agregar geometria</button>
                  <button className="link" onClick={() => onStrings(f)}>Lista de strings</button>
                  <label className="link comoboton">
                    Cargar los planos
                    <input
                      type="file"
                      multiple
                      onChange={(e) => {
                        const x = [...(e.target.files ?? [])];
                        // Se limpia para poder volver a elegir los mismos.
                        e.target.value = "";
                        if (x.length) void cargarPlano(f, x);
                      }}
                    />
                  </label>
                  <button className="link" onClick={() => onVendor(f)}>Auditar un informe</button>
                  <button className="link" onClick={() => downloadFarm(f)}>Exportar</button>
                  <button
                    className="link danger"
                    onClick={async () => {
                      if (confirm(`¿Borrar "${f.profile.name}" de este dispositivo?`)) {
                        await deleteFarm(f.profile.id);
                        onChanged();
                      }
                    }}
                  >
                    Borrar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {leyendo && (
        <section className="card">
          <h2>Leyendo los planos</h2>
          <p className="mono">{leyendo}</p>
          <p className="muted">
            Se abren en este dispositivo, no se suben a ningun lado. Con los 36 planos de un
            parque tarda un rato largo — dejalo terminar.
          </p>
        </section>
      )}

      {problemaPlano && (
        <section className="card">
          <h2>El plano no entro</h2>
          {problemaPlano.map((n, i) => (<p key={i} className="alert">{n}</p>))}
        </section>
      )}

      {plano && (
        <section className="card">
          <h2>El plano de {plano.farm}</h2>
          {plano.notas.map((n, i) => (<p key={i}>{n}</p>))}
          {plano.avisos.length > 0 && (
            <>
              <h3>Lo que no salió redondo</h3>
              {plano.avisos.map((n, i) => (<p key={i} className="muted">{n}</p>))}
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Pasar un parque de un dispositivo a otro</h2>
        <p>
          Los parques viven en el navegador donde los cargaste y no se suben a ningun lado — por
          eso la app funciona sin señal en el campo. Para tener el mismo parque en la compu y en
          el celular hay que pasarlo a mano, y va entero: las filas, la lista de strings, los
          parametros y los conteos de campo.
        </p>
        <ol className="pasos">
          <li>En el dispositivo que ya lo tiene, <strong>Exportar</strong>. Baja un archivo .json.</li>
          <li>Mandatelo al otro: AirDrop, mail o mensaje a vos mismo.</li>
          <li>Abrilo desde acá con el boton de abajo.</li>
        </ol>
        <label className="import">
          Importar un parque exportado
          <input
            type="file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFarm(f); }}
          />
        </label>
        {problema && <p className="alert">{problema}</p>}
      </section>
    </div>
  );
}
