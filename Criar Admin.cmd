@echo off
rem Cria o primeiro administrador do portal FUP (so na primeira vez).
cd /d "%~dp0"
python criar_admin.py
pause
