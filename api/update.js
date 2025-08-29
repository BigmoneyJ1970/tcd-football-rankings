// api/update.js — Node runtime (not Edge)
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const year = new Date().getFullYear();
    const url = `https://api.collegefootballdata.com/rankings?year=${year}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` },
    });

    if (!r.ok) {
      const body = await r.text();
      return res
        .status(500)
        .json({ ok: false, error: 'CFBD fetch failed', status: r.status, body });
    }

    const data = await r.json();

    // Build two payloads (AP + Coaches)
    const ap = buildJson(data, /^(AP|AP Top 25)$/i);
    const coaches = buildJson(data, /(Coach|Coaches)/i);

    // Upload to Blob with STABLE file names (no random suffix)
    let apUrl = null;
    let coachesUrl = null;

    if (ap) {
      const apPut = await put('tcd-ap.json', JSON.stringify(ap), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false, // <-- keep filename stable
      });
      apUrl = apPut.url;
    }

    if (coaches) {
      const coachesPut = await put('tcd-coaches.json', JSON.stringify(coaches), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false, // <-- keep filename stable
      });
      coachesUrl = coachesPut.url;
    }

    return res.status(200).json({ ok: true, apUrl, coachesUrl });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err) });
  }
}

/**
 * Select latest season/week and extract a compact JSON for a poll.
 * @param {Array} arr - CFBD rankings array
 * @param {RegExp} pollLabel - regex to match poll label (e.g., AP / Coaches)
 * @returns {object|null}
 */
function buildJson(arr, pollLabel) {
  if (!Array.isArray(arr) || !arr.length) return null;

  // pick the entry with the highest (season, week)
  const latest = arr.reduce((a, b) => {
    const aw = a.week ?? 0;
    const bw = b.week ?? 0;
    if (a.season !== b.season) return a.season > b.season ? a : b;
    return aw >= bw ? a : b;
  });

  if (!latest || !latest.polls) return null;

  const poll = latest.polls.find((p) => pollLabel.test(p.poll));
  if (!poll || !poll.ranks) return null;

  const teams = (poll.ranks || []).slice(0, 25).map((r) => ({
    rk: r.rank,
    team: r.school,
    rec: r.record || '',
    conf: r.conference || '',
  }));

  return {
    poll: poll.poll,
    season: latest.season,
    week: latest.week,
    lastUpdated: new Date().toISOString(),
    teams,
  };
}

