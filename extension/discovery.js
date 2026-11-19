/* Read only cards rendered on the platform's search page. No internal APIs. */
(() => {
  const visible = e => e && e.getClientRects().length && (typeof e.checkVisibility==='function'?
    e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):getComputedStyle(e).visibility==='visible');
  const clean = s => (s || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const excluded='aside,nav,header,footer,[role="navigation"],[role="complementary"],[role="dialog"],[hidden],[inert],[aria-hidden="true"],[class*="recommend" i],[class*="sidebar" i],[aria-label*="推荐"],[data-e2e*="recommend" i]';
  const eligible=e=>visible(e)&&!e.closest(excluded);
  const cards = {
    douyin: '[id^="waterfall_item_"],[data-e2e="search-result"] [data-e2e="video-item"],[data-e2e="search-card-video"],#waterFallScrollContainer li',
    zhihu: '.SearchResult-Card,.SearchResultCard,.SearchResult-CardContainer,.Search-container .ContentItem',
    xhs: '.note-item,.feeds-container [data-note-id]',
    weibo: '#pl_feedlist_index .card-wrap,.card-wrap[action-type="feed_list_item"],.card-wrap[mid]',
    bili: '.bili-video-card,.video-list-item,.video-list .video-item',
  };
  const pointers = {
    douyin: 'a[href*="/video/"],a[href*="modal_id="]',
    zhihu: '.ContentItem-title a[href],h2 a[href],a[data-za-detail-view-element_name="Title"]',
    xhs: 'a.cover[href],a.title[href],a[href*="/explore/"],a[href*="/search_result/"],a[href*="/discovery/item/"]',
    weibo: '.from a[href],a[node-type="feed_list_item_date"],a[data-url][date]',
    bili: 'a[href*="/video/"]',
  };
  function gate() {
    const captcha = [...document.querySelectorAll('[id*="captcha" i],[class*="captcha" i],[class*="verify-dialog" i],iframe[src*="captcha" i]')].some(visible);
    if(captcha || /验证码|安全验证|验证中心/.test(document.title)) return '需要安全验证';
    const prompts = [...document.querySelectorAll('[role="dialog"],dialog,[class*="login-modal" i],[class*="login-mask" i],[class*="login-guide" i],[class*="login-container" i],.Modal-wrapper,[role="alert"],[class*="error-page" i],[class*="access-denied" i]')].filter(visible);
    const messages = prompts.map(e=>clean(e.innerText)).concat(document.title);
    const body = document.body?.innerText?.trim() || '';
    if (body.length < 500) messages.push(...body.split('\n').map(s=>s.trim()).filter(s=>s.length<85));
    if(messages.some(t=>/安全验证|拖动滑块|人机验证|完成验证|访问频繁|操作(?:过于|太)频繁/.test(t)))return '需要安全验证或平台限制访问';
    if(messages.some(t=>/权限不足|暂无权限|无权(?:查看|访问)|仅(?:粉丝|自己|好友)可见|没有访问权限|内容不可见|内容不存在|作品已删除/.test(t)))return '无权访问或作品不可见';
    if(prompts.some(e=>/登录|登入/.test(clean(e.innerText))) ||
       messages.some(t=>/(?:请先|必须|需要|立即)登录|登录后(?:才可|即可|可)?(?:查看|浏览|继续|搜索)|请登录(?:后|以)|登录(?:后)?可见/.test(t)))return '需要登录后继续';
    return '';
  }
  function discover(platform, limit) {
    const found = new Map();
    const resultAreas='main,[role="main"],[role="list"],#waterFallScrollContainer,#pl_feedlist_index,.Search-container,.feeds-container,.video-list,[data-e2e="search-result"],[class*="search-result" i]';
    // Known cards can be outside semantic landmarks. Generic work links need
    // a result-area ancestor; exclude sidebar cards even if their class matches.
    for(const card of document.querySelectorAll(`${cards[platform]},a[href]`)) {
      if(!eligible(card))continue;
      const known=card.matches(cards[platform]);
      if(!known&&(!card.closest(resultAreas)||card.closest(cards[platform])))continue;
      const titleEl = [...card.querySelectorAll('.ContentItem-title,.title,h2,h3,[class*="video-title"],[node-type="feed_list_content"],[data-e2e="video-desc"],.BjLsdJMi')].find(eligible);
      const add = (raw, title) => {
        if(!raw)return false;
        let u;
        try { u = new URL(raw, location.href); } catch { return false; }
        if(platform==='douyin' && u.origin===location.origin && /^\/search\//.test(u.pathname) && /^\d{15,22}$/.test(u.searchParams.get('modal_id')||''))u=new URL('/video/'+u.searchParams.get('modal_id'),location.origin);
        const w = Sites.work(u.href);
        if(w?.platform!==platform)return false;
        const row={url:w.url,title:clean(title) || w.label};
        if(platform==='xhs' && u.search)row.openUrl=u.origin+u.pathname+u.search;
        if(!found.has(w.url) || row.openUrl)found.set(w.url,row);
        return true;
      };
      const title=titleEl?.getAttribute('title') || titleEl?.innerText;
      if(card.matches('a[href]'))add(card.href,title||card.title||card.innerText);
      else {
        const primary=[...card.querySelectorAll(pointers[platform])];
        const anchors=[...new Set([...primary,...card.querySelectorAll('a[href]')])].filter(eligible);
        for(const a of anchors){
          if(add(a.getAttribute('href') || a.dataset.url,title||a.title||a.innerText))break;
        }
      }
      if(platform==='douyin') {
        const id=card.id.match(/^waterfall_item_(\d{15,22})$/)?.[1];
        if(id)add('/video/'+id,title||card.innerText);
      }
      if(found.size>=limit)break;
    }
    const empty=[...document.querySelectorAll('[class*="empty" i],[class*="no-result" i],.card-no-result,[data-e2e="search-no-result"]')].some(e=>visible(e)&&/无|没有|未找到|暂无|未搜到/.test(e.innerText));
    return {rows:[...found.values()].slice(0,limit),empty};
  }
  function advance(){
    const box=document.querySelector('#waterFallScrollContainer');
    const scroller=box&&visible(box)&&box.scrollHeight>box.clientHeight?box:document.scrollingElement;
    scroller?.scrollBy(0,Math.max(scroller.clientHeight*.85,320));
  }
  chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(m.action==='topic.probe') {reply({ok:true,gate:gate()});return;}
    if(m.action!=='topic.discover')return;
    const expected=Sites.search(m.platform,m.term);
    if(!expected || !cards[m.platform]){reply({ok:false});return;}
    if(!Sites.sameSearch(location.href,expected)){reply({ok:false});return;}
    const limit=Math.max(1,Math.min(50,m.limit|0)), blocked=gate();
    const data=discover(m.platform,limit);
    if(m.advance && !blocked && !data.empty) {
      advance();
    }
    reply({ok:true,...data,gate:blocked});
  });
})();
