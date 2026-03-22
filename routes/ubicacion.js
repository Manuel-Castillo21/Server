const express = require("express");
const router = express.Router();
const db = require("../db");

// Obtener todos los estados
router.get("/estados", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id_estado, estado FROM estados ORDER BY estado"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener estados",
      details: error.message
    });
  }
});

// Obtener municipios por estado
router.get("/municipios/:estadoId", async (req, res) => {
  const { estadoId } = req.params;

  try {
    const result = await db.query(
      "SELECT id_municipio, municipio FROM municipios WHERE id_estado = $1 ORDER BY municipio",
      [estadoId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener municipios",
      details: error.message
    });
  }
});

// Obtener ciudades por estado
router.get("/ciudades/:estadoId", async (req, res) => {
  const { estadoId } = req.params;

  try {
    const result = await db.query(
      "SELECT id_ciudad, ciudad, capital FROM ciudades WHERE id_estado = $1 ORDER BY ciudad",
      [estadoId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener ciudades",
      details: error.message
    });
  }
});

// Obtener parroquias por municipio
router.get("/parroquias/:municipioId", async (req, res) => {
  const { municipioId } = req.params;

  try {
    const result = await db.query(
      "SELECT id_parroquia, parroquia FROM parroquias WHERE id_municipio = $1 ORDER BY parroquia",
      [municipioId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener parroquias",
      details: error.message
    });
  }
});

// Buscar ubicaciones
router.get("/buscar/:termino", async (req, res) => {
  const { termino } = req.params;

  try {
    const result = await db.query(
      `
      SELECT 
        c.id_ciudad,
        c.ciudad,
        e.estado,
        c.capital
      FROM ciudades c
      JOIN estados e ON c.id_estado = e.id_estado
      WHERE LOWER(c.ciudad) LIKE LOWER($1)
         OR LOWER(e.estado) LIKE LOWER($1)
      ORDER BY e.estado, c.ciudad
      LIMIT 20
      `,
      [`%${termino}%`]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({
      error: "Error en la búsqueda",
      details: error.message
    });
  }
});

module.exports = router;
