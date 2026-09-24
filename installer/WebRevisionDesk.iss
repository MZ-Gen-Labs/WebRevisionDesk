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
CloseApplications=force

[Files]
Source: "..\release-electron\WebRevisionDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "デスクトップにショートカットを作成"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} を起動"; Flags: nowait postinstall skipifsilent

[Code]
function IsWebRevisionDeskRunning: Boolean;
var
  ResultCode: Integer;
  Output: TExecOutput;
  I: Integer;
  Line: String;
begin
  Result := False;
  if not ExecAndCaptureOutputWithNativeSysDir(
    ExpandConstant('{sys}\tasklist.exe'),
    '/FI "IMAGENAME eq WebRevisionDesk.exe" /FO CSV /NH',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode, Output) then
    RaiseException('起動中の Web Revision Desk を確認できませんでした。');
  if Output.Error or (ResultCode <> 0) then
    RaiseException('起動中の Web Revision Desk を確認できませんでした。');

  for I := 0 to GetArrayLength(Output.StdOut) - 1 do begin
    Line := Lowercase(Trim(Output.StdOut[I]));
    if Pos('"webrevisiondesk.exe"', Line) = 1 then begin
      Result := True;
      Exit;
    end;
  end;
end;

function StopRunningApplication(OperationName: String; Silent: Boolean): Boolean;
var
  ResultCode: Integer;
  Attempt: Integer;
  Prompt: String;
begin
  Result := False;
  if not IsWebRevisionDeskRunning then begin
    Result := True;
    Exit;
  end;

  if not Silent then begin
    Prompt := 'Web Revision Desk が起動しています。作業内容を保存してから、' +
      OperationName + 'を続けるためアプリを終了しますか？';
    if MsgBox(Prompt, mbConfirmation, MB_YESNO or MB_DEFBUTTON2) <> IDYES then Exit;
  end;

  if not ExecWithNativeSysDir(
    ExpandConstant('{sys}\taskkill.exe'),
    '/F /T /IM WebRevisionDesk.exe',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
    if not IsWebRevisionDeskRunning then begin
      Result := True;
      Exit;
    end;
    if not Silent then
      MsgBox('Web Revision Desk を終了できませんでした。', mbError, MB_OK);
    Exit;
  end;

  for Attempt := 1 to 40 do begin
    Sleep(250);
    if not IsWebRevisionDeskRunning then begin
      Result := True;
      Exit;
    end;
  end;

  if not Silent then
    MsgBox('Web Revision Desk の終了を確認できませんでした。インストールまたはアンインストールを中止します。', mbError, MB_OK);
end;

function InitializeSetup: Boolean;
begin
  Result := StopRunningApplication('インストール', WizardSilent);
end;

function InitializeUninstall: Boolean;
begin
  Result := StopRunningApplication('アンインストール', UninstallSilent);
end;
