// api/scores.js — SofaScore (správná data)

const TMAP={
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','Switzerland':'SUI','Czech Republic':'CZE','Czechia':'CZE',
  'Denmark':'DEN','Austria':'AUT','Great Britain':'GBR','Latvia':'LAT',
  'Hungary':'HUN','Slovakia':'SVK','Norway':'NOR','Slovenia':'SLO','Italy':'ITA'
};
const MS_KEYS=new Set(['FIN_GER','SWE_CAN','USA_SUI','DEN_CZE','GBR_AUT','SVK_NOR',
  'HUN_FIN','CAN_ITA','SUI_LAT','SLO_CZE','GBR_USA','ITA_SVK','AUT_HUN',
  'SWE_DEN','GER_LAT','NOR_SLO','FIN_USA','CAN_DEN','GER_SUI','CZE_SWE',
  'LAT_AUT','ITA_NOR','HUN_GBR','SLO_SVK']);
function mt(n){
  if(!n)return null;const t=(n||'').trim();
  if(TMAP[t])return TMAP[t];
  for(const[k,v]of Object.entries(TMAP))if(t.toLowerCase().includes(k.toLowerCase()))return v;
  return t.slice(0,3).toUpperCase();
}
function findKey(tH,tA,sh,sa){
  const k1=`${tH}_${tA}`,k2=`${tA}_${tH}`;
  if(MS_KEYS.has(k1))return{key:k1,h:sh,a:sa};
  if(MS_KEYS.has(k2))return{key:k2,h:sa,a:sh};
  return null;
}

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=30');
  const day=req.query.day||new Date().toISOString().slice(0,10);
  try{
    const r=await fetch(
      `https://api.sofascore.com/api/v1/sport/ice-hockey/scheduled-events/${day}`,
      {headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/124.0',
        'Accept':'application/json',
        'Referer':'https://www.sofascore.com/'
      }}
    );
    if(!r.ok)throw new Error('HTTP '+r.status);
    const data=await r.json();
    const events=(data.events||[]).map(e=>{
      const tH=mt(e.homeTeam?.name),tA=mt(e.awayTeam?.name);
      if(!tH||!tA)return null;
      const found=findKey(tH,tA,e.homeScore?.current??0,e.awayScore?.current??0);
      if(!found)return null;
      const done=e.status?.type==='finished';
      const live=e.status?.type==='inprogress';
      return{key:`${day}_${found.key}`,teamA:found.key.split('_')[0],teamB:found.key.split('_')[1],
        scoreH:found.h,scoreA:found.a,status:done?'done':live?'live':'upcoming'};
    }).filter(Boolean);
    return res.json({source:'sofascore',day,count:events.length,events});
  }catch(e){
    return res.status(500).json({error:e.message,events:[]});
  }
};
