#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const { BackgroundService } = require('../src/core/background-service.cjs');
const help = `MambaCLI\n\n  mamba -help                  Show commands\n  mamba search <words>         Search configured sources\n  mamba download <release-id>  Download a release\n  mamba jobs                   List CLI downloads\n\nMambaCLI uses Mamba's configuration and keeps its own download queue.\n`;
async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || ['-help', '--help', 'help', '-h'].includes(command)) {
    console.log(help);
    return;
  }
  if (!['search', 'download', 'jobs'].includes(command))
    throw Error('Unknown command. Run mamba -help.');
  const root = path.resolve(__dirname, '..');
  const configDir = process.env.MAMBA_DATA_DIR || path.join(root, 'data');
  if (command === 'jobs') {
    const jobs = JSON.parse(
      await fs.readFile(path.join(configDir, 'cli', 'downloads.json'), 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '[]';
        throw error;
      }),
    );
    if (!Array.isArray(jobs)) throw Error('The CLI download queue is invalid.');
    for (const job of jobs) console.log(`${job.id}\t${job.status}\t${job.name}`);
    return;
  }
  if (!rest.length) throw Error('Provide a search term or release ID.');
  const config = JSON.parse(await fs.readFile(path.join(configDir, 'config.json'), 'utf8'));
  config.sourceUrls ||= [];
  if (!config.downloadPath || !path.isAbsolute(config.downloadPath))
    throw Error('Set an absolute Games folder in Mamba first.');
  const service = new BackgroundService((channel, data) => {
    if (command === 'download' && channel === 'downloads:changed') {
      const job = data.find((item) => item.id === selectedJob);
      if (job && job.status !== lastStatus) {
        lastStatus = job.status;
        console.log(`${job.status}: ${job.message || job.name}`);
      }
    }
  });
  let selectedJob, lastStatus;
  try {
    await service.initialize({ directory: path.join(configDir, 'cli'), config, headless: true });
    await service.catalog.sync();
    if (service.catalog.state.phase === 'error' && !service.catalog.games.length)
      throw Error(service.catalog.state.message || 'Source synchronization failed.');
    if (command === 'search') {
      const result = service.catalog.search(rest.join(' '), 0);
      for (const game of result.items || []) console.log(`${game.id}\t${game.name}`);
      if (!result.items?.length) console.log('No matching releases found.');
      return;
    }
    selectedJob = await service.downloads.startBest(rest[0]);
    console.log('Download: ' + selectedJob);
    while (true) {
      const job = service.downloads.snapshot().find((item) => item.id === selectedJob);
      if (
        !job ||
        ['completed', 'needs-setup', 'failed', 'cancelled', 'paused'].includes(job.status)
      ) {
        if (!job) throw Error('Download disappeared from the queue.');
        if (job.status === 'failed') throw Error(job.message || 'Download failed.');
        console.log(job?.message || job?.status || 'Download unavailable.');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    await service.call('shutdown');
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
