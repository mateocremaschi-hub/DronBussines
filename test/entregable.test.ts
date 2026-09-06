/**
 * El Excel que se le entrega al cliente.
 *
 * Sale de la revision que hizo Mateo sobre el primer entregable real: se
 * fueron cinco columnas que eran el andamio del calculo y no el resultado, las
 * que quedan se llaman por lo que son, y va en ingles.
 */
import { describe, expect, it } from "vitest";
import { aCsvEntregable, aInformeEntregable, columnas, nombreEntregado, porQueEnIngles, porSeveridad, refDe, resumenDeEntrega } from "../app/entregable";
import type { Severidad } from "../app/detect";
import { ANOMALIAS, type Finding, type Inspection } from "../app/inspection";

const f = (o: Partial<Finding> = {}): Finding => ({
  id: "x", fileName: "DJI_0001_T.JPG", candidates: [], warnings: [], status: "pendiente",
  address: { rowId: "2-85", block: "2", tracker: "85", chunkIndex: 6, stringNumber: 7, module: 27,
    countedFrom: "near-dc", confidence: 1 } as Finding["address"],
  medicion: { celsius: 39.1, deltaT: 0.4, referenciaC: 38.8, vecinos: 26, ambito: "string",
    severidad: "normal", peor: "leve", origen: "celda", pixeles: 40, deltaInterno: 10.5 } as Finding["medicion"],
  ...o,
});

const insp = (findings: Finding[], cobertura?: unknown): Inspection => ({
  id: "i", farmId: "p", farmName: "Wellington", name: "Flight 1",
  createdAt: "2026-09-06T00:00:00.000Z", conditions: {}, findings,
  ...(cobertura ? { cobertura } : {}),
} as Inspection);

describe("las columnas del entregable", () => {
  const claves = columnas({}).map((c) => c.clave);

  it("no lleva las cinco que no le sirven a nadie afuera", () => {
    for (const fuera of ["precision_m", "modulo_corregido", "confianza", "delta_t", "vecinos"]) {
      expect(claves).not.toContain(fuera);
    }
  });

  it("los titulos se entienden sin conocer la app", () => {
    const titulos = columnas({}).map((c) => c.titulo);
    expect(titulos).toContain("ΔT vs string (°C)");
    expect(titulos).toContain("Hotspot ΔT vs module (°C)");
    expect(titulos).toContain("Severity");
    expect(titulos).toContain("Module temp (°C)");
  });

  it("la columna online solo aparece si hay carpeta de Drive", () => {
    expect(claves).not.toContain("photo_online");
    expect(columnas({ driveUrl: "https://x" }).map((c) => c.clave)).toContain("photo_online");
  });

  /*
    El numero sin confirmar va VACIO, no el de al lado: la fila es segura, el
    numero no. Y la columna que sigue dice que hay que contarlo desde la punta.
  */
  it("un modulo sin numero confirmado sale vacio y avisado", () => {
    const cols = columnas({});
    const valor = (clave: string, x: Finding) => cols.find((c) => c.clave === clave)!.valor(x, 0);
    expect(valor("module", f())).toBe(27);
    expect(valor("module", f({ moduloSinConfirmar: true }))).toBe("");
    expect(valor("module_note", f({ moduloSinConfirmar: true }))).toBe("Count from row end");
  });

  it("la severidad que se entrega es la peor de las dos comparaciones", () => {
    const sev = columnas({}).find((c) => c.clave === "severity")!;
    // El modulo no se despega (normal) pero adentro tiene una celda a +10,5.
    expect(sev.valor(f(), 0)).toBe("Minor");
  });
});

describe("el nombre de la foto entregada", () => {
  it("empieza por el numero de referencia del Excel", () => {
    expect(refDe(0)).toBe("001");
    expect(nombreEntregado(f(), 0)).toBe("001_B2_T85_S7_M27_+0.4C.jpg");
  });

  it("sin numero confirmado no inventa uno", () => {
    expect(nombreEntregado(f({ moduloSinConfirmar: true }), 6)).toContain("_Mxx_");
    expect(nombreEntregado(f({ moduloSinConfirmar: true }), 6).startsWith("007_")).toBe(true);
  });
});

/*
  La clase IEC salio del entregable: Mateo la clasifica por SEVERIDAD, que es
  lo que decide si se va a mirar hoy o en el proximo mantenimiento, y una
  segunda escala al lado de la primera solo obliga a explicar cual manda.
*/
const conSev = (a: string, peor: Severidad) =>
  f({ anomaly: a, medicion: { ...f().medicion!, peor } as Finding["medicion"] });

describe("el resumen por tipo", () => {
  it("cuenta por anomalia y severidad, con las criticas primero", () => {
    const r = resumenDeEntrega([
      conSev("Punto caliente", "leve"),
      conSev("Punto caliente", "leve"),
      conSev("Diodo de bypass", "critica"),
    ]);
    expect(r[0]!.tipo).toBe("Bypass diode");
    expect(r[0]!.critica).toBe(1);
    expect(r[1]!.tipo).toBe("Hot spot");
    expect(r[1]!.n).toBe(2);
    expect(r[1]!.leve).toBe(2);
  });

  it("las tarjetas del informe van de la mas urgente a la mas leve", () => {
    const c = porSeveridad([conSev("Punto caliente", "critica"), conSev("Punto caliente", "leve")]);
    expect(c.map((x) => x.nombre)).toEqual(["Critical", "Moderate", "Minor"]);
    expect(c.map((x) => x.n)).toEqual([1, 0, 1]);
  });
});

describe("el entregable no habla de clases", () => {
  const claves = columnas({}).map((c) => c.clave);

  it("no lleva la columna de clase IEC ni la de accion", () => {
    expect(claves).not.toContain("class");
    expect(claves).not.toContain("action");
    expect(claves).toContain("severity");
  });

  it("el informe no nombra ninguna clase", () => {
    const html = aInformeEntregable(insp([conSev("Punto caliente", "critica")]));
    expect(html).not.toMatch(/Class \d|IEC class/);
    expect(html).toContain("Critical");
  });
});

/*
  Que es cada patron, arriba de todo: la lista decia "Whole string" y no decia
  que es un string entero, asi que el que la recibe pregunta por mail.
*/
describe("el glosario de anomalias", () => {
  it("explica los patrones que aparecieron y ninguno mas", () => {
    const html = aInformeEntregable(insp([conSev("Diodo de bypass", "moderada")]));
    expect(html).toContain("What each anomaly is");
    expect(html).toContain("bypass diode");
    expect(html).not.toContain("Potential-induced degradation");
  });

  it("sin anomalia clasificada no se pone una tabla vacia", () => {
    const html = aInformeEntregable(insp([f({ anomaly: undefined })]));
    expect(html).not.toContain("What each anomaly is");
  });
});

/*
  Lo que el vuelo no permite afirmar se queda en la app y no viaja: leido por
  el cliente, arriba de todo, se lee como que el que midio no confia en lo que
  midio.
*/
describe("lo que no viaja en el entregable", () => {
  const cob = {
    umbrales: { leve: 3, moderada: 10, critica: 20 }, gsdCm: 5.3, fotosTermicas: 1,
    limitaciones: ["17 modulos quedaron cortados por el borde"],
    limitacionesDelCliente: ["17 modulos quedaron cortados por el borde"],
  };

  it("no lleva la seccion de limitaciones", () => {
    const html = aInformeEntregable(insp([f()], cob));
    expect(html).not.toContain("What this survey does not cover");
    expect(html).not.toContain("cortados por el borde");
  });

  it("el metodo no habla del suelo ni de las filas vecinas", () => {
    const html = aInformeEntregable(insp([f()]));
    expect(html).not.toContain("no finding comes from ground or shadow");
    expect(html).not.toContain("neighbouring rows");
    // Lo que si tiene que decir: contra que se compara y como sale la severidad.
    expect(html).toContain("of the same string");
    expect(html).toContain("Severity is the worse of the two comparisons");
  });
});

/**
 * El informe visual, que es lo que se lee y se firma.
 *
 * Un solo archivo con las fotos adentro, en ingles, y con lo que el vuelo NO
 * permite afirmar arriba y no en una nota al pie.
 */
describe("el informe de entrega", () => {
  it("sale en ingles y con la norma citada", () => {
    const html = aInformeEntregable(insp([f({ anomaly: "Punto caliente", klass: 2 })]));
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Thermographic inspection report");
    expect(html).toContain("Hot spot");
    expect(html).toContain("IEC TS 62446-3");
  });

  it("cuenta la cobertura por bloque, no contra el parque entero", () => {
    const html = aInformeEntregable(insp([f()], {
      limitaciones: [], umbrales: { leve: 3, moderada: 10, critica: 20 }, gsdCm: 5.3, fotosTermicas: 566,
      porBloque: [{ block: "2", modulos: 10752, medidos: 10520 }],
    }));
    expect(html).toContain("Coverage by block");
    expect(html).toContain("98 %");
  });

  /*
    Una nota escrita por una persona puede traer cualquier cosa: si se
    interpola cruda, el informe se lo come como HTML.
  */
  it("escapa lo que escribio una persona", () => {
    const html = aInformeEntregable(insp([f({ note: "<script>alert(1)</script>" })]));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("declara desde que punta se numeran los modulos", () => {
    const html = aInformeEntregable(insp([f()]), [], {
      addressing: { originStrategy: "fixed-end", fixedEnd: "north", inversionStrategy: "none" } as never,
    });
    expect(html).toContain("Modules are numbered from the north end");
  });

  it("sin la foto, la ficha sale igual", () => {
    const html = aInformeEntregable(insp([f()]));
    expect(html).toContain("Image not included");
  });
});

/**
 * Que va al informe del cliente y que se queda en el interno.
 *
 * "11 modulos se compararon contra un vecindario mas suelto" no es una
 * limitacion del vuelo: es control de calidad de la medicion, y arriba de todo
 * pone en duda la lista entera por un dato que ya esta —hallazgo por
 * hallazgo— en la columna que le corresponde.
 */
/*
  Lo que el vuelo no permite afirmar salio del entregable, pero el dato que SI
  es accionable —contra que vecindario se comparo ESE modulo— se queda en su
  fila: ahi cambia lo que el que camina el parque va a mirar.
*/
describe("contra que se comparo cada hallazgo", () => {
  it("la fila lo sigue diciendo aunque el informe no tenga limitaciones", () => {
    const col = columnas({}).find((c) => c.clave === "compared")!;
    const flojo = f({ medicion: { ...f().medicion!, ambito: "fila" } as Finding["medicion"] });
    expect(col.valor(flojo, 0)).toBe("Row (weak neighbourhood)");
    expect(col.valor(f(), 0)).toBe("Its own string");
  });
});

describe("la imagen de cada hallazgo en el informe", () => {
  const dos: Inspection = {
    ...({ id: "i", name: "Vuelo", createdAt: "2026-09-06T00:00:00Z", conditions: {}, findings: [] } as unknown as Inspection),
    findings: [
      f({ id: "a", status: "confirmado" }),
      f({ id: "b", status: "confirmado", address: { ...f().address!, stringNumber: 8, module: 3 } }),
    ],
  };

  it("usa la dibujada para ese hallazgo, no la del archivo", () => {
    const html = aInformeEntregable(dos, [
      { id: "a", fileName: "DJI_0001_T.JPG", dataUrl: "data:image/jpeg;base64,AAA" },
      { id: "b", fileName: "DJI_0001_T.JPG", dataUrl: "data:image/jpeg;base64,BBB" },
    ]);
    expect(html).toContain("base64,AAA");
    expect(html).toContain("base64,BBB");
  });

  it("un informe viejo, con las imagenes por nombre, sigue saliendo con fotos", () => {
    const html = aInformeEntregable(dos, [
      { fileName: "DJI_0001_T.JPG", dataUrl: "data:image/jpeg;base64,CCC" },
    ]);
    expect(html.match(/base64,CCC/g)?.length).toBe(2);
  });
});

/*
  El CSV es el formato que sobrevive: se abre en Sheets, en Numbers y en un
  script del cliente. Sale de las mismas columnas que el Excel porque dos
  entregables del mismo vuelo que no coinciden fila por fila es lo primero que
  rompe la confianza.
*/
describe("el CSV de entrega", () => {
  const uno: Inspection = {
    ...({ id: "i", name: "Vuelo", createdAt: "2026-09-06T00:00:00Z", conditions: {}, findings: [] } as unknown as Inspection),
    findings: [f({ status: "confirmado", note: 'glass, "south" corner' })],
  };

  it("va en ingles y con las mismas columnas que el Excel", () => {
    const csv = aCsvEntregable(uno);
    const cabecera = csv.replace(/^﻿/, "").split("\r\n")[0]!;
    expect(cabecera.split(",")[0]).toBe("Ref");
    expect(cabecera).toContain("Severity");
    expect(cabecera).toContain("Hotspot ΔT vs module (°C)");
    expect(cabecera).not.toMatch(/bloque|anomalia|severidad/);
  });

  it("arranca con BOM, si no Excel en Windows rompe los grados", () => {
    expect(aCsvEntregable(uno).startsWith("﻿")).toBe(true);
  });

  it("una nota con comas y comillas no corre las columnas", () => {
    const fila = aCsvEntregable(uno).trimEnd().split("\r\n").at(-1)!;
    expect(fila).toContain('"glass, ""south"" corner"');
    expect(fila.split(",")[0]).toBe("001");
  });

  it("no lleva la columna de link online: en CSV no es un link", () => {
    const cabecera = aCsvEntregable(uno, { driveUrl: "https://x" }).split("\r\n")[0]!;
    expect(cabecera).not.toContain("Photo (online)");
  });
});

/*
  Los once patrones tienen que estar traducidos. El motor clasifica cinco; los
  otros seis los pone Mateo a mano en el revisor, y si falta uno la celda sale
  en castellano en medio de una planilla en ingles — que es exactamente lo que
  el cliente no tiene que ver.
*/
describe("el vocabulario en ingles", () => {
  it("cubre las once anomalias de la lista", () => {
    const col = columnas({}).find((c) => c.clave === "anomaly")!;
    for (const a of ANOMALIAS) {
      const salida = String(col.valor(f({ anomaly: a }), 0));
      expect(salida, a).not.toBe(a);
      expect(salida).not.toMatch(/[áéíóúñ]|Modulo|Celda|Suciedad|Sombra|Vidrio|Caja de/);
    }
  });
});

/*
  El texto del motor esta en castellano porque es el que se lee en pantalla
  mientras se revisa. En el informe del cliente salia un parrafo en castellano
  abajo de una ficha en ingles: se vio en la primera entrega real.
*/
describe("el por que del motor, en el informe", () => {
  const conPatron = (p: Partial<Finding["patron"]> & { patron: string }) =>
    f({ patron: { confianza: "alta", fraccionCaliente: 0.05, grumos: 1, porQue: "en castellano", ...p } as Finding["patron"] });

  it("se reescribe en ingles y no sale el texto guardado", () => {
    expect(porQueEnIngles(conPatron({ patron: "diodo", franja: { eje: "largo", desde: 0, hasta: 5, de: 10 } }))).toContain("bypass diode");
    expect(porQueEnIngles(conPatron({ patron: "celda-multiple", grumos: 3 }))).toContain("3 separate hot patches");
    expect(porQueEnIngles(conPatron({ patron: "punto-caliente" }))).toContain("5 % of the module");
    expect(porQueEnIngles(conPatron({ patron: "modulo-completo" }))).toContain("open circuit");
  });

  it("un string entero se explica como una conexion, no como 28 modulos malos", () => {
    const s = porQueEnIngles(f({ anomaly: "String completo", patron: { patron: "modulo-completo", confianza: "alta", fraccionCaliente: 1, grumos: 1, porQue: "en castellano" } as Finding["patron"] }))!;
    expect(s).toContain("one connection");
    expect(s).toContain("whole string");
  });

  it("el informe no lleva ni una palabra del texto en castellano", () => {
    const insp: Inspection = {
      ...({ id: "i", name: "Vuelo", createdAt: "2026-09-06T00:00:00Z", conditions: {}, findings: [] } as unknown as Inspection),
      findings: [conPatron({ patron: "punto-caliente" })].map((x) => ({ ...x, status: "confirmado" as const })),
    };
    const html = aInformeEntregable(insp);
    expect(html).not.toContain("en castellano");
    expect(html).toContain("hot patch");
  });
});
