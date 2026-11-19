const Bilibili=(()=>{
  const {first,visible,text}=PostDOM;
  const panel=()=>document.querySelector('bili-comments')||first(document,'#comment,.comment-container');
  const rowSelector='bili-comment-renderer,bili-comment-reply-renderer,.root-reply-container,.sub-reply-item,.reply-item[data-id]';
  // Search open component trees inside comments only. When reading an individual
  // row, stop at nested rows so a reply cannot supply its parent's text or name.
  function walk(root,visitor,stopAtRows=false){
    if(!root)return;
    for(const e of root.children){
      if(stopAtRows && e.matches(rowSelector))continue;
      visitor(e);
      if(e.shadowRoot)walk(e.shadowRoot,visitor,stopAtRows);
      walk(e,visitor,stopAtRows);
    }
  }
  function exposed(body,mask){
    if(!body||!body.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return false;
    const range=document.createRange();range.selectNodeContents(body);
    const boxes=[...range.getClientRects()].filter(r=>r.width&&r.height);
    return boxes.length>0 && boxes.every(r=>{
      if(r.top<0||r.left<0||r.right>innerWidth||r.bottom>innerHeight)return false;
      if(mask&&r.left<mask.right&&mask.left<r.right&&r.top<mask.bottom&&mask.top<r.bottom)return false;
      const x=r.x+r.width/2,y=r.y+r.height/2;
      let hit=document.elementFromPoint(x,y);
      while(hit?.shadowRoot){
        const child=hit.shadowRoot.elementFromPoint(x,y);
        if(!child||child===hit)break;hit=child;
      }
      return hit===body||body.contains(hit);
    });
  }
  function snapshot(relate){
    const p=panel(), title=first(document,'h1.video-title,h1[data-title],#viewbox_report h1')?.innerText.trim()||'';
    const rows=[],records=[];
    let loginGate=false,mask=null,spinner=false;
    walk(p?.shadowRoot||p,e=>{
      if(e.matches(rowSelector))rows.push(e);
      if(e.matches('bili-comments-spinner')&&visible(e))spinner=true;
      if(e.matches('#limit-mask-tip,#limit-mask')&&visible(e)&&/登录后(?:查看|可见|浏览)/.test(e.innerText)){
        loginGate=true;
        if(e.id==='limit-mask')mask=e.getBoundingClientRect();
      }
    });
    for(const row of rows){
      let b=null,author=null;
      walk(row.shadowRoot||row,e=>{
        if(!visible(e))return;
        if(!b && (e.matches('.reply-content,.sub-reply-content') ||
            (e.id==='contents' && e.getRootNode().host?.matches('bili-rich-text'))))b=e;
        if(!author && e.matches('#user-name,.user-name,.sub-user-name'))author=e;
      },true);
      if(loginGate&&!exposed(b,mask))continue;
      const value=text(b);
      if(value)records.push({row,c:{id:row.getAttribute('data-rpid')||row.dataset.id||'',nickname:author?.innerText.trim()||'',
        text:value,capturedAt:new Date().toISOString()}});
    }
    const comments=relate(records,{site:'bili',root:'bili-comment-renderer,.root-reply-container,.reply-item[data-id]',
      reply:'bili-comment-reply-renderer,.sub-reply-item',group:'bili-comment-thread-renderer,.reply-item',
      replyGroup:'bili-comment-replies-renderer,.sub-reply-list'});
    return {title,comments,rowCount:rows.length,challenge:loginGate||PostDOM.challenge(),
      loading:!rows.length&&(spinner||!!document.querySelector('#commentapp'))};
  }
  function open(){
    const p=panel()||document.querySelector('#commentapp,#comment');
    if(p)p.scrollIntoView({block:'center'});
    return !!p;
  }
  return {snapshot,open,scroll:()=>PostDOM.scroll(panel())};
})();
