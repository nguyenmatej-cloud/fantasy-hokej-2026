// api/scores.js

const TMAP = {
  'Finland':'FIN','Finsko':'FIN','Germany':'GER','Německo':'GER',
  'Canada':'CAN','Kanada':'CAN','Sweden':'SWE','Švédsko':'SWE',
  'United States':'USA','USA':'USA','Switzerland':'SUI','Švýcarsko':'SUI',
  'Czech Republic':'CZE','Czechia':'CZE','Česko':'CZE',
  'Denmark':'DEN','Dánsko':'DEN','Austria':'AUT','Rakousko':'AUT',
  'Great Britain':'GBR','V. Británie':'GBR','Latvia':'LAT','Lotyšsko':'LAT',
  'Hungary':'HUN','Maďarsko':'HUN','Slovakia':'SVK','Slovensko':'SVK',
  'Norway':'NOR','Norsko':'NOR','Slovenia':'SLO','Slovinsko':'SLO',
  'Italy':'ITA','Itálie':'ITA'
};

function mapTeam(n) {
  if (!n) return null;
  const t = n.trim();
  if (TMAP[t]) return TMAP[t];
  for (const [k, v] of Object.entries(TMAP))
    if (t.toLowerCase().includes(k.toLowerCase())) return v;
  return t.slice(0, 3).toUpperCase();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60');

  const day = req.query.day || new Date().toISOString().slice(0, 10);

  try {
    const r = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`
    );
    const data = await r.json();

    const events = (data.events || [])
      .filter(e => {
        const l = (e.strLeague || '').toLowerCase();
        return l.includes('iihf') || l.includes('world championship') || l.includes('world cup');
      })
      .map(e => {
        const scoreH = e.intHomeScore != null && e.intHomeScore !== '' ? Number(e.intHomeScore) : null;
        const scoreA = e.intAwayScore != null && e.intAwayScore !== '' ? Number(e.intAwayScore) : null;
        // Pokud existuje skóre → zápas skončil (bez ohledu na strStatus)
        const hasFinalScore = scoreH !== null && scoreA !== null;
        const status = hasFinalScore ? 'done'
          : (e.strStatus || '').toLowerCase().includes('progress') ? 'live'
          : 'upcoming';
        return {
          key: `${day}_${mapTeam(e.strHomeTeam)}_${mapTeam(e.strAwayTeam)}`,
          teamA: mapTeam(e.strHomeTeam),
          teamB: mapTeam(e.strAwayTeam),
          scoreH, scoreA, status,
          rawStatus: e.strStatus
        };
      })
      .filter(e => e.teamA && e.teamB);

    return res.json({ source: 'thesportsdb', day, count: events.length, events });
  } catch (e) {
    return res.status(500).json({ error: e.message, day, events: [] });
  }
};
