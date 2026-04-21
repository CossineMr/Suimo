Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "d:\Agent Folder"
WshShell.Run "cmd /c npm start", 0, False
