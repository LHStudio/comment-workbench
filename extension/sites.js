// Shared by the popup, content scripts and MV3 worker.
const Sites = (() => {
  const platforms = [
    {id:'douyin',label:'抖音',home:'https://www.douyin.com/'},
    {id:'zhihu',label:'知乎',home:'https://www.zhihu.com/'},
    {id:'xhs',label:'小红书',home:'https://www.xiaohongshu.com/'},
    {id:'weibo',label:'微博',home:'https://weibo.com/'},
    {id:'bili',label:'哔哩哔哩',home:'https://www.bilibili.com/'},
  ];
  const platform=id=>platforms.find(p=>p.id===id);
  function search(id,term){
    const q=String(term??'').trim();
    if(!q||!platform(id))return null;
    const key=encodeURIComponent(q);
    switch(id){
      case 'douyin':return 'https://www.douyin.com/search/'+key+'?type=video';
      case 'zhihu':return 'https://www.zhihu.com/search?type=content&q='+key;
      case 'xhs':return 'https://www.xiaohongshu.com/search_result?keyword='+key;
      case 'weibo':return 'https://s.weibo.com/weibo?q='+key;
      case 'bili':return 'https://search.bilibili.com/all?keyword='+key;
    }
  }
  // Filters/tracking may be rewritten; ownership still requires a recognized
  // search route and one unambiguous, decoded term. Never accept detail pages.
  function searchPage(raw){
    try {
      const u=new URL(raw),path=u.pathname.replace(/\/$/,'');
      if(u.username||u.password||u.searchParams.has('modal_id'))return null;
      let id, pathTerm, key;
      if(u.origin==='https://www.douyin.com' && /^\/search(?:\/[^/]+)?$/.test(path)){
        id='douyin';key='keyword';if(path!=='/search')pathTerm=decodeURIComponent(path.slice(8));
      }else if(u.origin==='https://www.zhihu.com'&&path==='/search'){
        id='zhihu';key='q';
      }else if(u.origin==='https://www.xiaohongshu.com'&&path==='/search_result'){
        id='xhs';key='keyword';
      }else if(u.origin==='https://s.weibo.com'&&/^\/weibo(?:\/[^/]+)?$/.test(path)){
        id='weibo';key='q';if(path!=='/weibo')pathTerm=decodeURIComponent(path.slice(7));
      }else if(u.origin==='https://search.bilibili.com'&&['/all','/video'].includes(path)){
        id='bili';key='keyword';
      }else return null;
      const terms=u.searchParams.getAll(key);
      if(pathTerm!=null)terms.push(pathTerm);
      if(!terms.length||terms.some(t=>!t.trim()||t!==terms[0]))return null;
      return {id,term:terms[0]};
    }catch{return null;}
  }
  function sameSearch(actual,expected){
    const a=searchPage(actual),b=searchPage(expected);
    return !!a&&!!b&&a.id===b.id&&a.term===b.term;
  }
  const patterns = [
    ['知乎文章', 'https://zhuanlan.zhihu.com', /^\/p\/[0-9]+$/,'zhihu'],
    ['知乎回答', 'https://www.zhihu.com', /^\/question\/[0-9]+\/answer\/[0-9]+$/,'zhihu'],
    ['抖音视频', 'https://www.douyin.com', /^\/video\/[0-9]{15,22}$/,'douyin'],
    ['B站视频', 'https://www.bilibili.com', /^\/video\/(?:BV[0-9A-Za-z]{10}|av[1-9][0-9]*)$/,'bili'],
  ];
  function work(raw) {
    try {
      const u = new URL(raw), path = u.pathname.replace(/\/$/, '');
      if(u.username || u.password)return null;
      if(['https://weibo.com','https://www.weibo.com'].includes(u.origin) && /^\/[1-9]\d{3,19}\/[A-Za-z0-9]{7,16}$/.test(path)){
        return {label:'微博正文',url:'https://weibo.com'+path,platform:'weibo'};
      }
      if(u.origin==='https://www.xiaohongshu.com' && !u.username && !u.password){
        const note=path.match(/^\/(?:explore|discovery\/item|search_result)\/([0-9a-f]{24})$/i);
        if(note)return {label:'小红书笔记',url:u.origin+'/explore/'+note[1].toLowerCase(),platform:'xhs'};
      }
      const match = patterns.find(([,origin,re]) => origin === u.origin && re.test(path));
      if (match) return {label:match[0],url:u.origin+path,platform:match[3]};
    } catch {}
    return null;
  }
  return {work,platforms,platform,search,sameSearch,searchPage};
})();
