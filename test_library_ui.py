"""Offline MV3 sample list and popup interactions; optional screenshot directory."""
import csv
import os
from pathlib import Path
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright


SITES = [
    ('douyin', '抖音', 'https://www.douyin.com/', 'video/1234567890123456789', '视频里的健康问答'),
    ('zhihu', '知乎', 'https://www.zhihu.com/', 'question/12/answer/34', '如何理解报告中的指标？'),
    ('xhs', '小红书', 'https://www.xiaohongshu.com/', 'explore/0123456789abcdef01234567', '记录一次使用体验'),
    ('weibo', '微博', 'https://weibo.com/', '1234567890/AbcDef123', '关于检索结果的讨论'),
    ('bili', '哔哩哔哩', 'https://www.bilibili.com/', 'video/BV1ab411c7de', '从问题到回答：实际操作记录'),
]


def main(ext, evidence=None):
    def snapshot(page, name):
        if evidence:
            evidence.mkdir(parents=True, exist_ok=True)
            page.mouse.move(0,0)
            page.screenshot(path=evidence/name,animations='disabled')

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp, sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(tmp, headless=True,
            executable_path=os.getenv('TEST_CHROMIUM') or pw.chromium.executable_path,
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}', '--disable-background-networking'])
        try:
            worker = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            origin = worker.url.rsplit('/',1)[0]
            ctx.route('https://**/*', lambda r: r.fulfill(content_type='text/html; charset=utf-8', body='<h1>离线作品</h1>'))
            issues = []
            def watch(page):
                page.on('pageerror',lambda e:issues.append(str(e)))
                page.on('console',lambda m:issues.append(m.text) if m.type in ['warning','error'] else None)
            ui = ctx.new_page()
            watch(ui)
            ui.set_viewport_size({'width':1280,'height':840})
            ui.goto(origin+'/review.html')
            expect(ui).to_have_title('样本整理 · 评论工作台')
            assert ui.locator('body').evaluate("e=>getComputedStyle(e).fontSize==='16px'")
            def view(key,title):
                expect(ui.locator('[data-page]:visible')).to_have_count(1)
                expect(ui.locator('[data-page]:visible')).to_have_attribute('data-page',key)
                expect(ui.get_by_role('heading',level=1)).to_have_text(title)
                expect(ui.get_by_role('navigation').locator('[aria-current=page]')).to_have_text(title)
                expect(ui).to_have_title(title+' · 评论工作台')
            view('samples','样本整理')
            ui.evaluate('window.navigationWitness={node:document.getElementById("topicPanel")}')
            ui.get_by_role('link',name='主题采集',exact=True).click()
            view('topic','主题采集')
            expect(ui).to_have_url(origin+'/review.html?view=topic')
            ui.locator('#topicTerm').fill('样本关键词')
            ui.get_by_role('link',name='工具',exact=True).click()
            view('tools','工具')
            expect(ui).to_have_url(origin+'/review.html?view=tools')
            expect(ui.locator('#batch,script[src="batch.js"]')).to_have_count(0)
            ui.go_back()
            view('topic','主题采集')
            expect(ui.locator('#topicTerm')).to_have_value('样本关键词')
            assert ui.evaluate('window.navigationWitness?.node===document.getElementById("topicPanel")')
            snapshot(ui,'topic-desktop.png')
            ui.set_viewport_size({'width':390,'height':844})
            snapshot(ui,'topic-390.png')
            assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth')
            ui.go_forward()
            view('tools','工具')
            ui.set_viewport_size({'width':1280,'height':840})
            ui.get_by_text('连接分析工作台',exact=True).click()
            snapshot(ui,'tools-desktop.png')
            ui.emulate_media(reduced_motion='reduce')
            assert ui.locator('[data-page]:visible').evaluate("e=>getComputedStyle(e).animationName==='none'")
            for hash_name, expected, name in [('topicPanel','topic','主题采集'),('tools','tools','工具'),('samples','samples','样本整理')]:
                ui.goto(origin+'/review.html#'+hash_name)
                view(expected,name)
                expect(ui).to_have_url(origin+'/review.html'+('' if expected=='samples' else '?view='+expected))
            data = {}
            for i, (_,_,home,path,title) in enumerate(SITES):
                url=home+path
                data['video:'+url]={'url':url,'title':title,'group':'general' if i in [0,1] else 'other',
                    'updated':f'2026-11-19T10:2{9-i}:00+08:00','comments':[
                        {'key':'a','nickname':'读者甲','text':'理解指标还需要背景信息' if i==1 else '讨论样本','depth':1},
                        {'key':'b','nickname':'读者乙','text':'第二条样本'}]}
            ui.evaluate('d=>chrome.storage.local.set(d)',data)
            cards = ui.locator('.workCard')
            expect(cards).to_have_count(5)
            for _,label,home,path,title in SITES:
                card=cards.filter(has_text=title)
                expect(card.locator('.sourceBadge')).to_have_text(label)
                assert card.locator('details').evaluate('e=>!e.open')
                anchor=card.get_by_role('link',name='原文')
                expect(anchor).to_have_attribute('href',home+path)
                with ctx.expect_page() as opened:anchor.click()
                opened.value.wait_for_url(home+path)
                opened.value.close()
                assert card.locator('details').evaluate('e=>!e.open')
            expect(ui.locator('#stats')).to_contain_text('10条保留评论')
            assert ui.evaluate('[...document.querySelectorAll(".sourceBadge img")].every(i=>i.complete&&i.naturalWidth>0)')
            snapshot(ui,'review-desktop.png')
            ui.set_viewport_size({'width':390,'height':844})
            snapshot(ui,'review-390.png')
            for width in [320,390,700,768,1280]:
                ui.set_viewport_size({'width':width,'height':844})
                assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
                assert cards.first.locator('.workActions').evaluate("""e=>{const r=e.getBoundingClientRect();
                    const title=e.parentNode.querySelector('.workHeadline').getBoundingClientRect();
                    const meta=e.parentNode.querySelector('.workMeta').getBoundingClientRect();
                    return [title,meta].every(t=>r.left>=t.right||r.top>=t.bottom||r.bottom<=t.top)}"""),width
            ui.locator('#platformFilter').select_option('zhihu')
            ui.locator('#typeFilter').select_option('general')
            ui.locator('#search').fill('背景信息')
            expect(cards).to_have_count(1)
            expect(cards.locator('li')).to_have_count(1)
            with ui.expect_download() as dl:ui.locator('#export').click()
            with dl.value.path().open(encoding='utf-8-sig',newline='') as f:
                assert len(list(csv.DictReader(f)))==10   # export scope stays independent of filters
            ui.locator('#typeFilter').select_option('other')
            expect(ui.get_by_text('没有符合条件的作品')).to_be_visible()
            ui.locator('#resetFilters').click()
            expect(cards).to_have_count(5)
            ui.evaluate("""()=>chrome.storage.local.set({'video:legacy':{url:'javascript:alert(1)',
                    title:'旧版未知来源',comments:[]}})""")
            ui.locator('#refresh').click()
            ui.locator('#platformFilter').select_option('unknown')
            expect(cards).to_have_count(1)
            assert not cards.locator('a').count()
            popup=ctx.new_page()
            watch(popup)
            popup.set_viewport_size({'width':480,'height':540})
            popup.goto(origin+'/popup.html')
            expect(popup).to_have_title('当前作品采集')
            assert popup.locator('button#start').evaluate("e=>getComputedStyle(e).fontSize==='16px'")
            expect(popup.locator('#version')).to_have_text('v'+popup.evaluate('chrome.runtime.getManifest().version'))
            links=popup.locator('#platformLinks a')
            expect(links).to_have_count(5)
            for _,label,home,_,_ in SITES:
                anchor=links.filter(has_text=label)
                expect(anchor).to_have_attribute('href',home)
                with ctx.expect_page() as platform:anchor.click()
                platform.value.wait_for_url(home)
                platform.value.close()
            assert popup.evaluate('[...document.querySelectorAll("#platformLinks img")].every(i=>i.complete&&i.naturalWidth>0)')
            assert popup.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert popup.locator('body').bounding_box()['width']==480
            snapshot(popup,'popup.png')
            for width in [320,390]:
                popup.set_viewport_size({'width':width,'height':600})
                assert popup.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            snapshot(popup,'popup-390.png')
            with ctx.expect_page() as topic:popup.locator('#openTopic').click()
            topic.value.wait_for_url(origin+'/review.html?view=topic')
            expect(topic.value.locator('#topicTerm')).to_be_visible()
            assert not issues,issues
            print('PASS: 5 folded source badges + original links; platform/type/keyword filters; reset; CSV all 10 rows; unknown URL not linked.')
            print('PASS: manifest version, 5 homepage links + local icons, topic entry; widths 320/390/700/768/1280; no page errors, warnings or overflow.')
            print('PASS: independent views, legacy hashes, canonical URLs, back/forward preserve the document and topic form; reduced motion; 16px body and actions; popup width 480.')
        finally:
            ctx.close()


if __name__=='__main__':
    main(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent/'extension',
         Path(sys.argv[2]).resolve() if len(sys.argv)>2 else None)
