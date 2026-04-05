const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticateToken } = require("./admin");
const { registrarBitacora } = require("./bitacora");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// CREAR ORDEN
router.post("/crear", authenticateToken, async (req, res) => {
  const {
    servicios_ids,
    fecha_ejecucion,
    hora_servicio,
    direccion,
    cliente_id,
    cantidad
  } = req.body;

  if (!servicios_ids || !Array.isArray(servicios_ids) || servicios_ids.length === 0 || !cliente_id) {
    return res.status(400).json({
      error: "Faltan datos obligatorios: servicios_ids y cliente_id"
    });
  }

  if (!cantidad || cantidad <= 0) {
    return res.status(400).json({ error: "Cantidad inválida" });
  }

  try {
    const clienteRes = await db.query(
      "SELECT id, nombre FROM usuarios WHERE id = $1 AND tipo_user = 'cliente'",
      [cliente_id]
    );

    if (clienteRes.rows.length === 0) {
      return res.status(400).json({ error: "Cliente no encontrado" });
    }

    const serviciosRes = await db.query(
      "SELECT id, nombre, precio_estimado FROM servicios WHERE id = ANY($1::int[])",
      [servicios_ids]
    );

    if (serviciosRes.rows.length !== servicios_ids.length) {
      return res.status(400).json({ error: "Algunos servicios no existen" });
    }

    const trabajadoresRes = await db.query(`
      SELECT u.id, u.nombre
      FROM usuarios u
      JOIN perfil p ON p.id = u.id
      WHERE u.tipo_user = 'trabajador'
        AND u.permisos = 'permitido'
        AND u.estado = 'activo'
        AND p.disponible = true
    `);

    let trabajadorAsignado = null;
    const nuevaFecha = new Date(`${fecha_ejecucion}T${hora_servicio}`);

    for (const trabajador of trabajadoresRes.rows) {
      const ordenes = await db.query(
        `SELECT fecha_ejecucion, hora_servicio
         FROM ordenes
         WHERE id_trabajador = $1
           AND fecha_ejecucion = $2
           AND estado != 'cancelada'`,
        [trabajador.id, fecha_ejecucion]
      );

      if (ordenes.rows.length >= 3) continue;

      let cumpleHorario = true;
      for (const orden of ordenes.rows) {
        const fechaExistente = new Date(`${orden.fecha_ejecucion}T${orden.hora_servicio}`);
        const diferenciaHoras = Math.abs((nuevaFecha - fechaExistente) / 36e5);

        if (diferenciaHoras < 3) {
          cumpleHorario = false;
          break;
        }
      }

      if (cumpleHorario) {
        trabajadorAsignado = trabajador;
        break;
      }
    }

    if (!trabajadorAsignado) {
      return res.status(400).json({
        error: "No hay trabajadores disponibles que cumplan el horario"
      });
    }

    const subtotalBase = serviciosRes.rows.reduce(
      (total, s) => total + Number(s.precio_estimado),
      0
    );

    const subtotal = subtotalBase * cantidad;
    const iva = subtotal * 0.16;
    const total = subtotal + iva;

    const nuevaOrden = await db.query(
      `INSERT INTO ordenes (
        id_servicio,
        id_cliente,
        id_trabajador,
        estado,
        fecha,
        fecha_ejecucion,
        hora_servicio,
        direccion,
        subtotal,
        iva,
        total
      )
      VALUES ($1,$2,$3,'pendiente',CURRENT_TIMESTAMP,$4,$5,$6,$7,$8,$9)
      RETURNING id`,
      [
        JSON.stringify(servicios_ids),
        cliente_id,
        trabajadorAsignado.id,
        fecha_ejecucion,
        hora_servicio,
        JSON.stringify(direccion),
        subtotal,
        iva,
        total
      ]
    );

    const ordenId = nuevaOrden.rows[0].id;

    // BITÁCORA
    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "CREAR_ORDEN",
      tabla: "ordenes",
      descripcion: `Orden #${ordenId} creada y asignada a ${trabajadorAsignado.nombre}`,
      ip: req.ip
    });

    res.json({
      message: "Orden creada correctamente",
      ordenId
    });

  } catch (error) {
    console.error("Error al crear orden:", error);
    res.status(500).json({ error: "Error al crear la orden" });
  }
});

// OBTENER SERVICIOS DE UNA ORDEN
router.get("/:id/servicios", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const ordenRes = await db.query(
      "SELECT id_servicio FROM ordenes WHERE id = $1",
      [id]
    );

    if (ordenRes.rows.length === 0) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const serviciosIds = typeof ordenRes.rows[0].id_servicio === "string"
      ? JSON.parse(ordenRes.rows[0].id_servicio)
      : ordenRes.rows[0].id_servicio;

    if (!Array.isArray(serviciosIds) || serviciosIds.length === 0) {
      return res.json([]);
    }

    const serviciosRes = await db.query(
      "SELECT id, nombre, precio_estimado FROM servicios WHERE id = ANY($1::int[])",
      [serviciosIds]
    );

    res.json(serviciosRes.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener servicios" });
  }
});

// OBTENER ÓRDENES DEL TRABAJADOR AUTENTICADO
router.get("/trabajador", authenticateToken, async (req, res) => {
  const trabajadorId = req.user.id;

  try {
    const ordenes = await db.query(
      `
      SELECT 
        o.id,
        o.estado,
        o.fecha,
        o.metodo_pago,
        o.referencias,
        o.fecha_ejecucion,
        o.hora_servicio,
        o.direccion,
        o.id_servicio,
        o.subtotal,
        o.iva,
        o.total,
        u.nombre AS cliente_nombre,
        u.telefono AS cliente_telefono,
        u.ubicacion AS cliente_ubicacion
      FROM ordenes o
      JOIN usuarios u ON o.id_cliente = u.id
      WHERE o.id_trabajador = $1
      ORDER BY o.fecha DESC
    `,
      [trabajadorId]
    );

   // Procesar para obtener nombres de servicios
    const ordenesProcesadas = await Promise.all(
      ordenes.rows.map(async (orden) => {
        let serviciosNombres = [];
        let serviciosCount = 0;

        if (orden.id_servicio) {
          try {
            const serviciosIds = typeof orden.id_servicio === 'string'
              ? JSON.parse(orden.id_servicio)
              : orden.id_servicio;

            if (Array.isArray(serviciosIds) && serviciosIds.length > 0) {
              serviciosCount = serviciosIds.length;

              const serviciosRes = await db.query(
                "SELECT nombre FROM servicios WHERE id = ANY($1::int[])",
                [serviciosIds]
              );

              serviciosNombres = serviciosRes.rows.map(s => s.nombre);
            }
          } catch (error) {
            console.error("Error al procesar servicios:", error);
          }
        }

        // Dirección
        let direccionFormateada = "No especificada";
        if (orden.direccion) {
          try {
            const dir = typeof orden.direccion === 'string'
              ? JSON.parse(orden.direccion)
              : orden.direccion;

            if (dir.calle && dir.casa_edificio && dir.municipio && dir.estado) {
              direccionFormateada = `${dir.calle}, ${dir.casa_edificio}, ${dir.municipio}, ${dir.estado}`;
            } else if (dir.calle) {
              direccionFormateada = dir.calle;
            }
          } catch (error) {
            direccionFormateada = "Dirección no disponible";
          }
        }

        // Fecha
        const fechaFormateada = orden.fecha_ejecucion
          ? new Date(orden.fecha_ejecucion).toLocaleDateString()
          : "No asignada";

        // Hora
        const horaFormateada = orden.hora_servicio
          ? orden.hora_servicio.toString().substring(0, 5)
          : "No asignada";

        return {
          ...orden,
          servicios_nombres: serviciosNombres,
          servicios_count: serviciosCount,
          servicio_principal: serviciosNombres[0] || "Múltiples servicios",
          direccion_formateada: direccionFormateada,
          fecha_formateada: fechaFormateada,
          hora_formateada: horaFormateada
        };
      })
    );

    res.json(ordenesProcesadas);
  } catch (error) {
    console.error("Error al obtener órdenes del trabajador:", error);
    res.status(500).json({ error: "Error al obtener órdenes" });
  }
});

// ACTUALIZAR PAGO DE ORDEN
router.put("/actualizarPago/:id", authenticateToken,  upload.single("captura"), async (req, res) => {
  const { id } = req.params;
  const { metodo_pago, referencias } = req.body;
  const captura = req.file ? req.file.filename : null;

  try {
    console.log("Datos recibidos:", { id, metodo_pago, referencias, captura, user: req.user });

    const result = await db.query(
      `UPDATE ordenes
       SET metodo_pago = $1, referencias = $2, comprobante = $3
       WHERE id = $4`,
      [metodo_pago, referencias, captura, id]
    );

    console.log("Resultado query:", result.rowCount);

    await registrarBitacora({
      usuario_id: req.user.id,
      rol: req.user.role,
      accion: "ACTUALIZAR_PAGO",
      tabla: "ordenes",
      descripcion: `Pago actualizado en la orden #${id}`,
      ip: req.ip
    });

    res.json({ message: "Pago actualizado correctamente" });
  } catch (error) {
    console.error("Error en actualizarPago:", error);
    res.status(500).json({ error: error.message });
  }
});

// OBTENER PRODUCTOS DE LA ORDEN (ACTUALIZADO para múltiples servicios)
// Endpoint separado para obtener estados
router.get("/estados", authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT id_estado, estado FROM estados ORDER BY estado');
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
            'SELECT id_municipio, municipio FROM municipios WHERE id_estado = $1 ORDER BY municipio',
            [estadoId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ 
            error: 'Error al obtener municipios',
            details: error.message 
        });
    }
});

// Obtener ciudades por estado
router.get("/ciudades/:estadoId", async (req, res) => {
    const { estadoId } = req.params;
    
    try {
        const result = await db.query(
            'SELECT id_ciudad, ciudad, capital FROM ciudades WHERE id_estado = $1 ORDER BY ciudad',
            [estadoId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ 
            error: 'Error al obtener ciudades',
            details: error.message 
        });
    }
});

// Obtener parroquias por municipio
router.get("/parroquias/:municipioId", async (req, res) => {
    const { municipioId } = req.params;
    
    try {
        const result = await db.query(
            'SELECT id_parroquia, parroquia FROM parroquias WHERE id_municipio = $1 ORDER BY parroquia',
            [municipioId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ 
            error: 'Error al obtener parroquias',
            details: error.message 
        });
    }
});

// Buscar ubicaciones por término
router.get("/buscar/:termino", async (req, res) => {
    const { termino } = req.params;
    
    try {
        const result = await db.query(`
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
        `, [`%${termino}%`]);
        
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ 
            error: 'Error en la búsqueda',
            details: error.message 
        });
    }
});
// OBTENER MIS ÓRDENES (CLIENTE)
router.get("/mis-ordenes", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id; // viene del token

    const result = await db.query(`
      SELECT 
        o.id,
        o.estado,
        o.total,
        o.fecha,
        o.hora_servicio,
        o.direccion,
        u.nombre AS trabajador_nombre,

        -- Formateos
        TO_CHAR(o.fecha, 'DD/MM/YYYY') AS fecha_formateada,
        TO_CHAR(o.hora_servicio, 'HH24:MI') AS hora_formateada,

        -- Dirección legible
        CONCAT(
          o.direccion->>'calle', ', ',
          o.direccion->>'ciudad'
        ) AS direccion_formateada

      FROM ordenes o
      LEFT JOIN usuarios u ON o.id_trabajador = u.id
      WHERE o.id_cliente = $1
      ORDER BY o.fecha DESC
    `, [userId]);

    res.json(result.rows);

  } catch (error) {
    console.error("Error al obtener mis órdenes:", error);
    res.status(500).json({ error: "Error al obtener mis órdenes" });
  }
});


// OBTENER ORDEN POR ID (ResumenOrden)
router.get("/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(`
      SELECT 
        o.*,
        c.nombre AS cliente,
        t.nombre AS trabajador
      FROM ordenes o
      JOIN usuarios c ON o.id_cliente = c.id
      JOIN usuarios t ON o.id_trabajador = t.id
      WHERE o.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const orden = result.rows[0];

    // Parsear servicios (JSON → array)
    if (orden.id_servicio && typeof orden.id_servicio === "string") {
      orden.id_servicio = JSON.parse(orden.id_servicio);
    }

    // Parsear dirección (JSON → objeto)
    if (orden.direccion && typeof orden.direccion === "string") {
      orden.direccion = JSON.parse(orden.direccion);
    }

    res.json(orden);

  } catch (error) {
    console.error("Error al obtener la orden:", error);
    res.status(500).json({ error: "Error al obtener la orden" });
  }
});

module.exports = router;