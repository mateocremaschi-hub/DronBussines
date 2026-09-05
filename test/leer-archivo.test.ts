/**
 * Safari falla al leer archivos elegidos con el dialogo cuando son muchos:
 * "The I/O read operation failed", pasajero y al azar. En el bloque 2 se
 * cayeron 429 de 567 fotos asi. La lectura insiste, y si al final no puede,
 * dice el error de verdad.
 */
import { describe, expect, it } from "vitest";
import { leerArchivo } from "../app/photos";

const conFallos = (fallos: number) => {
  const f = new File([new Uint8Array([1, 2, 3])], "DJI_0001_T.JPG", { type: "image/jpeg" });
  let quedan = fallos;
  const original = f.arrayBuffer.bind(f);
  Object.defineProperty(f, "arrayBuffer", {
    value: async () => {
      if (quedan-- > 0) throw new Error("The I/O read operation failed.");
      return original();
    },
  });
  return f;
};

describe("leer un archivo insistiendo", () => {
  it("un fallo pasajero no pierde la foto", async () => {
    const buf = await leerArchivo(conFallos(2));
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("si nunca se puede leer, lo dice con el error original", async () => {
    await expect(leerArchivo(conFallos(99), 3)).rejects.toThrow(/I\/O read/);
  });
});
