/**
 * Validacion del Farm Profile sin dependencias externas.
 *
 * Falla ruidosa y temprano: un perfil mal armado tiene que romper al cargarlo,
 * no producir direcciones equivocadas en silencio seis meses despues.
 */

import type { FarmProfile } from "../types.js";

export class ProfileError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Farm Profile invalido:\n  - ${issues.join("\n  - ")}`);
    this.name = "ProfileError";
    this.issues = issues;
  }
}

const ORIGIN_STRATEGIES = ["fixed-end", "dc-box-end", "per-row-flag"] as const;
const INVERSION_STRATEGIES = ["none", "piercing-chain", "per-string-flag"] as const;
const CARDINALS = ["north", "south", "east", "west"] as const;

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function validateProfile(input: unknown): FarmProfile {
  const issues: string[] = [];
  const p = input as Partial<FarmProfile>;

  if (!p || typeof p !== "object") throw new ProfileError(["El perfil no es un objeto."]);

  if (typeof p.id !== "string" || !p.id.trim()) issues.push("`id` es obligatorio.");
  if (typeof p.name !== "string" || !p.name.trim()) issues.push("`name` es obligatorio.");
  if (!isPositiveInt(p.profileVersion)) {
    issues.push("`profileVersion` tiene que ser un entero positivo.");
  }

  // --- module --------------------------------------------------------------
  const m = p.module;
  if (!m || typeof m !== "object") {
    issues.push("Falta el bloque `module`.");
  } else {
    if (!isFiniteNumber(m.widthMm) || m.widthMm <= 0) {
      issues.push("`module.widthMm` tiene que ser un numero positivo (mm).");
    }
    if (!isFiniteNumber(m.gapMm) || m.gapMm < 0) {
      issues.push("`module.gapMm` tiene que ser un numero >= 0 (mm).");
    }
    if (m.pitchMm != null && m.pitchMm !== "derive" && !(isFiniteNumber(m.pitchMm) && m.pitchMm > 0)) {
      issues.push('`module.pitchMm` tiene que ser un numero positivo, null, o "derive".');
    }
  }

  // --- topology ------------------------------------------------------------
  const t = p.topology;
  if (!t || typeof t !== "object") {
    issues.push("Falta el bloque `topology`.");
  } else {
    if (!isPositiveInt(t.modulesPerString)) {
      issues.push("`topology.modulesPerString` tiene que ser un entero positivo.");
    }
    if (!isPositiveInt(t.stringsPerRow)) {
      issues.push("`topology.stringsPerRow` tiene que ser un entero positivo.");
    }
    if (t.stringGapMm != null && (!isFiniteNumber(t.stringGapMm) || t.stringGapMm < 0)) {
      issues.push("`topology.stringGapMm` tiene que ser un numero >= 0 (mm).");
    }

    /**
     * Los huecos enumerados.
     *
     * Se valida con dureza porque un hueco mal puesto no rompe nada: corre los
     * modulos y devuelve un panel equivocado con toda confianza. Es el tipo de
     * error que solo aparece con alguien contando paneles con la mano.
     */
    if (t.gaps != null) {
      if (!Array.isArray(t.gaps)) {
        issues.push("`topology.gaps` tiene que ser una lista de { afterModule, mm }.");
      } else {
        const total =
          isPositiveInt(t.modulesPerString) && isPositiveInt(t.stringsPerRow)
            ? t.modulesPerString * t.stringsPerRow
            : null;
        const vistos = new Set<number>();
        let previo = 0;
        t.gaps.forEach((g: unknown, i: number) => {
          const h = g as { afterModule?: unknown; mm?: unknown } | null;
          const donde = `topology.gaps[${i}]`;
          if (!h || typeof h !== "object") {
            issues.push(`\`${donde}\` tiene que ser un objeto { afterModule, mm }.`);
            return;
          }
          if (!isPositiveInt(h.afterModule)) {
            issues.push(`\`${donde}.afterModule\` tiene que ser un entero positivo.`);
          } else {
            if (total != null && h.afterModule >= total) {
              issues.push(
                `\`${donde}.afterModule\` es ${h.afterModule}, pero la fila tiene ${total} ` +
                "modulos. Un hueco va ENTRE dos modulos, asi que el ultimo valido es " +
                `${total - 1}. Un hueco despues del ultimo modulo es un voladizo, y eso se ` +
                "declara en geometry.endpointOffsetMm.",
              );
            }
            if (vistos.has(h.afterModule)) {
              issues.push(`\`${donde}.afterModule\` repite el modulo ${h.afterModule}.`);
            }
            vistos.add(h.afterModule);
            if (h.afterModule < previo) {
              issues.push(
                `\`${donde}\` viene despues del modulo ${previo} en la lista pero cae antes, ` +
                "en el " + String(h.afterModule) + ". Ordenalos como estan en la fila: leerlos " +
                "en orden es lo que deja comparar la lista contra el tracker de un vistazo.",
              );
            }
            previo = h.afterModule;
          }
          if (!isFiniteNumber(h.mm) || (h.mm as number) < 0) {
            issues.push(`\`${donde}.mm\` tiene que ser un numero >= 0 (mm).`);
          }
        });
      }
    }
  }

  // --- geometry ------------------------------------------------------------
  const g = p.geometry;
  if (!g || typeof g !== "object") {
    issues.push("Falta el bloque `geometry`.");
  } else {
    // Puede ser negativo: los modulos pueden sobresalir mas alla de la pica.
    if (!isFiniteNumber(g.endpointOffsetMm)) {
      issues.push(
        "`geometry.endpointOffsetMm` tiene que ser un numero (mm). Negativo si los modulos sobresalen mas alla de la pica.",
      );
    }
    if (g.endpointOffsetMode && !["both", "origin", "none", "centered"].includes(g.endpointOffsetMode)) {
      issues.push('`geometry.endpointOffsetMode` tiene que ser "both", "origin", "none" o "centered".');
    }
  }

  // --- addressing ----------------------------------------------------------
  const ad = p.addressing;
  if (!ad || typeof ad !== "object") {
    issues.push("Falta el bloque `addressing`.");
  } else {
    if (!ORIGIN_STRATEGIES.includes(ad.originStrategy)) {
      issues.push(
        `\`addressing.originStrategy\` tiene que ser una de: ${ORIGIN_STRATEGIES.join(", ")}.`,
      );
    }
    if (!INVERSION_STRATEGIES.includes(ad.inversionStrategy)) {
      issues.push(
        `\`addressing.inversionStrategy\` tiene que ser una de: ${INVERSION_STRATEGIES.join(", ")}.`,
      );
    }
    if (ad.originStrategy === "fixed-end" && !CARDINALS.includes(ad.fixedEnd as never)) {
      issues.push('La estrategia "fixed-end" necesita `addressing.fixedEnd` (north|south|east|west).');
    }
    // La regla del piercing connector esta verificada para dos strings por fila.
    // Con mas de dos no sabemos donde caen los piercings, y adivinarlo seria
    // repetir exactamente el error que ya costo dos viajes al campo.
    if (
      ad.inversionStrategy === "piercing-chain" &&
      isPositiveInt(t?.stringsPerRow) &&
      t.stringsPerRow > 2
    ) {
      issues.push(
        'La estrategia "piercing-chain" solo esta verificada con stringsPerRow <= 2. ' +
          'Para mas strings por fila usa "per-string-flag" y carga el bit por string ' +
          "hasta entender el patron.",
      );
    }
  }

  // --- crs -----------------------------------------------------------------
  if (p.crs && p.crs.type === "utm") {
    if (!isPositiveInt(p.crs.zone) || p.crs.zone > 60) {
      issues.push("`crs.zone` tiene que ser un entero entre 1 y 60.");
    }
    if (p.crs.hemisphere !== "N" && p.crs.hemisphere !== "S") {
      issues.push('`crs.hemisphere` tiene que ser "N" o "S".');
    }
  }

  if (issues.length) throw new ProfileError(issues);
  return p as FarmProfile;
}
