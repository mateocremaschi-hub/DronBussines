import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La app importa el motor por el alias `@locator`, nunca por rutas relativas.
// Es la misma regla estructural del paquete: la app depende del motor, el motor
// no sabe que la app existe.
export default defineConfig({
  plugins: [react()],
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
