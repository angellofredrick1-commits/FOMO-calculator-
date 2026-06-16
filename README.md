# Sokoview FOMO Calculator

DSE stock FOMO calculator with IG-style story playback and shareable card.

## Deploy to Netlify

### Option A — Drag & drop
```bash
npm install
npm run build
```
Then drag the `build/` folder to netlify.com/drop

### Option B — GitHub + Netlify CI
1. Push this folder to a GitHub repo
2. Connect on Netlify — it auto-detects everything
3. Build command: `npm run build`
4. Publish directory: `build`

## After deploy

Add your Netlify URL to CORS in your NestJS main.ts:

```ts
app.enableCors({
  origin: [
    'http://localhost:3000',
    'https://your-app.netlify.app',
    'https://sokoview.co.tz',
  ],
});
```

## API config (src/App.jsx line 8-9)

```js
const API_BASE = "https://api-staging.sokoview.co.tz"; // swap to production when ready
const API_KEY  = "skv_live_...";
```
