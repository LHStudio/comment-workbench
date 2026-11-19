const Weibo=(()=>{
  const {first,visible,text}=PostDOM;
  const main=()=>document.querySelector('main,[role="main"]')||document;
  const post=()=>first(main(),'article,[class*="Feed_detail"]');
  const panelSel='.wbpro-list,[class*="CommentList_list"],[node-type="comment_list"]';
  const omitted='aside,nav,[role="complementary"],[class*="recommend"],[class*="Recommend"]';
  function panels(){
    const p=post();
    return [...main().querySelectorAll(panelSel)].filter(e=>visible(e)&&!e.closest(omitted)&&
      (!e.closest('article')||e.closest('article')===p?.closest('article')));
  }
  const rowSel='.item1,.item2,[data-comment-id],[comment_id]';
  const more=/^(?:共\s*[\d,.万]+\s*条回复|(?:查看|展开|点击查看)(?:其余|剩余|全部|更多)?\s*[\d,.万]*\s*条?回复)[\s›〉>]*$/;
  const ref=id=>id?'wb:'+id:'';
  function read(row){
    const own=sel=>[...row.querySelectorAll(sel)].find(e=>e.closest(rowSel)===row&&visible(e));
    const b=own('.text,.WB_text,[class*="comment_text"]');
    if(!b)return null;
    const authorSel='[usercard],a[href*="/u/"],a[href*="/n/"],[class*="user-name"],[class*="userName"],a[href^="/profile/"]';
    const leading=b.querySelector('a,span[usercard],[class*="user-name"],[class*="userName"]');
    const profilePath=leading?.pathname||'';
    // Only remove a leading name, never the first @mention inside the message.
    const startsWithName=leading && !b.textContent.slice(0,b.textContent.indexOf(leading.textContent)).trim() &&
      (leading.matches(authorSel)||/^\/\d+(?:[/?#]|$)/.test(profilePath)||
       /^\s*[：:]/.test(leading.nextSibling?.textContent||''));
    const external=own(authorSel);
    const author=startsWithName?leading:external&&!b.contains(external)?external:null;
    const copy=b.cloneNode(true);
    if(startsWithName)copy.querySelector('a,span[usercard],[class*="user-name"],[class*="userName"]')?.remove();
    if(startsWithName){
      for(const e of copy.querySelectorAll('.badge,[class*="badge"],[class*="Badge"],[title="博主"]'))e.remove();
    }
    for(const e of copy.querySelectorAll(rowSel))e.remove();
    const value=text(copy).replace(/^[：:]\s*/,'');
    const id=row.dataset.commentId||row.getAttribute('comment_id')||'';
    if(!value||(!id&&!author&&more.test(value)))return null;
    return {id,nickname:author?.innerText.trim()||'',text:value,capturedAt:new Date().toISOString(),
      ref:ref(id),parentRef:ref(row.dataset.parentId||row.getAttribute('parent_id')),
      rootRef:ref(row.dataset.rootId||row.getAttribute('root_id'))};
  }
  function snapshot(){
    const p=post(),lists=panels(),comments=[];
    const titleNode=first(p,'[class*="wbtext"],.WB_text,[node-type="feed_list_content"]');
    const title=titleNode?.innerText.trim().split(/\n/)[0].slice(0,120)||'';
    const rows=[...new Set(lists.flatMap(panel=>[...panel.querySelectorAll(rowSel)]))].filter(e=>visible(e)&&!e.closest(omitted));
    const records=new Map(),lastRoot=new Map();
    for(const row of rows){
      const c=read(row);
      if(!c)continue;
      const list=row.closest(panelSel),ancestor=records.get(row.parentElement.closest(rowSel));
      const nested=!!(c.parentRef||c.rootRef||row.matches('.item2')||ancestor);
      if(!nested && row.matches('.item1')){c.depth=1;lastRoot.set(list,c);}
      if(nested){
        c.isReply=true;
        const root=ancestor?.depth===1?ancestor:ancestor?.threadRoot||lastRoot.get(list);
        if(root)c.threadRoot=root;
      }
      records.set(row,c);comments.push(c);
    }
    const byRef=new Map(comments.filter(c=>c.ref).map(c=>[c.ref,c]));
    for(const c of comments){
      let parent=c,depth=1,visited=new Set([c]);
      while(parent.parentRef){
        parent=byRef.get(parent.parentRef);
        if(!parent||visited.has(parent))break;
        visited.add(parent);depth++;
        if(parent.depth===1){c.depth=depth;c.threadRoot=parent;break;}
      }
    }
    const labels=lists.map(e=>e.innerText).join('\n');
    const collapsed=labels.split('\n').some(t=>more.test(t.trim()));
    const counter=first(p,'[aria-label="评论"],[title="评论"],[action-type="fl_comment"]');
    const count=counter?.innerText.trim();
    return {title,comments,rowCount:rows.length,collapsed,expected:/^\d+$/.test(count||'')?Number(count):null,
      challenge:PostDOM.challenge()||/登录后(?:查看|可见)评论/.test(labels),
      empty:!rows.length&&/暂无评论|还没有评论/.test(labels)};
  }
  function open(){
    const panel=panels()[0];
    if(panel){panel.scrollIntoView({block:'center'});return true;}
    const b=first(post(),'[aria-label="评论"],[title="评论"],[action-type="fl_comment"]');
    if(b)b.click();
    return !!b;
  }
  return {snapshot,open,scroll:()=>PostDOM.scroll(panels().at(-1))};
})();
