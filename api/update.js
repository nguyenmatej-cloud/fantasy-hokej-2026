// api/update.js

const FIREBASE='https://fantasy-ms-hokej-2026-default-rtdb.europe-west1.firebasedatabase.app';
const TMAP={
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','Switzerland':'SUI','Czech Republic':'CZE','Czechia':'CZE',
  'Denmark':'DEN','Austria':'AUT','Great Britain':'GBR','Latvia':'LAT',
  'Hungary':'HUN','Slovakia':'SVK','Norway':'NOR','Slovenia':'SLO','Italy':'ITA'
};
const MS_KEYS=['FIN_GER','SWE_CAN','USA_SUI','DEN_CZE','GBR_AUT','SVK_NOR',
  'HUN_FIN','CAN_ITA','SUI_LAT','SLO_CZE','GBR_USA','ITA_SVK','AUT_HUN',
  'SWE_DEN','GER_LAT','NOR_SLO','FIN_USA','CAN_DEN','GER_SUI','CZE_SWE',
  'LAT_AUT','ITA_NOR','HUN_GBR','SLO_SVK','CAN_SLO','GER_HUN','FIN_GBR',
  'ITA_SWE','FIN_LAT','CAN_NOR','AUT_SUI','CZE_ITA','USA_GER','SWE_SLO',
  'DEN_SVK','CZE_CAN'];
function mt(n){
  if(!n)return null;const t=(n||'').trim();
  if(TMAP[t])return TMAP[t];
  for(const[k,v]of Object.entries(TMAP))if(t.toLowerCase().includes(k.toLowerCase()))return v;
  return t.slice(0,3).toUpperCase();
}
async function fbSet(p,d){
  await fetch(`${FIREBASE}/${p}.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
}
function findKey(tH,tA,sh,sa){
  const k1=`${tH}_${tA}`,k2=`${tA}_${tH}`;
  if(MS_KEYS.includes(k1))return{key:k1,h:sh,a:sa};
  if(MS_KEYS.includes(k2))return{key:k2,h:sa,a:sh};
  return null;
}

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  const day=req.query.day||new Date().toISOString().slice(0,10);
  const results={day,saved:[],errors:[]};

  // ── SofaScore (live IIHF data) ───────────────────────
  try{
    const r=await fetch(`https://api.sofascore.com/api/v1/sport/ice-hockey/scheduled-events/${day}`,{
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':'application/json, text/plain, */*',
        'Referer':'https://www.sofascore.com/',
        'Accept-Language':'en-US,en;q=0.9'
      }
    });
    const data=await r.json();
    const iihf=(data.events||[]).filter(e=>{
      const tn=(e.tournament?.name||e.uniqueTournament?.name||'').toLowerCase();
      return tn.includes('world championship')||tn.includes('iihf');
    });
    for(const e of iihf){
      const tH=mt(e.homeTeam?.name),tA=mt(e.awayTeam?.name);
      if(!tH||!tA)continue;
      const done=e.status?.type==='finished';
      const live=e.status?.type==='inprogress';
      if(!done&&!live)continue;
      const sh=e.homeScore?.current??0,sa=e.awayScore?.current??0;
      if(sh+sa===0&&!done)continue;
      const found=findKey(tH,tA,sh,sa);
      if(!found)continue;
      await fbSet(`match_results/${day}_${found.key}`,{h:found.h,a:found.a});
      results.saved.push(`sofascore ${day}_${found.key}: ${found.h}:${found.a} (${done?'done':'live'})`);
    }
  }catch(e){results.errors.push('sofascore:'+e.message);}

  // ── ESPN (záloha) ────────────────────────────────────
  if(results.saved.length===0){
    try{
      const date=day.replace(/-/g,'');
      const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/mens-world-championship/scoreboard?dates=${date}`);
      const data=await r.json();
      for(const ev of data.events||[]){
        const c=ev.competitions?.[0];
        const home=c?.competitors?.find(x=>x.homeAway==='home');
        const away=c?.competitors?.find(x=>x.homeAway==='away');
        const tH=mt(home?.team?.displayName),tA=mt(away?.team?.displayName);
        if(!tH||!tA)continue;
        const done=!!ev.status?.type?.completed;
        const live=ev.status?.type?.state==='in';
        if(!done&&!live)continue;
        const sh=Number(home?.score||0),sa=Number(away?.score||0);
        if(sh+sa===0)continue;
        const found=findKey(tH,tA,sh,sa);
        if(!found)continue;
        await fbSet(`match_results/${day}_${found.key}`,{h:found.h,a:found.a});
        results.saved.push(`espn ${day}_${found.key}: ${found.h}:${found.a}`);
      }
    }catch(e){results.errors.push('espn:'+e.message);}
  }

  return res.json(results);
};
