' ============================================================================
'  Starts the POS (and the ngrok support tunnel) with no windows, waits until it
'  answers, then shows where it is running.
'
'  Put a shortcut to THIS file in the Startup folder (shell:startup) so it runs
'  at every Windows login. Works from whichever folder it lives in.
' ============================================================================

' Optional: path of the installed POS app shortcut (.lnk) to open once the server
' is ready, e.g. "C:\Users\Shop\Desktop\POS.lnk". Leave empty to open nothing.
Const APP_SHORTCUT = ""

Const PORT = 3000

Dim sh, fso, dir, i, up, tunnel, msg
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

' Start everything hidden (0 = no window).
sh.Run """" & dir & "\start-pos.bat""", 0, False

' Wait up to 90 s for the POS to answer.
up = False
For i = 1 To 45
  WScript.Sleep 2000
  If Answers("http://localhost:" & PORT & "/login") Then
    up = True
    Exit For
  End If
Next

If up Then
  ' The tunnel may need a few more seconds, and may never come up (no internet).
  tunnel = ""
  For i = 1 To 5
    tunnel = TunnelUrl()
    If tunnel <> "" Then Exit For
    WScript.Sleep 2000
  Next

  If APP_SHORTCUT <> "" Then sh.Run """" & APP_SHORTCUT & """", 1, False

  msg = "POS is running." & vbCrLf & vbCrLf & "Local:    http://localhost:" & PORT
  If tunnel <> "" Then msg = msg & vbCrLf & "Support:  " & tunnel
  sh.Popup msg, 10, "POS System", 64
Else
  sh.Popup "The POS did not start." & vbCrLf & vbCrLf & _
           "Check pos-server.log in the POS folder, and that PostgreSQL is running.", 0, "POS System", 48
End If

' True if the address answers with HTTP 200.
Function Answers(url)
  Dim h
  Answers = False
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP")
  h.setTimeouts 2000, 2000, 2000, 2000
  h.Open "GET", url, False
  h.Send
  If Err.Number = 0 Then Answers = (h.Status = 200)
  On Error GoTo 0
End Function

' The public ngrok address, read from ngrok's local API; "" if there is none.
Function TunnelUrl()
  Dim h, re, m
  TunnelUrl = ""
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP")
  h.setTimeouts 1000, 1000, 1000, 1000
  h.Open "GET", "http://127.0.0.1:4040/api/tunnels", False
  h.Send
  If Err.Number = 0 Then
    Set re = New RegExp
    re.Pattern = """public_url"":""(https://[^""]+)"""
    Set m = re.Execute(h.responseText)
    If m.Count > 0 Then TunnelUrl = m(0).SubMatches(0)
  End If
  On Error GoTo 0
End Function
