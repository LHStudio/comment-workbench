const $=id=>document.getElementById(id);
$('version').textContent='v'+chrome.runtime.getManifest().version;
for(const {id,label,home} of Sites.platforms){
  const a=document.createElement('a'),icon=document.createElement('img'),text=document.createElement('span');
  a.href=home;a.target='_blank';a.rel='noopener noreferrer';a.title='打开'+label+'主页';
  icon.src='icons/'+id+'.svg';icon.alt='';text.textContent=label;a.append(icon,text);$('platformLinks').append(a);
}
async function request(action,params={}){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const platform=Sites.work(tab?.url)?.label || (tab?.url?.startsWith('https://www.douyin.com/')?'抖音视频':'');
  $('heading').textContent=platform?'采集'+platform:'采集当前作品';
  if(!platform)throw Error('请打开微博正文、B站视频、小红书笔记、抖音作品或知乎文章／回答详情');
  return chrome.tabs.sendMessage(tab.id,{action,...params});
}
function draw(count,limit){$('count').textContent=`${count} / ${limit}`;$('bar').max=limit;$('bar').value=count;}
async function poll(){
  try{
    const p=await request('status');if(!p?.ok)return;
    $('phase').textContent=p.state;$('start').disabled=p.running;$('stop').disabled=!p.running;
    $('limit').disabled=p.running;document.querySelectorAll('[data-n]').forEach(b=>b.disabled=p.running);
    if(p.running&&p.limit)$('limit').value=p.limit;
    $('bar').hidden=!!p.completed;
    if(p.completed)$('count').textContent=`上限 ${p.limit} 条`;
    else draw(p.count||0,p.running?p.limit:Number($('limit').value)||100);
  }catch(e){$('phase').textContent=e.message.includes('请打开')?e.message:'未连接，请刷新作品页';$('start').disabled=true;$('stop').disabled=true;}
}
document.querySelectorAll('[data-n]').forEach(b=>b.onclick=()=>{$('limit').value=b.dataset.n;poll();});
$('start').onclick=async()=>{
  if(!$('limit').reportValidity())return;
  try{const limit=Number($('limit').value);const result=await request('start',{limit});
    if(!result?.ok)throw Error(result?.message||'未启动');
    await chrome.storage.local.set({captureLimit:limit});$('msg').textContent='';await poll();
  }catch(e){$('msg').textContent=`${e.message}。更新插件后请刷新作品页。`;}
};
$('stop').onclick=async()=>{try{await request('stop');$('phase').textContent='正在停止';}catch(e){$('msg').textContent=e.message;}};
$('review').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('review.html')});
$('openTopic').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('review.html?view=topic')});
chrome.storage.local.get('captureLimit').then(v=>{$('limit').value=v.captureLimit||50;poll();setInterval(poll,1200);});
