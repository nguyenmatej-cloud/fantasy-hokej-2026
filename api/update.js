// api/update.js — Automatický agent: skóre + góly + asistence + tresty

const FIREBASE = 'https://fantasy-ms-hokej-2026-default-rtdb.europe-west1.firebasedatabase.app';

const TMAP = {
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','Switzerland':'SUI','Czech Republic':'CZE','Czechia':'CZE',
  'Denmark':'DEN','Austria':'AUT','Great Britain':'GBR','Latvia':'LAT',
  'Hungary':'HUN','Slovakia':'SVK','Norway':'NOR','Slovenia':'SLO','Italy':'ITA'
};
function mt(n) {
  if (!n) return null;
  const t = (n||'').trim();
  if (TMAP[t]) return TMAP[t];
  for (const [k,v] of Object.entries(TMAP))
    if (t.toLowerCase().includes(k.toLowerCase())) return v;
  return t.slice(0,3).toUpperCase();
}

async function fbSet(path, data) {
  await fetch(`${FIREBASE}/${path}.json`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
}

async function getGameDetails(eventId, day, teamA, teamB) {
  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/summary?event=${eventId}`
    );
    const d = await r.json();
    
    const plays = d.plays || d.gamePackageJSON?.plays || [];
    const boxScore = d.boxScore || d.gamePackageJSON?.boxScore || {};
    
    // Skóre po třetinách
    const linescores = d.header?.competitions?.[0]?.competitors || [];
    const homeComp = linescores.find(c => c.homeAway === 'home');
    const awayComp = linescores.find(c => c.homeAway === 'away');
    
    // Góly a tresty z plays
    const goals = [];
    const penalties = [];
    
    for (const play of plays) {
      const period = play.period?.number || 1;
      const clock = play.clock?.displayValue || '00:00';
      // Převod času: ESPN dává zbývající čas, potřebujeme elapsed
      // V hokeji clock = čas co zbývá, takže elapsed = 20:00 - clock
      const [mm, ss] = clock.split(':').map(Number);
      const remaining = mm * 60 + (ss || 0);
      const elapsed = 20 * 60 - remaining;
      const elMin = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const elSec = String(elapsed % 60).padStart(2, '0');
      const displayTime = `${elMin}:${elSec}`;
      
      if (play.scoringPlay) {
        // Gól
        const text = play.text || '';
        // ESPN format: "Barkov A. (Rantanen M., Komarov L.) 1-0"
        const parts = text.match(/^([^(]+?)(?:\s*\(([^)]+)\))?\s*[\d-]+$/);
        const scorer = parts?.[1]?.trim() || text.split('(')[0].trim();
        const assistStr = parts?.[2] || '';
        const assists = assistStr ? assistStr.split(',').map(a => a.trim()) : [];
        
        // Určit tým
        const homeScore = play.homeScore || 0;
        const awayScore = play.awayScore || 0;
        const prevH = goals.filter(g => g.team === teamA).length;
        const prevA = goals.filter(g => g.team === teamB).length;
        const team = (homeScore > prevH) ? teamA : teamB;
        
        const ppMatch = text.match(/\(PP\)/i);
        const shMatch = text.match(/\(SH\)/i);
        const enMatch = text.match(/\(EN\)/i);
        
        goals.push({
          min: displayTime,
          period,
          team,
          scorer: scorer.replace(/\s*\(PP\)|\s*\(SH\)|\s*\(EN\)/gi, '').trim(),
          a1: assists[0] || '',
          a2: assists[1] || '',
          type: ppMatch ? 'PP' : shMatch ? 'SH' : enMatch ? 'EN' : ''
        });
      } else if (play.penaltyPlay || (play.type?.text || '').toLowerCase().includes('penalty')) {
        const text = play.text || '';
        const team = text.toLowerCase().includes(teamA.toLowerCase()) ? teamA : teamB;
        penalties.push({
          min: displayTime,
          period,
          team,
          player: text.split(':')[0]?.trim() || '',
          min_val: 2,
          type: text.includes(':') ? text.split(':')[1]?.trim() || '' : text
        });
      }
    }
    
    // Finální skóre
    const finalH = goals.filter(g => g.team === teamA).length;
    const finalA = goals.filter(g => g.team === teamB).length;
    
    if (goals.length > 0) {
      return { h: finalH, a: finalA, goals, penalties };
    }
    return null;
  } catch(e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const day = req.query.day || new Date().toISOString().slice(0, 10);
  const date = day.replace(/-/g, '');
  
  try {
    // 1. Stáhni přehled zápasů
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/scoreboard?dates=${date}`
    );
    const data = await r.json();
    const events = data.events || [];
    
    const results = { day, total: events.length, scores: 0, details: 0, saved: [] };
    
    for (const ev of events) {
      const c = ev.competitions?.[0];
      const home = c?.competitors?.find(x => x.homeAway === 'home');
      const away = c?.competitors?.find(x => x.homeAway === 'away');
      const tA = mt(home?.team?.displayName);
      const tB = mt(away?.team?.displayName);
      if (!tA || !tB) continue;
      
      const key = `${day}_${tA}_${tB}`;
      const done = !!ev.status?.type?.completed;
      const live = ev.status?.type?.state === 'in';
      const scoreH = (done || live) ? Number(home?.score || 0) : null;
      const scoreA = (done || live) ? Number(away?.score || 0) : null;
      
      // Uložit skóre (live i done)
      if (scoreH !== null) {
        await fbSet(`match_results/${key}`, { h: scoreH, a: scoreA });
        results.scores++;
        results.saved.push(`${tA} ${scoreH}:${scoreA} ${tB} (${done?'done':'live'})`);
      }
      
      // Pro dokončené zápasy stáhni detaily (góly + asistence)
      if (done && ev.id) {
        const details = await getGameDetails(ev.id, day, tA, tB);
        if (details) {
          await fbSet(`match_details/${key}`, details);
          results.details++;
        }
      }
    }
    
    return res.json(results);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
