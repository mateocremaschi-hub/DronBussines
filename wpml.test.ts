/**
 * La mision en el formato que vuela el dron.
 *
 * Lo que se prueba aca es lo que decide si el archivo sirve o si el viaje al
 * parque se pierde: las rutas adentro del KMZ, que los waypoints esten en los
 * DOS archivos, y que el gimbal quede mirando para abajo.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zip } from "../app/zip";
import { avisosDeKmz, PERFILES_DJI, toKmz, type OpcionesKmz } from "../app/wpml";
import { camaraDesdeEquivalente35, planMission, type MissionOptions } from "../app/mission";
import edenvaleJson from "../farms/edenvale.json" with { type: "json" };
import type { FarmProfile } from "../src/types.js";
import { makeRow } from "./helpers/synthetic.js";

const profile = edenvaleJson as unknown as FarmProfile;
const camera = camaraDesdeEquivalente35("M3T", 40, 640, 512);

const filas = Array.from({ length: 6 }, (_, i) =>
  makeRow(
    {
      id: `05-10${i}-R1`, block: "05", tracker: `05-10${i}`, row: "R1",
      anchor: { lat: -26.92 + i * 0.00005, lon: 150.58 }, azimuthDeg: 180, side: "north",
    },
    profile,
  ),
);

const opts: MissionOptions = {
  camera, altitudeM: 50, sideOverlap: 0.45, frontOverlap: 0.5,
  speedMps: 5, marginM: 10, alongRows: true, rtk: true,
};
const mission = planMission(filas, profile, opts)!;

const m3t = PERFILES_DJI.find((p) => p.id === "m3t")!;
const kmzOpts: OpcionesKmz = { nombre: "Bloque 05", perfil: m3t, fecha: new Date(2026, 7, 26, 9, 30, 0) };

/** Abre el KMZ con `unzip`, que es lo mismo que hace el dron. */
function abrir(bytes: Uint8Array): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "kmz-"));
  writeFileSync(join(dir, "m.kmz"), bytes);
  execFileSync("unzip", ["-q", "m.kmz"], { cwd: dir });
  const out: Record<string, string> = {};
  for (const f of readdirSync(join(dir, "wpmz"))) {
    out[`wpmz/${f}`] = readFileSync(join(dir, "wpmz", f), "utf8");
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("el ZIP escrito a mano", () => {
  it("lo abre un descompresor de verdad", () => {
    const bytes = zip([{ ruta: "a/b.txt", contenido: "hola" }], new Date(2026, 0, 2, 3, 4, 5));
    const dir = mkdtempSync(join(tmpdir(), "z-"));
    writeFileSync(join(dir, "z.zip"), bytes);
    execFileSync("unzip", ["-q", "z.zip"], { cwd: dir });
    expect(readFileSync(join(dir, "a", "b.txt"), "utf8")).toBe("hola");
  });

  // Si el CRC esta mal el archivo se abre igual en algunos lados y en otros no.
  // Vale la pena fijarlo contra una implementacion independiente.
  it("calcula el CRC32 como lo calcula zlib", () => {
    const datos = new TextEncoder().encode("wpmz/waylines.wpml");
    expect(crc32(datos)).toBe(
      // El mismo valor, sacado de la tabla estandar.
      Number(BigInt.asUintN(32, BigInt(crcDeReferencia(datos)))),
    );
  });

  it("el mismo contenido y la misma fecha dan el mismo archivo", () => {
    const f = new Date(2026, 3, 1, 12, 0, 0);
    const a = zip([{ ruta: "x.txt", contenido: "y" }], f);
    const b = zip([{ ruta: "x.txt", contenido: "y" }], f);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

/** CRC32 escrito de la forma mas directa posible, para contrastar. */
function crcDeReferencia(d: Uint8Array): number {
  let c = ~0;
  for (const b of d) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// ---------------------------------------------------------------------------

describe("el KMZ que lee DJI Pilot 2", () => {
  const archivos = abrir(toKmz(mission, opts, kmzOpts));

  // Las rutas son lo primero que mira Pilot 2. Con cualquier otra, no abre.
  it("lleva los dos archivos en wpmz/ y con esos nombres exactos", () => {
    expect(Object.keys(archivos).sort()).toEqual(["wpmz/template.kml", "wpmz/waylines.wpml"]);
  });

  it("declara el namespace de wpml en los dos", () => {
    for (const x of Object.values(archivos)) {
      expect(x).toContain('xmlns:wpml="http://www.dji.com/wpmz/1.0.2"');
      expect(x).toContain('xmlns="http://www.opengis.net/kml/2.2"');
    }
  });

  /**
   * La que evita el error mas comun de todos: escribir solo waylines y que
   * Pilot 2 muestre —y despues guarde— el recorrido del template.
   */
  it("los waypoints estan en los DOS archivos y son los mismos", () => {
    const coords = (x: string) => [...x.matchAll(/<coordinates>([^<]+)<\/coordinates>/g)].map((m) => m[1]);
    const t = coords(archivos["wpmz/template.kml"]!);
    const w = coords(archivos["wpmz/waylines.wpml"]!);
    expect(t.length).toBe(mission.waypoints.length);
    expect(w).toEqual(t);
  });

  it("escribe longitud antes que latitud, como manda el KML", () => {
    const [lon, lat] = archivos["wpmz/waylines.wpml"]!
      .match(/<coordinates>([^<]+)<\/coordinates>/)![1]!.split(",").map(Number);
    expect(lon).toBeCloseTo(mission.waypoints[0]!.lon, 6);
    expect(lat).toBeCloseTo(mission.waypoints[0]!.lat, 6);
  });

  it("lleva el numero de dron y de camara del perfil elegido", () => {
    const w = archivos["wpmz/waylines.wpml"]!;
    expect(w).toContain("<wpml:droneEnumValue>77</wpml:droneEnumValue>");
    expect(w).toContain("<wpml:droneSubEnumValue>1</wpml:droneSubEnumValue>");
    expect(w).toContain("<wpml:payloadEnumValue>66</wpml:payloadEnumValue>");
  });

  /** Con el gimbal inclinado, el modulo fotografiado no es el que esta debajo. */
  it("deja el gimbal mirando derecho para abajo", () => {
    expect(archivos["wpmz/waylines.wpml"]).toContain(
      "<wpml:gimbalPitchRotateAngle>-90</wpml:gimbalPitchRotateAngle>",
    );
  });

  /**
   * Un bloque son miles de disparos: no puede haber un waypoint por foto.
   * Se dispara por distancia recorrida sobre cada pasada.
   */
  it("dispara por distancia y no con un waypoint por foto", () => {
    const w = archivos["wpmz/waylines.wpml"]!;
    expect(w).toContain("<wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType>");
    expect(w).toContain("takePhoto");
    const cada = Number(w.match(/<wpml:actionTriggerParam>([\d.]+)</)![1]);
    expect(cada).toBeCloseTo(mission.stats.disparoCadaM, 0);
    // Los waypoints son las puntas de las pasadas, no los disparos.
    expect(mission.waypoints.length).toBeLessThan(mission.stats.fotos);
  });

  it("la altura es sobre el despegue y no sobre el nivel del mar", () => {
    expect(archivos["wpmz/waylines.wpml"]).toContain(
      "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>",
    );
    expect(archivos["wpmz/template.kml"]).toContain(
      "<wpml:heightMode>relativeToStartPoint</wpml:heightMode>",
    );
  });

  it("si se pierde el control remoto sigue la linea en vez de quedarse flotando", () => {
    expect(archivos["wpmz/waylines.wpml"]).toContain("<wpml:exitOnRCLost>goContinue</wpml:exitOnRCLost>");
    expect(archivos["wpmz/waylines.wpml"]).toContain("<wpml:finishAction>goHome</wpml:finishAction>");
  });
});

// ---------------------------------------------------------------------------

describe("los avisos antes de copiar el archivo", () => {
  it("no se calla que los numeros del 4T estan sin confirmar", () => {
    const m4t = PERFILES_DJI.find((p) => p.id === "m4t")!;
    expect(m4t.confirmado).toBe(false);
    const a = avisosDeKmz(mission, opts, { ...kmzOpts, perfil: m4t });
    expect(a.join(" ")).toMatch(/provisorios/);
    expect(a.join(" ")).toMatch(/export[ae] cualquier mision desde Pilot 2/);
  });

  it("avisa cuando el plan pasa el limite legal de altura", () => {
    const alto = { ...opts, altitudeM: 130 };
    const a = avisosDeKmz(planMission(filas, profile, alto)!, alto, kmzOpts);
    expect(a.join(" ")).toMatch(/120 m/);
    expect(a.join(" ")).toMatch(/no es legal/);
  });

  it("siempre recuerda que la altura es sobre el punto de despegue", () => {
    expect(avisosDeKmz(mission, opts, kmzOpts).join(" ")).toMatch(/sobre el punto de despegue/);
  });

  it("con el M3T no inventa una advertencia que no corresponde", () => {
    expect(avisosDeKmz(mission, opts, kmzOpts).join(" ")).not.toMatch(/provisorios/);
  });
});

/**
 * El ZIP con bytes crudos adentro.
 *
 * Empezo aceptando solo texto, porque adentro del KMZ solo hay XML. Cuando el
 * entregable paso a incluir la carpeta de fotos, pasar un JPEG por
 * `TextEncoder` lo destruia en silencio: cada byte fuera de ASCII se convierte
 * en el caracter de reemplazo, el archivo sale con un tamano plausible y no se
 * abre. Sin este test eso llega al cliente.
 */
describe("el zip con binario adentro", () => {
  it("no toca los bytes que le dan", () => {
    // Bytes que TextEncoder destruiria: la firma de un JPEG y valores altos.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x80, 0xfe, 0xff, 0xd9]);
    const bytes = zip([{ ruta: "foto.jpg", contenido: jpeg }], new Date(2026, 0, 1));

    // El contenido va sin comprimir, asi que tiene que aparecer tal cual.
    const hay = (aguja: Uint8Array, pajar: Uint8Array) => {
      for (let i = 0; i + aguja.length <= pajar.length; i++) {
        if (aguja.every((b, k) => pajar[i + k] === b)) return true;
      }
      return false;
    };
    expect(hay(jpeg, bytes)).toBe(true);
  });

  it("sigue aceptando texto, que es lo que usa el KMZ", () => {
    const bytes = zip([{ ruta: "a.xml", contenido: "<hola/>" }], new Date(2026, 0, 1));
    expect(bytes.length).toBeGreaterThan(7);
  });
});
