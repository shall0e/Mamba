const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline/promises');
const { finalizeInstallation, detect, within, safeName, atomicJson } = require('../lib/library.cjs');
const { desktopShortcut, registerSteam, launchTarget } = require('../lib/shortcuts.cjs');
const { Metadata } = require('../lib/metadata.cjs');
const { displayTitle } = require('../lib/search.cjs');
async function addGame({ file, folder, name, resolveName = async value => value, desktop = desktopShortcut, steam = registerSteam }) {
  within(folder, file); launchTarget(file);
  if (!(await fs.lstat(file)).isFile()) throw Error('Choose a launcher file.');
  const title = await resolveName(displayTitle(name));
  const result = await finalizeInstallation(folder, title, { executable: file, status: 'installed' });
  const game = { name: title, executable: result.executable, folder: result.folder };
  const registration = await steam(game).catch(error => ({status:'pending',message:error.message}));
  await atomicJson(path.join(result.folder,'.mamba-game.json'),{...result.manifest,steam:registration});
  await desktop(safeName(title),game.executable,path.dirname(game.executable));
  return {...game,steam:registration};
}
async function main() {
  const input = readline.createInterface({input:process.stdin,output:process.stdout});
  const ask = async prompt => (await input.question(prompt)).trim().replace(/^"|"$/g,'');
  try {
    console.log('Mamba - choose a game launcher, create a desktop shortcut and add it to Steam.\n');
    const supplied = path.resolve(await ask('Game folder OR full path to the EXE / BAT / CMD / PS1 / shortcut: '));
    const stat = await fs.lstat(supplied);let file=supplied, suggestedFolder=stat.isDirectory()?supplied:path.dirname(supplied);
    if(stat.isDirectory()) {
      const found = await detect(supplied);
      console.log('\nLaunchers found:'); found.executables.forEach((item,index)=>console.log(`${index+1}. ${path.relative(supplied,item)}`));
      const choice=await ask('Launcher number, or full launcher path: ');
      file=/^\d+$/.test(choice)?found.executables[Number(choice)-1]:path.resolve(supplied,choice);
      if(!file)throw Error('Invalid launcher number.');
    }
    let manifest={};
    for(let cursor=path.dirname(file);;cursor=path.dirname(cursor)){
      try {manifest=JSON.parse(await fs.readFile(path.join(cursor,'.mamba-game.json'),'utf8'));suggestedFolder=cursor;break;}catch{}
      if(path.dirname(cursor)===cursor)break;
    }
    const folder=path.resolve(await ask(`Actual game root folder [${suggestedFolder}]: `)||suggestedFolder);
    const name=await ask(`Game name [${manifest.name||path.basename(folder)}]: `)||manifest.name||path.basename(folder);
    console.log(`\nGame: ${name}\nRoot to clean up: ${folder}\nLauncher: ${file}`);
    if((await ask('Create shortcut and add to Steam? [Y/n]: ')).toLowerCase()==='n')return;
    const project=path.resolve(__dirname,'..');
    const localProject=path.resolve(path.dirname(process.execPath),'..','..');
    const hasConfig=async directory=>fs.access(path.join(directory,'config.json')).then(()=>true,()=>false);
    const directory=process.env.MAMBA_DATA_DIR||((await hasConfig(project))?project:(await hasConfig(localProject))?localProject:path.join(process.env.APPDATA,'minimal-downloader'));
    const metadata=new Metadata(directory,{games:[],replace(){}});await metadata.load();
    const result=await addGame({file,folder,name,resolveName:value=>metadata.resolveName(value)});
    console.log(`\nDesktop shortcut created.\nGame folder: ${result.folder}\n${result.steam.message}`);
    console.log('Refresh Library in Mamba to see the selected launcher.');
  } finally { input.close(); }
}
if(require.main===module)main().catch(error=>{console.error('\n'+error.message);process.exitCode=1;});
module.exports={addGame};
