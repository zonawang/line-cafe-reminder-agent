# 我收藏了咖啡廳，還是會忘記去：我和 Codex 讓 LINE Bot 在正確時間主動提醒我

上一篇，我替 Cafe Bot 加上了 Gemini Function Calling。

使用者分享位置、看到附近咖啡廳之後，可以直接說：

> 收藏第二間。

Gemini 會理解這句話，選擇正確的工具，再經過 LINE 確認，把店家安全地存進 Firestore。

後來我又加上 Google Calendar 預填連結。使用者可以說「下週六下午兩點安排第二間」，Bot 會把店家和時間填進行事曆。

做到這裡，功能看起來已經很完整了，但我很快想到一個非常現實的問題：

我就算收藏了，也放進行事曆了，還是可能忘記去。

所以這次我想讓 Bot 再往前一步。它不只替我記住咖啡廳，而是可以聽懂：

> 週六下午兩點去第二間，提前一小時提醒我。

然後真的在正確時間，主動傳一則 LINE 訊息給我。

這就是這次 Cafe Reminder Agent 的起點。

---

## 這次真正困難的，不是「提醒」兩個字

一開始看起來，定時提醒好像只要把時間存起來，到了再送訊息就好。

但我和 Codex 把流程拆開後，才發現裡面其實有一整串問題：

- 使用者說的「週六下午」到底是哪一天、幾點？
- 「提前一小時」要怎麼換算成真正的提醒時間？
- Cloud Run 隨時可能縮容，誰負責記得時間到了？
- 排程任務怎麼證明自己不是外部偽造的請求？
- LINE API 暫時失敗時，應該怎麼重試？
- 重試會不會讓同一則提醒傳兩次？
- 使用者取消提醒時，任務剛好正在執行怎麼辦？

所以這次做的，不只是一個計時器，而是一條能被驗證、能重試、也能安全取消的提醒流程。

---

## Gemini 把自然語言時間，整理成穩定的 Function Call

使用者不會想照固定格式輸入日期。

他可能會說：

```text
五分鐘後提醒我去第二間
週六下午兩點去第一間，提前一小時提醒
下星期日晚上提醒我去第三間
```

如果全部依靠字串規則處理，很快就會被不同語序、相對日期和模糊時段弄得很複雜。

所以這次我替 Gemini 定義了一個新的工具：

```text
schedule_cafe_reminder
```

它需要回傳：

```json
{
  "cafe_number": 2,
  "visit_time": "2026-08-22T19:35:00+08:00",
  "remind_minutes_before": 0,
  "duration_minutes": 90
}
```

例如「五分鐘後提醒我去第二間」，代表五分鐘後就是提醒與行程時間，因此 `remind_minutes_before` 會是 `0`。

如果使用者說「週六兩點去，提前一小時提醒」，Gemini 則會把行程時間設為週六 14:00，再回傳提前 60 分鐘。

我和 Codex 還用真實的 Vertex AI Gemini 呼叫測了一次「五分鐘後提醒我去第二間」。模型真的選中了 `schedule_cafe_reminder`，店家編號是 2，時間也正確往後推了五分鐘。

這裡仍然維持上一個 Action Agent 的原則：

> Gemini 負責理解使用者想做什麼，後端負責驗證這件事能不能做。

模型回傳之後，程式會再次確認：

- 店家編號是否真的存在
- 行程與提醒時間是否在未來
- 提醒是否至少在 30 秒後
- 排程是否落在 Cloud Tasks 支援的 30 天範圍內
- 活動長度是否在合理範圍

自然語言可以有彈性，真正進入系統的資料仍然要有邊界。

---

## 為什麼不能直接在 Cloud Run 裡放一個計時器？

最直覺的做法，可能是在程式裡使用 `setTimeout`，或每隔一段時間掃描 Firestore。

但 Cloud Run 是無狀態的 Serverless 服務。Instance 可以重啟、縮容，甚至在沒有請求時完全消失。

如果提醒被記在某個 process 的記憶體裡，那個 process 一旦不見，提醒也跟著不見。

所以這次使用 Google Cloud Tasks。

使用者確認後，後端會建立一個 Task，指定未來的執行時間。到了那個時間，由 Cloud Tasks 主動呼叫 Reminder Agent 的任務端點。

```text
LINE 使用者設定提醒
        ↓
Firestore 保存 Reminder
        ↓
Cloud Tasks 排定執行時間
        ↓ 時間到
呼叫 Reminder endpoint
        ↓
LINE Push Message
```

這樣即使 Cloud Run 中間縮到 0，Cloud Tasks 到時間仍然會把服務叫醒。

提醒不再依賴某一台機器「一直活著」。

---

## Cloud Run 是公開的，提醒端點不能跟著毫無防備

LINE Webhook 必須能從外部存取，所以整個 Cloud Run service 是公開的。

但提醒任務端點不能因為這樣就接受任何人的請求。否則只要知道 URL，就可能偽造提醒或反覆觸發 Push Message。

這次 Cloud Tasks 在呼叫任務端點時，會附上一個 Google 簽發的 OIDC ID token。

後端會檢查：

- Authorization 是否為 Bearer token
- token 的 audience 是否是目前的 Cloud Run service
- token 內的 email 是否為指定的 reminder service account
- `email_verified` 是否為真

只有身分與目標都正確，任務才會繼續執行。

為了確認這條通道真的有效，我和 Codex 建立了一個不包含真實使用者資料的 smoke task。Cloud Tasks 成功產生 OIDC token，受保護端點驗證通過並回傳 `204`。

同一個 endpoint 如果不帶 token 直接呼叫，則會回 `401`。

這是我很喜歡的一個測試：它不只是確認「URL 打得通」，還同時確認正確身分可以進去、沒有身分的人會被擋下來。

---

## Cloud Tasks 會重試，但重試不能變成重複提醒

排程服務一定要考慮失敗。

如果 LINE API 暫時沒有回應，Cloud Tasks 應該重試；但如果第一則訊息其實已經送出，只是後端來不及更新狀態，下一次重試就可能再傳一則一模一樣的提醒。

所以這次用了兩層保護。

第一層是 Firestore delivery lock。

任務開始時，後端會透過 Transaction 檢查 Reminder 狀態。已經 `sent` 或 `cancelled` 的提醒不會再執行；正在由另一個請求處理的提醒，也不會被同時領走。

第二層是 LINE Retry Key。

程式會依照 reminder ID 產生一個固定的 UUID。即使 Cloud Tasks 重試，同一筆提醒送給 LINE 時仍然使用相同 Retry Key，而不是每次產生新的值。

```text
同一筆 Reminder
    ↓
固定 Retry Key
    ↓
Cloud Tasks 即使重試
    ↓
LINE 仍可辨認為同一次 Push 請求
```

Firestore 負責管理系統內部狀態，LINE Retry Key 則補上外部 API 已接收、但本地狀態還沒更新的灰色地帶。

我原本只想到「失敗要重試」，但 Codex 進一步提醒我：可靠的重試，不只是再做一次，還要讓再做一次不會造成新的問題。

---

## 取消提醒時，先改狀態，再刪除 Task

這一版也支援：

```text
查看我的提醒
取消提醒第一個
```

取消仍然要經過 LINE 的「確認執行／取消」按鈕，不會因為 Gemini 判斷出取消意圖，就直接刪除資料。

真正執行時，順序也很重要：

```text
先把 Firestore Reminder 設為 cancelled
                ↓
再呼叫 Cloud Tasks 刪除排程
```

為什麼不是先刪 Task？

因為刪除 API 可能暫時失敗。如果先把 Firestore 狀態改成 `cancelled`，即使 Task 沒有立刻刪掉、之後仍然打到 endpoint，後端也會在狀態檢查時停止，不會真的推播。

也就是說，資料狀態才是最後一道防線，刪除 Task 則是後續清理。

---

## 部署時又遇到一個很像「明明成功，卻還沒完成」的狀況

這次 Cloud Build 顯示映像建置成功，但新的 Cloud Run service 一開始卻沒有出現。

如果只看 build 的綠色狀態，很容易以為服務已經上線；但往下查才發現，流程完成了容器建置，卻沒有走完建立 revision 與導流的最後一步。

Codex 沒有重跑整包工作，而是先確認成功建置的映像，再直接用那份映像完成 Cloud Run deploy。

這讓我再次記住：

> Build 成功，代表容器準備好了；不一定代表使用者已經連到新版本。

後來新服務通過 `/health`、Cloud Tasks OIDC smoke test 和 LINE 官方 Webhook Verify，才把 Webhook 從上一版 Action Agent 切到新的 Reminder Agent。

切換過程仍然保留舊 endpoint；如果 Verify 失敗，就會自動切回去。

---

## 這次一共驗證了什麼？

除了 TypeScript build，專案目前有 14 項自動測試，涵蓋：

- Gemini Function Call 解析
- 提前提醒時間計算
- 0 分鐘 lead time 的快速測試情境
- 30 秒下限與 30 天上限
- Postback data
- Google Calendar 時區
- Bearer token 格式
- LINE Retry Key 的穩定性與 UUID 格式

雲端部分另外確認：

- Cloud Run health check 正常
- 未帶 OIDC token 的任務請求回 `401`
- Cloud Tasks 正確身分呼叫回 `204`
- 真實 Gemini API 能選中 `schedule_cafe_reminder`
- LINE 官方 Webhook Verify 回 `200 OK`
- 最新 revision 沒有 error log

最後的實機測試方式很簡單：

```text
重新分享位置
→ 輸入「兩分鐘後提醒我去第二間」
→ 立即按下「確認執行」
→ 等待 LINE 主動傳送提醒
```

這條路徑會一次驗證 Gemini、Firestore、Cloud Tasks、OIDC 和 LINE Push Message。

---

## 從會回答，到會在正確時間出現

回頭看，這幾次 Cafe Bot 的進化很有意思：

```text
會根據位置找咖啡廳
→ 記得上一輪，可以換一批
→ 聽懂「收藏第二間」
→ 幫我準備 Calendar 行程
→ 在正確時間主動提醒我
```

這次真正新增的，不只是一則 Push Message，而是讓 Bot 有了一個跨越時間的能力。

使用者現在說一句話，系統可以把意圖保存下來，等到未來的某一刻，再可靠地完成它。

而要讓這件事真的值得信任，Gemini、Cloud Tasks、Firestore、OIDC 和 LINE Retry Key 缺一不可。

我這次最想留下的一句話是：

> 會主動提醒的 Agent，不只是知道現在該回答什麼，也要可靠地記得未來答應過什麼。

---

## 本篇完整程式碼

GitHub：
https://github.com/zonawang/line-cafe-reminder-agent

更多 LINE Bot 與 AI 實作紀錄：
https://github.com/zonawang/zona-ai-learning-lab

