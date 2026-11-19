"""Test rendered search cards via actual MV3 messaging, without visiting a live site."""
from pathlib import Path
import os
import tempfile

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


def main():
    ext = Path(__file__).resolve().parent/'extension'
    term = '骑行 & AI'
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp, sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(temp, headless=True,
            executable_path=os.environ.get('TEST_CHROMIUM') or pw.chromium.executable_path,
            args=[f'--load-extension={ext}',f'--disable-extensions-except={ext}','--disable-background-networking'])
        try:
            sw = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            for platform, expected, card in CASES:
                url = sw.evaluate('([id,q])=>Sites.search(id,q)',[platform,term])
                page = ctx.new_page()
                benign = '<aside><a href="https://www.zhihu.com/question/98/answer/765">无关链接</a></aside>'
                page.route('**/*',lambda r:r.fulfill(content_type='text/html; charset=utf-8',body=benign + card*2))
                page.goto(url)
                message = {'action':'topic.discover','platform':platform,'term':term,'limit':5}
                def discover():
                    return sw.evaluate('''async ([url,m])=>{
                        const t=(await chrome.tabs.query({})).find(t=>t.url===url);
                        return chrome.tabs.sendMessage(t.id,m);
                    }''',[url,message])
                result = discover()
                assert result['ok'] and not result.get('gate') and [r['url'] for r in result['rows']] == [expected], (platform,result)
                if platform=='xhs':
                    assert 'xsec_token=synthetic' in result['rows'][0]['openUrl']
                page.evaluate("document.title='安全验证'")
                assert discover()['gate'], platform
                message['term']='另一个主题'
                assert not discover()['ok'], platform
                page.close()
                print(platform, '搜索卡去重、验证提示、关键词绑定通过')
        finally:
            ctx.close()


if __name__ == '__main__':
    main()
