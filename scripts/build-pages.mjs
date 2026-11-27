// 建置 GitHub Pages 版：輸出 dist/pages/，所有路徑改為相對路徑，模組原樣以 ES module 提供。
// 用法：node scripts/build-pages.mjs [OUTPUT]
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root=new URL('../',import.meta.url).pathname;
const out=process.argv[2]??join(root,'dist/pages');
const src=join(root,'src');
const read=name=>readFile(join(src,name),'utf8');
await rm(out,{recursive:true,force:true});
await mkdir(join(out,'icons'),{recursive:true});
await cp(join(src,'icons'),join(out,'icons'),{recursive:true});

const relative=text=>text.replace(/(["'])\/(?=[a-z])/g,'$1./');
const modules=(await readdir(src)).filter(name=>name.endsWith('.mjs')&&!['sw.mjs','install.mjs'].includes(name));
for(const name of modules){
  const code=(await read(name)).replace(/(['"])\.\/([\w-]+)\.mjs\1/g,'$1./$2.js$1');
  await writeFile(join(out,name.replace(/\.mjs$/,'.js')),code);
}
const html=relative(await read('index.html')).replace('src="./app.js"','src="./pages.js"');
if(!html.includes('src="./pages.js"'))throw new Error('index.html entry script not found');
const offline=relative(await read('offline.html'));
const worker=(await read('sw.mjs'))
  .replace("const OFFLINE_PATH='/offline.html';","const OFFLINE_PATH=new URL('./offline.html',self.location).href;\nconst ROOT_PATH=new URL('./',self.location).pathname;")
  .replace("url.pathname!=='/'","url.pathname!==ROOT_PATH");
if(!worker.includes('ROOT_PATH'))throw new Error('sw.mjs paths not rewritten');
const revision=createHash('sha256').update(offline).update(worker).update(String(Date.now())).digest('hex').slice(0,16);
const manifest=JSON.parse(await read('manifest.webmanifest'));
Object.assign(manifest,{id:'./',start_url:'./#screen',scope:'./',
  icons:manifest.icons.map(icon=>({...icon,src:'.'+icon.src}))});
await Promise.all([
  writeFile(join(out,'index.html'),html),
  writeFile(join(out,'offline.html'),offline),
  writeFile(join(out,'404.html'),offline),
  writeFile(join(out,'style.css'),await read('style.css')),
  writeFile(join(out,'install.js'),(await read('install.mjs')).replace("register('/sw.js')","register('./sw.js')")),
  writeFile(join(out,'sw.js'),worker.replace('__BUILD_REVISION__',revision)),
  writeFile(join(out,'manifest.webmanifest'),JSON.stringify(manifest,null,2)),
  writeFile(join(out,'.nojekyll'),'')
]);
console.log('Pages build:',out);
