const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { registrarBitacora } = require("./bitacora");
const { authenticateToken } = require("./admin");

//Register client
router.post("/RegisterClient", async (req, res) => {
  const { nombre, dni, email, password, telefono } = req.body;
  const tipo_user = "cliente";

  try {
    const hash = await bcrypt.hash(password, 10);

    const userResult = await db.query(
      `INSERT INTO usuarios 
      (nombre, dni, password, telefono, email, tipo_user, permisos)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id`,
      [nombre, dni, hash, telefono, email, tipo_user, "permitido"]
    );

    const userId = userResult.rows[0].id;

    await db.query(
      "INSERT INTO perfil (id, nombre) VALUES ($1, $2)",
      [userId, nombre]
    );

    await registrarBitacora({
      usuario_id: userId,
      rol: tipo_user,
      accion: "Registrar",
      tabla: "usuarios",
      descripcion: "Registro de cliente",
      ip: req.ip,
    });

    res.status(201).json({ mensaje: "Cliente registrado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Error al registrar cliente" });
  }
});

/* ===============================
   CONFIGURACIÓN MULTER (CV)
================================ */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = "uploads/cv/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, "temp-" + Date.now() + ".pdf");
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Solo se permiten archivos PDF"));
  },
});

/* ===============================
   REGISTRO DE TRABAJADOR
================================ */
router.post("/RegisterTrabajador", upload.single("cv"), async (req, res) => {
  const { nombre, dni, email, password, telefono } = req.body;
  const tipo_user = "trabajador";

  try {
    const hash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO usuarios 
      (nombre, dni, password, telefono, email, tipo_user, permisos, curriculum)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id`,
      [nombre, dni, hash, telefono, email, tipo_user, "En espera", ""]
    );

    const userId = result.rows[0].id;

    if (req.file) {
      const newFilename = `CV-${userId}.pdf`;
      const newPath = path.join("uploads/cv/", newFilename);
      fs.renameSync(req.file.path, newPath);

      await db.query(
        "UPDATE usuarios SET curriculum = $1 WHERE id = $2",
        [newFilename, userId]
      );
    }

    await db.query("INSERT INTO perfil (id, nombre) VALUES ($1, $2)", [
      userId,
      nombre,
    ]);

    await registrarBitacora({
      usuario_id: userId,
      rol: tipo_user,
      accion: "Registrar",
      tabla: "usuarios",
      descripcion: "Registro de trabajador",
      ip: req.ip,
    });

    res.status(201).json({ mensaje: "Trabajador registrado correctamente" });
  } catch (error) {
    console.error(error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(400).json({ error: "Error al registrar trabajador" });
  }
});

/* ===============================
   REGISTRO DE PRODUCTOS
================================ */
router.post("/RegisterProducto", async (req, res) => {
  const {
    nombre,
    litros,
    cantidad,
    uso,
    fecha_vencimiento,
    categoria_id,
    lote,
  } = req.body;

  try {
    const result = await db.query(
      `INSERT INTO productos 
      (nombre, litros, cantidad, uso, fecha_vencimiento, categoria_id, lote)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id`,
      [nombre, litros, cantidad, uso, fecha_vencimiento, categoria_id, lote]
    );

    await registrarBitacora({
      usuario_id: req.user?.id || null,
      rol: req.user?.tipo_user || "sistema",
      accion: "Registrar",
      tabla: "productos",
      descripcion: `Registro del producto ${nombre}`,
      ip: req.ip,
    });

    res.status(201).json({ mensaje: "Producto registrado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: "Error al registrar producto" });
  }
});

module.exports = router;
