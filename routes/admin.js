const express = require("express");
const router = express.Router();
const db = require("../db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { registrarBitacora } = require("./bitacora");

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(
    token,
    process.env.JWT_SECRET || "tu_clave_secreta",
    (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    }
  );
}

router.get("/trabajadores-pendientes", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, nombre, email, telefono, COALESCE(curriculum,'') AS curriculum
      FROM usuarios
      WHERE permisos = 'En espera'
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al obtener trabajadores pendientes");
  }
});

router.post(
  "/aprobar-trabajador/:id",
  authenticateToken,
  async (req, res) => {
    const { id } = req.params;

    try {
      const result = await db.query(
        "UPDATE usuarios SET permisos = 'permitido' WHERE id = $1 AND permisos = 'En espera'",
        [id]
      );

      if (result.rowCount === 0) {
        return res.status(404).send("Trabajador no encontrado o ya aprobado");
      }

      await registrarBitacora({
        usuario_id: req.user.id,
        rol: req.user.tipo_user,
        accion: "APROBAR",
        tabla: "usuarios",
        descripcion: `Aprobación del trabajador ID ${id}`,
        ip: req.ip,
      });

      res.send("Trabajador aprobado correctamente");
    } catch (error) {
      console.error(error);
      res.status(500).send("Error al aprobar trabajador");
    }
  }
);

router.post(
  "/denegar-trabajador/:id",
  authenticateToken,
  async (req, res) => {
    const { id } = req.params;

    try {
      await db.query("DELETE FROM perfil WHERE id = $1", [id]);
      await db.query(
        "DELETE FROM usuarios WHERE id = $1 AND permisos = 'En espera'",
        [id]
      );

      await registrarBitacora({
        usuario_id: req.user.id,
        rol: req.user.tipo_user,
        accion: "DENEGAR",
        tabla: "usuarios",
        descripcion: `Rechazo del trabajador ID ${id}`,
        ip: req.ip,
      });

      res.send("Trabajador rechazado correctamente");
    } catch (error) {
      console.error(error);
      res.status(500).send("Error al rechazar trabajador");
    }
  }
);

router.get("/ComprobantesPendientes", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        o.id, o.estado, o.fecha, o.comprobante,
        s.nombre AS servicio,
        c.nombre AS cliente,
        t.nombre AS trabajador,
        o.referencias, o.metodo_pago
      FROM ordenes o
      JOIN servicios s ON o.id_servicio @> to_jsonb(s.id)
      JOIN usuarios c ON o.id_cliente = c.id
      JOIN usuarios t ON o.id_trabajador = t.id
      WHERE o.estado = 'pendiente'
      ORDER BY o.fecha DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener comprobantes" });
  }
});

router.post(
  "/aprobarOrden/:id",
  authenticateToken,
  async (req, res) => {
    const { id } = req.params;

    try {
      await db.query(
        "UPDATE ordenes SET estado = 'verificado' WHERE id = $1",
        [id]
      );

      await registrarBitacora({
        usuario_id: req.user.id,
        rol: req.user.tipo_user,
        accion: "APROBAR",
        tabla: "ordenes",
        descripcion: `Orden ${id} verificada`,
        ip: req.ip,
      });

      res.json({ message: "Orden verificada con éxito" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al verificar la orden" });
    }
  }
);

router.post(
  "/denegarOrden/:id",
  authenticateToken,
  async (req, res) => {
    const { id } = req.params;

    try {
      await db.query(
        "UPDATE ordenes SET estado = 'rechazado' WHERE id = $1",
        [id]
      );

      await registrarBitacora({
        usuario_id: req.user.id,
        rol: req.user.tipo_user,
        accion: "DENEGAR",
        tabla: "ordenes",
        descripcion: `Orden ${id} rechazada`,
        ip: req.ip,
      });

      res.json({ message: "Orden rechazada correctamente" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Error al rechazar la orden" });
    }
  }
);

router.get("/empleRegistrados", authenticateToken, async (req, res) => {
  const result = await db.query(
    "SELECT * FROM usuarios WHERE tipo_user = 'trabajador' AND permisos = 'permitido' ORDER BY id"
  );
  res.json(result.rows);
});

router.get("/userRegistrados", authenticateToken, async (req, res) => {
  const result = await db.query(
    "SELECT * FROM usuarios WHERE tipo_user = 'cliente' ORDER BY id"
  );
  res.json(result.rows);
});

router.get("/estadisticas/ordenes-estado", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        estado,
        COUNT(*) AS cantidad
      FROM ordenes
      GROUP BY estado
      ORDER BY estado
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error en órdenes por estado:", error);
    res.status(500).json({ error: "Error al obtener órdenes por estado" });
  }
});

router.get("/estadisticas/ingresos-mensuales", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        TO_CHAR(fecha_emision, 'YYYY-MM') AS mes,
        SUM(total) AS ingresos
      FROM facturas
      GROUP BY mes
      ORDER BY mes
    `);

    res.json(
      result.rows.map(item => ({
        mes: item.mes,
        ingresos: Number(item.ingresos)
      }))
    );
  } catch (error) {
    console.error("Error en ingresos mensuales:", error);
    res.status(500).json({ error: "Error al obtener ingresos mensuales" });
  }
});

router.get("/estadisticas/ordenes-trabajador", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        u.nombre AS trabajador,
        COUNT(o.id) AS cantidad
      FROM ordenes o
      JOIN usuarios u ON o.id_trabajador = u.id
      GROUP BY u.nombre
      ORDER BY cantidad DESC
    `);

    res.json(
      result.rows.map(item => ({
        trabajador: item.trabajador,
        cantidad: Number(item.cantidad)
      }))
    );
  } catch (error) {
    console.error("Error en órdenes por trabajador:", error);
    res.status(500).json({ error: "Error al obtener órdenes por trabajador" });
  }
});

// OBTENER PERFIL DEL USUARIO
router.get("/perfil", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(`
      SELECT 
        id,
        nombre,
        email,
        telefono,
        ubicacion,
        fecha_nacimiento,
        fecha_de_registro,
        dni,
        fotos
      FROM usuarios
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Error al obtener perfil:", error);
    res.status(500).json({ error: "Error al obtener perfil" });
  }
});

// EDITAR PERFIL DEL USUARIO
router.put("/editar", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      nombre,
      email,
      telefono,
      ubicacion,
      fecha_nacimiento
    } = req.body;

    const result = await db.query(`
      UPDATE usuarios
      SET
        nombre = $1,
        email = $2,
        telefono = $3,
        ubicacion = $4,
        fecha_nacimiento = $5
      WHERE id = $6
      RETURNING 
        id,
        nombre,
        email,
        telefono,
        ubicacion,
        fecha_nacimiento,
        fecha_de_registro,
        dni,
        fotos
    `, [
      nombre,
      email,
      telefono,
      ubicacion,
      fecha_nacimiento,
      userId
    ]);

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Error al editar perfil:", error);
    res.status(500).json({ error: "Error al editar perfil" });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/perfiles";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `perfil_${req.user.id}_${Date.now()}${ext}`);
  }
});

const upload = multer({ storage });

// SUBIR FOTO DE PERFIL
router.post(
  "/perfil/foto",
  authenticateToken,
  upload.single("foto"),
  async (req, res) => {
    try {
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({ error: "No se envió ninguna imagen" });
      }

      const fotoPath = `/uploads/perfiles/${req.file.filename}`;

      const result = await db.query(`
        UPDATE usuarios
        SET fotos = $1
        WHERE id = $2
        RETURNING fotos
      `, [fotoPath, userId]);

      res.json({
        message: "Foto actualizada",
        user: result.rows[0]
      });

    } catch (error) {
      console.error("Error al subir foto:", error);
      res.status(500).json({ error: "Error al subir foto" });
    }
  }
);


module.exports = {
  adminRoutes: router,
  authenticateToken,
};
