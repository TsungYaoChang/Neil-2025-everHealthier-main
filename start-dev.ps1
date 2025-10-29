# PowerShell script to start development server with environment variables
# 啟動開發伺服器的 PowerShell 腳本

Write-Host "🚀 Starting Ever Healthier Development Server..." -ForegroundColor Cyan
Write-Host ""

# Set OpenRouter API Keys as environment variables
# 設置 OpenRouter API Keys 為環境變數
# ⚠️ IMPORTANT: Replace these with your actual API keys
# ⚠️ 重要:請替換為你的實際 API keys

$env:OPENROUTER_CLINIC_INSIGHT = "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"
$env:OPENROUTER_PATIENT_ARTICLE_RANKING = "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"
$env:OPENROUTER_PATIENT_INSIGHT = "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"

Write-Host "✓ Environment variables set" -ForegroundColor Green
Write-Host ""
Write-Host "Starting Node.js server..." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""

# Start the Node.js server
# 啟動 Node.js 伺服器
node fhir-proxy.js
