; Inclus par electron-builder dans l'installeur NSIS (voir package.mjs, nsis.include).
;
; Vérification « BG Tracker est-il ouvert ? » SANS PowerShell : par défaut, electron-builder lance
; powershell.exe (Get-CimInstance), schéma que l'antivirus de l'utilisateur (Avast) bloque
; (IDP.HELU.PSE94, 20/10/2026). On force la variante tasklist / taskkill déjà prévue par
; electron-builder (templates/nsis/include/allowOnlyOneInstallerInstance.nsh).
; Avec une macro personnalisée, electron-builder n'inclut plus ces dépendances de _CHECK_APP_RUNNING.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  Var /GLOBAL IsPowerShellAvailable
  StrCpy $IsPowerShellAvailable 1
  !insertmacro _CHECK_APP_RUNNING
!macroend
