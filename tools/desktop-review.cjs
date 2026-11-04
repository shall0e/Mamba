const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const output = process.env.MAMBA_REVIEW_OUTPUT;
const scale = Number(process.env.MAMBA_REVIEW_SCALE || 1);
if (process.env.MAMBA_REVIEW_SCALE)
  app.commandLine.appendSwitch('force-device-scale-factor', process.env.MAMBA_REVIEW_SCALE);
app.setPath('userData', path.join(require('node:os').tmpdir(), 'mamba-desktop-review'));
app
  .whenReady()
  .then(async () => {
    const artwork = [];
    for (const file of (await fs.readdir(path.join(__dirname, '../data/artwork'))).slice(0, 30)) {
      const saved = JSON.parse(
        await fs.readFile(path.join(__dirname, '../data/artwork', file), 'utf8'),
      );
      if (saved.image) artwork.push(saved.image);
      if (artwork.length === 5) break;
    }
    const artworkCalls = new Map();
    let launches = 0;
    const games = Array.from({ length: 20 }, (_, i) => ({
      id: 'review-' + i,
      steamId: String(100 + i),
      verified: true,
      name:
        i === 5
          ? 'A long game title to check wrapping and action alignment'
          : 'Review game ' + (i + 1),
      status: i === 4 ? 'not-installed' : 'installed',
      executable: i === 4 ? null : 'C:\\Games\\review.exe',
      favorite: i === 0,
      running: i === 0,
      options: [],
      installations: [],
      lastPlayed: '2026-10-' + (10 + i),
      installedAt: '2026-10-' + (10 + i),
    }));
    const config = {
      sourceUrls: [],
      palette: require('../src/shared/palette-defaults.json'),
      downloadPath: 'C:\\Games',
      extraGameFolders: ['C:\\Games\\Classics', 'D:\\Games\\Steam Library'],
      installedGames: games,
      onboardingCompleted: true,
      automaticUpdates: false,
    };
    const values = {
      'config:load': config,
      'library:scan': games,
      'catalog:status': { phase: 'ready', count: 6, errors: [], message: 'Offline review catalog' },
      'app:updates': { version: '1.5.1', status: 'development', message: 'Offline design review' },
      'creaminstaller:state': { status: 'idle', message: 'Offline design review' },
      'app:activity': { issues: [], jobs: [] },
      'steam:library-state': { status: 'ready', count: 0 },
      'catalog:search': { items: games, total: 6 },
      'catalog:artwork': null,
      'game:details': {
        id: 'review',
        name: 'Review game 1',
        steamId: 100,
        libraryId: 'review-0',
        catalogId: 'review',
        running: true,
        publishers: ['Fixture publisher'],
        installations: [
          {
            ...games[0],
            folder: 'C:\\Games\\Review',
            folderExists: true,
            installer: 'C:\\Games\\Review\\setup.exe',
          },
        ],
        developers: ['Review fixture'],
        genres: ['Adventure'],
        releaseDate: '2026',
        options: [],
        dlcs: [],
        demos: [],
        description: 'Offline game details fixture.',
      },
    };
    const options = Array.from({ length: 8 }, (_, i) => ({
      gameId: 'release-' + i,
      linkIndex: 0,
      release:
        i === 7
          ? 'Long release title to verify wrapping and action alignment across window sizes'
          : 'Review release ' + (i + 1),
      fileSize: i === 2 ? null : '12 GB',
      host: 'Fixture host',
      sources: ['Review source'],
      services: ['direct', 'torbox'],
      available: i !== 3,
      traits: { version: '1.' + i, portable: i === 1, incompatible: false, partial: false },
    }));
    values['catalog:resolve'] = { options, best: options[0] };
    const preload = path.join(__dirname, '../src/main/preload.cjs');
    for (const match of (await fs.readFile(preload, 'utf8')).matchAll(
      /ipcRenderer.invoke\('([^']+)'/g,
    )) {
      const channel = match[1];
      ipcMain.handle(channel, (_e, argument) => {
        if (channel === 'catalog:artwork') {
          artworkCalls.set(argument, (artworkCalls.get(argument) || 0) + 1);
          return (
            artwork[
              Math.abs(Number(String(argument).replace(/\D/g, '')) || 0) %
                Math.max(1, artwork.length)
            ] || null
          );
        }
        if (channel === 'library:action') {
          launches++;
          return true;
        }
        if (['config:view', 'config:save'].includes(channel)) {
          Object.assign(config, argument);
          return config;
        }
        if (channel === 'folder:choose') return 'C:\\Games\\New folder';
        return values[channel] ?? [];
      });
    }
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_d, done) =>
      done({ cancel: true }),
    );
    const win = new BrowserWindow({
      width: Math.round(1700 / scale),
      height: Math.round(900 / scale),
      show: false,
      frame: false,
      webPreferences: {
        contextIsolation: true,
        preload,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.setZoomFactor(1);
    const errors = [];
    win.webContents.on('console-message', (_e, level, message) => {
      if (level === 3) errors.push(message);
    });
    await fs.mkdir(output, { recursive: true });
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await new Promise((r) => setTimeout(r, 2200));
    const js = async (code) => {
      try {
        return await win.webContents.executeJavaScript(code);
      } catch (error) {
        console.error('Renderer check failed:', code, errors);
        throw error;
      }
    };
    await js('document.fonts.ready');
    const displayFont = await js(
      `Array.from(document.fonts).find(f => f.family === 'Mamba Coolvetica')?.status`,
    );
    assert.equal(displayFont, 'loaded');
    const fonts = await js(
      `Array.from(document.fonts).filter(f=>f.family==='Mamba Interphases').map(f=>({weight:f.weight,status:f.status}))`,
    );
    assert.ok(
      fonts.some((f) => f.weight === '400' && f.status === 'loaded') &&
        fonts.some((f) => f.weight === '700' && f.status === 'loaded'),
    );
    const screenshot = async (name) => {
      await new Promise((r) => setTimeout(r, 180));
      await fs.writeFile(
        path.join(output, name + '.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
    };
    const ratioCheck = async () => {
      const ratios = await js(
        `Array.from(document.querySelectorAll('#game-list .library-cover.has-cover img')).map(img=>{const r=img.getBoundingClientRect();return {natural:img.naturalWidth/img.naturalHeight,rendered:r.width/r.height};})`,
      );
      assert.ok(ratios.every((r) => Math.abs(r.natural - r.rendered) < 0.01));
    };
    for (const [name, page] of [
      ['home', 'search'],
      ['library', 'library'],
      ['search', 'search'],
      ['settings', 'settings'],
      ['details', 'game'],
    ]) {
      await js('showPage(' + JSON.stringify(page) + ')');
      if (name === 'search')
        await js(
          `document.querySelector('#main-search').value='Review'; document.querySelector('#search-page').classList.add('has-results'); document.querySelector('#search-results').hidden=false; MambaDiscovery.update({items:${JSON.stringify(games)},total:6});`,
        );
      if (name === 'details')
        await js(`MambaExperience.openGame({id:'review',name:'Review game'},'search')`);
      await screenshot(name);
      if (name === 'library') {
        await ratioCheck();
        assert.equal(await js(`document.querySelector('.recent-view-all')`), null);
        const cardPoint = await js(
          `(()=>{const r=document.querySelector('#game-list .library-cover').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`,
        );
        win.webContents.sendInputEvent({ type: 'mouseMove', ...cardPoint });
        await screenshot('library-hover');
        assert.equal(
          await js(
            `(()=>{const c=document.querySelector('.library-card-caption');return Number(getComputedStyle(c).opacity)>.9 && getComputedStyle(c).zIndex==='1';})()`,
          ),
          true,
        );
        await js(`document.querySelector('.library-layout-toggle').click()`);
        const listGeometry = await js(
          `(()=>{const r=document.querySelector('#game-list .library-cover').getBoundingClientRect(),t=document.querySelector('.library-card-caption').getBoundingClientRect();return {view:document.querySelector('#game-list').dataset.view,visible:t.width>0 && t.x>=r.x && t.right<=r.right+1 && t.bottom<=r.bottom+1};})()`,
        );
        assert.equal(listGeometry.view, 'list');
        assert.equal(listGeometry.visible, true);
        await screenshot('library-list');
        await js(`document.querySelector('.library-layout-toggle').click()`);
        win.webContents.send('steam:library-state', {
          connected: true,
          accountName: 'Review account',
          count: 20,
        });
        await new Promise((r) => setTimeout(r, 50));
        assert.match(
          await js(`document.querySelector('.library-steam-status').textContent`),
          /Review account/,
        );
        await js(
          `document.querySelector('.library-manage').open=true; document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`,
        );
        assert.equal(await js(`document.querySelector('.library-manage').open`), false);

        assert.equal(await js(`document.querySelector('.library-manage').tagName`), 'DETAILS');
        assert.equal(
          await js(
            `document.querySelectorAll('#game-list .play-button, #game-list .favorite-button').length`,
          ),
          0,
        );
      }
      if (name === 'home') {
        assert.equal(
          await js(`getComputedStyle(document.querySelector('#search-version')).fontWeight`),
          '400',
        );
        assert.ok(await js(`!!document.querySelector('.sidebar-brand #search-version')`));
      }
      if (name === 'details') {
        const art = await js(
          `(()=>{const r=document.querySelector('.detail-art').getBoundingClientRect(),p=document.querySelector('.detail-hero').getBoundingClientRect();return{width:r.width,center:r.x+r.width/2,parentCenter:p.x+p.width/2};})()`,
        );
        assert.ok(art.width <= 900 && art.width > 0);
        assert.ok(Math.abs(art.center - art.parentCenter) < 2);
        assert.equal(
          await js(`getComputedStyle(document.querySelector('.detail-hero')).backgroundColor`),
          'rgba(0, 0, 0, 0)',
        );
        assert.equal(await js(`document.querySelector('.manage-installation').open`), false);
        assert.ok(
          await js(
            `[...document.querySelectorAll('.manage-installation button')].filter(b=>/Run setup/.test(b.textContent)).every(b=>b.getClientRects().length===0)`,
          ),
        );
        assert.equal(await js(`document.querySelectorAll('.detail-main-action').length`), 1);
      }
      if (name === 'settings')
        assert.equal(
          await js(`getComputedStyle(document.querySelector('#install-title')).fontWeight`),
          '700',
        );
    }
    await js(
      `document.querySelector('#game-downloads').open=true; document.querySelector('#game-downloads').scrollIntoView()`,
    );
    await screenshot('releases');
    await js(`document.querySelector('.shortcut-title').click()`);
    assert.equal(await js(`document.querySelector('.page:not([hidden])').id`), 'game-page');
    await js(`document.querySelector('.shortcut-thumbnail').click()`);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(launches, 1);
    await js(
      `document.querySelector('.sidebar-game-shortcut').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:160}))`,
    );
    assert.ok(await js(`!!document.querySelector('[role="menu"]')`));
    await js(`document.querySelector('[role="menu"]').remove()`);
    assert.ok([...artworkCalls.values()].every((count) => count === 1));
    await fs.writeFile(
      path.join(output, 'fourth-pass-checks.json'),
      JSON.stringify(
        {
          fonts,
          artworkCalls: [...artworkCalls],
          thumbnailLaunches: launches,
          detailsNavigation: true,
          contextMenu: true,
        },
        null,
        2,
      ),
    );
    const recentSizes = [];
    for (const height of [720, 1080]) {
      win.setSize(1280, height);
      await new Promise((r) => setTimeout(r, 250));
      recentSizes.push(
        await js(
          `(()=>{const groups=[...document.querySelectorAll('.sidebar-recent-group')];const settings=document.querySelector('#settings-open').getBoundingClientRect();return{height:innerHeight,counts:groups.map(g=>g.querySelectorAll('.sidebar-game-shortcut').length),bottom:groups.at(-1).getBoundingClientRect().bottom,settingsTop:settings.top};})()`,
        ),
      );
    }
    assert.ok(recentSizes[1].counts[0] > recentSizes[0].counts[0], JSON.stringify(recentSizes));
    assert.ok(
      recentSizes.every((s) => s.bottom <= s.settingsTop + 1),
      JSON.stringify(recentSizes),
    );
    await fs.writeFile(
      path.join(output, 'recent-sizes.json'),
      JSON.stringify(recentSizes, null, 2),
    );
    const checks = [];
    for (const [width, height] of [
      [1700, 900],
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
    ]) {
      win.setSize(Math.round(width / scale), Math.round(height / scale));
      for (const page of ['settings', 'library', 'search', 'game']) {
        await js('showPage(' + JSON.stringify(page) + ')');
        const c = await js(`(() => {
        const p=document.querySelector('.page:not([hidden])'), rail=document.querySelector('.sidebar').getBoundingClientRect(), s=getComputedStyle(document.querySelector('#library-open span'));
        return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,page:p.id,
          bodyFont:getComputedStyle(document.body).fontSize,rootZoom:getComputedStyle(document.documentElement).zoom,rootTransform:getComputedStyle(document.body).transform,labelFont:s.fontSize,labelsVisible:s.visibility==='visible'&&s.opacity==='1',railWidth:rail.width,
          overflow:p.scrollWidth>p.clientWidth,settingsWorkspace:document.querySelector('.settings-layout').getBoundingClientRect().width,
          settingsContent:document.querySelector('#settings-form').getBoundingClientRect().width,
          rawFolderEditor:!!document.querySelector('textarea#extra-game-folders'),folderRows:document.querySelectorAll('.folder-row').length};
      })()`);
        c.zoom = win.webContents.getZoomFactor();
        checks.push(c);
        await fs.writeFile(
          path.join(output, 'layout-checks.json'),
          JSON.stringify(checks, null, 2),
        );
        assert.equal(c.zoom, 1);
        assert.equal(c.bodyFont, '14px');
        assert.ok(c.labelsVisible && !c.overflow && !c.rawFolderEditor, JSON.stringify(c));
        assert.ok(c.railWidth >= 180 && c.railWidth <= 200);
        if (page === 'settings') {
          await screenshot('settings-' + width);
          if (width === 1700 && scale === 1)
            assert.ok(
              c.settingsWorkspace >= 1100 &&
                c.settingsWorkspace <= 1300 &&
                c.settingsContent >= 750 &&
                c.settingsContent <= 950,
              JSON.stringify(c),
            );
        }
      }
      for (let index = 0; index < 5; index++) {
        await js(
          `showPage('settings'); document.querySelectorAll('.settings-category')[${index}].click()`,
        );
        const clipped = await js(`(() => {
        const page=document.querySelector('#settings-backdrop'), bounds=page.getBoundingClientRect();
        return [...document.querySelectorAll('#settings-form button,#settings-form input:not([type="hidden"]),#settings-form select')]
          .filter(el => el.getClientRects().length && el.getBoundingClientRect().width > 0)
          .filter(el => {const r=el.getBoundingClientRect(); return r.left<bounds.left-1||r.right>bounds.right+1;}).map(el=>el.id||el.getAttribute('aria-label')||el.textContent);
      })()`);
        assert.deepEqual(clipped, [], 'Clipped settings controls at ' + width + ' DPI ' + scale);
      }
    }
    win.setSize(Math.round(1700 / scale), Math.round(900 / scale));
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    for (const [id, page] of [
      ['search-open', 'search-page'],
      ['library-open', 'library-page'],
      ['activity-open', 'activity-page'],
      ['settings-open', 'settings-backdrop'],
    ]) {
      await js('document.getElementById(' + JSON.stringify(id) + ').focus()');
      for (const type of ['keyDown', 'char', 'keyUp'])
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type,
          key: 'Enter',
          code: 'Enter',
          windowsVirtualKeyCode: 13,
          ...(type === 'char' ? { text: '\r' } : {}),
        });
      assert.equal(await js(`document.querySelector('.page:not([hidden])').id`), page);
      const point = await js(
        `(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`,
      );
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type,
          ...point,
          ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }),
        });
      assert.equal(await js(`document.querySelector('.page:not([hidden])').id`), page);
    }
    assert.equal(await js(`document.querySelector('.sidebar-toggle')`), null);
    await js(`MambaDesktop.configure({sidebarCollapsed:true})`);
    assert.equal(await js(`document.documentElement.dataset.sidebarCollapsed`), 'false');
    await js(`document.querySelector('#folder-list .folder-row button').click()`);
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(
      (await js(`document.querySelector('#extra-game-folders').value`)).includes('New folder'),
    );
    await js(`document.querySelector('#folder-list .folder-row button:last-child').click()`);
    assert.equal(await js(`document.querySelectorAll('.folder-row').length`), 1);
    await js(`document.querySelector('#browse-extra-folder').click()`);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(await js(`document.querySelectorAll('.folder-row').length`), 2);
    for (const [name, index] of [
      ['services', 1],
      ['appearance', 3],
    ]) {
      await js(
        `showPage('settings'); document.querySelectorAll('.settings-category')[${index}].click()`,
      );
      await screenshot(name);
    }
    const themeChecks = await js(
      `(async()=>{const checks=[]; for(const theme of MambaThemes.presets) { await MambaAppearance.configure({appearance:theme}); checks.push({name:theme.name,labels:getComputedStyle(document.querySelector('#library-open span')).visibility}); } return checks;})()`,
    );
    assert.ok(themeChecks.every((t) => t.labels === 'visible'));
    await fs.writeFile(path.join(output, 'renderer-errors.json'), JSON.stringify(errors, null, 2));
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, 'interaction-checks.json'),
      JSON.stringify(
        {
          keyboard: true,
          mouse: true,
          displayFont,
          permanentSidebar: true,
          folderAddRemove: true,
          folderChange: true,
          themes: themeChecks,
        },
        null,
        2,
      ),
    );
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
