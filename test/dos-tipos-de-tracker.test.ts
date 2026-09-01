/**
 * Un parque con DOS tipos de tracker mezclados.
 *
 * Salio de una pregunta del campo que tumbo un supuesto del diseño: "y si esos
 * trackers estan metidos en la misma lista de strings donde esta el resto, y en
 * los mismos mapas, ¿subo los mapas dos veces?".
 *
 * La respuesta anterior era que si: dar de alta el parque dos veces, subir los
 * mismos PDF dos veces, cortar la lista de strings a mano, y terminar con dos
 * parques en la app para un solo sitio — con los vuelos y los informes
 * partidos al medio. Eso no es una limitacion tecnica, es un dia de
 * trabajo perdido cada vez que se visita el parque.
 *
 * Ahora el tipo va por FILA, y casi nunca hay que declararlo: el compilador
 * elige mirando el largo medido de cada fila, que es un dato que ya viene en el
 * archivo de picas. Un tracker de 28 modulos mide 32 m y uno de 56 mide 65.
 */

import { describe, expect, it } from "vitest";
import { compileFarm } from "../src/profile/compile.js";
import { locate, modulesOfRow } from "../src/locate.js";
import { ProfileError } from "../src/profile/validate.js";
import type { FarmProfile } from "../src/types.js";
import { makeRow, nominalLengthM, pointAtSlot } from "./helpers/synthetic.js";

const BAHIA_MM = 824;

/** El tipo principal: 56 modulos en dos strings de 28, con la bahia en el medio. */
const perfil: FarmProfile = {
  id: "mixto", name: "Parque mixto", profileVersion: 1,
  module: { widthMm: 1134, gapMm: 10, lengthMm: 2278, orientation: "portrait", pitchMm: null },
  topology: {
    modulesPerString: 28,
    stringsPerRow: 2,
    stringGapMm: BAHIA_MM,
    variants: [
      {
        id: "corto",
        name: "Tracker corto de 28",
        modulesPerString: 28,
        stringsPerRow: 1,
        gaps: [{ afterModule: 14, mm: BAHIA_MM }],
      },
    ],
  },
  geometry: { source: "survey-stakes", endpointOffsetMm: 0, endpointOffsetMode: "none" },
  addressing: { originStrategy: "per-row-flag", inversionStrategy: "none" },
};

/** El mismo perfil visto como si solo existiera el tipo corto: para medir largos. */
const soloCorto: FarmProfile = {
  ...perfil,
  topology: {
    modulesPerString: 28, stringsPerRow: 1,
    stringGapMm: 0, gaps: [{ afterModule: 14, mm: BAHIA_MM }],
  },
};
const soloLargo: FarmProfile = {
  ...perfil,
  topology: { modulesPerString: 28, stringsPerRow: 2, stringGapMm: BAHIA_MM },
};

const base = { azimuthDeg: 180, block: "01", row: "R1", originEnd: "start" as const };

/** Una fila larga y una corta, en el MISMO bloque, como estan en el terreno. */
const larga = makeRow(
  { ...base, id: "01-001-R1", tracker: "01-001", anchor: { lat: -26.92, lon: 150.58 } },
  soloLargo,
);
const corta = makeRow(
  { ...base, id: "01-002-R1", tracker: "01-002", anchor: { lat: -26.92, lon: 150.5805 } },
  soloCorto,
);

const farm = compileFarm(perfil, [larga, corta]);
const filaLarga = farm.rows.find((r) => r.source.id === "01-001-R1")!;
const filaCorta = farm.rows.find((r) => r.source.id === "01-002-R1")!;

describe("los dos tipos conviven en un solo parque", () => {
  it("la geometria sintetica es la que se cree que es", () => {
    // 64,868 m es el largo que da el manual del AXD para la fila de 56, y
    // 32,836 el de la de 28. Los dos salen de la misma cuenta que el motor.
    expect(nominalLengthM(soloLargo)).toBeCloseTo(64.868, 2);
    expect(nominalLengthM(soloCorto)).toBeCloseTo(32.836, 2);
    // Treinta y dos metros de diferencia: no hay forma de confundirlos.
    expect(nominalLengthM(soloLargo) - nominalLengthM(soloCorto)).toBeGreaterThan(30);
  });

  /**
   * El corazon de la solucion: nadie clasifico nada. El archivo de picas no
   * trae una columna de "tipo de tracker" y no hace falta que la traiga.
   */
  it("cada fila cae en su tipo sola, por el largo medido", () => {
    expect(filaLarga.variantId).toBeUndefined();      // el tipo principal
    expect(filaCorta.variantId).toBe("corto");
  });

  it("y cada una queda con SU cantidad de modulos", () => {
    expect(filaLarga.modulesPerRow).toBe(56);
    expect(filaCorta.modulesPerRow).toBe(28);
    expect(filaLarga.stringsPerRow).toBe(2);
    expect(filaCorta.stringsPerRow).toBe(1);
  });

  it("ninguna de las dos sale con la geometria rota", () => {
    expect(Math.abs(filaLarga.lengthResidualMmPerModule)).toBeLessThan(5);
    expect(Math.abs(filaCorta.lengthResidualMmPerModule)).toBeLessThan(5);
  });

  it("el informe de carga dice cuantas quedaron de cada tipo", () => {
    const texto = farm.buildWarnings.map((w) => w.message).join(" | ");
    expect(texto).toMatch(/1 de 2 filas quedaron como "el tipo principal"/);
    expect(texto).toMatch(/1 de 2 filas quedaron como "Tracker corto de 28"/);
  });
});

// ---------------------------------------------------------------------------

describe("las direcciones salen bien en las dos", () => {
  const enHueco = (fila: typeof larga, slot: number, p: FarmProfile) =>
    locate({ ...pointAtSlot(fila, slot, p, "start"), accuracyM: 0.3 }, farm);

  it("la larga numera hasta 56, en dos strings", () => {
    expect(enHueco(larga, 1, soloLargo).best).toMatchObject({ stringNumber: 1, module: 1 });
    expect(enHueco(larga, 56, soloLargo).best).toMatchObject({ stringNumber: 2, module: 28 });
    expect(enHueco(larga, 29, soloLargo).best).toMatchObject({ stringNumber: 2, module: 1 });
  });

  it("la corta numera de corrido hasta 28, en un solo string", () => {
    expect(enHueco(corta, 1, soloCorto).best).toMatchObject({ stringNumber: 1, module: 1 });
    expect(enHueco(corta, 15, soloCorto).best).toMatchObject({ stringNumber: 1, module: 15 });
    expect(enHueco(corta, 28, soloCorto).best).toMatchObject({ stringNumber: 1, module: 28 });
  });

  /**
   * Lo que pasaba antes de esto: la fila corta se numeraba con la regla de la
   * larga. El modulo 15 salia como "string 2, modulo 1" — un string que en ese
   * tracker no existe — y el resto de la fila caia fuera de su propia extension.
   */
  it("la corta NO se numera con la regla de la larga", () => {
    const r = enHueco(corta, 15, soloCorto).best!;
    expect(r.stringNumber).not.toBe(2);
    expect(r.module).toBe(15);
  });

  it("recorrer la fila entera da 56 modulos en una y 28 en la otra", () => {
    expect(modulesOfRow(filaLarga, farm)).toHaveLength(56);
    expect(modulesOfRow(filaCorta, farm)).toHaveLength(28);
  });
});

// ---------------------------------------------------------------------------

describe("cuando el reparto automatico no alcanza", () => {
  /**
   * La salida de emergencia. Si algun dia hay dos tipos que miden casi lo mismo
   * —cambia el panel pero no el largo, por ejemplo— el largo deja de alcanzar y
   * hay que poder decirlo a mano. Declarado MANDA sobre lo medido.
   */
  it("una fila puede declarar su tipo a mano, y eso le gana al largo", () => {
    // Sola, esta fila corta se resuelve como "corto".
    const sola = compileFarm(perfil, [larga, corta]);
    expect(sola.rows[1]!.modulesPerRow).toBe(28);

    // Marcada a mano como del tipo principal, se le hace caso aunque no cierre.
    const forzada = compileFarm(perfil, [larga, { ...corta, variantId: "principal" }]);
    expect(forzada.rows[1]!.modulesPerRow).toBe(28); // "principal" no existe: cae al largo

    // Y al reves: una fila LARGA marcada como corta se compila como corta.
    const alReves = compileFarm(perfil, [{ ...larga, variantId: "corto" }, corta]);
    expect(alReves.rows[0]!.modulesPerRow).toBe(28);
    expect(alReves.rows[0]!.variantId).toBe("corto");
    // Y el aviso de largo salta, que es como se ve que la marca estaba mal.
    expect(Math.abs(alReves.rows[0]!.lengthResidualMmPerModule)).toBeGreaterThan(15);
  });

  it("un tipo que el perfil no declara se avisa, no se ignora", () => {
    const f = compileFarm(perfil, [larga, { ...corta, variantId: "inventado" }]);
    const texto = f.buildWarnings.map((w) => w.message).join(" | ");
    expect(texto).toMatch(/pide el tipo de tracker "inventado"/);
    // Y aun asi la fila queda bien, elegida por su largo.
    expect(f.rows[1]!.modulesPerRow).toBe(28);
  });

  /**
   * Si un tipo declarado no le toca a ninguna fila, sobra en el perfil o sus
   * medidas estan mal. Callarlo deja al operador creyendo que cargo algo que
   * no esta haciendo nada.
   */
  it("un tipo que no le toca a ninguna fila se dice", () => {
    const f = compileFarm(perfil, [larga]);
    const texto = f.buildWarnings.map((w) => w.message).join(" | ");
    expect(texto).toMatch(/0 de 1 filas quedaron como "Tracker corto de 28"/);
    expect(texto).toMatch(/Ninguna fila del parque se parece a ese tipo/);
  });
});

// ---------------------------------------------------------------------------

describe("las variantes se validan como topologias de verdad", () => {
  const conVariante = (v: unknown): FarmProfile =>
    ({ ...perfil, topology: { ...perfil.topology, variants: [v] } }) as FarmProfile;

  it("una variante sin id se rechaza: es como cada fila dice de que tipo es", () => {
    expect(() => compileFarm(conVariante({ modulesPerString: 14 }), [larga])).toThrow(ProfileError);
  });

  it("dos variantes con el mismo id se rechazan", () => {
    const p = {
      ...perfil,
      topology: {
        ...perfil.topology,
        variants: [{ id: "corto" }, { id: "corto", modulesPerString: 14 }],
      },
    } as FarmProfile;
    expect(() => compileFarm(p, [larga])).toThrow(/repite "corto"/);
  });

  /**
   * Un hueco despues del ultimo modulo de la variante. Con la topologia
   * principal seria valido (56 modulos) y con la variante no (28): por eso hay
   * que validar cada variante contra SU propio total, no contra el del parque.
   */
  it("un hueco fuera de la fila de la variante se rechaza con su propio total", () => {
    const p = conVariante({
      id: "corto", modulesPerString: 28, stringsPerRow: 1,
      gaps: [{ afterModule: 40, mm: 800 }],
    });
    expect(() => compileFarm(p, [larga])).toThrow(/la fila tiene 28 modulos/);
  });
});
