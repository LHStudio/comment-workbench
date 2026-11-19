/* The organizer drives a serial queue. Reloading it never starts paid/network work. */
(() => {
  const panel=document.getElementById('topicPanel');
  if(!panel)return;
  const KEY='topicQueueV1', STOP='topicStopV1', SESSION='topicNavigationV1', LOCK='comment-topic-run';
  const db=chrome.storage.local, session=chrome.storage.session, wait=ms=>new Promise(r=>setTimeout(r,ms));
  const $=id=>panel.querySelector('#'+id), label=id=>Sites.platforms.find(p=>p.id===id)?.label||id;
  const read=async()=> (await db.get(KEY))[KEY];
  const saved=q=>db.set({[KEY]:q});
  const next=q=>q.items.find(i=>!['done','skipped'].includes(i.state));
  const site=q=>q.searches.find(s=>s.state==='pending');
  const tell=s=>{ $('topicNotice').textContent=s; };
  const names={pending:'待处理',active:'采集中',partial:'未完成',done:'已完成',skipped:'已跳过',
    confirm:'等待确认',running:'执行中',paused:'已暂停',searching:'检索中'};
  panel.innerHTML=`<h2>关键词采集</h2><form id="topicForm">
    <label>检索主题<input id="topicTerm" type="search" maxlength="100" placeholder="输入关键词" required></label>
    <fieldset id="topicPlatforms"><legend>检索平台</legend></fieldset>
    <div class="topicOptions"><label>每平台作品上限<input id="topicWorks" type="number" min="1" max="50" value="5" required></label>
    <label>每篇评论上限<input id="topicComments" type="number" min="1" max="1000" value="50" required></label>
    <label>采集方式<select id="topicMode"><option value="manual">逐个确认</option><option value="auto">自动串行</option></select></label>
    <button id="topicStart" class="primary" type="submit">开始检索</button></div></form>
    <div class="controls"><button id="topicNext" type="button">继续</button><button id="topicSkip" type="button">跳过</button><button id="topicPause" type="button">暂停</button></div>
    <p id="topicNotice" role="status"></p><div id="topicProgress" aria-live="polite"></div><ol id="topicItems"></ol>`;
  for(const p of Sites.platforms){
    const l=document.createElement('label'),b=document.createElement('input');
    b.type='checkbox';b.name='topicPlatform';b.value=p.id;b.checked=true;l.append(b,p.label);$('topicPlatforms').append(l);
  }
  let shownId=null, locallyRunning=false;
  function paint(q){
    const rows=$('topicItems');rows.replaceChildren();
    $('topicNext').disabled=!q||q.phase==='done'||locallyRunning;
    $('topicSkip').disabled=!q||!['confirm','paused'].includes(q.phase)||locallyRunning;
    $('topicPause').disabled=!q||['paused','done'].includes(q.phase);
    if(!q){$('topicProgress').textContent='尚无采集任务';return;}
    if(shownId!==q.id){
      shownId=q.id;$('topicTerm').value=q.term;$('topicMode').value=q.mode;
      $('topicWorks').value=q.works;$('topicComments').value=q.comments;
      for(const b of panel.querySelectorAll('[name=topicPlatform]'))b.checked=q.searches.some(s=>s.platform===b.value);
    }
    $('topicNext').textContent=q.phase==='confirm'?'确认采集下一篇':(q.phase==='paused'?'继续 / 重试':'接续任务');
    const finished=q.items.filter(i=>i.state==='done').length;
    const stage=site(q)?`${label(site(q).platform)}检索`:next(q)?.title||'';
    $('topicProgress').textContent=`${q.term} · ${names[q.phase]} · 完成 ${finished}/${q.items.length} 篇${stage?' · '+stage:''}${q.reason?' · '+q.reason:''}`;
    const searches=document.createElement('p');
    searches.textContent=q.searches.map(s=>`${label(s.platform)} ${s.state==='pending'?'待检索':s.state==='skipped'?'跳过':'已检索'} ${q.items.filter(i=>i.platform===s.platform).length} 篇`).join(' / ');
    $('topicProgress').append(searches);
    for(const item of q.items){
      const li=document.createElement('li'),title=document.createElement('strong'),meta=document.createElement('small');
      title.textContent=item.title;meta.textContent=`${label(item.platform)} · ${names[item.state]} · 已保存 ${item.count} 条${item.note?' · '+item.note:''}`;
      li.append(title);
      if(Sites.work(item.url)?.url===item.url){
        const a=document.createElement('a');a.href=item.url;a.rel='noopener noreferrer';a.target='_blank';a.textContent='查看作品';
        a.onclick=async e=>{
          e.preventDefault();
          const n=await navigation(q),link=n.links[item.url];
          await chrome.tabs.create({url:Sites.work(link)?.url===item.url?link:item.url});
        };
        li.append(' · ',a);
      }
      li.append(meta);rows.append(li);
    }
  }
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[KEY])paint(changes[KEY].newValue);});
  const checked=async q=>{if((await db.get(STOP))[STOP]===q.id)throw Error('用户暂停；进度已保存');};
  async function navigation(q){
    const n=(await session.get(SESSION))[SESSION];
    return n?.id===q.id?n:{id:q.id,links:{},tab:null};
  }
  const saveNav=n=>session.set({[SESSION]:n});
  const same=(actual,expected)=>{
    if(!actual||!expected)return false;
    const w=Sites.work(expected);
    if(w)return Sites.work(actual)?.url===w.url;
    try{
      const a=new URL(actual),b=new URL(expected);
      return !a.username&&!a.password&&a.origin===b.origin&&a.pathname===b.pathname&&
        [...b.searchParams.keys()].every(k=>JSON.stringify(a.searchParams.getAll(k))===JSON.stringify(b.searchParams.getAll(k)));
    }catch{return false;}
  };
  // A tab id is only trusted within its browser session. Never navigate or remove
  // a tab the user changed; in particular never pick a tab by URL or recency.
  async function owned(n){
    if(!n.tab)return null;
    try {const t=await chrome.tabs.get(n.tab.id);return same(t.pendingUrl||t.url,n.tab.url)?t:null;}catch{return null;}
  }
  async function release(n){
    const t=await owned(n);
    if(t)await chrome.tabs.remove(t.id).catch(()=>{});
    n.tab=null;await saveNav(n);
  }
  async function open(n,url,q){
    const existing=await owned(n);
    if(existing && same(n.tab.url,url))return existing.id;
    await checked(q);
    await release(n);
    const t=await chrome.tabs.create({url,active:false});
    n.tab={id:t.id,url};await saveNav(n);return t.id;
  }
  const message=(id,action,extra={})=>chrome.tabs.sendMessage(id,{action,...extra});
  async function connect(q,id,url){
    for(let i=0;i<75;i++){
      await checked(q);
      const t=await chrome.tabs.get(id).catch(()=>null);
      if(!t)throw Error('采集标签已关闭，请重试');
      if(t.status==='complete'){
        if(!same(t.url,url))throw Error('页面已跳转，可能需要登录或验证；请在采集标签确认后重试');
        try{const p=await message(id,'topic.probe');if(p?.ok)return p;}catch{}
      }
      await wait(240);
    }
    throw Error('页面未连接；请检查网络、页面访问权限和扩展权限后重试');
  }
  async function search(q,s,n){
    const url=Sites.search(s.platform,q.term);
    q.phase='searching';await saved(q);
    const id=await open(n,url,q);
    await connect(q,id,url);
    let stable=0,last=-1;
    for(let i=0;i<14;i++){
      await checked(q);
      const r=await message(id,'topic.discover',{platform:s.platform,term:q.term,limit:q.works,advance:i>0});
      if(!r?.ok||!Array.isArray(r.rows))throw Error('尚未进入对应的搜索结果页');
      let count=q.items.filter(x=>x.platform===s.platform).length;
      for(const row of r.rows){
        const w=Sites.work(row.url);
        if(!w||w.platform!==s.platform||w.url!==row.url)continue;
        if(s.platform==='xhs' && row.openUrl && Sites.work(row.openUrl)?.url===w.url)n.links[w.url]=row.openUrl;
        if(count>=q.works||q.items.some(x=>x.url===w.url))continue;
        q.items.push({platform:s.platform,url:w.url,title:String(row.title||w.label).slice(0,160),state:'pending',count:0,note:''});count++;
      }
      await saveNav(n);
      stable=count===last?stable+1:0;last=count;
      if(r.gate){await saved(q);throw Error(`${label(s.platform)}检索：${r.gate}，已保留可见候选`);}
      if(count>=q.works || r.empty || (count>0&&stable>=3))break;
      if(i===13 && !count)throw Error('未识别到结果卡，也未显示无结果；可检查页面后重试或跳过此平台');
      await saved(q);await wait(650);
    }
    s.state='done';await saved(q);
  }
  async function collect(q,item,n){
    item.state='active';q.phase='running';await saved(q);
    let id,started=false;
    const out=async(note)=>{
      const k='video:'+item.url,record=(await db.get(k))[k];
      item.count=record?.comments?.length||0;item.note=note||record?.state||'采集未完成';
    };
    try {
      const url=n.links[item.url]||item.url;id=await open(n,url,q);
      const pre=await connect(q,id,url);
      let s=await message(id,'status');
      if(!s?.ok)throw Error('作品采集器未连接');
      if(!s.running){
        const r=await message(id,'start',{limit:q.comments,readVisibleOnly:!!pre.gate});
        if(!r?.ok)throw Error(r?.message||'作品采集器未启动');
      }
      started=true;
      for(let i=0;i<600;i++){
        await checked(q);
        if(!await owned(n))throw Error('采集标签已关闭或切换，未继续');
        s=await message(id,'status');
        if(!s?.ok)throw Error('采集器断开');
        if(!s.running){
          const end=await message(id,'topic.probe');
          await out(pre.gate||end?.gate||s.state);
          if(pre.gate||end?.gate||!s.completed)throw Error(item.note);
          item.state='done';await saved(q);return;
        }
        const p=await message(id,'topic.probe');
        if(p?.gate && !pre.gate){
          await message(id,'stop');
          throw Error(p.gate);
        }
        await wait(500);
      }
      throw Error('采集超时，已保留当前结果');
    }catch(e){
      // Stop only our own still-matching tab. Allow its final checkpoint to land.
      if(started && await owned(n)){
        try{await message(id,'stop');
          for(let i=0;i<20;i++){if(!(await message(id,'status'))?.running)break;await wait(150);}
        }catch{}
      }
      item.state='partial';await out(e.message);throw e;
    }
  }
  async function run(q,allowOne=false){
    const n=await navigation(q);q.reason='';
    try {
      while(site(q)){await checked(q);await search(q,site(q),n);}
      while(next(q)){
        await checked(q);
        if(q.mode==='manual'&&!allowOne){q.phase='confirm';await saved(q);return;}
        allowOne=false;await collect(q,next(q),n);
      }
      q.phase='done';await saved(q);await release(n);await session.remove(SESSION);
    }catch(e){
      q.phase='paused';q.reason=String(e.message||e).slice(0,220);await saved(q);
    }
  }
  async function action(fn){
    if(locallyRunning)return;
    try{
      await navigator.locks.request(LOCK,{ifAvailable:true},async held=>{
        if(!held){tell('另一个整理页正在执行采集');return;}
        locallyRunning=true;tell('');
        try{await fn();}finally{locallyRunning=false;paint(await read());}
      });
    }catch(e){tell('无法操作：'+e.message);}
  }
  $('topicForm').onsubmit=e=>{
    e.preventDefault();
    const term=$('topicTerm').value.trim(),works=$('topicWorks').valueAsNumber,comments=$('topicComments').valueAsNumber;
    const mode=$('topicMode').value,platforms=[...panel.querySelectorAll('[name=topicPlatform]:checked')].map(x=>x.value);
    if(!term || !platforms.length){tell('请输入关键词并选择至少一个平台');return;}
    action(async()=>{
      const prev=await read();
      if(prev && prev.phase!=='done' && !confirm('用新检索替换未完成队列？已保存的评论将保留。'))return;
      if(prev)await release(await navigation(prev));
      await db.remove(STOP);
      const q={id:crypto.randomUUID(),term,works,comments,mode,phase:'searching',reason:'',searches:platforms.map(platform=>({platform,state:'pending'})),items:[]};
      await saved(q);await run(q);
    });
  };
  $('topicNext').onclick=()=>action(async()=>{
    const q=await read();if(!q||q.phase==='done')return;
    await db.remove(STOP);await run(q,!site(q));
  });
  $('topicSkip').onclick=()=>action(async()=>{
    const q=await read();if(!q||!['confirm','paused'].includes(q.phase))return;
    const target=site(q)||next(q);if(!target)return;
    target.state='skipped';await db.remove(STOP);await saved(q);await run(q);
  });
  $('topicPause').onclick=async()=>{
    const q=await read();if(!q||q.phase==='done')return;
    await db.set({[STOP]:q.id});tell('已请求暂停');
    await navigator.locks.request(LOCK,{ifAvailable:true},async held=>{
      if(!held)return;
      const latest=await read();if(latest?.id===q.id&&latest.phase!=='done'){latest.phase='paused';latest.reason='用户暂停；进度已保存';await saved(latest);}
    });
  };
  read().then(paint).catch(e=>tell(e.message));
})();
