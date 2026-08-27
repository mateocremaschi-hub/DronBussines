/**
 * Reconocimiento de encabezados.
 *
 * Se compara por token completo y no con expresiones sobre el texto entero,
 * porque asi se colo un error real: el patron de "este" matcheaba la E final de
 * "NORTE", y la columna PICA2_NORTE terminaba asignada a la longitud.
 */

import { describe, expect, it } from "vitest";
import { suggestMapping } from "../app/ingest";

const completo = (m: ReturnType<typeof suggestMapping>) =>
  ["block", "tracker", "startX", "startY", "endX", "endY"].every((k) => (m as never)[k]);

describe("encabezados recomendados", () => {
  it("reconoce los 11 de la plantilla en castellano", () => {
    const m = suggestMapping([
      "BLOQUE", "TRACKER", "FILA",
      "PICA1_NORTE", "PICA1_ESTE", "PICA2_NORTE", "PICA2_ESTE",
      "LADO", "POS", "POS_TOTAL", "STRINGS",
    ]);
    expect(m).toEqual({
      block: "BLOQUE", tracker: "TRACKER", row: "FILA",
      startY: "PICA1_NORTE", startX: "PICA1_ESTE",
      endY: "PICA2_NORTE", endX: "PICA2_ESTE",
      side: "LADO", pos: "POS", posTotal: "POS_TOTAL", stringNumbers: "STRINGS",
    });
  });

  it("reconoce los mismos en ingles", () => {
    const m = suggestMapping([
      "BLOCK", "TRACKER", "ROW", "LAT1", "LON1", "LAT2", "LON2",
      "SIDE", "POS", "POS TOTAL", "STRINGS",
    ]);
    expect(m.startY).toBe("LAT1");
    expect(m.endX).toBe("LON2");
    expect(Object.keys(m)).toHaveLength(11);
  });

  it("no confunde NORTE con ESTE por la E del final", () => {
    const m = suggestMapping(["bloque", "tracker", "pica1Norte", "pica1Este", "pica2Norte", "pica2Este"]);
    expect(m.startY).toBe("pica1Norte");
    expect(m.startX).toBe("pica1Este");
    expect(m.endY).toBe("pica2Norte");
    expect(m.endX).toBe("pica2Este");
  });

  it("acepta el archivo real de Edenvale", () => {
    const m = suggestMapping(["bloque", "tracker", "MOTOR ROW", "pica1Y", "pica1X", "pica2Y", "pica2X"]);
    expect(completo(m)).toBe(true);
    expect(m.row).toBe("MOTOR ROW");
    expect(m.startY).toBe("pica1Y");
    expect(m.endX).toBe("pica2X");
  });

  it("acepta picas nombradas por inicio y fin en vez de 1 y 2", () => {
    const m = suggestMapping([
      "block", "tracker", "lat_inicio", "lon_inicio", "lat_fin", "lon_fin",
    ]);
    expect(m.startY).toBe("lat_inicio");
    expect(m.endY).toBe("lat_fin");
    expect(completo(m)).toBe(true);
  });

  it("acepta picas nombradas por su rumbo (norte / sur)", () => {
    const m = suggestMapping([
      "bloque", "tracker", "Y_NORTE", "X_NORTE", "Y_SUR", "X_SUR",
    ]);
    expect(m.startY).toBe("Y_NORTE");
    expect(m.endY).toBe("Y_SUR");
    expect(completo(m)).toBe(true);
  });

  it("aguanta acentos y mayusculas mezcladas", () => {
    const m = suggestMapping(["Bloque", "Tracker", "Latitud 1", "Longitud 1", "Latitud 2", "Longitud 2"]);
    expect(completo(m)).toBe(true);
  });

  // Lo importante: cuando no reconoce, no adivina. El asistente muestra todas
  // las columnas y las elige la persona.
  it("no inventa nada con encabezados que no dicen nada", () => {
    const m = suggestMapping(["col1", "col2", "col3", "col4"]);
    expect(Object.keys(m)).toHaveLength(0);
  });

  it("nunca asigna la misma columna a dos campos", () => {
    const m = suggestMapping([
      "BLOQUE", "TRACKER", "FILA", "PICA1_NORTE", "PICA1_ESTE", "PICA2_NORTE", "PICA2_ESTE",
      "LADO", "POS", "POS_TOTAL", "STRINGS",
    ]);
    const usados = Object.values(m);
    expect(new Set(usados).size).toBe(usados.length);
  });
});

// ---------------------------------------------------------------------------

describe("las dos puntas se reconocen simetricamente", () => {
  /**
   * "final" estaba en la lista y "inicial" no. En una planilla con "ESTE
   * INICIAL / ESTE FINAL / NORTE INICIAL / NORTE FINAL" —que es como las
   * escribe medio mundo— se reconocian DOS columnas de cuatro. Y eso es peor
   * que no reconocer ninguna: el asistente muestra la mitad asignada, parece
   * que anduvo, y las dos que faltan se pasan por alto.
   */
  it("ESTE/NORTE INICIAL y FINAL: las cuatro", () => {
    const m = suggestMapping([
      "BLOQUE", "TRACKER", "ESTE INICIAL", "NORTE INICIAL", "ESTE FINAL", "NORTE FINAL",
    ]);
    expect(m.startX).toBe("ESTE INICIAL");
    expect(m.startY).toBe("NORTE INICIAL");
    expect(m.endX).toBe("ESTE FINAL");
    expect(m.endY).toBe("NORTE FINAL");
  });

  it("tambien con 'comienzo' y 'termino'", () => {
    const m = suggestMapping(["X COMIENZO", "Y COMIENZO", "X TERMINO", "Y TERMINO"]);
    expect(m.startX).toBe("X COMIENZO");
    expect(m.endY).toBe("Y TERMINO");
  });

  it("y las que ya andaban siguen andando", () => {
    const m = suggestMapping(["ESTE 1", "NORTE 1", "ESTE 2", "NORTE 2"]);
    expect(m.startX).toBe("ESTE 1");
    expect(m.endY).toBe("NORTE 2");
  });
});
