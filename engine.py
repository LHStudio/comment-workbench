"""Local, explainable first-pass coding. No nicknames or free-form identifiers in plots."""
import csv
import json
import os
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

GENERAL = '豆包 DeepSeek ChatGPT GPT 千问 通义千问 文心一言 腾讯元宝 Kimi 通用模型 通用大模型'.split()
SPECIAL = '阿福 小荷AI医生 小荷医生 小荷健康 讯飞晓医 安诊儿 蚂蚁AQ 医疗大模型 医学大模型 医疗专用 健康专用 AI小医 好伴AI 健康助手 健康管家'.split()
POS = '好用 好使 有用 有帮助 靠谱 信任 相信它 方便 便捷 省事 省时 省钱 实用 高效 挺准 很准 准确率高 比较准 准确 好评 救了 帮了大忙 值得推荐 很专业 靠得住 不错 比医生强 挺好用 好用得很'.split()
NEG = '不准 不太准 不够准 不靠谱 不太靠谱 不可信 不信任 不敢信 不能信 不相信 没帮助 没有帮助 不好用 没用 没什么用 不方便 不实用 不专业 不推荐 不安全 不放心 不可靠 不如医生 不能替代 不能代替 幻觉 胡说八道 胡说 乱说 瞎说 误诊 误导 乱开药 泄露隐私 智商税 害人 耽误病情 错得离谱 不敢用 不建议用'.split()
POS += '很实用 值得拥有 接地气 心里有底 心里有个底 让人安心 放心多了 比较准确'.split()
NEG += '没有亮点 乱七八糟 不会变通 过于死板 不怎么样 太离谱'.split()
TOPICS = '''人工智能 大模型 医疗AI AI 问诊 看病 医生 医院 患者 病人 就诊 就医 挂号 排队
体检报告 检查报告 化验单 报告 检查 化验 拍片 诊断 治疗 手术 用药 开药 药品 药物 处方
症状 病情 疾病 病历 复诊 皮肤 儿科 急诊 专家 医学 临床 健康咨询 咨询 健康管理 健康
准确率 准确性 可靠 专业 安全 隐私 信息泄露 数据安全 风险 责任 免责声明 建议 参考 辅助
替代 代替 核实 核对 复核 把关 追问 效率 时间 免费 收费 费用 会员 广告 商业化
担心 焦虑 安心 信心 信任度 搜索 搜索引擎 百度 互联网 信息 回答 提问 分析 解读 数据
学习 使用 体验 下载 推荐 软件 功能 模型 算法 训练 知识 水平 技术 线上 线下
乡村 基层 老人 孩子 家人 科普 科学 辨别 辨证 中医 西医 结果 反馈 文件 图片
验证码 审核 医保 费用 便民 指导 局限 分诊 急救 翻译 心理 心情 营养 运动 睡眠'''.split()
LABELS = ['正向', '负向', '混合', '待判定']
GROUPS = ['整体', '通用', '专用']
def pattern(words):
    return re.compile('|'.join(map(re.escape, sorted(set(words), key=lambda x:(-len(x), x)))), re.I)
ATT = pattern(POS + NEG)
LEXICON = {x.lower(): x for x in TOPICS + GENERAL + SPECIAL + POS + NEG}
TERM = pattern(LEXICON)
HUMAN = re.compile('医生|护士|医院|大夫|专家|身体|病情|手术')
AI = pattern(GENERAL + SPECIAL + ['ai','模型','软件','它','机器','智能'])

def attitude(text):
    evidence = []
    for clause in re.split('[，,。！!；;\\n]|但是|不过|但', text):
        if not clause or re.search(r'[?？]|靠不靠谱|准不准|有没有用|好不好用|是不是|会不会|[吗么][呀啊呢吧]?[\\s。]*$', clause):
            continue
        if HUMAN.search(clause) and not AI.search(clause) and not re.search('比医生强|不如医生', clause):
            continue
        for m in ATT.finditer(clause):
            word = m.group()
            if word in ('没用','有用') and re.match('过|上|到|完',clause[m.end():]):continue
            if word=='不方便' and re.search('去哪|出门|去医院|挂号|排队|半夜去',clause):continue
            if word in ('靠谱','很专业') and re.search('专业的人|真人|人类',clause) and not AI.search(clause):continue
            if word=='准确' and clause[m.end():].startswith('率') and not re.search('准确率(?:很高|高|超)',clause):continue
            prefix = clause[max(0,m.start()-5):m.start()]
            polarity = '负向' if word in NEG else '正向'
            if re.search(r'(不|没|没有|并非|不是|谈不上|不够|不太|并不|未必|一点也不)(算|太|怎么|那么|很)?$',prefix):
                if polarity=='负向': continue
                polarity = '负向'
                word = prefix + word
            evidence.append((word, polarity))
    labels = {p for _,p in evidence}
    return ('混合' if len(labels)==2 else next(iter(labels),'待判定'),
            '；'.join(dict.fromkeys(w+'→'+p for w,p in evidence)) or '无明确态度证据，或为提问、非模型评价')

def model_group(body,title,hint):
    hints={'general':'通用','specialized':'专用','both':'两类','other':'其他'}
    for s,source in [(body,'评论明示'),(title,'标题语境')]:
        if source=='标题语境' and hint in hints: return hints[hint],'视频人工类型'
        flags=[any(w.lower() in s.lower() for w in ws) for ws in (GENERAL,SPECIAL)]
        if any(flags): return ('两类' if all(flags) else ('通用' if flags[0] else '专用')),source
    return '未明确','无模型线索'

def tokens(text):
    text=re.sub(r'https?://\S+|@[\w.-]+|\[[^\]\n]{1,25}\]', ' ', text)
    return {LEXICON[m.group().lower()] for m in TERM.finditer(text)}

def csvfile(path,head,rows):
    def safe(v):
        s=str(v or '') if not isinstance(v,int) else str(v)
        return "'"+s if s.lstrip().startswith(('=','+','-','@')) or s.startswith(('\r','\t')) else s
    with path.open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f);w.writerow(head);w.writerows([safe(x) for x in row] for row in rows)

def draw(path, counts, group, size, subset):
    from PIL import Image, ImageDraw, ImageFont
    from wordcloud import WordCloud
    fonts=[os.getenv('CLOUD_FONT',''),'C:/Windows/Fonts/msyh.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
    font=next((f for f in fonts if f and Path(f).is_file()),None)
    if not font: raise ValueError('缺少中文字体，请配置 CLOUD_FONT')
    img=Image.new('RGB',(1200,740),'#ffffff')
    d=ImageDraw.Draw(img)
    label={'整体':'整体讨论','通用':'通用模型','专用':'医疗健康专用模型'}[group]
    d.text((36,20),label+' · 评论词云',font=ImageFont.truetype(font,35),fill='#172e39')
    d.text((38,78),f'{size} 条评论   |   态度：{subset}   |   字越大，提到该词的评论越多',font=ImageFont.truetype(font,21),fill='#465e64')
    if counts:
        palette=['#16665a','#194f72','#803f5c','#3d505e','#805315']
        wc=WordCloud(font_path=font,width=1128,height=555,background_color='white',
                     max_words=65,random_state=17,prefer_horizontal=1,collocations=False,
                     color_func=lambda word,**kw:palette[sum(map(ord,word))%len(palette)])
        wc.generate_from_frequencies(dict(sorted(counts.items(),key=lambda kv:(-kv[1],kv[0]))))
        img.paste(wc.to_image(),(36,125))
    else: d.text((40,240),'此范围暂无可展示的主题词',font=ImageFont.truetype(font,28),fill='#526770')
    d.text((38,694),'仅统计评论正文命中的主题词；颜色不表示态度。',font=ImageFont.truetype(font,19),fill='#465e64')
    img.save(path)

def report(rows, directory, subset='全部'):
    directory.mkdir(parents=True,exist_ok=False)
    counts={g:Counter() for g in GROUPS}; sizes=Counter(); attitudes=Counter(); groups=Counter(); filtered=[]
    for r in rows:
        auto,why=attitude(r['body']); label=r['manual'] or auto
        g,basis=model_group(r['body'],r['title'],r['hint'])
        attitudes[label]+=1;groups[g]+=1
        if subset!='全部' and label!=subset: continue
        words=tokens(r['body'])
        for name in GROUPS:
            if name=='整体' or name==g or g=='两类':
                sizes[name]+=1;counts[name].update(words)
        level=r['depth'] or ('楼中楼（级数未知）' if r['is_reply'] else '未知')
        filtered.append([r['rid'],r['title'],r['url'],r['body'],r['stamp'],g,basis,auto,why,r['manual'],label,'、'.join(sorted(words)),
                         level,r['ref'],r['parent_ref'],r['root_ref']])
    csvfile(directory/'评论分析.csv',['分析编号','作品标题','作品链接','评论正文','采集时间','模型组','分组依据','自动态度','规则依据','人工改判','最终态度','主题词',
                                  '评论层级','评论标识','父评论标识','所属主评标识'],filtered)
    for g in GROUPS:
        csvfile(directory/(g+'词频.csv'),['词语','提及评论数'],sorted(counts[g].items(),key=lambda kv:(-kv[1],kv[0])))
        draw(directory/(g+'.png'),counts[g],g,sizes[g],subset)
    summary=dict(total=len(rows),videos=len({r['url'] for r in rows}),selected=len(filtered),subset=subset,
                 labels={k:attitudes[k] for k in LABELS},groups=dict(groups),sizes={g:sizes[g] for g in GROUPS},
                 generated=datetime.now().astimezone().isoformat(timespec='seconds'),method='本地词典规则 v1；不是人工标注或准确率评估')
    (directory/'摘要.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    return summary
