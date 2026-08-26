/**
 * Con una coordenada de mala precision, explicar por que no encuentra nada.
 *
 * Sale de una tarde perdida en el campo: la app decia "no hay ninguna fila a
 * menos de 30 m" estando parado abajo del panel, y no habia forma de saber si
 * el problema era el parque, el bloque sin importar o el propio GPS.
 *
 * Con el error de la lectura mas grande que el radio de busqueda, no encontrar
 * nada estaba cantado. La app tiene que decir eso y NO mandar a revisar la
 * importacion, que seria el archivo equivocado.
 */
import { chromium } from "playwright";
const BASE="http://localhost:4173";
const b=await chromium.launch();
// Geolocalizacion falsa, lejos del parque y con precision de barrio.
const ctx=await b.newContext({permissions:["geolocation"],geolocation:{latitude:-27.9,longitude:152.9,accuracy:900}});
const p=await ctx.newPage();
p.on("pageerror",e=>{console.error("PAGEERROR:",e.message);process.exitCode=1;});
await p.goto(BASE,{waitUntil:"networkidle"});
await p.getByRole("button",{name:"Cargar el primero"}).click();
const x=await p.request.get(`${BASE}/ejemplo-picas.xlsx`);
await p.setInputFiles('input[type="file"]',{name:"e.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:Buffer.from(await x.body())});
await p.getByRole("heading",{name:/Que es cada columna/}).waitFor();
await p.getByRole("button",{name:"Siguiente"}).click();
await p.getByPlaceholder(/Edenvale/).fill("P");
await p.getByRole("button",{name:"Siguiente"}).click();
await p.getByRole("button",{name:"Guardar el parque"}).click();
await p.getByRole("heading",{name:"Parques"}).waitFor();
await p.locator(".farm-open").first().click();
await p.getByRole("button",{name:"Usar mi ubicacion"}).click();
await p.waitForTimeout(1200);
const t=await p.locator(".screen").innerText();
console.log("--- lo que ve el usuario ---");
console.log(t.split("\n").filter(l=>/±|precisa|WiFi|no dice nada|fila mas cercana|km/.test(l)).join("\n"));
// En minusculas: el CSS pone los titulos en mayusculas y no es lo que se prueba.
const plano=t.toLowerCase();
for(const req of ["sin gps","no es una medicion de satelite","ubicacion precisa","no dice nada sobre el parque"]){
  if(!plano.includes(req)){console.error(`ERROR: falta "${req}"`);process.exitCode=1;}
}
// Y lo que NO tiene que decir: con una lectura mala, la culpa no es del archivo.
for(const no of ["mal convertidas","falte importar"]){
  if(plano.includes(no)){console.error(`ERROR: culpa al parque cuando el problema es la lectura: "${no}"`);process.exitCode=1;}
}
await b.close(); console.log(process.exitCode?"\nFALLO":"\nOK");
