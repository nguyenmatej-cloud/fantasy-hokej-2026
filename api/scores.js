// api/scores.js

const TMAP={
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','USA':'USA','Switzerland':'SUI',
  'Czech Republic':'CZE','Czechia':'CZE','Denmark':'DEN',
  'Austria':'AUT','Great Britain':'GBR','Latvia':'LAT',
  'Hungary':'HUN','Slovakia':'SVK','Norway':'NOR',
  'Slovenia':'SLO','Italy':'ITA'
};
function mt(n){
  if(!n)return null;const t=n.trim();
  if(TMAP[t])return TMAP[t];
  for(const[k,v]of Object.entries(TMAP))
    if(t.toLowerCase().includes(k.toLowerCase()))return v;
  return t.slice(0,3).toUpperCase();
}

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=30');
  const day=req.query.day||new Date().toISOString().slice(0,10);
  try{
    const r=await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`);
    const data=await r.json();
    const events=(data.events||[])
      .filter(e=>{const l=(e.strLeague||'').toLowerCase();return l.includes('iihf')||l.includes('world championship');})
      .map(e=>{
        const scoreH=e.intHomeScore!=null&&e.intHomeScore!==''?Number(e.intHomeScore):null;
        const scoreA=e.intAwayScore!=null&&e.intAwayScore!==''?Number(e.intAwayScore):null;
        const done=scoreH!==null&&(e.strStatus==='Match Finished'||(scoreH+scoreA)>0);
        return{
          key:`${day}_${mt(e.strHomeTeam)}_${mt(e.strAwayTeam)}`,
          teamA:mt(e.strHomeTeam),teamB:mt(e.strAwayTeam),
          scoreH,scoreA,
          status:done?'done':(e.strStatus||'').includes('Progress')?'live':'upcoming'
        };
      }).filter(e=>e.teamA&&e.teamB);
    return res.json({source:'thesportsdb',day,count:events.length,events});
  }catch(e){
    return res.status(500).json({error:e.message,events:[]});
  }
};
