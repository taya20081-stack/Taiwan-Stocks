const CACHE_PREFIX='taiwan-equity-lab-offline-';
const CACHE_NAME=CACHE_PREFIX+'__BUILD_REVISION__';
const OFFLINE_PATH='/offline.html';

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const response=await fetch(OFFLINE_PATH,{cache:'reload',redirect:'error'});
    if(!response.ok||!response.headers.get('Content-Type')?.startsWith('text/html')){
      throw new Error('Offline page is unavailable');
    }
    const cache=await caches.open(CACHE_NAME);
    await cache.put(OFFLINE_PATH,response);
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const {request}=event;
  const url=new URL(request.url);
  if(request.method!=='GET'||request.mode!=='navigate'||url.origin!==self.location.origin||url.pathname!=='/')return;
  event.respondWith(fetch(request).catch(async()=>{
    const cached=await (await caches.open(CACHE_NAME)).match(OFFLINE_PATH);
    return cached??Response.error();
  }));
});
