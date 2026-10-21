const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');const {createRequire}=require('node:module');
const main=path.join(__dirname,'..','main.cjs'),source=fs.readFileSync(main,'utf8');
test('a duplicate client quits before loading services or registering handlers',()=>{
 let quits=0;const loaded=[];
 vm.runInNewContext(source,{require(name){loaded.push(name);assert.equal(name,'electron');return {app:{requestSingleInstanceLock:()=>false,quit:()=>quits++}};}});
 assert.equal(quits,1);assert.deepEqual(loaded,['electron']);
});
test('launching a second client restores and focuses the original window',()=>{
 const app=new EventEmitter(),actions=[];app.requestSingleInstanceLock=()=>true;app.whenReady=()=>({then:()=>({catch(){}})});
 const window={show:()=>actions.push('show'),isMinimized:()=>true,restore:()=>actions.push('restore'),focus:()=>actions.push('focus')};
 const electron={app,BrowserWindow:{getAllWindows:()=>[window]},ipcMain:{handle(){}},Notification:{},dialog:{},shell:{}};
 const realRequire=createRequire(main);
 vm.runInNewContext(source,{require:name=>name==='electron'?electron:realRequire(name),__dirname:path.dirname(main),process,console,Buffer,setTimeout,clearTimeout,setInterval,clearInterval});
 app.emit('second-instance');assert.deepEqual(actions,['show','restore','focus']);
});
