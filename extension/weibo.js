const Weibo=(()=>{
  const {first,visible,text}=PostDOM;
  const main=()=>document.querySelector('main,[role="main"]')||document;
  const post=()=>first(main(),'article,[class*="Feed_detail"]');
  const list=()=>first(main(),'.wbpro-list,[class*="CommentList_list"],[node-type="comment_list"]');
  const rowSel='.item1,.item2,[data-comment-id],[comment_id]';
  function snapshot(){
    const p=post(),panel=list(),comments=[];
    const titleNode=first(p,'[class*="wbtext"],.WB_text,[node-type="feed_list_content"]');
    const title=titleNode?.innerText.trim().split(/\n/)[0].slice(0,120)||'';
    const rows=[...(panel?.querySelectorAll(rowSel)||[])].filter(visible);
    for(const row of rows){
      const own=sel=>[...row.querySelectorAll(sel)].find(e=>e.closest(rowSel)===row&&visible(e));
      const b=own('.text,.WB_text,[class*="comment_text"]');
      if(!b)continue;
      const profile='a[href*="/u/"],a[usercard],a[href*="/n/"]';
      const author=own(profile);
      const value=text(b,b.contains(author)?profile:null).replace(/^[：:]\s*/,'');
      if(value)comments.push({id:row.dataset.commentId||row.getAttribute('comment_id')||'',nickname:author?.innerText.trim()||'',
        text:value,capturedAt:new Date().toISOString()});
    }
    return {title,comments,rowCount:rows.length,challenge:PostDOM.challenge()||
      /登录后(?:查看|可见)评论/.test(panel?.innerText||''),empty:!rows.length&&/暂无评论|还没有评论/.test(panel?.innerText||'')};
  }
  function open(){
    const panel=list();
    if(panel){panel.scrollIntoView({block:'center'});return true;}
    const b=first(post(),'[aria-label="评论"],[title="评论"],[action-type="fl_comment"]');
    if(b)b.click();
    return !!b;
  }
  return {snapshot,open,scroll:()=>PostDOM.scroll(list())};
})();
