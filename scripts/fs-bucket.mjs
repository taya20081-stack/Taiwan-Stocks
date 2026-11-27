// 檔案系統版資料儲存：GitHub Actions 讀寫 gh-pages 分支上的 data/ 目錄。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createBucket, indexFromJson, indexToJson, objectPath } from '../src/bucket.mjs';

export async function openFsBucket(dir) {
  const indexFile=join(dir,'index.json');
  const saved=await readFile(indexFile,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return {};throw e;});
  const index=indexFromJson(saved.objects);
  const bucket=createBucket({
    index,
    read:async key=>new Uint8Array(await readFile(join(dir,objectPath(key)))),
    write:async(key,bytes)=>{
      const file=join(dir,objectPath(key));
      await mkdir(dirname(file),{recursive:true});
      await writeFile(file,bytes);
    }
  });
  bucket.save=async()=>{
    await mkdir(dir,{recursive:true});
    await writeFile(indexFile,JSON.stringify({updatedAt:new Date().toISOString(),objects:indexToJson(index)}));
  };
  return bucket;
}
