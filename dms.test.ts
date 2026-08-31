import { describe, expect, it } from "vitest";
import { parseCoordinate } from "../src/geo/dms.js";

/**
 * Estos tests existen por un caso real: una prueba de campo dio un resultado
 * equivocado y se buscó el bug en el cálculo durante horas. La causa era la
 * conversión manual de grados-minutos-segundos a decimal.
 */
describe("parseCoordinate", () => {
  const expected = { lat: -27.5043333, lon: 152.7528333 };

  const forms = [
    "-27.5043333, 152.7528333",
    `27°30'15.6"S 152°45'10.2"E`,
    `S27°30'15.6" E152°45'10.2"`,
    "27 30 15.6 S, 152 45 10.2 E",
    `27°30.26'S 152°45.17'E`,
  ];

  for (const form of forms) {
    it(`entiende ${form}`, () => {
      const got = parseCoordinate(form);
      expect(got.lat).toBeCloseTo(expected.lat, 4);
      expect(got.lon).toBeCloseTo(expected.lon, 4);
    });
  }

  it("respeta el orden cuando la longitud viene primero", () => {
    const got = parseCoordinate(`152°45'10.2"E 27°30'15.6"S`);
    expect(got.lat).toBeCloseTo(expected.lat, 4);
    expect(got.lon).toBeCloseTo(expected.lon, 4);
  });

  it("maneja el hemisferio norte y el oeste", () => {
    const got = parseCoordinate(`40°26'46"N 79°58'56"W`);
    expect(got.lat).toBeCloseTo(40.44611, 4);
    expect(got.lon).toBeCloseTo(-79.98222, 4);
  });

  it("rechaza una latitud imposible en vez de devolver basura", () => {
    expect(() => parseCoordinate("127.5, 152.7")).toThrow(RangeError);
  });

  it("rechaza texto que no es una coordenada", () => {
    expect(() => parseCoordinate("bloque 5 tracker 42")).toThrow();
  });

  it("rechaza una sola componente", () => {
    expect(() => parseCoordinate("-27.5043333")).toThrow(SyntaxError);
  });
});
