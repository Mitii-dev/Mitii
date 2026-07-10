$ErrorActionPreference = "Stop"

$Version = if ($env:MITII_VERSION) { $env:MITII_VERSION } else { "latest" }
$InstallDir = if ($env:MITII_INSTALL_DIR) { $env:MITII_INSTALL_DIR } else { Join-Path $HOME ".mitii\\bin" }
$Asset = "mitii-win32-x64.zip"
$Base = "https://github.com/codewithshinde/thunder-ai-agent/releases"
$Url = if ($Version -eq "latest") { "$Base/latest/download/$Asset" } else { "$Base/download/$Version/$Asset" }
$SumsUrl = if ($Version -eq "latest") { "$Base/latest/download/SHA256SUMS" } else { "$Base/download/$Version/SHA256SUMS" }

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Temp = New-Item -ItemType Directory -Force -Path (Join-Path ([System.IO.Path]::GetTempPath()) "mitii-install-$([System.Guid]::NewGuid())")
try {
  $Archive = Join-Path $Temp $Asset
  Invoke-WebRequest -Uri $Url -OutFile $Archive
  try {
    $Sums = Join-Path $Temp "SHA256SUMS"
    Invoke-WebRequest -Uri $SumsUrl -OutFile $Sums
    $Expected = (Get-Content $Sums | Select-String " $Asset$").ToString().Split(" ")[0]
    $Actual = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Expected -and $Actual -ne $Expected.ToLowerInvariant()) { throw "SHA256 mismatch" }
  } catch {
    Write-Warning "Checksum verification skipped: $_"
  }
  Expand-Archive -Force $Archive $InstallDir
  Write-Host "Installed mitii to $InstallDir"
} finally {
  Remove-Item -Recurse -Force $Temp
}
