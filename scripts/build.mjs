import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const inputs=await Promise.all(['src/index.html','src/style.css','src/app.mjs','src/indicators.mjs','src/model.mjs','src/data.mjs','src/history.mjs','src/observation.mjs','src/presentation.mjs','src/snapshot.mjs','src/server.mjs','scripts/daily.py'].map(read));
const [html,css,app,indicators,model,data,history,observation,presentation,snapshot,server,updater]=inputs;
const iconNames=['apple-touch-icon.png','icon-192.png','icon-512.png','maskable-512.png'];
const [install,manifest,offline,worker,...icons]=await Promise.all([
  ...['src/install.mjs','src/manifest.webmanifest','src/offline.html','src/sw.mjs'].map(read),
  ...iconNames.map(name=>readFile(new URL('src/icons/'+name,root)))
]);
const revision=createHash('sha256').update(offline).update(worker).digest('hex').slice(0,16);
await mkdir(new URL('dist/server',root),{recursive:true});
await mkdir(new URL('dist/.openai',root),{recursive:true});
const stripped=source=>source.replace(/^import .*\n/gm,'').replace(/^export /gm,'');
const client=[indicators,model,presentation,app].map(stripped).join('\n');
const files={
  '/':[html,'text/html'],
  '/style.css':[css,'text/css'],
  '/app.js':[client,'text/javascript'],
  '/updater.py':[updater,'text/plain'],
  '/install.js':[install,'text/javascript'],
  '/manifest.webmanifest':[manifest,'application/manifest+json'],
  '/offline.html':[offline,'text/html'],
  '/sw.js':[worker.replace('__BUILD_REVISION__',revision),'text/javascript'],
  ...Object.fromEntries(iconNames.map((name,i)=>['/icons/'+name,[icons[i].toString('base64'),'image/png']]))
};
const handler=[
  'const files = '+JSON.stringify(files)+';',
  'export default { async fetch(request,env) {',
  'const path=new URL(request.url).pathname;',
  `if (Object.hasOwn(files,path) && request.method==='GET') {
    const [body,type]=files[path];
    const binary=type==='image/png';
    return new Response(binary?Uint8Array.from(atob(body),char=>char.charCodeAt(0)):body,{
      headers:{'Content-Type':binary?type:type+';charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'}
    });
  }`,
  'return api(request,env,files["/style.css"][0]);',
  '}};'
].join('\n');
await writeFile(new URL('dist/server/index.js',root),[indicators,model,data,history,observation,presentation,snapshot,server].map(stripped).concat(handler).join('\n'));
await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
