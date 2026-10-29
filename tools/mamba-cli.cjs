#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const help = `MambaCLI

  mamba search <name|appid|Steam URL>  One Steam-backed result per game
  mamba info <name|appid>             Show available game releases
  mamba download <steam:id|appid>     Download the best compatible release
  mamba resume <job-id>               Resume a paused CLI download
  mamba jobs                         List CLI downloads
  mamba sync                         Refresh configured sources
  mamba config [list|path]            Show settings or their location
  mamba config get <key>              Read a setting (secrets are hidden)
  mamba config set <key> <value>      Set text, a number, boolean or JSON
  mamba config unset <key>            Remove a setting
  mamba sources [list|add|remove] [URL]
  mamba -help                        Show commands

Add --json for structured output. Cached searches reuse the launcher's catalog.
Downloads run in this terminal; Ctrl+C pauses active transfers and preserves saved files.
`;
async function dataDirectory() {
  if (process.env.MAMBA_DATA_DIR) return path.resolve(process.env.MAMBA_DATA_DIR);
  const root = path.resolve(__dirname, '..');
  const appData = process.env.APPDATA || path.join(require('node:os').homedir(), '.config');
  const locations = [path.join(appData, 'minimal-downloader'), path.join(appData, 'Mamba')];
  if (!root.includes('app.asar')) locations.unshift(path.join(root, 'data'));
  for (const directory of locations)
    if (
      await fs.access(path.join(directory, 'config.json')).then(
        () => true,
        () => false,
      )
    )
      return directory;
  return path.join(appData, 'Mamba');
}
function redact(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /key|password|token|secret/i.test(key) ? (item ? '[configured]' : '') : item,
    ]),
  );
}
async function steamSearch(directory, catalog, query) {
  const { GameIdentity } = require('../src/core/game-identity.cjs');
  const { SteamSearch } = require('../src/core/steam-search.cjs');
  const identity = new GameIdentity(directory);
  await identity.load();
  const search = new SteamSearch(directory, catalog, identity);
  await search.load();
  catalog.steamSearch = search;
  return findGames(search, query);
}
async function findGames(search, query) {
  const cached = search.localResults(query);
  if (cached.items.length && !/^(?:steam:|appid:)?\d+$/.test(query))
    return { ...cached, pending: false };
  const result = await search.search(query);
  if (!result.pending) return result;
  await search.searches.get(query.trim().replace(/\s+/g, ' ').toLowerCase())?.work;
  return { ...search.localResults(query), pending: false };
}
async function main(args = process.argv.slice(2)) {
  const json = args.includes('--json');
  args = args.filter((arg) => arg !== '--json');
  const [command, ...rest] = args;
  if (!command || ['-help', '--help', 'help', '-h'].includes(command)) {
    console.log(help);
    return;
  }
  if (
    !['search', 'info', 'download', 'resume', 'jobs', 'sync', 'config', 'sources'].includes(command)
  )
    throw Error('Unknown command. Run mamba -help.');
  const directory = await dataDirectory();
  const print = (value) => console.log(JSON.stringify(value, null, json ? 2 : undefined));
  if (command === 'jobs') {
    const jobs = JSON.parse(
      await fs.readFile(path.join(directory, 'cli/downloads.json'), 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '[]';
        throw error;
      }),
    );
    if (!Array.isArray(jobs)) throw Error('The CLI download queue is invalid.');
    if (json)
      print(
        jobs.map(({ id, name, status, progress, message }) => ({
          id,
          name,
          status,
          progress,
          message,
        })),
      );
    else for (const job of jobs) console.log(`${job.id}\t${job.status}\t${job.name}`);
    return;
  }
  const file = path.join(directory, 'config.json');
  const config = JSON.parse(
    await fs.readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '{}';
      throw error;
    }),
  );
  config.sourceUrls ||= [];
  const save = async () => {
    require('../src/core/config-transfer.cjs').validateSettings(config);
    await require('../src/core/catalog.cjs').atomicJson(file, config);
    if (json) print({ saved: true });
    else console.log('Settings saved.');
  };
  if (command === 'config') {
    const [action = 'list', key, ...words] = rest;
    if (action === 'path') {
      console.log(file);
      return;
    }
    if (action === 'list') {
      print(redact(config));
      return;
    }
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key))
      throw Error('Provide a valid setting name.');
    if (action === 'get') {
      if (!Object.hasOwn(config, key)) throw Error('Unknown setting.');
      print(redact({ [key]: config[key] })[key]);
      return;
    }
    if (action === 'set') {
      if (!words.length) throw Error('Provide a setting value.');
      const text = words.join(' ');
      try {
        config[key] = JSON.parse(text);
      } catch {
        config[key] = text;
      }
    } else if (action === 'unset') delete config[key];
    else throw Error('Use config list, path, get, set or unset.');
    await save();
    return;
  }
  if (command === 'sources') {
    const [action = 'list', url] = rest;
    if (action === 'list') {
      print(config.sourceUrls);
      return;
    }
    if (!url || !['http:', 'https:'].includes(new URL(url).protocol))
      throw Error('Provide an HTTP or HTTPS source URL.');
    if (action === 'add') config.sourceUrls = [...new Set([...config.sourceUrls, url])];
    else if (action === 'remove')
      config.sourceUrls = config.sourceUrls.filter((item) => item !== url);
    else throw Error('Use sources list, add or remove.');
    await save();
    return;
  }
  if (!rest.length && command !== 'sync')
    throw Error('Provide a game name, Steam AppID or job ID.');
  if (['search', 'info', 'sync'].includes(command)) {
    const { Catalog } = require('../src/core/catalog.cjs');
    const catalog = new Catalog(directory, async () => config);
    try {
      await catalog.load({ lazyIndex: true });
      if (command === 'sync' || !catalog.games.length) {
        if (!config.sourceUrls.length)
          throw Error('Add sources in Mamba or with mamba sources add <URL>.');
        console.error('Refreshing sources…');
        await catalog.sync();
      }
      if (!catalog.games.length && catalog.state.phase === 'error')
        throw Error(catalog.state.message);
      if (command === 'sync') {
        if (json) print({ releases: catalog.games.length });
        else console.log(catalog.games.length + ' releases available.');
        return;
      }
      const result = await steamSearch(directory, catalog, rest.join(' '));
      if (json) print(result);
      else if (!result.items.length) console.log('No matching Steam-backed games found.');
      else
        for (const game of result.items) {
          console.log(`${game.id}\t${game.name}`);
          if (command === 'info')
            for (const option of game.options || [])
              console.log(`  ${option.gameId}\t${option.release || option.name || ''}`);
        }
      return;
    } finally {
      clearTimeout(catalog.retryTimer);
      catalog.controller?.abort();
    }
  }
  if (!config.downloadPath || !path.isAbsolute(config.downloadPath))
    throw Error('Set your Games folder with mamba config set downloadPath <absolute-path>.');
  const { BackgroundService } = require('../src/core/background-service.cjs');
  let selectedJob, lastStatus;
  const service = new BackgroundService((channel, jobs) => {
    if (channel !== 'downloads:changed') return;
    const job = jobs.find((item) => item.id === selectedJob);
    if (job && job.status !== lastStatus) {
      lastStatus = job.status;
      console.error(`${job.status}: ${job.message || job.name}`);
    }
  });
  const interrupt = () => {
    if (selectedJob)
      service.downloads.pause(selectedJob).catch((error) => console.error(error.message));
  };
  try {
    await service.initialize({
      directory: path.join(directory, 'cli'),
      catalogDirectory: directory,
      config,
      headless: true,
      resourcesPath: __dirname.includes('app.asar') ? path.resolve(__dirname, '../..') : undefined,
    });
    if (command === 'resume') {
      selectedJob = rest[0];
      await service.downloads.retry(selectedJob);
    } else {
      if (!service.catalog.games.length) await service.catalog.sync();
      let id = rest[0];
      if (/^(?:steam:|appid:)?\d+$/.test(id) || !service.catalog.getGame(id)) {
        const result = await findGames(service.steamSearch, rest.join(' '));
        if (result.items.length !== 1)
          throw Error('Search first, then download using the game’s steam:<appid> ID.');
        id = result.items[0].id;
      }
      selectedJob = await service.downloads.startBest(id);
    }
    process.on('SIGINT', interrupt);
    console.error('Download: ' + selectedJob);
    while (true) {
      const job = service.downloads.snapshot().find((item) => item.id === selectedJob);
      if (!job) throw Error('Download disappeared from the queue.');
      if (['completed', 'needs-setup', 'failed', 'cancelled', 'paused'].includes(job.status)) {
        if (json) print(job);
        else console.log(job.message || job.status);
        if (job.status === 'failed') throw Error(job.message || 'Download failed.');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    await service.call('shutdown');
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main, dataDirectory, findGames };
