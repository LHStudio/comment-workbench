// Read only the open note. Feed cards and account/profile pages are out of scope.
const Xiaohongshu = (() => {
  const visible = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const first = (scope, sel) => [...(scope?.querySelectorAll(sel)||[])].find(visible);
  const root = () => first(document,'#noteContainer,.note-detail-mask .note-container,.note-container');
  const panel = note => first(note,'.comments-container,.comments-el,.comments-list,.list-container[data-comments]');
  const rows = '.comment-item,.comment-item-sub,[data-comment-id]';
  function snapshot(){
    const note=root(), list=panel(note), comments=[];
    const heading=first(note,'#detail-title,.note-content .title,h1');
    const intro=first(note,'#detail-desc,.note-content .desc');
    const title=heading?.innerText.trim() || intro?.innerText.trim().split(/\n/)[0].slice(0,80) || (note?'无标题笔记':'');
    const items=[...(list?.querySelectorAll(rows)||[])].filter(visible);
    for(const row of items){
      const own=sel=>[...row.querySelectorAll(sel)].find(e=>visible(e)&&e.closest(rows)===row);
      const body=own('.content,.comment-content');
      if(!body)continue;
      const copy=body.cloneNode(true);
      for(const img of copy.querySelectorAll('img'))img.replaceWith(img.alt||'');
      const text=copy.textContent.trim();
      if(text)comments.push({id:row.dataset.commentId||row.id||'',text,
        nickname:own('.author .name,.author a.name,.author a[href*="/user/profile/"]')?.innerText.trim()||'',
        capturedAt:new Date().toISOString()});
    }
    const challenge=!!first(document,'.login-modal,.login-container,[class*="captcha"],#captcha') ||
      /安全验证|验证码/.test(document.title) || /登录后(?:查看|可见)评论/.test(list?.innerText||'');
    const empty=!items.length && /暂无评论|还没有评论|暂时没有评论/.test(list?.innerText||'');
    return {title,comments,challenge,empty,rowCount:items.length};
  }
  function open(){
    const note=root();
    if(!note || panel(note))return false;
    const b=first(note,'.interact-container .chat-wrapper,.interact-container .chat,[aria-label="评论"]');
    if(b){b.click();return true;}
    return false;
  }
  function scroll(){
    const note=root(), list=panel(note);
    for(let e=list;e && note.contains(e);e=e.parentElement){
      if(e.scrollHeight>e.clientHeight+5 && /auto|scroll/.test(getComputedStyle(e).overflowY))return e;
    }
    return null;
  }
  return {snapshot,open,scroll};
})();
