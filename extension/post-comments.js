// Shared helpers for desktop post/video adapters. Never scroll unrelated sidebars.
const PostDOM=(()=>{
  const visible=e=>e && e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden';
  const first=(scope,sel)=>[...(scope?.querySelectorAll(sel)||[])].find(visible);
  function text(node,without){
    if(!node)return '';
    const copy=node.cloneNode(true);
    if(without)copy.querySelector(without)?.remove();
    for(const img of copy.querySelectorAll('img'))img.replaceWith(img.alt||'');
    for(const br of copy.querySelectorAll('br'))br.replaceWith('\n');
    return copy.textContent.trim();
  }
  function scroll(panel){
    if(!panel)return null;
    for(let e=panel;e&&e!==document.body;e=e.parentElement){
      if(e.scrollHeight>e.clientHeight+5 && /auto|scroll/.test(getComputedStyle(e).overflowY))return e;
    }
    // Do not follow the document past a short comment section into recommendations.
    const box=document.scrollingElement;
    return box && panel.getBoundingClientRect().bottom>innerHeight+5 ? box:null;
  }
  const challenge=()=>/安全验证|验证码|访问验证/.test(document.title) ||
    !!first(document,'.geetest_panel,.geetest_panel_box,.bili-mini-mask-wp,[class*="captcha-dialog"]');
  return {visible,first,text,scroll,challenge};
})();
