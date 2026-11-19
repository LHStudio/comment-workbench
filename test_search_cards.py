"""Test rendered search cards via actual MV3 messaging, without visiting a live site."""
from pathlib import Path
import os
import sys
import tempfile
from urllib.parse import quote

from playwright.sync_api import sync_playwright


CASES = [
    ('douyin','https://www.douyin.com/video/1234567890123456789',
     '<div id="waterfall_item_1234567890123456789"><span data-e2e="video-desc">骑行记录</span></div>'),
    ('zhihu','https://www.zhihu.com/question/12/answer/34',
     '<div class="SearchResult-Card"><h2><a href="/question/12/answer/34">骑行记录</a></h2></div>'),
    ('xhs','https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa',
     '<section class="note-item"><a class="cover" href="/search_result/aaaaaaaaaaaaaaaaaaaaaaaa?xsec_token=synthetic"></a><b class="title">骑行记录</b></section>'),
    ('weibo','https://weibo.com/12345678/ABCdef123',
     '<div id="pl_feedlist_index"><div class="card-wrap" mid="123"><p node-type="feed_list_content">骑行记录</p><p class="from"><a href="//weibo.com/12345678/ABCdef123">昨天</a></p></div></div>'),
    ('bili','https://www.bilibili.com/video/BV1ab411c7de',
     '<div class="bili-video-card"><a href="//www.bilibili.com/video/BV1ab411c7de"><h3>骑行记录</h3></a></div>'),
]


def main(root):
    ext = root/'extension'
    term = '骑行 & AI'
    errors = []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp, sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(temp, headless=True,
            executable_path=os.environ.get('TEST_CHROMIUM') or pw.chromium.executable_path,
            args=[f'--load-extension={ext}',f'--disable-extensions-except={ext}','--disable-background-networking'])
        try:
            sw = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            for platform, expected, card in CASES:
                url = sw.evaluate('([id,q])=>Sites.search(id,q)',[platform,term])
                page = ctx.new_page()
                alt = {
                    'douyin':expected[:-1]+'0','zhihu':expected[:-1]+'8','xhs':expected[:-1]+'b',
                    'weibo':expected[:-1]+'4','bili':expected[:-1]+'f',
                }[platform]
                decoy = alt[:-1]+'5'
                apart = card.replace(expected.split('/')[-1],decoy.split('/')[-1]).replace('骑行记录','推荐内容')
                shell = f'<aside>{apart}</aside><nav>{apart}</nav><div class="recommend-feed">{apart}</div>'
                html = shell+f'<main>{card*2}<article class="build_8f33"><a href="{alt}">另一条作品</a></article>'
                html += f'<a hidden href="{decoy}">已隐藏</a><div aria-hidden="true"><a href="{decoy}">未展示</a></div></main>'
                html += f'<main><div style="opacity:0"><a href="{decoy}">不可见作品</a></div></main>'
                page.route('**/*',lambda r:r.fulfill(content_type='text/html; charset=utf-8',body=html))
                page.goto(url)
                message = {'action':'topic.discover','platform':platform,'term':term,'limit':5}
                def discover():
                    return sw.evaluate('''async ([url,m])=>{
                        const t=(await chrome.tabs.query({})).find(t=>t.url===url);
                        return chrome.tabs.sendMessage(t.id,m);
                    }''',[page.url,message])
                result = discover()
                rows = result.get('rows',[])
                urls = [r['url'] for r in rows]
                print(platform, 'known=',urls.count(expected),'new-layout=',urls.count(alt),'excluded=',urls.count(decoy),flush=True)
                if not result.get('ok') or result.get('gate') or urls!=[expected,alt]:errors.append((platform,'cards',urls))
                if platform=='xhs' and not any('xsec_token=synthetic' in r.get('openUrl','') for r in rows):errors.append(('xhs','openUrl'))
                path = {'douyin':'/search/'+quote(term),'zhihu':'/search?q='+quote(term),'weibo':'/weibo/'+quote(term),
                        'bili':'/video/?keyword='+quote(term),'xhs':'/search_result/?keyword='+quote(term)}[platform]
                page.evaluate("path=>history.replaceState({},'',path)",path)
                rewritten=discover()
                print('  rewritten=',len(rewritten.get('rows',[])),flush=True)
                if not rewritten.get('ok') or len(rewritten.get('rows',[]))!=2:errors.append((platform,'rewrite'))
                page.evaluate("document.title='安全验证'")
                if not discover().get('gate'):errors.append((platform,'gate'))
                message['term']='另一个主题'
                if discover().get('ok'):errors.append((platform,'wrong query'))
                page.evaluate("()=>history.replaceState({},'','/login')")
                if discover().get('ok'):errors.append((platform,'not search'))
                page.close()
            assert not errors, errors
        finally:
            ctx.close()


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent)
