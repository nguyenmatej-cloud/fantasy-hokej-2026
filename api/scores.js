// api/scores.js — Livesport jako primární zdroj

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
function mt(n){
  if(!n)return null;
  const t=n.trim();
  if(TMAP[t])return TMAP[t];
  for(const[k,v]of Object.entries(TMAP))
    if(t.toLowerCase().includes(k.toLowerCase()))return v;
  return t.slice(0,3).toUpperCase();
}

const BROWSER_HEADERS = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language':'cs-CZ,cs;q=0.9,en;q=0.8',
  'Cache-Control':'no-cache'
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=30');

  const day = req.query.day||new Date().toISOString().slice(0,10);
  const errors = [];

  // ── 1. Livesport.cz ──────────────────────────────────
  try {
    const r = await fetch('https://www.livesport.cz/hokej/svet/ms-2026/vysledky/', {
      headers: BROWSER_HEADERS
    });
    const html = await r.text();

    // Hledej embedded JSON data (React/Next.js SSR pattern)
    const patterns = [
      /__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/,
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/,
      /window\.environment\s*=\s*(\{[\s\S]*?\});/,
      /"events"\s*:\s*(\[[\s\S]*?\])\s*[,}]/
    ];

    for(const pat of patterns){
      const m = html.match(pat);
      if(m){
        try{
          const data = JSON.parse(m[1]);
          // Navigate the data structure
          const events = extractEvents(data, day);
          if(events.length > 0)
            return res.json({source:'livesport', day, count:events.length, events});
        }catch(_){}
      }
    }

    // Zkus parsovat HTML přímo — Livesport obsahuje data v strukturovaném HTML
    const events = parseLivesportHTML(html, day);
    if(events.length > 0)
      return res.json({source:'livesport-html', day, count:events.length, events});

    errors.push('livesport: no parseable data, html length='+html.length);
  } catch(e){ errors.push('livesport: '+e.message); }

  // ── 2. Flashscore.com ────────────────────────────────
  try {
    const r = await fetch('https://www.flashscore.com/hockey/world/world-championship/results/', {
      headers: BROWSER_HEADERS
    });
    const html = await r.text();
    const m = html.match(/__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/);
    if(m){
      const data = JSON.parse(m[1]);
      const events = extractEvents(data, day);
      if(events.length > 0)
        return res.json({source:'flashscore', day, count:events.length, events});
    }
    errors.push('flashscore: no __NEXT_DATA__');
  } catch(e){ errors.push('flashscore: '+e.message); }

  // ── 3. ESPN ──────────────────────────────────────────
  try {
    const date = day.replace(/-/g,'');
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/scoreboard?dates=${date}`
    );
    const data = await r.json();
    const events = (data.events||[]).map(ev=>{
      const c=ev.competitions?.[0];
      const home=c?.competitors?.find(x=>x.homeAway==='home');
      const away=c?.competitors?.find(x=>x.homeAway==='away');
      const done=!!ev.status?.type?.completed;
      const live=ev.status?.type?.state==='in';
      const scoreH=(done||live)&&home?.score?Number(home.score):null;
      const scoreA=(done||live)&&away?.score?Number(away.score):null;
      const tA=mt(home?.team?.displayName);const tB=mt(away?.team?.displayName);
      return{key:`${day}_${tA}_${tB}`,teamA:tA,teamB:tB,scoreH,scoreA,status:done?'done':live?'live':'upcoming'};
    }).filter(e=>e.teamA&&e.teamB);
    if(events.length>0)return res.json({source:'espn',day,count:events.length,events});
    errors.push('espn: 0 events');
  } catch(e){ errors.push('espn: '+e.message); }

  // ── 4. TheSportsDB ───────────────────────────────────
  try {
    const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`);
    const data = await r.json();
    const events = (data.events||[])
      .filter(e=>{const l=(e.strLeague||'').toLowerCase();return l.includes('iihf')||l.includes('world championship');})
      .map(e=>{
        const scoreH=e.intHomeScore!=null&&e.intHomeScore!==''?Number(e.intHomeScore):null;
        const scoreA=e.intAwayScore!=null&&e.intAwayScore!==''?Number(e.intAwayScore):null;
        return{key:`${day}_${mt(e.strHomeTeam)}_${mt(e.strAwayTeam)}`,teamA:mt(e.strHomeTeam),teamB:mt(e.strAwayTeam),scoreH,scoreA,status:scoreH!==null?'done':(e.strStatus||'').includes('Progress')?'live':'upcoming'};
      }).filter(e=>e.teamA&&e.teamB);
    if(events.length>0)return res.json({source:'thesportsdb',day,count:events.length,events});
    errors.push('thesportsdb: 0 events');
  } catch(e){ errors.push('thesportsdb: '+e.message); }

  res.json({source:'none',day,events:[],errors});
};

function extractEvents(data, day){
  // Rekurzivně hledej pole se zápasovými daty
  const results = [];
  function search(obj, depth=0){
    if(depth>8||!obj)return;
    if(Array.isArray(obj)){
      for(const item of obj) search(item, depth+1);
    } else if(typeof obj==='object'){
      // Zkus detekovat zápas
      if(obj.homeTeam&&obj.awayTeam){
        const tA=mt(obj.homeTeam?.name||obj.homeTeam);
        const tB=mt(obj.awayTeam?.name||obj.awayTeam);
        if(tA&&tB){
          const scoreH=obj.homeScore??obj.score?.home??null;
          const scoreA=obj.awayScore??obj.score?.away??null;
          results.push({key:`${day}_${tA}_${tB}`,teamA:tA,teamB:tB,scoreH:scoreH!=null?Number(scoreH):null,scoreA:scoreA!=null?Number(scoreA):null,status:scoreH!=null?'done':'upcoming'});
        }
      }
      for(const v of Object.values(obj)) search(v, depth+1);
    }
  }
  search(data);
  return results.filter((e,i,a)=>a.findIndex(x=>x.key===e.key)===i);
}

function parseLivesportHTML(html, day){
  // Hledej vzor dat v HTML Livesportu
  const results = [];
  // Vzor: event__participant, event__score
  const matchPattern = /event__match[^>]*data-id="([^"]+)"([\s\S]{0,500}?)event__participant[^>]*>([\s\S]{0,100}?)<\/span[^>]*>([\s\S]{0,200}?)event__score[^>]*>(\d+)<\/span[^>]*>[\s\S]{0,50}?event__score[^>]*>(\d+)<\/span[^>]*>([\s\S]{0,200}?)event__participant[^>]*>([\s\S]{0,100}?)<\/span/g;
  let m;
  while((m=matchPattern.exec(html))!==null){
    const tA=mt(m[3].trim());const tB=mt(m[9].trim());
    if(tA&&tB){
      results.push({key:`${day}_${tA}_${tB}`,teamA:tA,teamB:tB,scoreH:Number(m[5]),scoreA:Number(m[6]),status:'done'});
    }
  }
  return results;
}
