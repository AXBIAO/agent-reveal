# 打包发布产物：dist/agent-reveal-extension-v<版本>.zip（解压即可"加载已解压的扩展程序"）
# 用法：npm run build 之后执行 pwsh scripts/package.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$ext = Join-Path $root 'extension'
$dist = Join-Path $root 'dist'
foreach ($f in 'agent-reveal.js', 'offscreen.js') {
  if (-not (Test-Path (Join-Path $ext $f))) { throw "extension/$f 不存在，请先运行 npm run build" }
}
$version = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
$zip = Join-Path $dist "agent-reveal-extension-v$version.zip"
New-Item -ItemType Directory -Force $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip }
$staging = Join-Path ([IO.Path]::GetTempPath()) "agent-reveal-pkg-$version"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
Copy-Item $ext $staging -Recurse
Copy-Item (Join-Path $root 'LICENSE'), (Join-Path $root 'THIRD_PARTY_NOTICES.md') $staging
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip
Remove-Item $staging -Recurse -Force
Get-Item $zip | Select-Object Name, @{ n = 'KB'; e = { [math]::Round($_.Length / 1KB, 1) } }
