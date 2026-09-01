/**
 * Los formatos en que se entrega una inspeccion.
 *
 * Habia uno solo —un CSV— y no alcanza. El proveedor con el que compite este
 * trabajo entrega un Excel con los datos y un link a la foto de cada hallazgo,
 * y el cliente ya esta acostumbrado a eso. Un CSV con nombres de archivo al
 * lado de una carpeta de 4000 fotos es menos que eso.
 *
 * Y hay una razon tecnica, no de presentacion: el numero dice CUANTO y el
 * patron de la imagen dice QUE ES. Una celda puntual es un punto caliente; un
 * tercio de placa parejo es un diodo de bypass; el modulo entero tibio es que
 * esta desconectado. Sin la foto al lado del numero, el informe no se puede
 * usar para un reclamo de garantia.
 *
 * Cuatro salidas, y cada una para algo distinto:
 *
 *   Excel     lo que entrega el otro proveedor, para no quedar abajo.
 *   Fotos     las de los hallazgos, RENOMBRADAS por su direccion. Es la
 *             diferencia: el link del otro apunta a DJI_0234_T.JPG y el de
 *             este a 17-042_R1_m19_+14.3C.jpg — se entiende sin abrir nada.
 *   Informe   un solo HTML con las fotos adentro. Se abre en cualquier
 *             navegador sin carpeta al lado, y con Cmd+P sale el PDF.
 *   CSV       para el que lo mete en su propio sistema.
 */

import type { Cardinal, FarmProfile } from "@locator";
import { deltaTDe, type Finding, type Inspection } from "./inspection";

// ---------------------------------------------------------------------------
// El nombre de la foto
// ---------------------------------------------------------------------------

/** Saca de un texto lo que rompe un nombre de archivo. */
const limpio = (s: string) => s.replace(/[^\w.+-]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Como se llama la foto de un hallazgo en la carpeta que se entrega.
 *
 * Esta funcion es el diferencial del entregable y por eso vive aparte y con
 * test. El nombre lleva la direccion completa y el delta, en ese orden, para
 * que la carpeta ordenada alfabeticamente quede agrupada por bloque y tracker
 * — que es como camina una cuadrilla.
 *
 * Se conserva el nombre original al final: sin eso no hay forma de volver del
 * informe a la foto cruda del vuelo, y eso hace falta cuando alguien discute
 * un hallazgo.
 */
export function nombreDeFoto(f: Finding): string {
  const a = f.address;
  // El del tecnico si lo corrigio, y si no el que midio el motor. Antes solo
  // miraba el de la persona, asi que con la deteccion automatica —que mide
  // TODOS los hallazgos y no pide que nadie transcriba nada— la carpeta salia
  // entera sin el delta en el nombre, que es la mitad de para que sirve.
  const dt = deltaTDe(f);
  const partes = [
    a?.block ? `B${limpio(String(a.block))}` : "sin-bloque",
    a?.tracker ? limpio(String(a.tracker)) : "",
    a?.row ? limpio(String(a.row)) : "",
    a?.module != null ? `m${a.module}` : "",
    dt != null ? `${dt >= 0 ? "+" : ""}${dt.toFixed(1)}C` : "",
    f.anomaly ? limpio(f.anomaly) : "",
  ].filter(Boolean);
  const base = partes.join("_");
  const ext = /\.[a-z0-9]+$/i.exec(f.fileName)?.[0] ?? ".jpg";
  const original = f.fileName.replace(/\.[a-z0-9]+$/i, "");
  return `${base}__${limpio(original)}${ext}`;
}

// ---------------------------------------------------------------------------
// Las columnas, una sola vez
// ---------------------------------------------------------------------------

/**
 * Una fila de la tabla, con los valores ya presentados.
 *
 * El CSV tenia esta lista escrita adentro suyo. Agregar el Excel copiandola
 * habria dejado dos listas de columnas que se desincronizan en el primer
 * cambio — y el cliente recibiendo dos archivos que no dicen lo mismo. Se
 * arma una vez y la usan los tres formatos.
 */
export const COLUMNAS = [
  "archivo", "foto", "fecha", "latitud", "longitud", "precision_m",
  "bloque", "tracker", "fila", "string", "modulo", "conteo_desde", "caja_dc",
  "modulo_corregido", "confianza", "anomalia", "clase", "delta_t",
  // Lo que midio el motor. Va DESPUES de la clasificacion humana y no en vez
  // de ella: el que recibe el archivo tiene que poder ver las dos mitades y
  // cual es cual. Un entregable donde no se distingue lo que midio la maquina
  // de lo que escribio una persona no se puede defender en un reclamo.
  "temperatura_c", "delta_t_medido", "referencia_c", "vecinos", "comparado_contra",
  "delta_t_celda", "severidad",
  "estado", "nota", "avisos",
] as const;

export function filaDe(f: Finding): Array<string | number> {
  const a = f.address;
  const m = f.medicion;
  /*
    La coordenada que se entrega es la del MODULO, no la del dron.

    Salia de `f.fix`, que es donde estaba el DRON cuando disparo — que con el
    gimbal a plomo y 30 m de altura son unos metros de diferencia, y con el
    gimbal inclinado bastante mas. Mientras un hallazgo era una foto, esa era
    la unica coordenada que habia. Ahora un hallazgo es un modulo, y el centro
    del modulo lo da la geometria relevada del parque: es exacto, y es el punto
    al que hay que caminar. La del dron queda de respaldo para los vuelos
    viejos, que no tienen otra.
  */
  const punto = a?.center ?? (f.fix ? { lat: f.fix.lat, lon: f.fix.lon } : null);
  return [
    f.fileName,
    nombreDeFoto(f),
    f.fix?.takenAt ?? "",
    punto ? Number(punto.lat.toFixed(7)) : "",
    punto ? Number(punto.lon.toFixed(7)) : "",
    f.fix?.accuracyM ?? "",
    a?.block ?? "",
    a?.tracker ?? "",
    a?.row ?? "",
    a?.stringNumber ?? "",
    a?.module ?? "",
    a ? (a.countedFrom === "near-dc" ? "caja DC" : "punta lejana") : "",
    a?.dcBoxLabel ?? "",
    f.moduleCorregido ?? "",
    a ? `${(a.confidence * 100).toFixed(0)}%` : "",
    f.anomaly ?? "",
    f.klass ?? "",
    f.deltaT ?? "",
    m ? Number(m.celsius.toFixed(1)) : "",
    m ? Number(m.deltaT.toFixed(1)) : "",
    m ? Number(m.referenciaC.toFixed(1)) : "",
    m ? m.vecinos : "",
    // Contra que vecindario se comparo. "su string" es el bueno; los otros
    // salen marcados porque su delta vale menos, y esconderlo seria entregar
    // dos numeros con la misma pinta y distinto valor.
    m ? (m.ambito === "string" ? "su string" : `${m.ambito} — vecindario flojo`) : "",
    m?.deltaInterno != null ? Number(m.deltaInterno.toFixed(1)) : "",
    m?.peor ?? "",
    f.status,
    f.note ?? "",
    f.warnings.map((w) => w.code).join(" "),
  ];
}

/** Los hallazgos que se entregan. Los descartados quedan afuera, en todos los formatos. */
export function entregables(i: Inspection): Finding[] {
  return i.findings.filter((f) => f.status !== "descartado");
}

// ---------------------------------------------------------------------------
// El datum del numero de modulo
// ---------------------------------------------------------------------------

const RUMBOS: Record<Cardinal, string> = {
  north: "norte",
  south: "sur",
  east: "este",
  west: "oeste",
};

/**
 * Desde que punta se cuentan los modulos, dicho para el que recibe el informe.
 *
 * El numero de modulo no es un nombre grabado en el panel: es una POSICION
 * contada desde una punta. Sin decir cual, "modulo 19" no se puede verificar
 * contra nada — el que camina la fila con el papel en la mano no sabe de que
 * lado empezar a contar, y dos informes del mismo parque hechos con reglas
 * distintas se leen exactamente iguales.
 *
 * Eso dejo de ser teorico cuando el parque paso a contar desde el extremo
 * norte: los parques ya cargados conservan su regla vieja a proposito, asi que
 * conviven informes del mismo sitio numerados al reves entre si. La unica cosa
 * que los distingue es esta linea.
 *
 * La frase sale de `addressing` y no esta escrita a mano: si el parque cuenta
 * desde la caja de continua, el papel dice eso. Un informe que declara una
 * convencion que el parque no usa es peor que uno que no declara ninguna.
 *
 * Sin `addressing` devuelve `null` y el informe sale como salia. Un llamador
 * que no tenga el perfil a mano no puede terminar declarando una regla falsa.
 */
export function convencionDeConteo(addressing?: FarmProfile["addressing"]): string | null {
  if (!addressing) return null;

  let frase: string;
  switch (addressing.originStrategy) {
    case "fixed-end": {
      const rumbo = addressing.fixedEnd ? RUMBOS[addressing.fixedEnd] : null;
      // Un `fixed-end` sin rumbo es un perfil roto: el motor tampoco sabe de
      // que punta contar y avisa. Antes que declarar una punta inventada en el
      // entregable, no se declara ninguna.
      if (!rumbo) return null;
      frase = `Los modulos se numeran desde el extremo ${rumbo} de cada string.`;
      break;
    }
    case "dc-box-end":
      frase =
        "Los modulos se numeran desde el extremo de cada string mas cercano a su caja de continua.";
      break;
    case "per-row-flag":
      frase =
        "Los modulos se numeran desde el extremo que el relevamiento declara para cada fila.";
      break;
  }

  /*
    La inversion va en la misma frase, y no es un detalle interno: decide de que
    punta se cuenta la mitad de los strings del parque. Declarar solo la regla
    del origen y callarse esto dejaria la linea mintiendo en todas las filas de
    mas de un string, que es justo donde el error cuesta 65 metros de caminata.
  */
  if (addressing.inversionStrategy === "piercing-chain") {
    frase +=
      " En las filas con mas de un string, el string mas lejano al origen se cuenta al reves," +
      " desde la punta opuesta: es donde esta su conexion.";
  } else if (addressing.inversionStrategy === "per-string-flag") {
    frase += " Los strings marcados en el relevamiento se cuentan al reves, desde la punta opuesta.";
  }

  return frase;
}

/**
 * Lo que el vuelo miro y lo que no, en frases cortas para el encabezado.
 *
 * Va con los metadatos y no como columnas al lado de cada hallazgo: es una
 * propiedad del VUELO, no del defecto. Y va en los cuatro formatos porque es
 * justo lo que un informe de garantia necesita declarar — sin esto, el que lo
 * recibe no puede distinguir "ese modulo esta sano" de "ese modulo no cayo en
 * ninguna foto", que son cosas opuestas y se leen igual de bien en una tabla
 * que no las nombra.
 */
export function cobertura(i: Inspection): Array<[string, string]> {
  const c = i.cobertura;
  if (!c) return [];
  const u = c.umbrales;
  return [
    ["Fotos del vuelo", `${c.fotos} archivos, ${c.fotosTermicas} con temperatura adentro`],
    ["Resolucion", `${c.gsdCm.toFixed(1)} cm por pixel`],
    [
      "Modulos medidos",
      c.totalModulos
        ? `${c.modulosMedidos} de ${c.totalModulos} del parque` +
          (c.sinMedir ? ` — ${c.sinMedir} no cayeron en ninguna foto` : "")
        : `${c.modulosMedidos}`,
    ],
    ...(c.soloEnElBorde
      ? ([[
          "Modulos no medidos por el borde",
          `${c.soloEnElBorde} aparecieron solo cortados por el borde del cuadro`,
        ]] as Array<[string, string]>)
      : []),
    ["Umbrales de ΔT", `leve ${u.leve} · moderada ${u.moderada} · critica ${u.critica} °C`],
  ];
}

export function condiciones(
  i: Inspection,
  addressing?: FarmProfile["addressing"],
): Array<[string, string]> {
  const c = i.conditions;
  const filas: Array<[string, unknown]> = [
    ["Inspeccion", i.name],
    ["Parque", i.farmName],
    ["Fecha", i.createdAt],
    ["Irradiancia (W/m²)", c.irradianceWm2],
    ["Temperatura ambiente (°C)", c.ambientC],
    ["Viento (m/s)", c.windMs],
    ["Cielo", c.sky],
    ["Piloto", c.pilot],
    ["Equipo", c.equipment],
  ];
  /*
    La convencion va aca, con los metadatos, y no como una columna al lado de
    cada hallazgo: es una propiedad del parque, no del defecto. Repetirla en 400
    filas no la hace mas cierta y esconde que es UNA declaracion —la del
    contrato— que vale para el archivo entero.
  */
  const convencion = convencionDeConteo(addressing);
  if (convencion) filas.push(["Numeracion de modulos", convencion]);
  return [
    ...filas.map(([k, v]): [string, string] => [
      k,
      v == null || v === "" ? "sin registrar" : String(v),
    ]),
    ...cobertura(i),
  ];
}

/**
 * Lo que el vuelo no permite afirmar, como filas de una tabla.
 *
 * Van aparte de `condiciones` porque el informe HTML las muestra en su propia
 * caja —son lo primero que tiene que leer el que recibe el informe— mientras
 * que el Excel y el CSV, que son tablas planas, las llevan abajo del resto del
 * encabezado. La lista es la misma en los tres.
 */
export function limitacionesComoFilas(i: Inspection): Array<[string, string]> {
  return (i.cobertura?.limitaciones ?? []).map(
    (l, n): [string, string] => [n === 0 ? "No se puede afirmar" : "", l],
  );
}

// ---------------------------------------------------------------------------
// El informe visual
// ---------------------------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export interface FotoEmbebida {
  /** El nombre original del archivo del vuelo. */
  fileName: string;
  /** `data:image/jpeg;base64,…` */
  dataUrl: string;
}

/**
 * El informe, en un solo archivo HTML.
 *
 * Se eligio HTML y no PDF, y conviene decir por que: generar un PDF en el
 * navegador pide una libreria mas y da un archivo mas pesado, mas dificil de
 * buscar y que no se puede reordenar. Un HTML autocontenido —las fotos van
 * embebidas como data URL, no como link a una carpeta— se abre en cualquier
 * lado, pesa menos, y con imprimir a PDF da el PDF igual. El cliente que
 * quiere PDF lo tiene; el que quiere buscar por tracker tambien.
 *
 * Sin fotos igual sale: un informe sin imagenes sigue siendo util, y fallar
 * porque falta una foto seria peor.
 *
 * `addressing` llega desde afuera —la inspeccion guardada no lo tiene, guarda
 * el nombre del parque y nada mas— y es opcional para no romper a nadie que ya
 * llame a esta funcion. Si no viene, el encabezado sale sin la linea de la
 * convencion, que es como salia antes; lo que no puede pasar es que salga con
 * una linea inventada.
 */
export function aInformeHtml(
  i: Inspection,
  fotos: FotoEmbebida[] = [],
  addressing?: FarmProfile["addressing"],
): string {
  const porNombre = new Map(fotos.map((f) => [f.fileName, f.dataUrl]));
  const lista = entregables(i);

  // Agrupado por bloque: es como se camina el parque y como se reparte el
  // trabajo de reparacion.
  const porBloque = new Map<string, Finding[]>();
  for (const f of lista) {
    const b = f.address?.block ?? "sin bloque";
    porBloque.set(b, [...(porBloque.get(b) ?? []), f]);
  }

  /*
    De que color sale la tarjeta.

    Manda la severidad que calculo el motor —que ya mira las DOS comparaciones,
    la del modulo contra su string y la de la celda contra su propio modulo— y
    no un numero suelto contra tres constantes escritas aca. Un modulo con una
    celda 30 °C por encima de si mismo tiene ΔT de modulo casi cero: pintado
    por el ΔT solo, el defecto mas comun de todos salia sin color.

    Los vuelos viejos no traen medicion y siguen saliendo como salian.
  */
  const severidad = (f: Finding) => {
    if (f.medicion) return f.medicion.peor === "normal" ? "" : f.medicion.peor;
    const dt = deltaTDe(f);
    return dt == null ? "" : dt >= 20 ? "critica" : dt >= 10 ? "moderada" : dt >= 3 ? "leve" : "";
  };

  const grados = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} °C`;

  const tarjeta = (f: Finding) => {
    const a = f.address;
    const m = f.medicion;
    const img = porNombre.get(f.fileName);
    const dt = deltaTDe(f);
    return `<article class="h ${severidad(f)}">
  <h3>${esc(a?.block ?? "?")} · ${esc(a?.tracker ?? "?")}${a?.row ? " " + esc(a.row) : ""} · modulo ${esc(a?.module ?? "?")}</h3>
  <dl>
    <dt>String</dt><dd>${esc(a?.stringNumber ?? "—")}</dd>
    <dt>Caja DC</dt><dd>${esc(a?.dcBoxLabel ?? "—")}</dd>
    <dt>Se cuenta desde</dt><dd>${a ? (a.countedFrom === "near-dc" ? "la caja DC" : "la punta lejana") : "—"}</dd>
    <dt>ΔT</dt><dd>${dt != null ? `<strong>${grados(dt)}</strong>` : "—"}</dd>
    ${m ? `<dt>Medicion</dt><dd>${m.celsius.toFixed(1)} °C · <strong>${grados(m.deltaT)}</strong> contra ${m.vecinos} ${
      m.ambito === "string" ? "vecinos de su mismo string" : `vecinos (comparado por ${esc(m.ambito)} — vecindario flojo)`
    }</dd>` : ""}
    ${m?.deltaInterno != null ? `<dt>Punto caliente</dt><dd>${grados(m.deltaInterno)} por encima del propio modulo${
      m.origen === "celda" ? " — eso es una celda, no el modulo entero" : ""
    }</dd>` : ""}
    <dt>Anomalia</dt><dd>${esc(f.anomaly ?? "sin clasificar")}${f.klass ? ` (clase ${f.klass})` : ""}</dd>
    <dt>Archivo</dt><dd><code>${esc(f.fileName)}</code></dd>
  </dl>
  ${f.note ? `<p class="nota">${esc(f.note)}</p>` : ""}
  ${img ? `<img src="${img}" alt="${esc(f.fileName)}">` : `<p class="sinfoto">Sin la foto: no estaba en la carpeta elegida.</p>`}
</article>`;
  };

  /*
    Lo que este vuelo NO permite afirmar, arriba de todo y no en una nota al pie.

    Es lo que separa un informe defendible de una lista de defectos. Los
    modulos que no cayeron en ninguna foto y los que aparecieron solo cortados
    por el borde del cuadro NO estan sanos: no se miraron. Callarlo convierte
    un informe parcial en uno que parece completo, y eso es lo que se rompe
    cuando alguien lo usa para un reclamo.
  */
  const limitaciones = i.cobertura?.limitaciones ?? [];
  const noAfirma = limitaciones.length
    ? `<section class="limites"><h2>Lo que este vuelo no permite afirmar</h2>${
        limitaciones.map((l) => `<p>${esc(l)}</p>`).join("")
      }</section>`
    : "";

  const bloques = [...porBloque.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([b, fs]) => `<section><h2>Bloque ${esc(b)} — ${fs.length} hallazgo${fs.length === 1 ? "" : "s"}</h2>${fs.map(tarjeta).join("")}</section>`)
    .join("");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(i.name)} — ${esc(i.farmName)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #1a1a1a; background: #fff;
         max-width: 900px; margin: 0 auto; padding: 2rem 1.25rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .sub { color: #666; margin: 0 0 1.5rem; }
  table.cond { border-collapse: collapse; margin-bottom: 2rem; }
  table.cond th { text-align: left; font-weight: 600; padding: .2rem 1.5rem .2rem 0; color: #444; }
  table.cond td { padding: .2rem 0; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .75rem; padding-bottom: .3rem; border-bottom: 2px solid #e4e4e4; }
  .h { border: 1px solid #e0e0e0; border-left: 5px solid #bbb; border-radius: 6px;
       padding: .9rem 1.1rem; margin-bottom: 1rem; break-inside: avoid; page-break-inside: avoid; }
  .h.leve     { border-left-color: #d9a441; }
  .h.moderada { border-left-color: #d9702b; }
  .h.critica  { border-left-color: #c0392b; }
  .h h3 { margin: 0 0 .5rem; font-size: 1.02rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; margin: 0 0 .6rem; }
  dt { color: #666; } dd { margin: 0; }
  .nota { background: #f6f6f6; padding: .5rem .7rem; border-radius: 4px; margin: 0 0 .6rem; }
  .h img { max-width: 100%; border-radius: 4px; display: block; }
  .sinfoto { color: #888; font-style: italic; margin: 0; }
  .limites { background: #fdf6e3; border: 1px solid #e6d9a8; border-radius: 6px; padding: .8rem 1.1rem; }
  .limites h2 { margin-top: 0; border: 0; font-size: 1.05rem; }
  .limites p { margin: .4rem 0; }
  code { font-size: .88em; background: #f2f2f2; padding: .1em .35em; border-radius: 3px; }
  @media print { body { max-width: none; padding: 0; } .h { border-left-width: 4px; } }
</style></head><body>
<h1>${esc(i.name)}</h1>
<p class="sub">${esc(i.farmName)} · ${esc(lista.length)} hallazgo${lista.length === 1 ? "" : "s"} en ${porBloque.size} bloque${porBloque.size === 1 ? "" : "s"}</p>
<table class="cond"><tbody>${condiciones(i, addressing).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>
${noAfirma}
${bloques}
</body></html>`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Las condiciones del vuelo, arriba de la tabla.
 *
 * La pantalla dice "la norma de termografia exige documentarlas en el reporte"
 * y despues las guardaba en la base y nada mas: el CSV, que ES el reporte que
 * se entrega, no las llevaba. Se cargaban seis campos en el campo, con frio,
 * para nada.
 *
 * Van como encabezado con una linea en blanco antes de la tabla: Excel lo abre
 * igual y el que recibe el archivo las ve sin tener que preguntar.
 *
 * Las claves van en minuscula y con guion bajo, y no con las etiquetas del
 * Excel: este archivo es el que alguien mete en su propio sistema, y ahi una
 * clave estable vale mas que una linda.
 */
function cabeceraDeCondiciones(i: Inspection): string[] {
  const c = i.conditions;
  const filas: Array<[string, unknown]> = [
    ["inspeccion", i.name],
    ["parque", i.farmName],
    ["fecha", i.createdAt],
    ["irradiancia_wm2", c.irradianceWm2],
    ["temperatura_ambiente_c", c.ambientC],
    ["viento_ms", c.windMs],
    ["cielo", c.sky],
    ["piloto", c.pilot],
    ["equipo", c.equipment],
  ];
  const cob = i.cobertura;
  if (cob) {
    filas.push(
      ["fotos_del_vuelo", cob.fotos],
      ["fotos_con_temperatura", cob.fotosTermicas],
      ["cm_por_pixel", cob.gsdCm.toFixed(1)],
      ["modulos_del_parque", cob.totalModulos],
      ["modulos_medidos", cob.modulosMedidos],
      ["modulos_sin_medir", cob.sinMedir],
      ["modulos_cortados_por_el_borde", cob.soloEnElBorde],
      ["umbral_leve_c", cob.umbrales.leve],
      ["umbral_moderada_c", cob.umbrales.moderada],
      ["umbral_critica_c", cob.umbrales.critica],
    );
    // Lo que el vuelo no permite afirmar, una fila numerada por frase. Un
    // informe que no dice que NO miro no sirve para un reclamo, y este es el
    // formato que se importa a otro sistema: si no esta como fila, se pierde.
    cob.limitaciones.forEach((l, n) => filas.push([`no_se_puede_afirmar_${n + 1}`, l]));
  }
  return [
    ...filas.map(([k, v]) => [k, v == null || v === "" ? "sin registrar" : v].map(csvCell).join(",")),
    "",
  ];
}

/**
 * Exporta los hallazgos a CSV. Solo los descartados quedan afuera.
 *
 * Vivia en `inspection.ts` con su propia lista de columnas, al lado de la de
 * este archivo. Dos listas para la misma tabla: el mismo vuelo salia con una
 * columna de diferencia segun por que boton se lo pidiera, y en el primer
 * cambio que tocara una sola de las dos, con datos distintos. Ahora los cuatro
 * formatos arman la fila con la misma funcion.
 */
export function toCsv(inspection: Inspection): string {
  const rows = [...cabeceraDeCondiciones(inspection), [...COLUMNAS].join(",")];
  for (const f of entregables(inspection)) {
    rows.push(filaDe(f).map(csvCell).join(","));
  }
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

/**
 * El Excel de entrega, con el link a la foto.
 *
 * El link es RELATIVO a la carpeta de fotos que se descarga aparte. No es un
 * link a internet a proposito: el informe tiene que abrirse dentro de diez
 * anios y en una notebook sin senal, que es donde se revisa una garantia.
 * Excel resuelve el link relativo si la carpeta esta al lado del archivo.
 *
 * Las condiciones del vuelo van arriba, antes de la tabla. La norma de
 * termografia exige documentarlas, y un entregable que las pide en la pantalla
 * y despues no las lleva hace cargar seis campos para nada.
 */
export async function aExcel(
  i: Inspection,
  carpeta = "fotos",
  addressing?: FarmProfile["addressing"],
): Promise<Uint8Array<ArrayBuffer>> {
  const XLSX = await import("xlsx");
  const lista = entregables(i);

  /*
    Las condiciones se arman UNA vez y se guardan.

    Se llamaban dos veces —una para escribirlas y otra para contar cuantas
    filas ocupan y ubicar el hipervinculo—. Mientras la lista era fija daba lo
    mismo, pero ahora tiene una fila que aparece o no segun el parque: dos
    llamadas con argumentos distintos dejarian todos los links corridos una
    fila, apuntando cada uno a la foto del hallazgo de arriba.
  */
  const meta = [...condiciones(i, addressing), ...limitacionesComoFilas(i)];

  const filas: Array<Array<string | number>> = [
    ...meta.map(([k, v]) => [k, v]),
    [],
    [...COLUMNAS],
    ...lista.map(filaDe),
  ];

  const hoja = XLSX.utils.aoa_to_sheet(filas);

  /*
    El hipervinculo en la columna de la foto.

    Va sobre la celda que ya tiene el nombre nuevo, asi que el que abre el
    Excel ve el nombre legible y al hacer click se le abre la foto. Sin esto la
    columna seria texto y habria que buscar el archivo a mano.
  */
  const filaCabecera = meta.length + 1; // 0-based: condiciones + linea en blanco
  const colFoto = COLUMNAS.indexOf("foto");
  lista.forEach((f, n) => {
    const ref = XLSX.utils.encode_cell({ r: filaCabecera + 1 + n, c: colFoto });
    const celda = hoja[ref];
    if (celda) celda.l = { Target: `${carpeta}/${nombreDeFoto(f)}`, Tooltip: "Abrir la foto termica" };
  });

  hoja["!cols"] = [...COLUMNAS].map((c) => ({ wch: Math.max(10, Math.min(34, c.length + 6)) }));

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Hallazgos");
  return new Uint8Array(XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer) as Uint8Array<ArrayBuffer>;
}
