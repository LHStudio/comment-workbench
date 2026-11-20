(() => {
  const links = [...document.querySelectorAll('nav a[data-view]')];
  const pages = [...document.querySelectorAll('[data-page]')];
  document.getElementById('creditVersion').textContent = 'v' + chrome.runtime.getManifest().version;
  const hashes = new Map([['#samples','samples'],['#topicPanel','topic'],['#tools','tools']]);
  const current = () => {
    const url = new URL(location.href);
    return links.find(a=>a.dataset.view === (hashes.get(url.hash) || url.searchParams.get('view'))) || links[0];
  };
  function render(){
    const link = current(), view = link.dataset.view;
    if(location.href !== link.href&&!new URL(location.href).searchParams.has('question'))history.replaceState(null,'',link.href);
    for(const a of links){
      if(a === link)a.setAttribute('aria-current','page');
      else a.removeAttribute('aria-current');
    }
    for(const section of pages)section.hidden = section.dataset.page !== view;
    document.title = link.textContent + ' · 评论工作台';
    window.scrollTo(0,0);
  }
  for(const link of links)link.addEventListener('click',event=>{
    if(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    event.preventDefault();
    if(location.href !== link.href)history.pushState(null,'',link.href);
    render();
  });
  window.addEventListener('popstate',render);
  window.addEventListener('hashchange',render);
  render();
})();
