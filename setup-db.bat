@echo off
REM Database setup script for PartnerIQ on Windows
setlocal

REM Variables
set DB_HOST=localhost
set DB_USER=root
set DB_PASSWORD=9133477833Ab@
set DB_NAME=partner_db

REM Find mysql.exe
set MYSQL_PATH=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe
if not exist "%MYSQL_PATH%" (
    set MYSQL_PATH=C:\Program Files (x86)\MySQL\MySQL Server 8.0\bin\mysql.exe
)
if not exist "%MYSQL_PATH%" (
    set MYSQL_PATH=mysql
)

echo Using MySQL from: %MYSQL_PATH%
echo.

REM Create temporary SQL file
set SQL_FILE=%TEMP%\partneriq_setup_%RANDOM%.sql

(
    echo CREATE DATABASE IF NOT EXISTS %DB_NAME%;
) > "%SQL_FILE%"

echo Creating database...
"%MYSQL_PATH%" -h %DB_HOST% -u %DB_USER% -p%DB_PASSWORD% < "%SQL_FILE%"
if errorlevel 1 (
    echo Failed to create database.
    del "%SQL_FILE%" 2>nul
    endlocal
    exit /b 1
)

echo.
echo Running TypeORM migrations...
call npm.cmd run migration:run
if errorlevel 1 (
    echo Failed to run migrations.
    del "%SQL_FILE%" 2>nul
    endlocal
    exit /b 1
)

echo.
echo Database setup complete!
echo.

REM Cleanup
del "%SQL_FILE%" 2>nul

endlocal
