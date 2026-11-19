"""Unpacked MV3 -> paired loopback receiver; only synthetic note pages."""
import os
from pathlib import Path
import sys
import tempfile
import threading
import time

from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server


def main(root):
    sys.path.insert(0, str(root))
    from server import Library, create
    ext = root / 'extension'
    ident = '0123456789abcdef01234567'
    host = 'https://www.xiaohongshu.com'
    canonical = f'{host}/explore/{ident}'
    fixture = '''<section class="note-item"><div class="title">不相关的推荐</div></section>
    <div id="noteContainer"><div id="detail-title">合成笔记</div><div id="detail-desc">不是评论</div>
    <div class="comments-container"><div class="comment-item" id="comment-a">
      <div class="author"><a class="name">甲</a></div><div class="content">主评论</div>
      <div class="comment-item-sub" id="comment-b"><div class="author"><a class="name">乙</a></div>
      <div class="content">已展开的回复</div></div></div></div></div>'''
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td, sync_playwright() as pw:
        lib = Library(Path(td)/'db')
        # Bind the ephemeral port before constructing the port-aware Flask app.
        http = make_server('127.0.0.1', 0, lambda e,s: [])
        http.app = create(lib, http.server_port)
        thread = threading.Thread(target=http.serve_forever,daemon=True)
        thread.start()
        try:
            ctx = pw.chromium.launch_persistent_context(Path(td)/'profile', headless=True,
                executable_path=os.environ.get('TEST_CHROMIUM') or pw.chromium.executable_path,
                args=[f'--load-extension={ext}', f'--disable-extensions-except={ext}', '--disable-background-networking'])
            try:
                worker = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
                ui = ctx.new_page()
                ui.goto(worker.url.rsplit('/',1)[0]+'/review.html')
                assert ui.evaluate("""async ([port,key])=>(await chrome.runtime.sendMessage(
                    {action:'bridge.pair',port,key,auto:true})).ok""", [http.server_port,lib.pair])
                page = ctx.new_page()
                page.route('**/*',lambda r:r.fulfill(content_type='text/html; charset=utf-8',body=fixture))
                for path in [f'/search_result/{ident}?ref=fixture',f'/explore/{ident}']:
                    url=host+path
                    page.goto(url)
                    def signal(action):
                        return ui.evaluate("""async ([url,action])=>{const t=(await chrome.tabs.query({})).find(t=>t.url===url);
                        try{return await chrome.tabs.sendMessage(t.id,{action,limit:50})}
                        catch{return {ok:false,message:'未连接笔记页'}}}""",[url,action])
                    result=signal('start')
                    if not result['ok']:
                        print(result['message'],flush=True)
                        raise AssertionError('小红书笔记未启动')
                    deadline=time.monotonic()+20
                    while (state:=signal('status')).get('running') or len(lib.rows())!=2:
                        assert time.monotonic()<deadline, state
                        time.sleep(.1)
                    assert state['completed'] and state['count']==2, state
                assert [(r['url'],r['title'],r['nick'],r['body']) for r in lib.rows()]==[
                    (canonical,'合成笔记','甲','主评论'),(canonical,'合成笔记','乙','已展开的回复')]
                again=ui.evaluate("async ()=>(await chrome.runtime.sendMessage({action:'bridge.push'})).note")
                assert '新增 0' in again and '已存在 2' in again, again
                print('小红书笔记：已保存 2 条；标题、正文、昵称、规范链接正确；重复补传新增 0。')
            finally:
                ctx.close()
        finally:
            http.shutdown()
            thread.join()
            http.server_close()


if __name__=='__main__':
    main(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent)
