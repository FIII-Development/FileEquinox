param(
	[string]$ExePath = (Join-Path $PSScriptRoot '..\..\FileEquinox.exe')
)

$ExePath = [System.IO.Path]::GetFullPath($ExePath)

if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) {
	throw "FileEquinox.exe was not found at '$ExePath'. Pass -ExePath with the built executable path."
}

$rootKey = 'HKCU:\Software\Classes\Directory\shell\FileEquinoxShare'
$commandKey = "$rootKey\command"

New-Item -Path $commandKey -Force | Out-Null
Set-ItemProperty -Path $rootKey -Name '(Default)' -Value 'Share This Folder'
Set-ItemProperty -Path $rootKey -Name 'Icon' -Value $ExePath
Set-ItemProperty -Path $commandKey -Name '(Default)' -Value ('"{0}" "%1"' -f $ExePath)

Write-Host "Registered 'Share This Folder' for folders."
