@echo off
rem Reporte FUP - gera os PNGs em ..\imagesdereporte\saida\AAAA-MM-DD (pronto.ok = terminou). Rodar DEPOIS do robo (07:13).
rem Sai com codigo 1 (sem pronto.ok) se o robo do dia falhou ou a foto D0 nao e de hoje.
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
"C:\Users\murylo.marques\AppData\Local\Microsoft\WindowsApps\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\python.exe" reporte.py %*
exit /b %ERRORLEVEL%
