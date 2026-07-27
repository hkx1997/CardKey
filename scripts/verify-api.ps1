$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:18080"
$out = "E:\dev\CardKey\scripts\verify-out"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$spa = Invoke-WebRequest -Uri "$base/" -UseBasicParsing
$spa.Content | Out-File -Encoding utf8 "$out\index.html"
"SPA_STATUS=$($spa.StatusCode)" | Out-File -Encoding utf8 "$out\spa-status.txt"
if ($spa.Content -notmatch "root") { throw "SPA missing root" }

$h = Invoke-RestMethod -Uri "$base/healthz"
($h | ConvertTo-Json -Compress) | Out-File -Encoding utf8 "$out\health.json"
if (-not $h.success) { throw "health fail" }

$cfg = Invoke-RestMethod -Uri "$base/api/v1/public/config"
($cfg | ConvertTo-Json -Depth 6 -Compress) | Out-File -Encoding utf8 "$out\config.json"
if (-not $cfg.success) { throw "config fail" }
if ($cfg.data.categories.Count -lt 1) { throw "no categories" }

$loginBody = '{"username":"admin","password":"admin123"}'
$login = Invoke-RestMethod -Uri "$base/api/v1/admin/auth/login" -Method Post -ContentType "application/json" -Body $loginBody -SessionVariable sess
($login | ConvertTo-Json -Compress) | Out-File -Encoding utf8 "$out\login-out.json"
if (-not $login.success) { throw "login fail" }
if ($login.data.username -ne "admin") { throw "bad user" }

$stats = Invoke-RestMethod -Uri "$base/api/v1/admin/dashboard/stats" -WebSession $sess
($stats | ConvertTo-Json -Depth 6 -Compress) | Out-File -Encoding utf8 "$out\dashboard.json"
if (-not $stats.success) { throw "dashboard fail" }
if ($null -eq $stats.data.totalCards) { throw "no totalCards" }

$cats = Invoke-RestMethod -Uri "$base/api/v1/admin/categories" -WebSession $sess
($cats | ConvertTo-Json -Depth 6 -Compress) | Out-File -Encoding utf8 "$out\categories.json"
if (-not $cats.success) { throw "categories fail" }

$redeemBody = '{"category":"cdk","code":"CDK-DEMO-A2B3-C4D5-E6F7"}'
$rd = Invoke-RestMethod -Uri "$base/api/v1/public/redeem" -Method Post -ContentType "application/json" -Body $redeemBody
($rd | ConvertTo-Json -Compress) | Out-File -Encoding utf8 "$out\redeem-cdk.json"
if (-not $rd.success) { throw "redeem fail" }
if ($rd.data.content -notmatch "演示") { throw "redeem content unexpected" }

"ALL_CHECKS_PASSED" | Out-File -Encoding utf8 "$out\VERIFY_OK.txt"
Write-Output "ALL_CHECKS_PASSED totalCards=$($stats.data.totalCards) categories=$($cats.data.Count)"
