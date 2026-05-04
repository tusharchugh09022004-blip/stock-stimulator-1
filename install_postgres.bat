@echo off
echo Installing PostgreSQL 16 for Windows...
winget install -e --id PostgreSQL.PostgreSQL --accept-package-agreements --accept-source-agreements
if %ERRORLEVEL% EQU 0 (
    echo Installation complete! Please run services.msc to start postgresql-x64-16 service
    echo Then create database with: psql -U postgres -c "CREATE DATABASE stocksim;"
    pause
) else (
    echo Installation failed. Try downloading installer from https://www.postgresql.org/download/windows/
)

