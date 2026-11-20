(() => {
  if (window.dyCollector) return;
  let running=false, stopped=false;
  let progress={count:0,limit:100,state:'就绪'};
  const wait = ms => new Promise(r=>setTimeout(r,ms));
  const visible = e => !!(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const active = () => document.querySelector('[data-e2e="feed-active-video"]');
  const adapter=typeof Bilibili!=='undefined'?Bilibili:typeof Weibo!=='undefined'?Weibo:
    typeof Xiaohongshu!=='undefined'?Xiaohongshu:typeof Zhihu!=='undefined'?Zhihu:null;
  function videoUrl() {
    if(adapter)return Sites.work(location.href)?.url||'';
    const url=new URL(location.href);
    const id=active()?.getAttribute('data-e2e-vid') || url.searchParams.get('modal_id') || url.pathname.match(/^\/video\/(\d+)/)?.[1];
    return /^\d+$/.test(id||'') ? `${url.origin}/video/${id}` : '';
  }
  // A thread container establishes membership, not the direct addressee.
  // Cross open shadow roots for Bilibili; never link rows by nickname or order.
  function relate(records, {site, root, reply, group, replyGroup, sourceId}){
    const up=e=>e.parentElement||e.getRootNode().host;
    const near=(row,selector)=>{
      if(selector)for(let n=up(row);n;n=up(n))if(n.matches(selector))return n;
      return null;
    };
    const clean=id=>String(id||'').trim().replace(/^(?:comment[-_]|tooltip_)/,'');
    const ref=id=>{const s=clean(id);return s&&s!=='0'&&s.length<=150?site+':'+s:'';};
    const byRow=new Map(records.map(({row,c})=>[row,c])), groups=new Map();
    for(const {row,c} of records){
      let ancestor=null;
      for(let n=up(row);n;n=up(n))if(byRow.has(n)){ancestor=byRow.get(n);break;}
      const d=row.dataset;
      c.ref=ref(sourceId?.(row,c)||c.id);
      c.parentRef=ref(d.parentId||d.parentCommentId||d.parentRpid||d.replyToCommentId);
      c.rootRef=ref(d.rootId||d.rootCommentId||d.rootRpid);
      if(c.parentRef===c.ref)c.parentRef='';
      if(c.rootRef===c.ref)c.rootRef='';
      const container=near(row,group);
      if(c.parentRef||c.rootRef||ancestor||(reply&&row.matches(reply))||near(row,replyGroup)){
        c.isReply=true;
        if(ancestor)c.threadRoot=ancestor.depth===1?ancestor:ancestor.threadRoot;
      }else if(row.matches(root)){
        c.depth=1;
        if(container)groups.set(container,groups.has(container)?null:c);
      }
    }
    for(const {row,c} of records){
      if(c.isReply&&!c.rootRef&&!c.threadRoot)c.threadRoot=groups.get(near(row,group))||undefined;
    }
    return records.map(({c})=>c);
  }
  function snapshot() {
    if(adapter)return adapter.snapshot(relate);
    const scope=active() || document;
    const title=[...scope.querySelectorAll('[data-e2e="video-desc"], [data-e2e="video-title"], h1')].find(visible);
    const panel=[...document.querySelectorAll('[data-e2e="comment-list"]')].find(visible);
    const root='[data-e2e="comment-item"]', reply='[data-e2e="comment-reply-item"],[data-e2e="reply-item"],[data-e2e="sub-comment-item"]';
    const rowSel=root+','+reply;
    const rows=[...(panel||scope).querySelectorAll(rowSel)].filter(visible);
    const records=rows.map(item=>{
      const own=sel=>[...item.querySelectorAll(sel)].find(e=>visible(e)&&e.closest(rowSel)===item);
      const body=own('[data-e2e="comment-content"], [data-e2e="comment-text"], .comment-content, .FduGc_lz .Sh1Da424');
      if (!body) return null;
      const copy=body.cloneNode(true);
      for(const nested of copy.querySelectorAll(rowSel))nested.remove();
      for(const img of copy.querySelectorAll('img'))img.replaceWith(img.alt||'');
      const text=copy.textContent.trim();
      const anchor=own('[id^="tooltip_"]');
      const nickname=[...item.querySelectorAll('[data-e2e="comment-user-name"], a[href*="/user/"]')]
        .filter(e=>visible(e)&&e.closest(rowSel)===item).map(e=>e.innerText.trim()).find(Boolean)||'';
      return text ? {row:item,c:{id:(anchor && anchor.id) || item.getAttribute('data-comment-id') || '',text,nickname,capturedAt:new Date().toISOString()}} : null;
    }).filter(Boolean);
    const comments=relate(records,{site:'dy',root,reply,replyGroup:'[data-e2e="comment-reply-list"],[data-e2e="reply-list"]',
      sourceId:(row,c)=>row.dataset.commentId||c.id});
    const challenge=[...document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="verify-dialog"]')].some(visible) || /验证码|安全验证/.test(document.title)||/登录后(查看|可见)评论/.test(panel?.innerText||'');
    return {title:title ? title.innerText.trim() : '',comments,challenge,rowCount:rows.length};
  }
  function scrollBox(){
    if(adapter)return adapter.scroll();
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
    for(const [key,c] of comments){
      const old=combined.get(key);
      combined.set(key,{key,text:c.text,nickname:c.nickname,capturedAt:c.capturedAt,deleted:false,...old,
        ...(c.ref?{ref:c.ref}:{}),...(c.depth?{depth:c.depth}:{}),...(c.isReply?{isReply:true}:{}),
        ...(c.rootRef?{rootRef:c.rootRef}:{}),...(c.parentRef?{parentRef:c.parentRef}:{})});
    }
    const byRef=new Map([...combined.values()].filter(c=>c.ref).map(c=>[c.ref,c]));
    for(const current of combined.values()){
      if(!current.parentRef)continue;
      let node=current, depth=1;
      const visited=new Set([node]);
      while(node.parentRef && depth<1000){
        node=byRef.get(node.parentRef);
        if(!node||visited.has(node))break;
        visited.add(node);depth++;
        if(node.depth===1&&!node.isReply){
          if(!current.rootRef||current.rootRef===node.ref){
            current.rootRef=node.ref;current.depth=depth;
          }
          break;
        }
      }
    }
    const answer=typeof Zhihu!=='undefined'&&videoUrl()===url&&Zhihu.context();
    await chrome.storage.local.set({[key]:{...prior,...(answer?{answer:{...answer,text:answer.text||prior?.answer?.text||'',author:answer.author||prior?.answer?.author||''}}:{}),title:title||prior?.title||'',url,comments:[...combined.values()],state,createdAt:prior?.createdAt||prior?.updated||new Date().toISOString(),updated:new Date().toISOString()}});
  }
  async function run(limit=50,readVisibleOnly=false){
    if(!Number.isInteger(limit)||limit<1||limit>1000) throw Error('每个作品的上限须为 1 到 1000 的整数');
    if(running || !videoUrl()) return; running=true; stopped=false; let rounds=0, idle=0; const seen=new Map(); let title='';
    const url=videoUrl(), known=new Set(),localRefs=new Map();
    const baseKey=c=>c.id?'id:'+c.id:'row:'+JSON.stringify([c.nickname,c.text]);
    const keyOf=c=>!c.id&&c.isReply&&(c.rootRef||c.parentRef)?
      'row:'+JSON.stringify([c.nickname,c.text,c.rootRef||'',c.parentRef||'']):baseKey(c);
    async function reference(c){
      if(c.ref)return c.ref;
      const k=keyOf(c);
      if(!localRefs.has(k)){
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([url,k])));
        localRefs.set(k,'local:'+Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join(''));
      }
      return localRefs.get(k);
    }
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
      const priorByKey=new Map((prior?.comments||[]).map(c=>[c.key,c]));
      for(const c of prior?.comments||[]){known.add(c.key);if(c.ref)localRefs.set(c.key,c.ref);}
      title=prior?.title||'';
      for(;rounds<200 && !stopped;rounds++){
        if(videoUrl()!==url){await save(title,seen,'已切换作品，原作品采集停止');return;}
        const s=snapshot();
        const limited=readVisibleOnly||s.challenge;
        if(s.title) title=s.title;
        if(!title&&!limited){if(rounds<12){await wait(650);continue;}await save('',seen,'未找到作品标题；请打开作品详情');return;}
        const signature=typeof Zhihu!=='undefined'?JSON.stringify(s.comments.map(c=>[c.id,c.nickname,c.text])):null;
        if(pendingPage!==null&&!limited){
          if(!s.comments.length || signature===pendingPage){
            if(++pageWait>=12){await save(title,seen,'翻页后评论未更新，已保存当前结果');return;}
            await wait(500);continue;
          }
          pendingPage=null;pageWait=0;
        }
        let before=seen.size;
        const occurrences=new Map(),texts=new Map();
        for(const c of s.comments){
          const k=baseKey(c);occurrences.set(k,(occurrences.get(k)||0)+1);
          texts.set(c.text,(texts.get(c.text)||0)+1);
        }
        for (const c of s.comments){
          if(c.threadRoot&&!c.rootRef)c.rootRef=await reference(c.threadRoot);
          let key=keyOf(c);
          const legacy=baseKey(c), old=priorByKey.get(legacy);
          if(!known.has(key)&&old&&occurrences.get(legacy)===1&&
              (!old.rootRef||old.rootRef===c.rootRef)&&(!old.parentRef||old.parentRef===c.parentRef))key=legacy;
          if(!known.has(key)&&known.has('text:'+c.text)&&texts.get(c.text)===1)key='text:'+c.text;
          if(!known.has(key)&&known.size>=limit)continue;
          c.ref=await reference(c);
          known.add(key); seen.set(key,c);
        }
        if(limited){
          await save(title,seen,`${s.challenge?'遇到登录或验证要求，已停止':'仅保存当前可见评论，已停止'}；已保存 ${known.size} 条`,false);
          return;
        }
        if(known.size>=limit){await finish();return;}
        if(!s.comments.length && !seen.size){
          if(s.empty){await finish();return;}
          if(adapter && !opened)opened=adapter.open();
          if(!adapter && !rounds && !s.rowCount && !document.querySelector('[data-e2e="comment-list"]')){
            const button=(active()||document).querySelector('[data-e2e="feed-comment-icon"]');
            if(visible(button)) button.click();
          }
          if(rounds<(s.loading||typeof Zhihu!=='undefined'?15:5)){await wait(1000);continue;}
          if(typeof Zhihu!=='undefined'&&!s.rowCount){
            await save(title,seen,opened?'已尝试展开评论，等待后仍无评论或空列表提示':'未识别到当前作品的评论入口或空列表提示');return;
          }
          await save(title,seen,s.rowCount?`已找到 ${s.rowCount} 个评论项，但未识别正文`:'未加载评论；请确认评论区已展开');return;
        }
        await save(title,seen,`采集中：${known.size} / ${limit}`);
        if(stopped || videoUrl()!==url)continue;
        const box=scrollBox();
        if(typeof Zhihu!=='undefined' && (!box || box.scrollTop+box.clientHeight>=box.scrollHeight-2) && Zhihu.next()){
          pendingPage=signature;pageWait=0;idle=0;
          await wait(500);continue;
        }
        const atEnd=!box || box.scrollTop+box.clientHeight>=box.scrollHeight-2;
        idle=seen.size===before && atEnd?idle+1:0;
        if((!box&&typeof Weibo==='undefined') || idle>=6){
          if(typeof Weibo!=='undefined'&&(s.collapsed||s.expected>known.size))
            await save(title,seen,`已保存 ${known.size} 条；${s.collapsed?'仍有折叠回复，请展开后继续采集':'页面计数更多，未确认全部加载'}`);
          else if(typeof Weibo!=='undefined')await save(title,seen,`已保存当前可读的 ${known.size} 条评论`,true);
          else await finish();
          return;
        }
        if(!box || (typeof Weibo!=='undefined'&&atEnd)){await wait(650);continue;}
        box.scrollTop=Math.min(box.scrollHeight,box.scrollTop+Math.max(100,Math.floor(box.clientHeight*.85)));
        await wait(2000);
      }
      await save(title,seen,stopped?'用户停止':'达到单次滚动上限，未确认全部加载');
    } catch(e){ progress={url,count:known.size,limit,state:'采集错误：'+String(e)}; }
    finally{running=false;chrome.runtime.sendMessage({action:'bridge.finished',url}).catch(()=>{});}
  }
  window.dyCollector={snapshot,run,stop:()=>{stopped=true;}};
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
    if(msg.action==='start'){
      if(running){reply({ok:false,message:'当前作品正在采集'});return;}
      if(!Number.isInteger(msg.limit)||msg.limit<1||msg.limit>1000){reply({ok:false,message:'请输入 1 到 1000 之间的整数'});return;}
      if(!videoUrl()){reply({ok:false,message:'请先打开作品详情，再开始采集。'});return;}
      run(msg.limit,msg.readVisibleOnly===true);reply({ok:true});
    }
    if(msg.action==='status'){reply({ok:true,running,...(progress.url===videoUrl()?progress:{count:0,state:'就绪'})});}
    if(msg.action==='stop'){stopped=true;reply({ok:true});}
  });
})();
