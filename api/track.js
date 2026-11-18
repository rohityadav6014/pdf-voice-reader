/*
 * POST /api/track — receives a small batch of anonymous events from the site.
 * Stores daily counters only: event counts, unique visitors (HyperLogLog of a random
 * per-browser id), "active now", and a few breakdowns. No IP address or file content is kept.
 */
const { pipeline, dayKey, cors, readBody, send, storeConfig, RETENTION_SECONDS } = require('./_lib/store');

const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const ID_RE = /^[a-z0-9]{8,32}$/;
const MAX_EVENTS = 50;

// Event parameters that become breakdowns in the admin panel: "event.param" → breakdown name.
const BREAKDOWNS = {
  'open_file.file_type': 'file_type',
  'start_listening.language': 'listen_language',
  'change_language.language': 'language_choice',
  'download_notes.format': 'download_format',
  'change_speed.speed': 'speed',
  'skip.type': 'skip_type',
  'error.type': 'error_type',
};
const PAGE_DIMENSIONS = ['country', 'device', 'browser', 'referrer', 'path'];

const clean = v => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9._\-/ ]/g, '').trim().slice(0, 40) || 'unknown';

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return send(res, 204);
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  if (!storeConfig()) return send(res, 204); // analytics storage not connected yet

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'bad body' });
  }
  const vid = String(body.vid || '');
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  if (!ID_RE.test(vid) || !events.length) return send(res, 400, { error: 'bad payload' });

  const day = dayKey();
  const now = Date.now();
  const touched = new Set();
  const cmds = [];
  const hincr = (key, field) => { cmds.push(['HINCRBY', key, field, 1]); touched.add(key); };

  cmds.push(['PFADD', `uv:${day}`, vid]);
  touched.add(`uv:${day}`);
  cmds.push(['ZADD', 'active', now, vid]);
  cmds.push(['ZREMRANGEBYSCORE', 'active', 0, now - 5 * 60 * 1000]);

  for (const e of events) {
    const name = String(e && e.n || '');
    if (!NAME_RE.test(name)) continue;
    hincr(`ev:${day}`, name);
    const p = e.p && typeof e.p === 'object' ? e.p : {};
    if (name === 'page_view') {
      p.country = req.headers['x-vercel-ip-country'] || 'unknown';
      for (const d of PAGE_DIMENSIONS) hincr(`dim:${day}:${d}`, clean(p[d]));
    }
    for (const [key, dim] of Object.entries(BREAKDOWNS)) {
      const [evName, param] = key.split('.');
      if (evName === name && p[param] != null) hincr(`dim:${day}:${dim}`, clean(p[param]));
    }
  }
  for (const key of touched) cmds.push(['EXPIRE', key, RETENTION_SECONDS]);

  try {
    await pipeline(cmds);
  } catch {
    return send(res, 503, { error: 'storage unavailable' });
  }
  return send(res, 204);
};
