const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
async function hashFile(file, algorithm = 'sha256', signal) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyFile(file, metadata, signal) {
  signal?.throwIfAborted();
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Verification requires a regular file.');
  if (metadata.size > 0 && stat.size !== metadata.size)
    throw Object.assign(Error('Downloaded file has an incorrect size.'), {
      code: 'FILE_INVALID',
      file,
    });
  // Only compare expected digests supplied by the source. A local digest is not authenticity proof.
  for (const algorithm of ['sha256', 'sha1', 'md5']) {
    const expected = metadata[algorithm];
    if (!expected) continue;
    const length = { sha256: 64, sha1: 40, md5: 32 }[algorithm];
    if (!new RegExp(`^[a-f0-9]{${length}}$`, 'i').test(expected))
      throw Error('Source supplied an invalid expected checksum.');
    if ((await hashFile(file, algorithm, signal)) !== expected.toLowerCase())
      throw Object.assign(Error('Downloaded file checksum does not match the source.'), {
        code: 'FILE_INVALID',
        file,
      });
  }
}
async function testArchive(file, { signal, password = '' } = {}) {
  const { run, sevenZipPath } = require('./library.cjs');
  try {
    await run(
      sevenZipPath(),
      ['t', `-p${password || '__MAMBA_NO_ARCHIVE_PASSWORD__'}`, '--', file],
      { signal },
    );
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const passwordError = /password|encrypted/i.test(cause.message);
    throw Object.assign(
      Error(
        passwordError
          ? 'Archive password is incorrect. Check Settings.'
          : 'Archive integrity check failed.',
      ),
      { cause, code: passwordError ? 'ARCHIVE_PASSWORD' : 'ARCHIVE_INVALID', file },
    );
  }
}
async function verifyDownloads(entries, options, notify = () => {}) {
  const { archiveStarts } = require('./library.cjs');
  for (let i = 0; i < entries.length; i++) {
    notify(`Checking file ${i + 1} of ${entries.length}`);
    await verifyFile(entries[i].target, entries[i], options.signal);
  }
  const archives = archiveStarts(entries.map((entry) => entry.target));
  for (let i = 0; i < archives.length; i++) {
    notify(`Checking archive integrity ${i + 1} of ${archives.length}`);
    await testArchive(archives[i], options);
  }
  return new Set(archives);
}
module.exports = { hashFile, verifyFile, testArchive, verifyDownloads };
