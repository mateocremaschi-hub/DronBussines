/**
 * Los formatos de entrega.
 *
 * El entregable es el producto: el cliente no ve la app, ve el archivo. Y
 * compite contra un proveedor que ya entrega Excel con link a la foto de cada
 * hallazgo, asi que estas piezas son las que deciden si el trabajo se contrata
 * de nuevo.
 */

import { describe, expect, it } from "vitest";
import { aExcel, aInformeHtml, COLUMNAS, entregables, filaDe, nombreDeFoto } from "../app/informe";
import type { FarmProfile } from "@locator";
import type { Finding, Inspection } from "../app/inspection";

function hallazgo(over: Partial<Finding> = {}): Finding {
  return {
    id: "1",
    fileName: "DJI_0234_T.JPG",
    fix: { lat: -32.4844, lon: 148.9408, accuracyM: 3, takenAt: "2026-08-30T09:15:00Z" },
    address: {
      block: "17", tracker: "17-042", row: "R1", stringNumber: 2, stringLabel: "S-1.2.2.7",
      module: 19, countedFrom: "near-dc", confidence: 0.94, dcBoxLabel: "DCB-1.1.10",
    },
    candidates: [],
    warnings: [],
    status: "confirmado",
    deltaT: 14.3,
    anomaly: "diodo de bypass",
    klass: 2,
    ...over,
  } as unknown as Finding;
}

function inspeccion(findings: Finding[]): Inspection {
  return {
    id: "i1", name: "Wellington vuelo 1", farmName: "Wellington North",
    createdAt: "2026-08-30", conditions: { irradianceWm2: 780, ambientC: 24, windMs: 2 },
    findings,
  } as unknown as Inspection;
}

describe("como se llama la foto que se entrega", () => {
  /*
    Esta es la diferencia contra el otro proveedor: su link apunta a
    DJI_0234_T.JPG y el de este dice que es sin abrir nada.
  */
  it("lleva la direccion, el delta y el defecto", () => {
    const n = nombreDeFoto(hallazgo());
    expect(n).toContain("B17");
    expect(n).toContain("17-042");
    expect(n).toContain("R1");
    expect(n).toContain("m19");
    expect(n).toContain("+14.3C");
    expect(n).toContain("diodo-de-bypass");
  });

  /*
    El nombre original va al final y no se pierde: sin eso no hay forma de
    volver del informe a la foto cruda del vuelo, y eso hace falta cuando
    alguien discute un hallazgo.
  */
  it("conserva el nombre original y la extension", () => {
    const n = nombreDeFoto(hallazgo());
    expect(n).toContain("DJI_0234_T");
    expect(n.endsWith(".JPG")).toBe(true);
  });

  it("ordena la carpeta por bloque y tracker, que es como se camina", () => {
    const nombres = [
      nombreDeFoto(hallazgo({ address: { ...hallazgo().address!, block: "17", tracker: "17-042" } as never })),
      nombreDeFoto(hallazgo({ address: { ...hallazgo().address!, block: "02", tracker: "02-005" } as never })),
      nombreDeFoto(hallazgo({ address: { ...hallazgo().address!, block: "02", tracker: "02-001" } as never })),
    ].sort();
    expect(nombres[0]).toContain("02-001");
    expect(nombres[1]).toContain("02-005");
    expect(nombres[2]).toContain("17-042");
  });

  it("un hallazgo sin ubicar no rompe el nombre", () => {
    const n = nombreDeFoto(hallazgo({ address: null, deltaT: undefined, anomaly: undefined }));
    expect(n).toContain("sin-bloque");
    expect(n).not.toMatch(/[/\\:*?"<>|]/);
  });

  it("nunca deja caracteres que rompan un nombre de archivo", () => {
    const n = nombreDeFoto(hallazgo({ anomaly: 'celda / rota: "grave"' }));
    expect(n).not.toMatch(/[/\\:*?"<>|]/);
  });
});

describe("que se entrega y que no", () => {
  it("los descartados quedan afuera de todos los formatos", () => {
    const i = inspeccion([hallazgo(), hallazgo({ id: "2", status: "descartado" } as never)]);
    expect(entregables(i)).toHaveLength(1);
  });

  it("la fila tiene una celda por columna, siempre", () => {
    expect(filaDe(hallazgo())).toHaveLength(COLUMNAS.length);
    expect(filaDe(hallazgo({ address: null }))).toHaveLength(COLUMNAS.length);
  });
});

describe("el Excel", () => {
  it("sale como xlsx de verdad, no como CSV renombrado", async () => {
    const bytes = await aExcel(inspeccion([hallazgo()]));
    // Un .xlsx es un ZIP: firma PK\x03\x04.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  /*
    Las condiciones del vuelo van adentro. La norma de termografia exige
    documentarlas, y pedirlas en la pantalla para despues no llevarlas al
    entregable es hacer cargar seis campos con frio para nada.
  */
  it("lleva las condiciones del vuelo", async () => {
    const XLSX = await import("xlsx");
    const bytes = await aExcel(inspeccion([hallazgo()]));
    const libro = XLSX.read(bytes, { type: "array" });
    const texto = XLSX.utils.sheet_to_csv(libro.Sheets[libro.SheetNames[0]!]!);
    expect(texto).toContain("Irradiancia");
    expect(texto).toContain("780");
    expect(texto).toContain("Wellington North");
  });

  it("el link de cada fila apunta a su foto renombrada", async () => {
    const XLSX = await import("xlsx");
    const f = hallazgo();
    const bytes = await aExcel(inspeccion([f]));
    const hoja = XLSX.read(bytes, { type: "array" }).Sheets.Hallazgos!;
    const conLink = Object.values(hoja).filter(
      (c) => c && typeof c === "object" && "l" in (c as object),
    ) as Array<{ l: { Target: string } }>;
    expect(conLink).toHaveLength(1);
    expect(conLink[0]!.l.Target).toBe(`fotos/${nombreDeFoto(f)}`);
  });
});

describe("el informe visual", () => {
  it("agrupa por bloque, que es como se reparte el trabajo", () => {
    const html = aInformeHtml(inspeccion([
      hallazgo(),
      hallazgo({ id: "2", address: { ...hallazgo().address!, block: "02" } as never }),
    ]));
    expect(html).toContain("Bloque 17");
    expect(html).toContain("Bloque 02");
  });

  it("mete la foto adentro del archivo, no un link a una carpeta", () => {
    const html = aInformeHtml(inspeccion([hallazgo()]), [
      { fileName: "DJI_0234_T.JPG", dataUrl: "data:image/jpeg;base64,AAAA" },
    ]);
    expect(html).toContain("data:image/jpeg;base64,AAAA");
    expect(html).not.toContain('src="fotos/');
  });

  /*
    Sin fotos igual sale. Un informe sin imagenes sigue sirviendo, y fallar
    porque falta una foto seria peor que entregarlo incompleto y decirlo.
  */
  it("sin fotos no falla: lo dice y sigue", () => {
    const html = aInformeHtml(inspeccion([hallazgo()]));
    expect(html).toContain("Sin la foto");
    expect(html).toContain("17-042");
  });

  it("escapa lo que escribe el tecnico, que es texto libre", () => {
    const html = aInformeHtml(inspeccion([hallazgo({ note: '<script>alert(1)</script>' })]));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("pinta por severidad para poder priorizar de un vistazo", () => {
    const html = aInformeHtml(inspeccion([
      hallazgo({ deltaT: 25 }), hallazgo({ id: "2", deltaT: 12 }), hallazgo({ id: "3", deltaT: 4 }),
    ]));
    expect(html).toContain('class="h critica"');
    expect(html).toContain('class="h moderada"');
    expect(html).toContain('class="h leve"');
  });
});

// ---------------------------------------------------------------------------

/**
 * El informe declara desde que punta se cuentan los modulos.
 *
 * Es el contrato del entregable. El numero de modulo es una POSICION contada
 * desde una punta, y sin decir cual "modulo 19" no se puede verificar contra
 * nada: el que camina la fila no sabe de que lado arrancar a contar.
 *
 * No es teorico. Los parques nuevos cuentan desde el extremo norte y los que ya
 * estaban conservan su regla vieja a proposito, asi que del mismo sitio pueden
 * salir dos informes numerados al reves entre si. La unica cosa que los
 * distingue es esta linea — y por eso la frase tiene que salir de la
 * configuracion real del parque, no estar escrita a mano.
 */
describe("la convencion de conteo, declarada en el entregable", () => {
  const desdeElNorte: FarmProfile["addressing"] = {
    originStrategy: "fixed-end",
    fixedEnd: "north",
    inversionStrategy: "none",
  };
  const desdeLaCaja: FarmProfile["addressing"] = {
    originStrategy: "dc-box-end",
    dcBoxPlacement: "center-road",
    inversionStrategy: "piercing-chain",
  };

  const excelComoTexto = async (addressing?: FarmProfile["addressing"]) => {
    const XLSX = await import("xlsx");
    const bytes = await aExcel(inspeccion([hallazgo()]), "fotos", addressing);
    const libro = XLSX.read(bytes, { type: "array" });
    return XLSX.utils.sheet_to_csv(libro.Sheets[libro.SheetNames[0]!]!);
  };

  it("el informe HTML dice que se cuenta desde el norte", () => {
    const html = aInformeHtml(inspeccion([hallazgo()]), [], desdeElNorte);
    expect(html).toContain("Los modulos se numeran desde el extremo norte de cada string.");
  });

  it("y dice la otra frase cuando el parque cuenta desde la caja", () => {
    const html = aInformeHtml(inspeccion([hallazgo()]), [], desdeLaCaja);
    expect(html).toContain("mas cercano a su caja de continua");
    expect(html).not.toContain("extremo norte");
  });

  it("el Excel la lleva con los metadatos, arriba de la tabla", async () => {
    expect(await excelComoTexto(desdeElNorte)).toContain(
      "Los modulos se numeran desde el extremo norte de cada string.",
    );
  });

  it("y el Excel del parque que cuenta desde la caja dice eso", async () => {
    const texto = await excelComoTexto(desdeLaCaja);
    expect(texto).toContain("mas cercano a su caja de continua");
    expect(texto).not.toContain("extremo norte");
  });

  /*
    La inversion cambia de que punta se cuenta la mitad de los strings. Una
    linea que declara solo la regla del origen y se calla esto estaria mintiendo
    en todas las filas de mas de un string.
  */
  it("cuando hay strings invertidos, lo dice en la misma frase", () => {
    const html = aInformeHtml(inspeccion([hallazgo()]), [], desdeLaCaja);
    expect(html).toContain("se cuenta al reves");
  });

  /*
    Un llamador que no tenga el perfil a mano no puede terminar declarando una
    regla falsa: es peor que no declarar ninguna.
  */
  it("sin el perfil del parque no inventa ninguna convencion", async () => {
    expect(aInformeHtml(inspeccion([hallazgo()]))).not.toContain("Los modulos se numeran");
    expect(await excelComoTexto()).not.toContain("Los modulos se numeran");
  });

  /*
    La linea nueva corre una fila para abajo toda la tabla del Excel. El
    hipervinculo de la foto se ubica contando las filas de metadatos, asi que si
    esa cuenta no la contempla, cada link queda apuntando a la foto del hallazgo
    de arriba — y el link es justamente lo que hace al entregable.
  */
  it("el link de la foto sigue cayendo en su fila con la linea agregada", async () => {
    const XLSX = await import("xlsx");
    const f = hallazgo();
    const bytes = await aExcel(inspeccion([f]), "fotos", desdeElNorte);
    const hoja = XLSX.read(bytes, { type: "array" }).Sheets.Hallazgos!;
    const conLink = Object.entries(hoja).filter(
      ([, c]) => c && typeof c === "object" && "l" in (c as object),
    ) as Array<[string, { v: string; l: { Target: string } }]>;
    expect(conLink).toHaveLength(1);
    const [ref, celda] = conLink[0]!;
    expect(celda.l.Target).toBe(`fotos/${nombreDeFoto(f)}`);
    // Y sobre la celda que tiene el nombre nuevo, no sobre la de al lado.
    expect(celda.v).toBe(nombreDeFoto(f));
    expect(XLSX.utils.decode_cell(ref).c).toBe(COLUMNAS.indexOf("foto"));
  });
});
