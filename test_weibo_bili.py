"""Offline browser-to-database regression for desktop status and video pages."""
import os
from pathlib import Path
import sys
import tempfile
import threading
import time

from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server


CASES = [
    ('微博', 'https://www.weibo.com/1234567890/Qabc12345?from=test',
     'https://weibo.com/1234567890/Qabc12345', '示例博文',
     '''<main><article><div class="detail_wbtext_demo">示例博文<br>第二行</div></article>
     <div class="wbpro-list"><div class="item1" data-comment-id="100">
     <div class="text"><a href="/u/123">甲</a>：第一条</div></div>
     <div class="item1" data-comment-id="101"><div class="text"><a href="/u/234">乙</a>：第二条</div></div></div>
     <aside class="text">推荐内容</aside></main>'''),
    ('B站', 'https://www.bilibili.com/video/BV1ab411c7de/?p=2',
     'https://www.bilibili.com/video/BV1ab411c7de', '示例视频',
     '''<style>bili-comments{display:block}</style><h1 class="video-title">示例视频</h1>
     <aside class="reply-content">弹幕不是评论</aside><bili-comments></bili-comments><script>
     function child(parent,tag){let n=document.createElement(tag);parent.append(n);
       n.style.display='block';return n.attachShadow({mode:'open'});}
     const thread=child(document.querySelector('bili-comments').attachShadow({mode:'open'}),'bili-comment-thread-renderer');
     function add(root,tag,name,body){
       const row=child(root,tag);
       child(row,'bili-comment-user-info').innerHTML='<a id="user-name">'+name+'</a>';
       child(row,'bili-rich-text').innerHTML='<p id="contents">'+body+'</p>';
     }
     add(thread,'bili-comment-renderer','甲','第一条');
     add(child(thread,'bili-comment-replies-renderer'),'bili-comment-reply-renderer','乙','第二条');
     </script>'''),
]


def main(root):
    sys.path.insert(0, str(root))
    from server import Library, create
    ext=root/'extension'
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td, sync_playwright() as pw:
        lib=Library(Path(td)/'db')
        http=make_server('127.0.0.1',0,lambda e,s:[])
        http.app=create(lib,http.server_port)
        thread=threading.Thread(target=http.serve_forever,daemon=True)
        thread.start()
        try:
            ctx=pw.chromium.launch_persistent_context(Path(td)/'profile',headless=True,
                executable_path=os.getenv('TEST_CHROMIUM') or pw.chromium.executable_path,
                args=[f'--load-extension={ext}',f'--disable-extensions-except={ext}','--disable-background-networking'])
            try:
                worker=(ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
                ui=ctx.new_page()
                ui.goto(worker.url.rsplit('/',1)[0]+'/review.html')
                assert ui.evaluate("""async ([port,key])=>(await chrome.runtime.sendMessage(
                    {action:'bridge.pair',port,key,auto:true})).ok""",[http.server_port,lib.pair])
                missing=[]
                for label,url,canonical,title,html in CASES:
                    page=ctx.new_page()
                    page.route('**/*',lambda r:r.fulfill(content_type='text/html; charset=utf-8',body=html))
                    page.goto(url)
                    def signal(action):
                        return ui.evaluate("""async ([url,action])=>{
                          const t=(await chrome.tabs.query({})).find(x=>x.url===url);
                          try{return await chrome.tabs.sendMessage(t.id,{action,limit:50})}catch{return {ok:false}}
                        }""",[url,action])
                    if not signal('start')['ok']:
                        missing.append(label)
                        page.close()
                        continue
                    deadline=time.monotonic()+25
                    while True:
                        state=signal('status')
                        rows=[r for r in lib.rows() if r['url']==canonical]
                        if not state.get('running') and len(rows)==2:break
                        assert time.monotonic()<deadline,(label,state,len(rows))
                        time.sleep(.15)
                    assert state['completed'] and state['count']==2
                    assert [(r['title'],r['nick'],r['body']) for r in rows]==[(title,'甲','第一条'),(title,'乙','第二条')]
                    page.close()
                    print(label,'保存 2 条',flush=True)
                if missing:
                    print('未连接：'+'、'.join(missing),flush=True)
                    raise AssertionError(missing)
                note=ui.evaluate("async ()=>(await chrome.runtime.sendMessage({action:'bridge.push'})).note")
                assert '新增 0' in note and '已存在 4' in note,note
                print(note)
            finally:
                ctx.close()
        finally:
            http.shutdown()
            thread.join()
            http.server_close()


if __name__=='__main__':
    main(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent)
