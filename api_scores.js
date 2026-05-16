// Ulož jako: api/scores.js  (ve složce api/ v repozitáři)

const TEAM_MAP = {
  'Finland':'FIN','Finsko':'FIN','Germany':'GER','Německo':'GER',
  'Canada':'CAN','Kanada':'CAN','Sweden':'SWE','Švédsko':'SWE',
  'United States':'USA','USA':'USA','Switzerland':'SUI','Švýcarsko':'SUI',
  'Czech Republic':'CZE','Czechia':'CZE','Česko':'CZE','Czech Czechia':'CZE',
  'Denmark':'DEN','Dánsko':'DEN','Austria':'AUT','Rakousko':'AUT',
  'Great Britain':'GBR','V. Británie':'GBR','Latvia':'LAT','Lotyšsko':'LAT',
  'Hungary':'HUN','Maďarsko':'HUN','Slovakia':'SVK','Slovensko':'SVK',
  'Norway':'NOR','Norsko':'NOR','Slovenia':'SLO','Slovinsko':'SLO',
  'Italy':'ITA','Itálie':'ITA'
};

function mapTeam(n) {
  if (!n) return null;
  const t = n.trim();
  if (TEAM_MAP[t]) return TEAM_MAP[t];
  for (const [k, v] of Object.entries(TEAM_MAP))
    if (t.toLowerCase().includes(k.toLowerCase())) return v;
  return t.slice(0, 3).toUpperCase();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

  const day = req.query.day || new Date().toISOString().slice(0, 10);
  const errors = [];

  // ── Pokus 1: TheSportsDB ────────────────────────────
  try {
    const r = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
    );
    const data = await r.json();
    const events = (data.events || []).filter(e => {
      const l = (e.strLeague || '').toLowerCase();
      return l.includes('iihf') || l.includes('world championship');
    }).map(e => ({
      key: `${day}_${mapTeam(e.strHomeTeam)}_${mapTeam(e.strAwayTeam)}`,
      teamA: mapTeam(e.strHomeTeam),
      teamB: mapTeam(e.strAwayTeam),
      scoreH: e.intHomeScore != null ? +e.intHomeScore : null,
      scoreA: e.intAwayScore != null ? +e.intAwayScore : null,
      status: e.strStatus === 'Match Finished' ? 'done'
            : e.strStatus === 'In Progress' ? 'live' : 'upcoming',
      time: e.strTime || ''
    })).filter(e => e.teamA && e.teamB);

    if (events.length > 0)
      return res.json({ source: 'thesportsdb', day, events });
    errors.push('thesportsdb: 0 events');
  } catch (e) { errors.push('thesportsdb: ' + e.message); }

  // ── Pokus 2: ESPN API ───────────────────────────────
  try {
    const date = day.replace(/-/g, '');
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/scoreboard?dates=${date}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
    );
    const data = await r.json();
    const events = (data.events || []).map(ev => {
      const comps = ev.competitions?.[0];
      const home = comps?.competitors?.find(c => c.homeAway === 'home');
      const away = comps?.competitors?.find(c => c.homeAway === 'away');
      const isDone = ev.status?.type?.completed;
      const isLive = ev.status?.type?.state === 'in';
      return {
        key: `${day}_${mapTeam(home?.team?.displayName)}_${mapTeam(away?.team?.displayName)}`,
        teamA: mapTeam(home?.team?.displayName),
        teamB: mapTeam(away?.team?.displayName),
        scoreH: isDone || isLive ? +home?.score : null,
        scoreA: isDone || isLive ? +away?.score : null,
        status: isDone ? 'done' : isLive ? 'live' : 'upcoming',
        time: ev.date || ''
      };
    }).filter(e => e.teamA && e.teamB);

    if (events.length > 0)
      return res.json({ source: 'espn', day, events });
    errors.push('espn: 0 events');
  } catch (e) { errors.push('espn: ' + e.message); }

  // ── Pokus 3: Livesport/Flashscore scraping ──────────
  try {
    // Fetch Flashscore hockey page — data je v JSON embedded v HTML
    const r = await fetch(
      'https://www.flashscore.com/hockey/world/world-championship/results/',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'cs,en;q=0.8',
          'Referer': 'https://www.flashscore.com/'
        },
        signal: AbortSignal.timeout(8000)
      }
    );
    const html = await r.text();

    // Flashscore embeds match data v window.environment nebo __NEXT_DATA__
    const nextMatch = html.match(/<script id="__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      const nd = JSON.parse(nextMatch[1]);
      // Pokus najít data v props
      const matches = nd?.props?.pageProps?.matches
        || nd?.props?.pageProps?.events
        || [];
      if (matches.length > 0) {
        const events = matches.slice(0, 50).map(m => ({
          key: `${day}_${mapTeam(m.homeTeam?.name || m.home)}_${mapTeam(m.awayTeam?.name || m.away)}`,
          teamA: mapTeam(m.homeTeam?.name || m.home),
          teamB: mapTeam(m.awayTeam?.name || m.away),
          scoreH: m.homeScore ?? m.score?.home ?? null,
          scoreA: m.awayScore ?? m.score?.away ?? null,
          status: m.status === 'finished' ? 'done' : m.status === 'inprogress' ? 'live' : 'upcoming'
        })).filter(e => e.teamA && e.teamB);
        if (events.length > 0)
          return res.json({ source: 'flashscore', day, events });
      }
    }
    errors.push('flashscore: no parseable data');
  } catch (e) { errors.push('flashscore: ' + e.message); }

  // Nic nefungovalo
  return res.status(503).json({ error: 'All sources failed', details: errors, day, events: [] });
}
