const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");
require("dotenv").config();

// 1. CONFIGURACIÓN DE CORS (Ponlo siempre al principio)
app.use(cors({
  origin: ['http://localhost:3000', 'https://tu-sitio.netlify.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 2. IMPORTACIÓN DE RUTAS
const authRoutes = require("./routes/auth"); 
const {adminRoutes} = require("./routes/admin"); 
const ProductosRoutes = require("./routes/Productos"); 
const loginlogoutRoutes = require("./routes/Login-logout"); 
const ServiciosRoutes = require("./routes/Servicios"); 
const facturasRoutes = require("./routes/facturas"); 
const ordenesRoutes = require("./routes/ordenes"); 
const ubicacionRoutes = require("./routes/ubicacion"); 
const bitacoraRoutes = require("./routes/bitacora");
const chatbotRoutes = require('./routes/chatbot'); // <--- Asegúrate de que este archivo exista en /routes

// 3. USO DE RUTAS
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/Login-logout", loginlogoutRoutes);
app.use("/Productos", ProductosRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/Servicios", ServiciosRoutes);
app.use("/facturas", facturasRoutes);
app.use("/ordenes", ordenesRoutes);
app.use("/ubicacion", ubicacionRoutes); 
app.use("/bitacora", bitacoraRoutes); 
app.use('/chatbot', chatbotRoutes); // <--- Esto habilita http://localhost:3001/chatbot

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});