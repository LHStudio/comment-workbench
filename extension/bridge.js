importScripts('sites.js');
// Pairing credentials live in extension-origin IndexedDB, not content-script storage.
function configDb(){
 return new Promise((resolve,reject)=>{const r=indexedDB.open('comment-workbench',1);
 r.onupgradeneeded=()=>r.result.createObjectStore('config');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
}
async function conf(op,val){
 const db=await configDb();try{return await new Promise((ok,no)=>{
  const t=db.transaction('config',op==='get'?'readonly':'readwrite'),s=t.objectStore('config');
  const r=op==='get'?s.get('bridge'):op==='clear'?s.delete('bridge'):s.put(val,'bridge');
  t.oncomplete=()=>ok(r.result);t.onabort=()=>no(t.error);t.onerror=()=>no(t.error);
 })}finally{db.close()}
}
async function send(cfg,path,body){
 if(!Number.isInteger(cfg.port)||cfg.port<1024||cfg.port>65535)throw Error('端口应为 1024–65535');
 let res;try{res=await fetch(`http://127.0.0.1:${cfg.port}/api/${path}`,{method:'POST',redirect:'error',
  credentials:'omit',headers:{'Content-Type':'application/json','X-Pair-Key':cfg.key},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)})}
 catch{throw Error('未连接。请启动本机工作台并检查端口；样本仍在插件中。')}
 if(!res.ok)throw Error(res.status===403?'配对码不匹配':`接收失败（${res.status}）`);
 return res.json();
}
async function sync(cfg,only){
 const all=await chrome.storage.local.get(null);
 const rows=[];
 for(const [k,v] of Object.entries(all)){
  if(!k.startsWith('video:')||!Array.isArray(v?.comments)||Sites.work(v.url)?.url!==v.url||!v.url||(only&&v.url!==only))continue;
  const group=all['review:'+JSON.stringify([k])]?.group||v.group||'unknown';
  for(const c of v.comments){
   if(!c.key||!c.text||(all['review:'+JSON.stringify([k,c.key])]?.dropped??c.deleted))continue;
   rows.push({url:v.url,title:v.title||'',group,key:c.key,text:c.text,nickname:c.nickname||'',capturedAt:c.capturedAt||''});
  }
 }
 let added=0,dups=0;
 for(let i=0;i<rows.length;i+=50){const r=await send(cfg,'receive',{rows:rows.slice(i,i+50)});added+=r.added;dups+=r.duplicate}
 return `已发送 ${rows.length} 条：新增 ${added}，已存在 ${dups}。`;
}
async function act(m,sender){
 const settings=sender.url===chrome.runtime.getURL('review.html');
 if(m.action==='bridge.finished'){
  const work=Sites.work(m.url);
  if(!work || work.url!==m.url || !sender.tab || !(Sites.work(sender.url)?.url===m.url ||
    (work.label==='抖音视频' && sender.url?.startsWith('https://www.douyin.com/'))))return;
 }else if(!settings)throw Error('仅整理页可管理连接');
 if(m.action==='bridge.pair'){
  const cfg={port:m.port,key:String(m.key||'').trim(),auto:!!m.auto};const r=await send(cfg,'pair',{});
  if(r.app!=='comment-workbench-v1')throw Error('端口不是评论工作台');
  await conf('set',cfg);return {note:'配对成功',port:cfg.port,auto:cfg.auto};
 }
 if(m.action==='bridge.clear'){await conf('clear');return {note:'已断开'};}
 const cfg=await conf('get');
 if(m.action==='bridge.info')return {paired:!!cfg,port:cfg?.port,auto:cfg?.auto,note:(await chrome.storage.local.get('bridgeNote')).bridgeNote};
 if(m.action==='bridge.finished'&&!cfg?.auto)return;
 if(!cfg)throw Error('请先连接并保存');
 return {note:await sync(cfg,m.action==='bridge.finished'?m.url:null)};
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(!['bridge.info','bridge.finished','bridge.clear','bridge.pair','bridge.push'].includes(m?.action))return;
 act(m,s).then(async r=>{if(r?.note&&m.action!=='bridge.info')await chrome.storage.local.set({bridgeNote:r.note});reply({ok:true,...r})})
 .catch(async e=>{await chrome.storage.local.set({bridgeNote:e.message});reply({ok:false,note:e.message})});
 return true;
});
