import argparse
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import webbrowser
import urllib.request
from contextlib import closing
from datetime import datetime
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory
from werkzeug.serving import make_server
from engine import LABELS, attitude, model_group, report

ROOT=Path(__file__).resolve().parent
WORK_URL=re.compile(r'https://(?:www\.douyin\.com/video/[0-9]{15,22}|zhuanlan\.zhihu\.com/p/[0-9]+|www\.zhihu\.com/question/[0-9]+/answer/[0-9]+|www\.xiaohongshu\.com/explore/[0-9a-f]{24})')

class Library:
    def __init__(self,folder):
        self.folder=Path(folder)
        self.folder.mkdir(parents=True,exist_ok=True)
        self.path=self.folder/'analysis.sqlite'
        with closing(self.connect()) as c,c:
            c.execute('''create table if not exists comments (rid integer primary key, url text not null,
              key text not null,title text not null,nick text not null,body text not null,stamp text not null,
              hint text not null default '',manual text not null default '',unique(url,key))''')
            c.execute('create table if not exists meta(k text primary key,v text)')
            c.execute("insert or ignore into meta values('pair',?)",(secrets.token_urlsafe(18),))
            self.pair=c.execute("select v from meta where k='pair'").fetchone()[0]
        self.lock=threading.Lock()
    def connect(self):
        c=sqlite3.connect(self.path,timeout=20);c.row_factory=sqlite3.Row
        return c
    def add(self,rows):
        if not isinstance(rows,list) or len(rows)>5000:raise ValueError('每批最多 5000 条')
        values=[]
        for row in rows:
            if not isinstance(row,dict):raise ValueError('无效评论')
            def field(k,n):
                v=row.get(k,'')
                if not isinstance(v,str) or len(v)>n:raise ValueError('字段无效：'+k)
                return v.strip()
            url,key,body=field('url',240),field('key',30000),field('text',15000)
            if not WORK_URL.fullmatch(url) or not key or not body:raise ValueError('缺少作品链接、评论标识或正文')
            if key.startswith('id:'):key=key[3:]
            elif key.startswith('row:'):key=key[4:]
            if not key:raise ValueError('无效评论标识')
            values.append((url,key,field('title',5000),field('nickname',500),body,field('capturedAt',100),field('group',160)))
        with closing(self.connect()) as c,c:
            c.execute('begin immediate')
            before=c.execute('select count(*) from comments').fetchone()[0]
            c.executemany('''insert into comments(url,key,title,nick,body,stamp,hint) values(?,?,?,?,?,?,?)
             on conflict(url,key) do update set nick=case when comments.nick='' then excluded.nick else comments.nick end,
             hint=case when excluded.hint not in ('','unknown') then excluded.hint else comments.hint end''',values)
            after=c.execute('select count(*) from comments').fetchone()[0]
        return dict(received=len(rows),added=after-before,duplicate=len(rows)-(after-before),total=after)
    def seed(self,path):
        with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as s:
            data=[dict(url='https://www.douyin.com/video/'+v,key=k,title=t,nickname=n,text=b,capturedAt=stamp)
                  for v,k,t,n,b,stamp in s.execute('select vid,k,title,nick,body,captured from rows order by rowid')]
        for i in range(0,len(data),5000): self.add(data[i:i+5000])
    def rows(self):
        with closing(self.connect()) as c:return c.execute('select * from comments order by rid').fetchall()
    def generate(self,subset):
        if subset not in ['全部',*LABELS]:raise ValueError('未知筛选')
        with self.lock:
            dest=self.folder/'reports'/datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            summary=report(self.rows(),dest,subset)
            with closing(self.connect()) as c,c:c.execute("insert or replace into meta values('latest',?)",(dest.name,))
        return dict(id=dest.name,**summary)
    def latest(self):
        with closing(self.connect()) as c:r=c.execute("select v from meta where k='latest'").fetchone()
        if r:
            path=self.folder/'reports'/r[0]/'摘要.json'
            if path.is_file():return dict(id=r[0],**json.loads(path.read_text(encoding='utf8')))

def create(lib,port):
    app=Flask(__name__);app.config['MAX_CONTENT_LENGTH']=4*1024*1024
    address='127.0.0.1:'+str(port)
    @app.before_request
    def local():
        if request.host!=address:abort(403)
        if request.method=='POST':
            if not request.is_json:abort(415)
            origin=request.headers.get('Origin','')
            if origin and origin!='http://'+address and not re.fullmatch(r'chrome-extension://[a-p]{32}',origin):abort(403)
            if not hmac.compare_digest(request.headers.get('X-Pair-Key','').encode(),lib.pair.encode()):abort(403)
    @app.after_request
    def headers(r):
        r.headers.update({'Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff',
          'Content-Security-Policy':"default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
        return r
    @app.errorhandler(ValueError)
    def invalid(e):return jsonify(error=str(e)),400
    @app.get('/')
    def page():return render_template('index.html',port=port,pair=lib.pair,labels=LABELS)
    @app.get('/api/identity')
    def identity():return jsonify(app='comment-workbench-v1')
    @app.post('/api/pair')
    def pair():return jsonify(ok=True,app='comment-workbench-v1')
    @app.post('/api/receive')
    def receive():return jsonify(lib.add(request.get_json().get('rows')))
    @app.post('/api/report')
    def generate():return jsonify(lib.generate(request.get_json().get('subset','全部')))
    @app.get('/api/state')
    def state():
        with closing(lib.connect()) as c:size,videos=c.execute('select count(*),count(distinct url) from comments').fetchone()
        return jsonify(total=size,videos=videos,latest=lib.latest())
    @app.get('/api/review')
    def review():
        page=max(1,request.args.get('page',1,type=int));label=request.args.get('label','');q=request.args.get('q','').lower().strip()
        rows=[]
        for r in lib.rows():
            auto,why=attitude(r['body'])
            if label and (r['manual'] or auto)!=label:continue
            if q and q not in (r['title']+' '+r['body']).lower():continue
            rows.append(dict(id=r['rid'],body=r['body'],title=r['title'],auto=auto,why=why,manual=r['manual'],group=model_group(r['body'],r['title'],r['hint'])[0]))
        return jsonify(total=len(rows),rows=rows[(page-1)*20:page*20])
    @app.post('/api/review/<int:rid>')
    def override(rid):
        label=request.get_json().get('label')
        if label not in ['',*LABELS]:abort(400)
        with closing(lib.connect()) as c,c:
            if not c.execute('update comments set manual=? where rid=?',(label,rid)).rowcount:abort(404)
        return jsonify(ok=True)
    @app.get('/result/<run>/<filename>')
    def result(run,filename):
        if not re.fullmatch(r'\d{8}-\d{6}-\d{6}',run) or filename not in ['评论分析.csv','摘要.json',*[g+end for g in ['整体','通用','专用'] for end in ['.png','词频.csv']]]:abort(404)
        return send_from_directory(lib.folder/'reports'/run,filename,as_attachment=filename.endswith('.csv'))
    return app

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--port',type=int,default=int(os.environ.get('COMMENT_PORT','8765')))
    p.add_argument('--data',type=Path,default=ROOT/'local_data')
    p.add_argument('--source',type=Path,help='显式导入旧版原始 SQLite（默认不导入）')
    p.add_argument('--no-open',action='store_true');args=p.parse_args()
    if not 1024<=args.port<=65535:p.error('端口范围：1024–65535')
    url='http://127.0.0.1:'+str(args.port)
    try:
        with urllib.request.urlopen(url+'/api/identity',timeout=.5) as r:
            same=json.loads(r.read(256)).get('app')=='comment-workbench-v1'
        if same:
            if not args.no_open:webbrowser.open(url)
            print(url,flush=True);return
    except (ValueError,OSError):pass
    lib=Library(args.data.resolve())
    # Seed once, not on each restart or each sync.
    with closing(lib.connect()) as db:seeded=db.execute("select 1 from meta where k='seeded'").fetchone()
    if args.source and args.source.is_file() and not seeded:
        lib.seed(args.source)
        with closing(lib.connect()) as db,db:db.execute("insert or ignore into meta values('seeded','1')")
    if not lib.latest():lib.generate('全部')
    srv=make_server('127.0.0.1',args.port,create(lib,args.port),threaded=True)
    print(url,flush=True)
    if not args.no_open:webbrowser.open(url)
    srv.serve_forever()
if __name__=='__main__':main()
