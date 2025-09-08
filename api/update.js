// api/update.js — JavaScript (Node) — AP only (with records join)

import { put } from "@vercel/blob";

// CFBD endpoints
const CFBD_RANKINGS = "https://api.collegefootballdata.com/rankings";
const CFBD_TEAMS_FBS = "https://api.collegefootballdata.com/teams/fbs";
const CFBD_RECORDS  = "https://api.collegefootballdata.com/records";

// --- helpers ---
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Pick latest week for a poll and return its ranks. */
function getLatestPollRanksFor(label, rankings) {
  if (!Array.isArray(rankings)) return { meta: { season: "", week: 0 }, ranks: [] };

  const candidates = rankings.filter((w) =>
    Array.isArray(w.polls) &&
    w.polls.some((pp) => (label === "AP" ? /AP/i.test(pp.poll) : /Coach/i.test(pp.poll)))
  );
  if (!candidates.length) return { meta: { season: "", week: 0 }, ranks: [] };

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

/** Build a map: schoolKey -> "wins-losses[-ties]" from CFBD /records */
function buildRecordMap(records) {
  const map = new Map();
  if (!Array.isArray(records)) return map;

  records.forEach((row) => {
    // CFBD /records uses `team` for the school name; totals are in row.total
    const key = norm(row.team);
    const w = row?.total?.wins ?? null;
    const l = row?.total?.losses ?? null;
    const t = row?.total?.ties ?? 0;
    if (key && w !== null && l !== null) {
      const rec = `${w}-${l}${t > 0 ? `-${t}` : ""}`;
      if (!map.has(key)) map.set(key, rec);
    }
  });
  return map;
}

/** Build our AP JSON, joining in colors and records. */
function buildApJson(rankings, colorMap, recordMap) {
  const { meta, ranks } = getLatestPollRanksFor("AP", rankings);
  if (!ranks.length) return null;

  const teams = ranks.slice(0, 25).map((r) => {
    const key = norm(r.school);
    const color = colorMap.get(key) || null;

    // Prefer r.record, otherwise use joined record from /records
    const joinedRec = recordMap.get(key) || "";
    const rec = r.record || joinedRec || "";

    return {
      rk: r.rank,
      team: r.school,
      rec,
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
    const headers = { Authorization: `Bearer ${apiKey}` };

    // 1) Rankings (for AP list)
    const r = await fetch(`${CFBD_RANKINGS}?year=${year}`, { headers, cache: "no-store" });
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: "CFBD rankings fetch failed",
        status: r.status,
        body: await r.text(),
      });
    }
    const rankings = await r.json();

    // 2) Team colors (for name tinting)
    const tr = await fetch(`${CFBD_TEAMS_FBS}?year=${year}`, { headers, cache: "no-store" });
    if (!tr.ok) {
      return res.status(500).json({
        ok: false,
        error: "CFBD teams fetch failed",
        status: tr.status,
        body: await tr.text(),
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

    // 3) Records (JOIN for Rec column)
    const rr = await fetch(
      `${CFBD_RECORDS}?year=${year}&classification=fbs`,
      { headers, cache: "no-store" }
    );
    if (!rr.ok) {
      return res.status(500).json({
        ok: false,
        error: "CFBD records fetch failed",
        status: rr.status,
        body: await rr.text(),
      });
    }
    const records = await rr.json();
    const recordMap = buildRecordMap(records);

    // Build AP JSON
    const apJson = buildApJson(rankings, colorMap, recordMap);
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
