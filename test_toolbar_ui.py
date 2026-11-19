"""Exercise the actual Chromium toolbar popup and the workspace in a disposable profile."""
import json
import os
from pathlib import Path
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright


def check(ext):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp, sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(tmp, headless=False,
            executable_path=os.getenv('TEST_CHROMIUM') or pw.chromium.executable_path,
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}',
                  '--disable-background-networking', '--window-size=1200,900'])
        try:
            worker = (ctx.service_workers or [ctx.wait_for_event('serviceworker')])[0]
            ui = ctx.pages[0]
            ui.goto(worker.url.rsplit('/', 1)[0] + '/review.html')
            ui.bring_to_front()
            ui.evaluate('chrome.action.openPopup()')
            get_popup = "chrome.extension.getViews({type:'popup'})[0]"
            ui.wait_for_function(f"{get_popup}?.document.readyState==='complete'")
            # Wait for Chrome's native widget to settle after document layout.
            ui.wait_for_function(f"{get_popup}?.innerWidth > 30")
            size = ui.evaluate(f"({get_popup}).innerWidth")
            ui.evaluate(f"{get_popup}.close()")
            tools = ui.get_by_role('link', name='工具', exact=True)
            tools.click()
            manifest = ui.evaluate('chrome.runtime.getManifest()')
            observed = dict(width=size, version=manifest['version'],
                clearAfterRefresh=bool(ui.locator('#samples #refresh + #clear').count()),
                clearInTools=bool(ui.locator('#tools #clear').count()),
                formVisible=ui.locator('#pairKey').is_visible(),
                tabs=ui.locator('nav a').all_text_contents(),
                icons=sorted((manifest['action'].get('default_icon') or {}).keys()))
            print(json.dumps(observed, ensure_ascii=False), flush=True)
            assert (size, observed['clearAfterRefresh'], observed['clearInTools'],
                    observed['formVisible']) == (680, True, False, True)
            assert observed['tabs'] == ['样本整理', '主题采集', '工具', '版权页']
            assert set(observed['icons']) == {'16', '32', '48', '128'}
            assert manifest['icons'] == manifest['action']['default_icon']
            assert ui.evaluate("""async icons=>(await Promise.all(Object.entries(icons).map(async ([n,path])=>{
                const i=new Image();i.src=chrome.runtime.getURL(path);await i.decode();
                return i.naturalWidth===+n && i.naturalHeight===+n}))).every(Boolean)""", manifest['icons'])
            ui.get_by_role('link', name='版权页').click()
            expect(ui.get_by_text('Design by LHStudio', exact=True)).to_be_visible()
            expect(ui.get_by_text('v'+manifest['version'], exact=True)).to_be_visible()
            repo = 'https://github.com/LHStudio/comment-workbench'
            link = ui.get_by_role('link', name='LHStudio/comment-workbench')
            expect(link).to_have_attribute('href', repo)
            ctx.route(repo, lambda r: r.fulfill(body='project'))
            with ctx.expect_page() as opened:
                link.click()
            opened.value.wait_for_url(repo)
            opened.value.close()
            ui.get_by_role('link', name='样本整理').click()
            ui.evaluate("""()=>chrome.storage.local.set({'video:test':{title:'临时样本',comments:[]},
                'review:test':'discard',captureLimit:75,videoTypes:[['unknown','未设置']]})""")
            expect(ui.locator('.workCard')).to_have_count(1)
            ui.once('dialog', lambda dialog: dialog.dismiss())
            ui.locator('#clear').click()
            expect(ui.locator('.workCard')).to_have_count(1)
            ui.once('dialog', lambda dialog: dialog.accept())
            ui.locator('#clear').click()
            expect(ui.locator('.workCard')).to_have_count(0)
            data = ui.evaluate('chrome.storage.local.get(null)')
            assert not {'video:test','review:test'}.intersection(data)
            assert data['captureLimit']==75 and data['videoTypes']==[['unknown','未设置']]
            print('PASS: native action popup; icon sizes; credits and repo navigation; cancel/confirm clear.')
        finally:
            ctx.close()


if __name__ == '__main__':
    check(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent/'extension')
