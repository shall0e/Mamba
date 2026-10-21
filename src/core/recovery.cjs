const os = require('node:os');
const { safeMessage } = require('./issues.cjs');
const MAX_RETRIES = 5;
function retryAfter(value, now = Date.now()) {
  if (!value) return 0;
  return /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Math.max(0, Date.parse(value) - now) || 0;
}
function classify(error) {
  const causes = [];
  let item = error;
  while (item && causes.length < 8) {
    causes.push(item);
    item = item.cause;
  }
  const text = causes.map((e) => `${e.code || ''} ${e.message || ''}`).join(' ');
  const status = causes.find((e) => e.status)?.status;
  const wait = Math.max(0, ...causes.map((e) => Number(e.retryAfter) || 0));
  if (
    /ENOSPC|disk.+(?:space|full)|EACCES|EPERM|unsafe|escapes|colliding|archive password|incorrect password|wrong password|ARCHIVE_PASSWORD/i.test(
      text,
    )
  )
    return { action: 'attention' };
  if (error.transfer && [401, 403, 404, 410].includes(status))
    return { action: 'refresh', delay: wait };
  if ([401, 403].includes(status) || /api key|unauthori|credential/i.test(text))
    return { action: 'settings' };
  if (
    status === 416 ||
    /resume response|ignored download resume|changed content|exceeds expected size/i.test(text)
  )
    return { action: 'restart-file' };
  if (
    [408, 429, 500, 502, 503, 504].includes(status) ||
    causes.some((e) => e.retryable) ||
    /network|terminated|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_|timed? ?out/i.test(
      text,
    )
  )
    return { action: 'resume', delay: wait };
  return { action: 'attention' };
}
function backoff(attempt, minimum = 0, random = Math.random) {
  return Math.max(
    minimum,
    Math.min(120000, 2000 * 3 ** Math.max(0, attempt - 1)) * (0.8 + random() * 0.4),
  );
}
function online() {
  let interfaces;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    return true;
  }
  return Object.values(interfaces)
    .flat()
    .some((info) => info && !info.internal && info.address !== '0.0.0.0');
}
function checkpoint(enabled = false) {
  return {
    version: 1,
    enabled,
    phase: 'queued',
    lastCompletedPhase: null,
    retryCount: 0,
    nextRetryAt: null,
    payloadCommitted: false,
  };
}
function record(job, action, error, secrets = []) {
  job.recovery.history = [
    ...(job.recovery.history || []),
    {
      at: new Date().toISOString(),
      action,
      message: safeMessage(error?.message || error, secrets),
    },
  ].slice(-20);
}
module.exports = { MAX_RETRIES, retryAfter, classify, backoff, online, checkpoint, record };
