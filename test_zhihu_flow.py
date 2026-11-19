"""Regression fixture: two answers, a collapsed panel and two pages of comments."""
import os
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


URL = 'https://www.zhihu.com/question/12/answer/34'
FIXTURE = '''
<h1 class="QuestionHeader-title">示例问题</h1>
<section class="AnswerItem" data-zop='{"itemId":340}'>
  <section class="Comments-container"><div data-comment-id="wrong">
    <span class="RichText">不是本回答的评论</span></div></section>
</section>
<section class="AnswerItem" data-zop='{"itemId": 34}'>
  <button aria-label="查看 2 条评论" onclick="document.querySelector('#mine').hidden=false">2</button>
  <section id="mine" class="Comments-container" hidden>
    <div data-comment-id="first"><a href="/people/test">用户甲</a><span class="RichText">第一条</span></div>
    <button onclick="setTimeout(()=>{const r=this.previousElementSibling;r.dataset.commentId='second';
      r.querySelector('span').textContent='第二条';this.disabled=true},300)">下一页</button>
  </section>
</section>'''


def main():
    ext = Path(__file__).resolve().parent / 'extension'
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td, sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(td, headless=True,
            executable_path=os.getenv('TEST_CHROMIUM') or pw.chromium.executable_path,
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}', '--disable-background-networking'])
        try:
            worker = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            page = ctx.new_page()
            page.route('**/*', lambda r: r.fulfill(content_type='text/html; charset=utf-8', body=FIXTURE))
            page.goto(URL)
            ui = ctx.new_page()
            ui.goto(worker.url.rsplit('/', 1)[0]+'/review.html')
            ui.evaluate("""async url=>{
                const [tab]=await chrome.tabs.query({url});
                const response=await chrome.tabs.sendMessage(tab.id,{action:'start',limit:2});
                if(!response.ok) throw Error(response.message);
            }""", URL)
            deadline=time.monotonic()+20
            while True:
                status=ui.evaluate("""async url=>{const [t]=await chrome.tabs.query({url});
                    return chrome.tabs.sendMessage(t.id,{action:'status'})}""", URL)
                if not status['running']:break
                assert time.monotonic()<deadline, status
                time.sleep(.15)
            result = ui.evaluate("async url=>(await chrome.storage.local.get('video:'+url))['video:'+url]", URL)
            assert result is not None, status
            rows=[c['text'] for c in result['comments']]
            print(result['title'], rows)
            assert result['title']=='示例问题' and rows==['第一条','第二条'], result['state']
        finally:
            ctx.close()


if __name__=='__main__':
    main()
