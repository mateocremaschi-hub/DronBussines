/**
 * Pasar un parque de un dispositivo a otro.
 *
 * Los parques viven en el IndexedDB del navegador y no se suben a ningun lado.
 * Eso es a proposito —la app tiene que funcionar sin señal en el campo— pero
 * significa que cargar el parque en la compu no lo pone en el celular, y eso
 * sorprende. Exportar e importar es el unico puente, asi que tiene que llevar
 * TODO: filas, strings, parametros y conteos.
 *
 * Exportar en un dispositivo e importar en otro: el parque tiene que llegar entero. */
import { chromium } from "playwright";
const BASE="http://localhost:4173";
const b=await chromium.launch();

// "La compu": carga el parque y lo exporta.
const compu=await b.newContext(); const p1=await compu.newPage();
p1.on("pageerror",e=>{console.error("PAGEERROR:",e.message);process.exitCode=1;});
await p1.goto(BASE,{waitUntil:"networkidle"});
await p1.getByRole("button",{name:"Cargar el primero"}).click();
const x=await p1.request.get(`${BASE}/ejemplo-picas.xlsx`);
await p1.setInputFiles('input[type="file"]',{name:"e.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(await x.body())});
await p1.getByRole("heading",{name:/Que es cada columna/}).waitFor();
// El ejemplo viene en UTM y la zona ya no se hereda: hay que decirla.
await p1.getByLabel("Zona").fill("56");
await p1.getByRole("button",{name:"Siguiente"}).click();
await p1.getByPlaceholder(/Edenvale/).fill("Parque de prueba");
await p1.getByRole("button",{name:"Siguiente"}).click();
await p1.getByRole("button",{name:"Guardar el parque"}).click();
await p1.getByRole("heading",{name:"Parques"}).waitFor();
const antes=(await p1.locator(".farm-open").first().innerText()).replace(/\n/g," · ");
const [dl]=await Promise.all([p1.waitForEvent("download"), p1.getByRole("button",{name:"Exportar"}).first().click()]);
const ruta=`/tmp/${dl.suggestedFilename()}`; await dl.saveAs(ruta);
const bytes=(await (await import("node:fs")).promises.readFile(ruta));
console.log("Exportado:",dl.suggestedFilename(),`${(bytes.length/1024).toFixed(0)} kB`);
if(dl.suggestedFilename().split(".").length>2){console.error("ERROR: nombre con dos extensiones");process.exitCode=1;}

// "El celular": otro almacenamiento, arranca vacio.
const celu=await b.newContext(); const p2=await celu.newPage();
p2.on("pageerror",e=>{console.error("PAGEERROR:",e.message);process.exitCode=1;});
await p2.goto(BASE,{waitUntil:"networkidle"});
const vacio=await p2.getByRole("heading",{name:/Todavia no hay ningun parque/}).count();
console.log("El otro dispositivo arranca vacio:",vacio?"si":"NO");
if(!vacio){console.error("ERROR: no arranco vacio");process.exitCode=1;}

// Un archivo cualquiera no puede romper nada.
await p2.locator('.import input[type="file"]').setInputFiles({name:"cualquiera.json",mimeType:"application/json",buffer:Buffer.from("{\"a\":1}")});
await p2.waitForTimeout(300);
console.log("Con un archivo equivocado:",(await p2.locator(".alert").innerText()).slice(0,70));

await p2.locator('.import input[type="file"]').setInputFiles(ruta);
await p2.getByRole("heading",{name:"Parques"}).waitFor();
await p2.waitForTimeout(400);
const despues=(await p2.locator(".farm-open").first().innerText()).replace(/\n/g," · ");
console.log("En la compu :",antes);
console.log("En el celu  :",despues);
if(antes!==despues){console.error("ERROR: el parque no llego igual");process.exitCode=1;}
await b.close(); console.log(process.exitCode?"FALLO":"OK");
