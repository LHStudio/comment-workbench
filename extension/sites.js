// Shared by the popup, content scripts and MV3 worker.
const Sites = (() => {
  const patterns = [
    ['知乎文章', 'https://zhuanlan.zhihu.com', /^\/p\/[0-9]+$/],
    ['知乎回答', 'https://www.zhihu.com', /^\/question\/[0-9]+\/answer\/[0-9]+$/],
    ['抖音视频', 'https://www.douyin.com', /^\/video\/[0-9]{15,22}$/],
    ['B站视频', 'https://www.bilibili.com', /^\/video\/(?:BV[0-9A-Za-z]{10}|av[1-9][0-9]*)$/],
  ];
  function work(raw) {
    try {
      const u = new URL(raw), path = u.pathname.replace(/\/$/, '');
      if(u.username || u.password)return null;
      if(['https://weibo.com','https://www.weibo.com'].includes(u.origin) && /^\/[1-9]\d{3,19}\/[A-Za-z0-9]{7,16}$/.test(path)){
        return {label:'微博正文',url:'https://weibo.com'+path};
      }
      if(u.origin==='https://www.xiaohongshu.com' && !u.username && !u.password){
        const note=path.match(/^\/(?:explore|discovery\/item|search_result)\/([0-9a-f]{24})$/i);
        if(note)return {label:'小红书笔记',url:u.origin+'/explore/'+note[1].toLowerCase()};
      }
      const match = patterns.find(([,origin,re]) => origin === u.origin && re.test(path));
      if (match && !u.username && !u.password) return {label:match[0],url:u.origin+path};
    } catch {}
    return null;
  }
  return {work};
})();
