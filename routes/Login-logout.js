const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const registrarBitacora = require("./bitacora");
const API_URL_FRONT= process.env.FRONTEND_URL;

router.post("/Login", async (req, res) => {
  const { email, password } = req.body;

  // ADMIN HARDCODEADO
  if (email === "alyte84@gmail.com" && password === "31302712") {
    const token = jwt.sign(
      { id: 0, email, tipo_user: "admin" },
      process.env.JWT_SECRET || "tu_clave_secreta",
      { expiresIn: "24h" }
    );

    await registrarBitacora({
      usuario_id: 0,
      rol: "admin",
      accion: "LOGIN",
      tabla: "usuarios",
      descripcion: "Inicio de sesión administrador",
      ip: req.ip,
    });

    return res.json({ token, role: "admin" });
  }

  try {
    const result = await db.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).send("Credenciales inválidas");
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).send("Credenciales inválidas");
    }

    if (user.tipo_user === "trabajador") {
      if (user.permisos === "En espera") {
        return res
          .status(403)
          .send(
            "Su cuenta está en espera de aprobación por un administrador."
          );
      }

      if (user.permisos !== "permitido") {
        return res
          .status(403)
          .send("Su cuenta no tiene permisos para iniciar sesión.");
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, tipo_user: user.tipo_user },
      process.env.JWT_SECRET || "tu_clave_secreta",
      { expiresIn: "24h" }
    );

    await registrarBitacora({
      usuario_id: user.id,
      rol: user.tipo_user,
      accion: "LOGIN",
      tabla: "usuarios",
      descripcion: "Inicio de sesión exitoso",
      ip: req.ip,
    });

    res.json({ token, role: user.tipo_user });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error del servidor");
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 3600000);

  try {
    const userCheck = await db.query(
      "SELECT id, tipo_user FROM usuarios WHERE email = $1",
      [email]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).send("Correo no registrado");
    }

    const user = userCheck.rows[0];

    await db.query(
      "UPDATE usuarios SET reset_token = $1, reset_token_expires = $2 WHERE email = $3",
      [token, expires, email]
    );
 //ENVIO DE CORREO DE RECUPERACION DE CONTRASEÑA
    const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true', // false para 587, true para 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Validación opcional pero recomendada
if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.error('❌ ERROR: Credenciales de email no configuradas');
  // En producción, esto debería lanzar un error
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP credentials are not configured');
  }
}

const resetLink = `${process.env.API_URL_FRONT}/reset-password/${token}`;

await transporter.sendMail({
  from: process.env.SMTP_FROM || "Soporte <alyte8447@gmail.com>",
  to: email,
  subject: "Recuperar contraseña",
  html: `
    <p>Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
    <a href="${resetLink}">${resetLink}</a>
  `,
});
//FIN
    await registrarBitacora({
      usuario_id: user.id,
      rol: user.tipo_user,
      accion: "SOLICITUD_RESET",
      tabla: "usuarios",
      descripcion: "Solicitud de recuperación de contraseña",
      ip: req.ip,
    });

    res.send("Correo enviado");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error al enviar el correo");
  }
});

router.post("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).send("Debes ingresar una nueva contraseña");
  }

  try {
    const result = await db.query(
      "SELECT id, tipo_user FROM usuarios WHERE reset_token = $1 AND reset_token_expires > NOW()",
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).send("Token inválido o expirado");
    }

    const user = result.rows[0];
    const hash = await bcrypt.hash(newPassword, 10);

    await db.query(
      "UPDATE usuarios SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2",
      [hash, user.id]
    );

    await registrarBitacora({
      usuario_id: user.id,
      rol: user.tipo_user,
      accion: "RESET_PASSWORD",
      tabla: "usuarios",
      descripcion: "Contraseña restablecida correctamente",
      ip: req.ip,
    });

    res.send("Contraseña actualizada correctamente");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error al actualizar la contraseña");
  }
});

router.put("/disponibilidad", async (req, res) => {
  const { id, disponible } = req.body;

  try {
    const result = await db.query(
      "UPDATE perfil SET disponible = $1 WHERE id = $2 RETURNING id, nombre, disponible",
      [disponible, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error al actualizar disponibilidad:", error);
    res.status(500).json({ message: "Error al actualizar disponibilidad" });
  }
});

module.exports = router;
