"""Isolated MV3 + real HTTP test. No requests to the Douyin site."""
import os
import socket
import tempfile
import threading
from contextlib import closing
from pathlib import Path
from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server
from server import Library, create

def main():
    root=Path(__file__).resolve().parent
    ext=root/'extension'
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td,sync_playwright() as pw:
        lib=Library(Path(td)/'data')
        with closing(socket.socket()) as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        app=create(lib,port)
        with app.test_client() as api:
            assert api.post('/api/receive',base_url=base,json={'rows':[]}).status_code==403
            assert api.post('/api/receive',base_url=base,json={'rows':[]},headers={'X-Pair-Key':lib.pair,'Origin':'https://elsewhere.invalid'}).status_code==403
        http=make_server('127.0.0.1',port,app,threaded=True)
        threading.Thread(target=http.serve_forever,daemon=True).start()
        exe=os.environ.get('TEST_CHROMIUM') or pw.chromium.executable_path
        ctx=pw.chromium.launch_persistent_context(Path(td)/'profile',headless=True,executable_path=exe,
          args=[f'--disable-extensions-except={ext}',f'--load-extension={ext}','--disable-background-networking'])
        try:
            worker=(ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            ident=worker.url.split('/')[2]
            ui=ctx.new_page();ui.goto('chrome-extension://'+ident+'/review.html')
            ui.get_by_text('连接分析工作台',exact=True).click()
            ui.locator('#port').fill(str(port));ui.locator('#pairKey').fill('wrong')
            ui.get_by_text('连接并保存',exact=True).click();ui.get_by_text('配对码不匹配',exact=True).wait_for()
            ui.locator('#pairKey').fill(lib.pair);ui.get_by_text('连接并保存',exact=True).click()
            ui.get_by_text('配对成功',exact=True).wait_for()
            url='https://www.douyin.com/video/1234567890123456789'
            video=ctx.new_page()
            video.route('**/*',lambda r:r.fulfill(status=200,content_type='text/html; charset=utf-8',
              body='<h1>豆包看报告</h1><div data-e2e="comment-list"><div data-e2e="comment-item"><a href="/user/0"></a><a href="/user/0">样本作者</a><span id="tooltip_test"></span><b data-e2e="comment-content">非常好用</b></div></div>'))
            video.goto(url)
            resp=ui.evaluate("""async url=>{const [t]=await chrome.tabs.query({url});
              return chrome.tabs.sendMessage(t.id,{action:'start',limit:1})}""",url)
            assert resp['ok']
            ui.get_by_text('已发送 1 条：新增 1，已存在 0。',exact=True).wait_for(timeout=20000)
            ui.locator('#push').click();ui.get_by_text('已发送 1 条：新增 0，已存在 1。',exact=True).wait_for()
            assert len(lib.rows())==1 and lib.rows()[0]['nick']=='样本作者'
            desk=ctx.new_page();desk.goto(base);desk.locator('#rows .row select').select_option('混合')
            desk.get_by_text('改判已保存',exact=False).wait_for()
            desk.locator('#subset').select_option('混合');desk.locator('#run').click()
            desk.get_by_text('报告已生成：1 条评论',exact=True).wait_for(timeout=30000)
            assert lib.latest()['labels']['混合']==1
            desk.wait_for_function("document.querySelectorAll('figure img').length===3 && [...document.querySelectorAll('figure img')].every(i=>i.complete&&i.naturalWidth===1200)")
            desk.set_viewport_size({'width':390,'height':844});assert desk.evaluate('document.documentElement.scrollWidth<=innerWidth')
            with desk.expect_download() as download:desk.locator('#csv').click()
            assert '非常好用' in Path(download.value.path()).read_text(encoding='utf-8-sig')
            for no, work in enumerate(['https://zhuanlan.zhihu.com/p/123',
                                      'https://www.zhihu.com/question/12/answer/34'], 1):
                page=ctx.new_page()
                page.route('**/*',lambda r:r.fulfill(status=200,content_type='text/html; charset=utf-8',
                    body='<article><h1>测试作品</h1><div class="RichText">不是评论</div></article>'
                         '<section class="Comments-container"><div data-comment-id="a1">'
                         '<a href="/people/test">测试作者</a><div class="RichText">评论正文</div></div></section>'))
                page.goto(work+'?utm_source=test')
                assert ui.evaluate("""async url=>{const [t]=await chrome.tabs.query({url:url+'*'});
                    return (await chrome.tabs.sendMessage(t.id,{action:'start',limit:1})).ok}""",work)
                ui.wait_for_function("""async url=>(await chrome.storage.local.get('video:'+url))['video:'+url]?.comments.length===1""",arg=work)
                import time
                deadline=time.monotonic()+10
                while len(lib.rows())<no+1 and time.monotonic()<deadline:time.sleep(.1)
                row=lib.rows()[-1]
                assert (row['url'],row['title'],row['body'],row['nick'])==(work,'测试作品','评论正文','测试作者')
                page.close()
            print('PASS: Douyin, Zhihu article and answer: capture -> paired HTTP -> SQLite; title/body isolation; canonical URL; repeat dedup; CSV/report.')
        finally:ctx.close();http.shutdown();http.server_close()

if __name__=='__main__':main()
