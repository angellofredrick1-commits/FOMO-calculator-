import { useState, useEffect, useRef, useCallback } from "react";

// ── API ─────────────────────────────────────────────────────────
async function fetchLivePrice(symbol) {
  try {
    var res = await fetch("/.netlify/functions/prices?symbol=" + symbol.toUpperCase());
    if (!res.ok) throw new Error("prices " + res.status);
    return res.json();
  } catch(e) { return null; }
}

async function fetchHistoricalPrices(symbol, startDate) {
  try {
    var res = await fetch("/.netlify/functions/history?symbol=" + symbol + "&from=" + startDate);
    if (!res.ok) throw new Error("history " + res.status);
    return res.json();
  } catch(e) { return null; }
}

// ── Simulation fallback ──────────────────────────────────────────
var PRICE_HISTORY = {
  CRDB:  {"2018":160,"2019":150,"2020":95,"2021":195,"2022":280,"2023":380,"2024":460,"2025":670,"2026":2570},
  NMB:   {"2018":2750,"2019":2340,"2020":2340,"2021":2340,"2022":2000,"2023":3100,"2024":4500,"2025":5350,"2026":8590},
  MKCB:  {"2018":800,"2019":800,"2020":780,"2021":780,"2022":780,"2023":780,"2024":630,"2025":540,"2026":3040},
  DCB:   {"2018":340,"2019":340,"2020":295,"2021":265,"2022":190,"2023":150,"2024":140,"2025":135,"2026":240},
};

function interpolatePrice(anchors, dateStr) {
  var year = parseInt(dateStr.slice(0,4)), month = parseInt(dateStr.slice(5,7));
  var years = Object.keys(anchors).map(Number).sort(function(a,b){return a-b;});
  if (year <= years[0]) return anchors[String(years[0])];
  if (year >= years[years.length-1]) return anchors[String(years[years.length-1])];
  var y0=years[0], y1=years[1];
  for (var i=0;i<years.length-1;i++) { if (years[i]<=year&&year<years[i+1]){y0=years[i];y1=years[i+1];break;} }
  var frac=(year-y0+(month-1)/12)/(y1-y0);
  return Math.round(anchors[String(y0)]+(anchors[String(y1)]-anchors[String(y0)])*frac);
}

function simulatePrices(symbol, startDate) {
  var anchors=PRICE_HISTORY[symbol]||{"2018":500,"2026":800};
  var start=new Date(startDate), end=new Date();
  var days=Math.ceil((end-start)/86400000);
  var seed=symbol.charCodeAt(0)*1000+(symbol.charCodeAt(1)||0);
  var rand=function(){seed=(seed*1664525+1013904223)&0xffffffff;return(seed>>>0)/0xffffffff;};
  var out=[],prev=null;
  for (var i=0;i<=days;i++) {
    var d=new Date(start.getTime()+i*86400000);
    if (d.getDay()===0||d.getDay()===6) continue;
    var ds=d.toISOString().split("T")[0];
    var base=interpolatePrice(anchors,ds);
    var p=Math.round(base*(1+(rand()-0.5)*0.016));
    if (prev!==null){var cap=prev*0.03;p=Math.max(prev-cap,Math.min(prev+cap,p));}
    p=Math.max(p,10); prev=p; out.push({date:ds,price:p});
  }
  return out;
}

async function fetchPrices(symbol, startDate) {
  var prices = await fetchHistoricalPrices(symbol, startDate);
  if (!prices||!Array.isArray(prices)||prices.length<5) prices=simulatePrices(symbol,startDate);
  try {
    var live=await fetchLivePrice(symbol);
    if (live&&live.price) { var today=new Date().toISOString().split("T")[0]; prices[prices.length-1]={date:today,price:Math.round(live.price)}; }
  } catch(e){}
  return prices;
}

// ── Data ─────────────────────────────────────────────────────────
var DSE_STOCKS = [
  {symbol:"CRDB", name:"CRDB Bank",               sector:"Banking"},
  {symbol:"NMB",  name:"NMB Bank",                sector:"Banking"},
  {symbol:"MKCB", name:"Mkombozi Commercial Bank", sector:"Banking"},
  {symbol:"DCB",  name:"DCB Commercial Bank",      sector:"Banking"},
];

var COMPARISONS = [
  {id:"phone_mid",  label:"Mid-range phone",   sub:"Samsung A55, Tecno",      price:850000},
  {id:"phone_flag", label:"Flagship phone",    sub:"Samsung S24, iPhone 15",  price:2800000},
  {id:"laptop",     label:"Laptop",            sub:"HP, Lenovo, Dell",        price:1800000},
  {id:"tv",         label:"Smart TV 43\"",     sub:"Samsung, LG, TCL",        price:1200000},
  {id:"fridge",     label:"Refrigerator",      sub:"250L double-door",        price:1500000},
  {id:"rent",       label:"6 months rent",     sub:"1-bed, Kinondoni",        price:3600000},
  {id:"car",        label:"Car down payment",  sub:"Toyota Vitz deposit",     price:5000000},
  {id:"school",     label:"School fees 1yr",   sub:"Private secondary",       price:1400000},
  {id:"solar",      label:"Solar system",      sub:"300W home system",        price:2200000},
  {id:"vacation",   label:"Zanzibar vacation", sub:"5 nights + flights",      price:2000000},
];

var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var MIN_YEAR = 2018, MAX_YEAR = 2026;

function fmtN(n){return new Intl.NumberFormat("en-TZ").format(Math.round(n));}
function fmtS(n){if(n>=1000000)return(n/1000000).toFixed(1)+"M";if(n>=1000)return Math.round(n/1000)+"K";return String(Math.round(n));}

// ── Tokens ───────────────────────────────────────────────────────
var G = {
  green:"#22c55e", greenDark:"#15803d",
  greenBg:"rgba(34,197,94,.07)", greenBorder:"rgba(34,197,94,.22)",
  black:"#0a0a0a", white:"#ffffff",
  muted:"rgba(10,10,10,.4)", border:"rgba(10,10,10,.08)",
  font:"'Sora',system-ui,sans-serif",
};

// ── Share card HTML (mobile 375px, white + green only) ──────────
function buildCardHTML(d) {
  var sign=d.gain>=0?"+":"";
  var yr=d.startDate.slice(0,4);
  var mult=(d.currentValue/d.invested).toFixed(1);

  // Sparkline
  var W=375,H=80;
  var vals=d.monthly.map(function(p){return p.price;});
  var mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals);
  var pts=d.monthly.map(function(p,i){
    var x=(i/(d.monthly.length-1))*W;
    var y=H-((p.price-mn)/(mx-mn||1))*(H-10)-5;
    return x.toFixed(1)+","+y.toFixed(1);
  }).join(" ");
  var area="M"+pts.replace(/ /g," L")+" L"+W+","+H+" L0,"+H+" Z";

  var css=""
    +"*{margin:0;padding:0;box-sizing:border-box}"
    +"body{background:#fff;font-family:'Sora',system-ui,sans-serif;width:375px;min-height:480px}"
    +".card{width:375px;background:#fff;position:relative;overflow:hidden}"
    +".stripe{height:4px;background:#22c55e;width:100%}"
    +".body{padding:28px 24px 0}"
    +".hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}"
    +".logo{display:flex;align-items:center;gap:7px}"
    +".icon{width:26px;height:26px;background:#0a0a0a;border-radius:6px;display:flex;align-items:flex-end;gap:2px;padding:4px 5px}"
    +".b1{width:3px;height:5px;background:#22c55e;border-radius:1px}"
    +".b2{width:3px;height:8px;background:#22c55e;border-radius:1px}"
    +".b3{width:3px;height:11px;background:#22c55e;border-radius:1px}"
    +".wm{font-size:13px;font-weight:800;color:#0a0a0a;letter-spacing:-.3px}"
    +".badge{font-size:8px;font-weight:700;letter-spacing:.1em;color:#15803d;border:1.5px solid #22c55e;padding:3px 10px;text-transform:uppercase}"
    +".nar{font-size:12px;color:rgba(10,10,10,.45);margin-bottom:3px;line-height:1.4}"
    +".rev{font-size:12px;font-style:italic;color:rgba(10,10,10,.45);margin-bottom:8px}"
    +".money{font-size:52px;font-weight:800;color:#0a0a0a;letter-spacing:-2.5px;line-height:1;margin-bottom:10px}"
    +".money em{color:#22c55e;font-style:normal}"
    +".pills{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}"
    +".pg{background:#22c55e;color:#052e16;font-size:11px;font-weight:700;padding:5px 12px}"
    +".pn{background:#f4f4f4;color:#0a0a0a;font-size:11px;font-weight:600;padding:5px 12px}"
    +".meta{font-size:10px;color:rgba(10,10,10,.3);margin-bottom:16px;letter-spacing:.02em}"
    +".spk{margin:0 -24px}"
    +".spk svg{display:block}"
    +".spk-l{display:flex;justify-content:space-between;font-size:9px;font-weight:600;color:rgba(10,10,10,.3);padding:5px 24px 20px;letter-spacing:.05em;text-transform:uppercase}"
    +".foot{background:#0a0a0a;padding:10px 24px;display:flex;align-items:center;justify-content:space-between}"
    +".fl{font-size:8px;color:rgba(255,255,255,.3);font-weight:600;letter-spacing:.06em;text-transform:uppercase}"
    +".fr{font-size:10px;font-weight:800;color:#22c55e}";

  var body=""
    +"<link href='https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap' rel='stylesheet'>"
    +"<div class='card'>"
    +"<div class='stripe'></div>"
    +"<div class='body'>"
    +"<div class='hdr'>"
    +"<div class='logo'><div class='icon'><div class='b1'></div><div class='b2'></div><div class='b3'></div></div><span class='wm'>sokoview</span></div>"
    +"<div class='badge'>"+(d.gain>=0?"Certified FOMO":"No Regrets")+"</div>"
    +"</div>"
    +"<div class='nar'>If you’d put TZS "+fmtS(d.invested)+" in "+d.stock.name+" in "+yr+"…</div>"
    +"<div class='rev'>today it would be worth</div>"
    +"<div class='money'>TZS <em>"+fmtS(d.currentValue)+"</em></div>"
    +"<div class='pills'>"
    +"<div class='pg'>"+sign+d.returnPct.toFixed(0)+"%</div>"
    +"<div class='pn'>"+mult+"× the money</div>"
    +"<div class='pn'>TZS "+fmtN(d.buyPrice)+" → "+fmtN(d.currentPrice)+"/share</div>"
    +"</div>"
    +"<div class='meta'>"+fmtN(d.shares)+" shares · "+d.startDate+" — Jun 2026</div>"
    +"<div class='spk'>"
    +"<svg viewBox='0 0 "+W+" "+H+"' width='"+W+"' height='"+H+"' preserveAspectRatio='none'>"
    +"<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>"
    +"<stop offset='0%' stop-color='#22c55e' stop-opacity='.18'/>"
    +"<stop offset='100%' stop-color='#22c55e' stop-opacity='0'/></linearGradient></defs>"
    +"<path d='"+area+"' fill='url(#g)'/>"
    +"<polyline points='"+pts+"' fill='none' stroke='#22c55e' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'/>"
    +"</svg>"
    +"<div class='spk-l'><span>"+yr+"</span><span>Jun 2026</span></div>"
    +"</div>"
    +"</div>"
    +"<div class='foot'>"
    +"<span class='fl'>Illustrative · Past ≠ future · Not advice</span>"
    +"<span class='fr'>sokoview.co.tz</span>"
    +"</div>"
    +"</div>";

  return "<!DOCTYPE html><html><head><meta charset='UTF-8'><style>"+css+"</style></head><body>"+body+"</body></html>";
}


// ── Logo ─────────────────────────────────────────────────────────
function LogoIcon(props) {
  var size = props.size || 28;
  var dark = props.dark || G.black;
  return (
    <div style={{width:size,height:size,background:dark,borderRadius:Math.round(size*0.22),
      display:"flex",alignItems:"flex-end",gap:"2px",
      padding:Math.round(size*0.15)+"px "+Math.round(size*0.18)+"px",
      boxSizing:"border-box",flexShrink:0}}>
      <div style={{width:Math.round(size*0.11),background:G.green,borderRadius:1,
        height:Math.round(size*0.19),alignSelf:"flex-end"}}/>
      <div style={{width:Math.round(size*0.11),background:G.green,borderRadius:1,
        height:Math.round(size*0.30),alignSelf:"flex-end"}}/>
      <div style={{width:Math.round(size*0.11),background:G.green,borderRadius:1,
        height:Math.round(size*0.45),alignSelf:"flex-end"}}/>
    </div>
  );
}

function Logo() {
  return (
    <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
      <LogoIcon size={28}/>
      <span style={{fontSize:15,fontWeight:800,color:G.black,letterSpacing:"-.4px"}}>sokoview</span>
    </div>
  );
}

// ── Disclaimer ────────────────────────────────────────────────────
function Disclaimer(props) {
  if (!props.open) return null;
  return (
    <div onClick={props.onClose} style={{position:"fixed",inset:0,zIndex:300,
      background:"rgba(10,10,10,.55)",display:"flex",alignItems:"center",
      justifyContent:"center",padding:24}}>
      <div onClick={function(e){e.stopPropagation();}}
        style={{background:G.white,maxWidth:420,width:"100%",padding:36,
          boxShadow:"0 40px 100px rgba(0,0,0,.25)"}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",
          color:G.green,textTransform:"uppercase",marginBottom:12}}>Disclaimer</div>
        <p style={{fontSize:14,lineHeight:1.75,color:G.black,marginBottom:20}}>
          This tool is for illustrative purposes only. Past performance is not indicative
          of future results. This is not financial advice. Consult a licensed financial
          advisor before making investment decisions.
        </p>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",
          color:G.muted,textTransform:"uppercase",marginBottom:8}}>Data Sources</div>
        <p style={{fontSize:13,lineHeight:1.7,color:G.muted,marginBottom:24}}>
          Live prices via Sokoview API (sokoview.co.tz)<br/>
          Historical prices via African Markets (african-markets.com)<br/>
          Coverage: June 2018 — present
        </p>
        <button onClick={props.onClose}
          style={{width:"100%",padding:"13px 0",background:G.black,
            color:G.white,border:"none",fontSize:12,fontWeight:700,
            cursor:"pointer",letterSpacing:".06em"}}>CLOSE</button>
      </div>
    </div>
  );
}

// ── Story slides ──────────────────────────────────────────────────
var SLIDES = ["invested","bought","shares","multiply","share"];

function CountUp(props) {
  var [val, setVal] = useState(0);
  var target = props.target, duration = props.duration || 2000;
  var start = useRef(null), raf = useRef(null);
  useEffect(function(){
    start.current = null;
    function tick(ts) {
      if (!start.current) start.current = ts;
      var p = Math.min((ts-start.current)/duration,1);
      setVal(Math.round(p*target));
      if (p<1) raf.current=requestAnimationFrame(tick);
    }
    raf.current=requestAnimationFrame(tick);
    return function(){cancelAnimationFrame(raf.current);};
  },[target,duration]);
  return props.render(val);
}

function StoryPlayer(props) {
  var data=props.data, onRestart=props.onRestart;
  var [cur,setCur]=useState(0);
  var [prog,setProg]=useState(0);
  var [copied,setCopied]=useState(false);
  var raf=useRef(null), t0=useRef(null);
  var isLast=cur===SLIDES.length-1;
  var DURS={invested:3500,bought:3500,shares:4000,multiply:5000,share:99999};

  var advance=useCallback(function(){
    setCur(function(c){return c<SLIDES.length-1?c+1:c;});
    setProg(0); t0.current=null;
  },[]);

  function goBack(){if(cur>0){setCur(function(c){return c-1;});setProg(0);t0.current=null;}}

  useEffect(function(){
    if(isLast){cancelAnimationFrame(raf.current);return;}
    var dur=DURS[SLIDES[cur]]||3500;
    function tick(ts){
      if(!t0.current)t0.current=ts;
      var p=Math.min((ts-t0.current)/dur,1);
      setProg(p);
      if(p<1)raf.current=requestAnimationFrame(tick); else advance();
    }
    raf.current=requestAnimationFrame(tick);
    return function(){cancelAnimationFrame(raf.current);};
  },[cur,isLast,advance]);

  function handleTap(e){
    if(isLast)return;
    var x=e.clientX||(e.touches&&e.touches[0]?e.touches[0].clientX:0);
    if(x<e.currentTarget.offsetWidth*.35) goBack(); else advance();
  }

  var slide=SLIDES[cur];
  var yr=data.startDate.slice(0,4);
  var sign=data.gain>=0?"+":"";
  var mult=(data.currentValue/data.invested).toFixed(1);
  var html=buildCardHTML(data);

  function downloadCard(){
    var blob=new Blob([html],{type:"text/html"});
    var url=URL.createObjectURL(blob);
    var a=document.createElement("a");
    a.href=url; a.download="sokoview-fomo-"+data.ticker+".html"; a.click();
    URL.revokeObjectURL(url);
  }
  function copyLink(){
    navigator.clipboard.writeText(window.location.href).then(function(){
      setCopied(true); setTimeout(function(){setCopied(false);},2000);
    });
  }

  // Slide backgrounds — subtle
  var LABEL = {
    invested:"You had",
    bought:"Instead, you bought",
    shares:"Your money could have bought",
    multiply:"By June 2026, that would be",
    share:"Your card",
  };

  return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",
      background:G.white}} onClick={handleTap}>

      {/* Progress bars */}
      <div style={{display:"flex",gap:3,padding:"10px 14px 8px",flexShrink:0}}>
        {SLIDES.map(function(s,i){
          var fill=i<cur?1:i===cur?prog:0;
          return (
            <div key={s} style={{flex:1,height:2,background:G.border,overflow:"hidden"}}>
              <div style={{height:"100%",background:G.green,width:(fill*100)+"%"}}/>
            </div>
          );
        })}
      </div>

      {/* Step label */}
      <div style={{padding:"0 20px 0",flexShrink:0}}>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:".1em",
          color:G.green,textTransform:"uppercase"}}>{LABEL[slide]}</div>
      </div>

      {/* Slide content */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
        padding:"20px 24px",overflow:"hidden"}}>

        {slide==="invested" && (
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:72,fontWeight:800,color:G.black,
              letterSpacing:"-4px",lineHeight:1}}>
              TZS {fmtS(data.invested)}
            </div>
            <div style={{fontSize:15,color:G.muted,marginTop:14,fontWeight:500}}>
              back in {yr}
            </div>
          </div>
        )}

        {slide==="bought" && (
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:38,fontWeight:800,color:G.black,
              letterSpacing:"-1.5px",lineHeight:1.1,marginBottom:8}}>
              {data.comparison.label}
            </div>
            <div style={{fontSize:13,color:G.muted,marginBottom:28}}>{data.comparison.sub}</div>
            <div style={{width:40,height:1,background:G.border,margin:"0 auto 28px"}}/>
            <div style={{fontSize:13,color:G.muted,marginBottom:6}}>instead of</div>
            <div style={{fontSize:22,fontWeight:800,color:G.green}}>{data.stock.name}</div>
          </div>
        )}

        {slide==="shares" && (
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:11,fontWeight:600,color:G.muted,letterSpacing:".06em",
              textTransform:"uppercase",marginBottom:16}}>
              TZS {fmtS(data.invested)} would have bought
            </div>
            <div style={{fontSize:76,fontWeight:800,color:G.black,
              letterSpacing:"-4px",lineHeight:1}}>
              {fmtN(data.shares)}
            </div>
            <div style={{fontSize:16,fontWeight:700,color:G.green,marginTop:8}}>
              {data.stock.name} shares
            </div>
            <div style={{fontSize:13,color:G.muted,marginTop:4}}>
              at TZS {fmtN(data.buyPrice)} per share
            </div>
          </div>
        )}

        {slide==="multiply" && (
          <div style={{textAlign:"center"}} onClick={function(e){e.stopPropagation();}}>
            <CountUp target={data.currentValue} duration={3500} render={function(v){
              return (
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:G.muted,letterSpacing:".06em",
                    textTransform:"uppercase",marginBottom:12}}>
                    {data.stock.symbol} · {data.shares} shares · Jun 2026
                  </div>
                  <div style={{fontSize:56,fontWeight:800,color:G.black,
                    letterSpacing:"-3px",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>
                    TZS {fmtN(v)}
                  </div>
                  <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:16,flexWrap:"wrap"}}>
                    <div style={{background:G.green,color:"#052e16",
                      fontSize:12,fontWeight:700,padding:"6px 16px"}}>
                      {sign}{data.returnPct.toFixed(0)}%
                    </div>
                    <div style={{background:"#f4f4f4",color:G.black,
                      fontSize:12,fontWeight:600,padding:"6px 16px"}}>
                      {mult}x the money
                    </div>
                  </div>
                </div>
              );
            }}/>
          </div>
        )}

        {slide==="share" && (
          <div style={{width:"100%",display:"flex",flexDirection:"column",
            gap:0,height:"100%"}} onClick={function(e){e.stopPropagation();}}>

            {/* Card preview — scaled to fit */}
            <div style={{flex:1,display:"flex",alignItems:"center",
              justifyContent:"center",overflow:"hidden",minHeight:0,padding:"0 0 8px"}}>
              <div style={{
                width:"100%",maxWidth:375,
                boxShadow:"0 8px 32px rgba(0,0,0,.12)",
                overflow:"hidden",flexShrink:0,
              }}>
                <iframe srcDoc={html}
                  style={{width:375,height:480,border:"none",
                    display:"block",
                    transform:"scale("+Math.min(1,(320/375))+")",
                    transformOrigin:"top left",
                    marginBottom:-(480*(1-Math.min(1,(320/375))))+"px"}}
                  scrolling="no" title="Share card"/>
              </div>
            </div>

            {/* Primary actions */}
            <div style={{display:"flex",gap:6,flexShrink:0,marginBottom:6}}>
              <button onClick={copyLink} style={{flex:1,padding:"11px 0",
                background:copied?G.green:"#f4f4f4",
                color:copied?G.white:G.black,
                border:"none",fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:".04em"}}>
                {copied?"COPIED":"COPY LINK"}
              </button>
              <button onClick={downloadCard} style={{flex:1,padding:"11px 0",
                background:G.green,color:G.white,
                border:"none",fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:".04em"}}>
                SAVE CARD
              </button>
            </div>

            {/* Social share buttons */}
            <div style={{display:"flex",gap:6,flexShrink:0,marginBottom:6}}>
              <a href={"https://wa.me/?text="+encodeURIComponent("What if I’d invested in "+data.stock.name+"? TZS "+fmtS(data.currentValue)+" today! via sokoview.co.tz")}
                target="_blank" rel="noopener noreferrer"
                style={{flex:1,padding:"10px 0",
                  background:"#25D366",color:G.white,textDecoration:"none",
                  fontSize:11,fontWeight:700,letterSpacing:".04em",
                  textAlign:"center",display:"block"}}>
                WHATSAPP
              </a>
              <a href={"https://twitter.com/intent/tweet?text="+encodeURIComponent("If I’d invested TZS "+fmtS(data.invested)+" in "+data.stock.name+" in "+data.startDate.slice(0,4)+", I’d have TZS "+fmtS(data.currentValue)+" today. "+data.returnPct.toFixed(0)+"% return. #DSE #Sokoview sokoview.co.tz")}
                target="_blank" rel="noopener noreferrer"
                style={{flex:1,padding:"10px 0",
                  background:"#1DA1F2",color:G.white,textDecoration:"none",
                  fontSize:11,fontWeight:700,letterSpacing:".04em",
                  textAlign:"center",display:"block"}}>
                TWITTER / X
              </a>
              <a href={"https://www.linkedin.com/sharing/share-offsite/?url="+encodeURIComponent("https://sokoview.co.tz")}
                target="_blank" rel="noopener noreferrer"
                style={{flex:1,padding:"10px 0",
                  background:"#0A66C2",color:G.white,textDecoration:"none",
                  fontSize:11,fontWeight:700,letterSpacing:".04em",
                  textAlign:"center",display:"block"}}>
                LINKEDIN
              </a>
            </div>

            {/* Start over */}
            <button onClick={function(e){e.stopPropagation();onRestart();}}
              style={{width:"100%",padding:"11px 0",flexShrink:0,
              background:"#f4f4f4",color:G.muted,
              border:"none",fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:".04em"}}>
              START OVER
            </button>
          </div>
        )}
      </div>

      {/* Tap hint */}
      {!isLast && (
        <div style={{padding:"0 20px 10px",flexShrink:0,display:"flex",justifyContent:"center"}}>
          <div style={{fontSize:9,fontWeight:600,color:G.border,letterSpacing:".06em",textTransform:"uppercase"}}>
            tap to continue
          </div>
        </div>
      )}
    </div>
  );
}

// ── Setup form ────────────────────────────────────────────────────
function SetupForm(props) {
  var [ticker,    setTicker]    = useState("CRDB");
  var [year,      setYear]      = useState(2020);
  var [month,     setMonth]     = useState(1);
  var [amount,    setAmount]    = useState(1000000);
  var [compId,    setCompId]    = useState(COMPARISONS[0].id);
  var [livePrice, setLivePrice] = useState(null);
  var [loading,   setLoading]   = useState(false);
  var [error,     setError]     = useState(null);
  var [phase,     setPhase]     = useState("form"); // "form" | "story"
  var [storyData, setStoryData] = useState(null);

  var selectedStock = DSE_STOCKS.find(function(s){return s.symbol===ticker;})||DSE_STOCKS[0];
  var selectedComp  = COMPARISONS.find(function(c){return c.id===compId;})||COMPARISONS[0];

  var YEARS  = [];
  for (var y=MIN_YEAR; y<=MAX_YEAR-1; y++) YEARS.push(y);

  // Clamp month to available data (Jun 2018 is earliest)
  var minMonth = year===MIN_YEAR ? 6 : 1;
  var maxMonth = year===(new Date().getFullYear()) ? new Date().getMonth()+1 : 12;

  useEffect(function(){
    fetchLivePrice(ticker).then(function(d){setLivePrice(d&&d.price?d:null);});
  },[ticker]);

  // Clamp month when year changes
  useEffect(function(){
    if (month < minMonth) setMonth(minMonth);
    if (month > maxMonth) setMonth(maxMonth);
  },[year]);

  function getStartDate() {
    var m = String(month).padStart(2,"0");
    return year+"-"+m+"-01";
  }

  function launch() {
    setError(null); setLoading(true);
    var startDate = getStartDate();
    fetchPrices(ticker, startDate).then(function(prices) {
      if (!prices||prices.length<5) throw new Error("Not enough data for this date.");
      var buyPrice=prices[0].price, currentPrice=prices[prices.length-1].price;
      var shares=Math.floor(amount/buyPrice);
      if (shares<1) throw new Error("Amount too low for this stock.");
      var invested=shares*buyPrice, currentValue=shares*currentPrice;
      var gain=currentValue-invested, returnPct=(gain/invested)*100;
      var monthly=[],lastM="";
      prices.forEach(function(p){var m=p.date.slice(0,7);if(m!==lastM){monthly.push(p);lastM=m;}});
      setStoryData({
        ticker, stock:selectedStock, comparison:selectedComp,
        startDate, amount, invested, shares, buyPrice,
        currentPrice, currentValue, gain, returnPct, monthly,
      });
      setPhase("story");
    }).catch(function(e){setError(e.message);}).finally(function(){setLoading(false);});
  }

  function restart(){setPhase("form");setStoryData(null);}

  var BTN = function(active, onClick, children, style) {
    return (
      <button onClick={onClick} style={{
        padding:"7px 10px", fontSize:11, fontWeight:700,
        background: active ? G.black : "#f4f4f4",
        color: active ? G.white : G.black,
        border: "none", cursor:"pointer",
        letterSpacing:".02em", lineHeight:1,
        ...style,
      }}>{children}</button>
    );
  };

  var AMOUNTS = [500000,1000000,2000000,5000000];

  var LAB = function(txt) {
    return <div style={{fontSize:9,fontWeight:700,letterSpacing:".1em",
      color:G.muted,textTransform:"uppercase",marginBottom:8,marginTop:16}}>{txt}</div>;
  };

  if (phase==="story" && storyData) {
    return (
      <div style={{width:"100%",height:"100%"}}>
        <StoryPlayer data={storyData} onRestart={restart}/>
      </div>
    );
  }

  return (
    <div style={{padding:"20px 20px 20px",height:"100%",overflowY:"auto",
      display:"flex",flexDirection:"column"}}>

      {/* Bank selector */}
      {LAB("1 · Pick a bank")}
      <div style={{display:"flex",gap:4}}>
        {DSE_STOCKS.map(function(s){
          return BTN(s.symbol===ticker, function(){setTicker(s.symbol);}, s.symbol, {flex:1});
        })}
      </div>
      <div style={{fontSize:11,color:G.muted,marginTop:6}}>
        {selectedStock.name}
        {livePrice && (
          <span style={{color:G.greenDark,fontWeight:700}}> · TZS {fmtN(livePrice.price)} today</span>
        )}
      </div>

      {/* Year selector */}
      {LAB("2 · Year")}
      <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
        {YEARS.map(function(y){
          return BTN(y===year, function(){setYear(y);}, String(y), {marginBottom:3});
        })}
      </div>

      {/* Month selector */}
      {LAB("3 · Month")}
      <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
        {MONTHS.map(function(m,i){
          var num=i+1;
          var disabled = num<minMonth || num>maxMonth;
          return (
            <button key={m} onClick={function(){if(!disabled)setMonth(num);}}
              disabled={disabled}
              style={{padding:"7px 8px",fontSize:11,fontWeight:700,
                background:num===month?G.black:(disabled?"#f8f8f8":"#f4f4f4"),
                color:num===month?G.white:(disabled?G.border:G.black),
                border:"none",cursor:disabled?"default":"pointer",
                letterSpacing:".02em",marginBottom:3,
                opacity:disabled?.4:1}}>
              {m}
            </button>
          );
        })}
      </div>

      {/* Amount */}
      {LAB("4 · Amount (TZS)")}
      <div style={{display:"flex",gap:4}}>
        {AMOUNTS.map(function(a){
          return BTN(a===amount, function(){setAmount(a);},
            a>=1000000?(a/1000000)+"M":(a/1000)+"K", {flex:1});
        })}
      </div>

      {/* Comparison */}
      {LAB("5 · Instead of buying")}
      <select value={compId} onChange={function(e){setCompId(e.target.value);}}
        style={{width:"100%",padding:"9px 10px",border:"1px solid "+G.border,
          fontSize:12,color:G.black,background:G.white,outline:"none",
          fontFamily:G.font,cursor:"pointer"}}>
        {COMPARISONS.map(function(c){
          return <option key={c.id} value={c.id}>{c.label} — TZS {fmtN(c.price)}</option>;
        })}
      </select>

      {error && (
        <div style={{marginTop:10,padding:"9px 12px",background:"#fef2f2",
          border:"1px solid #fca5a5",fontSize:12,color:"#dc2626"}}>{error}</div>
      )}

      <button onClick={launch} disabled={loading}
        style={{marginTop:"auto",paddingTop:16,width:"100%",padding:"14px 0",
          background:loading?"#f4f4f4":G.black,
          color:loading?G.muted:G.white,
          border:"none",fontSize:12,fontWeight:700,
          cursor:loading?"not-allowed":"pointer",
          letterSpacing:".06em"}}>
        {loading?"CALCULATING...":"SHOW MY FOMO"}
      </button>
    </div>
  );
}

// ── Left copy panel ───────────────────────────────────────────────
function LeftCopy() {
  return (
    <div style={{padding:"0 40px",maxWidth:380,margin:"0 auto"}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:".12em",
        color:G.green,textTransform:"uppercase",marginBottom:14}}>
        DSE · Long-term investing
      </div>
      <h1 style={{fontSize:44,fontWeight:800,color:G.black,
        letterSpacing:"-2px",lineHeight:1.05,marginBottom:20}}>
        It&rsquo;s just<br/>a matter<br/>of time.
      </h1>
      <p style={{fontSize:15,color:G.muted,lineHeight:1.75,maxWidth:320}}>
        See what long-term investing in Tanzania&rsquo;s banking sector
        could have got you. Pick a bank, pick a date, see the numbers.
      </p>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────
export default function App() {
  var [discOpen, setDiscOpen] = useState(false);
  var isMobile = window.innerWidth < 768;

  return (
    <div style={{fontFamily:G.font,background:G.white,minHeight:"100vh",
      display:"flex",flexDirection:"column"}}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet"/>

      {/* Header */}
      <header style={{height:56,borderBottom:"1px solid "+G.border,
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 24px",flexShrink:0,position:"sticky",top:0,
        background:G.white,zIndex:20}}>
        <Logo/>
        <button onClick={function(){setDiscOpen(true);}}
          style={{background:"none",border:"1px solid "+G.border,
            padding:"6px 14px",fontSize:10,fontWeight:700,
            color:G.muted,cursor:"pointer",letterSpacing:".08em"}}>
          DISCLAIMER
        </button>
      </header>

      {/* Body */}
      <div style={{flex:1,display:"flex",alignItems:"stretch",position:"relative"}}>

        {/* Left copy — desktop only */}
        {!isMobile && (
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"flex-end"}}>
            <LeftCopy/>
          </div>
        )}

        {/* Center card generator */}
        <div style={{
          width: isMobile ? "100%" : 360,
          flexShrink:0,
          borderLeft:  isMobile ? "none" : "1px solid "+G.border,
          borderRight: isMobile ? "none" : "1px solid "+G.border,
          display:"flex",flexDirection:"column",
          minHeight: isMobile ? "auto" : "calc(100vh - 56px - 52px)",
        }}>
          {isMobile && (
            <div style={{padding:"28px 20px 0"}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",
                color:G.green,textTransform:"uppercase",marginBottom:10}}>FOMO Calculator</div>
              <h1 style={{fontSize:30,fontWeight:800,color:G.black,
                letterSpacing:"-1.2px",lineHeight:1.1,marginBottom:6}}>
                It&rsquo;s just a matter of time.
              </h1>
              <p style={{fontSize:14,color:G.muted,lineHeight:1.6,marginBottom:0}}>
                See what long-term DSE investing could have got you.
              </p>
            </div>
          )}
          <SetupForm/>
        </div>

        {/* Right spacer — desktop */}
        {!isMobile && <div style={{flex:1}}/>}
      </div>

      {/* Footer */}
      <footer style={{height:52,borderTop:"1px solid "+G.border,
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 24px",flexShrink:0}}>
        <Logo/>
        <span style={{fontSize:11,color:G.muted,fontWeight:600}}>
          sokoview.co.tz · Track your DSE portfolio
        </span>
      </footer>

      <Disclaimer open={discOpen} onClose={function(){setDiscOpen(false);}}/>
    </div>
  );
}
