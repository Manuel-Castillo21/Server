# backend/Dockerfile
FROM node:18-alpine

# Directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm ci --only=production

# Copiar código fuente
COPY . .

# Exponer puerto (Render usa 8080 generalmente)
EXPOSE 8080

# Comando para iniciar la app
CMD ["node", "index.js"]
