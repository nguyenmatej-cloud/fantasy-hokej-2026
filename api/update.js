// api/update.js — Agent: TheSportsDB primary, ESPN fallback

const FIREBASE = 'https://fantasy-ms-hokej-2026-default-rtdb.europe-west1.firebasedatabase.app';
const TMAP = {
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','Switzerland':'SUI','Czech Republic':'CZE','Czechia':'CZE',
  'Denmark':'DEN','Austria':'AUT','Great Britain':'GBR','Latvia':'LAT',
  'Hungary':'HUN','Slovakia':'SVK','Norway':'NOR','Slovenia':'SLO','Italy':'ITA'
};
function mt(n){
  if(!n)return null;const t=n.trim();
  if(TMAP[t])return TMAP[t];
  for(const[k,v]of Object.entries(TMAP))if(t.toLowerCase().includes(k.toLowerCase()))return v;
  return t.slice(0,3).toUpperCase();
}
async function fbSet(path,data){
  await fetch(`${FIREBASE}/${path}.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
async function fbDelete(path){
  await fetch(`${FIREBASE}/${path}.json`,{method:'DELETE'});
}

module.exports = async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  const day = req.query.day||new Date().toISOString().slice(0,10);
  const results = {day, scores:0, deleted:0, saved:[], errors:[]};

  // ── TheSportsDB ──────────────────────────────────────
  try {
    const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`);
    const data = await r.json();
    const events = (data.events||[]).filter(e=>{
      const l=(e.strLeague||'').toLowerCase();
      return l.includes('iihf')||l.includes('world championship');
    });

    for(const e of events){
      const tA=mt(e.strHomeTeam), tB=mt(e.strAwayTeam);
      if(!tA||!tB) continue;
      const key=`${day}_${tA}_${tB}`;
      const scoreH=e.intHomeScore!=null&&e.intHomeScore!==''?Number(e.intHomeScore):null;
      const scoreA=e.intAwayScore!=null&&e.intAwayScore!==''?Number(e.intAwayScore):null;
      const isFinished=e.strStatus==='Match Finished'||(scoreH!==null&&scoreA!==null&&scoreH+scoreA>0);

      if(scoreH!==null&&scoreA!==null&&isFinished){
        await fbSet(`match_results/${key}`,{h:scoreH,a:scoreA});
        results.scores++; results.saved.push(`${tA} ${scoreH}:${scoreA} ${tB}`);
      }
    }
  } catch(e){ results.errors.push('thesportsdb: '+e.message); }

  // ── ESPN (live skóre) ────────────────────────────────
  try {
    const date=day.replace(/-/g,'');
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/scoreboard?dates=${date}`);
    const data = await r.json();

    for(const ev of data.events||[]){
      const c=ev.competitions?.[0];
      const home=c?.competitors?.find(x=>x.homeAway==='home');
      const away=c?.competitors?.find(x=>x.homeAway==='away');
      const tA=mt(home?.team?.displayName), tB=mt(away?.team?.displayName);
      if(!tA||!tB) continue;
      const key=`${day}_${tA}_${tB}`;
      const done=!!ev.status?.type?.completed;
      const live=ev.status?.type?.state==='in';
      const scoreH=Number(home?.score||0);
      const scoreA=Number(away?.score||0);

      // Live nebo done zápas s reálným skóre
      if((live||done)&&(scoreH+scoreA>0)){
        await fbSet(`match_results/${key}`,{h:scoreH,a:scoreA});
        results.scores++; results.saved.push(`ESPN: ${tA} ${scoreH}:${scoreA} ${tB} (${done?'done':'live'})`);
      }
      // Smaž špatné 0:0 které bylo zapsáno před začátkem zápasu
      if(live&&scoreH===0&&scoreA===0){
        await fbDelete(`match_results/${key}`);
        results.deleted++;
      }
    }
  } catch(e){ results.errors.push('espn: '+e.message); }

  return res.json(results);
};
