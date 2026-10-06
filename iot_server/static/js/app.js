// ============ UTIL & ANIMASI ============
const $=id=>document.getElementById(id);
const seen=new Set();
function toast(msg,kind='info'){
  const box=$('toasts');
  while(box.children.length>=3) box.removeChild(box.firstChild); // maksimal 3 toast
  const t=document.createElement('div');
  t.className='toast '+kind; t.textContent=msg;
  box.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),400);},4200);
}
function bump(el){el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump');}
function setTxt(id,txt){const el=$(id);if(el.textContent!==txt){el.textContent=txt;bump(el);}}
function tween(id,to,dec=0,suf=''){
  const el=$(id);
  if(to===null||to===undefined||isNaN(to)){el.textContent='-';return;}
  const from=parseFloat(el.dataset.v||'0')||0;
  el.dataset.v=to;
  const t0=performance.now(),dur=700;
  (function step(t){
    const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);
    el.textContent=(from+(to-from)*e).toFixed(dec)+suf;
    if(k<1)requestAnimationFrame(step);else bump(el);
  })(t0);
}
async function post(u){await fetch(u,{method:'POST'});refresh();}
async function setMode(m){
  await fetch('/api/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});
  toast('Mode kontrol: '+m,'info');refresh();
}
document.querySelectorAll('.menu button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  $(b.dataset.pg).classList.add('on');
  document.querySelectorAll('.menu button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');
});
setInterval(()=>{$('clock').textContent=new Date().toLocaleString('id-ID',
 {timeZone:'Asia/Jakarta',weekday:'long',day:'numeric',month:'long',year:'numeric',
  hour:'2-digit',minute:'2-digit',second:'2-digit'})+' WIB';},1000);

// ============ RENDER ============
const mstat=m=>m>=70?['Optimal','ok']:m>=40?['Perlu Air','warn']:['Kering','bad'];
const spark=(h,cls)=>{
  if(!h||h.length<2)return'';
  const w=120,ht=28;
  const pts=h.map((v,i)=>`${(i*(w/(h.length-1))).toFixed(1)},${(ht-3-(v/100)*(ht-6)).toFixed(1)}`).join(' ');
  return `<svg class="spark ${cls}" width="${w}" height="${ht}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
};
const nodeCard=(n,i)=>{
  const [txt,cls]=n.online?mstat(n.moisture):['Belum Tersambung','off'];
  return `<div class="card" style="animation-delay:${i*70}ms">
    <div class="muted">Bedeng ${n.bedeng} • ${n.id} <span class="dot ${n.online?'on':'off'}"></span></div>
    <div class="value ${cls}" id="nv-${n.id}">${n.online?n.moisture+'%':'--'}</div>
    <div class="${cls}" id="ns-${n.id}">${txt}</div>
    <div id="nk-${n.id}">${spark(n.hist,cls)}</div>
    <div class="muted" id="nl-${n.id}">Solenoid: ${n.valve?'TERBUKA':'TUTUP'}</div></div>`;
};
function renderNodes(nodes){
  document.querySelectorAll('.bedengGrid').forEach(g=>{
    if(g.dataset.n!==String(nodes.length)){
      g.dataset.n=nodes.length;
      g.innerHTML=nodes.map(nodeCard).join('')||'<div class="muted">Belum ada node. Node baru muncul otomatis.</div>';
    }else{
      nodes.forEach(n=>{
        const v=$('nv-'+n.id);if(!v)return;
        const [txt,cls]=n.online?mstat(n.moisture):['--','off'];
        const val=n.online?n.moisture+'%':'--';
        if(v.textContent!==val){v.textContent=val;v.className='value '+cls;bump(v);}
        $('ns-'+n.id).textContent=txt;$('ns-'+n.id).className=cls;
        $('nl-'+n.id).textContent='Solenoid: '+(n.valve?'TERBUKA':'TUTUP');
        $('nk-'+n.id).innerHTML=spark(n.hist,cls);
      });
    }
  });
}
function renderPeta(nodes){
  const g=$('petaGrid');
  const blocks={};
  nodes.forEach(n=>{(blocks[n.block]=blocks[n.block]||[]).push(n);});
  const keys=Object.keys(blocks).sort();
  const sig=keys.map(k=>k+blocks[k].length).join(',')+nodes.length;
  if(g.dataset.sig!==sig){
    g.dataset.sig=sig;
    g.innerHTML=keys.map(b=>`<div class="sec2">BLOK ${b}</div>`+
      blocks[b].map((n,i)=>`<div class="card" id="pt-${n.id}" style="text-align:center;animation-delay:${i*60}ms">
        <b>Bedeng ${n.bedeng}</b><br><span id="pts-${n.id}">--</span></div>`).join('')).join('')
      ||'<div class="muted">Belum ada node.</div>';
  }
  nodes.forEach(n=>{
    const el=$('pt-'+n.id);if(!el)return;
    const c=!n.online?'#94a3b8':n.moisture>=70?'#16a34a':n.moisture>=40?'#f59e0b':'#dc2626';
    el.style.borderTop='6px solid '+c;
    $('pts-'+n.id).innerHTML=n.online
      ?`<span class="${mstat(n.moisture)[1]}">${n.moisture}%</span>`
      :'<span class="off">Belum Tersambung</span>';
  });
}
function renderValves(nodes){
  const g=$('valveList');
  if(g.dataset.n!==String(nodes.length)){
    g.dataset.n=nodes.length;
    g.innerHTML=nodes.map(n=>`<div class="card" style="margin-bottom:6px">
      Blok ${n.block} • Bedeng ${n.bedeng} (${n.id}) —
      <span id="vs-${n.id}">-</span>
      <button class="btn b" onclick="post('/api/manual/valve/${n.id}/on')">Buka</button>
      <button class="btn y" onclick="post('/api/manual/valve/${n.id}/off')">Tutup</button></div>`).join('')
      ||'<div class="muted">Belum ada node.</div>';
  }
  nodes.forEach(n=>{
    const s=$('vs-'+n.id);
    if(s)s.innerHTML=n.valve?'<b class="ok">TERBUKA</b>':'<b class="off">TUTUP</b>';
  });
}
const notifHTML=l=>l.length?l.map(n=>`<div class="card" style="margin-bottom:6px">
  <span class="pill ${n.kind==='warn'?'y':n.kind==='ok'?'g':'b'}">${n.kind.toUpperCase()}</span>
  ${n.msg} <span class="muted">• ${n.t}</span></div>`).join(''):'<div class="muted">Tidak ada notifikasi.</div>';
function renderNotifs(list){
  const sig=list.length+'|'+(list[0]?list[0].t+list[0].msg:'');
  if($('dashNotif').dataset.sig!==sig){
    $('dashNotif').dataset.sig=sig;
    $('dashNotif').innerHTML=notifHTML(list.slice(0,5));
    $('allNotif').innerHTML=notifHTML(list);
  }
}
const detHTML=l=>l.length?l.map((d,i)=>`<div class="det" style="animation-delay:${i*80}ms">
  <img src="${d.img}"><div><b>Blok ${d.blok} - Bedeng ${d.bedeng} - Pohon ${d.pohon}</b><br>
  <span class="muted">${d.t} • mode: ${d.mode}</span><br>
  <span class="${d.deficit?'bad':'ok'}">${d.deficit} pohon defisit/mati</span> • ${d.total} objek<br>
  <span class="muted">${Object.entries(d.counts).map(([k,v])=>k+': '+v).join(', ')}</span></div></div>`).join('')
  :'<div class="muted">Belum ada analisa drone.</div>';
function renderDetTable(list){
  const tb=$('detTable');if(!tb)return;
  if(tb.dataset.n!==String(list.length)){
    tb.dataset.n=list.length;
    tb.innerHTML=list.map(d=>`<tr><td>${d.blok}</td><td>${d.bedeng}</td><td>${d.pohon}</td>
      <td>${d.t}</td><td class="${d.deficit?'bad':'ok'}">${d.deficit?d.deficit+' mati/defisit':'SEHAT'}</td>
      <td><a href="${d.img}" target="_blank">lihat</a></td></tr>`).join('')
      ||'<tr><td colspan=6>Belum ada data deteksi.</td></tr>';
  }
}

// ============ REFRESH ============
async function refresh(){
  let d;
  try{d=await (await fetch('/api/state')).json();}catch(e){return;}
  setTxt('sysNode',`${d.online_count}/${d.total} Node`);
  $('sysStat').textContent=d.serial_ok?'ONLINE':'SERIAL ERR';
  $('sysStat').className='pill '+(d.serial_ok?'ok':'bad');
  $('sysAI').textContent='AI: '+(d.ai.ok?'OK ('+d.ai.msg+')':d.ai.msg);
  const w=d.weather;
  setTxt('wchip',w.ok?`☀️ ${w.temp}°C • ${w.label} • Indramayu`:'Cuaca: offline');
  tween('rTemp',w.ok?w.temp:NaN,1,'°C'); setTxt('rWl',w.label);
  tween('rHum',w.ok?w.hum:NaN,0,'%'); setTxt('rRain',w.ok?String(w.rain):'-');
  tween('rAvg',d.avg,0,'%');
  setTxt('rAvgS',d.avg===null?'-':mstat(d.avg)[0]);
  tween('rToren',d.toren.level,0,'%');
  setTxt('rTorenS',d.toren.dist===null?'Sensor error':`Jarak ${d.toren.dist.toFixed(0)} cm`);
  $('rPump').innerHTML=d.pump?'<span class="ok">ON</span>':'<span class="bad">OFF</span>';
  setTxt('rValve',`${d.open_count} / ${d.total}`);
  setTxt('rMode',d.mode);
  setTxt('iDist',d.toren.dist===null?'-':d.toren.dist.toFixed(1)+' cm');
  $('iTpump').innerHTML=d.toren.tpump?'<span class="ok">ON</span>':'<span class="off">OFF</span>';
  $('iPump').innerHTML=d.pump?'<span class="ok">ON</span>':'<span class="off">OFF</span>';
  renderNodes(d.nodes); renderPeta(d.nodes); renderValves(d.nodes);
  renderNotifs(d.notifs);
  renderDetTable(d.detections);
  if($('dashDet').dataset.n!==String(d.detections.length)){
    $('dashDet').dataset.n=d.detections.length;
    $('dashDet').innerHTML=detHTML(d.detections.slice(0,3));
  }
  if($('histBody').dataset.n!==String(d.history.length)){
    $('histBody').dataset.n=d.history.length;
    $('histBody').innerHTML=d.history.map(h=>`<tr><td>${h.mulai}</td><td>${h.akhir||'-'}</td>
      <td>${h.durasi?h.durasi+' dtk':'berjalan'}</td><td>${h.mode}</td></tr>`).join('')
      ||'<tr><td colspan=4>Belum ada riwayat.</td></tr>';
  }
  d.notifs.forEach(n=>{
    const k=n.t+n.msg;
    if(!seen.has(k)){seen.add(k);if(seen.size>200)seen.clear();toast(n.msg,n.kind);}
  });
  const f=$('cfgForm');
  if(f&&(!document.activeElement||document.activeElement.form!==f)){
    f.soil_on.value=d.th.soil_on; f.soil_off.value=d.th.soil_off;
    f.tank_on.value=d.th.tank_on;f.tank_off.value=d.th.tank_off;
    f.tank_height.value=d.th.tank_height;
    f.sched_time.value=d.th.sched_time;
    f.sched_below.value=d.th.sched_below;
    f.sched_enabled.checked=!!d.th.sched_enabled;
  }
}

// ============ FORM & KAMERA ============
async function sendDetect(fd){
  const btns=[$('upBtn'),$('camBtn')];
  btns.forEach(b=>{if(b){b.disabled=true;b.classList.add('loading');}});
  try{
    const r=await fetch('/api/drone/upload',{method:'POST',body:fd});
    const j=await r.json();
    if(!j.ok)toast(j.msg,'warn');
    else{toast(`Deteksi selesai: ${j.rec.deficit} pohon defisit/mati`,'ok');
      $('cekResult').innerHTML=detHTML([j.rec]);refresh();}
  }catch(e){toast('Gagal menghubungi server','warn');}
  btns.forEach(b=>{if(b){b.disabled=false;b.classList.remove('loading');}});
}
$('upForm').onsubmit=async e=>{
  e.preventDefault();
  await sendDetect(new FormData(e.target));
  e.target.querySelector('input[type=file]').value='';
};
let camStream=null;
async function openCam(){
  try{
    camStream=await navigator.mediaDevices.getUserMedia({video:true});
    $('cam').srcObject=camStream; $('camBox').style.display='block';
  }catch(e){toast('Kamera tidak tersedia: '+e.message,'warn');}
}
function closeCam(){
  if(camStream){camStream.getTracks().forEach(t=>t.stop());camStream=null;}
  $('camBox').style.display='none';
}
async function captureDetect(){
  const v=$('cam');
  if(!v.videoWidth){toast('Kamera belum siap','warn');return;}
  const c=document.createElement('canvas');
  c.width=v.videoWidth;c.height=v.videoHeight;
  c.getContext('2d').drawImage(v,0,0);
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.9));
  const fd=new FormData();
  fd.append('file',blob,'kamera_'+Date.now()+'.jpg');
  fd.append('blok',$('upForm').blok.value||'-');
  fd.append('bedeng',$('upForm').bedeng.value||'-');
  fd.append('pohon',$('upForm').pohon.value||'-');
  await sendDetect(fd);
}
$('cfgForm').onsubmit=async e=>{
  e.preventDefault();const f=e.target;
  await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({soil_on:+f.soil_on.value,soil_off:+f.soil_off.value,
      tank_on:+f.tank_on.value,tank_off:+f.tank_off.value,tank_height:+f.tank_height.value,
      sched_time:f.sched_time.value,sched_below:+f.sched_below.value,
      sched_enabled:f.sched_enabled.checked?1:0})});
  toast('Threshold disimpan','ok');refresh();
};

// ============ GRAFIK SVG ============
const PAL=['#16a34a','#f59e0b','#3b82f6','#dc2626','#8b5cf6','#0ea5e9','#ec4899'];
function lineChart(el,labels,series){
  const W=640,H=240,L=34,B=26,T=10,R=8,iw=W-L-R,ih=H-T-B;
  let g='';
  [0,25,50,75,100].forEach(v=>{const y=T+ih-(v/100)*ih;
    g+=`<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="#e2e8f0"/><text x="${L-6}" y="${y+4}" font-size="9" fill="#94a3b8" text-anchor="end">${v}</text>`;});
  let xl='';
  labels.forEach((lb,i)=>{const x=L+(labels.length>1?i*iw/(labels.length-1):iw/2);
    xl+=`<text x="${x}" y="${H-8}" font-size="9" fill="#94a3b8" text-anchor="middle">${lb}</text>`;});
  let ln='';
  series.forEach(s=>{
    const pts=[];
    s.values.forEach((v,i)=>{if(v===null||v===undefined)return;
      const x=L+(labels.length>1?i*iw/(labels.length-1):iw/2),y=T+ih-(v/100)*ih;
      pts.push(x.toFixed(1)+','+y.toFixed(1));});
    if(pts.length)ln+=`<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width||2}"/>`;
  });
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}">${g}${xl}${ln}</svg>`;
}
function barChart(el,labels,series){
  const W=640,H=240,L=34,B=26,T=10,R=8,iw=W-L-R,ih=H-T-B;
  const max=Math.max(10,...series.flatMap(s=>s.values.map(v=>v||0)));
  let g='';
  [0,0.5,1].forEach(f=>{const y=T+ih-f*ih;
    g+=`<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="#e2e8f0"/><text x="${L-6}" y="${y+4}" font-size="9" fill="#94a3b8" text-anchor="end">${Math.round(max*f)}</text>`;});
  let bars='';const gw=iw/labels.length,bw=gw*0.7/series.length;
  labels.forEach((lb,i)=>{
    series.forEach((s,si)=>{
      const v=s.values[i]||0,h=(v/max)*ih,x=L+i*gw+gw*0.15+si*bw,y=T+ih-h;
      bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw*0.9).toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}" rx="2"><title>${s.name} ${lb}: ${v} ${s.unit||''}</title></rect>`;
    });
    bars+=`<text x="${(L+i*gw+gw/2).toFixed(1)}" y="${H-8}" font-size="9" fill="#94a3b8" text-anchor="middle">${lb}</text>`;
  });
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}">${g}${bars}</svg>`;
}
async function loadCharts(){
  try{
    const c=await (await fetch('/api/charts')).json();
    if(!c.has_data){
      $('chartMoist').innerHTML='<div class="muted">Belum ada data. Grafik terisi otomatis (snapshot tiap 5 menit).</div>';
      $('chartIrr').innerHTML='<div class="muted">Belum ada riwayat penyiraman.</div>';
      return;
    }
    const series=[{name:'RATA-RATA',color:'#0b3d2e',width:3,values:c.overall}];
    c.nodes.forEach((n,i)=>series.push({name:n.id,color:PAL[i%PAL.length],values:n.values}));
    lineChart($('chartMoist'),c.labels,series);
    $('chartMoistLegend').innerHTML=series.map(s=>`<span class="lg"><i style="background:${s.color}"></i>${s.name}</span>`).join('');
    barChart($('chartIrr'),c.labels,[
      {name:'Menit penyiraman',color:'#3b82f6',values:c.minutes,unit:'menit'},
      {name:'Valve dibuka (auto+manual)',color:'#22c55e',values:c.valveopens,unit:'x'}
    ]);
    $('chartIrrLegend').innerHTML=`<span class="lg"><i style="background:#3b82f6"></i>Menit penyiraman</span>
      <span class="lg"><i style="background:#22c55e"></i>Valve dibuka (auto+manual)</span>`;
  }catch(e){}
}
setInterval(loadCharts,30000); loadCharts();
setInterval(refresh,2500);
refresh();