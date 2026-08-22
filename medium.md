# 我收藏了咖啡廳，還是會忘記去：我和 Codex 讓 LINE Bot 在正確時間主動提醒我

上一篇，我替 Cafe Bot 加上了收藏功能。

使用者看完附近咖啡廳推薦後，可以直接說「收藏第二間」。Gemini 會理解這句話，再把店家存進 Firestore。

後來我也做了 Google Calendar 預填連結。使用者只要說「週六下午兩點去第二間」，Bot 就能把店家和時間先填進行事曆。

但我想到自己平常的使用習慣，突然覺得還少了一塊。

收藏了，不代表我會記得看；放進 Calendar，也不代表我不會忘記。

如果 Bot 已經知道我要去哪裡、什麼時候去，它能不能在時間快到時，主動傳 LINE 提醒我？

所以我接著做了這個功能：

> 週六下午兩點去第二間，提前一小時提醒我。

看起來只比上一版多了「提醒我」三個字，實際做下去，卻比我原本想的複雜不少。

---

## 我原本以為，這只是一個線上鬧鐘

一開始我想得很簡單：把時間存起來，時間到了就傳訊息。

和 Codex 拆解流程後，我才發現裡面藏著很多小問題。

「週六下午」是哪一天？「提前一小時」要從哪個時間往前算？如果 Cloud Run 半夜縮到 0，誰還記得要叫醒它？如果 LINE API 暫時失敗，重試時會不會傳出兩則一樣的提醒？

還有一個更容易忽略的問題：提醒用的網址放在公開的 Cloud Run 上，怎麼知道打進來的真的是 Google Cloud Tasks，而不是有人在外面亂按？

所以這次真正要做的，不只是一個計時器，而是一條可以安全排程、失敗重試，也能取消的提醒流程。

---

## 先讓 Gemini 聽懂「什麼時候提醒」

使用者不會每次都乖乖輸入 `2026-08-22 14:00`。

比較自然的說法通常是：

```text
五分鐘後提醒我去第二間
週六下午兩點去第一間，提前一小時提醒
下星期日晚上提醒我去第三間
```

如果全部用字串規則處理，不只要判斷「這週」和「下週」，還要面對不同語序。規則很快就會變得又長又難維護。

這次我替 Gemini 定義了一個 Function：

```text
schedule_cafe_reminder
```

Gemini 收到自然語言後，要整理出四個欄位：哪一間咖啡廳、預計到訪時間、提前幾分鐘提醒，以及預計停留多久。

例如「五分鐘後提醒我去第二間」，它會轉成：

```json
{
  "cafe_number": 2,
  "visit_time": "2026-08-22T19:35:00+08:00",
  "remind_minutes_before": 0,
  "duration_minutes": 90
}
```

這裡的 `0` 不是沒有提醒，而是「提醒時間就是五分鐘後」，不需要再從行程時間往前扣。

我和 Codex 也真的呼叫 Vertex AI Gemini，拿「五分鐘後提醒我去第二間」做測試。模型選中了正確的 Function，店家是第二間，時間也正確往後推了五分鐘。

不過，Gemini 聽懂之後，程式還是會再檢查一次。店家編號必須存在，提醒至少要在 30 秒後，而且不能超過 Cloud Tasks 可排程的 30 天範圍。

我把兩邊的工作分得很清楚：Gemini 負責理解人話，程式負責守規則。

---

## Cloud Run 會休息，所以需要 Cloud Tasks 幫忙記時間

最直覺的提醒做法，是在 Node.js 裡放一個 `setTimeout`。

但 Cloud Run 不是一台會永遠開著的主機。沒有流量時，它可能縮容；Instance 也可能重啟。如果提醒只存在某個 process 的記憶體裡，那個 process 一消失，提醒也會一起消失。

這就是我選擇 Google Cloud Tasks 的原因。

使用者按下確認後，後端會先把 Reminder 存進 Firestore，再交給 Cloud Tasks 一個未來時間。時間到了，Cloud Tasks 會主動呼叫 Reminder Agent，Cloud Run 就算原本縮到 0，也會被這個請求叫醒。

```text
使用者設定提醒
    ↓
Firestore 保存內容
    ↓
Cloud Tasks 記住執行時間
    ↓
時間到，喚醒 Cloud Run
    ↓
LINE Push Message
```

簡單說，Firestore 記得「要提醒什麼」，Cloud Tasks 記得「什麼時候要做」。

---

## 公開網址上的任務端點，不能誰都能叫

LINE Webhook 必須讓 LINE 從外部打進來，所以 Cloud Run service 是公開的。

但提醒任務的 endpoint 不應該跟著門戶大開。不然只要有人知道網址，就可能反覆觸發提醒。

Codex 在這裡幫我加了一道身分驗證。Cloud Tasks 呼叫 endpoint 時，會帶一張由 Google 簽發的 OIDC ID token。後端收到後，會確認這張 token 是發給目前的 Cloud Run service，而且裡面的 service account 正是我指定的提醒服務身分。

可以把它想成員工證：網址雖然找得到，但沒有正確證件，還是不能進入真正的任務流程。

為了驗證它，我們做了兩個方向的測試。

直接呼叫 endpoint、沒有帶 token 時，服務回 `401 Unauthorized`；透過 Cloud Tasks 帶著正確 OIDC token 呼叫，則成功回 `204`。

這比單純看到網址回應更讓我安心，因為它同時證明了「對的人進得來，不對的人會被擋下來」。

---

## 可以重試，但不能重複提醒

Cloud Tasks 很重要的一個能力是自動重試。

假設提醒時間到了，但 LINE API 剛好暫時沒有回應，Cloud Tasks 可以晚一點再試。問題是，如果第一則訊息其實已經送到 LINE，只是後端還沒來得及把 Firestore 標成完成，下一次重試就可能再傳一則。

沒有人想在同一分鐘收到兩次「該去喝咖啡囉」。

所以這次做了兩層保護。

第一層在 Firestore。每次執行前，程式會用 Transaction 取得 Reminder 的處理權。已經送出、已取消，或正在被另一個請求處理的提醒，都不會再執行。

第二層在 LINE。每一筆 Reminder 都會產生固定的 Retry Key。同一個提醒就算因為 Cloud Tasks 重試，再次呼叫 LINE API，也會使用同一把 key，讓 LINE 知道這不是一個全新的推播要求。

我原本只想到「失敗要再試一次」，Codex 則提醒我另一半也同樣重要：再試一次時，不能製造新的問題。

---

## 取消提醒，順序也有差

這一版除了設定提醒，也可以直接說：

```text
查看我的提醒
取消提醒第一個
```

取消不會立刻執行。Bot 還是會先顯示「確認執行」和「取消」，等使用者確認後才動作。

真正取消時，程式會先把 Firestore 裡的 Reminder 改成 `cancelled`，再向 Cloud Tasks 刪除排程。

為什麼要先改資料？

因為刪除 Cloud Task 也可能暫時失敗。如果 Firestore 已經是 `cancelled`，就算那個 Task 後來真的打進來，後端看到狀態後仍會停下，不會傳送 LINE 訊息。

我很喜歡這個小設計。它不是期待每一個外部 API 都永遠成功，而是先確保失敗時不會打擾使用者。

---

## 容器 build 成功，不代表新版已經上線

部署時也出現了一段很真實的小插曲。

Cloud Build 顯示成功，但新的 Cloud Run service 一開始沒有出現。換句話說，容器映像已經做好了，發布流程卻沒有走完最後一步。

如果只看到綠色的 build 狀態，很容易以為一切都完成了。

Codex 往下查了 Cloud Build 與 Cloud Run 的實際狀態，確認映像本身沒有問題後，直接用那份映像完成部署，不需要整包重做。

這次又讓我記住一件事：build 成功，只代表貨打包好了；有沒有真的送到使用者面前，還要另外確認。

最後，新服務通過了 health check、Cloud Tasks OIDC smoke test 與 LINE 官方 Webhook Verify，Webhook 才從上一版 Action Agent 切到新的 Reminder Agent。如果 Verify 失敗，流程也準備好自動切回舊網址。

---

## 這一版怎麼測？

專案目前有 14 項自動測試，包含 Function Call 解析、提醒時間換算、30 秒與 30 天邊界、Bearer token、Postback data，以及 LINE Retry Key 是否穩定。

雲端部分則實際驗證了 Gemini Function Calling、Cloud Tasks Queue、OIDC 身分、Cloud Run health check 和 LINE Webhook。

最後在手機上的測試方式很簡單：

```text
重新分享位置
→ 輸入「兩分鐘後提醒我去第二間」
→ 立即按下「確認執行」
→ 等待 LINE 主動傳送提醒
```

看起來只是等兩分鐘，背後卻會一次走過 Gemini、Firestore、Cloud Tasks、OIDC 和 LINE Push Message。

---

## 從記住一家店，到記住未來答應過的事

回頭看，Cafe Bot 是一小步一小步長出來的。

它先學會根據位置找店，接著可以換一批、收藏店家、準備 Calendar 行程，現在又多了在正確時間主動出現的能力。

這次讓我最有感的，不是 Bot 多傳了一則訊息，而是使用者現在說完一句話就可以離開。系統會把這個約定保存下來，等未來時間到了，再把答應的事情完成。

我想替這次實作留下一句話：

> 會提醒人的 Agent，不只要聽懂現在說了什麼，也要可靠地記得未來答應過什麼。

---

## 本篇完整程式碼

GitHub：
https://github.com/zonawang/line-cafe-reminder-agent

更多 LINE Bot 與 AI 實作紀錄：
https://github.com/zonawang/zona-ai-learning-lab

