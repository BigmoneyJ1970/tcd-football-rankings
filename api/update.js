import { put } from "@vercel/blob";

const CFBD_URL = "https://api.collegefootballdata.com/rankings";

function buildJson(arr, pollLabel) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const latest = arr.reduce((a, b) => (a.week || 0) > (b?.week || 0) ? a : b);
  if (!latest?.polls) return null;

  const poll = latest.polls.find(p =>
    (pollLabel === "AP" && /AP/i.test(p.poll)) ||
    (pollLabel === "Coaches" && /Coach/i.test(p.poll))
  );
  if (!poll) return null;

  const teams = (poll.ranks || []).slice(0, 25).map(r => ({
    rk: r.rank,
    team: r.school,
    rec: r.record || ""
  }));

  return {
    poll: pollLabel,
    season: latest.season,
    week: latest.week,
    lastUpdated: new Date().toISOString(),
    teams
  };
}

export default async function handler(req, res) {
  try {
    const year = new Date().getFullYear();
    const r = await fetch(`${CFBD_URL}?year=${year}`, {
      headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` }
    });
    if (!r.ok) return res.status(200).json({ ok: false, error: "CFBD fetch failed" });

    const data = await r.json();
    const ap = buildJson(data, "AP");
    const coaches = buildJson(data, "Coaches");

    const out = { ok: true };
    if (ap) {
      const { url } = await put("tcd-ap.json", JSON.stringify(ap), {
        access: "public",
        contentType: "application/json"
      });
      out.apUrl = url;
    }
    if (coaches) {
      const { url } = await put("tcd-coaches.json", JSON.stringify(coaches), {
        access: "public",
        contentType: "application/json"
      });
      out.coachesUrl = url;
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
