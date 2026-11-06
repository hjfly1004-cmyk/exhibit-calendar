# Daily task: read the Neolook list on this PC and push data/neolook.json to GitHub.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Set-Location (Split-Path $PSScriptRoot -Parent)
$log = Join-Path (Get-Location) 'neolook.log'
function Run-Step([string]$name, [scriptblock]$step) {
  "[$(Get-Date -Format s)] $name" | Out-File -Append -Encoding utf8 $log
  & $step 2>&1 | Out-File -Append -Encoding utf8 $log
  return $LASTEXITCODE
}

Run-Step 'pull' { git pull --rebase --autostash origin main } | Out-Null
$code = Run-Step 'collect' { & 'C:\Program Files\nodejs\node.exe' scripts/neolook-pc.mjs }
if ($code -ne 0) { exit 1 }

git add data/neolook.json
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  Run-Step 'commit' { git commit -m "update neolook list" } | Out-Null
  Run-Step 'push' { git push origin main } | Out-Null
}
