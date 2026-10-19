const path = require('node:path');
const palette = require('../palette-defaults.json');
function validateSettings(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('Settings must be a JSON object.');
  const visit = item => { if(item&&typeof item==='object') for(const key of Object.keys(item)){if(['__proto__','constructor','prototype'].includes(key))throw Error('Invalid settings key.');visit(item[key]);} };visit(value);
  const copy=JSON.parse(JSON.stringify(value));
  for(const key of ['autoInstall','cachedOnly','keepArchives','automaticUpdates'])if(copy[key]!==undefined&&typeof copy[key]!=='boolean')throw Error(key+' must be true or false.');
  for(const key of ['torboxApiKey','archivePassword'])if(copy[key]!==undefined&&typeof copy[key]!=='string')throw Error(key+' must be text.');
  if(copy.downloadPath!==undefined&&(typeof copy.downloadPath!=='string'||!path.isAbsolute(copy.downloadPath)))throw Error('Choose an absolute games folder path.');
  if(copy.transferTimeoutMinutes!==undefined&&(!Number.isFinite(copy.transferTimeoutMinutes)||copy.transferTimeoutMinutes<5||copy.transferTimeoutMinutes>1440))throw Error('Preparation timeout must be between 5 and 1440 minutes.');
  if(copy.sourceUrls!==undefined){if(!Array.isArray(copy.sourceUrls))throw Error('Sources must be a list.');copy.sourceUrls=[...new Set(copy.sourceUrls.map(url=>{if(typeof url!=='string'||!['https:','http:'].includes(new URL(url).protocol))throw Error('Invalid source URL.');return url.trim();}))];}
  if(copy.palette!==undefined){if(!copy.palette||Array.isArray(copy.palette)||typeof copy.palette!=='object')throw Error('Invalid palette.');for(const [key,color]of Object.entries(copy.palette))if(!(key in palette)||typeof color!=='string'||!/^#[a-f0-9]{6}$/i.test(color))throw Error('Palette colors must use #RRGGBB.');}
  return copy;
}
function decodeConfig(text) {
  const data=JSON.parse(text.replace(/^\uFEFF/,''));
  if(data?.schemaVersion!==undefined&&data.schemaVersion!==1)throw Error('This config export uses an unsupported version.');
  return validateSettings(data?.schemaVersion===1?data.settings:data);
}
const encodeConfig=(settings,version)=>JSON.stringify({schemaVersion:1,appVersion:version,exportedAt:new Date().toISOString(),settings},null,2)+'\n';
module.exports={validateSettings,decodeConfig,encodeConfig};
