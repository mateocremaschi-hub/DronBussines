/**
 * Cuando el navegador no puede abrir NINGUNA foto.
 *
 * Wellington, bloque 2, 7 de septiembre. Safari devolvio "The I/O read
 * operation failed" en los 570 archivos —las 569 termicas y el MRK— y la app
 * los intento todos igual: cuatro intentos por archivo con espera creciente,
 * dos veces (la pasada de la escala y la del analisis). Veinte minutos para
 * llegar a una conclusion que ya estaba en el primer archivo, y despues una
 * pantalla que arriba decia "569 fotos medidas" y abajo "no se pudo usar
 * ninguno".
 *
 * El reintento sirve cuando falla UNA foto: el sistema esta ocupado y a la
 * segunda sale. Cuando fallan todas, la causa no es pasajera —son los permisos
 * que el navegador tenia sobre esos archivos y ya no tiene— y seguir
 * intentando solo gasta el tiempo de la persona.
 */

import { describe, expect, it, vi } from "vitest";
import { ArchivosQueNoSeAbren, QUE_HACER_SI_NO_ABRE, analizarFotos } from "../app/vuelo";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile } from "../src/types.js";
import { compileFarm, makeFrame } from "../src/index.js";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const filas = Array.from({ length: 4 }, (_, i) =>
  makeRow(
    {
      id: `05-10${i}-R1`, block: "05", tracker: `05-10${i}`, row: "R1",
      anchor: { lat: -26.92 + i * 0.00005, lon: 150.58 }, azimuthDeg: 180, side: "north",
    },
    profile,
  ),
);
const farm = compileFarm(profile, filas);
const frame = makeFrame(farm.origin.lat, farm.origin.lon);

/**
 * Un archivo que el navegador no puede abrir, como los devolvia Safari.
 *
 * `mirados` anota cuales llego a tocar la app, que es lo que se quiere medir:
 * el arreglo no es que falle mas rapido, es que deje de intentar.
 */
function ilegible(nombre: string, mirados?: Set<string>): File {
  const f = new File([new Uint8Array(8)], nombre, { type: "image/jpeg" });
  Object.defineProperty(f, "arrayBuffer", {
    configurable: true,
    value: () => {
      mirados?.add(nombre);
      return Promise.reject(new Error("The I/O read operation failed."));
    },
  });
  return f;
}

const opts = { moduloAnchoM: 1.134, moduloLargoM: 2.278, celdaM: 0.16, ajuste: { dxM: 0, dyM: 0 } };

describe("cuando no se puede abrir ningun archivo", () => {
  it("corta en los primeros y no recorre los 570", async () => {
    const mirados = new Set<string>();
    const files = Array.from({ length: 570 }, (_, i) => ilegible(`DJI_${1000 + i}_T.JPG`, mirados));
    await expect(analizarFotos(farm, frame, files, opts)).rejects.toBeInstanceOf(ArchivosQueNoSeAbren);
    // Ocho archivos, no 570. El resto ni se toca.
    expect(mirados.size).toBeLessThanOrEqual(12);
  }, 30000);

  it("y el mensaje dice que hacer, no solo que fallo", async () => {
    const files = Array.from({ length: 20 }, (_, i) => ilegible(`DJI_${i}_T.JPG`));
    await expect(analizarFotos(farm, frame, files, opts)).rejects.toThrow(/volve a elegir las fotos/i);
    await expect(analizarFotos(farm, frame, files, opts)).rejects.toThrow(/I\/O read operation failed/);
  }, 30000);

  it("el texto nombra las tres causas reales", () => {
    expect(QUE_HACER_SI_NO_ABRE).toMatch(/movio|renombro/);
    expect(QUE_HACER_SI_NO_ABRE).toMatch(/tarjeta/);
    expect(QUE_HACER_SI_NO_ABRE).toMatch(/memoria/);
    // Y aclara que las fotos no se perdieron, que es lo primero que uno piensa.
    expect(QUE_HACER_SI_NO_ABRE).toMatch(/siguen enteras en el disco/);
  });

  it("un archivo ilegible suelto NO voltea el vuelo", async () => {
    // Uno solo que no abre, entre otros que tampoco traen temperatura: no corta,
    // porque el corte es para cuando no abre NINGUNO.
    const buenos = Array.from({ length: 20 }, (_, i) =>
      new File([new Uint8Array(64)], `ok_${i}_T.JPG`, { type: "image/jpeg" }));
    const files = [ilegible("roto_T.JPG"), ...buenos];
    const r = await analizarFotos(farm, frame, files, opts);
    expect(r.problemas.some((p) => p.includes("roto_T.JPG"))).toBe(true);
    expect(r.fotosTermicas).toBe(0);
  }, 30000);
});
