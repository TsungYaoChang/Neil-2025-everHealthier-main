# Ever Healthier - Local Development Setup

## 🚀 快速開始

### 1. 設置 API Keys (環境變數)

**選項 A: 使用 PowerShell 啟動腳本 (推薦)**

```powershell
# 1. 複製範例文件
copy start-dev.ps1.example start-dev.ps1

# 2. 編輯 start-dev.ps1,替換為你的實際 API keys
# 使用任何文本編輯器打開 start-dev.ps1

# 3. 啟動伺服器
.\start-dev.ps1
```

**選項 B: 手動設置環境變數**

```powershell
# 設置環境變數
$env:OPENROUTER_CLINIC_INSIGHT="sk-or-v1-your-key-here"
$env:OPENROUTER_PATIENT_ARTICLE_RANKING="sk-or-v1-your-key-here"
$env:OPENROUTER_PATIENT_INSIGHT="sk-or-v1-your-key-here"

# 啟動伺服器
node fhir-proxy.js
```

### 2. 訪問應用程式

伺服器啟動後,打開瀏覽器訪問:
- http://localhost:3001/login.html

## 🔒 API Keys 管理

### 本地開發
- API Keys 通過環境變數傳遞給後端
- 後端代理所有 OpenRouter API 請求
- 前端永不直接接觸 API Keys

### 生產環境 (Render.com)
1. 前往 Render Dashboard
2. 選擇你的 Web Service
3. 進入 "Environment" 標籤
4. 添加環境變數:
   - `OPENROUTER_CLINIC_INSIGHT`
   - `OPENROUTER_PATIENT_ARTICLE_RANKING`
   - `OPENROUTER_PATIENT_INSIGHT`

## 📁 API 端點

前端應該呼叫這些端點而不是直接呼叫 OpenRouter:

```javascript
// 使用後端代理端點
const BACKEND_URL = window.APP_CONFIG.BACKEND_URL;

// Clinic Insight
fetch(`${BACKEND_URL}/api/openrouter/clinic-insight`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: "meta-llama/llama-3.2-3b-instruct:free",
    messages: [{ role: "user", content: "Your prompt here" }]
  })
});

// Patient Article Ranking
fetch(`${BACKEND_URL}/api/openrouter/article-ranking`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ /* your request */ })
});

// Patient Insight
fetch(`${BACKEND_URL}/api/openrouter/patient-insight`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ /* your request */ })
});
```

## ✅ 驗證設置

啟動伺服器後,檢查終端輸出:

```
OpenRouter API Keys loaded: {
  CLINIC_INSIGHT: '✓ Set',
  PATIENT_ARTICLE_RANKING: '✓ Set',
  PATIENT_INSIGHT: '✓ Set'
}
```

如果看到 `✗ Missing`,表示環境變數未設置。

## 🛠️ 疑難排解

### API Keys 未設置
確認環境變數已設置:
```powershell
echo $env:OPENROUTER_CLINIC_INSIGHT
```

### 前端無法呼叫 API
確認使用正確的端點 URL:
```javascript
// ✓ 正確
`${BACKEND_URL}/api/openrouter/clinic-insight`

// ✗ 錯誤 - 不要直接呼叫 OpenRouter
'https://openrouter.ai/api/v1/chat/completions'
```
