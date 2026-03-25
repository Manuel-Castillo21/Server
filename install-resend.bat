@echo off
echo Instalando Resend...
npm install

echo.
echo Verificando instalacion...
node -e "const { Resend } = require('resend'); console.log('✅ Resend instalado correctamente');"

echo.
echo ¡Listo! Ahora configura tu RESEND_API_KEY en el archivo .env
pause