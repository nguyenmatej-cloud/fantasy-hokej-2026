// api/update.js — SofaScore bez filtru turnaje

const FIREBASE='https://fantasy-ms-hokej-2026-default-rtdb.europe-west1.firebasedatabase.app';
const TMAP={
  'Finland':'FIN','Germany':'GER','Canada':'CAN','Sweden':'SWE',
  'United States':'USA','Switzerland':'SUI','Czech Republic':'CZE','Czechia':'CZE',
  'Denmark':'DEN','Austria':'AUT','Great Britain':'GBR','Latvia':'LAT',
  'Hungary':'HUN','Slovakia':'SVK','Norway':'NOR','Slovenia':'SLO','Italy':'ITA'
};
const MS_KEYS=new Set(['FIN_GER','SWE_CAN','USA_SUI','DEN_CZE','GBR_AUT','SVK_NOR',
  'HUN_FIN','CAN_ITA','SUI_LAT','SLO_CZE','GBR_USA','ITA_SVK','AUT_HUN',
  'SWE_DEN','GER_LAT','NOR_SLO','FIN_USA','CAN_DEN','GER_SUI','CZE_SWE',
  'LAT_AUT','ITA_NOR','HUN_GBR','SLO_SVK','CAN_SLO','GER_HUN','FIN_GBR',
  'ITA_SWE','FIN_LAT','CAN_NOR','AUT_SUI','CZE_ITA','USA_GER','SWE_SLO',
  'DEN_SVK','CZE_CAN','SUI_SWE','USA_SVK','FIN_DEN','CAN_CZE']);

function mt(n){
  if(!n)return null;const t=(n||'').trim();
  if(TMAP[t])return TMAP[t];
  for(const[k,v]of Object.entries(TMAP))if(t.toLowerCase().includes(k.toLowerCase()))return v;
  return t.slice(0,3).toUpperCase();
}
async function fbSet(p,d){
  await fetch(`${FIREBASE}/${p}.json`,{method:'PUT',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
}
function findKey(tH,tA,sh,sa){
  const k1=`${tH}_${tA}`,k2=`${tA}_${tH}`;
  if(MS_KEYS.has(k1))return{key:k1,h:sh,a:sa};
  if(MS_KEYS.has(k2))return{key:k2,h:sa,a:sh};
  return null;
}

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  const day=req.query.day||new Date().toISOString().slice(0,10);
  const out={day,saved:[],errors:[],source:'none'};

  // SofaScore — filtr jen podle týmů, ne turnaje
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
    const events=data.events||[];
    out.total=events.length;
    out.source='sofascore';

    for(const e of events){
      const tH=mt(e.homeTeam?.name),tA=mt(e.awayTeam?.name);
      if(!tH||!tA)continue;
      // Klíč musí být v naší MS schedule
      const found=findKey(tH,tA,
        e.homeScore?.current??0,
        e.awayScore?.current??0);
      if(!found)continue;

      const done=e.status?.type==='finished';
      const live=e.status?.type==='inprogress';
      if(!done&&!live)continue;
      if(found.h+found.a===0&&!done)continue; // Nulové live skóre nemaž

      await fbSet(`match_results/${day}_${found.key}`,{h:found.h,a:found.a});
      out.saved.push(`${day}_${found.key}: ${found.h}:${found.a} (${done?'✓':'live'})`);
    }
  }catch(e){out.errors.push('sofascore:'+e.message);}

  return res.json(out);
};
