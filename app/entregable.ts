/**
 * El Excel que se le entrega al cliente.
 *
 * Es un archivo distinto del CSV de trabajo, y con razon. El CSV existe para
 * que alguien lo importe a su sistema: claves estables, todo el detalle, sin
 * formato. Este se abre, se lee y se usa para mandar una cuadrilla — y lo lee
 * gente que no estuvo en el vuelo, en ingles, en el telefono.
 *
 * Tres decisiones que vienen de la revision que hizo Mateo sobre el primer
 * entregable real:
 *
 *   - Se fueron cinco columnas que no le sirven a nadie afuera: la precision
 *     de la geolocalizacion, el modulo corregido a mano, la confianza de la
 *     direccion, el ΔT que escribe el tecnico y la cantidad de vecinos. Eran
 *     el andamio del calculo, no el resultado.
 *   - Las que quedan se llaman por lo que son. "delta_t_celda" no lo entiende
 *     nadie; "Hotspot ΔT vs module (°C)" si.
 *   - Va con formato: encabezado fijo, filtro, clases pintadas. Un Excel de
 *     sesenta filas sin filtro es una lista; con filtro es una herramienta.
 */
import type { FarmProfile } from "@locator";
import type { Severidad } from "./detect";
import type { Finding, Inspection } from "./inspection";
import { entregables } from "./informe";
import { isotipoPng, lockup, MARCA } from "./marca";

/** Como se dice cada cosa en el entregable. */
/*
  Los once patrones, en el ingles con el que se los nombra en la industria.

  Estan LOS ONCE de `ANOMALIAS`, no solo los cinco que sabe clasificar el
  motor: los otros seis los pone Mateo a mano en el revisor, y si falta uno la
  celda del Excel sale en castellano en medio de una planilla en ingles.
*/
export const ANOMALIA_EN: Record<string, string> = {
  "Modulo completo": "Open circuit (whole module)",
  "Diodo de bypass": "Bypass diode",
  "Celda multiple": "Multiple cells",
  "Punto caliente": "Hot spot",
  "String completo": "Whole string",
  PID: "Potential-induced degradation (PID)",
  Suciedad: "Soiling",
  Sombra: "Shading",
  "Caja de conexion": "Junction box",
  "Vidrio roto": "Broken glass",
  Otro: "Other",
};
/*
  Que es cada patron, en una linea.

  Va al principio del informe y del Excel: el que lo recibe no tiene por que
  saber que quiere decir "bypass diode", y una lista de defectos sin decir que
  es cada uno obliga a preguntar por mail. Se listan solo los que aparecieron
  en ESTE vuelo — un glosario de once patrones cuando se encontraron dos es
  relleno.
*/
export const QUE_ES: Record<string, string> = {
  "Punto caliente": "A single small hot area inside the module. Can be a cracked cell, but also dirt or something resting on the glass.",
  "Celda multiple": "Two or more separate hot areas inside the module, not forming a band. Usually cracked cells.",
  "Diodo de bypass": "A hot band crossing the module from side to side: a whole substring shorted out by its bypass diode.",
  "Modulo completo": "The module is warm all over with no hot patch inside it — it is delivering no current (open circuit).",
  "String completo": "Every module of the string is equally warm above its neighbours. It is one connection, a fuse or an open connector, not a row of bad modules.",
  PID: "Potential-induced degradation: cells run warmer towards the frame, usually worst at one end of the string.",
  Suciedad: "Dirt, dust or droppings sitting on the glass. Warm where it sits; no electrical fault.",
  Sombra: "Something casting a shadow on the module — vegetation, structure or the neighbouring row.",
  "Caja de conexion": "The junction box on the back of the module runs hot. Fire risk.",
  "Vidrio roto": "Cracked or shattered laminate, warm across the broken area.",
  Otro: "Does not match any of the patterns above; see the note on that row.",
};

const SEVERIDAD_EN: Record<Severidad, string> = {
  normal: "None", leve: "Minor", moderada: "Moderate", critica: "Critical",
};
const ESTADO_EN: Record<string, string> = {
  pendiente: "To verify", confirmado: "Confirmed", descartado: "Discarded",
};
const AMBITO_EN: Record<string, string> = {
  string: "Its own string",
  fila: "Row (weak neighbourhood)",
  vuelo: "Flight (weak neighbourhood)",
};

/** Que hay que hacer con cada clase. Es la columna que convierte la lista en un plan. */
export const ACCION_DE_CLASE: Record<number, string> = {
  1: "No action — baseline",
  2: "Next scheduled maintenance",
  3: "Attend now",
};

export interface OpcionesDeEntrega {
  /** Carpeta de fotos que viaja al lado del Excel. */
  carpeta?: string;
  /**
   * Carpeta de Drive donde tambien estan las fotos, si el cliente la quiere
   * online. El link relativo funciona con el ZIP descomprimido y Excel de
   * escritorio; en Safari y en Google Sheets no, y ahi sirve este.
   */
  driveUrl?: string;
  addressing?: FarmProfile["addressing"];
}

/** El numero de referencia de un hallazgo: el mismo que lleva su foto. */
export const refDe = (n: number) => String(n + 1).padStart(3, "0");

/**
 * El nombre del archivo de foto que se entrega.
 *
 * Empieza por el numero de referencia para que la carpeta salga en el mismo
 * orden que el Excel, y sigue con la direccion: una foto reenviada suelta
 * sigue diciendo de que panel es.
 */
export function nombreEntregado(f: Finding, n: number): string {
  const a = f.address;
  const dt = f.medicion ? `${f.medicion.deltaT >= 0 ? "+" : ""}${f.medicion.deltaT.toFixed(1)}C` : "";
  const partes = [
    refDe(n),
    a?.block ? `B${a.block}` : "",
    a?.tracker ? `T${a.tracker}` : "",
    a?.stringNumber != null ? `S${a.stringNumber}` : "",
    f.moduloSinConfirmar ? "Mxx" : a?.module != null ? `M${f.moduleCorregido ?? a.module}` : "",
    dt,
  ].filter(Boolean);
  return `${partes.join("_").replace(/[^A-Za-z0-9_.+-]/g, "-")}.jpg`;
}

interface Columna {
  clave: string;
  titulo: string;
  ancho: number;
  valor: (f: Finding, n: number) => string | number | null;
}

/**
 * Las columnas del entregable, en el orden en que se leen: donde esta, que
 * tiene, que hay que hacer, y recien despues los numeros que lo respaldan.
 */
export function columnas(o: OpcionesDeEntrega): Columna[] {
  const cols: Columna[] = [
    { clave: "ref", titulo: "Ref", ancho: 7, valor: (_f, n) => refDe(n) },
    { clave: "block", titulo: "Block", ancho: 8, valor: (f) => f.address?.block ?? "" },
    { clave: "tracker", titulo: "Tracker", ancho: 10, valor: (f) => f.address?.tracker ?? "" },
    { clave: "row", titulo: "Row", ancho: 12, valor: (f) => f.address?.row ?? "" },
    { clave: "string", titulo: "String", ancho: 8, valor: (f) => f.address?.stringNumber ?? "" },
    {
      clave: "module", titulo: "Module", ancho: 9,
      // Sin numero confirmado va vacio, no el numero de al lado: la fila es
      // segura, el numero no, y eso se dice en la columna de al lado.
      valor: (f) => (f.moduloSinConfirmar ? "" : f.moduleCorregido ??  f.address?.module ?? ""),
    },
    {
      clave: "module_note", titulo: "Module no.", ancho: 16,
      valor: (f) => (f.moduloSinConfirmar ? "Count from row end" : "Confirmed"),
    },
    { clave: "dc_box", titulo: "DC box", ancho: 12, valor: (f) => f.address?.dcBoxLabel ?? "" },
    { clave: "anomaly", titulo: "Anomaly", ancho: 24, valor: (f) => (f.anomaly ? ANOMALIA_EN[f.anomaly] ?? f.anomaly : "") },
    { clave: "severity", titulo: "Severity", ancho: 11, valor: (f) => (f.medicion ? SEVERIDAD_EN[f.medicion.peor] : "") },
    { clave: "module_c", titulo: "Module temp (°C)", ancho: 16, valor: (f) => (f.medicion ? +f.medicion.celsius.toFixed(1) : "") },
    { clave: "delta_string", titulo: "ΔT vs string (°C)", ancho: 17, valor: (f) => (f.medicion ? +f.medicion.deltaT.toFixed(1) : "") },
    { clave: "reference_c", titulo: "String median (°C)", ancho: 18, valor: (f) => (f.medicion ? +f.medicion.referenciaC.toFixed(1) : "") },
    {
      clave: "delta_hotspot", titulo: "Hotspot ΔT vs module (°C)", ancho: 24,
      valor: (f) => (f.medicion?.deltaInterno != null ? +f.medicion.deltaInterno.toFixed(1) : ""),
    },
    { clave: "compared", titulo: "Compared against", ancho: 24, valor: (f) => (f.medicion ? AMBITO_EN[f.medicion.ambito] ?? f.medicion.ambito : "") },
    { clave: "photo", titulo: "Photo", ancho: 34, valor: (f, n) => nombreEntregado(f, n) },
  ];
  if (o.driveUrl) cols.push({ clave: "photo_online", titulo: "Photo (online)", ancho: 14, valor: () => "Open" });
  cols.push(
    { clave: "latitude", titulo: "Latitude", ancho: 13, valor: (f) => (f.address?.center ? +f.address.center.lat.toFixed(7) : f.fix ? +f.fix.lat.toFixed(7) : "") },
    { clave: "longitude", titulo: "Longitude", ancho: 13, valor: (f) => (f.address?.center ? +f.address.center.lon.toFixed(7) : f.fix ? +f.fix.lon.toFixed(7) : "") },
    { clave: "taken_at", titulo: "Taken at (UTC)", ancho: 21, valor: (f) => f.fix?.takenAt ?? "" },
    { clave: "source", titulo: "Source photo", ancho: 30, valor: (f) => f.fileName },
    { clave: "status", titulo: "Status", ancho: 12, valor: (f) => ESTADO_EN[f.status] ?? f.status },
    { clave: "notes", titulo: "Notes", ancho: 28, valor: (f) => f.note ?? "" },
  );
  return cols;
}

/**
 * La misma tabla, en CSV.
 *
 * Es el formato que se abre en cualquier cosa —Sheets, Numbers, un script de
 * python del cliente— y el que sobrevive cuando el .xlsx no. Sale de las
 * MISMAS columnas que el Excel a proposito: dos entregables de un mismo vuelo
 * que no coinciden fila por fila es lo primero que rompe la confianza.
 *
 * Va con BOM: sin el, Excel en Windows lee los grados y el ΔT como simbolos
 * rotos.
 */
export function aCsvEntregable(i: Inspection, o: OpcionesDeEntrega = {}): string {
  const cols = columnas(o).filter((c) => c.clave !== "photo_online");
  const celda = (v: string | number | null): string => {
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lista = entregables(i);
  const filas = [cols.map((c) => celda(c.titulo)).join(",")];
  for (const [n, f] of lista.entries()) {
    filas.push(cols.map((c) => celda(c.valor(f, n))).join(","));
  }
  return "\uFEFF" + filas.join("\r\n") + "\r\n";
}

/**
 * Por que el motor dijo lo que dijo, en ingles.
 *
 * El texto que guarda el hallazgo (`patron.porQue`) esta en castellano: es el
 * que se lee en pantalla mientras se revisa, y ahi tiene que quedar asi. Pero
 * en el informe del cliente aparecia un parrafo en castellano abajo de una
 * ficha en ingles — se vio en la primera entrega real.
 *
 * Se vuelve a escribir en vez de traducirse porque el hallazgo guarda los
 * numeros con los que se armo —que fraccion del modulo esta caliente, cuantas
 * manchas, donde cayo la franja—, asi que la frase en ingles se arma de la
 * misma fuente y no de una cadena ya cocinada.
 */
export function porQueEnIngles(f: Finding): string | null {
  const p = f.patron;
  if (!p) return null;
  const m = f.medicion;
  const dt = m ? Math.abs(m.deltaT).toFixed(1) : "";

  if (f.anomaly === "String completo") {
    return `The whole string runs ${dt} °C above the others, across ${m?.vecinos ?? "several"} ` +
      "measured modules. No single module stands out from its siblings: they are all equally " +
      "warm, which is the signature of a string that is not delivering current — disconnected, " +
      "a blown fuse or an open connector. It is not a row of bad modules, it is one connection.";
  }

  switch (p.patron) {
    case "modulo-completo":
      return `The module is warm, ${dt} °C above its siblings of the same string, with no hot ` +
        "patch inside it. That is a module delivering no current: an open circuit.";
    case "diodo": {
      const parte = p.franja ? Math.round(((p.franja.hasta - p.franja.desde + 1) / p.franja.de) * 100) : null;
      return "A hot band crosses the module from side to side" +
        (parte != null ? `, over ${parte} % of its length` : "") +
        ". That is a whole substring, which is what a bypass diode shorts out.";
    }
    case "celda-multiple":
      return `There are ${p.grumos} separate hot patches, with no band shape. It can be cracked ` +
        "cells, but also soiling or something resting on the glass: that is decided by looking " +
        "at the photo.";
    case "punto-caliente":
      return `A single small hot patch (${Math.round(p.fraccionCaliente * 100)} % of the module) ` +
        "that does not cross from side to side. Check the image: a patch of dirt looks the same " +
        "on a thermal.";
    case "sin-patron":
      return "No detached area was found inside the module and the module as a whole is not " +
        "above its neighbours. It may be an edge finding or a framing difference.";
  }
  return null;
}

/**
 * La severidad de un hallazgo, que es lo que se entrega.
 *
 * Es la PEOR de las dos comparaciones —el modulo contra sus hermanos de string
 * y el punto mas caliente contra el propio modulo—, no la del ΔT solo: un
 * modulo que no se despega del string pero tiene una celda a +25 °C adentro es
 * grave, y mirando un solo numero salia "normal".
 */
export const severidadDe = (f: Finding): Severidad | null => f.medicion?.peor ?? null;

/** De la mas urgente a la mas leve: es el orden en que se lee la lista. */
export const ORDEN_SEVERIDAD: Severidad[] = ["critica", "moderada", "leve", "normal"];

/** El conteo por tipo y por severidad, que es lo que se mira primero. */
export function resumenDeEntrega(lista: Finding[]) {
  const porTipo = new Map<string, { n: number; critica: number; moderada: number; leve: number; anomalia: string }>();
  for (const f of lista) {
    const clave = f.anomaly ?? "";
    const t = clave ? ANOMALIA_EN[clave] ?? clave : "Unclassified";
    const e = porTipo.get(t) ?? { n: 0, critica: 0, moderada: 0, leve: 0, anomalia: clave };
    e.n++;
    const sev = severidadDe(f);
    if (sev === "critica") e.critica++;
    else if (sev === "moderada") e.moderada++;
    else e.leve++;
    porTipo.set(t, e);
  }
  return [...porTipo.entries()]
    .map(([tipo, v]) => ({ tipo, ...v }))
    .sort((a, b) => b.critica - a.critica || b.moderada - a.moderada || b.n - a.n);
}

/** Cuantos hallazgos hay de cada severidad, de la mas urgente a la mas leve. */
export function porSeveridad(lista: Finding[]) {
  return ORDEN_SEVERIDAD.filter((s) => s !== "normal").map((s) => ({
    severidad: s,
    nombre: SEVERIDAD_EN[s],
    n: lista.filter((f) => severidadDe(f) === s).length,
  }));
}

// ---------------------------------------------------------------------------
// El libro de Excel
// ---------------------------------------------------------------------------

const TINTA = "FF1F3A4D";
const CLARO = "FFF4F7F9";
/*
  El color de cada severidad. Es lo unico que se colorea de la lista: pintar
  filas enteras por otra cosa compite con esto y deja de leerse de un vistazo.
*/
const SEV_FONDO: Record<string, string> = {
  critica: "FFF8D7DA", moderada: "FFFFF3CD", leve: "FFE8F5E9", normal: "FFF4F7F9",
};
const SEV_TINTA: Record<string, string> = {
  critica: "FF8B1A1A", moderada: "FF7A5B00", leve: "FF1B5E20", normal: "FF5A6B78",
};
const BORDE = { style: "thin" as const, color: { argb: "FFD5DCE3" } };

/**
 * El Excel de entrega: resumen, hallazgos y metodo.
 *
 * Tres hojas y no una. La primera contesta "¿que encontraron y que hago?" sin
 * scrollear; la segunda es la lista para trabajar, con filtro; la tercera dice
 * con que criterio se clasifico, que es lo que hace defendible a las otras dos
 * cuando alguien las discute seis meses despues.
 */
export async function aExcelEntregable(
  i: Inspection,
  o: OpcionesDeEntrega = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const ExcelJS = await import("exceljs");
  const lista = entregables(i);
  const cols = columnas(o);
  const wb = new ExcelJS.Workbook();
  wb.creator = MARCA.producto;
  wb.created = new Date();

  // --- Hoja 1: el resumen ---------------------------------------------------
  const s = wb.addWorksheet("Summary", {
    views: [{ showGridLines: false }],
    // Que entre a lo ancho al imprimir o al pasarlo a PDF: si no, las dos
    // ultimas columnas se cortan y el que lo imprime no ve que faltan.
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  /*
    La B lleva la accion de cada clase ("Next scheduled maintenance"), que a 22
    salia cortada por la columna de al lado en la primera entrega real. De la C
    a la F no se tocan: ahi va el significado de cada clase, en celdas unidas
    cuya altura se calcula suponiendo ese ancho.
  */
  s.columns = [{ width: 34 }, { width: 30 }, { width: 19 }, { width: 19 }, { width: 19 }, { width: 40 }];

  const titulo = (t: string) => {
    const r = s.addRow([t]);
    r.font = { bold: true, size: 13, color: { argb: TINTA } };
    r.height = 22;
    return r;
  };
  const dato = (k: string, v: unknown) => {
    const r = s.addRow([k, v == null || v === "" ? "not recorded" : v]);
    r.getCell(1).font = { color: { argb: "FF5A6672" } };
    r.getCell(2).font = { bold: true };
    return r;
  };
  /*
    Un parrafo que ocupa el ancho de la hoja.

    Excel no autoajusta el alto de una celda combinada, asi que el alto se
    calcula: sin esto los textos largos salian cortados en la primera linea y
    el resto se perdia — que es justo lo que NO puede pasar con las
    limitaciones del vuelo.
  */
  const parrafo = (t: string, chico = false) => {
    const r = s.addRow([t]);
    s.mergeCells(r.number, 1, r.number, 6);
    r.getCell(1).alignment = { wrapText: true, vertical: "top" };
    r.getCell(1).font = { size: chico ? 9 : 10, ...(chico ? { color: { argb: "FF5A6672" } } : {}) };
    r.height = Math.max(15, Math.ceil(t.length / 118) * 14 + 4);
    return r;
  };

  const cabecera = (celdas: string[]) => {
    const r = s.addRow(celdas);
    r.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINTA } };
      c.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
    });
    return r;
  };

  /*
    El membrete: quien firma la planilla.

    Un Excel que se reenvia por mail y se abre seis meses despues tiene que
    seguir diciendo de quien es. El isotipo va como imagen —ExcelJS no mete
    SVG— y si el navegador no puede rasterizarlo queda el nombre en texto,
    que es lo que habia antes.
  */
  const png = await isotipoPng(160);
  if (png) {
    const id = wb.addImage({ base64: png, extension: "png" });
    s.addImage(id, { tl: { col: 0.15, row: 0.15 }, ext: { width: 46, height: 46 } });
  }
  const r0 = s.addRow([png ? "        " + MARCA.producto : MARCA.producto]);
  r0.font = { bold: true, size: 13, color: { argb: "FF" + MARCA.cianOscuro.slice(1) } };
  r0.height = 22;
  const r1 = s.addRow([png ? "        Thermographic inspection report" : "Thermographic inspection report"]);
  r1.font = { bold: true, size: 18, color: { argb: TINTA } };
  r1.height = 26;
  s.addRow([png ? "        " + i.farmName : i.farmName]).font = { size: 12, color: { argb: "FF5A6672" } };
  s.addRow([]);

  titulo("Flight");
  dato("Inspection", i.name);
  dato("Date", i.createdAt.slice(0, 10));
  dato("Irradiance (W/m²)", i.conditions.irradianceWm2);
  dato("Ambient temperature (°C)", i.conditions.ambientC);
  dato("Wind (m/s)", i.conditions.windMs);
  dato("Sky", i.conditions.sky);
  dato("Pilot", i.conditions.pilot);
  dato("Equipment", i.conditions.equipment);
  const numeracion = numeracionEnIngles(o.addressing);
  if (numeracion) dato("Module numbering", numeracion);
  const cob = i.cobertura;
  if (cob) {
    dato("Thermal images", cob.fotosTermicas);
    dato("Ground resolution (cm/pixel)", +cob.gsdCm.toFixed(1));
    dato("ΔT thresholds (°C)", `minor ${cob.umbrales.leve} · moderate ${cob.umbrales.moderada} · critical ${cob.umbrales.critica}`);
  }
  s.addRow([]);

  /*
    La cobertura, BLOQUE POR BLOQUE.

    Antes se entregaba "14.751 de 377.888 modulos del parque": verdad y sin
    sentido, porque 377.888 es el parque entero de 36 bloques y el vuelo cubrio
    cuatro. Puesto asi un vuelo perfecto parece un 4 %.
  */
  if (cob?.porBloque?.length) {
    titulo("Coverage by block");
    cabecera(["Block", "Modules in block", "Modules measured", "Coverage"]);
    for (const b of cob.porBloque) {
      const r = s.addRow([b.block, b.modulos || "", b.medidos, b.modulos ? b.medidos / b.modulos : ""]);
      r.getCell(4).numFmt = "0%";
      r.eachCell((c) => { c.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE }; });
    }
    parrafo("Partial coverage means the block was only clipped by the edge of the flight path — it was not surveyed. Plan a flight over it to report on it.", true);
    s.addRow([]);
  }

  const resumen = resumenDeEntrega(lista);

  titulo("Findings");
  cabecera(["Anomaly", "Total", "Critical", "Moderate", "Minor"]);
  for (const t of resumen) {
    const r = s.addRow([t.tipo, t.n, t.critica, t.moderada, t.leve]);
    r.eachCell((c) => { c.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE }; });
    if (t.critica) r.getCell(3).font = { bold: true, color: { argb: SEV_TINTA.critica } };
  }
  const cuentas = porSeveridad(lista);
  const tot = s.addRow(["Total", lista.length, ...cuentas.map((c) => c.n)]);
  tot.eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLARO } };
    c.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
  });
  s.addRow([]);

  /*
    Que es cada patron que aparecio, en una linea.

    Solo los que aparecieron: un glosario de once cuando se encontraron dos es
    relleno, y el que recibe el archivo lo lee para entender SU lista.
  */
  const tipos = resumen.filter((t) => QUE_ES[t.anomalia]);
  if (tipos.length) {
    titulo("What each anomaly is");
    cabecera(["Anomaly", "What it is"]);
    for (const t of tipos) {
      const m = QUE_ES[t.anomalia]!;
      const r = s.addRow([t.tipo, m]);
      // De la B a la F: en una sola columna entraban tres palabras por linea.
      s.mergeCells(r.number, 2, r.number, 6);
      r.getCell(2).alignment = { wrapText: true, vertical: "middle" };
      r.height = Math.max(18, Math.ceil(m.length / 100) * 14 + 4);
      r.eachCell((c) => { c.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE }; });
    }
    s.addRow([]);
  }

  titulo("Method");
  for (const l of [
    "Every module is measured on the median of the central 60 % of the laminate, with the aluminium frame left out.",
    "ΔT is measured against the sibling modules OF THE SAME STRING photographed in the same pass.",
    "Severity is the worse of the two comparisons: the module against its string siblings, and the hottest point against its own module.",
    "Pattern recognition follows the pattern-and-context approach of IEC TS 62446-3. The ΔT thresholds above are a declared working convention, not a literal quotation of the standard.",
  ]) parrafo(l);

  // --- Hoja 2: los hallazgos ------------------------------------------------
  const h = wb.addWorksheet("Findings", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1", margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  h.columns = cols.map((c) => ({ header: c.titulo, key: c.clave, width: c.ancho }));
  h.getRow(1).height = 30;
  h.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINTA } };
    c.alignment = { wrapText: true, vertical: "middle" };
    c.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
  });

  lista.forEach((f, n) => {
    const fila = h.addRow(Object.fromEntries(cols.map((c) => [c.clave, c.valor(f, n)])));
    fila.eachCell({ includeEmpty: true }, (c) => {
      c.border = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
      c.alignment = { vertical: "middle" };
      if (n % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLARO } };
    });
    for (const clave of ["module_c", "delta_string", "reference_c", "delta_hotspot"]) {
      const c = fila.getCell(clave);
      c.numFmt = "0.0";
      c.alignment = { horizontal: "right", vertical: "middle" };
    }
    for (const clave of ["latitude", "longitude"]) fila.getCell(clave).numFmt = "0.0000000";
    /*
      La severidad es la unica celda de color de la fila.

      Es lo que se ordena y lo que se busca: pintada, la lista se puede leer de
      un vistazo sin filtrar. Pintar mas columnas por otra cosa compite con
      esto y las dos dejan de leerse.
    */
    const sev = severidadDe(f);
    if (sev) {
      const c = fila.getCell("severity");
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SEV_FONDO[sev]! } };
      c.font = { bold: sev === "critica", color: { argb: SEV_TINTA[sev]! } };
      c.alignment = { horizontal: "center", vertical: "middle" };
    }
    /*
      Los dos links a la misma foto.

      El relativo abre la foto del ZIP descomprimido con Excel de escritorio;
      es el que sigue funcionando dentro de diez anios y sin senal. El de
      Drive es el que funciona en Safari, en Sheets y en el telefono, que es
      donde el relativo no abre nada — no es un capricho del archivo, el
      navegador no deja que una planilla abra un archivo del disco.
    */
    const foto = fila.getCell("photo");
    foto.value = { text: String(foto.value ?? ""), hyperlink: `${o.carpeta ?? "photos"}/${nombreEntregado(f, n)}` };
    foto.font = { color: { argb: "FF0B62B0" }, underline: true };
    if (o.driveUrl) {
      const online = fila.getCell("photo_online");
      online.value = {
        text: "Open",
        hyperlink: `${o.driveUrl.replace(/\/$/, "")}/${nombreEntregado(f, n)}`,
      };
      online.font = { color: { argb: "FF0B62B0" }, underline: true };
      online.alignment = { horizontal: "center", vertical: "middle" };
    }
  });

  h.autoFilter = { from: { row: 1, column: 1 }, to: { row: lista.length + 1, column: cols.length } };

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer) as Uint8Array<ArrayBuffer>;
}

// ---------------------------------------------------------------------------
// El informe visual
// ---------------------------------------------------------------------------

const RUMBOS_EN: Record<string, string> = { north: "north", south: "south", east: "east", west: "west" };

/**
 * Desde que punta se numeran los modulos, en ingles.
 *
 * Es la linea que hace verificable a todo el resto: sin ella, "module 26" es
 * un numero que el cliente no puede contar contra nada. La version en
 * castellano vive en `informe.ts`, para el CSV de trabajo; esta es la del
 * entregable, y las dos salen del mismo perfil del parque.
 */
export function numeracionEnIngles(addressing?: FarmProfile["addressing"]): string | null {
  if (!addressing) return null;
  let frase: string;
  switch (addressing.originStrategy) {
    case "fixed-end": {
      const rumbo = addressing.fixedEnd ? RUMBOS_EN[addressing.fixedEnd] : null;
      // Sin rumbo el perfil esta roto y el motor tampoco sabe contar: antes que
      // declarar una punta inventada en el entregable, no se declara ninguna.
      if (!rumbo) return null;
      frase = `Modules are numbered from the ${rumbo} end of each string.`;
      break;
    }
    case "dc-box-end":
      frase = "Modules are numbered from the end of each string closest to its DC combiner box.";
      break;
    default:
      frase = "Modules are numbered from the end declared for each row in the site survey.";
      break;
  }
  if (addressing.inversionStrategy === "piercing-chain") {
    frase += " In rows with more than one string, the string furthest from the origin is counted " +
      "the other way round, from the opposite end: that is where its connection is.";
  } else if (addressing.inversionStrategy === "per-string-flag") {
    frase += " Strings flagged in the site survey are counted from the opposite end.";
  }
  return frase;
}

export interface FotoEmbebida {
  fileName: string;
  dataUrl: string;
  /**
   * El hallazgo al que pertenece ESTA imagen, cuando fue dibujada para el.
   *
   * Una misma foto del dron puede traer dos hallazgos, y cada uno se entrega
   * con su propio recuadro: sin esto los dos mostrarian el mismo dibujo y uno
   * de los dos senialaria el panel equivocado.
   */
  id?: string;
}

const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const grados = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} °C`;

/**
 * El informe que se lee, se imprime y se firma.
 *
 * Un solo archivo con las fotos adentro: se abre en cualquier navegador, sin
 * carpeta al lado, y con Cmd+P sale el PDF. Dentro de diez anios, que es
 * cuando alguien discute una garantia, va a seguir abriendo.
 *
 * Arranca por lo que hay que hacer —cuantos hallazgos de clase 3, 2 y 1, y la
 * cobertura de cada bloque— y recien despues la lista con las fotos. Lo que el
 * vuelo NO permite afirmar va arriba y no en una nota al pie: es lo que separa
 * un informe defendible de una lista de defectos.
 */
export function aInformeEntregable(
  i: Inspection,
  fotos: FotoEmbebida[] = [],
  o: OpcionesDeEntrega = {},
): string {
  const porNombre = new Map(fotos.map((f) => [f.fileName, f.dataUrl]));
  const porId = new Map(fotos.flatMap((f) => (f.id ? [[f.id, f.dataUrl] as const] : [])));
  const lista = entregables(i);
  const cob = i.cobertura;

  const porBloque = new Map<string, Finding[]>();
  for (const f of lista) {
    const b = f.address?.block ?? "—";
    porBloque.set(b, [...(porBloque.get(b) ?? []), f]);
  }

  const clase = (f: Finding) => f.klass ?? 2;
  const cuenta = (k: number) => lista.filter((f) => clase(f) === k).length;

  const ficha = (f: Finding, n: number) => {
    const a = f.address;
    const m = f.medicion;
    const img = porId.get(f.id) ?? porNombre.get(f.fileName);
    const sev = severidadDe(f) ?? "normal";
    return `<article class="f ${sev}">
  <header>
    <span class="ref">${esc(refDe(n))}</span>
    <h3>Block ${esc(a?.block ?? "?")} · Tracker ${esc(a?.tracker ?? "?")}${a?.row ? " " + esc(a.row) : ""} · String ${esc(a?.stringNumber ?? "?")} · ${
      f.moduloSinConfirmar
        ? `Module not confirmed <em>(count from the row end; nearest is ${esc(a?.module ?? "?")})</em>`
        : `Module ${esc(f.moduleCorregido ?? a?.module ?? "?")}`
    }</h3>
    <span class="badge ${sev}">${esc(SEVERIDAD_EN[sev])}</span>
  </header>
  <dl>
    <dt>Anomaly</dt><dd><strong>${esc(f.anomaly ? ANOMALIA_EN[f.anomaly] ?? f.anomaly : "Unclassified")}</strong></dd>
    <dt>DC box</dt><dd>${esc(a?.dcBoxLabel ?? "—")}</dd>
    ${m ? `<dt>Module temperature</dt><dd>${m.celsius.toFixed(1)} °C · <strong>${grados(m.deltaT)}</strong> against ${m.vecinos} ${
      m.ambito === "string" ? "siblings of its own string" : `neighbours (${esc(AMBITO_EN[m.ambito] ?? m.ambito)})`
    }</dd>` : ""}
    ${m?.deltaInterno != null ? `<dt>Hotspot</dt><dd>${grados(m.deltaInterno)} above its own module${
      m.origen === "celda" ? " — a cell, not the whole module" : ""
    }</dd>` : ""}
    <dt>Location</dt><dd>${a?.center ? `${a.center.lat.toFixed(6)}, ${a.center.lon.toFixed(6)}` : "—"}</dd>
    <dt>Source image</dt><dd><code>${esc(f.fileName)}</code></dd>
  </dl>
  ${(() => { const q = porQueEnIngles(f); return q ? `<p class="por-que">${esc(q)}</p>` : ""; })()}
  ${f.note ? `<p class="nota">${esc(f.note)}</p>` : ""}
  ${img ? `<img src="${img}" alt="${esc(f.fileName)}">` : `<p class="sinfoto">Image not included in this export.</p>`}
</article>`;
  };

  const filaCobertura = (b: { block: string; modulos: number; medidos: number }) =>
    `<tr><td>${esc(b.block)}</td><td class="n">${b.modulos ? b.modulos.toLocaleString("en") : "—"}</td>` +
    `<td class="n">${b.medidos.toLocaleString("en")}</td>` +
    `<td class="n">${b.modulos ? `${Math.round((b.medidos / b.modulos) * 100)} %` : "—"}</td></tr>`;

  const conteo = resumenDeEntrega(lista);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(i.name)} — ${esc(i.farmName)}</title>
<style>
  :root { color-scheme: light; --tinta: #1f3a4d; --linea: #dfe5ea; --suave: #5a6672; }
  * { box-sizing: border-box; }
  body { font: 15px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif; color: #14202a;
         background: #fff; max-width: 960px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
  /*
    El membrete: quien firma el informe, arriba de todo.

    Es lo primero que mira el que lo recibe, y lo que hace que un PDF suelto
    seis meses despues siga teniendo dueño.
  */
  .membrete { display: flex; align-items: center; gap: 1.4rem; padding-bottom: 1.1rem;
              border-bottom: 3px solid var(--tinta); margin-bottom: 1.8rem; }
  .membrete .quien { display: flex; flex-direction: column; gap: .18rem; }
  .membrete strong { font-size: 1.5rem; color: var(--tinta); letter-spacing: -.015em; }
  .membrete span { color: var(--suave); font-size: 1rem; }
  h2 { font-size: 1.1rem; text-transform: uppercase; letter-spacing: .06em; color: var(--tinta);
       margin: 2.4rem 0 .8rem; padding-bottom: .35rem; border-bottom: 2px solid var(--tinta); }
  .tarjetas { display: grid; grid-template-columns: repeat(3, 1fr); gap: .8rem; margin-bottom: 1.4rem; }
  .t { border: 1px solid var(--linea); border-radius: 8px; padding: .9rem 1rem; }
  .t b { display: block; font-size: 2rem; line-height: 1.1; }
  .t span { color: var(--suave); font-size: .88rem; }
  .t.critica { background: #fdf1f2; border-color: #f0c8cc; } .t.critica b { color: #8b1a1a; }
  .t.moderada { background: #fffaf0; border-color: #f0e0bd; } .t.moderada b { color: #7a5b00; }
  .t.leve { background: #f2f9f3; border-color: #cfe6d4; } .t.leve b { color: #1b5e20; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1.2rem; font-size: .95rem; }
  th { text-align: left; background: var(--tinta); color: #fff; font-weight: 600; padding: .45rem .7rem; }
  td { padding: .4rem .7rem; border-bottom: 1px solid var(--linea); }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  table.cond td:first-child { color: var(--suave); width: 15rem; }
  table.cond td { border: 0; padding: .18rem .7rem .18rem 0; }
  .limites { background: #fffaf0; border: 1px solid #f0e0bd; border-radius: 8px; padding: .9rem 1.2rem; }
  .limites h2 { margin: 0 0 .5rem; border: 0; font-size: .95rem; }
  .limites p { margin: .35rem 0; color: #5c4b16; font-size: .93rem; }
  .metodo p { color: var(--suave); font-size: .93rem; margin: .4rem 0; }
  .f { border: 1px solid var(--linea); border-left: 5px solid #c4ccd3; border-radius: 8px;
       padding: 1rem 1.2rem; margin-bottom: 1rem; break-inside: avoid; page-break-inside: avoid; }
  .f.critica { border-left-color: #c0392b; } .f.moderada { border-left-color: #d9a441; }
  .f.leve { border-left-color: #7bb681; } .f.normal { border-left-color: #c4ccd3; }
  .f header { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; margin-bottom: .6rem; }
  .f h3 { margin: 0; font-size: 1.02rem; flex: 1 1 20rem; }
  .f h3 em { color: var(--suave); font-style: normal; font-weight: 400; }
  .ref { font-variant-numeric: tabular-nums; background: var(--tinta); color: #fff;
         border-radius: 4px; padding: .1rem .45rem; font-size: .82rem; font-weight: 600; }
  .badge { font-size: .78rem; border-radius: 4px; padding: .12rem .5rem; white-space: nowrap; }
  .badge.critica { background: #f8d7da; color: #8b1a1a; }
  .badge.moderada { background: #fff3cd; color: #7a5b00; }
  .badge.leve { background: #e8f5e9; color: #1b5e20; }
  .badge.normal { background: #eef2f5; color: #5a6672; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: .12rem 1.1rem; margin: 0 0 .6rem; font-size: .95rem; }
  dt { color: var(--suave); } dd { margin: 0; }
  .por-que { margin: 0 0 .6rem; font-size: .93rem; }
  .nota { background: #f4f7f9; padding: .5rem .7rem; border-radius: 5px; margin: 0 0 .6rem; font-size: .93rem; }
  /*
    La foto, lo mas grande y lo mas nitida que da el papel.

    Se pide contraste al agrandar y no suavizado: abajo hay una termica de
    640x512, y el suavizado del navegador la deja lechosa y se come el borde de
    la mancha, que es justo lo que hay que mirar. Ancho completo de la caja y,
    al imprimir, del renglon entero.
  */
  .f img { width: 100%; border-radius: 5px; display: block; image-rendering: -webkit-optimize-contrast; }
  .sinfoto { color: #98a2ab; font-style: italic; margin: 0; }
  code { font-size: .87em; background: #f2f5f7; padding: .1em .35em; border-radius: 3px; }
  .firma { margin-top: 2.6rem; padding-top: 1rem; border-top: 1px solid var(--linea);
           color: var(--suave); font-size: .86rem; display: flex; justify-content: space-between;
           gap: 1rem; flex-wrap: wrap; }
  .firma b { color: var(--tinta); }
  @media print {
    body { max-width: none; padding: 0; font-size: 11pt; }
    h2 { margin-top: 1.4rem; }
    /* Que la termica entre entera y grande en la pagina, no a media caja. */
    .f img { width: 100%; max-height: 15cm; object-fit: contain; }
  }
</style></head><body>
<header class="membrete">
  ${lockup("claro", 46)}
  <div class="quien">
    <strong>Thermographic inspection report</strong>
    <span>${esc(i.farmName)} · ${esc(i.name)} · ${lista.length} finding${lista.length === 1 ? "" : "s"}</span>
  </div>
</header>

<div class="tarjetas">
  ${porSeveridad(lista).map((c) => `<div class="t ${c.severidad}"><b>${c.n}</b><span>${esc(c.nombre)}</span></div>`).join("")}
</div>

<h2>Findings by type</h2>
<table><thead><tr><th>Anomaly</th><th>Total</th><th>Critical</th><th>Moderate</th><th>Minor</th></tr></thead>
<tbody>${conteo.map((t) => `<tr><td>${esc(t.tipo)}</td><td class="n">${t.n}</td><td class="n">${t.critica}</td><td class="n">${t.moderada}</td><td class="n">${t.leve}</td></tr>`).join("")}</tbody></table>

${(() => {
  /*
    Que es cada patron que aparecio, arriba de todo.

    Mateo lo pidio mirando el informe entregado: la lista decia "Whole string"
    y "Hot spot" y no decia que es cada cosa, asi que el que la recibe tiene
    que preguntar por mail. Solo los que aparecieron: un glosario de once
    cuando se encontraron dos es relleno.
  */
  const tipos = conteo.filter((t) => QUE_ES[t.anomalia]);
  return tipos.length
    ? `<h2>What each anomaly is</h2>
<table><thead><tr><th>Anomaly</th><th>What it is</th></tr></thead>
<tbody>${tipos.map((t) => `<tr><td><strong>${esc(t.tipo)}</strong></td><td>${esc(QUE_ES[t.anomalia]!)}</td></tr>`).join("")}</tbody></table>`
    : "";
})()}

${cob?.porBloque?.length ? `<h2>Coverage by block</h2>
<table><thead><tr><th>Block</th><th>Modules in block</th><th>Modules measured</th><th>Coverage</th></tr></thead>
<tbody>${cob.porBloque.map(filaCobertura).join("")}</tbody></table>
<p class="metodo"><em>Partial coverage means the block was only clipped by the edge of the flight path — it was not surveyed.</em></p>` : ""}

<h2>Flight</h2>
<table class="cond"><tbody>
<tr><td>Date</td><td>${esc(i.createdAt.slice(0, 10))}</td></tr>
<tr><td>Irradiance (W/m²)</td><td>${esc(i.conditions.irradianceWm2 ?? "not recorded")}</td></tr>
<tr><td>Ambient temperature (°C)</td><td>${esc(i.conditions.ambientC ?? "not recorded")}</td></tr>
<tr><td>Wind (m/s)</td><td>${esc(i.conditions.windMs ?? "not recorded")}</td></tr>
<tr><td>Sky</td><td>${esc(i.conditions.sky ?? "not recorded")}</td></tr>
<tr><td>Pilot</td><td>${esc(i.conditions.pilot ?? "not recorded")}</td></tr>
<tr><td>Equipment</td><td>${esc(i.conditions.equipment ?? "not recorded")}</td></tr>
${numeracionEnIngles(o.addressing) ? `<tr><td>Module numbering</td><td>${esc(numeracionEnIngles(o.addressing))}</td></tr>` : ""}
${cob ? `<tr><td>Thermal images</td><td>${cob.fotosTermicas}</td></tr>
<tr><td>Ground resolution</td><td>${cob.gsdCm.toFixed(1)} cm/pixel</td></tr>
<tr><td>ΔT thresholds</td><td>minor ${cob.umbrales.leve} · moderate ${cob.umbrales.moderada} · critical ${cob.umbrales.critica} °C</td></tr>` : ""}
</tbody></table>

${/*
  Lo que el vuelo no permite afirmar NO viaja en el entregable.

  Mateo lo saco despues de la primera entrega real. Leido por el cliente —que
  abre el informe para saber a que panel caminar— un bloque de matices del
  metodo arriba de todo se lee como que el que midio no confia en lo que
  midio. El dato no se borra: sigue entero en la pantalla de revision, que es
  donde hay que mirarlo antes de firmar, y donde una cobertura pobre tiene que
  frenar la entrega.
*/ ""}

<h2>Method</h2>
<div class="metodo">
<p>Every module is measured on the median of the central 60 % of the laminate, with the aluminium frame left out. ΔT is measured against the sibling modules <strong>of the same string</strong> photographed in the same pass.</p>
<p>Severity is the worse of the two comparisons: the module against its string siblings, and its hottest point against its own module. Pattern recognition follows the pattern-and-context approach of <strong>IEC TS 62446-3</strong>; the ΔT thresholds above are a declared working convention, not a literal quotation of the standard.</p>
</div>

${[...porBloque.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([b, fs]) => `<h2>Block ${esc(b)} — ${fs.length} finding${fs.length === 1 ? "" : "s"}</h2>${
    fs.map((f) => ficha(f, lista.indexOf(f))).join("")
  }`).join("")}

<footer class="firma">
  <span>Surveyed and reported by <b>${esc(MARCA.producto)}</b></span>
  <span>${esc(i.farmName)} · ${esc(i.createdAt.slice(0, 10))}</span>
</footer>
</body></html>`;
}
