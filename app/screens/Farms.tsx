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
  onFlight: (farm: StoredFarm) => void;
  onChanged: () => void;
}

export function Farms({ farms, onNew, onOpen, onInspect, onAddGeometry, onParams, onStrings, onFlight, onChanged }: Props) {
  const [problema, setProblema] = useState<string | null>(null);
  const [plano, setPlano] = useState<{ farm: string; notas: string[]; avisos: string[] } | null>(null);
  // El problema del plano va aparte del de importar un parque: son dos botones
  // en dos puntas de la pantalla, y el error aparecia abajo de todo, lejos del
  // que lo habia apretado.
  const [problemaPlano, setProblemaPlano] = useState<string[] | null>(null);
  const [leyendo, setLeyendo] = useState<string | null>(null);
  /**
   * Los ultimos PDF que se intentaron leer, y una etiqueta de ejemplo.
   *
   * Sirven para volver a leer el mismo lote con otro formato de nombre sin
   * tener que volver a elegir 36 archivos a mano.
   */
  const [ultimosPdfs, setUltimosPdfs] = useState<{ farm: StoredFarm; files: File[] } | null>(null);
  const [ejemploTracker, setEjemploTracker] = useState("");

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
  async function cargarPlano(farm: StoredFarm, files: File[], ejemploDeTracker?: string) {
    setProblema(null); setPlano(null); setProblemaPlano(null);
    // Se guardan para poder releerlos con otro formato de etiqueta sin volver a
    // elegir los 36 archivos.
    setUltimosPdfs({ farm, files });
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
        const extraido = planoDeEtiquetas(
          lectura.etiquetas,
          ejemploDeTracker ? { ejemploDeTracker } : {},
        );
        avisos.push(...lectura.avisos, ...extraido.avisos);
        previas.push(
          `De ${pdfs.length} PDF salieron ${extraido.leidas.total} textos: ` +
          `${extraido.leidas.trackers} etiquetas de tracker, ${extraido.leidas.cajas} de caja de ` +
          `continua y ${extraido.leidas.strings} de string. El resto es rotulado de la lamina.` +
          (extraido.patron ? ` Formato de nombre: ${extraido.patron}.` : ""),
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

    /*
      El orden importa, y estaba al reves.

      `resolverSentidoPorGeometria` deduce la calle del medio midiendo huecos
      entre las picas del relevamiento. `aplicarPlano` ahora la LEE de la
      etiqueta de cada tracker, donde el plano la trae escrita. Corriendo la
      geometria despues del plano, la deduccion pisaba el dato — justo al
      reves de lo que corresponde.

      Ahora el heuristico va primero y queda de relleno: cubre los bloques que
      el plano no resuelve, y el plano manda sobre los que si.
    */
    const sentido = resolverSentidoPorGeometria({ profile: farm.profile, rows: farm.rows });
    const a = aplicarPlano(sentido.rows, leido.plano, farm.profile.addressing.dcBoxPlacement);
    await saveFarm({
      ...farm,
      rows: a.rows,
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
        a.conSentido
          ? `El sentido del conteo salio del PLANO en ${a.conSentido} filas` +
            (sentido.resueltas ? `, y de medir las coordenadas en otras ${sentido.resueltas}.` : ".") +
            ` Sumando lo que ya estaba, el parque queda con ${a.conSentidoTotal} de ${a.rows.length} ` +
            `filas resueltas.`
          : `El sentido del conteo quedo resuelto en ${sentido.resueltas} filas, midiendo coordenadas.`,
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
                {/*
                  Los mismos datos, con rotulo.

                  Eran tres renglones de mono gris seguidos —"24 filas en 1
                  bloques · 28 × 2 modulos por fila · paso 1155 mm · bahia 555
                  mm..."— donde para saber que era cada numero habia que leer la
                  palabra de al lado. Un tablero con el rotulo abajo se lee de un
                  vistazo y se compara entre parques de arriba abajo.
                */}
                <button className="farm-open" onClick={() => onOpen(f)}>
                  <span className="farm-cab">
                    <strong>{f.profile.name}</strong>
                    <span className={verified ? "chip ver" : "chip asm"}>
                      {verified ? "verificado en campo" : "sin verificar"}
                    </span>
                  </span>
                  <span className="farm-datos">
                    <div>
                      <b>{f.rows.length}</b>
                      <span>filas</span>
                    </div>
                    <div>
                      <b>{new Set(f.rows.map((r) => r.block)).size}</b>
                      <span>bloques</span>
                    </div>
                    <div>
                      <b>{f.profile.topology.modulesPerString} × {f.profile.topology.stringsPerRow}</b>
                      <span>módulos por fila</span>
                    </div>
                    <div>
                      <b>{f.profile.module.widthMm + f.profile.module.gapMm} mm</b>
                      <span>paso</span>
                    </div>
                    <div>
                      <b>{pct(conStrings)} %</b>
                      <span>con nº de string</span>
                    </div>
                    <div>
                      <b>{pct(conLinea)} %</b>
                      <span>con posición</span>
                    </div>
                  </span>
                </button>
                {/*
                  Once botones iguales en una sola fila, con "Borrar" al lado de
                  "Exportar". Con guantes y sol de frente eso es un accidente
                  esperando. Ahora van en tres grupos con titulo, en el orden en
                  que se usan, y el de borrar queda solo y aparte.
                */}
                <div className="farm-actions">
                  <div className="grupo">
                    <span className="grupo-tit">Antes de volar</span>
                    <button className="link" onClick={() => onFlight(f)}>Planificar vuelo</button>
                    <label className="link comoboton">
                      Cargar los planos
                      <input
                        type="file"
                        multiple
                        onChange={(e) => {
                          const x = [...(e.target.files ?? [])];
                          // Se limpia para poder volver a elegir los mismos.
                          e.target.value = "";
                          if (x.length) void cargarPlano(f, x, ejemploTracker.trim() || undefined);
                        }}
                      />
                    </label>
                    <button className="link" onClick={() => onStrings(f)}>Lista de strings</button>
                  </div>

                  {/*
                    Una sola opcion despues de volar, y no dos.
                    ===============================================
                    Habia "Analizar un vuelo" y "Inspecciones", que cargaban
                    las mismas fotos y daban dos listas que no se conocian: la
                    deteccion buena en una pantalla y la revision buena en la
                    otra. No habia forma de explicar la diferencia porque no
                    era una diferencia, era un defecto de diseno.
                  */}
                  <div className="grupo">
                    <span className="grupo-tit">Despues de volar</span>
                    <button className="link" onClick={() => onInspect(f)}>Vuelos</button>
                  </div>

                  <div className="grupo">
                    <span className="grupo-tit">El parque</span>
                    <button className="link" onClick={() => onParams(f)}>Ajustar parametros</button>
                    <button className="link" onClick={() => onAddGeometry(f)}>Agregar geometria</button>
                    <button className="link" onClick={() => downloadFarm(f)}>Exportar</button>
                  </div>

                  <div className="grupo aparte">
                    <button
                      className="link danger"
                      onClick={async () => {
                        if (confirm(
                          `¿Borrar "${f.profile.name}" de este dispositivo?\n\n` +
                          `Se van las ${f.rows.length} filas, los parametros calibrados y las ` +
                          `inspecciones. Si no lo exportaste antes, no hay forma de recuperarlo.`,
                        )) {
                          await deleteFarm(f.profile.id);
                          onChanged();
                        }
                      }}
                    >
                      Borrar el parque
                    </button>
                  </div>
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

          {/*
            La salida sin la cual esta pantalla es un callejon.
            ===================================================================
            El lector conoce varios formatos de nombre, pero no puede conocerlos
            todos: cada proyecto bautiza sus trackers como quiere. Cuando ninguno
            engancha, arriba se listan las formas de texto que SI trae el PDF —
            y acá se copia una y el lector aprende el formato y vuelve a leer.

            Sin esto, "el archivo no tiene ningun bloque" es el final del camino
            y el parque no se puede cargar hasta que alguien toque el codigo.
          */}
          {ultimosPdfs && (
            <div className="field">
              <label htmlFor="ej-tracker">Enseñale el formato: copiá una etiqueta de tracker del plano</label>
              <div className="row">
                <input
                  id="ej-tracker" type="text" placeholder="ej: 05-042-R1"
                  value={ejemploTracker}
                  onChange={(e) => setEjemploTracker(e.target.value)}
                />
                <button
                  disabled={!ejemploTracker.trim() || !!leyendo}
                  onClick={() => void cargarPlano(ultimosPdfs.farm, ultimosPdfs.files, ejemploTracker.trim())}
                >
                  Volver a leer con ese formato
                </button>
              </div>
              <span className="help">
                Abrí el PDF, buscá el número que identifica un tracker cualquiera y copialo tal cual
                está escrito. De ahí saco el formato de todo el parque: los grupos de números son el
                bloque, el tracker y —si la trae— la fila.
              </span>
            </div>
          )}
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
