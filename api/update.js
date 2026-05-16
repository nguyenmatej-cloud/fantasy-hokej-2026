// api/update.js — Agent s opravou klíčů

const FIREBASE='https://fantasy-ms-hokej-2026-default-rtdb.europe-west1.firebasedatabase.app';

// Naše MS schedule pořadí: teamA_teamB (jak je v app)
const MS_ORDER={
  'FIN_GER':true,'SWE_CAN':true,'USA_SUI':true,'DEN_CZE':true,
  'GBR_AUT':true,'SVK_NOR':true,'HUN_FIN':true,'CAN_ITA':true,
  'SUI_LAT':true,'SLO_CZE':true,
  'GBR_USA':true,'ITA_SVK':true,'AUT_HUN':true,'SWE_DEN':true,
  'GER_LAT':true,'NOR_SLO':true
};

const TMAP={
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

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  const day=req.query.day||new Date().toISOString().slice(0,10);
  const results={day,saved:[],deleted:[],errors:[]};

  // Smaž špatné inverze z Firebase
  const wrongKeys=[`${day}_ITA_CAN`,`${day}_AUT_GBR`,`${day}_NOR_SVK`,`${day}_FIN_HUN`];
  for(const k of wrongKeys){
    try{await fbDelete('match_results/'+k);}catch(_){}
  }

  // TheSportsDB
  try{
    const r=await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${day}&s=Ice_Hockey`);
    const data=await r.json();
    for(const e of data.events||[]){
      const l=(e.strLeague||'').toLowerCase();
      if(!l.includes('iihf')&&!l.includes('world championship'))continue;
      const tA=mt(e.strHomeTeam),tB=mt(e.strAwayTeam);
      if(!tA||!tB)continue;
      const scoreH=e.intHomeScore!=null&&e.intHomeScore!==''?Number(e.intHomeScore):null;
      const scoreA=e.intAwayScore!=null&&e.intAwayScore!==''?Number(e.intAwayScore):null;
      if(scoreH===null||scoreA===null||scoreH+scoreA===0)continue;
      const done=e.strStatus==='Match Finished'||scoreH+scoreA>0;
      if(!done)continue;

      // Zkontroluj správné pořadí podle naší schedule
      const keyAB=`${tA}_${tB}`,keyBA=`${tB}_${tA}`;
      const correctKey=MS_ORDER[keyAB]?`${day}_${tA}_${tB}`:MS_ORDER[keyBA]?`${day}_${tB}_${tA}`:null;
      if(!correctKey)continue;

      // Pokud je pořadí v MS_ORDER opačné, prohoď skóre
      let h=scoreH,a=scoreA;
      if(MS_ORDER[keyBA]&&!MS_ORDER[keyAB]){h=scoreA;a=scoreH;}

      await fbSet('match_results/'+correctKey,{h,a});
      results.saved.push(`${correctKey}: ${h}:${a}`);
    }
  }catch(e){results.errors.push('tsdb:'+e.message);}

  // ESPN (live)
  try{
    const date=day.replace(/-/g,'');
    const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/scoreboard?dates=${date}`);
    const data=await r.json();
    for(const ev of data.events||[]){
      const c=ev.competitions?.[0];
      const home=c?.competitors?.find(x=>x.homeAway==='home');
      const away=c?.competitors?.find(x=>x.homeAway==='away');
      const tA=mt(home?.team?.displayName),tB=mt(away?.team?.displayName);
      if(!tA||!tB)continue;
      const done=!!ev.status?.type?.completed;
      const live=ev.status?.type?.state==='in';
      if(!done&&!live)continue;
      const scoreH=Number(home?.score||0),scoreA=Number(away?.score||0);
      if(scoreH+scoreA===0)continue;
      const keyAB=`${tA}_${tB}`,keyBA=`${tB}_${tA}`;
      const correctKey=MS_ORDER[keyAB]?`${day}_${tA}_${tB}`:MS_ORDER[keyBA]?`${day}_${tB}_${tA}`:null;
      if(!correctKey)continue;
      let h=scoreH,a=scoreA;
      if(MS_ORDER[keyBA]&&!MS_ORDER[keyAB]){h=scoreA;a=scoreH;}
      await fbSet('match_results/'+correctKey,{h,a});
      results.saved.push(`ESPN ${correctKey}: ${h}:${a} (${done?'done':'live'})`);
    }
  }catch(e){results.errors.push('espn:'+e.message);}

  return res.json(results);
};
