// Standalone extension routing contract; no network or browser profile needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.argv[2] || __dirname);
const directory = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const sites = vm.runInNewContext(fs.readFileSync(path.join(directory, 'sites.js'), 'utf8') + '\nSites', {URL});
const specs = [
  ['douyin','www.douyin.com','https://www.douyin.com/video/1234567890123456'],
  ['zhihu','www.zhihu.com','https://www.zhihu.com/question/123/answer/456'],
  ['xhs','www.xiaohongshu.com','https://www.xiaohongshu.com/explore/abcdef012345abcdef012345'],
  ['weibo','s.weibo.com','https://weibo.com/12345678/ABCdef123'],
  ['bili','search.bilibili.com','https://www.bilibili.com/video/BV1ab411c7de'],
];
console.log('version=%s, platform catalog=%d, search=%s',manifest.version,sites.platforms?.length||0,typeof sites.search);
assert.equal(sites.platforms.length, 5);
const term = '科普 & AI / #1?';
for(const [id,host,sample] of specs){
  const search = new URL(sites.search(id,term));
  assert.equal(search.hostname,host);
  const query=id==='douyin'?decodeURIComponent(search.pathname.slice('/search/'.length)):
    search.searchParams.get(['weibo','zhihu'].includes(id)?'q':'keyword');
  assert.equal(query,term);
  const home=new URL(sites.platform(id).home);
  assert.equal(home.protocol,'https:');
  assert.equal(sites.work(sample+'?from=offline').platform,id);
  assert.equal(sites.work(sample+'?from=offline').url,sample);
  for(const bad of [home.href,search.href,'javascript:alert(1)','https://'+home.host+'.example.org/foo'])assert.equal(sites.work(bad),null);
  const matchesOrigin=pattern=>pattern===`${search.origin}/*`;
  assert.ok(manifest.host_permissions.some(matchesOrigin));
  const scripts=manifest.content_scripts.filter(entry=>entry.matches.some(matchesOrigin)).flatMap(entry=>entry.js);
  assert.ok(scripts.includes('sites.js')&&scripts.includes('discovery.js'));
  assert.ok(fs.existsSync(path.join(directory,'discovery.js')));
}
assert.equal(sites.search('not-allowed',term),null);
assert.equal(sites.search('weibo',' '),null);
console.log('PASS: 5 home/search/detail routes, encoded keywords, canonical URLs and search injection scopes.');
