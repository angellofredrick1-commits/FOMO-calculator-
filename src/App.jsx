import { useState, useEffect, useRef, useCallback } from "react";

// ── Sokoview API (live prices via Netlify proxy) ───────────────
async function fetchLivePrice(symbol) {
  try {
    var res = await fetch("/.netlify/functions/prices?symbol=" + symbol.toUpperCase());
    if (!res.ok) throw new Error("prices proxy " + res.status);
    return res.json();
  } catch(e) {
    console.warn("fetchLivePrice failed:", e.message);
    return null;
  }
}

// ── Historical prices (African Markets data via Netlify proxy) ──
async function fetchHistoricalPrices(symbol, startDate) {
  try {
    var res = await fetch("/.netlify/functions/history?symbol=" + symbol + "&from=" + startDate);
    if (!res.ok) throw new Error("history proxy " + res.status);
    var data = res.json();
    return data;
  } catch(e) {
    console.warn("fetchHistoricalPrices failed:", e.message);
    return null;
  }
}

// ── Simulation fallback (real anchors from African Markets) ─────
var PRICE_HISTORY = {
  CRDB:  {"2018":160,"2019":150,"2020":95,"2021":195,"2022":280,"2023":380,"2024":460,"2025":670,"2026":2570},
  NMB:   {"2018":2750,"2019":2340,"2020":2340,"2021":2340,"2022":2000,"2023":3100,"2024":4500,"2025":5350,"2026":8590},
  MKCB:  {"2018":800,"2019":800,"2020":780,"2021":780,"2022":780,"2023":780,"2024":630,"2025":540,"2026":3040},
  DCB:   {"2018":340,"2019":340,"2020":295,"2021":265,"2022":190,"2023":150,"2024":140,"2025":135,"2026":240},
};

function interpolatePrice(anchors, dateStr) {
  var year = parseInt(dateStr.slice(0,4));
  var month = parseInt(dateStr.slice(5,7));
  var years = Object.keys(anchors).map(Number).sort(function(a,b){return a-b;});
  if (year <= years[0]) return anchors[String(years[0])];
  if (year >= years[years.length-1]) return anchors[String(years[years.length-1])];
  var y0 = years[0], y1 = years[1];
  for (var i=0; i<years.length-1; i++) {
    if (years[i] <= year && year < years[i+1]) { y0=years[i]; y1=years[i+1]; break; }
  }
  var p0 = anchors[String(y0)];
  var p1 = anchors[String(y1)];
  var frac = (year - y0 + (month-1)/12) / (y1 - y0);
  return Math.round(p0 + (p1 - p0) * frac);
}

function simulatePrices(symbol, startDate) {
  var anchors = PRICE_HISTORY[symbol] || {"2018":500,"2026":800};
  var start = new Date(startDate), end = new Date();
  var days  = Math.ceil((end - start) / 86400000);
  var seed  = symbol.charCodeAt(0) * 1000 + (symbol.charCodeAt(1)||0);
  var rand  = function() { seed=(seed*1664525+1013904223)&0xffffffff; return(seed>>>0)/0xffffffff; };
  var out = [], prev = null;
  for (var i=0; i<=days; i++) {
    var d = new Date(start.getTime() + i*86400000);
    if (d.getDay()===0||d.getDay()===6) continue;
    var dateStr = d.toISOString().split("T")[0];
    var base    = interpolatePrice(anchors, dateStr);
    var noise   = (rand()-0.5)*0.016;
    var price   = Math.round(base*(1+noise));
    if (prev !== null) {
      var cap = prev*0.03;
      price = Math.max(prev-cap, Math.min(prev+cap, price));
    }
    price = Math.max(price, 10);
    prev  = price;
    out.push({ date: dateStr, price: price });
  }
  return out;
}

async function fetchPrices(symbol, startDate) {
  var prices = await fetchHistoricalPrices(symbol, startDate);
  if (!prices || !Array.isArray(prices) || prices.length < 5) {
    prices = simulatePrices(symbol, startDate);
  }
  // Snap last point to live price
  try {
    var live = await fetchLivePrice(symbol);
    if (live && live.price) {
      var today = new Date().toISOString().split("T")[0];
      prices[prices.length-1] = { date: today, price: Math.round(live.price) };
    }
  } catch(e) {}
  return prices;
}

// ── Stocks & comparisons ────────────────────────────────────────
var DSE_STOCKS = [
  {symbol:"CRDB", name:"CRDB Bank",                sector:"Banking"},
  {symbol:"NMB",  name:"NMB Bank",                 sector:"Banking"},
  {symbol:"MKCB", name:"Mkombozi Commercial Bank",  sector:"Banking"},
  {symbol:"DCB",  name:"DCB Commercial Bank",       sector:"Banking"},
];

var COMPARISONS = [
  {id:"phone_mid",  label:"Mid-range phone",   sub:"Samsung A55, Tecno Camon",  price:850000},
  {id:"phone_flag", label:"Flagship phone",    sub:"Samsung S24, iPhone 15",    price:2800000},
  {id:"laptop",     label:"Laptop",            sub:"HP, Lenovo, Dell",          price:1800000},
  {id:"tv",         label:"Smart TV 43\"",     sub:"Samsung, LG, TCL",          price:1200000},
  {id:"fridge",     label:"Refrigerator",      sub:"250L double-door",          price:1500000},
  {id:"rent",       label:"6 months rent",     sub:"1-bed, Kinondoni DSM",      price:3600000},
  {id:"car",        label:"Car down payment",  sub:"Toyota Vitz deposit",       price:5000000},
  {id:"school",     label:"School fees 1yr",   sub:"Private secondary school",  price:1400000},
  {id:"solar",      label:"Solar system",      sub:"300W home system",          price:2200000},
  {id:"vacation",   label:"Zanzibar vacation", sub:"5 nights + flights",        price:2000000},
];

// ── Formatters ──────────────────────────────────────────────────
function fmtN(n) { return new Intl.NumberFormat("en-TZ").format(Math.round(n)); }
function fmtS(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1)+"M";
  if (n >= 1000)    return Math.round(n/1000)+"K";
  return String(Math.round(n));
}

// ── Design tokens ───────────────────────────────────────────────
var G = {
  green:      "#22c55e",
  greenDark:  "#15803d",
  greenBg:    "rgba(34,197,94,.08)",
  greenBorder:"rgba(34,197,94,.25)",
  black:      "#0a0a0a",
  white:      "#ffffff",
  muted:      "rgba(10,10,10,.45)",
  border:     "rgba(10,10,10,.1)",
  font:       "'Sora', system-ui, sans-serif",
};

// ── Share card HTML ─────────────────────────────────────────────
function buildCardHTML(d) {
  var pos   = d.gain >= 0;
  var yr    = d.startDate.slice(0,4);
  var sign  = pos ? "+" : "";
  var mult  = (d.currentValue/d.invested).toFixed(1);

  var W=500, H=90;
  var vals = d.monthly.map(function(p){return p.price;});
  var mn = Math.min.apply(null,vals), mx = Math.max.apply(null,vals);
  var pts = d.monthly.map(function(p,i){
    var x=(i/(d.monthly.length-1))*W;
    var y=H-((p.price-mn)/(mx-mn||1))*(H-12)-6;
    return x.toFixed(1)+","+y.toFixed(1);
  }).join(" ");
  var area="M"+pts.replace(/ /g," L")+" L"+W+","+H+" L0,"+H+" Z";

  var css=""
    +"*{margin:0;padding:0;box-sizing:border-box}"
    +"@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap');"
    +"body{background:#f0f0f0;display:flex;justify-content:center;padding:32px;font-family:'Sora',system-ui,sans-serif}"
    +".card{width:480px;background:#fff;border-radius:0;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.15)}"
    +".bar{height:5px;background:#22c55e}"
    +".body{padding:32px 32px 0}"
    +".logo-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}"
    +".logo{display:flex;align-items:center;gap:8px}"
    +".icon{width:28px;height:28px;background:#0a0a0a;border-radius:6px;display:flex;align-items:flex-end;gap:2px;padding:4px 5px}"
    +".b1,.b2,.b3{width:3px;border-radius:1px;background:#22c55e}"
    +".b1{height:5px}.b2{height:8px}.b3{height:12px}"
    +".wordmark{font-size:14px;font-weight:800;color:#0a0a0a;letter-spacing:-.4px}"
    +".badge{font-size:9px;font-weight:700;letter-spacing:.1em;color:#15803d;border:1.5px solid #22c55e;padding:4px 12px;text-transform:uppercase}"
    +".narrative{font-size:13px;color:rgba(10,10,10,.5);margin-bottom:4px}"
    +".reveal{font-size:13px;font-style:italic;color:rgba(10,10,10,.5);margin-bottom:10px}"
    +".money{font-size:56px;font-weight:800;color:#0a0a0a;letter-spacing:-3px;line-height:1;margin-bottom:12px}"
    +".money span{color:#22c55e}"
    +".pills{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}"
    +".pill-g{background:#22c55e;color:#052e16;font-size:11px;font-weight:700;padding:5px 14px}"
    +".pill-n{background:#f4f4f4;color:#0a0a0a;font-size:11px;font-weight:600;padding:5px 14px}"
    +".sub{font-size:12px;color:rgba(10,10,10,.45);margin-bottom:20px;line-height:1.5}"
    +".sub strong{color:#0a0a0a;font-weight:700}"
    +".spk{margin:0 -32px}"
    +".spk-labels{display:flex;justify-content:space-between;font-size:9px;font-weight:600;color:rgba(10,10,10,.35);padding:6px 32px 24px;letter-spacing:.04em;text-transform:uppercase}"
    +".foot{background:#0a0a0a;padding:12px 32px;display:flex;align-items:center;justify-content:space-between;margin-top:0}"
    +".fl{font-size:9px;color:rgba(255,255,255,.35);font-weight:600;letter-spacing:.06em;text-transform:uppercase}"
    +".fr{font-size:11px;font-weight:800;color:#22c55e}";

  var body=""
    +"<div class='card'>"
    +"<div class='bar'></div>"
    +"<div class='body'>"
    +"<div class='logo-row'>"
    +"<div class='logo'>"
    +"<div class='icon'><div class='b1'></div><div class='b2'></div><div class='b3'></div></div>"
    +"<span class='wordmark'>sokoview</span>"
    +"</div>"
    +"<div class='badge'>"+(pos?"Certified FOMO":"No Regrets")+"</div>"
    +"</div>"
    +"<div class='narrative'>If you\u2019d put TZS "+fmtS(d.invested)+" in "+d.stock.name+" in "+yr+"\u2026</div>"
    +"<div class='reveal'>today it would be worth</div>"
    +"<div class='money'>TZS <span>"+fmtS(d.currentValue)+"</span></div>"
    +"<div class='pills'>"
    +"<div class='pill-g'>"+sign+d.returnPct.toFixed(0)+"%</div>"
    +"<div class='pill-n'>"+mult+"\xd7 the money</div>"
    +"<div class='pill-n'>TZS "+fmtN(d.buyPrice)+" \u2192 "+fmtN(d.currentPrice)+"/share</div>"
    +"</div>"
    +"<div class='sub'>"+fmtN(d.shares)+" shares \u00b7 bought at TZS "+fmtN(d.buyPrice)+" \u00b7 "+d.startDate+"</div>"
    +"<div class='spk'>"
    +"<svg viewBox='0 0 "+W+" "+H+"' width='100%' height='"+H+"' style='display:block' preserveAspectRatio='none'>"
    +"<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>"
    +"<stop offset='0%' stop-color='#22c55e' stop-opacity='.2'/>"
    +"<stop offset='100%' stop-color='#22c55e' stop-opacity='0'/></linearGradient></defs>"
    +"<path d='"+area+"' fill='url(#g)'/>"
    +"<polyline points='"+pts+"' fill='none' stroke='#22c55e' stroke-width='2.5' stroke-linejoin='round' stroke-linecap='round'/>"
    +"</svg>"
    +"<div class='spk-labels'><span>"+yr+"</span><span>Jun 2026</span></div>"
    +"</div>"
    +"</div>"
    +"<div class='foot'>"
    +"<span class='fl'>Illustrative \u00b7 Past \u2260 future \u00b7 Not advice</span>"
    +"<span class='fr'>sokoview.co.tz</span>"
    +"</div>"
    +"</div>";

  return "<!DOCTYPE html><html><head><meta charset='UTF-8'>"
    +"<link href='https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap' rel='stylesheet'>"
    +"<style>"+css+"</style></head><body>"+body+"</body></html>";
}

// ── Story slides ────────────────────────────────────────────────
var SLIDES = ["invested","bought","shares","multiply","share"];

function StoryPlayer(props) {
  var data = props.data, onRestart = props.onRestart;
  var [cur,  setCur]  = useState(0);
  var [prog, setProg] = useState(0);
  var [count, setCount] = useState(0);
  var raf   = useRef(null);
  var t0    = useRef(null);
  var isLast = cur === SLIDES.length - 1;

  var DURATIONS = {invested:3500, bought:3500, shares:4000, multiply:4500, share:99999};

  var advance = useCallback(function() {
    setCur(function(c){ return c < SLIDES.length-1 ? c+1 : c; });
    setProg(0); setCount(0); t0.current = null;
  }, []);

  function goBack() {
    if (cur > 0) { setCur(function(c){return c-1;}); setProg(0); setCount(0); t0.current=null; }
  }

  useEffect(function() {
    if (isLast) { cancelAnimationFrame(raf.current); return; }
    var dur = DURATIONS[SLIDES[cur]] || 3500;
    function tick(ts) {
      if (!t0.current) t0.current = ts;
      var p = Math.min((ts-t0.current)/dur, 1);
      setProg(p);
      // counting animation for multiply slide
      if (SLIDES[cur]==="multiply") {
        setCount(Math.round(p * data.currentValue));
      }
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else advance();
    }
    raf.current = requestAnimationFrame(tick);
    return function() { cancelAnimationFrame(raf.current); };
  }, [cur, isLast, advance]);

  function handleTap(e) {
    var x = e.clientX||(e.touches&&e.touches[0]?e.touches[0].clientX:0);
    if (x < e.currentTarget.offsetWidth*.35) goBack(); else advance();
  }

  var slide = SLIDES[cur];
  var yr    = data.startDate.slice(0,4);
  var sign  = data.gain >= 0 ? "+" : "";
  var mult  = (data.currentValue/data.invested).toFixed(1);

  function SlideContent() {
    if (slide === "invested") return (
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:13,fontWeight:600,color:G.muted,letterSpacing:".06em",textTransform:"uppercase",marginBottom:16}}>You had</div>
        <div style={{fontSize:72,fontWeight:800,color:G.black,letterSpacing:"-4px",lineHeight:1}}>TZS {fmtS(data.invested)}</div>
        <div style={{fontSize:16,color:G.muted,marginTop:12}}>back in {yr}</div>
      </div>
    );
    if (slide === "bought") return (
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:13,fontWeight:600,color:G.muted,letterSpacing:".06em",textTransform:"uppercase",marginBottom:16}}>You bought a</div>
        <div style={{fontSize:36,fontWeight:800,color:G.black,letterSpacing:"-1.5px",lineHeight:1.1}}>{data.comparison.label}</div>
        <div style={{fontSize:14,color:G.muted,marginTop:8}}>{data.comparison.sub}</div>
        <div style={{marginTop:28,paddingTop:28,borderTop:"1px solid "+G.border}}>
          <div style={{fontSize:13,color:G.muted}}>instead of buying</div>
          <div style={{fontSize:24,fontWeight:800,color:G.green,marginTop:4}}>{data.stock.name}</div>
        </div>
      </div>
    );
    if (slide === "shares") return (
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:13,fontWeight:600,color:G.muted,letterSpacing:".06em",textTransform:"uppercase",marginBottom:16}}>Your TZS {fmtS(data.invested)} could have bought</div>
        <div style={{fontSize:72,fontWeight:800,color:G.black,letterSpacing:"-3px",lineHeight:1}}>{fmtN(data.shares)}</div>
        <div style={{fontSize:16,color:G.green,fontWeight:700,marginTop:8}}>{data.stock.name} shares</div>
        <div style={{fontSize:14,color:G.muted,marginTop:4}}>at TZS {fmtN(data.buyPrice)} per share</div>
      </div>
    );
    if (slide === "multiply") return (
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:13,fontWeight:600,color:G.muted,letterSpacing:".06em",textTransform:"uppercase",marginBottom:16}}>By June 2026 that would be</div>
        <div style={{
          fontSize:62,fontWeight:800,letterSpacing:"-3px",lineHeight:1,
          color:G.black,
          fontVariantNumeric:"tabular-nums",
        }}>
          TZS {fmtN(count)}
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"center",marginTop:20,flexWrap:"wrap"}}>
          <div style={{background:G.green,color:"#052e16",fontSize:12,fontWeight:700,padding:"6px 16px"}}>
            {sign}{data.returnPct.toFixed(0)}%
          </div>
          <div style={{background:"#f4f4f4",color:G.black,fontSize:12,fontWeight:600,padding:"6px 16px"}}>
            {mult}x the money
          </div>
        </div>
      </div>
    );
    if (slide === "share") return (
      <SlideShare data={data} onRestart={onRestart}/>
    );
    return null;
  }

  return (
    <div onClick={handleTap}
      style={{position:"relative",width:"100%",height:"100%",
        background:G.white,display:"flex",flexDirection:"column",
        userSelect:"none",cursor:"pointer"}}>

      {/* Progress bars */}
      <div style={{display:"flex",gap:4,padding:"14px 16px 10px"}}>
        {SLIDES.map(function(s,i){
          var fill = i < cur ? 1 : i === cur ? prog : 0;
          return (
            <div key={s} style={{flex:1,height:3,background:G.border,borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",background:G.green,width:(fill*100)+"%",
                transition:fill===1?"none":"none"}}/>
            </div>
          );
        })}
      </div>

      {/* Slide content */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 28px"}}>
        <SlideContent/>
      </div>

      {/* Stock + date watermark */}
      {!isLast && (
        <div style={{padding:"12px 20px",display:"flex",justifyContent:"space-between",
          fontSize:10,fontWeight:600,color:G.muted,letterSpacing:".05em",textTransform:"uppercase"}}>
          <span>{data.stock.symbol} · {data.stock.sector}</span>
          <span>{data.startDate} → Today</span>
        </div>
      )}
    </div>
  );
}

function SlideShare(props) {
  var data = props.data, onRestart = props.onRestart;
  var [copied, setCopied] = useState(false);
  var html = buildCardHTML(data);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).then(function(){
      setCopied(true);
      setTimeout(function(){setCopied(false);},2200);
    });
  }

  function download() {
    var blob = new Blob([html],{type:"text/html"});
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement("a");
    a.href = url; a.download = "sokoview-fomo-"+data.ticker+".html"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",
      background:G.white}} onClick={function(e){e.stopPropagation();}}>

      {/* Card preview */}
      <div style={{flex:1,overflow:"hidden",margin:"0 12px"}}>
        <iframe srcDoc={html} style={{width:"100%",height:"100%",border:"none"}}
          scrolling="no" title="Share card"/>
      </div>

      {/* Actions */}
      <div style={{padding:"12px 16px",display:"flex",gap:8}}>
        <button onClick={copyLink} style={{
          flex:1,padding:"12px 0",
          background:copied?G.green:"#f4f4f4",
          color:copied?G.white:G.black,
          border:"none",fontSize:12,fontWeight:700,
          cursor:"pointer",letterSpacing:".04em"}}>
          {copied?"COPIED":"COPY LINK"}
        </button>
        <button onClick={download} style={{
          flex:1,padding:"12px 0",
          background:G.green,color:G.white,
          border:"none",fontSize:12,fontWeight:700,
          cursor:"pointer",letterSpacing:".04em"}}>
          SAVE CARD
        </button>
        <button onClick={onRestart} style={{
          flex:1,padding:"12px 0",
          background:G.black,color:G.white,
          border:"none",fontSize:12,fontWeight:700,
          cursor:"pointer",letterSpacing:".04em"}}>
          START OVER
        </button>
      </div>
    </div>
  );
}

// ── Disclaimer modal ────────────────────────────────────────────
function Disclaimer(props) {
  if (!props.open) return null;
  return (
    <div onClick={props.onClose}
      style={{position:"fixed",inset:0,zIndex:200,background:"rgba(10,10,10,.6)",
        display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div onClick={function(e){e.stopPropagation();}}
        style={{background:G.white,maxWidth:440,width:"100%",padding:32,
          boxShadow:"0 40px 100px rgba(0,0,0,.2)"}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:".1em",
          color:G.green,textTransform:"uppercase",marginBottom:12}}>Disclaimer</div>
        <div style={{fontSize:14,lineHeight:1.7,color:G.black,marginBottom:16}}>
          This tool is for illustrative purposes only. Past performance is not indicative of future results. 
          This does not constitute financial advice. Always consult a licensed financial advisor before making 
          investment decisions.
        </div>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:".08em",
          color:G.muted,textTransform:"uppercase",marginBottom:8}}>Data Sources</div>
        <div style={{fontSize:13,lineHeight:1.6,color:G.muted,marginBottom:20}}>
          Live prices: Sokoview API (sokoview.co.tz)<br/>
          Historical prices: African Markets (african-markets.com)<br/>
          Coverage: June 2018 — present
        </div>
        <button onClick={props.onClose}
          style={{width:"100%",padding:"12px 0",background:G.black,
            color:G.white,border:"none",fontSize:12,fontWeight:700,
            cursor:"pointer",letterSpacing:".06em"}}>
          CLOSE
        </button>
      </div>
    </div>
  );
}

// ── Logo ────────────────────────────────────────────────────────
function Logo() {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{width:28,height:28,background:G.black,borderRadius:6,
        display:"flex",alignItems:"flex-end",gap:2,padding:"4px 5px"}}>
        <div style={{width:3,height:5,background:G.green,borderRadius:1}}/>
        <div style={{width:3,height:8,background:G.green,borderRadius:1}}/>
        <div style={{width:3,height:12,background:G.green,borderRadius:1}}/>
      </div>
      <span style={{fontSize:15,fontWeight:800,color:G.black,letterSpacing:"-.4px"}}>sokoview</span>
    </div>
  );
}

// ── Left panel editorial copy ───────────────────────────────────
function LeftPanel() {
  var stats = [
    {bank:"CRDB Bank",    from:"2018", ret:"+1,506%", val:"TZS 16M"},
    {bank:"NMB Bank",     from:"2018", ret:"+443%",   val:"TZS 5.4M"},
    {bank:"Mkombozi",     from:"2018", ret:"+431%",   val:"TZS 5.3M"},
  ];
  return (
    <div style={{padding:"0 48px 48px",display:"flex",flexDirection:"column",justifyContent:"center",
      height:"100%",maxWidth:520}}>
      <div style={{fontSize:11,fontWeight:700,letterSpacing:".12em",color:G.green,
        textTransform:"uppercase",marginBottom:16}}>DSE Long-term Returns</div>
      <h1 style={{fontSize:46,fontWeight:800,color:G.black,letterSpacing:"-2.5px",
        lineHeight:1.05,marginBottom:20}}>
        It's just a matter<br/>of time.
      </h1>
      <p style={{fontSize:16,color:G.muted,lineHeight:1.7,marginBottom:32,maxWidth:400}}>
        See what long-term investing in Tanzania's banking sector could have got you. 
        Pick a bank, pick a date, and find out what TZS 1M would be worth today.
      </p>
      <div style={{display:"flex",flexDirection:"column",gap:1,marginBottom:32}}>
        {stats.map(function(s) {
          return (
            <div key={s.bank} style={{display:"flex",alignItems:"center",
              justifyContent:"space-between",padding:"14px 0",
              borderBottom:"1px solid "+G.border}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:G.black}}>{s.bank}</div>
                <div style={{fontSize:11,color:G.muted}}>TZS 1M since {s.from}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:15,fontWeight:800,color:G.green}}>{s.val}</div>
                <div style={{fontSize:11,color:G.muted}}>{s.ret}</div>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{fontSize:11,color:G.muted,lineHeight:1.6}}>
        Past performance does not guarantee future returns.<br/>
        Data: Sokoview API · African Markets · June 2018 – present
      </p>
    </div>
  );
}

// ── Setup form ──────────────────────────────────────────────────
function SetupForm(props) {
  var onLaunch = props.onLaunch;
  var [ticker,     setTicker]     = useState("CRDB");
  var [startDate,  setStartDate]  = useState("2018-06-19");
  var [amount,     setAmount]     = useState(1000000);
  var [compId,     setCompId]     = useState(COMPARISONS[0].id);
  var [stockOpen,  setStockOpen]  = useState(false);
  var [livePrice,  setLivePrice]  = useState(null);
  var [loading,    setLoading]    = useState(false);
  var [error,      setError]      = useState(null);

  var selectedStock = DSE_STOCKS.find(function(s){return s.symbol===ticker;})||DSE_STOCKS[0];
  var selectedComp  = COMPARISONS.find(function(c){return c.id===compId;})||COMPARISONS[0];

  useEffect(function() {
    fetchLivePrice(ticker).then(function(d){
      setLivePrice(d && d.price ? d : null);
    });
  }, [ticker]);

  var AMOUNTS = [500000,1000000,2000000,5000000];

  function launch() {
    setError(null); setLoading(true);
    fetchPrices(ticker, startDate).then(function(prices) {
      if (!prices||prices.length < 5) throw new Error("Not enough data.");
      var buyPrice     = prices[0].price;
      var currentPrice = prices[prices.length-1].price;
      var shares       = Math.floor(amount / buyPrice);
      if (shares < 1) throw new Error("Amount too low for this stock.");
      var invested     = shares * buyPrice;
      var currentValue = shares * currentPrice;
      var gain         = currentValue - invested;
      var returnPct    = (gain / invested) * 100;
      var monthly = [], lastM = "";
      prices.forEach(function(p){
        var m = p.date.slice(0,7);
        if (m !== lastM) { monthly.push(p); lastM=m; }
      });
      onLaunch({
        ticker, stock:selectedStock, comparison:selectedComp,
        startDate, amount, invested, shares, buyPrice,
        currentPrice, currentValue, gain, returnPct, monthly,
      });
    }).catch(function(e){
      setError(e.message); setLoading(false);
    });
  }

  var INP = {width:"100%",boxSizing:"border-box",
    border:"1px solid "+G.border,padding:"11px 12px",
    fontSize:13,color:G.black,background:G.white,
    outline:"none",fontFamily:G.font};

  return (
    <div style={{padding:"24px 20px",display:"flex",flexDirection:"column",gap:0,height:"100%",overflowY:"auto"}}>

      {/* Stock picker */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",color:G.muted,
          textTransform:"uppercase",marginBottom:6}}>1 · Pick a bank</div>
        <div onClick={function(){setStockOpen(!stockOpen);}}
          style={{...INP,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:G.black}}>{selectedStock.symbol}</div>
            <div style={{fontSize:10,color:G.muted}}>{selectedStock.name}</div>
          </div>
          <span style={{fontSize:10,color:G.muted}}>{stockOpen?"▲":"▼"}</span>
        </div>
        {stockOpen && (
          <div style={{border:"1px solid "+G.green,borderTop:"none",background:G.white,marginBottom:0}}>
            {DSE_STOCKS.map(function(s){
              return (
                <div key={s.symbol}
                  onClick={function(){setTicker(s.symbol);setStockOpen(false);}}
                  style={{padding:"10px 12px",cursor:"pointer",
                    background:s.symbol===ticker?G.greenBg:G.white,
                    borderLeft:"3px solid "+(s.symbol===ticker?G.green:"transparent")}}>
                  <div style={{fontSize:13,fontWeight:700,color:G.black}}>{s.symbol}</div>
                  <div style={{fontSize:10,color:G.muted}}>{s.name}</div>
                </div>
              );
            })}
          </div>
        )}
        {livePrice && (
          <div style={{background:G.greenBg,border:"1px solid "+G.greenBorder,
            padding:"8px 12px",display:"flex",justifyContent:"space-between",
            alignItems:"center",marginTop:4}}>
            <span style={{fontSize:11,color:G.muted}}>Live price today</span>
            <span style={{fontSize:14,fontWeight:800,color:G.black}}>TZS {fmtN(livePrice.price)}</span>
          </div>
        )}
      </div>

      {/* Date */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",color:G.muted,
          textTransform:"uppercase",marginBottom:6}}>2 · If you had invested in</div>
        <input type="date" value={startDate}
          min="2018-06-19"
          max={new Date(Date.now()-86400000).toISOString().split("T")[0]}
          onChange={function(e){setStartDate(e.target.value);}}
          style={INP}/>
      </div>

      {/* Amount */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",color:G.muted,
          textTransform:"uppercase",marginBottom:6}}>3 · Amount (TZS)</div>
        <input type="number" value={amount} min="10000" step="100000"
          onChange={function(e){setAmount(Number(e.target.value));}}
          style={INP}/>
        <div style={{display:"flex",gap:6,marginTop:6}}>
          {AMOUNTS.map(function(a){
            return (
              <button key={a} onClick={function(){setAmount(a);}}
                style={{flex:1,padding:"7px 0",
                  background:amount===a?G.black:"#f4f4f4",
                  color:amount===a?G.white:G.black,
                  border:"none",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                {a>=1000000?(a/1000000)+"M":(a/1000)+"K"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Comparison */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,fontWeight:700,letterSpacing:".08em",color:G.muted,
          textTransform:"uppercase",marginBottom:6}}>4 · Instead of buying</div>
        <select value={compId} onChange={function(e){setCompId(e.target.value);}}
          style={{...INP,cursor:"pointer"}}>
          {COMPARISONS.map(function(c){
            return <option key={c.id} value={c.id}>{c.label} — TZS {fmtN(c.price)}</option>;
          })}
        </select>
      </div>

      {error && (
        <div style={{background:"#fef2f2",border:"1px solid #fca5a5",
          padding:"10px 12px",fontSize:12,color:"#dc2626",marginBottom:12}}>
          {error}
        </div>
      )}

      <button onClick={launch} disabled={loading}
        style={{width:"100%",padding:"14px 0",
          background:loading?"#f4f4f4":G.black,
          color:loading?G.muted:G.white,
          border:"none",fontSize:13,fontWeight:700,
          cursor:loading?"not-allowed":"pointer",
          letterSpacing:".06em",marginTop:"auto"}}>
        {loading?"CALCULATING...":"SHOW MY FOMO"}
      </button>
    </div>
  );
}

// ── Main app ────────────────────────────────────────────────────
export default function App() {
  var [phase,     setPhase]     = useState("setup");
  var [storyData, setStoryData] = useState(null);
  var [discOpen,  setDiscOpen]  = useState(false);

  function handleLaunch(data) {
    setStoryData(data);
    setPhase("story");
  }
  function handleRestart() {
    setPhase("setup"); setStoryData(null);
  }

  // Mobile detection
  var isMobile = window.innerWidth < 768;

  return (
    <div style={{fontFamily:G.font,background:G.white,minHeight:"100vh"}}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet"/>

      {/* Header */}
      <header style={{borderBottom:"1px solid "+G.border,padding:"0 24px",
        height:56,display:"flex",alignItems:"center",justifyContent:"space-between",
        position:"sticky",top:0,background:G.white,zIndex:10}}>
        <Logo/>
        <button onClick={function(){setDiscOpen(true);}}
          style={{background:"none",border:"1px solid "+G.border,
            padding:"6px 14px",fontSize:11,fontWeight:700,
            color:G.muted,cursor:"pointer",letterSpacing:".06em"}}>
          DISCLAIMER
        </button>
      </header>

      {phase === "setup" && (
        <div style={{display:"flex",minHeight:"calc(100vh - 56px)",
          flexDirection:isMobile?"column":"row"}}>

          {/* Left panel — desktop only */}
          {!isMobile && (
            <div style={{flex:1,borderRight:"1px solid "+G.border,
              display:"flex",alignItems:"center",paddingTop:48}}>
              <LeftPanel/>
            </div>
          )}

          {/* Right panel — setup form */}
          <div style={{width:isMobile?"100%":380,flexShrink:0,
            display:"flex",flexDirection:"column"}}>
            {isMobile && (
              <div style={{padding:"24px 20px 0"}}>
                <div style={{fontSize:11,fontWeight:700,letterSpacing:".1em",
                  color:G.green,textTransform:"uppercase",marginBottom:8}}>DSE FOMO Calculator</div>
                <h1 style={{fontSize:28,fontWeight:800,color:G.black,
                  letterSpacing:"-1px",lineHeight:1.1,marginBottom:16}}>
                  It's just a matter of time.
                </h1>
              </div>
            )}
            <SetupForm onLaunch={handleLaunch}/>
          </div>
        </div>
      )}

      {phase === "story" && storyData && (
        <div style={{position:"fixed",inset:0,zIndex:50,background:G.white,
          display:"flex",flexDirection:"column"}}>

          {/* Story header */}
          <div style={{height:56,borderBottom:"1px solid "+G.border,
            display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"0 20px",flexShrink:0,background:G.white}}>
            <Logo/>
            <button onClick={handleRestart}
              style={{background:"none",border:"none",
                fontSize:11,fontWeight:700,color:G.muted,cursor:"pointer",
                letterSpacing:".06em"}}>
              START OVER
            </button>
          </div>

          {/* Story player */}
          <div style={{flex:1,overflow:"hidden"}}>
            <StoryPlayer data={storyData} onRestart={handleRestart}/>
          </div>
        </div>
      )}

      {/* Footer */}
      {phase === "setup" && (
        <footer style={{borderTop:"1px solid "+G.border,padding:"16px 24px",
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <Logo/>
          <span style={{fontSize:11,color:G.muted,fontWeight:600}}>
            sokoview.co.tz · Track your DSE portfolio free
          </span>
        </footer>
      )}

      <Disclaimer open={discOpen} onClose={function(){setDiscOpen(false);}}/>
    </div>
  );
}
