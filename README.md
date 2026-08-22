# LINE Cafe Reminder Agent

使用 Gemini Function Calling 理解自然語言時間，透過 Google Cloud Tasks 排程，並在指定時間主動傳送 LINE Push Message 的咖啡行程提醒 Bot。

## 功能

- 分享位置後以 Vertex AI Google Maps Grounding 推薦附近咖啡廳
- Gemini Function Calling 解析店家、行程時間與提前提醒分鐘數
- LINE Postback 二次確認後才建立或取消提醒
- Cloud Tasks 使用 OIDC 呼叫受保護的 reminder endpoint
- Firestore 保存推薦 Context、收藏、Pending Action 與 Reminder 狀態
- 查看及取消等待中的提醒
- LINE Retry Key 搭配 Firestore delivery lock，降低重試造成的重複推播
- 行程確認後提供 Google Calendar 預填連結

可以測試：

```text
五分鐘後提醒我去第二間
週六下午兩點去第一間，提前一小時提醒我
查看我的提醒
取消提醒第一個
```

## 流程

```text
LINE 自然語言
    ↓
Gemini schedule_cafe_reminder Function Call
    ↓
驗證店家、時間與提醒範圍
    ↓
LINE Postback 確認
    ↓
Firestore 建立 Reminder
    ↓
Cloud Tasks 建立具 OIDC token 的排程
    ↓ 指定時間
受保護的 /tasks/reminders/:id
    ↓
Firestore delivery lock + LINE Retry Key
    ↓
LINE Push Message
```

## 本機設定

需要 Node.js 20 以上、Google Cloud Application Default Credentials，以及 LINE Messaging API channel。

```bash
npm install
cp .env.example .env
gcloud auth application-default login
npm run dev
```

`.env` 必填：

```dotenv
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
GOOGLE_CLOUD_PROJECT=...
TASKS_SERVICE_ACCOUNT=line-cafe-reminder-agent@YOUR_PROJECT.iam.gserviceaccount.com
SERVICE_URL=https://YOUR_CLOUD_RUN_URL
```

`SERVICE_URL` 必須是 Cloud Run origin，不含 `/webhook` 或結尾斜線。其餘設定請參考 [.env.example](./.env.example)。

## Google Cloud 資源

啟用 API：

```bash
gcloud services enable \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudtasks.googleapis.com
```

建立位於 `asia-east1` 的 Queue：

```bash
gcloud tasks queues create cafe-reminders \
  --location asia-east1 \
  --max-attempts 5 \
  --min-backoff 10s \
  --max-backoff 300s
```

Cloud Run runtime service account 需要：

- `roles/aiplatform.user`
- `roles/datastore.user`
- `roles/cloudtasks.enqueuer`
- `roles/serviceusage.serviceUsageConsumer`

建立 Cloud Task 時，執行身分也必須能對 `TASKS_SERVICE_ACCOUNT` 執行 `iam.serviceAccounts.actAs`。Cloud Tasks service agent 則需要 `roles/iam.serviceAccountTokenCreator`，才能替 Task 產生 OIDC token。

## Cloud Run 部署

Webhook 在 HTTP 200 後繼續處理 Gemini 與 LINE API 工作，因此使用 `--no-cpu-throttling`：

```bash
gcloud run deploy line-cafe-reminder-agent \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --no-cpu-throttling \
  --service-account line-cafe-reminder-agent@YOUR_PROJECT.iam.gserviceaccount.com \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT,GOOGLE_CLOUD_LOCATION=global,CLOUD_TASKS_LOCATION=asia-east1,CLOUD_TASKS_QUEUE=cafe-reminders,TASKS_SERVICE_ACCOUNT=line-cafe-reminder-agent@YOUR_PROJECT.iam.gserviceaccount.com,SERVICE_URL=https://YOUR_CLOUD_RUN_URL
```

`LINE_CHANNEL_SECRET` 與 `LINE_CHANNEL_ACCESS_TOKEN` 建議透過 Secret Manager 或 Cloud Run secret env vars 設定。LINE Webhook URL 為：

```text
https://YOUR_CLOUD_RUN_URL/webhook
```

## 安全與重試

- Gemini 只產生結構化工具呼叫，不會直接建立任務或修改資料。
- Pending Action 有效 10 分鐘，並綁定原使用者與原對話。
- Cloud Tasks endpoint 驗證 Google OIDC token 的 audience、email 與 `email_verified`。
- Reminder delivery 使用 Firestore Transaction claim 與兩分鐘 delivery lock。
- LINE Push 使用由 reminder ID 決定的穩定 Retry Key；即使 Cloud Tasks 重試，也不會用新的 Retry Key 重送。
- 取消提醒會先將 Firestore 狀態改為 `cancelled`，再刪除 Cloud Task。即使刪除暫時失敗，任務也不會通過狀態檢查而推播。

## 測試

```bash
npm test
```

測試涵蓋 Postback data、Calendar 時區、Gemini Function Call 解析、Bearer token 解析與 LINE Retry Key 穩定性。

## Firestore TTL

建議替下列欄位建立 TTL policy：

- `cafe-action-contexts.expiresAt`
- `cafe-pending-actions.expiresAt`
- `cafe-reminders.expiresAt`

程式會即時判斷是否有效；TTL 只負責稍後清理舊資料。
