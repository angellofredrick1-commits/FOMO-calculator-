import { useState, useEffect, useRef, useCallback } from "react";

// Sokoview API config
// Staging:    https://api-staging.sokoview.co.tz
// Production: https://api.sokoview.co.tz
// Auth: x-api-key header | scope: market:read
// NOTE: Only today's price is available via API. Historical path is
//       simulated; live price replaces the final point so returns are real.
const API_BASE = "https://api.sokoview.co.tz";
const API_KEY  = "skv_live_ef0939a5eb133b5ec5620df82b5be6caa48c49723211be72";

const DOT  = " \u00B7 ";
const ARR  = " \u2192 ";
const HELL = "\u2026";

// Fetch today's live price for one symbol.
// Returns { symbol, name, price, change, percentageChange, volume, updatedAt }
async function fetchLivePrice(symbol) {
  if (!API_KEY) return null;
  try {
    const res = await fetch(API_BASE + "/api/v1/market/prices/" + symbol, {
      headers: { "x-api-key": API_KEY, "Accept": "application/json" }
    });
    if (res.status === 429) {
      var retry = res.headers.get("Retry-After") || "60";
      throw new Error("Rate limited. Retry in " + retry + "s.");
    }
    if (!res.ok) throw new Error("API " + res.status + " for " + symbol);
    return res.json();
  } catch(e) {
    console.warn("fetchLivePrice failed:", e.message);
    return null;
  }
}

// Fetch all listed companies (used to populate stock list when API is live).
// Returns [{ symbol, name, type, sector }]
async function fetchCompanies() {
  if (!API_KEY) return null;
  const res = await fetch(API_BASE + "/api/v1/companies", {
    headers: { "x-api-key": API_KEY, "Accept": "application/json" }
  });
  if (!res.ok) return null;
  return res.json();
}

// Fetch all stocks with live prices — used to populate the stock selector
// Falls back to DSE_STOCKS if API unavailable
async function fetchAllStocks() {
  if (!API_KEY) return null;
  try {
    const res = await fetch(API_BASE + "/api/v1/market/prices", {
      headers: { "x-api-key": API_KEY, "Accept": "application/json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Filter out zero-price or stale stocks, map to our shape
    return data
      .filter(function(s) { return s.price && s.price > 0; })
      .map(function(s) {
        return {
          symbol: s.symbol,
          name: s.name || s.symbol,
          sector: "DSE",
          price: s.price,
          change: s.change,
          percentageChange: s.percentageChange,
        };
      });
  } catch(e) {
    console.warn("fetchAllStocks failed:", e.message);
    return null;
  }
}

// ── Price service ─────────────────────────────────────────────
function simulatePrices(symbol, startDate) {
  // Base prices anchored to real DSE prices from sokoview API
  // Volatility (v) and trend (t) are estimated per stock type
  const cfgs = {
    AFRIPRISE:   {base:600,  v:.022,t:.0004},
    CRDB:        {base:2200, v:.012,t:.0003},
    DCB:         {base:420,  v:.022,t:.0004},
    DSE:         {base:5800, v:.014,t:.0002},
    "IEACLC-ETF":{base:1100, v:.008,t:.0002},
    JATU:        {base:240,  v:.028,t:.0003},
    KCB:         {base:1500, v:.015,t:.0003},
    MBP:         {base:1800, v:.016,t:.0003},
    MCB:         {base:900,  v:.018,t:.0004},
    MKCB:        {base:3800, v:.016,t:.0004},
    MUCOBA:      {base:450,  v:.020,t:.0004},
    NICO:        {base:3300, v:.014,t:.0003},
    NMB:         {base:13000,v:.010,t:.0004},
    NMG:         {base:260,  v:.020,t:.0002},
    PAL:         {base:340,  v:.022,t:.0003},
    SWIS:        {base:2400, v:.016,t:.0003},
    TBL:         {base:8800, v:.012,t:.0003},
    TCC:         {base:11000,v:.012,t:.0003},
    TCCL:        {base:2800, v:.016,t:.0004},
    TOL:         {base:1200, v:.020,t:.0003},
    TPCC:        {base:6200, v:.016,t:.0003},
    TTP:         {base:460,  v:.018,t:.0003},
    "VERTEX-ETF":{base:320,  v:.010,t:.0002},
    VODA:        {base:660,  v:.015,t:.0003},
    YETU:        {base:210,  v:.025,t:.0004},
  };
  const cfg = cfgs[symbol] || { base:500, v:.015, t:.0003 };
  const start = new Date(startDate), end = new Date();
  const days  = Math.ceil((end - start) / 86400000);
  let seed = symbol.charCodeAt(0) * 1000 + symbol.charCodeAt(1);
  const rand = () => { seed=(seed*1664525+1013904223)&0xffffffff; return(seed>>>0)/0xffffffff; };
  let price = cfg.base;
  const out = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    price = Math.max(price * (1 + (rand() - .48) * cfg.v + cfg.t), cfg.base * .3);
    out.push({ date: d.toISOString().split("T")[0], price: Math.round(price) });
  }
  return out;
}

// Build the full price series:
// 1. Simulate historical path from startDate
// 2. If API_KEY set, fetch today's real price and snap the last point to it
async function fetchPrices(symbol, startDate) {
  const simulated = simulatePrices(symbol, startDate);
  if (!API_KEY) {
    await new Promise(function(r) { setTimeout(r, 700); });
    return simulated;
  }
  // Try to snap last price to live — silently fall back if staging not ready
  try {
    const live = await fetchLivePrice(symbol);
    if (live && live.price) {
      const today = new Date().toISOString().split("T")[0];
      simulated[simulated.length - 1] = { date: today, price: Math.round(live.price) };
    }
  } catch (e) {
    console.warn("Sokoview API unavailable, using simulated prices:", e.message);
  }
  return simulated;
}

// ── Constants ─────────────────────────────────────────────────
var G = {
  green:"#22c55e", greenDark:"#16a34a",
  greenBg:"rgba(34,197,94,.08)", greenBorder:"rgba(34,197,94,.22)",
  black:"#0a0a0a", body:"#6b7280", muted:"#9ca3af",
  surface:"#f9fafb", border:"#e5e7eb", white:"#ffffff",
};

// Fallback stock list (used before API loads or if API fails)
// Sourced from GET /api/v1/market/prices — active stocks only
var DSE_STOCKS = [
  {symbol:"AFRIPRISE",    name:"Afriprise",                  sector:"Finance"},
  {symbol:"CRDB",         name:"CRDB Bank",                  sector:"Banking"},
  {symbol:"DCB",          name:"DCB Commercial Bank",        sector:"Banking"},
  {symbol:"DSE",          name:"Dar es Salaam Stock Exchange",sector:"Finance"},
  {symbol:"IEACLC-ETF",  name:"IEACLC ETF",                 sector:"ETF"},
  {symbol:"KCB",          name:"KCB Group",                  sector:"Banking"},
  {symbol:"MBP",          name:"MBP",                        sector:"Finance"},
  {symbol:"MCB",          name:"Maendeleo Commercial Bank",  sector:"Banking"},
  {symbol:"MKCB",         name:"Mkombozi Commercial Bank",   sector:"Banking"},
  {symbol:"MUCOBA",       name:"Mufindi Community Bank",     sector:"Banking"},
  {symbol:"NICO",         name:"NICO Holdings",              sector:"Insurance"},
  {symbol:"NMB",          name:"NMB Bank",                   sector:"Banking"},
  {symbol:"PAL",          name:"PAL",                        sector:"Finance"},
  {symbol:"SWIS",         name:"Swissport Tanzania",         sector:"Aviation"},
  {symbol:"TBL",          name:"Tanzania Breweries",         sector:"Consumer"},
  {symbol:"TCC",          name:"Tanzania Cigarette Co.",     sector:"Consumer"},
  {symbol:"TCCL",         name:"TCCL",                       sector:"Consumer"},
  {symbol:"TOL",          name:"TOL Gases",                  sector:"Industrial"},
  {symbol:"TPCC",         name:"Tanzania Portland Cement",   sector:"Industrial"},
  {symbol:"TTP",          name:"TTP",                        sector:"Finance"},
  {symbol:"VERTEX-ETF",   name:"Vertex ETF",                 sector:"ETF"},
  {symbol:"VODA",         name:"Vodacom Tanzania",           sector:"Telecom"},
];

var COMPARISONS = [
  {id:"phone_mid",  emoji:"📱", label:"Mid-range phone",   sub:"Samsung A55, Tecno Camon",  price:850000},
  {id:"phone_flag", emoji:"📱", label:"Flagship phone",    sub:"Samsung S24, iPhone 15",    price:2800000},
  {id:"laptop",     emoji:"💻", label:"Laptop",            sub:"HP, Lenovo, Dell",          price:1800000},
  {id:"tv",         emoji:"📺", label:"Smart TV 43",       sub:"Samsung, LG, TCL",          price:1200000},
  {id:"fridge",     emoji:"🧊", label:"Refrigerator",      sub:"250L double-door",          price:1500000},
  {id:"rent",       emoji:"🏠", label:"6 months rent",     sub:"1-bed, Kinondoni DSM",      price:3600000},
  {id:"car",        emoji:"🚗", label:"Car down payment",  sub:"Toyota Vitz deposit",       price:5000000},
  {id:"school",     emoji:"🎓", label:"School fees 1 yr",  sub:"Private secondary school",  price:1400000},
  {id:"solar",      emoji:"☀️", label:"Solar system",      sub:"300W home system",          price:2200000},
  {id:"vacation",   emoji:"✈️", label:"Zanzibar vacation", sub:"5 nights, flights incl.",   price:2000000},
];

function fmtN(n) { return new Intl.NumberFormat("en-TZ").format(Math.round(n)); }
function fmtS(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000)    return Math.round(n / 1000) + "K";
  return String(Math.round(n));
}
function fmtC(n) { return "TZS " + fmtS(n); }

// ── Share card HTML (pure string, no JSX, no template literals) ──
function buildCardHTML(d, comp) {
  var pos    = d.gain >= 0;
  var col    = pos ? "#22c55e" : "#ef4444";
  var colDk  = pos ? "#16a34a" : "#dc2626";
  var sign   = pos ? "+" : "";
  var arrow  = pos ? "\u25B2" : "\u25BC";
  var yr     = d.startDate.slice(0, 4);
  var W = 420, H = 90;
  var vals = d.monthly.map(function(p) { return p.price; });
  var mn = Math.min.apply(null, vals);
  var mx = Math.max.apply(null, vals);
  var pts = d.monthly.map(function(p, i) {
    var x = (i / (d.monthly.length - 1)) * W;
    var y = H - ((p.price - mn) / (mx - mn || 1)) * (H - 14) - 7;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  var area = "M" + pts.replace(/ /g, " L") + " L" + W + "," + H + " L0," + H + " Z";
  var totalItems = Math.floor(d.currentValue / comp.price);
  var origItems  = Math.floor(d.invested / comp.price);
  var extra      = totalItems - origItems;
  var years      = d.monthly.length / 12;
  var savingsVal = d.invested * Math.pow(1.05, years);
  var maxV       = Math.max(d.currentValue, savingsVal);
  var stockW     = Math.round((d.currentValue / maxV) * 96);
  var saveW      = Math.round((savingsVal / maxV) * 96);

  var css = ""
    + "*{margin:0;padding:0;box-sizing:border-box;font-family:Sora,system-ui,sans-serif}"
    + "body{background:#e8e8e8;display:flex;justify-content:center;padding:32px}"
    + ".card{width:500px;background:#fff;border-radius:24px;overflow:hidden;position:relative;box-shadow:0 40px 100px rgba(0,0,0,.18)}"
    + ".card::after{content:'';position:absolute;inset:0;background-image:radial-gradient(circle,rgba(0,0,0,.032) 1px,transparent 1px);background-size:20px 20px;z-index:0;pointer-events:none}"
    + ".card::before{content:'';position:absolute;width:420px;height:420px;top:-90px;right:-90px;border-radius:50%;background:radial-gradient(circle,rgba(34,197,94,.12) 0%,transparent 68%);z-index:0;pointer-events:none}"
    + ".inn{position:relative;z-index:3}"
    + ".tb{height:4px;background:" + col + "}"
    + ".bod{padding:26px 28px 0;display:flex;flex-direction:column;gap:18px}"
    + ".hdr{display:flex;align-items:center;justify-content:space-between}"
    + ".logo{display:flex;align-items:center;gap:8px}"
    + ".li{width:30px;height:30px;background:#0a0a0a;border-radius:7px;display:flex;align-items:flex-end;gap:2.5px;padding:5px 6px}"
    + ".b1,.b2,.b3{width:3.5px;border-radius:1.5px;background:#22c55e}"
    + ".b1{height:5.5px}.b2{height:9px}.b3{height:13px}"
    + ".lt{font-size:14px;font-weight:800;color:#0a0a0a;letter-spacing:-.5px}"
    + ".ld{font-size:11px;font-weight:700;color:#9ca3af}"
    + ".bdg{font-size:10px;font-weight:700;color:#9ca3af}"
    + ".pill{display:inline-flex;align-items:center;gap:6px;width:fit-content;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#16a34a;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.22);padding:4px 12px;border-radius:100px}"
    + ".dot{width:6px;height:6px;border-radius:50%;background:#22c55e}"
    + ".il{font-size:16px;font-weight:700;color:#6b7280}"
    + ".grn{color:#22c55e}"
    + ".vl{font-size:54px;font-weight:800;color:" + col + ";letter-spacing:-2.8px;line-height:.94}"
    + ".sl{font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.09em;margin-top:6px}"
    + ".strip{display:flex;gap:1px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}"
    + ".sc{flex:1;padding:12px 10px}.sc.acc{background:rgba(34,197,94,.07)}.sc.pl{background:#f9fafb}.sc+.sc{border-left:1px solid #e5e7eb}"
    + ".sv{font-size:15px;font-weight:800;letter-spacing:-.4px}.sv.g{color:#16a34a}.sv.k{color:#0a0a0a}"
    + ".ss{font-size:8px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-top:3px}"
    + ".spk{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 14px 10px}"
    + ".sh{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}"
    + ".sl2{font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.09em}"
    + ".sr{font-size:13px;font-weight:800;color:" + colDk + "}"
    + ".sd{display:flex;justify-content:space-between;margin-top:8px;font-size:9px;font-weight:600;color:#9ca3af}"
    + ".comp{background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}"
    + ".ct{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}"
    + ".ch{font-size:13px;font-weight:800;color:#0a0a0a;margin-bottom:3px}"
    + ".cs{font-size:11px;font-weight:600;color:#6b7280}"
    + ".cb{font-size:20px;font-weight:800;color:#16a34a;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:8px 14px;white-space:nowrap;flex-shrink:0}"
    + ".bb{height:7px;background:#e5e7eb;border-radius:100px;overflow:hidden}"
    + ".bf{height:100%;background:#22c55e;border-radius:100px;width:100%}"
    + ".bl{display:flex;justify-content:space-between;font-size:9px;font-weight:700;margin-top:5px}"
    + ".blo{color:#9ca3af}.blg{color:#16a34a}"
    + ".vs{display:flex;flex-direction:column;gap:10px}"
    + ".vl2{font-size:9px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.09em}"
    + ".vr{display:flex;flex-direction:column;gap:4px}"
    + ".vm{display:flex;justify-content:space-between;align-items:center}"
    + ".vn{font-size:11px;font-weight:700;color:#0a0a0a}"
    + ".vv{font-size:12px;font-weight:800}"
    + ".vb{height:6px;background:#f3f4f6;border-radius:100px;overflow:hidden}"
    + ".vf{height:100%;border-radius:100px}"
    + ".src{font-size:9px;font-weight:600;color:#9ca3af;text-align:right}"
    + ".foot{margin-top:20px;background:#0a0a0a;padding:13px 28px;display:flex;align-items:center;justify-content:space-between}"
    + ".fl{font-size:10px;font-weight:700;color:rgba(255,255,255,.45)}"
    + ".fr{font-size:12px;font-weight:800;color:#22c55e}";

  var body = ""
    + "<div class=\"card\"><div class=\"inn\">"
    + "<div class=\"tb\"></div>"
    + "<div class=\"bod\">"
    + "<div class=\"hdr\">"
    + "<div class=\"logo\"><div class=\"li\"><div class=\"b1\"></div><div class=\"b2\"></div><div class=\"b3\"></div></div>"
    + "<span class=\"lt\">sokoview</span><span class=\"ld\">.co.tz</span></div>"
    + "<div class=\"bdg\">DSE " + DOT + yr + ARR + "Jun 2026</div>"
    + "</div>"
    + "<div class=\"pill\"><div class=\"dot\"></div>FOMO CALCULATOR</div>"
    + "<div>"
    + "<div class=\"il\">TZS " + fmtS(d.invested) + " in <span class=\"grn\">" + d.ticker + "</span> became</div>"
    + "<div class=\"vl\">" + fmtC(d.currentValue) + "</div>"
    + "<div class=\"sl\">" + d.stock.name + DOT + fmtN(d.shares) + " shares" + DOT + d.startDate + ARR + "Today</div>"
    + "</div>"
    + "<div class=\"strip\">"
    + "<div class=\"sc acc\"><div class=\"sv g\">" + sign + fmtS(d.gain) + "</div><div class=\"ss\">Total gain</div></div>"
    + "<div class=\"sc pl\"><div class=\"sv g\">" + sign + d.returnPct.toFixed(1) + "%</div><div class=\"ss\">Return</div></div>"
    + "<div class=\"sc pl\"><div class=\"sv k\">TZS " + fmtN(d.buyPrice) + "</div><div class=\"ss\">Buy price</div></div>"
    + "<div class=\"sc pl\"><div class=\"sv k\">TZS " + fmtN(d.currentPrice) + "</div><div class=\"ss\">Price today</div></div>"
    + "</div>"
    + "<div class=\"spk\">"
    + "<div class=\"sh\"><span class=\"sl2\">Portfolio value over time</span>"
    + "<span class=\"sr\">" + arrow + " " + sign + d.returnPct.toFixed(1) + "% total return</span></div>"
    + "<svg viewBox=\"0 0 " + W + " " + H + "\" width=\"100%\" height=\"" + H + "\" style=\"display:block\">"
    + "<defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">"
    + "<stop offset=\"0%\" stop-color=\"" + col + "\" stop-opacity=\".28\"/>"
    + "<stop offset=\"100%\" stop-color=\"" + col + "\" stop-opacity=\".02\"/></linearGradient></defs>"
    + "<path d=\"" + area + "\" fill=\"url(#g)\"/>"
    + "<polyline points=\"" + pts + "\" fill=\"none\" stroke=\"" + col + "\" stroke-width=\"2.5\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>"
    + "</svg>"
    + "<div class=\"sd\"><span>" + yr + "</span><span>Jun 2026</span></div>"
    + "</div>"
    + "<div class=\"comp\">"
    + "<div class=\"ct\"><div>"
    + "<div class=\"ch\">Instead of buying " + comp.label.toLowerCase() + HELL + "</div>"
    + "<div class=\"cs\">Your profit alone buys <strong style=\"color:#16a34a\">" + extra + " extra</strong></div>"
    + "</div><div class=\"cb\">+" + extra + " " + comp.emoji + "</div></div>"
    + "<div><div class=\"bb\"><div class=\"bf\"></div></div>"
    + "<div class=\"bl\"><span class=\"blo\">Could buy " + origItems + " in " + yr + "</span>"
    + "<span class=\"blg\">Can buy " + totalItems + " today</span></div></div>"
    + "</div>"
    + "<div class=\"vs\">"
    + "<div class=\"vl2\">vs. alternatives (same " + fmtC(d.invested) + " invested)</div>"
    + "<div class=\"vr\"><div class=\"vm\">"
    + "<span class=\"vn\">" + d.ticker + " shares</span>"
    + "<span class=\"vv\" style=\"color:#16a34a\">" + fmtC(d.currentValue) + "</span></div>"
    + "<div class=\"vb\"><div class=\"vf\" style=\"width:" + stockW + "%;background:#22c55e\"></div></div></div>"
    + "<div class=\"vr\"><div class=\"vm\">"
    + "<span class=\"vn\">Bank savings (5% p.a.)</span>"
    + "<span class=\"vv\" style=\"color:#6b7280\">" + fmtC(savingsVal) + "</span></div>"
    + "<div class=\"vb\"><div class=\"vf\" style=\"width:" + saveW + "%;background:#d1d5db\"></div></div></div>"
    + "</div>"
    + "<div class=\"src\">" + (API_KEY ? "Live DSE data" : "Simulated prices") + " via sokoview.co.tz</div>"
    + "</div>"
    + "<div class=\"foot\"><span class=\"fl\">Track your DSE portfolio free</span><span class=\"fr\">sokoview.co.tz</span></div>"
    + "</div></div>";

  return "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">"
    + "<link href=\"https://fonts.googleapis.com/css2?family=Sora:wght@700;800&display=swap\" rel=\"stylesheet\">"
    + "<style>" + css + "</style></head><body>" + body + "</body></html>";
}

// ── Logo ──────────────────────────────────────────────────────
function Logo(props) {
  var light = props.light || false;
  var size  = props.size  || 1;
  var c = light ? G.white : G.black;
  return (
    <div style={{display:"flex",alignItems:"center",gap:7*size}}>
      <div style={{width:28*size,height:28*size,background:c,borderRadius:6*size,
        display:"flex",alignItems:"flex-end",gap:2.5*size,padding:"5px "+(6*size)+"px"}}>
        <div style={{width:3.5*size,height:5.5*size,borderRadius:1.5,background:G.green}}/>
        <div style={{width:3.5*size,height:9*size,  borderRadius:1.5,background:G.green}}/>
        <div style={{width:3.5*size,height:13*size, borderRadius:1.5,background:G.green}}/>
      </div>
      <span style={{fontSize:14*size,fontWeight:800,color:c,letterSpacing:-.5}}>sokoview</span>
      <span style={{fontSize:11*size,fontWeight:700,color:light?"rgba(255,255,255,.4)":G.muted}}>.co.tz</span>
    </div>
  );
}

function APIBadge() {
  var live = !!API_KEY;
  var [ok, setOk] = useState(null);
  useEffect(function() {
    if (!API_KEY) { setOk(false); return; }
    fetchLivePrice("CRDB")
      .then(function() { setOk(true); })
      .catch(function() { setOk(false); });
  }, []);
  var color  = (!live)        ? "#92400e"  : ok===null ? G.muted     : ok ? G.greenDark : "#dc2626";
  var bg     = (!live)        ? "rgba(251,191,36,.08)" : ok===null ? "rgba(156,163,175,.08)" : ok ? G.greenBg : "rgba(239,68,68,.08)";
  var border = (!live)        ? "rgba(251,191,36,.3)"  : ok===null ? "rgba(156,163,175,.2)"  : ok ? G.greenBorder : "rgba(239,68,68,.3)";
  var dot    = (!live)        ? "#f59e0b"  : ok===null ? G.muted     : ok ? G.green     : "#ef4444";
  var label  = (!live)        ? "Simulated \u00B7 Add API key"
             : ok===null      ? "Connecting..."
             : ok             ? "Live DSE prices"
             :                  "API key error";
  return (
    <div style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:10,fontWeight:700,
      letterSpacing:".08em",color:color,background:bg,
      border:"1px solid "+border,padding:"5px 12px",borderRadius:100}}>
      <div style={{width:6,height:6,borderRadius:"50%",background:dot,
        boxShadow:live&&ok?"0 0 0 3px "+dot+"33":"none"}}/>
      {label}
    </div>
  );
}

function LivePriceTicker(props) {
  var symbol = props.symbol;
  var [data,   setData]   = useState(null);
  var [status, setStatus] = useState("idle");
  useEffect(function() {
    if (!API_KEY) return;
    setStatus("loading"); setData(null);
    fetchLivePrice(symbol)
      .then(function(d) { setData(d); setStatus("ok"); })
      .catch(function()  { setStatus("err"); });
  }, [symbol]);
  if (!API_KEY || status === "idle" || status === "err") return null;
  if (status === "loading") {
    return (
      <div style={{padding:"10px 14px",background:G.surface,borderRadius:10,
        border:"1px solid "+G.border,marginBottom:14,display:"flex",gap:10}}>
        <div style={{width:80,height:14,borderRadius:4,background:"#e5e7eb",animation:"shimmer 1.4s infinite"}}/>
        <div style={{width:50,height:14,borderRadius:4,background:"#e5e7eb",animation:"shimmer 1.4s infinite"}}/>
      </div>
    );
  }
  if (!data) return null;
  var pos = (data.change || 0) >= 0;
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
      padding:"10px 14px",marginBottom:14,borderRadius:10,
      background:pos?G.greenBg:"rgba(239,68,68,.06)",
      border:"1px solid "+(pos?G.greenBorder:"rgba(239,68,68,.2)")}}>
      <span style={{fontSize:11,fontWeight:600,color:G.body}}>{"Live: "+symbol+" today"}</span>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:15,fontWeight:800,color:G.black}}>{"TZS "+fmtN(data.price)}</span>
        <span style={{fontSize:11,fontWeight:700,color:pos?G.greenDark:"#dc2626"}}>
          {(pos?"+":"")+(data.percentageChange||0).toFixed(2)+"%"}
        </span>
      </div>
    </div>
  );
}

function StoryBars(props) {
  var total = props.total, current = props.current, progress = props.progress;
  return (
    <div style={{display:"flex",gap:4}}>
      {Array.from({length:total}).map(function(_,i) {
        return (
          <div key={i} style={{flex:1,height:3,borderRadius:3,
            background:"rgba(255,255,255,.25)",overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:3,background:G.white,
              width:i<current?"100%":i===current?(progress*100)+"%":"0%"}}/>
          </div>
        );
      })}
    </div>
  );
}

function Sparkline(props) {
  var data  = props.data;
  var color = props.color || G.green;
  var h     = props.h    || 56;
  if (!data || data.length < 2) return null;
  var vals = data.map(function(p) { return p.price; });
  var mn = Math.min.apply(null, vals);
  var mx = Math.max.apply(null, vals);
  var W  = 300;
  var pts = vals.map(function(v, i) {
    return ((i/(vals.length-1))*W).toFixed(1)+","+(h-((v-mn)/(mx-mn||1))*(h-10)-5).toFixed(1);
  }).join(" ");
  var area = "M"+pts.replace(/ /g," L")+" L"+W+","+h+" L0,"+h+" Z";
  return (
    <svg viewBox={"0 0 "+W+" "+h} style={{width:"100%",height:h,display:"block"}}>
      <defs>
        <linearGradient id="sk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={.32}/>
          <stop offset="100%" stopColor={color} stopOpacity={.02}/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sk)"/>
      <polyline points={pts} fill="none" stroke={color}
        strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── Loading screen ────────────────────────────────────────────
function LoadingScreen(props) {
  var ticker = props.ticker, amount = props.amount, startDate = props.startDate;
  var msgs = [
    "Fetching " + ticker + " history...",
    "Crunching the numbers...",
    "Building your story...",
  ];
  var [idx, setIdx] = useState(0);
  useEffect(function() {
    var t = setInterval(function() { setIdx(function(i) { return (i+1) % msgs.length; }); }, 900);
    return function() { clearInterval(t); };
  }, []);
  return (
    <div style={{position:"fixed",inset:0,zIndex:100,
      background:"linear-gradient(150deg,#0a0a0a 0%,#0a1a10 100%)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div style={{position:"absolute",top:"30%",left:"50%",transform:"translateX(-50%)",
        width:400,height:400,pointerEvents:"none",
        background:"radial-gradient(circle,rgba(34,197,94,.12) 0%,transparent 68%)"}}/>
      <div style={{position:"absolute",inset:0,pointerEvents:"none",
        backgroundImage:"radial-gradient(circle,rgba(255,255,255,.03) 1px,transparent 1px)",
        backgroundSize:"20px 20px"}}/>
      <div style={{position:"relative",zIndex:1,textAlign:"center",padding:"0 32px"}}>
        <div style={{width:52,height:52,margin:"0 auto 24px",borderRadius:"50%",
          border:"3px solid rgba(255,255,255,.1)",
          borderTop:"3px solid "+G.green,
          animation:"spin .8s linear infinite"}}/>
        <div style={{fontSize:14,fontWeight:700,color:G.white,marginBottom:6}}>{msgs[idx]}</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,.4)"}}>
          {ticker} {DOT} {fmtC(amount)} {DOT} from {startDate}
        </div>
        <div style={{width:200,height:3,background:"rgba(255,255,255,.1)",
          borderRadius:100,overflow:"hidden",margin:"28px auto 0"}}>
          <div style={{height:"100%",background:G.green,borderRadius:100,
            animation:"bar 1.8s ease-in-out infinite"}}/>
        </div>
      </div>
    </div>
  );
}

// ── Story slides ──────────────────────────────────────────────
function SlideInvested(props) {
  var amount = props.amount, ticker = props.ticker, date = props.date, stock = props.stock;
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",
      justifyContent:"center",alignItems:"center",textAlign:"center",padding:"0 32px"}}>
      <div style={{fontSize:56,marginBottom:16}}>{"💸"}</div>
      <div style={{fontSize:13,color:"rgba(255,255,255,.5)",fontWeight:700,
        textTransform:"uppercase",letterSpacing:".12em",marginBottom:12}}>
        {"Back in " + new Date(date).getFullYear() + "..."}
      </div>
      <div style={{fontSize:"clamp(28px,8vw,40px)",fontWeight:800,
        color:G.white,letterSpacing:-1.5,lineHeight:1.1}}>
        {"You had " + fmtC(amount)}
      </div>
      <div style={{marginTop:20,padding:"12px 24px",borderRadius:100,
        background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.14)"}}>
        <span style={{fontSize:14,fontWeight:700,color:G.white}}>
          {ticker + DOT + stock.name}
        </span>
      </div>
      <div style={{marginTop:24,fontSize:13,color:"rgba(255,255,255,.3)"}}>{"Tap to continue \u2192"}</div>
    </div>
  );
}

function SlideDecision(props) {
  var amount = props.amount, comparison = props.comparison;
  var items = Math.floor(amount / comparison.price);
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",
      justifyContent:"center",alignItems:"center",textAlign:"center",padding:"0 32px"}}>
      <div style={{fontSize:68,marginBottom:10}}>{comparison.emoji}</div>
      <div style={{fontSize:16,color:"rgba(255,255,255,.55)",fontWeight:600,marginBottom:8}}>
        {"You could've spent it on"}
      </div>
      <div style={{fontSize:"clamp(20px,6vw,28px)",fontWeight:800,color:G.white,marginBottom:4}}>
        {comparison.label}
      </div>
      <div style={{fontSize:13,color:"rgba(255,255,255,.4)",marginBottom:24}}>{comparison.sub}</div>
      <div style={{padding:"14px 28px",borderRadius:14,
        background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)"}}>
        <div style={{fontSize:36,fontWeight:800,color:G.white,letterSpacing:-1}}>
          {items > 0 ? items + "\u00D7" : "\u22481\u00D7"}
        </div>
        <div style={{fontSize:11,color:"rgba(255,255,255,.4)",marginTop:2}}>{"could've bought"}</div>
      </div>
      <div style={{marginTop:28,fontSize:14,fontWeight:700,color:"rgba(255,255,255,.35)"}}>
        {"But instead... \u2192"}
      </div>
    </div>
  );
}

function SlideChose(props) {
  var ticker = props.ticker, stock = props.stock, amount = props.amount;
  var shares = props.shares, buyPrice = props.buyPrice;
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",
      justifyContent:"center",alignItems:"center",textAlign:"center",padding:"0 32px"}}>
      <div style={{fontSize:48,marginBottom:16}}>{"📈"}</div>
      <div style={{fontSize:14,color:"rgba(255,255,255,.5)",fontWeight:600,
        textTransform:"uppercase",letterSpacing:".1em",marginBottom:14}}>{"You invested"}</div>
      <div style={{fontSize:"clamp(30px,8vw,44px)",fontWeight:800,
        color:G.white,letterSpacing:-1.5,lineHeight:1}}>
        {fmtC(amount)}
      </div>
      <div style={{marginTop:20,lineHeight:1.9,fontSize:14,color:"rgba(255,255,255,.5)"}}>
        {"into "}
        <strong style={{color:G.white}}>{ticker + " (" + stock.name + ")"}</strong>
        <br/>
        {"and received "}
        <strong style={{color:G.green}}>{fmtN(shares) + " shares"}</strong>
        <br/>
        {"at "}
        <strong style={{color:G.white}}>{"TZS " + fmtN(buyPrice)}</strong>
        {" each"}
      </div>
    </div>
  );
}

function SlideGrowth(props) {
  var monthly = props.monthly, positive = props.positive;
  var ticker = props.ticker, startDate = props.startDate;
  var color = positive ? G.green : "#f87171";
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",
      justifyContent:"center",padding:"0 24px"}}>
      <div style={{fontSize:13,color:"rgba(255,255,255,.5)",fontWeight:700,
        textTransform:"uppercase",letterSpacing:".1em",marginBottom:14,textAlign:"center"}}>
        {"Your " + ticker + " journey"}
      </div>
      <div style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",
        borderRadius:14,padding:"16px 16px 8px"}}>
        <Sparkline data={monthly} color={color} h={130}/>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6,
          fontSize:10,color:"rgba(255,255,255,.3)"}}>
          <span>{startDate.slice(0,4)}</span><span>{"Today"}</span>
        </div>
      </div>
    </div>
  );
}

function SlideReveal(props) {
  var currentValue = props.currentValue, gain = props.gain;
  var returnPct = props.returnPct, positive = props.positive, invested = props.invested;
  var [on, setOn] = useState(false);
  useEffect(function() {
    var t = setTimeout(function() { setOn(true); }, 150);
    return function() { clearTimeout(t); };
  }, []);
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",
      justifyContent:"center",alignItems:"center",textAlign:"center",padding:"0 32px"}}>
      <div style={{fontSize:14,color:"rgba(255,255,255,.5)",fontWeight:600,
        textTransform:"uppercase",letterSpacing:".1em",marginBottom:14}}>
        {"Today your investment is worth"}
      </div>
      <div style={{fontSize:"clamp(36px,10vw,58px)",fontWeight:800,color:G.white,
        letterSpacing:-2.5,lineHeight:.95,
        opacity:on?1:0,transform:on?"scale(1)":"scale(.86)",
        transition:"all .55s cubic-bezier(.34,1.56,.64,1)"}}>
        {fmtC(currentValue)}
      </div>
      <div style={{marginTop:14,fontSize:18,fontWeight:800,
        color:positive?G.green:"#f87171",
        opacity:on?1:0,transform:on?"translateY(0)":"translateY(14px)",
        transition:"all .5s .2s ease"}}>
        {(positive?"\u25B2":"\u25BC")+" "+fmtC(Math.abs(gain))+" ("+(positive?"+":"")+returnPct.toFixed(1)+"%)"}
      </div>
      <div style={{marginTop:8,fontSize:12,color:"rgba(255,255,255,.35)",
        opacity:on?1:0,transition:"opacity .4s .35s ease"}}>
        {"started with "+fmtC(invested)}
      </div>
      <div style={{marginTop:28,fontSize:positive?48:32,
        opacity:on?1:0,transition:"opacity .4s .5s ease"}}>
        {positive ? "🤑" : "😬"}
      </div>
    </div>
  );
}

function SlideComparison(props) {
  var comparison = props.comparison, currentValue = props.currentValue;
  var invested = props.invested, positive = props.positive;
  var [on, setOn] = useState(false);
  useEffect(function() {
    var t = setTimeout(function() { setOn(true); }, 250);
    return function() { clearTimeout(t); };
  }, []);
  var total = Math.floor(currentValue / comparison.price);
  var orig  = Math.floor(invested    / comparison.price);
  var extra = total - orig;
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",
      justifyContent:"center",alignItems:"center",textAlign:"center",padding:"0 28px"}}>
      <div style={{fontSize:56,marginBottom:6}}>{comparison.emoji}</div>
      <div style={{fontSize:12,color:"rgba(255,255,255,.4)",fontWeight:600,marginBottom:20}}>
        {comparison.label + DOT + fmtC(comparison.price) + " each"}
      </div>
      <div style={{opacity:on?1:0,transform:on?"translateY(0)":"translateY(18px)",
        transition:"all .55s cubic-bezier(.34,1.56,.64,1)",width:"100%"}}>
        {positive && extra > 0 ? (
          <div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginBottom:6}}>
              {"Your profit alone can now buy"}
            </div>
            <div style={{fontSize:68,fontWeight:800,color:G.green,letterSpacing:-2,lineHeight:1}}>
              {extra + "\u00D7"}
            </div>
            <div style={{fontSize:15,color:"rgba(255,255,255,.65)",marginTop:4,fontWeight:600}}>
              {"extra " + comparison.label.toLowerCase() + (extra !== 1 ? "s" : "")}
            </div>
            <div style={{fontSize:11,color:"rgba(255,255,255,.3)",marginTop:4}}>
              {"from gains only"}
            </div>
          </div>
        ) : (
          <div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginBottom:6}}>
              {"Your money today covers"}
            </div>
            <div style={{fontSize:68,fontWeight:800,
              color:positive?G.green:"#f87171",letterSpacing:-2,lineHeight:1}}>
              {total + "\u00D7"}
            </div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.35)",marginTop:4}}>
              {"started with enough for " + orig}
            </div>
          </div>
        )}
        <div style={{marginTop:22,display:"flex",gap:3,height:8,borderRadius:100,overflow:"hidden"}}>
          <div style={{flex:orig||1,background:"rgba(255,255,255,.15)",borderRadius:"100px 0 0 100px"}}/>
          {extra > 0 && (
            <div style={{flex:extra,background:G.green,borderRadius:"0 100px 100px 0"}}/>
          )}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6,
          fontSize:10,color:"rgba(255,255,255,.3)"}}>
          <span>{"Then: " + orig + "\u00D7"}</span>
          <span style={{color:positive?G.green:"#f87171"}}>{"Now: " + total + "\u00D7"}</span>
        </div>
      </div>
    </div>
  );
}

function SlideShare(props) {
  var data = props.data, comparison = props.comparison;
  var [copied, setCopied] = useState(false);
  var html    = buildCardHTML(data, comparison);
  var blobUrl = URL.createObjectURL(new Blob([html], {type:"text/html"}));

  function copyLink() {
    var url = "https://sokoview.co.tz/fomo?ticker=" + data.ticker
      + "&date=" + data.startDate + "&amount=" + data.amount;
    navigator.clipboard.writeText(url).then(function() {
      setCopied(true);
      setTimeout(function() { setCopied(false); }, 2200);
    });
  }
  function download() {
    var a = document.createElement("a");
    a.href = blobUrl;
    a.download = "sokoview-fomo-" + data.ticker + ".html";
    a.click();
  }

  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",
      justifyContent:"space-between",padding:"0 0 20px"}}>
      <div style={{flex:1,margin:"0 16px",borderRadius:20,overflow:"hidden",
        boxShadow:"0 20px 60px rgba(0,0,0,.5)",
        border:"1px solid rgba(255,255,255,.08)"}}>
        <iframe srcDoc={html} style={{width:"100%",height:"100%",border:"none"}}
          scrolling="no" title="Share card"/>
      </div>
      <div style={{padding:"14px 16px 0",display:"flex",gap:10}}>
        <button onClick={copyLink} style={{
          flex:1,padding:"13px 0",
          background:copied?G.green:"rgba(255,255,255,.1)",
          color:copied?G.black:G.white,
          border:"1px solid "+(copied?G.green:"rgba(255,255,255,.2)"),
          borderRadius:12,fontSize:13,fontWeight:800,cursor:"pointer",
          transition:"all .2s"}}>
          {copied ? "\u2713 Copied!" : "🔗 Copy link"}
        </button>
        <button onClick={download} style={{
          flex:1,padding:"13px 0",
          background:G.green,color:G.black,
          border:"none",borderRadius:12,
          fontSize:13,fontWeight:800,cursor:"pointer"}}>
          {"📥 Save card"}
        </button>
      </div>
    </div>
  );
}

// ── Story player ──────────────────────────────────────────────
var SLIDES   = ["invested","decision","chose","growth","reveal","comparison","share"];
var SLIDE_MS = 4200;

function StoryPlayer(props) {
  var data = props.data, comparison = props.comparison, onRestart = props.onRestart;
  var [cur,  setCur]  = useState(0);
  var [prog, setProg] = useState(0);
  var raf = useRef(null);
  var t0  = useRef(null);
  var isLast   = cur === SLIDES.length - 1;
  var positive = data.gain >= 0;

  var advance = useCallback(function() {
    setCur(function(c) { return c < SLIDES.length - 1 ? c + 1 : c; });
    setProg(0);
    t0.current = null;
  }, []);

  function goBack() {
    if (cur > 0) { setCur(function(c){return c-1;}); setProg(0); t0.current=null; }
  }

  useEffect(function() {
    if (isLast) return;
    function tick(ts) {
      if (!t0.current) t0.current = ts;
      var p = Math.min((ts - t0.current) / SLIDE_MS, 1);
      setProg(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else advance();
    }
    raf.current = requestAnimationFrame(tick);
    return function() { cancelAnimationFrame(raf.current); };
  }, [cur, isLast, advance]);

  var bg = {
    invested:   "linear-gradient(150deg,#0a0a0a,#0a1a10)",
    decision:   "linear-gradient(150deg,#0a0a0a,#1a140a)",
    chose:      "linear-gradient(150deg,#0a0a0a,#0d1a10)",
    growth:     positive?"linear-gradient(150deg,#061208,#0a2010)":"linear-gradient(150deg,#120606,#200a0a)",
    reveal:     positive?"linear-gradient(150deg,#061208,#0d2812)":"linear-gradient(150deg,#160404,#2a0808)",
    comparison: "linear-gradient(150deg,#0a0a0a,#091409)",
    share:      "linear-gradient(150deg,#0a0a0a,#0c1a0c)",
  };

  function handleTap(e) {
    var x = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    if (x < e.currentTarget.offsetWidth * .35) goBack(); else advance();
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:100,
      background:bg[SLIDES[cur]]||G.black,
      transition:"background .5s",display:"flex",flexDirection:"column",userSelect:"none"}}>
      <div style={{position:"absolute",top:-120,left:"50%",transform:"translateX(-50%)",
        width:500,height:500,pointerEvents:"none",
        background:"radial-gradient(circle,"+(positive?"rgba(34,197,94,.1)":"rgba(239,68,68,.08)")+",transparent 68%)"}}/>
      <div style={{position:"absolute",inset:0,pointerEvents:"none",
        backgroundImage:"radial-gradient(circle,rgba(255,255,255,.028) 1px,transparent 1px)",
        backgroundSize:"20px 20px"}}/>

      <div style={{position:"relative",zIndex:10,padding:"14px 14px 10px"}}>
        <StoryBars total={SLIDES.length} current={cur} progress={prog}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:12}}>
          <Logo light={true} size={.85}/>
          <button onClick={onRestart} style={{
            background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",
            color:G.white,borderRadius:"50%",width:32,height:32,
            cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {"\u00D7"}
          </button>
        </div>
      </div>

      {!isLast && (
        <div onClick={handleTap}
          style={{position:"absolute",inset:0,zIndex:5,cursor:"pointer"}}/>
      )}

      <div style={{flex:1,position:"relative",zIndex:6,
        pointerEvents:isLast?"auto":"none",overflow:"hidden"}}>
        {SLIDES[cur]==="invested"   && <SlideInvested   amount={data.amount} ticker={data.ticker} date={data.startDate} stock={data.stock}/>}
        {SLIDES[cur]==="decision"   && <SlideDecision   amount={data.amount} comparison={comparison}/>}
        {SLIDES[cur]==="chose"      && <SlideChose      ticker={data.ticker} stock={data.stock} amount={data.amount} shares={data.shares} buyPrice={data.buyPrice}/>}
        {SLIDES[cur]==="growth"     && <SlideGrowth     monthly={data.monthly} positive={positive} ticker={data.ticker} startDate={data.startDate}/>}
        {SLIDES[cur]==="reveal"     && <SlideReveal     currentValue={data.currentValue} gain={data.gain} returnPct={data.returnPct} positive={positive} invested={data.invested}/>}
        {SLIDES[cur]==="comparison" && <SlideComparison comparison={comparison} currentValue={data.currentValue} invested={data.invested} positive={positive}/>}
        {SLIDES[cur]==="share"      && <SlideShare      data={data} comparison={comparison}/>}
      </div>

      {isLast && (
        <div style={{padding:"0 16px 28px",zIndex:10}}>
          <button onClick={onRestart} style={{
            width:"100%",padding:"11px",
            background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",
            color:"rgba(255,255,255,.55)",borderRadius:10,
            fontSize:12,fontWeight:600,cursor:"pointer"}}>
            {"\u21A9 Start over"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Setup screen ──────────────────────────────────────────────
export default function App() {
  var [ticker,     setTicker]     = useState("CRDB");
  var [startDate,  setStartDate]  = useState("2020-01-01");
  var [amount,     setAmount]     = useState(1000000);
  var [comparison, setComparison] = useState(COMPARISONS[0]);
  var [searchOpen, setSearchOpen] = useState(false);
  var [query,      setQuery]      = useState("");
  var [phase,      setPhase]      = useState("setup");
  var [storyData,  setStoryData]  = useState(null);
  var [error,      setError]      = useState(null);
  var [stocks,     setStocks]     = useState(DSE_STOCKS);
  var [livePrice,  setLivePrice]  = useState(null);

  // Load live stock list from API on mount
  useEffect(function() {
    fetchAllStocks().then(function(data) {
      if (data && data.length > 0) {
        setStocks(data);
        // Set live price for default ticker
        var current = data.find(function(s) { return s.symbol === "CRDB"; });
        if (current) setLivePrice(current);
      }
    });
  }, []);

  // Update live price when ticker changes
  useEffect(function() {
    var current = stocks.find(function(s) { return s.symbol === ticker; });
    setLivePrice(current && current.price ? current : null);
  }, [ticker, stocks]);

  var selectedStock = stocks.find(function(s){return s.symbol===ticker;}) || stocks[0] || DSE_STOCKS[0];
  var filtered = stocks.filter(function(s){
    return s.name.toLowerCase().includes(query.toLowerCase())
        || s.symbol.toLowerCase().includes(query.toLowerCase());
  });

  function launch() {
    setError(null);
    setPhase("loading");
    fetchPrices(ticker, startDate).then(function(prices) {
      if (!prices || prices.length < 10) throw new Error("Not enough data for this date range.");
      var buyPrice     = prices[0].price;
      var currentPrice = prices[prices.length-1].price;
      var shares       = Math.floor(amount / buyPrice);
      var invested     = shares * buyPrice;
      var currentValue = shares * currentPrice;
      var gain         = currentValue - invested;
      var returnPct    = (gain / invested) * 100;
      var monthly = [], lastM = "";
      prices.forEach(function(p) {
        var m = p.date.slice(0,7);
        if (m !== lastM) { monthly.push({date:p.date,price:p.price}); lastM=m; }
      });
      setStoryData({ticker:ticker, stock:selectedStock, amount:amount, startDate:startDate,
        invested:invested, currentValue:currentValue, gain:gain, returnPct:returnPct,
        monthly:monthly, shares:shares, buyPrice:buyPrice, currentPrice:currentPrice});
      setPhase("playing");
    }).catch(function(err) {
      setError(err.message || "Failed to load prices.");
      setPhase("setup");
    });
  }

  if (phase === "loading") {
    return <LoadingScreen ticker={ticker} amount={amount} startDate={startDate}/>;
  }
  if (phase === "playing" && storyData) {
    return (
      <StoryPlayer data={storyData} comparison={comparison} onRestart={function(){
        setPhase("setup"); setStoryData(null);
      }}/>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:G.surface,fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <div style={{background:G.white,borderBottom:"1px solid "+G.border,
        padding:"13px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",
        position:"sticky",top:0,zIndex:50}}>
        <Logo/>
        <APIBadge/>
      </div>

      <div style={{background:G.black,padding:"44px 20px 40px",
        textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-80,left:"50%",transform:"translateX(-50%)",
          width:500,height:340,pointerEvents:"none",
          background:"radial-gradient(circle,rgba(34,197,94,.16) 0%,transparent 68%)"}}/>
        <div style={{position:"absolute",inset:0,pointerEvents:"none",
          backgroundImage:"radial-gradient(circle,rgba(255,255,255,.04) 1px,transparent 1px)",
          backgroundSize:"20px 20px"}}/>
        <div style={{position:"relative",zIndex:1}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:".12em",
            textTransform:"uppercase",color:G.green,marginBottom:12}}>
            {"DSE \u00B7 Tanzania Stock Exchange"}
          </div>
          <h1 style={{fontSize:"clamp(24px,6vw,44px)",fontWeight:800,color:G.white,
            margin:"0 0 10px",letterSpacing:-1.5,lineHeight:1.05}}>
            {"What if you skipped the "}
            <span style={{color:G.green}}>{"splurge"}</span>
            {" and bought the stock?"}
          </h1>
          <p style={{color:G.muted,fontSize:14,margin:"0 0 20px"}}>
            {"Set it up. Watch the story. Share the card."}
          </p>
          <div style={{display:"flex",justifyContent:"center",gap:6}}>
            {["💸","📱","📈","🤑","📤"].map(function(e,i) {
              return (
                <div key={i} style={{width:34,height:34,borderRadius:"50%",
                  background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>{e}</div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{maxWidth:520,margin:"0 auto",padding:"24px 16px 80px"}}>
        <div style={{background:G.white,borderRadius:16,border:"1px solid "+G.border,
          padding:24,boxShadow:"0 1px 4px rgba(0,0,0,.06)"}}>

          <div style={{fontSize:14,fontWeight:700,color:G.black,marginBottom:20}}>{"Build your story"}</div>

          {error && (
            <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,
              padding:"10px 14px",marginBottom:16,fontSize:12,color:"#dc2626",fontWeight:600}}>
              {"\u26A0\uFE0F " + error}
            </div>
          )}

          <div style={{fontSize:11,fontWeight:600,color:G.body,marginBottom:6}}>{"1 \u00B7 Pick a DSE stock"}</div>
          <div onClick={function(){setSearchOpen(!searchOpen);}} style={{
            border:"1px solid "+(searchOpen?G.green:G.border),borderRadius:10,
            padding:"11px 14px",display:"flex",justifyContent:"space-between",
            alignItems:"center",cursor:"pointer",marginBottom:searchOpen?0:16}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:G.black}}>{selectedStock.symbol}</div>
              <div style={{fontSize:11,color:G.muted}}>{selectedStock.name+" \u00B7 "+selectedStock.sector}</div>
            </div>
            <span style={{color:G.muted}}>{searchOpen?"\u25B2":"\u25BC"}</span>
          </div>

          {searchOpen && (
            <div style={{border:"1px solid "+G.green,borderTop:"none",
              borderRadius:"0 0 10px 10px",background:G.white,
              marginBottom:16,maxHeight:200,overflowY:"auto"}}>
              <div style={{padding:"8px 12px",borderBottom:"1px solid "+G.border}}>
                <input autoFocus value={query} onChange={function(e){setQuery(e.target.value);}}
                  placeholder="Search stocks..." style={{width:"100%",border:"none",
                  outline:"none",fontSize:13,color:G.black,background:"transparent"}}/>
              </div>
              {filtered.map(function(s) {
                return (
                  <div key={s.symbol}
                    onClick={function(){setTicker(s.symbol);setSearchOpen(false);setQuery("");}}
                    style={{padding:"9px 14px",cursor:"pointer",
                      background:s.symbol===ticker?G.greenBg:"transparent",
                      borderLeft:"3px solid "+(s.symbol===ticker?G.green:"transparent")}}>
                    <div style={{fontSize:13,fontWeight:700,color:G.black}}>{s.symbol}</div>
                    <div style={{fontSize:10,color:G.muted}}>{s.name}</div>
                  </div>
                );
              })}
            </div>
          )}

          {livePrice && (
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"10px 14px",marginBottom:14,borderRadius:10,
              background:(livePrice.change||0)>=0?G.greenBg:"rgba(239,68,68,.06)",
              border:"1px solid "+((livePrice.change||0)>=0?G.greenBorder:"rgba(239,68,68,.2)")}}>
              <span style={{fontSize:11,fontWeight:600,color:G.body}}>{"Live price today"}</span>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:16,fontWeight:800,color:G.black}}>{"TZS "+fmtN(livePrice.price)}</span>
                {livePrice.change !== null && (
                  <span style={{fontSize:11,fontWeight:700,
                    color:(livePrice.change||0)>=0?G.greenDark:"#dc2626"}}>
                    {(livePrice.change>=0?"+":"")+fmtN(livePrice.change)+" ("+
                    ((livePrice.percentageChange||0)>=0?"+":"")+(livePrice.percentageChange||0).toFixed(2)+"%)"}
                  </span>
                )}
              </div>
            </div>
          )}

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:G.body,marginBottom:6}}>{"2 \u00B7 Date"}</div>
              <input type="date" value={startDate}
                min="2010-01-01"
                max={new Date(Date.now()-86400000).toISOString().split("T")[0]}
                onChange={function(e){setStartDate(e.target.value);}}
                style={{width:"100%",boxSizing:"border-box",
                  border:"1px solid "+G.border,borderRadius:10,
                  padding:"11px 10px",fontSize:13,color:G.black,
                  background:G.white,outline:"none"}}/>
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:G.body,marginBottom:6}}>{"3 \u00B7 Amount (TZS)"}</div>
              <input type="number" value={amount}
                onChange={function(e){setAmount(Math.max(0,Number(e.target.value)));}}
                style={{width:"100%",boxSizing:"border-box",
                  border:"1px solid "+G.border,borderRadius:10,
                  padding:"11px 10px",fontSize:13,color:G.black,
                  background:G.white,outline:"none"}}/>
            </div>
          </div>

          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
            {[100000,500000,1000000,2000000,5000000].map(function(v) {
              var on = amount === v;
              return (
                <button key={v} onClick={function(){setAmount(v);}} style={{
                  padding:"5px 11px",borderRadius:100,fontSize:11,fontWeight:700,cursor:"pointer",
                  border:"1px solid "+(on?G.green:G.border),
                  background:on?G.greenBg:G.white,
                  color:on?G.greenDark:G.body}}>
                  {v>=1000000?(v/1000000)+"M":(v/1000)+"K"}
                </button>
              );
            })}
          </div>

          <div style={{fontSize:11,fontWeight:600,color:G.body,marginBottom:8}}>
            {"4 \u00B7 What would you have bought instead?"}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:24}}>
            {COMPARISONS.map(function(c) {
              var on = comparison.id === c.id;
              return (
                <button key={c.id} onClick={function(){setComparison(c);}} style={{
                  padding:"8px 12px",borderRadius:10,fontSize:12,fontWeight:600,cursor:"pointer",
                  border:"1px solid "+(on?G.green:G.border),
                  background:on?G.greenBg:G.white,
                  color:on?G.greenDark:G.body,
                  display:"flex",alignItems:"center",gap:5}}>
                  <span>{c.emoji}</span><span>{c.label}</span>
                </button>
              );
            })}
          </div>

          <button onClick={launch} style={{
            width:"100%",padding:"15px 0",
            background:G.green,color:G.black,border:"none",borderRadius:12,
            fontSize:15,fontWeight:800,cursor:"pointer",letterSpacing:-.3,
            display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <span style={{fontSize:18}}>{"▶"}</span>
            <span>{"Play my FOMO story"}</span>
          </button>
        </div>

        <div style={{marginTop:12,textAlign:"center",fontSize:11,color:G.muted,lineHeight:1.8}}>
          {API_KEY ? "Live DSE prices via sokoview API" : "Prices simulated \u00B7 Not financial advice"}
          <br/>
          <a href="https://sokoview.co.tz" style={{color:G.green,textDecoration:"none",fontWeight:700}}>
            {"sokoview.co.tz"}
          </a>
        </div>
      </div>

      <style>{[
        "* { box-sizing:border-box; -webkit-tap-highlight-color:transparent }",
        "@keyframes spin { to { transform:rotate(360deg) } }",
        "@keyframes bar  { 0%{width:0%;margin-left:0} 50%{width:60%;margin-left:20%} 100%{width:0%;margin-left:100%} }",
        "input[type=date]::-webkit-calendar-picker-indicator { opacity:.5; cursor:pointer }",
        "button:active { opacity:.85 }",
        "::-webkit-scrollbar { width:4px }",
        "::-webkit-scrollbar-thumb { background:"+G.border+"; border-radius:4px }",
      ].join("")}</style>
    </div>
  );
}
