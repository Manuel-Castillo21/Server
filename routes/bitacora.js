const express = require('express');
const router = express.Router();
const pool = require('../db');

const registrarBitacora = async ({
  usuario_id,
  rol,
  accion,
  tabla,
  descripcion,
  ip
}) => {
  try {
    await pool.query(
      `INSERT INTO bitacora 
       (usuario_id, rol, accion, tabla_afectada, descripcion, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuario_id, rol, accion, tabla, descripcion, ip]
    );
  } catch (error) {
    console.error('Error guardando bitácora:', error);
  }
};

//Obtener toda la bitácora
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        b.id,
        b.usuario_id,
        u.nombre AS usuario_nombre,
        b.rol,
        b.accion,
        b.tabla_afectada,
        b.descripcion,
        b.ip,
        b.fecha
      FROM bitacora b
      LEFT JOIN usuarios u ON b.usuario_id = u.id
      ORDER BY b.fecha DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo bitácora:', error);
    res.status(500).json({ error: 'Error al obtener la bitácora' });
  }
});

router.get('/usuario/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM bitacora 
       WHERE usuario_id = $1 
       ORDER BY fecha DESC`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al filtrar bitácora' });
  }
});

router.get('/fecha', async (req, res) => {
  const { desde, hasta } = req.query;

  try {
    const result = await pool.query(
      `SELECT * FROM bitacora 
       WHERE fecha BETWEEN $1 AND $2
       ORDER BY fecha DESC`,
      [desde, hasta]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al filtrar por fecha' });
  }
});

module.exports = {
  bitacoraRoutes: router,
  registrarBitacora,
};

