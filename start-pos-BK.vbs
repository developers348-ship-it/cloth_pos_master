Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "C:\Users\TaleemH\Desktop\start-pos.bat", 0, False
 
WScript.Sleep 3000
 
WshShell.Popup "POS Server is running!" & vbCrLf & vbCrLf & _
               "Open: http://localhost:3000", _
               5, "POS System", 64