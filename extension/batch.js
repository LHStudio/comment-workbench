/* The review page owns one user-selected, existing Douyin tab; never creates a profile. */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let batchRunning=false,halt=false,tabId=null;
const queries=['豆包看病','DeepSeek看病','蚂蚁阿福健康问答','AI看病靠谱吗','小荷AI医生','AI解读体检报告','ChatGPT看病','千问健康咨询','AI问诊体验','AI看病误诊','豆包看报告','蚂蚁阿福问诊体验','人工智能健康咨询','用AI看病的人','AI医生怎么看'];
const status=s=>document.getElementById('batchStatus').textContent=s;
const signal=async(action,extra={})=>chrome.tabs.sendMessage(tabId,{action,...extra});
const readBatch=async()=> (await chrome.storage.local.get('batchProgress')).batchProgress||{finished:[],ids:[],queries:[],target:2000};
async function total(ids){
 const keys=[...new Set(ids)].map(i=>'video:https://www.douyin.com/video/'+i);
 const records=await chrome.storage.local.get(keys);
 return Object.values(records).reduce((n,v)=>n+(v?.comments?.length||0),0);
}
async function ready(url){
 await chrome.tabs.update(tabId,{url});
 for(let i=0;i<40&&!halt;i++){
  await sleep(450);
  const t=await chrome.tabs.get(tabId);
  if(t.status==='complete'&&t.url?.split('?')[0]===url.split('?')[0]){try{const s=await signal('status');if(s?.ok)return true;}catch{}}
 }return false;
}
async function runBatch(){
 if(batchRunning)return;
 if(!await navigator.locks.request('dy-batch-claim',{ifAvailable:true},l=>!!l))return status('另一个整理页已有批次');
 await navigator.locks.request('dy-batch-claim',{ifAvailable:true},async lock=>{
 if(!lock)return status('另一个整理页已有批次');
 batchRunning=true;halt=false;
 try{
 const tabs=await chrome.tabs.query({url:'https://www.douyin.com/*',currentWindow:true});
 const explicit=Number(document.getElementById('batchTab').value);
 const tab=explicit?tabs.find(t=>t.id===explicit):tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
 if(!tab)throw Error('未找到当前窗口中的抖音标签页。');
 tabId=tab.id;
 const p=await readBatch();
 const seed=(await (await fetch(chrome.runtime.getURL('sources.txt'))).text()).trim().split(/\s+/).filter(id=>/^\d{15,22}$/.test(id));
 p.ids=[...new Set([...p.ids,...seed])];
 const checkpoint=()=>chrome.storage.local.set({batchProgress:p});
 await checkpoint();
 for(;;){
  if(halt)break;
  const n=await total(p.ids);
  if(n>=p.target){status(`已完成 ${n} 条`);break;}
  const id=p.ids.find(i=>!p.finished.includes(i));
  if(!id){
    const q=queries.find(x=>!p.queries.includes(x));if(!q){status(`候选已用完，共 ${n} 条`);break;}
    status(`搜索：${q} · ${n} / ${p.target}`);
    const url='https://www.douyin.com/search/'+encodeURIComponent(q);
    if(!await ready(url)){if(halt)break;throw Error('搜索页未连接；批次已暂停');}
    const result=await signal('discover');
    if(result?.blocked)throw Error('出现登录或验证提示，已暂停');
    if(!Array.isArray(result?.ids))throw Error('请重新加载扩展后刷新抖音页面');
    p.ids=[...new Set([...p.ids,...result.ids])];p.queries.push(q);await checkpoint();continue;
  }
  status(`第 ${p.finished.length+1} 个视频 · ${n} / ${p.target}`);
  const url='https://www.douyin.com/video/'+id;
  if(await ready(url)){
   const key='video:'+url;
   const v=(await chrome.storage.local.get(key))[key];
   const limit=Math.min(50,(v?.comments?.length||0)+p.target-n);
   const started=await signal('start',{limit});if(started?.ok){
    let s;for(let i=0;i<440&&!halt;i++){await sleep(950);s=await signal('status');if(!s.running)break;}
    if(s?.running)await signal('stop');
    if(/验证|登录|错误/.test(s?.state||''))throw Error(s.state);
   }
  }else{
   if(halt)break;
   const t=await chrome.tabs.get(tabId);
   if(!t.url?.startsWith('https://www.douyin.com/')||/验证|登录/.test(t.title||''))throw Error('未进入作品或需要验证，已暂停');
  }
  if(halt)break;p.finished.push(id);await checkpoint();await load();
 }
 if(halt)status('已停止，进度已保存');
 }catch(e){status('批次暂停：'+e.message);}
 finally{batchRunning=false;await load();}
 });
}
document.getElementById('batch').onclick=runBatch;
document.getElementById('halt').onclick=async()=>{halt=true;if(tabId)try{await signal('stop');}catch{}};
