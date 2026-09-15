export function liffHtml(liffId: string): string {
  const safeId = JSON.stringify(liffId).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BeLate</title>
<style>
:root{
  --ground:#ecefec;--surface:#fff;--ink:#10151a;--muted:#61716b;--line:#dde3df;
  --accent:#06c755;--accent-ink:#04381f;--warn:#c2571a;--danger:#d81e3f;--shadow:0 1px 2px #0f151a0f,0 12px 28px -18px #0f151a59;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#0c110f;--surface:#161c19;--ink:#eef2ef;--muted:#96a49d;--line:#273029;
  --accent:#22d46f;--accent-ink:#062e18;--warn:#f0a05a;--danger:#ff5470;--shadow:0 1px 2px #0006,0 14px 30px -20px #000c;
}}
:root[data-theme="dark"]{
  --ground:#0c110f;--surface:#161c19;--ink:#eef2ef;--muted:#96a49d;--line:#273029;
  --accent:#22d46f;--accent-ink:#062e18;--warn:#f0a05a;--danger:#ff5470;--shadow:0 1px 2px #0006,0 14px 30px -20px #000c;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-size:17px;
  font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;
  font-feature-settings:"palt";-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
main{max-width:480px;margin:0 auto;padding:16px;padding-block:20px 40px;display:flex;flex-direction:column;gap:14px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px}
.mark{font-weight:800;letter-spacing:.14em;font-size:14px;text-transform:uppercase;color:var(--muted)}
.pill{font-size:13px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.pill[data-live="1"]{color:var(--accent-ink);background:var(--accent);border-color:transparent}
.card{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:var(--shadow)}
.eyebrow{margin:0 0 6px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
h1{margin:0;font-size:25px;line-height:1.3;text-wrap:balance}
.when{margin:10px 0 0;color:var(--muted);font-size:15px;font-variant-numeric:tabular-nums}
.count{margin-top:16px;padding-top:16px;border-top:1px solid var(--line);display:flex;align-items:baseline;gap:8px}
.count b{font-size:36px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.count span{font-size:14px;color:var(--muted)}
.count[data-late="1"] b{color:var(--danger);animation:pulse 1.6s ease-in-out infinite}
.rule{margin:12px 0 0;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}
.msg{white-space:pre-wrap;line-height:1.7;font-size:17px;font-weight:500}
.msg[data-tone="error"]{border-color:var(--danger);color:var(--danger);font-weight:700}
.actions{display:flex;flex-direction:column;gap:9px}
button,input{font:inherit;width:100%}
button{padding:16px;border:0;border-radius:13px;background:var(--accent);color:var(--accent-ink);font-weight:800;font-size:17px;cursor:pointer;
  transition:transform .1s ease,filter .1s ease,opacity .1s ease}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line);font-weight:600}
button:active{transform:scale(.96);filter:brightness(.92)}
button:disabled{opacity:.55;transform:none}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
form{display:flex;flex-direction:column;gap:12px}
label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--muted)}
input{padding:12px;border:1px solid var(--line);border-radius:11px;background:var(--ground);color:var(--ink)}
.foot{margin:0;text-align:center;font-size:13px;color:var(--muted)}
.hidden{display:none!important}
.meterbar{margin-top:10px;height:10px;border-radius:999px;background:var(--ground);overflow:hidden}
.meterfill{height:100%;background:var(--accent);border-radius:999px;transition:width .3s}
.meterbar[data-full="1"] .meterfill{background:var(--danger)}
.meterval{margin:8px 0 0;font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}
.meterbar[data-full="1"]+.meterval{color:var(--danger)}
.roster{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.roster li{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:15px;padding:2px 0}
.roster .name{font-weight:700}
.roster .sub{color:var(--muted);font-size:13px}
.roster .amount{font-variant-numeric:tabular-nums;font-weight:700}
.roster [data-arrived="1"] .amount{color:var(--accent-ink)}
.roster li[data-late="1"]{border-left:3px solid var(--danger);padding-left:10px;margin-left:-13px}
.roster li[data-late="1"] .name,.roster li[data-late="1"] .amount{color:var(--danger)}
.roster li[data-late="1"] .sub{color:var(--danger);font-weight:700}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
</style>
</head><body><main>
<div class="topbar"><span class="mark">BeLate</span><span id="state" class="pill">接続中</span></div>
<section id="event" class="card hidden">
  <p class="eyebrow">集合場所</p><h1 id="place"></h1>
  <p id="when" class="when"></p>
  <div id="count" class="count"><b id="countValue">--</b><span id="countLabel">集合まで</span></div>
  <p id="rule" class="rule"></p>
  <div id="meter" class="hidden"><p class="eyebrow" style="margin-top:16px">現在の罰金</p><div id="meterBar" class="meterbar"><div id="meterFill" class="meterfill" style="width:0%"></div></div><p id="meterValue" class="meterval">0円</p></div>
</section>
<div id="status" class="card msg">読み込み中…</div>
<section id="report" class="actions hidden">
  <button id="arrive">位置情報で到着報告</button>
  <button id="share" class="ghost">現在地との距離だけ共有</button>
  <button id="manual" class="ghost">位置が取れない（手動で申告）</button>
</section>
<form id="settings" class="card hidden">
  <label>集合日時<input id="meet" type="datetime-local" required></label>
  <label>初期金額（円）<input id="base" type="number" min="0" required></label>
  <label>1分あたり（円）<input id="per" type="number" min="0" required></label>
  <label>上限（円）<input id="max" type="number" min="0" required></label>
  <button>設定を保存</button>
</form>
<section id="roster" class="card hidden"><p class="eyebrow">参加者</p><ul id="rosterList" class="roster"></ul></section>
<section id="settle" class="card hidden"><p class="eyebrow">参加者</p><ul id="settlePeople" class="roster"></ul><p class="eyebrow" style="margin-top:16px">ダウト結果</p><p id="settleDoubt" class="msg"></p><p class="eyebrow" style="margin-top:16px">支払い</p><ul id="settleDebts" class="roster"></ul></section>
<p class="foot">集合地点から150m以内で到着になります</p>
</main>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script><script>
const LIFF_ID=${safeId}, raw=new URLSearchParams(location.search), qs=new URLSearchParams(raw.get('liff.state')?.replace(/^\\?/,'')??location.search), eventId=qs.get('e'), mode=qs.get('mode')||'arrive'; let profile,eventData;
const $=id=>document.getElementById(id), status=$('status'), report=$('report'), settings=$('settings');
function say(message,tone){status.textContent=message;status.dataset.tone=tone||'';status.classList.remove('hidden')}
function fmt(ms){const m=Math.floor(Math.abs(ms)/60000);return (m>=60?Math.floor(m/60)+'時間'+(m%60)+'分':m+'分')}
function currentFine(){const minutes=Math.max(0,Math.ceil((Date.now()-eventData.meetAt)/60000));return minutes===0?0:Math.min(eventData.baseFine+eventData.perMin*minutes,eventData.maxFine)}
function tick(){
  if(!eventData)return;
  const left=eventData.meetAt-Date.now();
  $('countValue').textContent=fmt(left);$('countLabel').textContent=left>=0?'集合まで':'集合から経過';$('count').dataset.late=left<0?'1':'0';
  if(left<0&&['locked','running'].includes(eventData.state)){
    const fine=currentFine();
    $('meter').classList.remove('hidden');
    $('meterFill').style.width=Math.round(fine/eventData.maxFine*100)+'%';
    $('meterBar').dataset.full=fine>=eventData.maxFine?'1':'0';
    $('meterValue').textContent=fine.toLocaleString('ja-JP')+'円';
  }else $('meter').classList.add('hidden');
}
function renderRoster(people){
  if(!people||!people.length)return;
  $('rosterList').innerHTML=people.map(p=>{
    const status=p.arrived?'到着済み':(p.distance!=null?'約'+p.distance+'m':'未報告');
    return '<li data-arrived="'+(p.arrived?1:0)+'"><span><span class="name">'+(p.name||'参加者')+'</span><br><span class="sub">'+status+'</span></span><span class="amount">'+(p.fine!=null?p.fine.toLocaleString('ja-JP')+'円':'--')+'</span></li>';
  }).join('');
  $('roster').classList.remove('hidden');
}
async function json(url,opts){const r=await fetch(url,opts),j=await r.json();if(!r.ok)throw Error(j.error||'通信エラー');return j}
async function busy(btn,label,fn){const original=btn.textContent;btn.disabled=true;btn.textContent=label;try{await fn()}finally{btn.disabled=false;btn.textContent=original}}
async function init(){try{
  await liff.init({liffId:LIFF_ID});
  if(!liff.isLoggedIn()){liff.login();return}
  if(!liff.isInClient())throw Error('LINEアプリ内から開いてください');
  profile=await liff.getProfile();
  eventData=await json('/api/events/'+encodeURIComponent(eventId));
  $('place').textContent=eventData.placeName||'集合場所';
  $('when').textContent=new Date(eventData.meetAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'});
  $('rule').textContent='罰金 '+eventData.baseFine+'円 + '+eventData.perMin+'円/分（上限'+eventData.maxFine+'円）';
  $('event').classList.remove('hidden');
  $('state').textContent={draft:'作成中',open:'参加受付中',locked:'締切済み',running:'カウント中',settled:'精算済み'}[eventData.state]||eventData.state;
  $('state').dataset.live=eventData.state==='running'?'1':'0';
  tick();setInterval(tick,15000);
  if(mode!=='settlement')renderRoster(eventData.participants);
  if(mode==='settlement'){
    if(eventData.state!=='settled')say('まだ精算されていません。');
    else{const s=await json('/api/settlement/'+encodeURIComponent(eventId));
      $('settlePeople').innerHTML=s.participants.map(p=>{
        const late=p.lateMinutes>0;
        return '<li data-late="'+(late?1:0)+'"><span><span class="name">'+(late?'⚠ ':'')+(p.name||'参加者')+'</span><br><span class="sub">'+(late?p.lateMinutes+'分遅刻':'定刻')+'</span></span><span class="amount">'+(p.fine!=null?p.fine.toLocaleString('ja-JP')+'円':'--')+'</span></li>';
      }).join('');
      $('settleDoubt').textContent=s.doubtText;
      $('settleDebts').innerHTML=s.debts.length?s.debts.map(d=>'<li><span class="name">'+d.from+' → '+d.to+'</span><span class="amount">'+d.amount.toLocaleString('ja-JP')+'円</span></li>').join(''):'<li>支払いはありません</li>';
      $('settle').classList.remove('hidden');say('精算結果です。支払いは各自でお願いします。')}
  }else if(mode==='settings'){settings.classList.remove('hidden');$('meet').value=new Date(eventData.meetAt+32400000).toISOString().slice(0,16);$('base').value=eventData.baseFine;$('per').value=eventData.perMin;$('max').value=eventData.maxFine;say('幹事だけが変更できます。')}
  else{report.classList.remove('hidden');say('到着したらボタンを押してください。')}
}catch(e){say(e.message,'error')}}
function auth(){return {idToken:liff.getIDToken(),displayName:profile.displayName}}
function locate(btn,arrive){busy(btn,'取得中…',()=>new Promise(resolve=>{say('位置情報を取得中…');navigator.geolocation.getCurrentPosition(async p=>{try{
  const j=await json('/api/arrive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId,...auth(),lat:p.coords.latitude,lng:p.coords.longitude,arrive})});
  say(j.message);
}catch(e){say(e.message,'error')}resolve()},e=>{say('位置情報を取得できません: '+e.message,'error');resolve()},{enableHighAccuracy:true,timeout:15000})}))}
$('arrive').onclick=e=>locate(e.currentTarget,true);
$('share').onclick=e=>locate(e.currentTarget,false);
$('manual').onclick=e=>{if(!confirm('グループ内で確認する手動到着申告を送りますか？'))return;busy(e.currentTarget,'送信中…',async()=>{try{
  const j=await json('/api/arrive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId,...auth(),arrive:true,manual:true})});say(j.message);
}catch(e){say(e.message,'error')}})};
settings.onsubmit=e=>{e.preventDefault();busy(e.target.querySelector('button'),'保存中…',async()=>{try{
  const j=await json('/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({eventId,userId:profile.userId,meetAt:new Date($('meet').value+'+09:00').getTime(),baseFine:+$('base').value,perMin:+$('per').value,maxFine:+$('max').value})});say(j.message);
}catch(e){say(e.message,'error')}})};
init();</script></body></html>`;
}
