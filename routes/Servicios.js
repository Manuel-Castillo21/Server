const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticateToken } = require("./admin");
const registrarBitacora = require("./bitacora");

// Obtener todos los servicios
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.*, COUNT(sp.producto_id) AS productos_count
      FROM servicios s
      LEFT JOIN servicio_productos sp ON s.id = sp.servicio_id
      GROUP BY s.id
      ORDER BY s.id ASC
    `);

    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "CONSULTAR",
      tabla: "servicios",
      descripcion: "Consulta de lista de servicios",
      ip: req.ip
    });

    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener servicios:", error);
    res.status(500).json({ message: "Error al obtener servicios" });
  }
});


// Obtener servicios por tipo (generales o extras)
router.get("/tipo/:tipo", async (req, res) => {
  const { tipo } = req.params;
  try {
    const result = await db.query("SELECT * FROM servicios WHERE tipo = $1 ORDER BY id ASC", [tipo]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error al filtrar servicios por tipo:", error);
    res.status(500).json({ message: "Error al filtrar servicios" });
  }
});

// Obtener productos disponibles para servicios - DEBE IR ANTES DE /:id
router.get("/productos-disponibles", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, nombre, litros, cantidad, uso, fecha_vencimiento, categoria_id, lote 
      FROM productos 
      WHERE cantidad > 0 
      ORDER BY nombre ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener productos disponibles:", error);
    res.status(500).json({ message: "Error al obtener productos disponibles" });
  }
});

// Obtener un servicio específico con sus productos 
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  
  // Validar que el id sea un número
  if (isNaN(id)) {
    return res.status(400).json({ message: "ID de servicio inválido" });
  }
  
  try {
    // Obtener el servicio
    const servicioResult = await db.query("SELECT * FROM servicios WHERE id = $1", [id]);
    
    if (servicioResult.rows.length === 0) {
      return res.status(404).json({ message: "Servicio no encontrado" });
    }

    // Obtener los productos asociados al servicio
    const productosResult = await db.query(`
      SELECT 
        sp.producto_id as id,
        p.nombre,
        p.cantidad as stock,
        sp.cantidad_necesaria
      FROM servicio_productos sp
      JOIN productos p ON sp.producto_id = p.id
      WHERE sp.servicio_id = $1
    `, [id]);

    const servicio = servicioResult.rows[0];
    servicio.productos = productosResult.rows;

    res.json(servicio);
  } catch (error) {
    console.error("Error al obtener servicio:", error);
    res.status(500).json({ message: "Error al obtener servicio" });
  }
});

// Crear un nuevo servicio
router.post("/", authenticateToken, async (req, res) => {
  const { nombre, precio_insu, mano_obra, precio_estimado, tipo, productos = [] } = req.body;
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const nuevoServicio = await client.query(
      `INSERT INTO servicios (nombre, precio_insu, mano_obra, precio_estimado, tipo)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [nombre, precio_insu, mano_obra, precio_estimado, tipo]
    );

    const servicio_id = nuevoServicio.rows[0].id;

    for (const producto of productos) {
      await client.query(
        `INSERT INTO servicio_productos (servicio_id, producto_id, cantidad_necesaria, fecha_asignacion)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [servicio_id, producto.id, producto.cantidad_necesaria]
      );
    }

    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "CREAR",
      tabla: "servicios",
      descripcion: `Servicio creado: ${nombre}`,
      ip: req.ip
    });

    await client.query("COMMIT");
    res.json({ message: "Servicio agregado correctamente", id: servicio_id });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al agregar servicio:", error);
    res.status(500).json({ message: "Error al agregar servicio" });
  } finally {
    client.release();
  }
});

// Editar servicio existente con productos
router.put("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nombre, precio_insu, mano_obra, precio_estimado, tipo, productos = [] } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({ message: "ID de servicio inválido" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE servicios
       SET nombre=$1, precio_insu=$2, mano_obra=$3, precio_estimado=$4, tipo=$5
       WHERE id=$6 RETURNING *`,
      [nombre, precio_insu, mano_obra, precio_estimado, tipo, id]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Servicio no encontrado" });
    }

    await client.query("DELETE FROM servicio_productos WHERE servicio_id = $1", [id]);

    for (const producto of productos) {
      await client.query(
        `INSERT INTO servicio_productos (servicio_id, producto_id, cantidad_necesaria, fecha_asignacion)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [id, producto.id, producto.cantidad_necesaria]
      );
    }

    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "ACTUALIZAR",
      tabla: "servicios",
      descripcion: `Servicio actualizado: ${nombre}`,
      ip: req.ip
    });

    await client.query("COMMIT");
    res.json({ message: "Servicio actualizado correctamente", servicio: result.rows[0] });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error al modificar servicio:", error);
    res.status(500).json({ message: "Error al modificar servicio" });
  } finally {
    client.release();
  }
});

//Eliminar un servicio
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  if (isNaN(id)) {
    return res.status(400).json({ message: "ID de servicio inválido" });
  }

  try {
    await db.query("DELETE FROM servicios WHERE id = $1", [id]);

    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "ELIMINAR",
      tabla: "servicios",
      descripcion: `Servicio eliminado (ID ${id})`,
      ip: req.ip
    });

    res.json({ message: "Servicio eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar servicio:", error);
    res.status(500).json({ message: "Error al eliminar servicio" });
  }
});

module.exports = router;