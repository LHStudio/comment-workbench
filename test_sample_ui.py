"""Check an unpacked extension with synthetic comments and temporary storage."""
import os
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def main(ext):
    url = 'https://zhuanlan.zhihu.com/p/123'
    key = 'video:' + url
    body = '<h1>测试作品</h1><section class="Comments-container">' + ''.join(
        f'<div data-comment-id="{i}"><span class="RichText">评论{i}</span></div>' for i in range(19)
    ) + '</section>'
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp, sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(tmp, headless=True,
            executable_path=os.environ.get('TEST_CHROMIUM') or pw.chromium.executable_path,
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}', '--disable-background-networking'])
        try:
            worker = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            origin = worker.url.rsplit('/', 1)[0]
            target = ctx.new_page()
            target.route('**/*', lambda r: r.fulfill(content_type='text/html; charset=utf-8', body=body))
            target.goto(url)
            ui = ctx.new_page()
            ui.goto(origin+'/review.html')
            def signal(action):
                return ui.evaluate("""async ([url,action])=>{const [t]=await chrome.tabs.query({url});
                    return chrome.tabs.sendMessage(t.id,{action,limit:50})}""", [url,action])
            assert signal('start')['ok']
            deadline = time.monotonic()+20
            while (state:=signal('status'))['running']:
                assert time.monotonic()<deadline
                time.sleep(.1)
            assert state['count']==19
            ui.evaluate("async k=>chrome.storage.local.set({['review:'+JSON.stringify([k])]:{group:'general'}})",key)
            ui.reload()
            card = ui.locator('#list article')
            expect(card).to_have_count(1)
            remove = card.get_by_role('button', name='删除此作品', exact=True)
            collapsed = not card.locator('details').evaluate('d=>d.open')
            visible = remove.is_visible()
            ui.locator('#manage').click()
            rows = ui.locator('#types .typeRow')
            editable = rows.locator('input').count()
            print(f"{state['state']}; 保存={state['count']}; 可编辑默认类型={editable}; 折叠可删除={collapsed and visible}", flush=True)
            assert state['state']=='采集完成，已保存 19 条可读评论' and editable==4 and collapsed and visible
            expect(rows.first).to_contain_text('未设置')
            assert rows.first.locator('input,button').count()==0
            row = rows.nth(1)
            row.locator('input').fill('自选主题')
            row.get_by_text('保存',exact=True).click()
            ui.reload()
            card.locator('summary').click()
            expect(card.locator('select option:checked')).to_have_text('自选主题')
            ui.locator('#manage').click()
            ui.once('dialog', lambda d:d.accept())
            rows.nth(1).get_by_text('删除',exact=True).click()
            expect(rows).to_have_count(4)
            ui.reload()
            card.locator('summary').click()
            expect(card.locator('select')).to_have_value('unknown')
            expect(card.locator('li')).to_have_count(19)
            card.locator('summary').click()
            ui.set_viewport_size({'width':390,'height':844})
            assert remove.bounding_box()['x'] > card.locator('summary').bounding_box()['x']
            ui.once('dialog', lambda d:d.dismiss())
            remove.click()
            assert not card.locator('details').evaluate('d=>d.open')
            ui.once('dialog', lambda d:d.accept())
            remove.click()
            expect(card).to_have_count(0)
        finally:
            ctx.close()


if __name__=='__main__':
    main(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent/'extension')
