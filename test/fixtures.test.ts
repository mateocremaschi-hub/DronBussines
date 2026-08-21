/**
 * El corredor de fixtures de campo.
 *
 * Cada archivo de `fixtures/` es un punto que alguien verifico parado al lado
 * del panel. Este test los corre a todos en cada build: es lo que hace que el
 * conocimiento de campo deje de vivir en la cabeza de una persona.
 *
 * Los fixtures marcados `"pending"` se saltean con un mensaje visible en vez de
 * romper el build. Ya tienen las expectativas cargadas; les falta la coordenada.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCoordinate } from "../src/geo/dms.js";
import { locate } from "../src/locate.js";
import { compileFarm } from "../src/profile/compile.js";
import type { Address, Fix, FarmProfile, TrackerRow } from "../src/types.js";

const FIXTURES_DIR = new URL("../fixtures", import.meta.url).pathname;
const FARMS_DIR = new URL("../farms", import.meta.url).pathname;

interface Fixture {
  status: "pending" | "verified";
  farm: string;
  description: string;
  covers?: string[];
  verifiedBy?: string;
  verifiedOn?: string;
  method?: string;
  mode?: "exact" | "within-candidates";
  row: TrackerRow;
  fix?: { lat: number; lon: number; accuracyM?: number };
  fixText?: string;
  expect: Partial<Pick<Address, "block" | "tracker" | "row" | "stringNumber" | "module" | "countedFrom">>;
}

function loadFixtures(): Array<{ file: string; fixture: Fixture }> {
  if (!existsSync(FIXTURES_DIR)) return [];
  const out: Array<{ file: string; fixture: Fixture }> = [];
  for (const farmDir of readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
    if (!farmDir.isDirectory()) continue;
    const dir = join(FIXTURES_DIR, farmDir.name);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || name.startsWith("_")) continue;
      const fixture = JSON.parse(readFileSync(join(dir, name), "utf8")) as Fixture;
      out.push({ file: `${farmDir.name}/${name}`, fixture });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function loadProfile(id: string): FarmProfile {
  return JSON.parse(readFileSync(join(FARMS_DIR, `${id}.json`), "utf8")) as FarmProfile;
}

const fixtures = loadFixtures();

describe("fixtures de campo", () => {
  it("hay al menos un fixture en el repo", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it("todos apuntan a un perfil que existe y traen expectativas", () => {
    for (const { file, fixture } of fixtures) {
      expect(() => loadProfile(fixture.farm), file).not.toThrow();
      expect(Object.keys(fixture.expect).length, file).toBeGreaterThan(0);
      expect(fixture.description, file).toBeTruthy();
    }
  });

  for (const { file, fixture } of fixtures) {
    const pending = fixture.status !== "verified";

    it.skipIf(pending)(`${file}: ${fixture.description}`, () => {
      const profile = loadProfile(fixture.farm);
      const farm = compileFarm(profile, [fixture.row]);

      const coords = fixture.fixText ? parseCoordinate(fixture.fixText) : fixture.fix;
      if (!coords) throw new Error(`El fixture ${file} no trae ni "fix" ni "fixText".`);

      const fixInput: Fix = { lat: coords.lat, lon: coords.lon };
      if (fixture.fix?.accuracyM != null) fixInput.accuracyM = fixture.fix.accuracyM;

      const result = locate(fixInput, farm);
      expect(result.best, `${file}: el motor no encontro ninguna fila cerca`).not.toBeNull();

      const matches = (a: Address) =>
        Object.entries(fixture.expect).every(
          ([k, v]) => (a as unknown as Record<string, unknown>)[k] === v,
        );

      if ((fixture.mode ?? "within-candidates") === "exact") {
        expect(result.best, file).toMatchObject(fixture.expect);
      } else {
        // Sin RTK, exigir el modulo exacto testea la suerte del GPS, no el
        // codigo. Lo que se exige es que la respuesta correcta este entre los
        // candidatos que el tecnico va a ver.
        const hit = result.candidates.find(matches);
        expect(
          hit,
          `${file}: la direccion esperada no aparecio entre los ${result.candidates.length} candidatos. ` +
            `Mejor resultado: ${JSON.stringify(result.best)}`,
        ).toBeDefined();
      }
    });
  }

  it("informa cuantos fixtures siguen esperando coordenadas", () => {
    const pending = fixtures.filter((f) => f.fixture.status !== "verified");
    if (pending.length > 0) {
      console.log(
        `\n  ${pending.length} fixture(s) esperando coordenadas reales:\n` +
          pending.map((p) => `    - ${p.file}`).join("\n") +
          `\n  Ver fixtures/README.md para completarlos.\n`,
      );
    }
    // No es una falla: es el estado esperado hasta la proxima salida a campo.
    expect(pending.length).toBeLessThanOrEqual(fixtures.length);
  });
});
