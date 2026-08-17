/*
 * scripts/look-game.mjs — take a screenshot of the running game.
 *
 * STILL NEEDS PERMISSION (CLAUDE.md §0), but it is the safe one: it contains **no
 * `page.mouse.move` calls at all**. The only cursor movement is the single trusted
 * click that earns pointer lock, and everything after that is keyboard.
 *
 * That restriction is the whole design. `/hymn` takes pointer lock, so scripted mouse
 * moves are delivered as raw pointer input and take over the machine's real cursor —
 * the other harnesses sweep the camera and are genuinely disruptive to run. This one
 * looks straight ahead and walks with W, which is enough to answer "is the geometry
 * there", which is what it exists for.
 *
 *   node scripts/look-game.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import puppeteer from "puppeteer-core";
const ROOT = resolve("build");
const M={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".gltf":"model/gltf+json",".bin":"application/octet-stream"};
const server = createServer(async (q,r)=>{let p=decodeURIComponent(new URL(q.url,"http://x").pathname);if(p.endsWith("/"))p+="index.html";try{const b=await readFile(join(ROOT,normalize(p)));r.writeHead(200,{"content-type":M[extname(p)]??"application/octet-stream"});r.end(b);}catch{r.writeHead(404).end("nf");}});
await new Promise(r=>server.listen(4222,r));
const br=await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"]});
const pg=await br.newPage(); await pg.setViewport({width:1600,height:900});
pg.on("pageerror",e=>console.log("PAGEERROR:",e.message.split("\n")[0]));
await pg.goto("http://localhost:4222/hymn/",{waitUntil:"networkidle0"});
await pg.waitForFunction(()=>{const b=document.querySelector(".gh-play");return b&&!b.disabled;},{timeout:60000});
await pg.click(".gh-play");
await new Promise(r=>setTimeout(r,3500));
await pg.screenshot({path:"build/look-a.png"});
// Walk east with the keyboard only — no mouse.
await pg.keyboard.down("KeyW"); await new Promise(r=>setTimeout(r,2200)); await pg.keyboard.up("KeyW");
await new Promise(r=>setTimeout(r,1200));
await pg.screenshot({path:"build/look-b.png"});
console.log("state:", JSON.stringify(await pg.evaluate(()=>window.__gallowsHymn)));
await br.close(); server.close();
