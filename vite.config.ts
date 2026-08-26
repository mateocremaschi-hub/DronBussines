import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * El service worker que hace que la app funcione sin internet.
 *
 * Esto no es un extra: es la premisa. La app se usa parado en una fila de
 * paneles en el medio del campo, donde no hay señal — y sin service worker el
 * navegador no tiene de donde levantar el HTML ni el JavaScript, asi que no
 * abre. Los datos ya vivian offline en IndexedDB; lo que faltaba era la app.
 *
 * Se genera aca, en el build, y no a mano, porque Vite le pone un hash al
 * nombre de cada archivo. Una lista escrita a mano queda vieja en el primer
 * deploy y el resultado seria peor que no tener nada: una app que dice estar
 * lista para el campo y en el campo abre en blanco.
 *
 * No se usa una libreria de PWA por lo mismo que el resto del proyecto: son
 * cuarenta lineas, se entienden enteras, y la estrategia de cache es una
 * decision del producto y no un preset.
 */
function serviceWorker(): Plugin {
  return {
    name: "pica-sw",
    apply: "build",
    generateBundle(_opts, bundle) {
      // Los sourcemaps no: pesan mas que la app entera y no sirven en el campo.
      const assets = Object.keys(bundle)
        .filter((f) => !f.endsWith(".map"))
        .map((f) => `/${f}`);
      const precache = ["/", "/index.html", "/manifest.webmanifest", ...assets];

      // El nombre del cache cambia con el contenido, asi que un deploy nuevo
      // entra solo y el viejo se borra en el activate.
      const version = assets.join("|").length.toString(36) + "-" + assets.length;

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: swSource(precache, version),
      });
    },
  };
}

function swSource(precache: string[], version: string): string {
  return `/* Generado en el build. No editar a mano. */
const CACHE = "pica-${version}";
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener("install", (e) => {
  // addAll falla entero si un solo archivo falla, y entonces no queda nada
  // cacheado. De a uno, lo que se pueda bajar queda.
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "estado") {
    e.source && e.source.postMessage({ listo: true, version: CACHE });
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Navegar: primero el cache y despues la red. Al reves, parado en el campo
  // sin señal habria que esperar a que el fetch falle por timeout antes de
  // mostrar nada — y a veces no falla, se queda colgado.
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("/index.html").then((hit) => {
        const red = fetch(req)
          .then((r) => { caches.open(CACHE).then((c) => c.put("/index.html", r.clone())); return r; })
          .catch(() => hit);
        return hit || red;
      })
    );
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // Las tipografias de Google y cualquier otra cosa de afuera: si no hay
    // red, que falle sin romper la app. El CSS ya declara alternativas.
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((r) => {
        if (r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone()));
        return r;
      })
    )
  );
});
`;
}

// La app importa el motor por el alias `@locator`, nunca por rutas relativas.
// Es la misma regla estructural del paquete: la app depende del motor, el motor
// no sabe que la app existe.
export default defineConfig({
  plugins: [react(), serviceWorker()],
  resolve: {
    alias: {
      "@locator": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  build: {
    // `dist` lo usa el compilador del paquete; la app sale aparte.
    outDir: "dist-app",
    sourcemap: true,
  },
});
