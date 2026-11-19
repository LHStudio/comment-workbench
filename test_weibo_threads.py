"""Offline regression: a desktop thread with independent, lazy-loaded floors."""
import csv
import os
import sqlite3
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server

URL = 'https://weibo.com/1234567890/Qabc12345'
HTML = '''<main><article><div class="wbtext">测试博文</div></article>
<section id="floors" style="height:260px;overflow:auto">
<div class="wbpro-list"><div class="item1" data-comment-id="100"><div class="text"><a href="/123456">甲</a><i class="badge">博主</i>：第一条</div>
<div class="item2" data-comment-id="101" data-parent-id="100"><div class="text"><a href="/u/234">乙</a>：同意</div></div>
<div class="item2" data-comment-id="102" data-parent-id="101"><div class="text"><a href="/u/345">丙</a>：回复乙</div></div>
<div class="item2" data-comment-id="103"><div class="text"><a href="/u/456">丁</a>：楼内留言</div></div>
<div class="item2"><div class="text"><button>共14条回复</button></div></div></div></div>
<div class="wbpro-list" style="height:350px"><div class="item1"><div class="text"><a href="/u/567">戊</a>：第二楼</div></div></div>
</section><aside><div class="wbpro-list"><div class="item1"><div class="text">推荐</div></div></div></aside></main>
<script>floors.addEventListener('scroll',()=>floors.insertAdjacentHTML('beforeend',
'<div class="wbpro-list"><div class="item1"><div class="text"><a href="/u/678">己</a>：延迟加载</div></div></div>'),{once:true})</script>'''


def main(root):
    sys.path.insert(0, str(root))
    from server import Library, create
    ext = root/'extension'
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td, sync_playwright() as pw:
        old = Path(td)/'old'
        old.mkdir()
        db = sqlite3.connect(old/'analysis.sqlite')
        with db:
            db.execute("""create table comments(rid integer primary key,url text,key text,title text,
                nick text,body text,stamp text,hint text,manual text,unique(url,key))""")
            db.execute("insert into comments values(1,?,'100','测试博文','甲','第一条','','','正向')",(URL,))
        db.close()
        lib = Library(Path(td)/'db')
        http = make_server('127.0.0.1', 0, lambda e, s: [])
        http.app = create(lib, http.server_port)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        ctx = pw.chromium.launch_persistent_context(Path(td)/'profile', headless=True,
            executable_path=os.getenv('TEST_CHROMIUM') or pw.chromium.executable_path,
            args=[f'--load-extension={ext}', f'--disable-extensions-except={ext}'])
        try:
            sw = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            ui = ctx.new_page()
            ui.goto(sw.url.rsplit('/', 1)[0]+'/review.html')
            assert ui.evaluate("""async ([port,key])=>(await chrome.runtime.sendMessage(
                {action:'bridge.pair',port,key,auto:false})).ok""", [http.server_port, lib.pair])
            page = ctx.new_page()
            page.route('**/*', lambda r: r.fulfill(content_type='text/html; charset=utf-8', body=HTML))
            page.goto(URL)
            dispatch = """async ([url,action])=>chrome.tabs.sendMessage(
                (await chrome.tabs.query({url}))[0].id,{action,limit:50})"""
            assert ui.evaluate(dispatch, [URL, 'start'])['ok']
            deadline = time.monotonic()+45
            while (state := ui.evaluate(dispatch, [URL, 'status']))['running']:
                assert time.monotonic() < deadline, state
                time.sleep(.1)
            with ui.expect_download() as dl:
                ui.locator('#export').click()
            with dl.value.path().open(encoding='utf-8-sig', newline='') as f:
                raw = list(csv.DictReader(f))
            bodies = [r['评论正文'] for r in raw]
            print(state['state'], bodies, flush=True)
            assert bodies == ['第一条', '同意', '回复乙', '楼内留言', '第二楼', '延迟加载']
            assert not state.get('completed') and '展开' in state['state']
            for attempt in range(2):
                result = ui.evaluate("async ()=>(await chrome.runtime.sendMessage({action:'bridge.push'})).note")
                assert ('新增 6' if attempt == 0 else '新增 0') in result, result
            run = lib.generate('全部')['id']
            with (lib.folder/'reports'/run/'评论分析.csv').open(encoding='utf-8-sig', newline='') as f:
                analysis = list(csv.DictReader(f))
            for rows in (raw, analysis):
                a, b, c, d, *_ = rows
                assert [r['评论层级'] for r in rows] == ['1','2','3','楼中楼（级数未知）','1','1']
                assert b['父评论标识'] == a['评论标识'] and c['父评论标识'] == b['评论标识']
                assert all(r['所属主评标识'] == a['评论标识'] for r in (b,c,d)) and not d['父评论标识']
            legacy=Library(old)
            assert legacy.rows()[0]['depth']==0
            old_row=dict(url=URL,key='id:100',text='第一条')
            assert legacy.add([{**old_row,'ref':'wb:100','depth':1}])['added']==0
            assert legacy.add([old_row])['added']==0
            record=legacy.rows()[0]
            assert (record['ref'],record['depth'],record['manual'])==('wb:100',1,'正向')
            print('两份 CSV：1 → 2 → 3，另有一条仅知所属主评；重复同步新增 0。')
        finally:
            ctx.close()
            http.shutdown()
            http.server_close()


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent)
