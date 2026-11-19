const $=id=>document.getElementById(id), labels=['正向','负向','混合','待判定'];
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
const tell=t=>{$('status').textContent=t};
async function api(path,data){
 const r=await fetch(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Pair-Key':document.body.dataset.key},body:JSON.stringify(data)});
 if(!r.ok)throw Error(`操作失败（${r.status}）`);return r.json();
}
const onError=e=>tell(e.message);let page=1,serial=0,last='';
async function state(){
 const s=await api('/api/state'),r=s.latest;
 if(!last)tell(`已入库 ${s.total} 条评论 · ${s.videos} 个作品`);
 if(!r)return;
 $('stats').replaceChildren(...labels.map(l=>{const n=el('span',l);n.className='metric';n.append(el('b',r.labels[l]));return n}));
 const prefix='/result/'+r.id+'/';$('csv').href=prefix+'评论分析.csv';
 $('caption').textContent=`当前样本 ${s.total} 条 · 上次报告 ${r.total} 条 · ${r.generated.replace('T',' ')} · ${r.subset}：${r.selected} 条`;
 if(last===r.id)return;last=r.id;
 $('clouds').replaceChildren(...Object.entries(r.sizes).sort((a,b)=>['整体','通用','专用'].indexOf(a[0])-['整体','通用','专用'].indexOf(b[0])).map(([g,n])=>{
  const fig=el('figure'),img=el('img'),a=el('a'),c=el('figcaption',`${g} · ${n} 条`),f=el('a','词频 CSV');
  img.alt=g+'词云，'+n+'条评论';a.href=img.src=prefix+g+'.png';a.append(img);f.href=prefix+g+'词频.csv';c.append(f);fig.append(a,c);return fig;
 }));
}
async function review(){
 const seq=++serial,data=await api('/api/review?'+new URLSearchParams({page,label:$('filter').value,q:$('q').value}));
 if(seq!==serial)return;
 if(!data.rows.length&&page>1){page=1;return review()}
 $('page').textContent=`${page} / ${Math.max(1,Math.ceil(data.total/20))} 页 · ${data.total} 条`;$('prev').disabled=page===1;$('next').disabled=page*20>=data.total;
 $('rows').replaceChildren(...data.rows.map(r=>{const d=el('div');d.className='row';const s=el('select');s.setAttribute('aria-label','人工态度');
 for(const l of ['',...labels])s.add(new Option(l||'沿用自动判断',l));s.value=r.manual;
 s.onchange=async()=>{try{await api('/api/review/'+r.id,{label:s.value});tell('改判已保存；重新生成报告即可更新统计和词云。');await review()}catch(e){onError(e)}};
 d.append(el('small',`#${r.id} · ${r.group} · ${r.title}`),el('p',r.body),el('small',`规则：${r.auto} · ${r.why}　`),s);return d}));
}
$('run').onclick=async()=>{const b=$('run');b.disabled=true;tell('正在生成三张词云…');try{const r=await api('/api/report',{subset:$('subset').value});await state();tell(`报告已生成：${r.selected} 条评论`)}catch(e){onError(e)}finally{b.disabled=false}};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('pair').value);tell('配对码已复制')}catch{$('pair').type='text';$('pair').select();tell('请复制已选中的配对码')}};
$('prev').onclick=()=>{page--;review().catch(onError)};$('next').onclick=()=>{page++;review().catch(onError)};
let timer;for(const id of ['filter','q'])$(id).oninput=()=>{page=1;clearTimeout(timer);timer=setTimeout(()=>review().catch(onError),150)};
Promise.all([state(),review()]).catch(onError);setInterval(()=>state().catch(onError),12000);
