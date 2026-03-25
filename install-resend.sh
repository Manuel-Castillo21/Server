# Instalar dependencias actualizadas
echo "Instalando Resend..."
npm install

# Verificar instalación
echo "Verificando instalación..."
node -e "const { Resend } = require('resend'); console.log('✅ Resend instalado correctamente');"

echo "¡Listo! Ahora configura tu RESEND_API_KEY en el archivo .env"