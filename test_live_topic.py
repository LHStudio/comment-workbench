"""Opt-in public-site smoke test; never uses a personal profile or saves comments."""
import argparse
import json
import os
from pathlib import Path
import tempfile
import time

from playwright.sync_api import sync_playwright


def probe(source, platform, keyword):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory, sync_playwright() as pw:
        ext = source.resolve() / "extension"
        browser = pw.chromium.launch_persistent_context(
            directory, headless=False,
            executable_path=os.getenv("TEST_CHROMIUM") or pw.chromium.executable_path,
            args=[f"--load-extension={ext}", f"--disable-extensions-except={ext}", "--disable-background-networking"])
        try:
            worker = (browser.service_workers or [browser.wait_for_event("serviceworker")])[0]
            page = browser.new_page()
            page.goto(worker.url.rsplit("/", 1)[0] + "/review.html?view=topic")
            page.locator("#topicTerm").fill(keyword)
            for box in page.locator("[name=topicPlatform]").all():
                box.set_checked(box.get_attribute("value") == platform)
            page.locator("#topicWorks").fill("1")
            page.locator("#topicComments").fill("1")
            if page.locator("#topicMode").count():  # Replay the same job on 0.8.0.
                page.locator("#topicMode").select_option("auto")
            page.locator("#topicStart").click()
            started = time.monotonic()
            result = {}
            while time.monotonic() - started < 90:
                page.wait_for_timeout(750)
                result = page.evaluate("""async () => {
                  const data = await chrome.storage.local.get(null), q=data.topicQueueV1;
                  if(!q)return {};
                  const works=Object.entries(data).filter(([k])=>k.startsWith('video:')).map(([,v])=>v);
                  return {phase:q.phase,reason:q.reason,found:q.items.length,
                    statuses:q.searches.map(s=>[s.state,s.reason||s.note||'']),
                    items:q.items.map(i=>[i.state,i.count,i.note]), saved:works.length,
                    titled:works.filter(v=>v.title?.trim()).length,
                    comments:works.reduce((n,v)=>n+(v.comments?.length||0),0)};
                }""")
                if result.get("phase") in {"done", "paused", "attention"}:
                    break
            print(json.dumps({"platform": platform, **result}, ensure_ascii=False), flush=True)
            return bool(result.get("titled") and result.get("comments") and
                        any(row[0] == "done" for row in result.get("items", [])))
        finally:
            browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-live", action="store_true", required=True)
    parser.add_argument("--platform", required=True, choices=["douyin", "bili", "weibo", "zhihu", "xhs"])
    parser.add_argument("--keyword", required=True)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    raise SystemExit(0 if probe(args.source, args.platform, args.keyword) else 1)
