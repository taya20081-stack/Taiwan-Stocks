import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source=path=>new URL('../src/'+path,import.meta.url);

test('the installation manifest includes accessible launch and home-screen icons',async()=>{
  const manifest=JSON.parse(await readFile(source('manifest.webmanifest'),'utf8'));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/#screen');
  for(const [size,purpose] of [[192,'any'],[512,'any'],[512,'maskable']]){
    const icon=manifest.icons.find(entry=>entry.sizes===size+'x'+size&&entry.purpose===purpose);
    assert.ok(icon);
    const png=await readFile(source(icon.src.slice(1)));
    assert.equal(png.readUInt32BE(16),size);
    assert.equal(png.readUInt32BE(20),size);
  }
  const html=await readFile(source('index.html'),'utf8');
  assert.match(html,/<link rel="manifest" href="\/manifest.webmanifest" crossorigin="use-credentials">/);
  const apple=await readFile(source('icons/apple-touch-icon.png'));
  assert.equal(apple.readUInt32BE(16),180);
  assert.equal(apple.readUInt32BE(20),180);
});

test('the service worker keeps the offline message separate from signed-in pages and APIs',async()=>{
  const offlinePage='目前離線';
  const archive=new Map([['unrelated-service',new Map()],['taiwan-equity-lab-offline-old',new Map()]]);
  const listeners={};
  let fetchPage=async path=>{
    assert.equal(path,'/offline.html');
    return new Response(offlinePage,{headers:{'Content-Type':'text/html'}});
  };
  runInNewContext(await readFile(source('sw.mjs'),'utf8'),{
    self:{location:{origin:'https://research.test'},addEventListener:(name,listener)=>{listeners[name]=listener;},clients:{claim:async()=>{}}},
    URL,Response,fetch:(...args)=>fetchPage(...args),
    caches:{keys:async()=>[...archive.keys()],delete:async key=>archive.delete(key),open:async key=>{
      if(!archive.has(key))archive.set(key,new Map());
      const items=archive.get(key);
      return {put:async (path,response)=>items.set(path,response),match:async path=>items.get(path)};
    }}
  });
  for(const event of ['install','activate']){
    let completion;
    listeners[event]({waitUntil:work=>{completion=work;}});
    await completion;
  }
  assert.deepEqual([...archive.keys()],['unrelated-service','taiwan-equity-lab-offline-__BUILD_REVISION__']);
  const stored=[...archive.values()].flatMap(cache=>[...cache.keys()]);
  assert.deepEqual(stored,['/offline.html']);

  function request(path,mode='navigate',method='GET'){
    let result;
    listeners.fetch({request:{url:'https://research.test'+path,method,mode},respondWith:response=>{result=response;}});
    return result;
  }
  fetchPage=async()=>new Response('Sign in',{status:401});
  assert.equal((await request('/')).status,401);
  fetchPage=async()=>Response.redirect('https://research.test/sign-in');
  assert.equal((await request('/')).status,302);
  fetchPage=async()=>{throw new TypeError('Offline');};
  assert.equal(await (await request('/?reconnect=1')).text(),offlinePage);
  assert.equal(request('/api/picks','cors'),undefined);
  assert.equal(request('/api/refresh','cors','POST'),undefined);
  assert.equal(request('/sign-in'),undefined);
});
