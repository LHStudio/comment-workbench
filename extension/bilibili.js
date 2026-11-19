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
  function snapshot(){
    const p=panel(), title=first(document,'h1.video-title,h1[data-title],#viewbox_report h1')?.innerText.trim()||'';
    const rows=[],comments=[];
    walk(p?.shadowRoot||p,e=>{if(e.matches(rowSelector))rows.push(e);});
    for(const row of rows){
      let b=null,author=null;
      walk(row.shadowRoot||row,e=>{
        if(!visible(e))return;
        if(!b && (e.matches('.reply-content,.sub-reply-content') ||
            (e.id==='contents' && e.getRootNode().host?.matches('bili-rich-text'))))b=e;
        if(!author && e.matches('#user-name,.user-name,.sub-user-name'))author=e;
      },true);
      const value=text(b);
      if(value)comments.push({id:row.getAttribute('data-rpid')||row.dataset.id||'',nickname:author?.innerText.trim()||'',
        text:value,capturedAt:new Date().toISOString()});
    }
    return {title,comments,rowCount:rows.length,challenge:PostDOM.challenge()};
  }
  function open(){
    const p=panel()||document.querySelector('#commentapp,#comment');
    if(p)p.scrollIntoView({block:'center'});
    return !!p;
  }
  return {snapshot,open,scroll:()=>PostDOM.scroll(panel())};
})();
