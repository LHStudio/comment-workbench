// Only loaded on Zhihu. Work inside the comment panel, never article prose.
const Zhihu = (() => {
  const panels = '.Comments-container,.CommentsV2,.Comments-wrapper,.Comments,.CommentList,[class*="CommentsV2"]';
  const item = '[data-comment-id],[id^="comment-"],.CommentItem,.CommentItemV2,.NestComment--rootComment,.NestComment--child';
  const body = '.CommentContent,.CommentItem-content,.CommentItemV2-content,.RichText,.RichContent-inner,[data-role="comment-content"],.ztext';
  const visible = n => n && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  const answer = () => {
    const id = location.pathname.match(/\/answer\/(\d+)/)?.[1];
    if (!id) return null;
    return [...document.querySelectorAll('.AnswerItem')].find(e =>
      e.getAttribute('name')===id || e.dataset.zop?.includes(`"itemId":${id}`) ||
      [...e.querySelectorAll('meta[itemprop="url"],a[itemprop="url"]')].some(x=>Sites.work(x.content||x.href)?.url===Sites.work(location.href)?.url));
  };
  function panel(){
    const all=[...document.querySelectorAll(panels)].filter(visible);
    const current=answer();
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
    return dialogs.find(p=>/评论/.test(p.innerText) && (p.querySelector(item) || p.querySelector(body))) ||
      all.find(p=>!p.closest('.AnswerItem') || p.closest('.AnswerItem')===current);
  }
  function snapshot(){
    const p=panel(), comments=[];
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
      if(row && text) comments.push({id:row.dataset.commentId||row.id||'',text,
        nickname:row.querySelector('.UserLink-link,a[href*="/people/"],a[href*="/org/"]')?.textContent.trim()||'',
        capturedAt:new Date().toISOString()});
    }
    return {title,comments,rowCount:p?.querySelectorAll(item).length||0,
      challenge:/安全验证|验证码/.test(document.title)||[...document.querySelectorAll('[class*="Captcha"],.SignFlow,.SignFlowModal')].some(visible)};
  }
  function open(){
    if(panel())return;
    const scope=answer() || (location.hostname==='zhuanlan.zhihu.com'?document:null);
    const b=[...(scope?.querySelectorAll('button')||[])].find(e=>visible(e)&&/^(?:添加评论|评论|\d[\d,.万]*\s*条?评论)$/.test((e.innerText||e.getAttribute('aria-label')||'').trim()));
    b?.click();
  }
  function scroll(){
    const p=panel();
    if(!p)return null;
    for(const e of [p,...p.querySelectorAll('*')]){
      if(e.clientHeight>0 && e.scrollHeight>e.clientHeight+5 && /auto|scroll/.test(getComputedStyle(e).overflowY))return e;
    }
    return null;
  }
  return {snapshot,open,scroll};
})();
