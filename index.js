const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");
require("dotenv").config();

app.use(cors());
app.use(express.json());

const authRoutes = require("./routes/auth"); 
const {adminRoutes} = require("./routes/admin"); 
const ProductosRoutes = require("./routes/Productos"); 
const loginlogoutRoutes = require("./routes/Login-logout"); 
const ServiciosRoutes = require("./routes/Servicios"); 
const facturasRoutes = require("./routes/facturas"); 
const ordenesRoutes = require("./routes/ordenes"); 
const ubicacionRoutes = require("./routes/ubicacion"); 
const bitacoraRoutes = require("./routes/bitacora"); 

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/Login-logout", loginlogoutRoutes);
app.use("/Productos", ProductosRoutes);
app.use("/uploads",express.static(path.join(__dirname, "uploads")));
app.use("/uploads/cv", express.static("uploads/cv"));
app.use("/uploads/perfil", express.static("uploads/perfil"));
app.use("/Servicios", ServiciosRoutes);
app.use("/facturas", facturasRoutes);
app.use("/ordenes", ordenesRoutes);
app.use("/ubicacion", ubicacionRoutes); 
app.use("/bitacora", bitacoraRoutes); 

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

app.use(cors({
  origin: ['http://localhost:3000', 'https://tu-sitio.netlify.app']
}));