// api/scores.js — Vercel serverless function
// Uložit jako: api/scores.js (NE v rootu repozitáře!)

const TEAM_MAP={
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','USA':'USA','Switzerland':'SUI','Czech Republic':'CZE',
  'Czechia':'CZE','Denmark':'DEN','Austria':'AUT','Great Britain':'GBR',
  'Latvia':'LAT','Hungary':'HUN','Slovakia':'SVK','Norway':'NOR',
  'Slovenia':'SLO','Italy':'ITA','United Kingdom':'GBR'
};

function mapTeam(name){
  if(!name)return null;
  if(TEAM_MAP[name])return TEAM_MAP[name];
  for(const[k,v]of Object.entries(TEAM_MAP)){
    if(name.toLowerCase().includes(k.toLowerCase()))return v;
  }
  return name.slice(0,3).toUpperCase();
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=90,stale-while-revalidate=30');
  const day=req.query.day||new Date().toISOString().slice(0,10);
  try{
    const r=await fetch(
      `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`,
      {headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(8000)}
    );
    if(!r.ok)throw new Error('TheSportsDB '+r.status);
    const data=await r.json();
    const events=(data.events||[])
      .filter(e=>{const l=(e.strLeague||'').toLowerCase();return l.includes('iihf')||l.includes('world championship');})
      .map(e=>({
        key:`${day}_${mapTeam(e.strHomeTeam)}_${mapTeam(e.strAwayTeam)}`,
        teamA:mapTeam(e.strHomeTeam),teamB:mapTeam(e.strAwayTeam),
        scoreH:e.intHomeScore!=null?Number(e.intHomeScore):null,
        scoreA:e.intAwayScore!=null?Number(e.intAwayScore):null,
        status:e.strStatus==='Match Finished'?'done':e.strStatus==='In Progress'?'live':'upcoming'
      })).filter(e=>e.teamA&&e.teamB);
    res.json({source:'thesportsdb',day,events});
  }catch(err){
    res.status(500).json({error:err.message,day,events:[]});
  }
}
