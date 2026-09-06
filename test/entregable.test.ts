/**
 * El Excel que se le entrega al cliente.
 *
 * Sale de la revision que hizo Mateo sobre el primer entregable real: se
 * fueron cinco columnas que eran el andamio del calculo y no el resultado, las
 * que quedan se llaman por lo que son, y va en ingles.
 */
import { describe, expect, it } from "vitest";
import { columnas, nombreEntregado, refDe, resumenDeEntrega } from "../app/entregable";
import type { Finding } from "../app/inspection";

const f = (o: Partial<Finding> = {}): Finding => ({
  id: "x", fileName: "DJI_0001_T.JPG", candidates: [], warnings: [], status: "pendiente",
  address: { rowId: "2-85", block: "2", tracker: "85", chunkIndex: 6, stringNumber: 7, module: 27,
    countedFrom: "near-dc", confidence: 1 } as Finding["address"],
  medicion: { celsius: 39.1, deltaT: 0.4, referenciaC: 38.8, vecinos: 26, ambito: "string",
    severidad: "normal", peor: "leve", origen: "celda", pixeles: 40, deltaInterno: 10.5 } as Finding["medicion"],
  ...o,
});

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
    expect(titulos).toContain("IEC class");
    expect(titulos).toContain("Action");
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

describe("el resumen por tipo", () => {
  it("cuenta por anomalia y clase, con las clase 3 primero", () => {
    const r = resumenDeEntrega([
      f({ anomaly: "Punto caliente", klass: 2 }),
      f({ anomaly: "Punto caliente", klass: 2 }),
      f({ anomaly: "Diodo de bypass", klass: 3 }),
    ]);
    expect(r[0]!.tipo).toBe("Bypass diode");
    expect(r[0]!.c3).toBe(1);
    expect(r[1]!.tipo).toBe("Hot spot");
    expect(r[1]!.n).toBe(2);
  });
});
