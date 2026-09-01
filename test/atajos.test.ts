/**
 * El teclado de la revision.
 *
 * Se prueba aca afuera del navegador porque lo que importa no es que un
 * `keydown` llegue: es que la MISMA tecla haga siempre lo mismo, y que adentro
 * de un campo de texto no haga nada. Escribir "no se ve bien" en la nota, con
 * los atajos vivos, descarta el hallazgo con la x, le pone clase 3 con el 3 y
 * salta cuatro veces con las flechas — y el que revisa no se entera hasta que
 * entrega el informe.
 */

import { describe, expect, it } from "vitest";
import { accionDeTecla, escribiendo, ANOMALIAS_RAPIDAS, AYUDA } from "../app/atajos";
import { ANOMALIAS } from "../app/inspection";

describe("los atajos de la revision", () => {
  it("mueve con las flechas y con j/k", () => {
    expect(accionDeTecla({ key: "ArrowDown" })).toEqual({ tipo: "mover", delta: 1 });
    expect(accionDeTecla({ key: "ArrowUp" })).toEqual({ tipo: "mover", delta: -1 });
    expect(accionDeTecla({ key: "j" })).toEqual({ tipo: "mover", delta: 1 });
    expect(accionDeTecla({ key: "K" })).toEqual({ tipo: "mover", delta: -1 });
  });

  it("confirma con Enter y descarta con x", () => {
    expect(accionDeTecla({ key: "Enter" })).toEqual({ tipo: "confirmar" });
    expect(accionDeTecla({ key: "x" })).toEqual({ tipo: "descartar" });
    expect(accionDeTecla({ key: "Delete" })).toEqual({ tipo: "descartar" });
  });

  it("los numeros son la clase IEC", () => {
    expect(accionDeTecla({ key: "2" })).toEqual({ tipo: "clase", klass: 2 });
    // No hay clase 4: la norma tiene tres.
    expect(accionDeTecla({ key: "4" })).toBeNull();
  });

  it("las letras rapidas ponen una anomalia", () => {
    expect(accionDeTecla({ key: "q" })).toEqual({ tipo: "anomalia", nombre: "Punto caliente" });
    expect(accionDeTecla({ key: "W" })).toEqual({ tipo: "anomalia", nombre: "Diodo de bypass" });
  });

  /*
    Las cuatro anomalias con tecla propia tienen que EXISTIR en la lista.

    Si se le cambia el nombre a una en `inspection.ts` y aca queda el viejo, la
    tecla escribe una anomalia que ningun selector muestra y ningun informe
    agrupa: el hallazgo sale clasificado con un nombre huerfano.
  */
  it("cada tecla rapida nombra una anomalia de la lista", () => {
    for (const a of ANOMALIAS_RAPIDAS) {
      expect(ANOMALIAS as readonly string[]).toContain(a.nombre);
    }
  });

  it("adentro de un campo de texto solo vive Escape", () => {
    const input = { tagName: "INPUT" };
    expect(accionDeTecla({ key: "x", target: input })).toBeNull();
    expect(accionDeTecla({ key: "3", target: input })).toBeNull();
    expect(accionDeTecla({ key: "ArrowDown", target: input })).toBeNull();
    expect(accionDeTecla({ key: "Escape", target: input })).toEqual({ tipo: "salir" });
  });

  it("no le roba los atajos al navegador", () => {
    expect(accionDeTecla({ key: "x", metaKey: true })).toBeNull();
    expect(accionDeTecla({ key: "1", ctrlKey: true })).toBeNull();
  });

  it("reconoce donde se esta escribiendo", () => {
    expect(escribiendo({ tagName: "INPUT" })).toBe(true);
    expect(escribiendo({ tagName: "SELECT" })).toBe(true);
    expect(escribiendo({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(escribiendo({ tagName: "DIV" })).toBe(false);
    expect(escribiendo(null)).toBe(false);
  });

  /*
    La ayuda que se ve en pantalla sale de la misma tabla que actua. Que este
    prueba solo cuenta: lo que la protege de mentir es que no haya una segunda
    lista escrita a mano en el componente.
  */
  it("la ayuda cubre todas las anomalias rapidas", () => {
    for (const a of ANOMALIAS_RAPIDAS) {
      expect(AYUDA.some((h) => h.teclas === a.tecla.toUpperCase())).toBe(true);
    }
  });
});
