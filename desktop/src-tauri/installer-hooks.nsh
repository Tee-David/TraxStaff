; Trax NSIS installer hooks.
; Tauri already creates a Start Menu shortcut; add a Desktop shortcut too so the
; app appears like any normal Windows app, and remove it on uninstall.

!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend
