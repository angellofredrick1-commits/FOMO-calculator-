// Netlify serverless function — proxies Sokoview live prices
// Called as: GET /.netlify/functions/prices?symbol=CRDB
//        or: GET /.netlify/functions/prices (all stocks)

const SOKOVIEW_BASE = "https://api-staging.sokoview.co.tz";
const SOKOVIEW_KEY  = "skv_live_ef0939a5eb133b5ec5620df82b5be6caa48c49723211be72";

exports.handler = async function(event) {
  const symbol = event.queryStringParameters && event.queryStringParameters.symbol;
  const url = symbol
    ? SOKOVIEW_BASE + "/api/v1/market/prices/" + symbol.toUpperCase()
    : SOKOVIEW_BASE + "/api/v1/market/prices";

  try {
    const res = await fetch(url, {
      headers: {
        "x-api-key": SOKOVIEW_KEY,
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: "Sokoview API error: " + res.status }),
      };
    }

    const data = await res.json();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
