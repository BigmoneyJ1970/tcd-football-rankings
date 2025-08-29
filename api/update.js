// api/update.js — Node runtime, writes color-enriched JSON to Vercel Blob
import { put } from "@vercel/blob";

const CFBD_RANKINGS = "https://api.collegefootballdata.com/rankings";
const CFBD_TEAMS_FBS = "https://api.collegefootballdata.com/teams/fbs";

// ----- helpers -----
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function buildJson(pollsArr, label, colorMap) {
  if (!Array.isArray(pollsArr) || !pollsArr.length) return null;

  // pick the latest poll object that matches the label ("AP" or "Coaches")
  const latest = pollsArr.reduce((a, b) => (a.week || 0) > (b.week || 0) ? a : b);
  const poll =
    latest.polls?.find((p) =>
      label === "AP" ? /AP/i.test(p.poll) : /Coach/i.test(p.poll)
    ) || null;

  if (!poll) return null;

  const teams = (poll.ranks || []).slice(0, 25).map((r) => {
    const key = norm(r.school);
    const color = colorMap.get(key) || null;
    return {
      rk: r.rank,
      team: r.school,
      rec: r.record || "",
      conf: r.conference || "",
      color, // <— NEW: hex like "#cc0000" (may be null if unknown)
    };
  });

  return {
    poll: label,
    season: latest.season,
    week: latest.week,
    lastUpdated: new Date().toISOString(),
    teams,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const year = new Date().getFullYear();

    // fetch rankings
    const r = await fetch(`${CFBD_RANKINGS}?year=${year}`, {
      headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` },
      cache: "no-store",
    });
    if (!r.ok) {
      const body = await r.text();
      return res
        .status(500)
        .json({ ok: false, error: "CFBD rankings fetch failed", status: r.status, body });
    }
    const rankings = await r.json();

    // fetch team colors (FBS list)
    const tr = await fetch(`${CFBD_TEAMS_FBS}?year=${year}`, {
      headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` },
      cache: "no-store",
    });
    if (!tr.ok) {
      const body = await tr.text();
      return res
        .status(500)
        .json({ ok: false, error: "CFBD teams fetch failed", status: tr.status, body });
    }
    const teamsList = await tr.json();
    const colorMap = new Map();
    teamsList.forEach((t) => {
      const key = norm(t.school);
      // prefer primary color, fall back to alt
      const color = t.color || t.alt_color || null;
      if (key && color && !colorMap.has(key)) colorMap.set(key, color.startsWith("#") ? color : `#${color}`);
    });

    const apJson = buildJson(rankings, "AP", colorMap);
    const coachesJson = buildJson(rankings, "Coaches", colorMap);
    if (!apJson || !coachesJson)
      return res.status(500).json({ ok: false, error: "Could not build poll JSON" });

    // write to Blob Storage (public, stable filenames)
    const [apPut, coachesPut] = await Promise.all([
      put("tcd-ap.json", JSON.stringify(apJson), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
      }),
      put("tcd-coaches.json", JSON.stringify(coachesJson), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
      }),
    ]);

    return res.json({
      ok: true,
      apUrl: apPut.url,
      coachesUrl: coachesPut.url,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
