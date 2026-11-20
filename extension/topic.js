/* The organizer drives a serial queue. Reloading it never starts paid/network work. */
(() => {
  const panel=document.getElementById('topicPanel');
  if(!panel)return;
  const KEY='topicQueueV1', STOP='topicStopV1', SESSION='topicNavigationV1', LOCK='comment-topic-run';
  const db=chrome.storage.local, session=chrome.storage.session, wait=ms=>new Promise(r=>setTimeout(r,ms));
  const $=id=>panel.querySelector('#'+id), label=id=>Sites.platforms.find(p=>p.id===id)?.label||id;
  const read=async()=> (await db.get(KEY))[KEY];
  const saved=q=>db.set({[KEY]:q});
  const pace=()=>wait(1000+Math.floor(Math.random()*1001));
  const manualGate=gate=>gate==='需要安全验证';
  const unfinished=i=>!['done','skipped'].includes(i.state);
  const platformGate=message=>/登录|登入|验证|访问频繁|操作频繁|频率限制|平台限制访问|访问权限和扩展权限/.test(message);
  const tell=s=>{ $('topicNotice').textContent=s; };
  const names={pending:'待处理',active:'采集中',partial:'未完成',done:'已完成',skipped:'已跳过',
    confirm:'旧任务待接续',attention:'本轮结束，有平台待重试',running:'执行中',paused:'已暂停',searching:'检索中',verifying:'等待人工验证'};
  panel.innerHTML=`<h2>关键词采集</h2><form id="topicForm">
    <label>检索主题<input id="topicTerm" type="search" maxlength="100" placeholder="输入关键词" required></label>
    <fieldset id="topicPlatforms"><legend>检索平台</legend></fieldset>
    <div class="topicOptions"><label>每平台作品上限<input id="topicWorks" type="number" min="1" max="50" value="5" required></label>
    <label>每篇评论上限<input id="topicComments" type="number" min="1" max="1000" value="50" required></label>
    <button id="topicStart" class="primary" type="submit">开始主题采集</button></div></form>
    <div class="controls"><button id="topicNext" type="button">继续采集</button><button id="topicPause" type="button">暂停</button></div>
    <section id="topicMonitor" hidden><div class="meter"><strong>总进度 · 已发现任务</strong><b id="topicPercent"></b></div>
    <progress id="topicBar" max="100" value="0" aria-label="已发现任务的完成百分比"></progress>
    <div id="topicNow"></div><small id="topicAddress"></small><button type="button" id="topicLocate">定位标签页</button></section>
    <p id="topicNotice" role="status"></p><div id="topicProgress" aria-live="polite"></div><ol id="topicItems"></ol>`;
  for(const p of Sites.platforms){
    const l=document.createElement('label'),b=document.createElement('input');
    b.type='checkbox';b.name='topicPlatform';b.value=p.id;b.checked=true;l.append(b,p.label);$('topicPlatforms').append(l);
  }
  let shownId=null, locallyRunning=false;
  function paint(q){
    const rows=$('topicItems');rows.replaceChildren();
    $('topicNext').disabled=!q||q.phase==='done'||locallyRunning;
    $('topicPause').disabled=!q||['attention','paused','done'].includes(q.phase);
    $('topicMonitor').hidden=!q;
    if(!q){$('topicProgress').textContent='尚无采集任务';return;}
    if(shownId!==q.id){
      shownId=q.id;$('topicTerm').value=q.term;
      $('topicWorks').value=q.works;$('topicComments').value=q.comments;
      for(const b of panel.querySelectorAll('[name=topicPlatform]'))b.checked=q.searches.some(s=>s.platform===b.value);
    }
    $('topicNext').textContent=q.phase==='attention'?'重试未完成的平台':'继续采集';
    const finished=q.items.filter(i=>i.state==='done').length;
    const tasks=q.searches.length+q.items.length;
    const completed=q.searches.filter(s=>s.scan||s.state==='skipped').length+q.items.filter(i=>!unfinished(i)).length;
    const percent=tasks?Math.floor(100*completed/tasks):0;
    $('topicPercent').textContent=percent+'%';$('topicBar').value=percent;
    const current=q.page,live=['searching','running','verifying'].includes(q.phase);
    $('topicMonitor').dataset.state=live?q.phase:'idle';
    $('topicNow').textContent=current&&live?`${label(q.current)} · ${names[q.phase]} · ${current.title}${current.detail?' · '+current.detail:''}`:names[q.phase];
    $('topicAddress').textContent=live&&current?current.url:'';
    $('topicLocate').hidden=!live||!current;
    const stage=q.phase==='searching'&&q.current?`${label(q.current)}检索`:q.phase==='running'?q.items.find(i=>i.state==='active')?.title||'':'';
    $('topicProgress').textContent=`${q.term} · ${names[q.phase]} · 完成 ${finished}/${q.items.length} 篇${stage?' · '+stage:''}${q.reason?' · '+q.reason:''}`;
    const searches=document.createElement('p');
    searches.textContent=q.searches.map(s=>`${label(s.platform)} ${s.state==='pending'?'待检索':s.state==='skipped'?'跳过':s.state==='attention'?'待重试':'已检索'} ${q.items.filter(i=>i.platform===s.platform).length} 篇${s.note?'（'+s.note+'）':''}`).join(' / ');
    $('topicProgress').append(searches);
    for(const item of q.items){
      const li=document.createElement('li'),title=document.createElement('strong'),meta=document.createElement('small');
      title.textContent=item.title;meta.textContent=`${label(item.platform)} · ${names[item.state]} · 已保存 ${item.count} 条${item.note?' · '+item.note:''}`;
      li.append(title);
      if(live&&current?.url===item.url)li.setAttribute('aria-current','step');
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
    if(Sites.question(expected))return Sites.question(actual)?.url===Sites.question(expected).url;
    return Sites.sameSearch(actual,expected);
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
    if(existing && same(n.tab.url,url)){await chrome.tabs.update(existing.id,{active:true});return existing.id;}
    if(n.tab)await pace();
    await checked(q);
    await release(n);
    const t=await chrome.tabs.create({url,active:true});
    n.tab={id:t.id,url};await saveNav(n);return t.id;
  }
  async function pageReady(q,id,url,title){
    q.page={url:Sites.work(url)?.url||url,title};
    await saved(q);
    return connect(q,id,url);
  }
  $('topicLocate').onclick=async()=>{
    const q=await read();if(!q?.page)return;
    const n=await navigation(q),t=await owned(n);
    if(!t||!same(n.tab.url,q.page.url)){tell('当前标签页正在切换或已关闭');return;}
    await chrome.tabs.update(t.id,{active:true});await chrome.windows.update(t.windowId,{focused:true});
  };
  const message=(id,action,extra={})=>chrome.tabs.sendMessage(id,{action,...extra});
  const probe=id=>message(id,'topic.probe',{notify:true});
  // A challenge can reload the document. Observe only this tab and never
  // navigate it back or message a different route during verification.
  async function waitForHuman(q,id,url){
    const phase=q.phase,deadline=Date.now()+120000;
    q.phase='verifying';q.reason=`请在${label(q.current)}标签页完成验证`;await saved(q);
    await message(id,'topic.notice',{mode:'verify'}).catch(()=>{});
    while(Date.now()<deadline){
      await wait(1000);await checked(q);
      const t=await chrome.tabs.get(id).catch(()=>null);
      if(!t)throw Error('验证标签已关闭；进度已保留');
      if(t.status!=='complete'||!same(t.pendingUrl||t.url,url))continue;
      const p=await probe(id).catch(()=>null);
      if(p?.ok&&!manualGate(p.gate)){
        q.phase=phase;q.reason='';await saved(q);return p;
      }
    }
    throw Error('等待验证超时；完成后请点击「继续采集」');
  }
  async function connect(q,id,url){
    for(let i=0;i<75;i++){
      await checked(q);
      const t=await chrome.tabs.get(id).catch(()=>null);
      if(!t)throw Error('采集标签已关闭，请重试');
      if(t.status==='complete'){
        if(!same(t.url,url))throw Error('页面已跳转；请先在平台完成登录或验证后重试');
        try{const p=await probe(id);if(p?.ok)return p;}catch{}
      }
      await wait(240);
    }
    throw Error('页面未连接；请检查网络、页面访问权限和扩展权限后重试');
  }
  async function search(q,s,n){
    const url=q.questionUrl||Sites.search(s.platform,q.term);
    q.phase='searching';q.page=null;await saved(q);
    const id=await open(n,url,q);
    const pre=await pageReady(q,id,url,q.questionUrl?'问题回答列表':`检索「${q.term}」`);
    if(manualGate(pre.gate))await waitForHuman(q,id,url);
    const questions=new Set();
    let stable=0,last=-1;
    for(let i=0;i<14;i++){
      await checked(q);
      const request={platform:s.platform,term:q.term,limit:q.works,advance:i>0};
      let r;
      try{r=q.questionUrl?{ok:true,rows:[],questions:[q.questionUrl]}:await message(id,'topic.discover',request);}
      catch(e){
        if(!/receiving end does not exist|could not establish connection|message (channel|port).*closed/i.test(e.message))throw e;
        await connect(q,id,url);
        try{r=await message(id,'topic.discover',request);}
        catch{throw Error('搜索页已跳转或无法连接，请确认平台页面可用后重试');}
      }
      if(!r?.ok||!Array.isArray(r.rows))throw Error('尚未进入对应的搜索结果页');
      let count=q.items.filter(x=>x.platform===s.platform).length;
      if(s.platform==='zhihu')for(const raw of r.questions||[]){
        const question=Sites.question(raw);if(question&&questions.size<q.works)questions.add(question.url);
      }
      for(const row of r.rows){
        const w=Sites.work(row.url);
        if(!w||w.platform!==s.platform||w.url!==row.url)continue;
        if(s.platform==='xhs' && row.openUrl && Sites.work(row.openUrl)?.url===w.url)n.links[w.url]=row.openUrl;
        if(count>=q.works||q.items.some(x=>x.url===w.url))continue;
        q.items.push({platform:s.platform,url:w.url,title:String(row.title||w.label).slice(0,160),state:'pending',count:0,note:''});count++;
      }
      await saveNav(n);
      stable=count===last?stable+1:0;last=count;
      if(manualGate(r.gate)){await waitForHuman(q,id,url);i--;continue;}
      if(r.gate){await saved(q);throw Error(`${label(s.platform)}检索：${r.gate}，已保留可见候选`);}
      if(r.empty&&!count)throw Error('平台显示无搜索结果');
      if(count>=q.works || r.empty || (questions.size&&(!count||stable>=2)) || (count>0&&stable>=3))break;
      if(i===13 && !count)throw Error('未识别到结果卡，也未显示无结果');
      await saved(q);await pace();
    }
    for(const url of questions){
      const works=q.items.filter(i=>i.platform===s.platform);
      if(works.length>=q.works)break;
      const tab=await open(n,url,q);
      let p=await pageReady(q,tab,url,'问题回答列表');
      if(manualGate(p.gate))p=await waitForHuman(q,tab,url);
      if(p.gate)throw Error(p.gate);
      const list=await message(tab,'zhihu.answers',{url});
      if(!list?.ok||!list.rows.length){if(q.questionUrl)throw Error('未识别到此问题已加载的回答');continue;}
      for(const row of list.rows){
        const w=Sites.work(row.url);
        if(!w||!w.url.startsWith(url+'/answer/')||q.items.some(i=>i.url===w.url))continue;
        if(q.items.filter(i=>i.platform===s.platform).length>=q.works)break;
        q.items.push({platform:s.platform,url:w.url,title:row.title,state:'pending',count:0,note:''});
      }
      await saved(q);
    }
    if(!q.items.some(i=>i.platform===s.platform))throw Error('没有找到可识别的作品');
    s.scan=true;s.state='done';await saved(q);
  }
  async function collect(q,item,n){
    item.state='active';q.phase='running';q.page=null;await saved(q);
    let id,started=false;
    const out=async(note)=>{
      const k='video:'+item.url,record=(await db.get(k))[k];
      item.count=record?.comments?.length||0;item.title=record?.title||item.title;item.note=note||record?.state||'采集未完成';
    };
    try {
      const url=n.links[item.url]||item.url;id=await open(n,url,q);
      let pre=await pageReady(q,id,url,`第 ${q.items.indexOf(item)+1}/${q.items.length} 篇 · ${item.title}`);
      while(true){
      if(manualGate(pre.gate))pre=await waitForHuman(q,id,url);
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
        if(s.running&&s.state!==q.page.detail){q.page.detail=s.state;await saved(q);}
        if(!s.running){
          const end=await probe(id);
          if(manualGate(end?.gate)){pre=end;break;}
          await out(pre.gate||end?.gate||s.state);
          if(pre.gate||end?.gate||!s.completed)throw Error(item.note);
          item.state='done';await saved(q);return;
        }
        const p=await probe(id);
        if(p?.gate && !pre.gate){
          await message(id,'stop');
          if(manualGate(p.gate)){
            pre=await waitForHuman(q,id,url);
            // Wait for the stopped collector to persist its last batch.
            for(let j=0;(await message(id,'status'))?.running;j++){
              await checked(q);if(j>=30)throw Error('作品采集器未停止');
              await wait(150);
            }
            break;
          }
          throw Error(p.gate);
        }
        await wait(500);
        if(i===599)throw Error('采集超时，已保留当前结果');
      }
      }
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
  async function run(q){
    const n=await navigation(q);q.reason='';
    try {
      for(const s of q.searches){
        if(['skipped','attention'].includes(s.state))continue;
        const works=q.items.filter(i=>i.platform===s.platform);
        // V1 marked a search "done" as soon as its cards had been discovered.
        if(s.scan===undefined)s.scan=s.state==='done';
        if(s.scan && !works.some(unfinished))continue;
        await checked(q);
        q.current=s.platform;s.note='';
        try{
          if(!s.scan)await search(q,s,n);
          const failures=[];
          for(const item of q.items.filter(i=>i.platform===s.platform&&unfinished(i))){
            await checked(q);
            try{await collect(q,item,n);}
            catch(e){
              await checked(q);
              if(q.phase==='verifying'||platformGate(e.message))throw e;
              failures.push(item);
              await saved(q);
            }
          }
          s.state=failures.length?'attention':'done';
          if(failures.length)s.note=`${failures.length} 篇未完成：${failures[0].note}`;
        }catch(e){
          await checked(q); // User stop is global, platform failures are not.
          if(q.phase==='verifying')throw e;
          s.state='attention';s.note=String(e.message||e).slice(0,220);
          if(/登录|登入|验证/.test(s.note)&&!s.note.includes('后重试'))s.note+='；请先在平台完成登录或验证后重试';
        }
        await saved(q);
      }
      await checked(q);
      q.phase=q.searches.some(s=>s.state==='attention')?'attention':'done';
      q.current='';await release(n);await saved(q);
    }catch(e){
      const t=await owned(n);
      if(t)await message(t.id,'topic.notice',{mode:'paused'}).catch(()=>{});
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
    const question=Sites.question(term);
    const platforms=question?['zhihu']:[...panel.querySelectorAll('[name=topicPlatform]:checked')].map(x=>x.value);
    if(!term || !platforms.length){tell('请输入关键词并选择至少一个平台');return;}
    action(async()=>{
      const prev=await read();
      if(prev && prev.phase!=='done' && !confirm('用新检索替换未完成队列？已保存的评论将保留。'))return;
      if(prev)await release(await navigation(prev));
      await db.remove(STOP);
      const q={id:crypto.randomUUID(),term,works,comments,questionUrl:question?.url,phase:'searching',reason:'',searches:platforms.map(platform=>({platform,state:'pending',scan:false})),items:[]};
      await saved(q);await run(q);
    });
  };
  $('topicNext').onclick=()=>action(async()=>{
    const q=await read();if(!q||q.phase==='done')return;
    for(const s of q.searches)if(s.state==='attention')s.state=s.scan?'done':'pending';
    await db.remove(STOP);await run(q);
  });
  $('topicPause').onclick=async()=>{
    const q=await read();if(!q||q.phase==='done')return;
    await db.set({[STOP]:q.id});tell('已请求暂停');
    await navigator.locks.request(LOCK,{ifAvailable:true},async held=>{
      if(!held)return;
      const latest=await read();if(latest?.id===q.id&&latest.phase!=='done'){latest.phase='paused';latest.reason='用户暂停；进度已保存';await saved(latest);}
    });
  };
  const seed=Sites.question(new URLSearchParams(location.search).get('question'));
  if(seed){
    $('topicTerm').value=seed.url;
    for(const b of panel.querySelectorAll('[name=topicPlatform]'))b.checked=b.value==='zhihu';
    tell('已选择知乎问题；确认回答和评论上限后开始采集');
  }
  read().then(q=>{paint(q);if(seed)$('topicTerm').value=seed.url;}).catch(e=>tell(e.message));
})();
