const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { launchTarget } = require('./shortcuts.cjs');
const defaultDirectory = () => path.join(process.env.LOCALAPPDATA, 'Packages', 'Microsoft.GamingApp_8wekyb3d8bbwe', 'LocalState', 'CustomLibraryManagement');
function mergeXboxLibrary(saved, game) {
  if (!saved || Array.isArray(saved) || typeof saved !== 'object' || Object.values(saved).some(entry => !entry || typeof entry !== 'object' || !entry.id || typeof entry.executableName !== 'string')) throw Error('Xbox custom-library format changed. Existing entries were preserved.');
  const launch = launchTarget(game.executable), executable = launch.exe.replace(/^"|"$/g, '');
  const installLocation = path.dirname(executable) + path.sep, executableName = path.basename(executable);
  const existing = Object.values(saved).find(entry => (path.join(entry.installLocation, entry.executableName).toLowerCase() === executable.toLowerCase() && (entry.executableCommandArgs || '') === launch.args) || entry.title?.toLowerCase() === game.name.toLowerCase());
  const id = existing?.id || randomUUID();
  return {...saved, [id]: {...existing, id, addedDate:existing?.addedDate || String(Date.now()), imagePath:game.imagePath || existing?.imagePath || '', title:game.name, installLocation, executableName, executableCommandArgs:launch.args}};
}
let queue = Promise.resolve();
function registerXbox(game, {directory = defaultDirectory()} = {}) {
  const task = queue.catch(() => {}).then(async () => {
    if (!await fs.stat(directory).then(stat => stat.isDirectory(), () => false)) return {status:'unavailable',message:'Open or update the Xbox PC app to enable its custom library.'};
    if (!(await fs.lstat(game.executable)).isFile()) throw Error('The game launcher no longer exists.');
    const file = path.join(directory, 'CustomLibraryManagement.manifest');
    const lock = await fs.open(file + '.mamba-lock', 'wx');
    try {
      let imagePath;
      const match = game.image?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (match && game.image.length < 3 * 1024 * 1024) {
        const art = path.join(directory,'MambaArtwork'); await fs.mkdir(art,{recursive:true});
        imagePath = path.join(art, createHash('sha256').update(game.name).digest('hex') + '.' + ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[match[1]]);
        await fs.writeFile(imagePath, Buffer.from(match[2], 'base64'));
      }
      const read = () => fs.readFile(file,'utf8').catch(error => {if(error.code==='ENOENT')return '';throw error;});
      for(let attempt=0;attempt<3;attempt++) {
        const before=await read(); const saved=before.trim()?JSON.parse(before.replace(/^\uFEFF/,'')):{};
        const merged=mergeXboxLibrary(saved,{...game,imagePath});
        if(JSON.stringify(merged)===JSON.stringify(saved))return {status:'added',message:'Already in the Xbox PC library.'};
        if(await read()!==before)continue;
        if(before.length)await fs.copyFile(file,file+'.mamba-backup-'+Date.now(),require('node:fs').constants.COPYFILE_EXCL);
        const temporary=file+'.mamba-'+randomUUID()+'.tmp';
        await fs.writeFile(temporary,JSON.stringify(merged,null,2));
        if(await read()!==before){await fs.unlink(temporary);continue;}
        await fs.rename(temporary,file);
        return {status:'added',message:'Added to the Xbox PC library. Reopen Xbox if the tile is not visible yet.'};
      }
      throw Error('Xbox updated its library during registration. Retry adding the game.');
    } finally {await lock.close();await fs.unlink(file+'.mamba-lock').catch(()=>{});}
  }); queue=task; return task;
}
module.exports={registerXbox,mergeXboxLibrary};
