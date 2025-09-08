// ----- helpers -----
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find the latest week in which the AP poll exists, then return its ranks */
function getLatestPollRanksFor(label, rankings) {
  // Gather all weekly snapshots that actually contain the requested poll
  const candidates = (rankings || []).filter((wk) =>
    Array.isArray(wk.polls) && wk.polls.some((p) =>
      label === "AP" ? /AP/i.test(p.poll) : /Coach/i.test(p.poll)
    )
  );
  if (!candidates.length) return [];

  // Pick the highest week among those candidates
  const latest = candidates.reduce((a, b) => (a.week || 0) > (b.week || 0) ? a : b);

  // Return the ranks for that poll (should be 25)
  const poll = latest.polls.find((p) => label === "AP" ? /AP/i.test(p.poll) : /Coach/i.test(p.poll));
  return {
    meta: { season: latest.season, week: latest.week },
    ranks: Array.isArray(poll?.ranks) ? poll.ranks : []
  };
}

function buildJson(rankings, label, colorMap) {
  const { meta, ranks } = getLatestPollRanksFor(label, rankings);
  if (!ranks.length) return null;

  const teams = ranks.slice(0, 25).map((r) => {
    const key = norm(r.school);
    const color = colorMap.get(key) || null;
    return {
      rk: r.rank,
      team: r.school,
      rec: r.record || "",
      conf: r.conference || "",
      color
    };
  });

  return {
    poll: label,
    season: meta.season,
    week: meta.week,
    lastUpdated: new Date().toISOString(),
    teams
  };
}
