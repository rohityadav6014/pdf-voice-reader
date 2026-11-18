/*
 * GET /api/stats?days=7 — analytics summary for the admin panel.
 * Requires the X-Admin-Key header to match the ADMIN_PASSWORD environment variable
 * (set by the site owner in Vercel). Repeated wrong passwords are locked out for 15 minutes.
 */
const crypto = require('crypto');
const { pipeline, dayKey, cors, send, storeConfig } = require('./_lib/store');

const DIMENSIONS = ['country', 'device', 'browser', 'referrer', 'path',
  'file_type', 'listen_language', 'language_choice', 'download_format', 'speed', 'skip_type', 'error_type'];
const MAX_FAILURES = 10;

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Upstash returns HGETALL as [field, value, field, value, …]. */
function pairs(flat) {
  const out = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]) || 0;
  else if (flat && typeof flat === 'object') for (const [k, v] of Object.entries(flat)) out[k] = Number(v) || 0;
  return out;
}

function addInto(target, src) {
  for (const [k, v] of Object.entries(src)) target[k] = (target[k] || 0) + v;
}

const top = (obj, n = 10) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return send(res, 204);
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });

  const password = process.env.ADMIN_PASSWORD;
  const missing = [];
  if (!password) missing.push('ADMIN_PASSWORD');
  if (!storeConfig()) missing.push('storage');
  if (missing.length) return send(res, 503, { error: 'setup', missing });

  // Lock out repeated wrong guesses (keyed by a hash of the caller's network address, kept 15 min).
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const failKey = `authfail:${sha(ip).toString('hex').slice(0, 16)}`;
  const [failures] = await pipeline([['GET', failKey]]).catch(() => [0]);
  if (Number(failures) >= MAX_FAILURES) return send(res, 429, { error: 'too many attempts, try again in 15 minutes' });

  const given = req.headers['x-admin-key'];
  if (!given || !sameSecret(given, password)) {
    await pipeline([['INCR', failKey], ['EXPIRE', failKey, 900]]).catch(() => {});
    await sleep(700);
    return send(res, 401, { error: 'wrong password' });
  }

  const url = new URL(req.url, 'http://x');
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 7, 1), 90);
  const dayList = Array.from({ length: days }, (_, i) => dayKey(days - 1 - i)); // oldest → newest

  const now = Date.now();
  const cmds = [
    ['ZREMRANGEBYSCORE', 'active', 0, now - 5 * 60 * 1000],
    ['ZCARD', 'active'],
    ['PFCOUNT', ...dayList.map(d => `uv:${d}`)],
  ];
  for (const d of dayList) {
    cmds.push(['HGETALL', `ev:${d}`], ['PFCOUNT', `uv:${d}`]);
    for (const dim of DIMENSIONS) cmds.push(['HGETALL', `dim:${d}:${dim}`]);
  }

  let r;
  try {
    r = await pipeline(cmds);
  } catch {
    return send(res, 503, { error: 'storage unavailable' });
  }

  const activeNow = Number(r[1]) || 0;
  const uniqueVisitors = Number(r[2]) || 0;
  const totals = {};
  const breakdowns = Object.fromEntries(DIMENSIONS.map(d => [d, {}]));
  const daily = [];
  let i = 3;
  for (const d of dayList) {
    const ev = pairs(r[i++]);
    const visitors = Number(r[i++]) || 0;
    addInto(totals, ev);
    for (const dim of DIMENSIONS) addInto(breakdowns[dim], pairs(r[i++]));
    daily.push({
      date: d,
      visitors,
      page_views: ev.page_view || 0,
      files_opened: ev.open_file || 0,
      listening: ev.start_listening || 0,
    });
  }

  return send(res, 200, {
    range: { days, from: dayList[0], to: dayList[dayList.length - 1], timeZone: 'Asia/Kolkata' },
    activeNow,
    uniqueVisitors,
    totals,
    daily,
    topActions: top(totals, 30),
    breakdowns: Object.fromEntries(DIMENSIONS.map(d => [d, top(breakdowns[d])])),
  });
};
