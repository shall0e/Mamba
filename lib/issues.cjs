const {randomUUID}=require('node:crypto');
function explain(error) {
  const text=String(error?.message||error||'Something went wrong.');
  const rules=[
    [/settings file.+unreadable|settings.+defaults/i,'configuration','Settings were recovered','A backup of the previous settings was kept. Open Settings to reconnect your account and review your Games folder.','settings'],
    [/queue.+unreadable|preferences.+unreadable/i,'saved-data','Saved data was recovered','A backup was kept. Review your library and add any interrupted downloads again.','activity'],
    [/ENOSPC|not enough disk|disk.+full/i,'disk-space','Not enough disk space','Free space or choose a different Games folder in Settings.','settings'],
    [/ENOENT|unavailable.+drive|drive.+unavailable|no such file|no longer available/i,'missing-file','A file or folder is unavailable','Reconnect the drive, check the Games folder, or select the correct game launcher.','settings'],
    [/EACCES|EPERM|cannot write|permission|access.+denied/i,'permissions','Folder access was blocked','Choose a writable folder and check whether another app is using the files.','settings'],
    [/401|403|api key|unauthorized|authentication/i,'authentication','TorBox needs attention','Check your TorBox API key and account in Settings.','settings'],
    [/429|rate.?limit/i,'rate-limit','The service needs a moment','Wait before retrying. Repeated clicks will not speed up the request.','retry'],
    [/archive.+(?:password|links|unsafe|corrupt)|extract|CRC|checksum/i,'archive','The archive could not be opened','Check the archive password in Settings or choose another download option.','settings'],
    [/background|service.+recover/i,'background','Background tasks were interrupted','Retry after the service reconnects. Downloads remain paused until you resume them.','activity'],
    [/launcher|executable|startup|shortcut.+review|setup.+review/i,'launcher','Installation needs review','Open the game details and choose the file that starts the game.','library'],
    [/network|fetch failed|terminated|timed? ?out|ECONN|ENOTFOUND|download.+(?:failed|incomplete|resume)/i,'connection','Could not finish the download','Check your connection and try again. Partial downloads can be resumed.','retry']
  ];
  const found=rules.find(([pattern])=>pattern.test(text));
  const [,code,title,advice,action]=found||[null,'unexpected','This task could not finish','Try again. If it keeps happening, export diagnostics from Activity.','retry'];
  return {code,title,advice,action};
}
function safeMessage(value, secrets=[]) {
  let text=String(value||'').replace(/Error invoking remote method '[^']+': (?:Error: )?/, '');
  for(const secret of secrets.filter(value=>typeof value==='string'&&value.length>2))text=text.split(secret).join('[redacted]');
  return text.replace(/(?:https?:\/\/|magnet:\?)[^\s"<>]+/gi,'[link]').replace(/(?:Bearer\s+)[^\s]+/gi,'Bearer [redacted]').slice(0,700);
}
class Issues {
  constructor(){this.items=[];}
  add(error,context='app',secrets=[]) {
    const message=safeMessage(error?.message||error,secrets),detail=explain(error);
    const existing=this.items.find(item=>!item.resolved&&item.code===detail.code&&(detail.code==='background'||item.message===message));
    if(existing){existing.count++;existing.at=new Date().toISOString();return existing;}
    const issue={id:randomUUID(),at:new Date().toISOString(),context,message,...detail,count:1,resolved:false};
    this.items.unshift(issue);this.items=this.items.slice(0,50);return issue;
  }
  resolve(id){const item=this.items.find(item=>item.id===id);if(item)item.resolved=true;}
  diagnostics(){return this.items.map(({code,context,at,count,resolved,message})=>({code,context,at,count,resolved,message}));}
}
module.exports={Issues,explain,safeMessage};
