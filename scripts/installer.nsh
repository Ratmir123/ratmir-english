; Smooth Talk installer additions (electron-builder.json → nsis.include).
; 0.5.3 replaces the app icon with the transparent chubrik. The installed exe keeps its path, so Explorer would keep
; showing the cached old picture on the exe, the Start menu and desktop shortcuts and the taskbar: tell the shell that
; icons changed (SHCNE_ASSOCCHANGED, SHCNF_IDLIST) and that the exe itself was updated (SHCNE_UPDATEITEM, SHCNF_PATHW).

!macro customInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  System::Call 'shell32::SHChangeNotify(i 0x00002000, i 0x0005, w "$INSTDIR\${APP_EXECUTABLE_FILENAME}", p 0)'
!macroend
