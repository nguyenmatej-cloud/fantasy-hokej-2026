// api/update.js — Agent pro automatickou aktualizaci výsledků
// Volán GitHub Actions každých 5 minut

const FIREBASE = 'https://fantasy-ms-hokej-2026-default-rtdb.europe-west1.firebasedatabase.app';

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
function mt(n) {
  if (!n) return null;
  const t = n.trim();
  if (TMAP[t]) return TMAP[t];
  for (const [k,v] of Object.entries(TMAP))
    if (t.toLowerCase().includes(k.toLowerCase())) return v;
  return t.slice(0,3).toUpperCase();
}

async function fetchEvents(day) {
  const date = day.replace(/-/g,'');

  // ESPN — nejlepší pro live data
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/scoreboard?dates=${date}`
    );
    const data = await r.json();
    const events = (data.events||[]).map(ev => {
      const c = ev.competitions?.[0];
      const home = c?.competitors?.find(x=>x.homeAway==='home');
      const away = c?.competitors?.find(x=>x.homeAway==='away');
      const done = !!ev.status?.type?.completed;
      const live = ev.status?.type?.state === 'in';
      return {
        key: `${day}_${mt(home?.team?.displayName)}_${mt(away?.team?.displayName)}`,
        teamA: mt(home?.team?.displayName),
        teamB: mt(away?.team?.displayName),
        scoreH: (done||live) ? Number(home?.score||0) : null,
        scoreA: (done||live) ? Number(away?.score||0) : null,
        status: done ? 'done' : live ? 'live' : 'upcoming'
      };
    }).filter(e => e.teamA && e.teamB);
    if (events.length > 0) return { source: 'espn', events };
  } catch(e) {}

  // TheSportsDB — záloha
  try {
    const r = await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`
    );
    const data = await r.json();
    const events = (data.events||[])
      .filter(e => { const l=(e.strLeague||'').toLowerCase(); return l.includes('iihf')||l.includes('world championship'); })
      .map(e => {
        const scoreH = e.intHomeScore!=null&&e.intHomeScore!=='' ? Number(e.intHomeScore) : null;
        const scoreA = e.intAwayScore!=null&&e.intAwayScore!=='' ? Number(e.intAwayScore) : null;
        const done = scoreH!==null && (e.strStatus==='Match Finished'||(scoreH+scoreA)>0);
        return {
          key: `${day}_${mt(e.strHomeTeam)}_${mt(e.strAwayTeam)}`,
          teamA: mt(e.strHomeTeam), teamB: mt(e.strAwayTeam),
          scoreH, scoreA,
          status: done ? 'done' : (e.strStatus||'').includes('Progress') ? 'live' : 'upcoming'
        };
      }).filter(e => e.teamA && e.teamB);
    if (events.length > 0) return { source: 'thesportsdb', events };
  } catch(e) {}

  return { source: 'none', events: [] };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const day = req.query.day || new Date().toISOString().slice(0,10);
  const { source, events } = await fetchEvents(day);

  let updated = 0;
  const saved = [];

  for (const e of events) {
    // Uložit pouze výsledky kde aspoň 1 gól NEBO explicitně done
    const hasScore = e.scoreH !== null && e.scoreA !== null;
    const isReal = hasScore && (e.scoreH + e.scoreA > 0 || e.status === 'done');

    if (hasScore && e.status !== 'upcoming') {
      try {
        // Firebase REST API — funguje bez autentizace (rules: public write)
        const fbUrl = `${FIREBASE}/match_results/${e.key}.json`;
        await fetch(fbUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ h: e.scoreH, a: e.scoreA })
        });
        updated++;
        saved.push(`${e.teamA} ${e.scoreH}:${e.scoreA} ${e.teamB} (${e.status})`);
      } catch(err) {}
    }
  }

  const result = { source, day, total: events.length, updated, saved };
  console.log('Score update:', result);
  res.json(result);
};
