param(
    [string]$Server = '192.168.1.20',
    [string]$Destination = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'STB Backups\PDF Scanner')
)

$ErrorActionPreference = 'Stop'
$identity = Join-Path $env:USERPROFILE '.ssh\id_ed25519_stb'
& ssh -i $identity -o BatchMode=yes "root@$Server" 'test -f /var/lib/pdf-scanner/session.json'
if ($LASTEXITCODE -ne 0) {
    throw 'No saved session found, or SSH access failed. Save a scan before backing up.'
}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$backupFile = Join-Path $Destination ('session-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
& scp -i $identity -o BatchMode=yes "root@${Server}:/var/lib/pdf-scanner/session.json" $backupFile
if ($LASTEXITCODE -ne 0) { throw 'Backup transfer failed.' }
Get-FileHash -LiteralPath $backupFile -Algorithm SHA256 | Select-Object Path,Hash
