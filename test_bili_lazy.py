"""A delayed, rendered Bilibili panel exposes one preview above a login mask."""
import os
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright


def main(root):
    with sync_playwright() as p:
        ctx=p.chromium.launch(executable_path=os.getenv('TEST_CHROMIUM') or p.chromium.executable_path)
        try:
            tab=ctx.new_page()
            tab.route('**/*',lambda r:r.fulfill(content_type='text/html; charset=utf-8',body='''
             <h1 class="video-title">视频</h1><div style="height:890px"></div><div id="commentapp" style="height:350px"></div>
             <script>let box=document.querySelector('#commentapp');
             document.addEventListener('scroll',()=>{const panel=document.createElement('bili-comments');box.append(panel);
               const dom=panel.attachShadow({mode:'open'});dom.innerHTML='<bili-comments-spinner>加载中</bili-comments-spinner>';
               setTimeout(()=>{dom.innerHTML=`<style>:host,.root-reply-container,.reply-content{display:block}
                 #block{position:relative}#limit-mask{position:absolute;inset:0;background:white}</style>
                 <div class="root-reply-container"><span class="reply-content">公开预览</span></div>
                 <div id="block"><div class="root-reply-container"><span class="reply-content">被遮住</span></div>
                 <div id="limit-mask"><span id="limit-mask-tip">登录后查看 106 条评论</span></div></div>`},7100);
              },{once:true})</script>'''))
            tab.goto('https://www.bilibili.com/video/BV1AA411c7c1/')
            tab.evaluate("""()=>{window.records={};chrome.runtime={onMessage:{addListener(){}},sendMessage:async()=>{}};
             chrome.storage={local:{get:async k=>({[k]:records[k]}),set:async o=>Object.assign(records,o)}}}""")
            for js in ('sites.js','post-comments.js','bilibili.js','content.js'):
                tab.add_script_tag(path=root/'extension'/js)
            data=tab.evaluate("async()=>{await dyCollector.run(10);return Object.values(records)[0]}")
            print(data['state'],[r['text'] for r in data['comments']],flush=True)
            assert [r['text'] for r in data['comments']]==['公开预览'] and '登录' in data['state']
        finally:
            ctx.close()


if __name__=='__main__':
    main(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent)
