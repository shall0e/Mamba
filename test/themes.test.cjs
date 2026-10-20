const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const model=require('../theme-model.js');const {Themes}=require('../lib/themes.cjs');const {validateSettings,encodeConfig,decodeConfig}=require('../lib/config-transfer.cjs');
test('built-in themes map the five color roles to the actual UI palette',()=>{
 assert.deepEqual(model.presets.map(theme=>theme.name),['Dark','Light','Modern Warfare 4']);
 for(const theme of model.presets){const palette=model.palette(theme);assert.equal(palette.primary,theme.colors.background);assert.equal(palette.surface,theme.colors.foreground);assert.equal(palette.input,theme.colors.input);assert.equal(palette.button,theme.colors.input);assert.equal(palette.playButton,theme.colors.icons);assert.equal(palette.icons,theme.colors.icons);for(const key of ['text','textSecondary','textMuted','textOnSelection','buttonText'])assert.equal(palette[key],theme.colors.text);assert.deepEqual(validateSettings({palette}).palette,palette);}
});
test('theme sharing whitelists appearance and never includes account or source settings',()=>{
 const shared=model.parse({...model.presets[0],name:'My theme',apiKey:'secret',torboxApiKey:'secret',sourceUrls:['private'],downloadPath:'D:/private'});assert.deepEqual(Object.keys(shared),['schemaVersion','name','colors','glass','effects']);assert.ok(!JSON.stringify(shared).includes('secret'));assert.ok(!JSON.stringify(shared).includes('private'));assert.deepEqual(model.parse(JSON.parse(JSON.stringify(shared))),shared);
});
test('invalid colors, glassiness, and empty theme names cannot enter CSS',()=>{
 const theme=model.presets[0];for(const input of [{...theme,name:''},{...theme,colors:{...theme.colors,background:'url(https://example.test)'}},{...theme,glass:{opacity:2,blur:10}},{...theme,glass:{opacity:.8,blur:100}},{...theme,schemaVersion:2}])assert.throws(()=>model.parse(input));
});
test('custom themes survive reload, replace same-name saves, and serialize concurrent saves',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-themes-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new Themes(dir);
 const first=await store.save({...model.presets[0],name:'My theme',apiKey:'secret'});await Promise.all([store.save({...model.presets[1],name:'Second'}),store.save({...model.presets[0],name:'Third'})]);
 const next=await store.save({...model.presets[1],name:'My theme'});assert.equal(first.id,next.id);const saved=await new Themes(dir).list();assert.equal(saved.length,3);assert.equal(saved.find(row=>row.id===first.id).theme.colors.background,model.presets[1].colors.background);assert.ok(!(await fs.readFile(store.file,'utf8')).includes('secret'));
});
test('theme selection and glassiness survive full configuration export/import',()=>{
 const appearance=model.parse({...model.presets[1],glass:{opacity:.65,blur:12}});const config={appearance,palette:model.palette(appearance)};assert.deepEqual(decodeConfig(encodeConfig(config,'3.0.2')),config);
});

test('independent effects migrate older themes and round-trip without coupling roles',()=>{
 const theme=model.parse(model.presets[0]);assert.deepEqual(theme.effects.foreground,{opacity:.88,blur:22});assert.deepEqual(theme.effects.text,{opacity:1,blur:0});theme.effects.input={opacity:.42,blur:8};theme.effects.icons={opacity:.7,blur:2};const restored=model.parse(JSON.parse(JSON.stringify(theme)));assert.deepEqual(restored,theme);assert.deepEqual(restored.effects.foreground,{opacity:.88,blur:22});for(const effect of [{opacity:-1,blur:0},{opacity:1,blur:41},{opacity:NaN,blur:2}])assert.throws(()=>model.parse({...theme,effects:{...theme.effects,text:effect}}));
});
test('embedded fonts and element assignments survive theme storage and config sharing',async t=>{
 const font={name:'Example.woff2',data:Buffer.from('wOF2example-font-bytes').toString('base64')};const theme=model.parse({...model.presets[1],name:'Font theme',fonts:[{...font,path:'private'}],typography:{body:font.name,headings:font.name,search:font.name}});assert.deepEqual(theme.fonts,[font]);assert.equal(theme.typography.search,font.name);assert.equal(theme.typography.buttons,'');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mamba-fonts-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await new Themes(dir).save(theme);assert.deepEqual((await new Themes(dir).list())[0].theme,theme);assert.deepEqual(decodeConfig(encodeConfig({appearance:theme},'3.0.2')).appearance,theme);
});
test('font validation rejects nonfonts, missing references, duplicates and oversized payloads',()=>{
 const theme=model.presets[0],font={name:'Font',data:Buffer.from('wOFFfont').toString('base64')};for(const value of [{fonts:[{name:'bad',data:Buffer.from('<html>').toString('base64')}]},{fonts:[font,font]},{fonts:[{name:'bad',data:'!!!'}]},{typography:{headings:'missing'}},{fonts:[{name:'huge',data:'A'.repeat(6990512)}]}])assert.throws(()=>model.parse({...theme,...value}));
});
test('configured text and icon colors stay unchanged across background brightness',()=>{
 for(const background of ['#181818','#ffffff','#808080']){const theme=model.parse({...model.presets[0],colors:{...model.presets[0].colors,background,text:'#e33286',icons:'#13b9a0'}});const palette=model.palette(theme);assert.equal(palette.text,'#e33286');assert.equal(palette.buttonText,'#e33286');assert.equal(palette.textOnSelection,'#e33286');assert.equal(palette.icons,'#13b9a0');}
 assert.equal(model.isLightBackground('#ffffff'),true);assert.equal(model.isLightBackground('#181818'),false);
});
test('adaptive ink shifts lightness with the backdrop while preserving chroma',()=>{
 const dark=model.adaptiveColor('#e33286','#111111'),bright=model.adaptiveColor('#e33286','#ffffff');assert.notEqual(dark,bright);
 const saturation=color=>{const channels=color.slice(1).match(/../g).map(value=>parseInt(value,16)/255),max=Math.max(...channels),min=Math.min(...channels),light=(max+min)/2;return max===min?0:(max-min)/(1-Math.abs(2*light-1));};
 assert.ok(Math.abs(saturation(dark)-saturation('#e33286'))<.02);assert.ok(Math.abs(saturation(bright)-saturation('#e33286'))<.02);
 const nearNeutral=model.adaptiveColor('#e33286','#bcbcbc').slice(1).match(/../g).map(value=>parseInt(value,16)),original='#e33286'.slice(1).match(/../g).map(value=>parseInt(value,16));assert.ok(nearNeutral.every((value,index)=>Math.abs(value-original[index])<=1));
});

test('glow fades to transparent with zero foreground opacity or full background blur',()=>{
 for(const [foreground,blur,opacity] of [[1,0,1],[1,100,0],[0,0,0],[0,100,0],[.8,40,.48],[.4,80,.08]]){assert.ok(Math.abs(model.glowOpacity(foreground,blur)-opacity)<1e-12);const theme=model.parse(model.presets[0]);theme.effects.background.blur=blur;assert.equal(model.parse(theme).effects.background.blur,blur);}
 const theme=model.parse(model.presets[0]);theme.effects.background.blur=101;assert.throws(()=>model.parse(theme));theme.effects.background.blur=100;theme.effects.input.blur=41;assert.throws(()=>model.parse(theme));
});

