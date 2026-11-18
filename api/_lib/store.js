/*
 * Shared helpers for the analytics API: Upstash Redis over REST (no dependencies),
 * day keys in India time, CORS for the two public sites, and body parsing.
 * Files in api/_lib are not exposed as endpoints by Vercel.
 */
const RETENTION_SECONDS = 100 * 24 * 3600; // keep daily stats ~100 days
const TIME_ZONE = 'Asia/Kolkata';
const ALLOWED_ORIGINS = [
  'https://sunotes-sigma.vercel.app',
  'https://rohityadav6014.github.io',
];

function storeConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

/** Run several Redis commands in one request. Returns an array of results. */
async function pipeline(commands) {
  const cfg = storeConfig();
  if (!cfg) throw new Error('storage not configured');
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`storage error ${res.status}`);
  const out = await res.json();
  return out.map(r => (r && 'result' in r ? r.result : null));
}

/** 'YYYY-MM-DD' in India time, `offsetDays` days before today. */
function dayKey(offsetDays = 0, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(now - offsetDays * 86400000));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, X-Admin-Email');
  }
}

/** Request body as text (Vercel may have parsed it already). */
async function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 32 * 1024) throw new Error('body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (data === undefined) { res.end(); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

module.exports = { pipeline, dayKey, cors, readBody, send, storeConfig, RETENTION_SECONDS };
