!macro customInstall
  WriteRegStr HKCU "Software\Classes\Directory\shell\FileEquinoxShare" "" "Share This Folder"
  WriteRegStr HKCU "Software\Classes\Directory\shell\FileEquinoxShare" "Icon" "$INSTDIR\File Equinox.exe"

  WriteRegStr HKCU "Software\Classes\Directory\shell\FileEquinoxShare\command" "" '"$INSTDIR\File Equinox.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\FileEquinoxShare"
!macroend