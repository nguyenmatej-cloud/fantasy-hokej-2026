// api/scores.js — Vercel serverless function
// Fetches IIHF WC 2026 scores from Flashscore (server-side, no CORS)

const TEAM_MAP = {
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','USA':'USA','Switzerland':'SUI','Czech Republic':'CZE',
  'Czechia':'CZE','Denmark':'DEN','Austria':'AUT','Great Britain':'GBR',
  'Latvia':'LAT','Hungary':'HUN','Slovakia':'SVK','Norway':'NOR',
  'Slovenia':'SLO','Italy':'ITA','United Kingdom':'GBR'
};

function mapTeam(name) {
  if (!name) return null;
  if (TEAM_MAP[name]) return TEAM_MAP[name];
  // Try partial match
  for (const [k, v] of Object.entries(TEAM_MAP)) {
    if (name.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(name.toLowerCase())) return v;
  }
  return name.slice(0,3).toUpperCase();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=30');

  const day = req.query.day || new Date().toISOString().slice(0, 10);

  try {
    // TheSportsDB — free, no key needed
    const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyHokej/1.0)' },
      signal: AbortSignal.timeout(8000)
    });

    if (!r.ok) throw new Error('TheSportsDB error: ' + r.status);
    const data = await r.json();

    const events = (data.events || [])
      .filter(e => {
        const league = (e.strLeague || '').toLowerCase();
        return league.includes('iihf') || league.includes('world championship') || league.includes('world cup');
      })
      .map(e => {
        const teamA = mapTeam(e.strHomeTeam);
        const teamB = mapTeam(e.strAwayTeam);
        const done = e.strStatus === 'Match Finished' || e.intHomeScore != null;
        return {
          key: `${day}_${teamA}_${teamB}`,
          teamA, teamB,
          scoreH: e.intHomeScore != null ? Number(e.intHomeScore) : null,
          scoreA: e.intAwayScore != null ? Number(e.intAwayScore) : null,
          status: done ? 'done' : (e.strStatus === 'In Progress' ? 'live' : 'upcoming'),
          time: e.strTime || '',
          eventId: e.idEvent
        };
      })
      .filter(e => e.teamA && e.teamB);

    // If TheSportsDB has no data, try fetching from IIHF.com
    if (events.length === 0) {
      return res.json({ source: 'empty', day, events: [], note: 'TheSportsDB má prázdný výsledek pro tento den' });
    }

    return res.json({ source: 'thesportsdb', day, events });

  } catch (err) {
    return res.status(500).json({ error: err.message, day, events: [] });
  }
}
