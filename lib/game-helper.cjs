const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sourceRoot = path.resolve(__dirname, '..');
async function registerHelperRuntime(directory = path.join(process.env.LOCALAPPDATA, 'Mamba'), executable = process.execPath) {
  await fs.mkdir(directory, {recursive:true});
  const file = path.join(directory,'helper-runtime.json');
  const temporary = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify({executable,script:path.join(sourceRoot,'tools','add-game.cjs')}));
  await fs.rename(temporary,file);
  await fs.writeFile(path.join(directory,'run-game-helper.ps1'),await fs.readFile(path.join(sourceRoot,'helper','run.ps1')));
}
async function installGameHelper(folder) {
  const root=path.resolve(folder);
  const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Invalid game helper destination.');
  const command=path.join(root,'ADD-GAME.cmd');
  const existing=await fs.lstat(command).catch(()=>null);if(existing?.isSymbolicLink())throw Error('The helper command cannot be a symbolic link.');
  const old=await fs.readFile(command,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(old&&!old.includes('MAMBA_GAME_FOLDER')&&!old.includes('run-game-helper.ps1'))throw Error('An unrelated ADD-GAME.cmd already exists.');
  const contents=await fs.readFile(path.join(sourceRoot,'helper','ADD-GAME.cmd'));
  if(old!==contents.toString())await fs.writeFile(command,contents);
  return command;
}
module.exports={installGameHelper,registerHelperRuntime};
