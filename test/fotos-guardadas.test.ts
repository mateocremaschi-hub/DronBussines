/**
 * Las fotos de los hallazgos, guardadas con el vuelo.
 *
 * Mateo apreto "Report" al dia siguiente y le abrio el Finder pidiendole la
 * carpeta, despues de haber esperado diez minutos a que se midieran 568
 * termicas. El vuelo entero no se puede guardar —son miles de JPEG— pero el
 * entregable son decenas, y esas son justo las que hacen falta para bajar el
 * informe, armar el ZIP y ver la termica en la revision.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  Un idb-keyval de mentira, en memoria. Lo que se prueba es que se guarde lo
  que corresponde y nada mas, no que IndexedDB funcione.
*/
const almacen = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => almacen.get(k),
  set: async (k: string, v: unknown) => { almacen.set(k, v); },
  del: async (k: string) => { almacen.delete(k); },
  keys: async () => [...almacen.keys()],
}));

const { borrarFotos, guardarFotos, leerFotos, limpiarHuerfanas, TOPE_FOTOS } =
  await import("../app/fotosGuardadas");

/** Un archivo de `kb` kilobytes con ese nombre. */
const foto = (nombre: string, kb = 1) =>
  new File([new Uint8Array(kb * 1024)], nombre, { type: "image/jpeg" });

beforeEach(() => almacen.clear());

describe("guardar las fotos de los hallazgos", () => {
  const vuelo = [foto("DJI_0001_T.JPG"), foto("DJI_0002_T.JPG"), foto("DJI_0003_T.JPG")];

  it("guarda solo las de los hallazgos, no el vuelo entero", async () => {
    const r = await guardarFotos("v1", vuelo, new Set(["DJI_0002_T.JPG"]));
    expect(r).toEqual({ guardadas: 1, pedidas: 1 });
    const leidas = await leerFotos("v1");
    expect(leidas.map((f) => f.name)).toEqual(["DJI_0002_T.JPG"]);
  });

  it("las vuelve a dar como File, con nombre y tipo", async () => {
    await guardarFotos("v1", vuelo, new Set(["DJI_0001_T.JPG"]));
    const [f] = await leerFotos("v1");
    expect(f).toBeInstanceOf(File);
    expect(f!.type).toBe("image/jpeg");
    expect(f!.size).toBe(1024);
  });

  it("un hallazgo cuya foto no esta a mano no rompe nada", async () => {
    const r = await guardarFotos("v1", vuelo, new Set(["DJI_0002_T.JPG", "NO_ESTA.JPG"]));
    expect(r.guardadas).toBe(1);
    expect(r.pedidas).toBe(1);
  });

  it("un vuelo sin hallazgos no deja nada ocupando lugar", async () => {
    await guardarFotos("v1", vuelo, new Set(["DJI_0001_T.JPG"]));
    await guardarFotos("v1", vuelo, new Set());
    expect(await leerFotos("v1")).toEqual([]);
  });

  /*
    El tope existe porque IndexedDB es la misma despensa donde vive el parque,
    que es lo unico que TIENE que sobrevivir offline en el campo. Y se dice
    cuantas entraron: un entregable al que le faltan fotos y no avisa es peor
    que uno que las pide.
  */
  it("con un vuelo enorme guarda hasta el tope y lo dice", async () => {
    const muchas = Array.from({ length: TOPE_FOTOS + 20 }, (_, i) => foto(`DJI_${i}_T.JPG`));
    const r = await guardarFotos("v1", muchas, new Set(muchas.map((f) => f.name)));
    expect(r.guardadas).toBe(TOPE_FOTOS);
    expect(r.pedidas).toBe(TOPE_FOTOS + 20);
  });

  it("no pasa del tope de bytes aunque sean pocas fotos", async () => {
    const pesadas = Array.from({ length: 6 }, (_, i) => foto(`P_${i}.JPG`, 50 * 1024));
    const r = await guardarFotos("v1", pesadas, new Set(pesadas.map((f) => f.name)));
    expect(r.guardadas).toBeLessThan(6);
    expect(r.guardadas).toBeGreaterThan(0);
  });

  it("un vuelo del que nunca se guardo nada devuelve una lista vacia", async () => {
    expect(await leerFotos("nunca")).toEqual([]);
  });
});

describe("no dejar fotos de vuelos que ya no existen", () => {
  it("borra las del vuelo borrado y deja las de los vivos", async () => {
    await guardarFotos("v1", [foto("a.JPG")], new Set(["a.JPG"]));
    await guardarFotos("v2", [foto("b.JPG")], new Set(["b.JPG"]));
    expect(await limpiarHuerfanas(new Set(["v2"]))).toBe(1);
    expect(await leerFotos("v1")).toEqual([]);
    expect((await leerFotos("v2")).length).toBe(1);
  });

  it("no toca las claves de otras cosas", async () => {
    almacen.set("farm:parque", { rows: [] });
    await guardarFotos("v1", [foto("a.JPG")], new Set(["a.JPG"]));
    await limpiarHuerfanas(new Set());
    expect(almacen.has("farm:parque")).toBe(true);
  });

  it("borrar un vuelo se lleva sus fotos", async () => {
    await guardarFotos("v1", [foto("a.JPG")], new Set(["a.JPG"]));
    await borrarFotos("v1");
    expect(await leerFotos("v1")).toEqual([]);
  });
});
