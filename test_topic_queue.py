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
        rules=', '.join(f'MAP {h} 127.0.0.1:{port}' for h in ('*.bilibili.com','*.xiaohongshu.com'))
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
        mode = {'blocked': True, 'gate_search': False}
        visits = []

        def serve(host, path):
            visits.append((host, path))
            if host == 'search.bilibili.com':
                body = ''.join(f'<div class="bili-video-card"><a href="https://www.bilibili.com/video/{i}/?from=test"><h3>测试 {i}</h3></a></div>' for i in [IDS[0], *IDS])
                body += """<script>const u=new URL(location.href);u.searchParams.set('from','fixture');history.replaceState({},'',u);</script>"""
                body += '<aside><a href="https://www.bilibili.com/video/BV1AA411c7c4/">推荐（不入队）</a></aside>'
                if mode['gate_search']:
                    body += '<div role="dialog">请先登录后查看搜索结果</div>'
            elif host == 'www.xiaohongshu.com' and path == '/search_result':
                body = f'<section class="note-item"><a class="cover" href="/search_result/{NOTE}?xsec_source=synthetic">封面</a><span class="title">合成笔记</span></section>'
            elif host == 'www.bilibili.com':
                body = '''<h1 class="video-title">合成标题</h1><div id="comment">
                <div class="root-reply-container" data-id="synthetic"><span class="reply-content">可读的部分</span></div></div>'''
                if mode['blocked'] and IDS[1] in path:
                    body += '<div role="dialog">请完成安全验证</div>'
            else:
                body = '<title>已有用户页</title>'
            return body

        offline = offline_https(temp, serve)
        args = offline.__enter__()
        ctx = pw.chromium.launch_persistent_context(temp, headless=True, executable_path=executable,
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--disable-background-networking', *args])
        try:
            worker = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            home = worker.url.rsplit('/', 1)[0] + '/review.html'
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

            def wait(page, predicate):
                deadline = time.monotonic() + 35
                while not page.evaluate(f"async k=>{{const q=(await chrome.storage.local.get(k))[k];return q&&({predicate})}}", KEY):
                    if time.monotonic() >= deadline:
                        raise AssertionError((predicate, state(page), page.locator('#topicNotice').inner_text(), visits))
                    page.wait_for_timeout(120)

            def start(term, mode_name, works=3):
                first.locator('#topicTerm').fill(term)
                for box in first.locator('#topicPanel input[name="topicPlatform"]').all():
                    box.set_checked(box.input_value() == 'bili')
                first.locator('#topicMode').select_option(mode_name)
                first.locator('#topicWorks').fill(str(works))
                first.locator('#topicComments').fill('1')
                first.locator('#topicStart').click()

            start('手动用例', 'manual')
            wait(first, "q.phase==='confirm'")
            assert len(state(first)['items']) == 3
            assert not any('/video/' in p for _, p in visits)
            first.locator('#topicSkip').click()
            wait(first, "q.phase==='confirm'&&q.items[0].state==='skipped'")
            first.locator('#topicNext').click()
            wait(first, "q.phase==='paused'&&q.items[1].count===1")
            assert '验证' in state(first)['reason']
            assert state(first)['items'][1]['state'] != 'done'
            count = sum(IDS[1] in p for _, p in visits)
            first.reload()
            first.wait_for_timeout(500)
            assert sum(IDS[1] in p for _, p in visits) == count
            mode['blocked'] = False
            for p in ctx.pages:
                if IDS[1] in p.url:
                    p.reload()
            first.locator('#topicNext').click()
            wait(first, "q.phase==='confirm'&&q.items[1].state==='done'")
            first.locator('#topicPause').click()
            wait(first, "q.phase==='paused'")
            first.locator('#topicNext').click()
            wait(first, "q.phase==='done'")
            assert original.url == 'https://www.bilibili.com/'
            print('manual: deduplicated, skipped, saved partial, resumed after reload, paused and completed')

            mode['gate_search'] = True
            start('自动用例', 'auto', 2)
            wait(first, "q.term==='自动用例'&&q.phase==='paused'")
            assert len(state(first)['items']) == 2
            mode['gate_search'] = False
            for p in ctx.pages:
                if 'search.bilibili.com' in p.url:
                    p.reload()
            first.locator('#topicNext').click()
            wait(second, "q.phase==='done'")
            assert all(i['state'] == 'done' for i in state(second)['items'])
            assert original.url == 'https://www.bilibili.com/'
            print('automatic: search wall paused, visible candidates preserved, retry completed serial queue')

            first.evaluate("""()=>{navigator.locks.request('comment-topic-run',async()=>{window.locked=true;await new Promise(r=>window.release=r)})}""")
            first.wait_for_function('window.locked')
            second.locator('#topicTerm').fill('不应启动')
            second.locator('#topicStart').click()
            second.wait_for_function("document.querySelector('#topicNotice').textContent.includes('另一个')")
            assert state(second)['term'] == '自动用例'
            first.evaluate('window.release()')
            print('mutual exclusion: other organizer did not replace queue')

            first.locator('#topicTerm').fill('跨平台用例')
            for b in first.locator('#topicPanel input[name=topicPlatform]').all():
                b.set_checked(b.input_value() in ['bili','xhs'])
            first.locator('#topicMode').select_option('manual')
            first.locator('#topicWorks').fill('1')
            first.locator('#topicStart').click()
            wait(first, "q.term==='跨平台用例'&&q.phase==='confirm'")
            q = state(first)
            assert {i['platform'] for i in q['items']} == {'bili','xhs'}
            expected = f'https://www.xiaohongshu.com/explore/{NOTE}'
            assert any(i['url'] == expected for i in q['items'])
            assert first.evaluate("async()=>!JSON.stringify(await chrome.storage.local.get(null)).includes('xsec_source')")
            assert first.evaluate("async url=>(await chrome.storage.session.get('topicNavigationV1')).topicNavigationV1.links[url].endsWith('?xsec_source=synthetic')", expected)
            with ctx.expect_page() as preview:
                first.locator('#topicItems a').filter(has_text='查看作品').first.click()
            preview.value.wait_for_load_state()
            assert preview.value.url.endswith(f'/search_result/{NOTE}?xsec_source=synthetic')
            print('cross-platform search: ignored added tracking parameter; canonical samples, session-only note parameters and independent preview')
        finally:
            ctx.close()
            offline.__exit__(None, None, None)


if __name__ == '__main__':
    main()
