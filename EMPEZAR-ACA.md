# Qué hago con esto

Esto **no es una app todavía**. Es el motor que va adentro de la app: la parte
que convierte una coordenada en "bloque 5, tracker 05-042, fila R1, string 2,
módulo 1". No tiene pantalla ni botones. Eso llega en la Etapa 4.

Por ahora lo único que hay que hacer con esto es **guardarlo en un repo de
GitHub**. No hace falta que instales Node ni que corras nada en tu máquina.

---

## Paso a paso (15 minutos, todo desde el navegador)

**1. Creá el repo**

Andá a [github.com/new](https://github.com/new). Nombre sugerido: `pica-locator`.
Ponelo **privado** — esto es tu negocio, no de GRS. No marques ninguna de las
opciones de "Initialize this repository with…".

**2. Subí los archivos**

En la pantalla que aparece, clic en **"uploading an existing file"**.
Arrastrá **el contenido de la carpeta `pica`** (no la carpeta en sí — los
archivos y carpetas que están adentro).

Ojo con dos cosas que GitHub esconde por defecto en Finder:

- La carpeta `.github` tiene que subir sí o sí: es la que hace correr los tests
  solos. En Finder, `Cmd + Shift + .` muestra los archivos ocultos.
- **No subas** `node_modules` ni `dist` si llegaran a aparecer. El `.gitignore`
  ya los excluye, pero en la subida por navegador conviene revisarlo.

Escribí un mensaje de commit ("primera versión del motor") y dale a
**Commit changes**.

**3. Mirá los tests correr solos**

Andá a la pestaña **Actions** del repo. Vas a ver un job corriendo. En un minuto
te queda una tilde verde: son los 86 tests, el chequeo de tipos y la compilación.

A partir de ahí, **cada vez que cambies un archivo desde el navegador de GitHub,
los tests vuelven a correr solos**. Es el mismo flujo que ya usás con Netlify,
pero en vez de desplegar un sitio te dice si rompiste algo.

---

## Lo único que te conviene hacer ahora

Completar los tres fixtures de campo que quedaron esperando coordenadas. Están
en `fixtures/edenvale/` y ya tienen cargado **qué esperás** (lo que contaste
físicamente); les falta **dónde**.

Por cada uno necesitás dos cosas del Excel de picas:

- Las coordenadas de las dos picas de esa fila → van en `row.start` y `row.end`.
- La coordenada del punto donde te paraste → va en `fix`.

Si la coordenada la sacaste de Google Maps en grados-minutos-segundos, **no la
conviertas a mano**. Poné, en lugar del bloque `fix`:

```json
"fixText": "27°30'15.6\"S 152°45'10.2\"E"
```

Después cambiá `"status": "pending"` por `"status": "verified"` y guardá. Los
tests corren solos y te dicen si el motor coincide con lo que contaste.

Todo eso se puede hacer editando el archivo directo en GitHub, con el lapicito.
No hace falta descargar nada.

---

## Si preferís no tocar nada todavía

Guardá el zip y listo. El motor está terminado y testeado; no se va a pudrir.
Cuando llegue el momento de la app de campo (Etapa 4) lo vamos a usar tal cual
está, y ahí sí vas a tener algo con pantalla que se puede probar caminando por
el parque.

---

## Los dos archivos que te mandé

| Archivo | Qué es |
|---|---|
| `pica-locator-e1.zip` | El repo completo. Es lo que subís a GitHub. |
| `README.md` | La documentación técnica del motor: cómo funciona por dentro, qué hace cada estrategia, cómo se usa desde código. Para leer, no para hacer nada con él. Ya viene adentro del zip. |
