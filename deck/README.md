# Dayboard — Stream Deck plugin

The plugin (`com.dayboard.deck.sdPlugin`, source in `src/`) and the profile
generator (`scripts/make-profile.mjs`). Full instructions: [`../docs/streamdeck.md`](../docs/streamdeck.md).

```powershell
npm install
npm run build                     # -> com.dayboard.deck.sdPlugin/bin/plugin.js
npm run link                      # symlink into the Stream Deck plugins folder
npm run profile -- --model mk2    # -> Dayboard.streamDeckProfile (mk2 | mini | xl | plus | neo)
```

The plugin only knows one address, `DAYBOARD_URL` or `http://127.0.0.1:6767`,
and speaks the vocabulary in `../src/lib/deck.ts`.
