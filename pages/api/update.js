import { put } from '@vercel/blob';

export const config = { runtime: 'edge' };

const CFBD_URL = 'https://api.collegefootballdata.com/rankings';

function buildJson(arr, pollLabel){
  if(!Array.isArray(arr) || !arr.length) return null;
  const latest = arr.reduce((a,b)=>(a?.week||0) > (b?.week||0) ? a : b);
  if(!latest || !latest.polls) return null;
  const poll = latest.polls.find(p => pollLabel==='AP' ? /AP/i.test(p.poll) : /Coach/i.test(p.poll));
  if(!poll) return null;
  const teams = (poll.ranks||[]).slice(0,25).map(r=>({
    rk: r.rank, team: r.school, rec: r.record || '', conf: r.conference || ''
  }));
  return { poll: pollLabel, season: latest.season, week: latest.week, lastUpdated: new Date().toISOString(), teams };
}

export default async function handler() {
  try {
    const year = new Date().getFullYear();
    const res = await fetch(`${CFBD_URL}?year=${year}`, {
      headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` }
    });
    if(!res.ok) return new Response(JSON.stringify({ok:false, error:'CFBD fetch failed'}), {status:200});
    const data = await res.json();

    const ap = buildJson(data, 'AP');
    const coaches = buildJson(data, 'Coaches');

    const out = { ok:true };

    if(ap){
      const apPut = await put('tcd-ap.json', JSON.stringify(ap), { access:'public', contentType:'application/json' });
      out.apUrl = apPut.url;
    }
    if(coaches){
      const cPut = await put('tcd-coaches.json', JSON.stringify(coaches), { access:'public', contentType:'application/json' });
      out.coachesUrl = cPut.url;
    }

    return new Response(JSON.stringify(out), {status:200});
  } catch(e){
    return new Response(JSON.stringify({ok:false, error:String(e)}), {status:200});
  }
}
