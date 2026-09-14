# BeLate セットアップ手順（人間がやる作業）

最終更新: 2026-09-14

コードだけでは動かない、外部サービス側の設定と手作業のリスト。
根拠は全て [requirements.md](./requirements.md)。

## 1. LINE公式アカウントとMessaging APIチャネル

> **2024年9月4日以降、LINE DevelopersコンソールからMessaging APIチャネルを直接作成することはできない。**
> LINE公式アカウントを作り、LINE Official Account Manager 側でMessaging APIを有効化すると、
> Developersコンソールにチャネルが自動生成される、という順序になる。

### 1-1. LINE公式アカウントを作る

1. [LINE Business ID](https://account.line.biz/) に登録（LINEアカウント or メールアドレス）
2. [LINE公式アカウント作成フォーム](https://entry.line.biz/) からアカウントを作成
3. [LINE Official Account Manager](https://manager.line.biz/) に表示されることを確認

### 1-2. Messaging API を有効化（ここでプロバイダーが決まる）

LINE Official Account Manager → **設定 → Messaging API → 「Messaging APIを利用する」**

- 初回は開発者情報（名前・メールアドレス）の登録を求められる
- **プロバイダーを選択する。ここで選んだプロバイダーは後から変更できない**
  - 新規なら「BeLate」等の名前で新しいプロバイダーを作る
- 有効化すると、LINE Developersコンソールの**そのプロバイダー配下にMessaging APIチャネルが自動生成される**

### 1-3. LINE Loginチャネル（LIFF用）を追加

LIFFはLINE Loginチャネルに属する。こちらは [LINE Developersコンソール](https://developers.line.biz/console/) で作成する。

- **1-2 で確定したのと同じプロバイダーを選んで** 「新規チャネル作成」→ LINE Login
- アプリタイプ: ウェブアプリ

> **別プロバイダーに置くと userId が一致せず設計が破綻する**（requirements.md §5）。
> プロバイダーは 1-2 で変更不可として確定するため、**必ずMessaging APIを先に作り、後からLINE Loginを同じプロバイダーへ足す**こと。逆順にすると詰む。

### 1-4. 値を控える（LINE Developersコンソール）

| 値 | 場所 |
|---|---|
| `Channel secret` | Messaging APIチャネル → **チャネル基本設定**タブ |
| `Channel access token`（長期） | Messaging APIチャネル → **Messaging API設定**タブ → 発行 |
| `LIFF ID` | LINE Loginチャネル → **LIFF**タブ → LIFFアプリを追加して発行 |

LIFFアプリ追加時の設定:
- サイズ: `Full`
- エンドポイントURL: Workerの `https://<worker>/liff`（デプロイ後に設定 → §4）
- スコープ: `profile` を有効化

### 1-5. Bot側の挙動設定

**LINE Developersコンソール** → Messaging APIチャネル → **Messaging API設定**タブ:
- **Webhook URL** を入力して「更新」（デプロイ後 → §4）
- **Webhookの利用: ON**

**LINE Official Account Manager** → **設定 → 応答設定**:
- **応答メッセージ: OFF**（デフォルトの自動応答がBotの返信と衝突する）
- あいさつメッセージは任意

**LINE Official Account Manager** → **設定 → アカウント設定 → 機能の利用**:
- **「グループ・複数人トークへの参加を許可する」: ON**
  - デフォルトOFF。これを忘れるとBotをグループに招待できず、アプリが一切成立しない

## 2. Cloudflare

1. Cloudflare アカウント作成、`wrangler login`
2. **D1 データベースを作成** し、`database_id` を `wrangler.toml` に記入
3. スキーマ適用（requirements.md §8 のSQL）
4. **Cron Trigger を設定**（集合時刻のPush・3時間経過での自動確定に必須）
5. `wrangler deploy` → 払い出されたURLを控える

## 3. シークレット

`wrangler secret put` で設定：

| 名前 | 用途 |
|---|---|
| `LINE_CHANNEL_SECRET` | Webhook署名検証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Reply / Push 送信 |
| `LIFF_ID` | LIFF初期化（公開値なので `vars` でも可） |

## 4. LINE側へ戻って登録（2周目）

Cloudflare のURLが決まってから：

- LINE Developersコンソール → Messaging APIチャネル → Messaging API設定タブ → **Webhook URL** = `https://<worker>/webhook`
- LINE Developersコンソール → LINE Loginチャネル → LIFFタブ → **エンドポイントURL** = `https://<worker>/liff`

## 5. ローカル開発時のみ

- **HTTPSトンネル**（`cloudflared tunnel` または ngrok）。LIFFはHTTPS必須
- トンネルURLが変わるたびに LINE 側の Webhook / Endpoint を貼り直す

## 6. 利用開始時（グループ側の手作業）

- **Bot をLINEグループに招待**
- **参加者全員が Bot を友だち追加**
  - 未追加だと1:1通知（ダウト・遅刻催促）が届かず、参加が保留になる（§F3）
- グループごとに **ダウト機能を使うか合意を取る**（§F1。人間関係事故の防止）
- 月200通 = **約28イベント/月** で停止する前提を共有しておく（§4）

## やらないもの

アカウント認証申請 / プライバシーポリシー整備 / 決済設定 / 課金プランへの変更。
いずれも requirements.md §2, §11 でスコープ外。
