$rootKey = 'HKCU:\Software\Classes\Directory\shell\FileEquinoxShare'

if (Test-Path -LiteralPath $rootKey) {
	Remove-Item -LiteralPath $rootKey -Recurse -Force
	Write-Host "Unregistered 'Share This Folder' from folders."
} else {
	Write-Host "'Share This Folder' was not registered."
}
