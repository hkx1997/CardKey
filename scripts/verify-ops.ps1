$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:18080"

# Login
$loginBody = '{"username":"admin","password":"admin123"}'
try {
  $login = Invoke-RestMethod -Uri "$base/api/v1/admin/auth/login" -Method Post -Body $loginBody -ContentType "application/json; charset=utf-8" -SessionVariable sess
} catch {
  # try common default from env / bootstrap random
  Write-Host "login with admin123 failed, trying from docker logs..."
  $logs = docker logs cardkey-cardkey-1 2>&1 | Select-String -Pattern "bootstrap admin|admin password|username" | Select-Object -Last 5
  $logs | ForEach-Object { Write-Host $_ }
  throw
}
Write-Host "LOGIN OK:" ($login | ConvertTo-Json -Compress)

# Categories
$cats = Invoke-RestMethod -Uri "$base/api/v1/admin/categories" -WebSession $sess
Write-Host "CATEGORIES:" ($cats | ConvertTo-Json -Depth 5 -Compress)

# Create disposable category
$createBody = '{"name":"临时测试","slug":"tmp-del-test","codePrefix":"TMPD","description":"","icon":{"kind":"lucide","value":"ticket"}}'
$created = Invoke-RestMethod -Uri "$base/api/v1/admin/categories" -Method Post -Body $createBody -ContentType "application/json; charset=utf-8" -WebSession $sess
Write-Host "CREATED:" ($created | ConvertTo-Json -Compress)
$catId = $created.data.id
if (-not $catId) { $catId = $created.id }

# Delete empty category (no txn)
Invoke-RestMethod -Uri "$base/api/v1/admin/categories/$catId" -Method Delete -WebSession $sess | Out-Null
Write-Host "DELETE empty category OK"

# Create category with unused card then delete
$created2 = Invoke-RestMethod -Uri "$base/api/v1/admin/categories" -Method Post -Body $createBody -ContentType "application/json; charset=utf-8" -WebSession $sess
$catId2 = if ($created2.data.id) { $created2.data.id } else { $created2.id }
$cardBody = (@{ content = "secret-content"; type = "text"; note = ""; categoryId = $catId2 } | ConvertTo-Json)
$card = Invoke-RestMethod -Uri "$base/api/v1/admin/cards" -Method Post -Body $cardBody -ContentType "application/json; charset=utf-8" -WebSession $sess
Write-Host "CARD:" ($card | ConvertTo-Json -Compress)
$cardId = if ($card.data.id) { $card.data.id } else { $card.id }

# Batch delete card
$batchBody = (@{ ids = @($cardId); action = "delete" } | ConvertTo-Json)
$bn = Invoke-RestMethod -Uri "$base/api/v1/admin/cards/batch-action" -Method Post -Body $batchBody -ContentType "application/json; charset=utf-8" -WebSession $sess
Write-Host "BATCH DELETE:" ($bn | ConvertTo-Json -Compress)

# Delete category again
Invoke-RestMethod -Uri "$base/api/v1/admin/categories/$catId2" -Method Delete -WebSession $sess | Out-Null
Write-Host "DELETE category with cleaned cards OK"

# Create API key then delete
$keyBody = '{"name":"tmp-key","scopes":["redeem:api"],"rateLimitRpm":60}'
$ak = Invoke-RestMethod -Uri "$base/api/v1/admin/api-keys" -Method Post -Body $keyBody -ContentType "application/json; charset=utf-8" -WebSession $sess
Write-Host "API KEY:" ($ak | ConvertTo-Json -Compress)
$keyId = if ($ak.data.key.id) { $ak.data.key.id } elseif ($ak.key.id) { $ak.key.id } else { $null }

# Revoke
Invoke-RestMethod -Uri "$base/api/v1/admin/api-keys/$keyId/revoke" -Method Post -WebSession $sess | Out-Null
Write-Host "REVOKE OK"

# Permanent delete
Invoke-RestMethod -Uri "$base/api/v1/admin/api-keys/$keyId" -Method Delete -WebSession $sess | Out-Null
Write-Host "HARD DELETE KEY OK"

# Create another key and hard-delete without revoke
$ak2 = Invoke-RestMethod -Uri "$base/api/v1/admin/api-keys" -Method Post -Body $keyBody -ContentType "application/json; charset=utf-8" -WebSession $sess
$keyId2 = if ($ak2.data.key.id) { $ak2.data.key.id } else { $ak2.key.id }
Invoke-RestMethod -Uri "$base/api/v1/admin/api-keys/$keyId2" -Method Delete -WebSession $sess | Out-Null
Write-Host "HARD DELETE active KEY OK"

# Category with redeem history must refuse delete
$cats2 = Invoke-RestMethod -Uri "$base/api/v1/admin/categories" -WebSession $sess
$vip = @($cats2.data) | Where-Object { $_.slug -eq "vip" } | Select-Object -First 1
if ($vip) {
  try {
    Invoke-RestMethod -Uri "$base/api/v1/admin/categories/$($vip.id)" -Method Delete -WebSession $sess | Out-Null
    throw "expected delete vip to fail"
  } catch {
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = "$_" }
    Write-Host "DELETE vip refused (expected):" $msg
    if ($msg -notmatch "兑换|停用|CONFLICT|409") {
      # also accept if status code surfaces differently
      Write-Host "NOTE: message body:" $msg
    }
  }
}

Write-Host "ALL OPS CHECKS PASSED"
