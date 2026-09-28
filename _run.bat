@echo off
set HTTPS_PROXY=http://127.0.0.1:7897
set HTTP_PROXY=http://127.0.0.1:7897
set npm_config_offline=false
set npm_config_cache=C:\Users\Administrator\Desktop\workspace\vibecoding\tg-checkin-serverless\.npm-cache
cd /d C:\Users\Administrator\Desktop\workspace\vibecoding\tg-checkin-serverless
%*
