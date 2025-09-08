// api/update.js — JavaScript (Node) — AP only

import { put } from "@vercel/blob";

// CFBD endpoints
const CFBD_RANKINGS = "https://api.collegefootballdata.com/rankings";
const CFBD_TEAMS_FBS = "https://api.collegefootballdata.com/teams/fbs";

// --- helpers ---
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * From CFBD /rankings response (array by weeks), pick the latest week
 * and return the ranks for the requested poll ("AP").
 */
function getLatestPollRanksFor(label, rankings) {
  if (!Array.isArray(rankings)) return { meta: { season: "", week: 0 }, ranks: [] };

  // find all entries that have the poll we want
  const candidates = rankings.filter((w) => {
    const p = Array.isArray(w.polls) ? w.polls : [];
    return p.some((pp) =>
      label === "AP" ? /AP/i.test(pp.poll) : /Coach/i.test(pp.poll)
    );
  });
  if (!candidates.length) return { meta: { season: "", week: 0 }, ranks: [] };

  // pick highest week number
  const latest = candidates.reduce((a, b) => ((a.week || 0) > (b.week || 0) ? a : b));
  const poll =
    (latest.polls || []).find((p) =>
      label === "AP" ? /AP/i.test(p.poll) : /Coach/i.test(p.poll)
    ) || null;

  return {
    meta: { season: latest.season, week: latest.week },
    ranks: Array.isArray(poll?.ranks) ? poll.ranks : [],
  };
}

/**
 * Build our JSON for the site (AP only).
 */
function buildApJson(rankings, colorMap) {
  const { meta, ranks } = getLatestPollRanksFor("AP", rankings);
  if (!ranks.length) return null;

  const teams = ranks.slice(0, 25).map((r) => {
    const key = norm(r.school);
    const color = colorMap.get(key) || null;
    return {
      rk: r.rank,
      team: r.school,
      rec: r.record || "",
      conf: r.conference || "",
      color, // hex like "#cc0000" (may be null)
    };
  });

  return {
    poll: "AP",
    season: meta.season,
    week: meta.week,
    lastUpdated: new Date().toISOString(),
    teams,
  };
}

// ---- API handler (REQUIRED EXPORT) ----
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.CFBD_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: "Missing CFBD_API_KEY" });
    }

    const year = new Date().getFullYear();

    // Fetch latest rankings
    const r = await fetch(`${CFBD_RANKINGS}?year=${year}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!r.ok) {
      const body = await r.text();
      return res.status(500).json({
        ok: false,
        error: "CFBD rankings fetch failed",
        status: r.status,
        body,
      });
    }
    const rankings = await r.json();

    // Fetch team colors (FBS)
    const tr = await fetch(`${CFBD_TEAMS_FBS}?year=${year}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!tr.ok) {
      const body = await tr.text();
      return res.status(500).json({
        ok: false,
        error: "CFBD teams fetch failed",
        status: tr.status,
        body,
      });
    }
    const teamsList = await tr.json();
    const colorMap = new Map();
    teamsList.forEach((t) => {
      const key = norm(t.school);
      const color = t.color || t.alt_color || null;
      if (key && color && !colorMap.has(key)) {
        colorMap.set(key, color.startsWith("#") ? color : `#${color}`);
      }
    });

    // Build AP JSON
    const apJson = buildApJson(rankings, colorMap);
    if (!apJson) {
      return res.status(500).json({ ok: false, error: "Could not build AP JSON" });
    }

    // Write to Blob Storage (public, fixed name)
    const apPut = await put("tcd-ap.json", JSON.stringify(apJson), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });

    return res.status(200).json({ ok: true, apUrl: apPut.url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
