# BeLate

LINEグループの集合イベント、遅刻罰金、秘密のダウト、位置・到着報告、精算、戦績を扱う Cloudflare Workers + Hono + D1 アプリです。

## Development

```sh
npm install
npx wrangler d1 create belate
# wrangler.toml の database_id を更新
npm run db:migrate:local
npm run dev
```

`.dev.vars` に `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LIFF_ID` を設定してください。本番は `wrangler secret put <NAME>` を使います。

```sh
npm run check
npm run db:migrate:remote
npm run deploy
```

LINE側の設定と同一プロバイダー制約は [docs/setup.md](docs/setup.md) を参照してください。
