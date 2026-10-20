const test=require('node:test');const assert=require('node:assert/strict');
const {summary,sample,recent}=require('../activity-metrics.js');
test('download summary counts active transfers, clamps completed bytes, and ignores invalid speeds',()=>{
  const jobs=[{status:'downloading',speed:2000000,total:100,received:40},{status:'downloading',speed:NaN,total:50,received:70},{status:'paused',speed:9000000,total:100,received:10}];
  assert.deepEqual(summary(jobs),{count:2,speed:2000000,remaining:60,unknownSize:false});
  assert.equal(summary([{status:'downloading',speed:-10}]).unknownSize,true);
});
test('frequent progress updates retain one point per second and expire after a minute',()=>{
  let history=[];
  for(let time=0;time<65000;time+=250)history=sample(history,[{status:'downloading',speed:time}],time);
  assert.equal(history.length,60);assert.equal(history.at(-1).speed,64750);assert.ok(history[0].at>4750);
  history=sample(history,[{status:'paused',speed:100}],65000);assert.equal(history.at(-1).speed,0);
  assert.deepEqual(sample(history,[],130000),[{at:130000,speed:0}]);
});
test('recent play uses actual valid launch dates and playable installations',()=>{
  const games=[{id:'old',status:'installed',executable:'game.exe',lastPlayed:'2026-10-17'},{id:'new',status:'installed',executable:'game.exe',lastPlayed:'2026-10-19'},{id:'unplayed',status:'installed',executable:'game.exe'},{id:'bad',status:'installed',executable:'game.exe',lastPlayed:'bad'},{id:'missing',status:'needs-setup',lastPlayed:'2026-10-20'}];
  assert.deepEqual(recent(games).map(game=>game.id),['new','old']);assert.equal(games[0].id,'old');
});
