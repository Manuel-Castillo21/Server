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

module.exports = registrarBitacora;
