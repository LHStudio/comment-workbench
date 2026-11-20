"""Offline MV3 integration: synthetic search cards, collector pages and access gates."""
import os
import ssl
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright


EXT = Path(__file__).resolve().parent / 'extension'
IDS = ['BV1AA411c7c1', 'BV1AA411c7c2', 'BV1AA411c7c3']
KEY = 'topicQueueV1'
NOTE = 'abcdef0123456789abcdef01'

@contextmanager
def offline_https(temp, render):
    # Extension-created tabs can navigate before Playwright attaches a route.
    # Route DNS at browser startup; all other names resolve to NOTFOUND.
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    now = datetime.now(timezone.utc)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'offline-fixture')])
    crt = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
           .public_key(key.public_key()).serial_number(x509.random_serial_number())
           .not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(hours=1))
           .sign(key, hashes.SHA256()))
    certfile, keyfile = Path(temp) / 'fixture.pem', Path(temp) / 'fixture.key'
    certfile.write_bytes(crt.public_bytes(serialization.Encoding.PEM))
    keyfile.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()))

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = render(self.headers['Host'].split(':')[0], self.path.split('?')[0]).encode()
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.send_header('Content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile, keyfile)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_port
        rules=', '.join(f'MAP {h} 127.0.0.1:{port}' for h in ('*.bilibili.com','*.xiaohongshu.com','www.zhihu.com'))
        yield [f'--host-resolver-rules={rules}, MAP * ~NOTFOUND',
               '--no-proxy-server', '--disable-quic', '--ignore-certificate-errors']
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def main():
    for name in ['topic.js', 'discovery.js']:
        assert (EXT / name).is_file(), f'missing implementation: {name}'
    with sync_playwright() as pw, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        executable = os.getenv('TEST_CHROMIUM') or pw.chromium.executable_path
        if not Path(executable).is_file():
            cache = Path(os.environ.get('LOCALAPPDATA', '.')) / 'ms-playwright'
            executable = str(next(cache.glob('chromium-*/chrome-win*/chrome.exe')))
        mode = {'blocked': True, 'gate_search': False, 'xhs':'ready', 'deleted':False}
        visits = []

        def serve(host, path):
            visits.append((host, path))
            if host=='www.zhihu.com' and path=='/question/42':
                body='<h1>例题</h1>'+''.join(f'<section class="AnswerItem" data-answer-id="{i}">回答{i}</section>' for i in [701,702])
            elif host=='www.zhihu.com' and path.startswith('/question/42/answer/'):
                i=path.split('/')[-1]
                body=f'''<h1>例题</h1><section class="AnswerItem" data-answer-id="{i}"><div class="AuthorInfo-name">作者{i}</div>
                  <div class="RichContent-inner">回答正文{i}</div><button onclick="setTimeout(()=>document.querySelector('.Comments-container').hidden=false,1800)">1 条评论</button>
                  <div hidden class="Comments-container"><div data-comment-id="1"><span class="RichText">评论{i}</span></div></div></section>'''
            elif host == 'search.bilibili.com':
                body = ''.join(f'<div class="bili-video-card"><a href="https://www.bilibili.com/video/{i}/?from=test"><h3>测试 {i}</h3></a></div>' for i in [IDS[0], *IDS])
                body += """<script>const u=new URL(location.href);u.searchParams.set('from','fixture');history.replaceState({},'',u);</script>"""
                body += '<aside><a href="https://www.bilibili.com/video/BV1AA411c7c4/">推荐（不入队）</a></aside>'
                if mode['gate_search']:
                    body += '<div role="dialog">请先登录后查看搜索结果</div>'
            elif host == 'www.xiaohongshu.com' and path == '/search_result':
                body = f'<section class="note-item"><a class="cover" href="/search_result/{NOTE}?xsec_source=synthetic">封面</a><span class="title">合成笔记</span></section>'
                if mode['xhs']=='gate':
                    body += '<div role="dialog">请先登录后查看搜索结果</div>'
                elif mode['xhs']=='empty':
                    body = '<div class="empty">暂无结果</div>'
            elif host == 'www.xiaohongshu.com':
                body = '<div id="noteContainer"><h1>笔记详情标题</h1><div class="comments-container"><div class="comment-item" data-comment-id="1"><span class="content">合成评论</span></div></div></div>'
            elif host == 'www.bilibili.com':
                body = '''<h1 class="video-title">合成标题</h1><div id="comment">
                <div class="root-reply-container" data-id="synthetic"><span class="reply-content">可读的部分</span></div></div>'''
                if mode['blocked'] and IDS[1] in path:
                    body += '<div role="dialog">请完成安全验证</div>'
                if mode['deleted'] and IDS[0] in path:
                    body = '<div role="alert">作品已删除</div>'
            else:
                body = '<title>已有用户页</title>'
            return body

        offline = offline_https(temp, serve)
        args = offline.__enter__()
        ctx = pw.chromium.launch_persistent_context(temp, headless=True, executable_path=executable,
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--disable-background-networking', *args])
        try:
            worker = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            home = worker.url.rsplit('/', 1)[0] + '/review.html?view=topic'
            original = ctx.new_page()
            original.goto('https://www.bilibili.com/')
            first = ctx.new_page()
            first.goto(home)
            second = ctx.new_page()
            second.goto(home)
            for page in (first, second):
                page.on('dialog', lambda dlg: dlg.accept())
                page.locator('#topicTerm').wait_for()
            state = lambda page: page.evaluate('async k=>(await chrome.storage.local.get(k))[k]', KEY)
            second.evaluate("""()=>{window.foregroundTasks=[];chrome.tabs.onCreated.addListener(t=>{
                if(t.id)window.foregroundTasks.push({active:t.active,url:t.pendingUrl||t.url})})}""")

            def wait(page, predicate):
                deadline = time.monotonic() + 35
                while not page.evaluate(f"async k=>{{const q=(await chrome.storage.local.get(k))[k];return q&&({predicate})}}", KEY):
                    if time.monotonic() >= deadline:
                        raise AssertionError((predicate, state(page), page.locator('#topicNotice').inner_text(), visits))
                    page.wait_for_timeout(120)

            def start(term, platforms=('xhs','bili'), works=3):
                first.locator('#topicTerm').fill(term)
                for box in first.locator('#topicPanel input[name="topicPlatform"]').all():
                    box.set_checked(box.input_value() in platforms)
                first.locator('#topicWorks').fill(str(works))
                first.locator('#topicComments').fill('1')
                first.locator('#topicStart').click()

            assert first.locator('#topicMode').count()==0, 'obsolete mode control'
            start('逐平台')
            wait(first, "q.term==='逐平台'&&q.phase==='verifying'")
            challenge=next(p for p in ctx.pages if IDS[1] in p.url)
            assert challenge.locator('cwb-page-notice').get_attribute('aria-label').startswith('请在本页')
            first.locator('#topicPause').click()
            wait(first,"q.phase==='paused'")
            q=state(first)
            assert visits.index(('www.xiaohongshu.com',f'/search_result/{NOTE}'))<visits.index(('search.bilibili.com','/all')),visits
            assert [i['state'] for i in q['items']]==['done','done','partial','pending'],q
            assert q['items'][2]['count']==0 and not challenge.is_closed()
            url=f'https://www.xiaohongshu.com/explore/{NOTE}'
            assert first.evaluate("async u=>(await chrome.storage.local.get('video:'+u))['video:'+u].title",url)=='笔记详情标题'
            assert first.evaluate("async()=>!JSON.stringify(await chrome.storage.local.get(null)).includes('xsec_source')")
            created=second.evaluate('window.foregroundTasks')
            assert len(created)>=5 and all(t['active'] for t in created),created
            before=list(visits)
            first.reload()
            first.wait_for_timeout(500)
            assert before==visits
            mode['blocked'] = False
            challenge.locator('[role="dialog"]').evaluate('e=>e.remove()')
            first.locator('#topicNext').click()
            wait(first, "q.phase==='done'")
            assert visits[len(before):].count(('www.xiaohongshu.com',f'/search_result/{NOTE}'))==0
            print('platform order, work verification prompt, pause and resume on retained tab')

            mode['deleted']=True
            start('单篇不可读',['bili'],2)
            wait(first,"q.term==='单篇不可读'&&q.phase==='attention'")
            assert [i['state'] for i in state(first)['items']]==['partial','done'],state(first)
            before=len(visits)
            mode['deleted']=False
            first.locator('#topicNext').click()
            wait(first,"q.phase==='done'")
            assert sum(IDS[0] in p for _,p in visits[before:])==1 and not any(IDS[1] in p for _,p in visits[before:])
            print('unavailable first work did not block second; retry opened only first work')

            for condition in ['gate','empty']:
                mode['xhs']=condition
                start('跨站'+condition,works=1)
                wait(first,f"q.term==='跨站{condition}'&&q.phase==='attention'")
                q=state(first)
                assert q['searches'][0]['note'] and q['items'][-1]['platform']=='bili' and q['items'][-1]['state']=='done',q
            mode['xhs']='ready'
            print('login wall and explicit empty page did not block second platform')

            start('主动暂停',works=4)
            wait(first,"q.term==='主动暂停'&&q.phase==='searching'")
            first.locator('#topicPause').click()
            wait(first,"q.phase==='paused'")
            frozen=len(visits)
            first.wait_for_timeout(800)
            assert len(visits)==frozen
            first.locator('#topicNext').click()
            wait(second,"q.phase==='done'")
            assert original.url == 'https://www.bilibili.com/'
            print('user pause stopped work and explicit resume completed it')

            first.evaluate("""()=>{navigator.locks.request('comment-topic-run',async()=>{window.locked=true;await new Promise(r=>window.release=r)})}""")
            first.wait_for_function('window.locked')
            second.locator('#topicTerm').fill('不应启动')
            second.locator('#topicStart').click()
            second.wait_for_function("document.querySelector('#topicNotice').textContent.includes('另一个')")
            assert state(second)['term'] == '主动暂停'
            first.evaluate('window.release()')
            print('mutual exclusion: other organizer did not replace queue')

            first.evaluate("""async k=>{const q=(await chrome.storage.local.get(k))[k];q.phase='confirm';
               q.mode='manual';q.searches.forEach(s=>{s.state='done';delete s.scan});q.items[0].state='pending';
               await chrome.storage.local.set({[k]:q})}""",KEY)
            first.reload()
            first.locator('#topicNext').click()
            wait(first,"q.phase==='done'")
            assert len(state(first)['items'])==4
            print('legacy manual queue resumed in place, preserving samples')
            first.evaluate("""()=>{const orig=chrome.tabs.sendMessage.bind(chrome.tabs);
              window.disconnects=1;window.discoveryCalls=0;chrome.tabs.sendMessage=(id,m,...args)=>{
                if(m.action==='topic.discover'){window.discoveryCalls++;if(window.disconnects-->0)
                  return Promise.reject(Error('Could not establish connection. Receiving end does not exist.'));}
                return orig(id,m,...args)}}""")
            start('搜索导航断开重连',['bili'],1)
            wait(first,"q.term==='搜索导航断开重连'&&['done','attention'].includes(q.phase)")
            assert state(first)['phase']=='done' and first.evaluate('window.discoveryCalls')==2,state(first)
            first.evaluate('window.disconnects=3;window.discoveryCalls=0')
            start('搜索重连仍失败',['bili'],1)
            wait(first,"q.term==='搜索重连仍失败'&&['done','attention'].includes(q.phase)")
            assert first.evaluate('window.discoveryCalls')==2 and '无法连接' in state(first)['searches'][0]['note'],state(first)
            print('transient content receiver reconnected once; lasting disconnect displayed Chinese reason')
            base='https://www.zhihu.com/question/42'
            start(base,['zhihu'],2)
            wait(first,"q.term.endsWith('/42')&&q.page?.url.endsWith('/answer/701')")
            assert first.locator('#topicPercent').inner_text()=='33%'
            assert first.locator('#topicAddress').inner_text()==base+'/answer/701'
            assert first.locator('#topicItems [aria-current=step]').count()==1
            assert first.locator('#topicNow').evaluate("e=>getComputedStyle(e,'::before').animationName")=='collecting'
            first.locator('#topicLocate').click()
            assert first.evaluate("async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0].url").endswith('/701')
            wait(first,"q.phase==='done'")
            assert first.locator('#topicPercent').inner_text()=='100%'
            for i in ('701','702'):
                rec=first.evaluate("async k=>(await chrome.storage.local.get(k))[k]",'video:'+base+'/answer/'+i)
                assert rec['answer']==dict(questionId='42',answerId=i,text='回答正文'+i,author='作者'+i),rec
                assert [c['text'] for c in rec['comments']]==['评论'+i]
            first.goto(home.replace('view=topic','view=samples'))
            with first.expect_download() as download:first.locator('#export').click()
            import csv
            with open(download.value.path(),encoding='utf-8-sig',newline='') as f:
                rows={r['知乎回答ID']:r for r in csv.DictReader(f) if r['知乎问题ID']=='42'}
            assert all(rows[i]['评论正文']=='评论'+i and rows[i]['回答正文']=='回答正文'+i for i in ('701','702'))
            print('question 42: two answer bodies, scoped comments and CSV; 33% active page, focus, 100% complete')
        finally:
            ctx.close()
            offline.__exit__(None, None, None)


if __name__ == '__main__':
    main()
