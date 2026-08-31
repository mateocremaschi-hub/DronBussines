/**
 * Avisar cuando entro una version nueva.
 *
 * El service worker toma el control apenas se instala, pero el JavaScript de
 * la pestaña abierta sigue siendo el viejo hasta que se recargue. Sin avisar,
 * despues de cada deploy la pantalla dice "lista para el campo" mientras corre
 * codigo de antes: uno cambia algo, recarga, ve lo mismo, y termina dudando
 * del cambio en vez de dudar del cache.
 *
 * La señal es `controllerchange`, y significa dos cosas distintas segun si
 * habia un controlador antes. Esa es toda la diferencia y es la que se prueba.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { registrarOffline, type Offline } from "../app/offline";

/** Un service worker de mentira, con control sobre si ya habia controlador. */
function montar(conControladorPrevio: boolean) {
  const oyentes: Record<string, Array<() => void>> = {};
  const sw = {
    controller: conControladorPrevio ? {} : null,
    addEventListener: (t: string, f: () => void) => { (oyentes[t] ??= []).push(f); },
    removeEventListener: () => {},
    register: () => Promise.resolve({ active: {} }),
  };
  vi.stubGlobal("navigator", { serviceWorker: sw, onLine: true });
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  return { disparar: () => oyentes["controllerchange"]?.forEach((f) => f()) };
}

describe("cuando entra una version nueva", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("la primera instalacion dice que quedo lista, no que hay que recargar", () => {
    const { disparar } = montar(false);
    const vistos: Offline[] = [];
    registrarOffline((o) => vistos.push(o));
    disparar();
    expect(vistos[vistos.length - 1]!.estado).toBe("listo");
  });

  it("una version nueva sobre una app ya instalada pide recargar", () => {
    const { disparar } = montar(true);
    const vistos: Offline[] = [];
    registrarOffline((o) => vistos.push(o));
    expect(vistos[0]!.estado).toBe("listo");   // ya andaba
    disparar();
    const ultimo = vistos[vistos.length - 1]!;
    expect(ultimo.estado).toBe("actualizada");
    expect(ultimo.detalle).toMatch(/recarg/i);
  });

  // El registro resuelve DESPUES del controllerchange y volvia a decir "listo".
  it("el registro no pisa el aviso de version nueva", async () => {
    const { disparar } = montar(true);
    const vistos: Offline[] = [];
    registrarOffline((o) => vistos.push(o));
    disparar();
    await Promise.resolve();
    await Promise.resolve();
    expect(vistos[vistos.length - 1]!.estado).toBe("actualizada");
  });
});
