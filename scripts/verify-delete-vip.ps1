$ErrorActionPreference = "Continue"
$base = "http://127.0.0.1:18080"
$loginBody = '{"username":"admin","password":"admin123"}'
$null = Invoke-RestMethod -Uri "$base/api/v1/admin/auth/login" -Method Post -Body $loginBody -ContentType "application/json; charset=utf-8" -SessionVariable sess
$cats = Invoke-RestMethod -Uri "$base/api/v1/admin/categories" -WebSession $sess
Write-Host "count=" $cats.data.Count
foreach ($c in $cats.data) {
  Write-Host ("cat {0} used={1}" -f $c.slug, $c.usedCount)
}
$vip = $cats.data | Where-Object { $_.slug -eq "vip" } | Select-Object -First 1
Write-Host "vip id=" $vip.id "used=" $vip.usedCount
try {
  $r = Invoke-WebRequest -Uri "$base/api/v1/admin/categories/$($vip.id)" -Method Delete -WebSession $sess -UseBasicParsing
  Write-Host "UNEXPECTED success status=" $r.StatusCode "body=" $r.Content
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body = $reader.ReadToEnd()
    Write-Host "STATUS" ([int]$resp.StatusCode) "BODY" $body
  } else {
    Write-Host "ERR" $_
  }
}
