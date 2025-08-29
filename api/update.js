// api/update.js  (Node runtime)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
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

    function buildJson(arr, label, re) {
      if (!Array.isArray(arr) || !arr.length) return null;
      // pick the highest week
      const latest = arr.reduce((a, b) =>
        (a.week ?? 0) >= (b.week ?? 0) ? a : b
      );
      const poll = latest.polls?.find((p) => re.test(p.poll));
      if (!poll) return null;

      const teams =
        (poll.ranks ?? []).slice(0, 25).map((rk) => ({
          rk: rk.rank,
          team: rk.school,
          rec: rk.record ?? '',
          conf: rk.conference ?? '',
        })) ?? [];

      return {
        poll: label,
        season: latest.season,
        week: latest.week,
        lastUpdated: new Date().toISOString(),
        teams,
      };
    }

    const ap = buildJson(data, 'AP', /AP/i);
    const coaches = buildJson(data, 'Coaches', /Coach/i);

    // Use Vercel Blob from a Node function
    const { put } = await import('@vercel/blob');

    let apUrl = null;
    let coachesUrl = null;

    if (ap) {
      const out = await put('tcd-ap.json', JSON.stringify(ap), {
        access: 'public',
        contentType: 'application/json',
      });
      apUrl = out.url;
    }

    if (coaches) {
      const out = await put('tcd-coaches.json', JSON.stringify(coaches), {
        access: 'public',
        contentType: 'application/json',
      });
      coachesUrl = out.url;
    }

    return res.status(200).json({ ok: true, apUrl, coachesUrl });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
