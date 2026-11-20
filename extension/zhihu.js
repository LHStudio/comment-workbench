// Only loaded on Zhihu. Work inside the comment panel, never article prose.
const Zhihu = (() => {
  const panels = '.Comments-container,.CommentsV2,.Comments-wrapper,.Comments,.CommentList,[class*="CommentsV2"]';
  const item = '[data-comment-id],[id^="comment-"],.CommentItem,.CommentItemV2,.NestComment--rootComment,.NestComment--child';
  const body = '.CommentContent,.CommentItem-content,.CommentItemV2-content,.RichText,.RichContent-inner,[data-role="comment-content"],.ztext';
  const visible = n => n && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  let openedFrom=null;
  const dialogs=()=>[...document.querySelectorAll('[role="dialog"],.Modal-inner')].filter(visible);
  const emptyText=s=>/^(?:暂无评论|还没有评论|暂时没有评论|目前还没有评论|暂无评论，来发表第一条评论吧)[。！!]?$/u.test(s.trim());
  const empty=p=>!!p&&[p,...p.querySelectorAll('[class*="empty" i],p,span')].some(e=>visible(e)&&emptyText(e.innerText)&&!e.closest(item));
  const isComments=p=>/评论/.test(p.innerText) && (p.querySelector(item) || p.querySelector(body) || empty(p));
  const answer = () => {
    const id = location.pathname.match(/\/answer\/(\d+)/)?.[1];
    if (!id) return null;
    return [...document.querySelectorAll('.AnswerItem')].find(e => {
      if(e.getAttribute('name')===id || e.dataset.answerId===id)return true;
      // The raw numeric token can exceed JS's safe integer range.
      if(e.dataset.zop?.match(/"itemId"\s*:\s*"?(\d+)"?(?=\s*[,}])/)?.[1]===id)return true;
      return [...e.querySelectorAll('meta[itemprop="url"],a[itemprop="url"]')].some(x=>
        Sites.work(x.content||x.href)?.url===Sites.work(location.href)?.url);
    });
  };
  function panel(){
    const all=[...document.querySelectorAll(panels)].filter(visible);
    const current=answer();
    const multi=document.querySelectorAll('.AnswerItem').length>1;
    const owned=p=>!!current && p.closest('.AnswerItem')===current;
    const detached=p=>!p.closest('.AnswerItem') && (!multi ||
      (openedFrom?.url===location.href && openedFrom.owner===current && !openedFrom.existing.has(p)));
    return dialogs().filter(isComments).find(p=>owned(p)||detached(p)) || all.find(owned) ||
      all.find(detached);
  }
  function context(){
    const a=answer(),m=location.pathname.match(/^\/question\/(\d+)\/answer\/(\d+)\/?$/);
    if(!a||!m)return null;
    const rich=[...a.querySelectorAll('.RichContent-inner,.RichText,[itemprop="articleBody"]')].find(e=>visible(e)&&!e.closest(panels));
    const author=a.querySelector('.AuthorInfo .UserLink-link,.AuthorInfo-name,[itemprop="author"] [itemprop="name"]');
    return {questionId:m[1],answerId:m[2],author:(author?.innerText||author?.content||'').trim(),text:rich?.innerText.trim()||''};
  }
  chrome.runtime.onMessage.addListener((msg,s,reply)=>{
    if(msg.action!=='zhihu.answers')return;
    const q=Sites.question(location.href);
    if(!q||q.url!==msg.url){reply({ok:false});return;}
    const rows=new Map(),title=document.querySelector('h1.QuestionHeader-title,h1')?.innerText||'知乎问题';
    for(const a of document.querySelectorAll('.AnswerItem')){
      if(!visible(a))continue;
      const id=a.dataset.answerId||a.dataset.zop?.match(/"itemId"\s*:\s*"?(\d+)"?/)?.[1]||a.getAttribute('name');
      const links=[...a.querySelectorAll('meta[itemprop="url"],a[itemprop="url"],.ContentItem-time a[href]')];
      const url=links.map(x=>Sites.work(x.content||x.href)?.url).find(u=>u?.startsWith(q.url+'/answer/'))||
        (/^\d+$/.test(id)?q.url+'/answer/'+id:null);
      if(url)rows.set(url,{url,title:title+' · 回答 '+url.split('/').pop()});
    }
    reply({ok:true,title,rows:[...rows.values()]});
  });
  function snapshot(relate){
    const p=panel(), records=[];
    const title=document.querySelector('h1.Post-Title,h1.QuestionHeader-title,article h1,h1')?.innerText.trim()||'';
    const bodies=p?[...p.querySelectorAll(body)].filter(e=>visible(e)&&!e.querySelector(body)&&!e.closest('form,[contenteditable="true"]')):[];
    for(const b of bodies){
      let row=b.closest(item);
      // Modern comment cards may use generated CSS names. Only infer a row
      // inside the panel, from a body with a nearby author and no sibling body.
      if(!row) for(let n=b.parentElement;n && n!==p;n=n.parentElement){
        if(n.querySelector('a[href*="/people/"],a[href*="/org/"]') && bodies.filter(x=>n.contains(x)).length===1){row=n;break;}
      }
      const text=b.innerText.trim();
      if(row && text)records.push({row,c:{id:row.dataset.commentId||row.id||'',text,
        nickname:[...row.querySelectorAll('.UserLink-link,a[href*="/people/"],a[href*="/org/"]')].find(
          e=>visible(e)&&(!e.closest(item)||e.closest(item)===row))?.textContent.trim()||'',
        capturedAt:new Date().toISOString()}});
    }
    const comments=relate(records,{site:'zh',root:'.NestComment--rootComment,.CommentItem,.CommentItemV2',
      reply:'.NestComment--child',group:'.NestComment',replyGroup:'.NestComment--child,.NestComment-childList'});
    return {title,comments,empty:!comments.length&&empty(p),rowCount:p?.querySelectorAll(item).length||0,
      challenge:/安全验证|验证码/.test(document.title)||[...document.querySelectorAll('[class*="Captcha"],.SignFlow,.SignFlowModal')].some(visible)};
  }
  function open(){
    const p=panel();
    if(p&&(p.querySelector(item)||empty(p)))return false;
    const scope=answer() || (location.hostname==='zhuanlan.zhihu.com'?document:null);
    const b=[...(scope?.querySelectorAll('button,[role="button"]')||[])].find(e=>visible(e)&&!e.disabled&&
      [e.innerText,e.getAttribute('aria-label'),e.title].some(s=>
        /^(?:添加评论|(?:查看|展开|打开)?\s*(?:[\d,.]+(?:万)?\+?\s*条?\s*)?评论(?:区)?(?:\s*[\d,.]+(?:万)?\+?)?)$/.test((s||'').trim())));
    if(!b)return false;
    openedFrom={url:location.href,owner:scope,existing:new Set([...dialogs(),...[...document.querySelectorAll(panels)].filter(visible)])};
    b.click();
    return true;
  }
  function next(){
    const p=panel();
    const button=[...(p?.querySelectorAll('button,[role="button"]')||[])].find(e=>
      visible(e) && !e.disabled && e.getAttribute('aria-disabled')!=='true' && !e.closest(item) &&
      [e.innerText,e.getAttribute('aria-label')].some(s=>/^(下一页|加载更多评论|查看更多评论)$/.test((s||'').trim())));
    if(!button)return false;
    button.click();
    return true;
  }
  function scroll(){
    const p=panel();
    if(!p)return null;
    for(const e of [p,...p.querySelectorAll('*')]){
      if(e.clientHeight>0 && e.scrollHeight>e.clientHeight+5 && /auto|scroll/.test(getComputedStyle(e).overflowY))return e;
    }
    return null;
  }
  return {snapshot,open,scroll,next,context};
})();
