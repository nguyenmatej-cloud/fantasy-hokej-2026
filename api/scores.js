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
  for (const [k,v] of Object.entries(TMAP))
    if (t.toLowerCase().includes(k.toLowerCase())) return v;
  return t.slice(0,3).toUpperCase();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30');

  const day = req.query.day || new Date().toISOString().slice(0,10);
  const date = day.replace(/-/g,'');

  // ── ESPN (nejlepší pro live data) ────────────────────
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/scoreboard?dates=${date}`,
      { headers: {'User-Agent':'Mozilla/5.0'} }
    );
    const data = await r.json();
    const events = (data.events||[]).map(ev => {
      const c = ev.competitions?.[0];
      const home = c?.competitors?.find(x=>x.homeAway==='home');
      const away = c?.competitors?.find(x=>x.homeAway==='away');
      const done = !!ev.status?.type?.completed;
      const live = ev.status?.type?.state==='in';
      const scoreH = (done||live)&&home?.score ? Number(home.score) : null;
      const scoreA = (done||live)&&away?.score ? Number(away.score) : null;
      const tA = mapTeam(home?.team?.displayName||home?.team?.shortDisplayName);
      const tB = mapTeam(away?.team?.displayName||away?.team?.shortDisplayName);
      return {
        key:`${day}_${tA}_${tB}`,
        teamA:tA, teamB:tB,
        scoreH, scoreA,
        status: done?'done': live?'live':'upcoming'
      };
    }).filter(e=>e.teamA&&e.teamB);

    if (events.length > 0)
      return res.json({ source:'espn', day, count:events.length, events });
  } catch(e) {}

  // ── TheSportsDB (záložní) ─────────────────────────────
  try {
    const r = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`
    );
    const data = await r.json();
    const events = (data.events||[])
      .filter(e=>{const l=(e.strLeague||'').toLowerCase();return l.includes('iihf')||l.includes('world championship');})
      .map(e=>{
        const scoreH = e.intHomeScore!=null&&e.intHomeScore!=='' ? Number(e.intHomeScore) : null;
        const scoreA = e.intAwayScore!=null&&e.intAwayScore!=='' ? Number(e.intAwayScore) : null;
        return {
          key:`${day}_${mapTeam(e.strHomeTeam)}_${mapTeam(e.strAwayTeam)}`,
          teamA:mapTeam(e.strHomeTeam), teamB:mapTeam(e.strAwayTeam),
          scoreH, scoreA,
          status: scoreH!==null ? 'done' : (e.strStatus||'').toLowerCase().includes('progress') ? 'live' : 'upcoming'
        };
      }).filter(e=>e.teamA&&e.teamB);

    if (events.length > 0)
      return res.json({ source:'thesportsdb', day, count:events.length, events });
  } catch(e) {}

  res.json({ source:'none', day, events:[], note:'Žádný zdroj nedostupný' });
};
