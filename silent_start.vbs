Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\A7-logics\cloth-pos-master\cloth-pos-master"
WshShell.Run "cmd /c npm run start", 0, False