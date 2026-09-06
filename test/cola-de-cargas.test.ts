/**
 * Dos carpetas cargadas una atras de la otra.
 *
 * Le paso a Mateo con el vuelo de verdad: eligio el bloque 1, y mientras
 * todavia estaba midiendo eligio el bloque 2. El contador decia "1021 archivos
 * cargados" y el resultado era el del bloque 1 solo — sin ningun error a la
 * vista. Peor: al volver a elegir el bloque 2 la app le contestaba "esas fotos
 * ya estaban cargadas" y no hacia nada, asi que no habia forma de arreglarlo
 * sin vaciar todo.
 *
 * Son dos bugs y los dos se prueban aca sobre el mismo modelo que usa la
 * pantalla: la fusion parte del resultado que hay CUANDO LE TOCA a cada tanda,
 * y lo que decide si una foto se vuelve a leer es si esta medida, no si esta
 * elegida.
 */
import { describe, expect, it } from "vitest";

/*
  El modelo de la pantalla, sin React: una cola que corre de a una tanda, un
  "ultimo resultado" que cada tanda lee cuando arranca, y el conjunto de fotos
  que ya entraron al resultado.
*/
function pantalla(medir: (files: string[]) => Promise<string[]>) {
  let cola: Promise<void> = Promise.resolve();
  let ultimo: string[] | null = null;
  const medidas = new Set<string>();
  const enCola = new Set<string>();
  const elegidas: string[] = [];

  const encolar = (files: string[]) => {
    for (const f of files) enCola.add(f);
    cola = cola.catch(() => {}).then(async () => {
      const r = await medir(files);
      ultimo = [...(ultimo ?? []), ...r];
      for (const f of files) { medidas.add(f); enCola.delete(f); }
    });
    return cola;
  };

  return {
    elegir(nuevas: string[]) {
      const frescas = nuevas.filter((n) => !medidas.has(n) && !enCola.has(n));
      for (const n of nuevas) if (!elegidas.includes(n)) elegidas.push(n);
      return frescas.length ? encolar(frescas) : Promise.resolve();
    },
    get resultado() { return ultimo; },
    get medidas() { return medidas; },
    get elegidas() { return elegidas; },
    esperar: () => cola,
  };
}

const tarda = (ms: number) => (files: string[]) =>
  new Promise<string[]>((r) => setTimeout(() => r(files.map((f) => `m:${f}`)), ms));

describe("cargar dos carpetas", () => {
  const b1 = ["b1-a", "b1-b"];
  const b2 = ["b2-a", "b2-b"];

  it("la segunda no pisa a la primera aunque se elija mientras mide", async () => {
    // El bloque 1 tarda MAS que el bloque 2: es el orden que rompia todo,
    // porque el que terminaba ultimo escribia el resultado entero.
    let n = 0;
    const p = pantalla((f) => tarda(n++ === 0 ? 40 : 5)(f));
    void p.elegir(b1);
    void p.elegir(b2);
    await p.esperar();
    expect(p.resultado).toEqual(["m:b1-a", "m:b1-b", "m:b2-a", "m:b2-b"]);
  });

  it("las tandas se miden de a una, no en paralelo", async () => {
    let ala = 0, pico = 0;
    const p = pantalla(async (f) => {
      pico = Math.max(pico, ++ala);
      await new Promise((r) => setTimeout(r, 10));
      ala--;
      return f;
    });
    void p.elegir(b1); void p.elegir(b2);
    await p.esperar();
    expect(pico).toBe(1);
  });

  it("elegir dos veces la misma carpeta no la mide dos veces", async () => {
    const p = pantalla(tarda(1));
    await p.elegir(b1);
    await p.elegir(b1);
    expect(p.resultado).toEqual(["m:b1-a", "m:b1-b"]);
  });

  it("volver a elegir la carpeta que se perdio la mide", async () => {
    const p = pantalla(tarda(1));
    await p.elegir(b1);
    // El estado roto: elegida pero nunca medida.
    p.elegidas.push(...b2);
    expect(p.elegidas.length).toBeGreaterThan(p.medidas.size);
    await p.elegir(b2);
    expect(p.resultado).toContain("m:b2-a");
    expect(p.medidas.size).toBe(4);
  });

  it("una tanda que falla no deja la cola trabada", async () => {
    let primera = true;
    const p = pantalla(async (f) => {
      if (primera) { primera = false; throw new Error("The I/O read operation failed"); }
      return f;
    });
    void p.elegir(b1);
    void p.elegir(b2);
    await p.esperar();
    expect(p.resultado).toEqual(["b2-a", "b2-b"]);
  });
});
