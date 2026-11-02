const path = require('node:path');
const { Readable, Writable, addAbortSignal } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createReadStream } = require('node:fs');

class MegaDownload {
  constructor(uri, fileFactory = (url) => require('megajs').File.fromURL(url)) {
    this.uri = uri;
    this.fileFactory = fileFactory;
    this.nodes = new Map();
  }
  async info(signal) {
    signal?.throwIfAborted();
    const root = this.fileFactory(this.uri);
    await root.loadAttributes();
    signal?.throwIfAborted();
    this.nodes.clear();
    const files = [];
    const visit = (node, parent = '') => {
      if (!node.name || /[\\/\0]/.test(node.name) || ['.', '..'].includes(node.name))
        throw Error('MEGA returned an unsafe file name.');
      const name = parent ? parent + '/' + node.name : node.name;
      if (node.directory) {
        for (const child of node.children || []) visit(child, parent ? name : '');
      } else {
        const id = String(files.length);
        this.nodes.set(id, node);
        files.push({ id, name, size: node.size, url: 'https://mamba.invalid/mega/' + id });
      }
    };
    visit(root);
    return files;
  }
  async fetch(uri, { headers = {}, signal } = {}) {
    signal?.throwIfAborted();
    const node = this.nodes.get(path.posix.basename(new URL(uri).pathname));
    if (!node) throw Error('MEGA file is no longer available.');
    const range = /^bytes=(\d+)-$/.exec(headers.Range || '');
    const start = range ? Number(range[1]) : 0;
    const stream = node.download({ start, forceHttps: true, maxConnections: 1 });
    if (signal) addAbortSignal(signal, stream);
    return new Response(Readable.toWeb(stream), {
      status: start ? 206 : 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(node.size - start),
        ...(start ? { 'Content-Range': `bytes ${start}-${node.size - 1}/${node.size}` } : {}),
      },
    });
  }
  async verifyFile(filename, id, signal) {
    const node = this.nodes.get(String(id));
    await pipeline(
      createReadStream(filename),
      require('megajs').verify(node.key),
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
      { signal },
    );
  }
}

const unescapeHtml = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
async function pageText(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Error('Download host returned an oversized page.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function resolveOneFichier(uri, transport, signal) {
  let body;
  const cookies = new Map();
  for (let step = 0; step < 3; step++) {
    const response = await transport(uri, {
      signal,
      redirect: 'manual',
      ...(body !== undefined ? { method: 'POST', body } : {}),
      headers: {
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
    });
    for (const cookie of response.headers.getSetCookie?.() || []) {
      const pair = cookie.split(';')[0],
        index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const location = response.headers.get('location');
    let candidate = location;
    if (!candidate) {
      if (!response.ok)
        throw Object.assign(Error(`1fichier request failed (${response.status}).`), {
          status: response.status,
        });
      const html = await pageText(response);
      if (/captcha|cf-chl-|name=["']pass["']|must wait|wait \d+|download limit/i.test(html))
        throw Error(
          '1fichier requires a CAPTCHA, password, or waiting period. Open the source in your browser or choose another host.',
        );
      const links = [
        ...html.matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi),
      ];
      candidate = links.find(
        (link) => /\bok\b/.test(link[1] + link[3]) || /click here to download/i.test(link[4]),
      )?.[2];
      if (!candidate) {
        body = new URLSearchParams();
        if (step > 0) {
          const form = /<form\b[^>]*>([\s\S]*?)<\/form>/i.exec(html)?.[1];
          if (!form) break;
          for (const input of form.matchAll(/<input\b[^>]*>/gi)) {
            const name = /\bname=["']([^"']+)["']/i.exec(input[0])?.[1];
            const value = /\bvalue=["']([^"']*)["']/i.exec(input[0])?.[1] || '';
            if (name && name !== 'save') body.set(name, unescapeHtml(value));
          }
        }
        continue;
      }
    } else await response.body?.cancel();
    const url = new URL(unescapeHtml(candidate), uri);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !/^[a-z0-9-]+\.(?:1fichier|desfichiers)\.com$/i.test(url.hostname)
    )
      throw Error('1fichier returned an unexpected download destination.');
    return url.href;
  }
  throw Error(
    '1fichier did not provide a direct file. Open the source in your browser or choose another host.',
  );
}
module.exports = { MegaDownload, resolveOneFichier };
