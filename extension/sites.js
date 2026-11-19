// Shared by the popup, content scripts and MV3 worker.
const Sites = (() => {
  const patterns = [
    ['知乎文章', 'https://zhuanlan.zhihu.com', /^\/p\/[0-9]+$/],
    ['知乎回答', 'https://www.zhihu.com', /^\/question\/[0-9]+\/answer\/[0-9]+$/],
    ['抖音视频', 'https://www.douyin.com', /^\/video\/[0-9]{15,22}$/],
  ];
  function work(raw) {
    try {
      const u = new URL(raw), path = u.pathname.replace(/\/$/, '');
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
