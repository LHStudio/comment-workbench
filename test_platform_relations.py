"""Offline extension regression. Pass a project/extracted release directory to compare versions."""
import csv
import json
import fnmatch
import os
from pathlib import Path
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright


CASES = [
    ('dy', 'https://www.douyin.com/video/1234567890123456789', '<h1>视频</h1>',
     '<div data-e2e="comment-list">', '<article data-e2e="comment-item"', '<article data-e2e="comment-item"',
     '<span data-e2e="comment-content">{}</span>'),
    ('zh', 'https://zhuanlan.zhihu.com/p/123', '<h1>文章</h1>',
     '<div class="Comments-container"><div class="NestComment">', '<article class="NestComment--rootComment"',
     '<article class="NestComment--child"', '<span class="RichText">{}</span>'),
    ('xhs', 'https://www.xiaohongshu.com/explore/0123456789abcdef01234567',
     '<div id="noteContainer"><h1>笔记</h1>', '<div class="comments-container"><div class="parent-comment">',
     '<article class="comment-item"', '<article class="comment-item-sub"', '<span class="content">{}</span>'),
    ('bili', 'https://www.bilibili.com/video/BV1ab411c7de', '<h1 class="video-title">视频</h1>',
     '<div id="comment"><bili-comment-thread-renderer>', '<article class="root-reply-container"',
     '<article class="sub-reply-item"', '<span class="reply-content">{}</span>'),
]


def fixture(case):
    site, _, title, panel, top, child, body = case
    attr = 'data-rpid' if site == 'bili' else 'data-comment-id'
    row = lambda tag, serial, text, extra='': f'{tag} {attr}="{serial}" {extra}>{body.format(text)}'
    html = title + panel + row(top, '100', '主评')
    if site != 'dy':
        html += '</article>'  # siblings inside a semantic thread, not necessarily in chronological order
    html += row(child, '102', '三级', 'data-parent-id="101"') + '</article>'
    html += row(child, '101', '二级', 'data-parent-id="100"') + '</article>'
    html += row(child, '103', '楼内未知') + '</article>'
    if site == 'dy':
        return html + '</article></div>'
    return html + ('</bili-comment-thread-renderer>' if site == 'bili' else '</div>') + '</div>'


def main(root):
    ext = root/'extension'
    failures = []
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td, sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(Path(td)/'profile', headless=True,
            executable_path=os.getenv('TEST_CHROMIUM') or pw.chromium.executable_path)
        fake = """globalThis.data={};chrome.runtime={onMessage:{addListener(f){window.receive=f}},
          sendMessage:async()=>({})};chrome.storage={local:{
          get:async k=>structuredClone(k===null?data:{[k]:data[k]}),
          set:async patch=>Object.assign(data,structuredClone(patch))}}"""
        scripts = json.loads((ext/'manifest.json').read_text(encoding='utf8'))['content_scripts']
        try:
            all_data = {}
            for case in CASES:
                site, url = case[:2]
                tab = ctx.new_page()
                tab.route('**/*', lambda r: r.fulfill(content_type='text/html; charset=utf-8', body=fixture(case)))
                tab.goto(url)
                tab.evaluate(fake)
                for name in next(s['js'] for s in scripts if any(fnmatch.fnmatch(url, p) for p in s['matches'])):
                    tab.add_script_tag(path=ext/name)
                def collect():
                    signal = """action=>new Promise(resolve=>receive({action,limit:4},null,resolve))"""
                    assert tab.evaluate(signal, 'start')['ok']
                    end = time.monotonic()+20
                    while (state := tab.evaluate(signal, 'status'))['running']:
                        assert time.monotonic()<end, state
                        time.sleep(.05)
                    return tab.evaluate("u=>data['video:'+u].comments", url)
                old = collect()
                # Simulate rows from a pre-relations release. Recapture at capacity must enrich, not duplicate.
                tab.evaluate("""async u=>{const k='video:'+u,v=(await chrome.storage.local.get(k))[k];
                  for(const c of v.comments)for(const field of ['ref','depth','parentRef','rootRef','isReply'])delete c[field];
                  v.comments[0].deleted=true;await chrome.storage.local.set({[k]:v})}""", url)
                rows = collect()
                actual = [(r['text'], r.get('depth'), bool(r.get('parentRef')), bool(r.get('rootRef'))) for r in rows]
                print(site, actual, flush=True)
                by = {r['text']: r for r in rows}
                try:
                    assert len(old)==len(rows)==4 and rows[0]['deleted']
                    root_row, direct, nested, loose = [by[s] for s in ('主评','二级','三级','楼内未知')]
                    assert len({r['ref'] for r in rows})==4 and root_row['depth']==1
                    assert (direct['depth'],nested['depth'])==(2,3)
                    assert direct['parentRef']==root_row['ref'] and nested['parentRef']==direct['ref']
                    assert all(c['isReply'] and c['rootRef']==root_row['ref'] for c in [direct,nested,loose])
                    assert not loose.get('depth') and not loose.get('parentRef')
                    assert [r['ref'] for r in rows]==[r['ref'] for r in old]
                except (KeyError, AssertionError):
                    failures.append(site)
                all_data.update(tab.evaluate('data'))
                if site=='dy':
                    for mode, blocked in [(True,False),(False,True),(True,True)]:
                        status = tab.evaluate("""async ([mode,blocked])=>{
                          data={};document.title=blocked?'安全验证':'视频';
                          await new Promise(res=>receive({action:'start',limit:40,readVisibleOnly:mode},null,res));
                          let state;
                          do{await new Promise(res=>setTimeout(res,10));
                             state=await new Promise(res=>receive({action:'status'},null,res));}while(state.running);
                          return [state,Object.values(data)[0].comments.length];
                        }""",[mode,blocked])
                        if status[0].get('completed') or status[1]!=4 or (blocked and '验证' not in status[0]['state']):
                            failures.append(f'dy visible={mode} blocked={blocked}: {status}')
                    duplicate = tab.evaluate("""async ()=>{
                       document.title='视频';data={};
                       const panel=document.querySelector('[data-e2e="comment-list"]');
                       const root=panel.firstElementChild, second=root.cloneNode(true);
                       panel.append(second);second.dataset.commentId='200';
                       for(const el of [root,second]){
                         for(const c of el.querySelectorAll('article:not(:last-child)'))c.remove();
                         el.lastElementChild.removeAttribute('data-comment-id');
                       }
                       await dyCollector.run(10,true);await dyCollector.run(10,true);
                       return Object.values(data)[0].comments.filter(c=>c.isReply).map(c=>[c.ref,c.rootRef]);
                    }""")
                    if len({c[0] for c in duplicate})!=2 or len({c[1] for c in duplicate})!=2:
                        failures.append('same anonymous replies in different threads: '+str(duplicate))
                    delayed = tab.evaluate("""async ()=>{
                        data={};const panel=document.querySelector('[data-e2e="comment-list"]');
                        const root=panel.firstElementChild, child=root.lastElementChild;
                        panel.replaceChildren(child);child.dataset.commentId='101';child.dataset.parentId='100';
                        await dyCollector.run(10,true);panel.replaceChildren(root);
                        await dyCollector.run(10,true);
                        return Object.values(data)[0].comments.find(c=>c.key==='id:101').depth;
                    }""")
                    if delayed!=2:failures.append('parent on later page: '+str(delayed))
                tab.close()
            assert not failures, 'missing relations: '+', '.join(failures)
            ui = ctx.new_page()
            ui.add_init_script(fake)
            ui.goto((ext/'review.html').as_uri())
            ui.evaluate('records=>Object.assign(data,records)', all_data)
            ui.evaluate('load()')
            with ui.expect_download() as dl:
                ui.locator('#export').click()
            with dl.value.path().open(encoding='utf-8-sig', newline='') as f:
                exported = list(csv.DictReader(f))
            assert len(exported)==12
            for _, url, *_ in CASES:
                reply = next(r for r in exported if url in r.values() and r['评论正文']=='楼内未知')
                assert reply['评论层级']=='楼中楼（级数未知）' and reply['所属主评标识'] and not reply['父评论标识']
            print('4 platforms: 1/2/3 + root-only; stable recapture at cap; deleted flags and CSV verified.')
        finally:
            ctx.close()


if __name__=='__main__':
    main(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent)
