const express = require("express");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const db = require("../db");
const { authenticateToken } = require("./admin");
const registrarBitacora = require("./bitacora");

// OBTENER PRODUCTOS
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, c.nombre AS categoria
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
    `);

    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "CONSULTAR",
      tabla: "productos",
      descripcion: "Consulta de lista de productos",
      ip: req.ip
    });

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener productos" });
  }
});


// OBTENER CATEGORÍAS
router.get("/categorias", authenticateToken, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM categorias");

    // 🧾 BITÁCORA
    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "CONSULTAR",
      tabla: "categorias",
      descripcion: "Consulta de categorías",
      ip: req.ip
    });

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener categorías" });
  }
});


// AGREGAR CATEGORÍA
router.post("/categorias", authenticateToken, async (req, res) => {
  const { nombre } = req.body;

  try {
    await db.query(
      "INSERT INTO categorias (nombre) VALUES ($1)",
      [nombre]
    );

    // 🧾 BITÁCORA
    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "CREAR",
      tabla: "categorias",
      descripcion: `Categoría creada: ${nombre}`,
      ip: req.ip
    });

    res.status(201).json({ message: "Categoría agregada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al agregar la categoría" });
  }
});


// ACTUALIZAR CANTIDAD DE PRODUCTO
router.put("/updateCantidad/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { cantidad } = req.body;

  try {
    await db.query(
      "UPDATE productos SET cantidad = $1 WHERE id = $2",
      [cantidad, id]
    );

    // 🧾 BITÁCORA
    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "ACTUALIZAR",
      tabla: "productos",
      descripcion: `Cantidad actualizada del producto ID ${id} a ${cantidad}`,
      ip: req.ip
    });

    res.json({ success: true, message: "Cantidad actualizada" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Error al actualizar" });
  }
});


// ELIMINAR PRODUCTO
router.delete("/eliminarP/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("DELETE FROM productos WHERE id = $1", [id]);

    // 🧾 BITÁCORA
    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "ELIMINAR",
      tabla: "productos",
      descripcion: `Producto eliminado (ID ${id})`,
      ip: req.ip
    });

    res.status(200).send("Producto eliminado correctamente");
  } catch (error) {
    console.error("Error al eliminar el producto:", error);
    res.status(500).send("Error al eliminar el producto");
  }
});

module.exports = router;
