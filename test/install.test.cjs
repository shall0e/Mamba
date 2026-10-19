const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {flatten,detect,finalizeInstallation}=require('../lib/library.cjs');const {parseVdf,addShortcut,registerSteam,launchTarget}=require('../lib/shortcuts.cjs');const {addGame}=require('../tools/add-game.cjs');
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-install-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function write(file,text='fixture'){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);}
test('finds nested game beside empty hash folder and readme, preserves engine layout, renames to official title',async t=>{
 const parent=await temp(t),root=path.join(parent,'Release-123');await write(path.join(root,'Wrapper','Game','!start_game.bat'));await write(path.join(root,'Wrapper','Game','cod.exe'));await write(path.join(root,'Wrapper','Game','Engine','data.bin'));await write(path.join(root,'readme.txt'));await fs.mkdir(path.join(root,'empty-hash'));await write(path.join(root,'.mamba-game.json'),'{}');
 const result=await finalizeInstallation(root,'Official Game',{releaseId:'123'});assert.equal(result.folder,path.join(parent,'Official Game'));assert.equal(result.executable,path.join(result.folder,'!start_game.bat'));assert.ok(await fs.stat(path.join(result.folder,'Engine','data.bin')));assert.ok(await fs.stat(path.join(result.folder,'readme.txt')));assert.equal(await fs.access(root).then(()=>true,()=>false),false);
});
test('preserves UE Binaries/Win64 and refuses folder-name collisions without overwriting',async t=>{
 const parent=await temp(t),root=path.join(parent,'Release');await write(path.join(root,'Binaries','Win64','Game-Win64-Shipping.exe'));await flatten(root);assert.ok(await fs.stat(path.join(root,'Binaries','Win64','Game-Win64-Shipping.exe')));await fs.mkdir(path.join(parent,'Existing'));await assert.rejects(finalizeInstallation(root,'Existing'),/already exists/);assert.ok(await fs.stat(root));
});
test('manual helper repairs root and remaps chosen batch launcher for desktop and Steam',async t=>{
 const parent=await temp(t),root=path.join(parent,'Release');const file=path.join(root,'Nested','launch.cmd');await write(file);let desktop,steam;
 const result=await addGame({file,folder:root,name:'source title',xbox:async()=>({status:'added'}),resolveName:async()=> 'Steam Title',desktop:async(...args)=>{desktop=args;},steam:async game=>{steam=game;return {status:'added'};}});
 assert.equal(result.executable,path.join(parent,'Steam Title','launch.cmd'));assert.equal(desktop[1],result.executable);assert.equal(steam.executable,result.executable);assert.equal(JSON.parse(await fs.readFile(path.join(result.folder,'.mamba-game.json'))).steam.status,'added');assert.match(launchTarget(result.executable).args,/launch.cmd/);
});
test('Steam shortcut insertion preserves existing records and repeated registration is idempotent',async()=>{
 const one={name:'First',executable:'C:\\Games\\First\\game.exe',folder:'C:\\Games\\First'};const two={name:'Second',executable:'C:\\Games\\Second\\start.bat',folder:'C:\\Games\\Second'};
 const original=addShortcut(Buffer.alloc(0),one);const updated=addShortcut(original,two);const old=parseVdf(original)[0].value[0].raw;assert.ok(parseVdf(updated)[0].value[0].raw.equals(old));assert.equal(parseVdf(updated)[0].value.length,2);assert.ok(addShortcut(updated,two).equals(updated));assert.throws(()=>addShortcut(Buffer.from([0,1]),one));
});
test('Steam registration reports shutdown timeout and makes a backup before adding',async t=>{
 const dir=await temp(t),file=path.join(dir,'shortcuts.vdf');const game={name:'Test',executable:'C:\\Games\\Test\\game.exe',folder:'C:\\Games\\Test'};
 let clock=0;assert.equal((await registerSteam(game,{running:async()=>true,profile:async()=>file,shutdown:async()=>{},reopen:()=>assert.fail('Steam is still running'),now:()=>clock+=50000})).status,'pending');assert.equal(await fs.access(file).then(()=>true,()=>false),false);
 await fs.writeFile(file,addShortcut(Buffer.alloc(0),{...game,name:'Other',executable:'C:\\other.exe'}));const before=await fs.readFile(file);
 assert.equal((await registerSteam(game,{running:async()=>false,profile:async()=>file})).status,'added');const backup=(await fs.readdir(dir)).find(name=>name.includes('mamba-backup'));assert.ok((await fs.readFile(path.join(dir,backup))).equals(before));assert.equal(parseVdf(await fs.readFile(file))[0].value.length,2);
});
test('desktop shortcut points at the selected batch launcher without starting it',async t=>{
 const dir=await temp(t);const file=path.join(dir,'launch game.cmd');await write(file,'@echo test fixture');
 await require('../lib/shortcuts.cjs').desktopShortcut('Fixture Game',file,dir,dir);
 const {execFile}=require('node:child_process');const exec=require('node:util').promisify(execFile);const link=path.join(dir,'Fixture Game.lnk');
 const payload=Buffer.from(link).toString('base64');const script=`$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')));@{target=$s.TargetPath;args=$s.Arguments;cwd=$s.WorkingDirectory}|ConvertTo-Json -Compress`;
 const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});const shortcut=JSON.parse(stdout);assert.match(shortcut.target,/cmd.exe$/i);assert.ok(shortcut.args.includes(file));assert.equal(shortcut.cwd,dir);
});
test('running Steam closes normally and reopens after immediate registration; duplicates need no restart',async t=>{
 const dir=await temp(t),file=path.join(dir,'shortcuts.vdf');const game={name:'Live Test',executable:'C:\\Games\\live.exe',folder:'C:\\Games'};let running=true;const events=[];
 const options={profile:async()=>file,running:async()=>running,shutdown:async()=>{events.push('shutdown');running=false;},reopen:async()=>{assert.equal(parseVdf(await fs.readFile(file))[0].value.length,1);events.push('reopen');running=true;}};
 assert.equal((await registerSteam(game,options)).status,'added');assert.deepEqual(events,['shutdown','reopen']);
 assert.equal((await registerSteam(game,options)).status,'added');assert.deepEqual(events,['shutdown','reopen']);
});
test('Steam reopens even when shortcut writing fails',async t=>{
 const dir=await temp(t),file=path.join(dir,'shortcuts.vdf');await write(file+'.mamba-lock');let running=true,reopened=false;
 await assert.rejects(registerSteam({name:'Test',executable:'C:\\test.exe',folder:'C:\\'}, {profile:async()=>file,running:async()=>running,shutdown:async()=>{running=false;},reopen:async()=>{reopened=true;}}),/EEXIST/);assert.equal(reopened,true);
});
