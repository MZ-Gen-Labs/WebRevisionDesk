#define MyAppName "Web Revision Desk"
#define MyAppVersion GetEnv("WEB_REVISION_DESK_VERSION")
#define MyAppPublisher "MZ-Gen-Labs"
#define MyAppExeName "WebRevisionDesk.exe"

[Setup]
AppId={{0D4F9CE2-C8DB-4A38-95A4-AEA5C81D22D1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\WebRevisionDesk
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\release-electron
OutputBaseFilename=WebRevisionDesk-{#MyAppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}

[Files]
Source: "..\release-electron\WebRevisionDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "デスクトップにショートカットを作成"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} を起動"; Flags: nowait postinstall skipifsilent
