const $=id=>document.getElementById(id);
const store=chrome.storage.local;
const base=[['unknown','未设置'],['general','通用模型'],['specialized','医疗健康专用模型'],['both','两类都讨论'],['other','其他']];
let all={},types=[],opened=new Set();
const vids=()=>Object.entries(all).filter(([k,v])=>k.startsWith('video:')&&Array.isArray(v?.comments));
const vk=k=>'review:'+JSON.stringify([k]);
const rk=(k,c)=>'review:'+JSON.stringify([k,c.key]);
const kept=(k,c)=>!(all[rk(k,c)]?.dropped??c.deleted);
const group=(k,v)=>all[vk(k)]?.group||v.group||'unknown';
const name=id=>types.find(t=>t[0]===id)?.[1]||'未设置';
function el(tag,text){let e=document.createElement(tag);if(text!=null)e.textContent=text;return e;}
function btn(text,fn){const e=el('button',text);e.onclick=fn;return e;}
function fmt(t){return t&&Number.isFinite(Date.parse(t))?new Date(t).toLocaleString('zh-CN',{hour12:false}):'未记录';}
async function load(){all=await store.get(null);types=all.videoTypes||base.map(x=>[...x]);render();}
async function edit(key,patch){all[key]={...all[key],...patch};await store.set({[key]:all[key]});}
function render(){
 const q=$('search').value.trim().toLowerCase(),list=$('list');list.replaceChildren();
 let n=0;
 for(const [k,v] of vids().sort((a,b)=>(b[1].updated||'').localeCompare(a[1].updated||''))){
  const rows=v.comments.filter(c=>kept(k,c));n+=rows.length;
  const matching=rows.filter(c=>[v.title,c.nickname,c.text].some(s=>String(s||'').toLowerCase().includes(q)));
  if(q&&!matching.length&&!v.title?.toLowerCase().includes(q))continue;
  const d=el('details'),s=el('summary'),ul=el('ul'),bar=el('div');
  s.append(el('strong',v.title||'标题未识别'),el('small',`${rows.length} 条 · 最近采集 ${fmt(v.updated)}`));
  bar.className='controls';const select=el('select');select.setAttribute('aria-label','作品类型');
  for(const [id,label] of types){const opt=el('option',label);opt.value=id;select.append(opt);}
  select.value=types.some(([id])=>id===group(k,v))?group(k,v):'unknown';
  select.onchange=()=>edit(vk(k),{group:select.value});
  bar.append(el('label','作品类型'),select,btn('删除此作品',()=>removeSamples(k)));
  const fill=()=>{ul.replaceChildren();if(!d.open)return;
   for(const c of matching){const li=el('li'),info=el('div');
    info.append(el('small',`${c.nickname||'昵称未记录'} · ${fmt(c.capturedAt)}`),el('div',c.text));
    li.append(info,btn('移出样本',async()=>{await edit(rk(k,c),{dropped:true});render();}));ul.append(li);}
  };
  d.append(s,bar,ul);d.open=!!q||opened.has(k);
  d.ontoggle=()=>{if(!q){if(d.open)opened.add(k);else opened.delete(k);}fill();};
  const a=el('article');a.append(d);list.append(a);fill();
 }
 $('stats').textContent=`${vids().length} 个作品 · ${n} 条保留评论`;
 if(!list.children.length)list.append(el('p',q?'没有匹配的评论':'暂无样本'));
}
async function removeSamples(key){
 if(!confirm(key?'删除这个作品及其全部评论？':'清空所有作品、评论和整理标记？类型设置将保留。'))return;
 const tabs=await chrome.tabs.query({url:['https://www.douyin.com/*','https://www.zhihu.com/*','https://zhuanlan.zhihu.com/*']});
 for(const t of tabs){let s;try{s=await chrome.tabs.sendMessage(t.id,{action:'status'});}catch{}
  if(s?.running){$('notice').textContent='请先停止正在进行的采集，再删除。';return;}}
 const latest=await store.get(null);
 const keys=Object.keys(latest).filter(x=>{
  if(x.startsWith('video:'))return !key||x===key;
  if(!x.startsWith('review:'))return false;
  if(!key)return true;try{return JSON.parse(x.slice(7))[0]===key;}catch{return false;}
 });
 await store.remove(keys);await load();
}
async function saveTypes(){await store.set({videoTypes:types});renderTypes();render();}
function renderTypes(){
 const box=$('types');box.replaceChildren();
 for(const [id,title] of types){
  const r=el('div');r.className='typeRow';
  if(base.some(x=>x[0]===id)){r.append(el('span',title),el('small','内置'));}else{
   const field=el('input');field.value=title;field.maxLength=40;field.setAttribute('aria-label','类型名称');
   r.append(field,btn('保存',async()=>{let s=field.value.trim();if(!s||types.some(([i,t])=>i!==id&&t===s))return;types=types.map(x=>x[0]===id?[id,s]:x);await saveTypes();}),
    btn('删除',async()=>{if(!confirm('删除类型？使用它的作品将显示为未设置，评论不会删除。'))return;types=types.filter(x=>x[0]!==id);await saveTypes();}));
  }box.append(r);
 }
}
$('addtype').onsubmit=async e=>{e.preventDefault();const s=$('typename').value.trim();if(!s||types.some(x=>x[1]===s))return;types=[...types,['custom:'+crypto.randomUUID(),s]];$('typename').value='';await saveTypes();};
$('manage').onclick=()=>{renderTypes();$('settings').showModal();};
$('clear').onclick=()=>removeSamples(null);
$('refresh').onclick=load;$('search').oninput=render;
const cell=x=>{let s=String(x??'');if(/^\s*[=+@-]|^[\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
$('export').onclick=async()=>{
 await load();const rows=[['作品标题','作品链接','作品类型','评论人昵称','评论正文','采集时间','作品最近采集时间']];
 for(const [k,v] of vids())for(const c of v.comments)if(kept(k,c))rows.push([v.title,v.url,name(group(k,v)),c.nickname,c.text,c.capturedAt,v.updated]);
 const a=el('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));a.download='评论工作台_原始评论.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
load();
