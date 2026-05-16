// api/update.js — ESPN only (TheSportsDB má invertované skóre)

const FIREBASE='https://fantasy-ms-hokej-2026-default-rtdb.europe-west1.firebasedatabase.app';
const TMAP={
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','Switzerland':'SUI','Czech Republic':'CZE','Czechia':'CZE',
  'Denmark':'DEN','Austria':'AUT','Great Britain':'GBR','Latvia':'LAT',
  'Hungary':'HUN','Slovakia':'SVK','Norway':'NOR','Slovenia':'SLO','Italy':'ITA'
};
// Správné pořadí týmů podle naší schedule
const MS_KEYS=[
  'FIN_GER','SWE_CAN','USA_SUI','DEN_CZE','GBR_AUT','SVK_NOR',
  'HUN_FIN','CAN_ITA','SUI_LAT','SLO_CZE','GBR_USA','ITA_SVK',
  'AUT_HUN','SWE_DEN','GER_LAT','NOR_SLO','FIN_USA','CAN_DEN',
  'GER_SUI','CZE_SWE','LAT_AUT','ITA_NOR','HUN_GBR','SLO_SVK'
];
function mt(n){
  if(!n)return null;const t=n.trim();
  if(TMAP[t])return TMAP[t];
  for(const[k,v]of Object.entries(TMAP))if(t.toLowerCase().includes(k.toLowerCase()))return v;
  return t.slice(0,3).toUpperCase();
}
async function fbSet(p,d){
  await fetch(`${FIREBASE}/${p}.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
}
async function fbDelete(p){
  await fetch(`${FIREBASE}/${p}.json`,{method:'DELETE'});
}

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  const day=req.query.day||new Date().toISOString().slice(0,10);
  const results={day,saved:[],cleaned:[],errors:[]};

  // Smaž špatná data ze špatného zdroje
  const wrongKeys=[`${day}_ITA_CAN`,`${day}_AUT_GBR`,`${day}_NOR_SVK`,`${day}_FIN_HUN`,
                   `${day}_CAN_ITA`,`${day}_GBR_AUT`]; // smaž i špatně uložené
  for(const k of wrongKeys){
    try{await fbDelete('match_results/'+k);results.cleaned.push(k);}catch(_){}
  }

  // ESPN — pokud má IIHF data
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
      // Najdi správný klíč podle naší schedule
      const k1=`${tH}_${tA}`,k2=`${tA}_${tH}`;
      if(MS_KEYS.includes(k1)){
        await fbSet(`match_results/${day}_${k1}`,{h:sh,a:sa});
        results.saved.push(`${day}_${k1}: ${sh}:${sa}`);
      } else if(MS_KEYS.includes(k2)){
        await fbSet(`match_results/${day}_${k2}`,{h:sa,a:sh});
        results.saved.push(`${day}_${k2}: ${sa}:${sh} (swapped)`);
      }
    }
  }catch(e){results.errors.push('espn:'+e.message);}

  return res.json(results);
};
