const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {Downloads,downloadFile}=require('../lib/downloads.cjs');
test('speed reports bytes per second without counting resumed bytes',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-speed-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'game.bin');await fs.writeFile(file+'.part',Buffer.alloc(100));let positive=false;
 const transport=async()=>new Response(new ReadableStream({async start(controller){await new Promise(r=>setTimeout(r,350));controller.enqueue(new Uint8Array(100));controller.close();}}),{status:206,headers:{'content-range':'bytes 100-199/200','content-length':'100'}});
 await downloadFile('https://example.test',file,200,new AbortController().signal,(_received,_total,speed)=>{if(speed>0){positive=true;assert.ok(speed<500);}},transport);assert.equal(positive,true);
});
test('removing active item aborts it and late updates cannot restore it; clearing keeps active jobs',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-queue-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const downloads=new Downloads(dir,()=>({}),{},{});const active={id:'active',status:'downloading'},queued={id:'queued',status:'queued'};downloads.jobs=[active,queued,{id:'done',status:'completed'},{id:'failed',status:'failed'}];const controller=new AbortController();downloads.controllers.set('active',controller);
 await downloads.remove('active');assert.equal(controller.signal.aborted,true);await downloads.update(active,{status:'failed'});assert.equal(downloads.jobs.includes(active),false);
 await downloads.clearFinished();assert.deepEqual(downloads.jobs,[queued]);assert.deepEqual(JSON.parse(await fs.readFile(downloads.file,'utf8')),[queued]);
});
