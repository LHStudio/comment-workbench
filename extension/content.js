(() => {
  if (window.dyCollector) return;
  let running=false, stopped=false;
  let progress={count:0,limit:100,state:'就绪'};
  const wait = ms => new Promise(r=>setTimeout(r,ms));
  const visible = e => !!(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const active = () => document.querySelector('[data-e2e="feed-active-video"]');
  function videoUrl() {
    if(typeof Zhihu!=='undefined')return Sites.work(location.href)?.url||'';
    const url=new URL(location.href);
    const id=active()?.getAttribute('data-e2e-vid') || url.searchParams.get('modal_id') || url.pathname.match(/^\/video\/(\d+)/)?.[1];
    return /^\d+$/.test(id||'') ? `${url.origin}/video/${id}` : '';
  }
  function snapshot() {
    if(typeof Zhihu!=='undefined')return Zhihu.snapshot();
    const scope=active() || document;
    const title=[...scope.querySelectorAll('[data-e2e="video-desc"], [data-e2e="video-title"], h1')].find(visible);
    const panel=[...document.querySelectorAll('[data-e2e="comment-list"]')].find(visible);
    const rows=[...(panel||scope).querySelectorAll('[data-e2e="comment-item"]')].filter(e=>visible(e)&&!e.parentElement.closest('[data-e2e="comment-item"]'));
    const comments=rows.map(item=>{
      const own=sel=>[...item.querySelectorAll(sel)].find(e=>e.closest('[data-e2e="comment-item"]')===item);
      const body=own('[data-e2e="comment-content"], [data-e2e="comment-text"], .comment-content, .FduGc_lz .Sh1Da424');
      if (!body) return null;
      const copy=body.cloneNode(true);
      for(const img of copy.querySelectorAll('img'))img.replaceWith(img.alt||'');
      const text=copy.textContent.trim();
      const anchor=own('[id^="tooltip_"]');
      const nickname=[...item.querySelectorAll('[data-e2e="comment-user-name"], a[href*="/user/"]')].filter(e=>e.closest('[data-e2e="comment-item"]')===item).map(e=>e.innerText.trim()).find(Boolean)||'';
      return text ? {id:(anchor && anchor.id) || item.getAttribute('data-comment-id') || '',text,nickname,capturedAt:new Date().toISOString()} : null;
    }).filter(Boolean);
    const challenge=[...document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="verify-dialog"]')].some(visible) || /验证码|安全验证/.test(document.title)||/登录后(查看|可见)评论/.test(panel?.innerText||'');
    return {title:title ? title.innerText.trim() : '',comments,challenge,rowCount:rows.length};
  }
  function scrollBox(){
    if(typeof Zhihu!=='undefined')return Zhihu.scroll();
    const selectors=['.comment-mainContent','[data-e2e="comment-list"]','[class*="comment-list"]'];
    for (const sel of selectors) for (const el of document.querySelectorAll(sel)) if(visible(el) && el.scrollHeight>el.clientHeight+5) return el;
    const item=document.querySelector('[data-e2e="comment-item"]');
    for(let n=item?.parentElement;n && n!==document.body;n=n.parentElement) if(n.scrollHeight>n.clientHeight+5 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n;
    return null;
  }
  async function persist(url,title, comments, state){
    const key='video:'+url;
    const prior=(await chrome.storage.local.get(key))[key];
    const combined=new Map((prior?.comments||[]).map(c=>[c.key,c]));
    for(const [key,c] of comments) if(!combined.has(key)) combined.set(key,{key,text:c.text,nickname:c.nickname,capturedAt:c.capturedAt,deleted:false});
    await chrome.storage.local.set({[key]:{...prior,title:title||prior?.title||'',url,comments:[...combined.values()],state,createdAt:prior?.createdAt||prior?.updated||new Date().toISOString(),updated:new Date().toISOString()}});
  }
  async function run(limit=50){
    if(!Number.isInteger(limit)||limit<1||limit>1000) throw Error('每个作品的上限须为 1 到 1000 的整数');
    if(running || !videoUrl()) return; running=true; stopped=false; let rounds=0, idle=0; const seen=new Map(); let title='';
    const url=videoUrl(), known=new Set();
    let opened=false, pendingPage=null, pageWait=0;
    progress={url,count:0,limit,state:'正在打开评论区'};
    const save=async (name,items,state,completed=false)=>{
      await persist(url,name,items,state);
      progress={url,count:known.size,limit,state,completed};
    };
    const finish=()=>save(title,seen,`采集完成，已保存 ${known.size} 条可读评论`,true);
    try {
      const key='video:'+url;
      const prior=(await chrome.storage.local.get(key))[key];
      for(const c of prior?.comments||[]) known.add(c.key);
      if(known.size>=limit){title=prior?.title;await finish();return;}
      for(;rounds<200 && !stopped;rounds++){
        if(videoUrl()!==url){await save(title,seen,'已切换作品，原作品采集停止');return;}
        const s=snapshot();
        if(s.challenge){await save(title,seen,'遇到验证，已停止');return;}
        if(s.title) title=s.title;
        if(!title){if(rounds<12){await wait(650);continue;}await save('',seen,'未找到作品标题；请打开作品详情');return;}
        const signature=typeof Zhihu!=='undefined'?JSON.stringify(s.comments.map(c=>[c.id,c.nickname,c.text])):null;
        if(pendingPage!==null){
          if(!s.comments.length || signature===pendingPage){
            if(++pageWait>=12){await save(title,seen,'翻页后评论未更新，已保存当前结果');return;}
            await wait(500);continue;
          }
          pendingPage=null;pageWait=0;
        }
        let before=seen.size;
        for (const c of s.comments){
          const key=c.id?'id:'+c.id:'row:'+JSON.stringify([c.nickname,c.text]);
          if(known.has(key)||known.has('text:'+c.text)) continue;
          known.add(key); seen.set(key,c);
          if(known.size===limit) break;
        }
        if(known.size>=limit){await finish();return;}
        if(!s.comments.length && !seen.size){
          if(typeof Zhihu!=='undefined' && !opened)opened=Zhihu.open();
          if(typeof Zhihu==='undefined' && !rounds && !s.rowCount && !document.querySelector('[data-e2e="comment-list"]')){
            const button=(active()||document).querySelector('[data-e2e="feed-comment-icon"]');
            if(visible(button)) button.click();
          }
          if(rounds<5){await wait(1000);continue;}
          await save(title,seen,s.rowCount?`已找到 ${s.rowCount} 个评论项，但未识别正文`:'未加载评论；请确认评论区已展开');return;
        }
        await save(title,seen,`采集中：${known.size} / ${limit}`);
        if(stopped || videoUrl()!==url)continue;
        const box=scrollBox();
        if(typeof Zhihu!=='undefined' && (!box || box.scrollTop+box.clientHeight>=box.scrollHeight-2) && Zhihu.next()){
          pendingPage=signature;pageWait=0;idle=0;
          await wait(500);continue;
        }
        if(!box){await finish();return;}
        idle=seen.size===before && box.scrollTop+box.clientHeight>=box.scrollHeight-2?idle+1:0;
        if(idle>=6){await finish();return;}
        box.scrollTop=Math.min(box.scrollHeight,box.scrollTop+Math.max(100,Math.floor(box.clientHeight*.85)));
        await wait(2000);
      }
      await save(title,seen,stopped?'用户停止':'达到单次滚动上限，未确认全部加载');
    } catch(e){ progress={url,count:known.size,limit,state:'采集错误：'+String(e)}; }
    finally{running=false;chrome.runtime.sendMessage({action:'bridge.finished',url}).catch(()=>{});}
  }
  window.dyCollector={snapshot,run,stop:()=>{stopped=true;}};
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.action==='discover'){
      (async()=>{const ids=new Set();for(let i=0;i<10;i++){
        if(snapshot().challenge||/登录后查看搜索结果/.test(document.body.innerText)){reply({blocked:true});return;}
        for(const el of document.querySelectorAll('[id^="waterfall_item_"]')){
          const id=el.id.slice('waterfall_item_'.length),t=(el.querySelector('.BjLsdJMi')||el).innerText;
          if(/^\d+$/.test(id)&&/ai|阿福|豆包|大模型|deepseek|千问|chatgpt|小荷|晓医|人工智能/i.test(t)&&/看病|问诊|健康|医生|用药|体检|报告|就医|医疗|病情/.test(t))ids.add(id);
        }
        const box=document.querySelector('#waterFallScrollContainer');box?.lastElementChild?.scrollIntoView({block:'end'});await wait(1000);
      }reply({ids:[...ids]});})().catch(()=>reply({blocked:true}));return true;
    }
    if(msg.action==='start'){
      if(running){reply({ok:false,message:'当前作品正在采集'});return;}
      if(!Number.isInteger(msg.limit)||msg.limit<1||msg.limit>1000){reply({ok:false,message:'请输入 1 到 1000 之间的整数'});return;}
      if(!videoUrl()){reply({ok:false,message:'请先打开作品详情，再开始采集。'});return;}
      run(msg.limit);reply({ok:true});
    }
    if(msg.action==='status'){reply({ok:true,running,...(progress.url===videoUrl()?progress:{count:0,state:'就绪'})});}
    if(msg.action==='stop'){stopped=true;reply({ok:true});}
  });
})();
