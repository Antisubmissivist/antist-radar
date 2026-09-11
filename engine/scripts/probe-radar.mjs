import '../apis/utils/env.mjs';
import { mkdir,writeFile } from 'node:fs/promises';
import { collectFeeds } from '../apis/sources/radar-feeds.mjs';
await mkdir('runs',{recursive:true});
const data=await collectFeeds();
await writeFile('runs/radar-feeds.json',JSON.stringify(data,null,2));
for(const s of data)console.log(JSON.stringify({source:s.name,status:s.status,count:s.items.length,scanned:s.scanned,error:s.error||null,first:s.items[0]?.url}));
