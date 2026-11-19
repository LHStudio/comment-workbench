(()=>{
 const by=id=>document.getElementById(id),msg=(action,extra)=>chrome.runtime.sendMessage({action:'bridge.'+action,...extra});
 const tell=t=>by('bridgeStatus').textContent=t;
 async function refresh(){const r=await msg('info');if(r.port)by('port').value=r.port;if(r.paired)by('autoSend').checked=r.auto;
 by('push').disabled=!r.paired;by('disconnect').disabled=!r.paired;tell([r.paired?'已配对':'未配对',r.note].filter(Boolean).join(' · '));}
 async function run(action,params){try{tell('正在处理…');const r=await msg(action,params);await refresh();tell(r.note||'已完成');
 if(r.ok&&action==='pair')by('pairKey').value='';}catch(e){tell(e.message)}}
 by('pairForm').onsubmit=e=>{e.preventDefault();run('pair',{port:Number(by('port').value),key:by('pairKey').value,auto:by('autoSend').checked})};
 by('push').onclick=()=>run('push');by('disconnect').onclick=()=>run('clear');
 chrome.storage.onChanged.addListener(c=>{if(c.bridgeNote)tell(c.bridgeNote.newValue)});
 refresh().catch(e=>tell(e.message));
})();
