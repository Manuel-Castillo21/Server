const express = require("express");
const router = express.Router();
const db = require("../db");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
let Resend;
try {
  Resend = require("resend").Resend;
} catch (err) {
  console.warn('Advertencia: módulo resend no encontrado. El envío de emails funcionará en modo fallback.');
}
const { authenticateToken } = require("./admin");

router.put("/verificar/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Traer orden + cliente + servicios + posible hora_servicio si existe
    const result = await db.query(
      `
      SELECT 
        o.id, 
        o.fecha, 
        o.estado, 
        o.hora_servicio,
        o.id_servicio,
        o.subtotal,
        o.iva,
        o.total,
        c.nombre AS cliente, 
        c.email AS email_cliente,
        t.nombre AS trabajador_nombre
      FROM ordenes o
      JOIN usuarios c ON o.id_cliente = c.id
      JOIN usuarios t ON o.id_trabajador = t.id
      WHERE o.id = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    const orden = result.rows[0];

    // Obtener los servicios de la orden
    let servicios = [];
    let subtotal = 0;
    let iva = 0;
    let total = 0;

    if (orden.id_servicio) {
      try {
        const serviciosIds = typeof orden.id_servicio === 'string' 
          ? JSON.parse(orden.id_servicio) 
          : orden.id_servicio;
        
        if (Array.isArray(serviciosIds) && serviciosIds.length > 0) {
          const serviciosRes = await db.query(
            "SELECT id, nombre, precio_estimado FROM servicios WHERE id = ANY($1::int[])",
            [serviciosIds]
          );
          servicios = serviciosRes.rows;
          
          // Usar los cálculos de la orden si existen, sino calcular
          subtotal = orden.subtotal || servicios.reduce((sum, s) => sum + Number(s.precio_estimado), 0);
          iva = orden.iva || subtotal * 0.16;
          total = orden.total || subtotal + iva;
        }
      } catch (error) {
        console.error("Error al procesar servicios:", error);
        // Si hay error, usar valores de la orden
        subtotal = orden.subtotal || 0;
        iva = orden.iva || 0;
        total = orden.total || 0;
      }
    }

    // Actualizar estado de la orden
    await db.query("UPDATE ordenes SET estado = 'verificado' WHERE id = $1", [id]);

    // Crear PDF de la factura
    const archivoFactura = `factura_${orden.id}.pdf`;
    const pdfPath = path.join(__dirname, `../uploads/${archivoFactura}`);
    const stream = fs.createWriteStream(pdfPath);
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    doc.pipe(stream);

    const formatCurrency = (value) => {
      return `$${Number(value).toFixed(2)}`;
    };

    // Encabezado
    // Título en dos líneas con coordenadas fijas para evitar que se amontone
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#1b3a57").text("Alyte Servicios", 50, 50, { align: "left" });

    // Mover el bloque de datos de la factura hacia abajo para no solapar el encabezado
    const invoiceTop = 110;
    doc.fontSize(14).font("Helvetica-Bold").text("FACTURA", 400, invoiceTop);
    doc.fontSize(10).font("Helvetica").text(`No: ${orden.id}`, 400, invoiceTop + 20);
    doc.text(`Fecha: ${new Date(orden.fecha).toLocaleDateString()}`, 400, invoiceTop + 35);

    // Línea horizontal
    doc.moveDown();
    doc.strokeColor("#eeeeee").lineWidth(1).moveTo(50, 120).lineTo(545, 120).stroke();

    // Cliente
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#000").text("Facturar a:", 50, 130);
    doc.fontSize(10).font("Helvetica").fillColor("#333").text(orden.cliente, 50, 145);
    if (orden.email_cliente) doc.text(orden.email_cliente, 50, 160);
    
    // Trabajador asignado
    doc.fontSize(10).font("Helvetica").fillColor("#333").text(`Trabajador: ${orden.trabajador_nombre}`, 50, 175);

    // Tabla de servicios
    const tableTop = 220;
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#1b3a57").text("Descripción", 50, tableTop);
    doc.text("Precio unit.", 320, tableTop, { width: 90, align: "right" });
    doc.text("Cantidad", 420, tableTop, { width: 50, align: "right" });
    doc.text("Total", 480, tableTop, { width: 70, align: "right" });

    doc.moveTo(50, tableTop + 18).lineTo(545, tableTop + 18).stroke("#eeeeee");

    // Items (servicios)
    let currentY = tableTop + 30;
    
    if (servicios.length > 0) {
      servicios.forEach((servicio, index) => {
        if (currentY > 650) {
          // Si nos quedamos sin espacio, crear nueva página
          doc.addPage();
          currentY = 50;
        }
        
        doc.fontSize(10).font("Helvetica").fillColor("#000").text(servicio.nombre, 50, currentY, { width: 250 });
        doc.text(formatCurrency(servicio.precio_estimado), 320, currentY, { width: 90, align: "right" });
        doc.text("1", 420, currentY, { width: 50, align: "right" });
        doc.text(formatCurrency(servicio.precio_estimado), 480, currentY, { width: 70, align: "right" });
        
        currentY += 20;
      });
    } else {
      // Fallback si no hay servicios
      doc.fontSize(10).font("Helvetica").fillColor("#000").text("Servicio de limpieza", 50, currentY);
      doc.text(formatCurrency(subtotal), 320, currentY, { width: 90, align: "right" });
      doc.text("1", 420, currentY, { width: 50, align: "right" });
      doc.text(formatCurrency(subtotal), 480, currentY, { width: 70, align: "right" });
      currentY += 20;
    }

    // Totales
    const totalsTop = Math.max(currentY + 20, 400);
    doc.fontSize(10).font("Helvetica-Bold").text("Subtotal", 400, totalsTop, { width: 90, align: "right" });
    doc.font("Helvetica").text(formatCurrency(subtotal), 500, totalsTop, { width: 70, align: "right" });

    doc.font("Helvetica-Bold").text("IVA (16%)", 400, totalsTop + 18, { width: 90, align: "right" });
    doc.font("Helvetica").text(formatCurrency(iva), 500, totalsTop + 18, { width: 70, align: "right" });

    // Aumenta la visibilidad del bloque TOTAL (antes estaba muy opaco)
    doc.rect(395, totalsTop + 40, 150, 24).fillOpacity(0.2).fillAndStroke("#f5f8ff", "#d9e7ff");
    doc.fillOpacity(1); // resetear opacidad para texto normal
    doc.fillColor("#000").font("Helvetica-Bold").text("TOTAL", 400, totalsTop + 44, { width: 90, align: "right" });
    doc.text(formatCurrency(total), 500, totalsTop + 44, { width: 70, align: "right" });

    // Información adicional
    const infoTop = totalsTop + 80;
    doc.fontSize(9).font("Helvetica").fillColor("#666")
       .text(`Número de servicios: ${servicios.length}`, 50, infoTop)
       .text(`Estado: ${orden.estado}`, 50, infoTop + 15);

    // Footer
    const footerY = 750;
    doc.fontSize(10).font("Helvetica").fillColor("#666").text(
      "Gracias por confiar en Alyte. Para dudas sobre la factura contáctenos.",
      50,
      footerY,
      { align: "center", width: 500 }
    );

    doc.end();

    // Esperar a que el stream termine
    await new Promise((resolve) => stream.on("finish", resolve));

    // Determinar hora_servicio: usa la hora de la orden si existe, sino la hora actual
    const hora_servicio = orden.hora_servicio || new Date().toTimeString().split(" ")[0];
    const fecha_emision = new Date();

    // INSERT en la tabla facturas
    await db.query(
      `INSERT INTO facturas (id_orden, subtotal, iva, total, fecha_emision, archivo, hora_servicio)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orden.id, subtotal, iva, total, fecha_emision, archivoFactura, hora_servicio]
    );

    if (!Resend || !process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 'tu-api-key-de-resend-aqui') {
      console.warn('Advertencia: Resend no está disponible o no está configurado. Se guarda la factura sin enviar email.');
      return res.json({
        message: "Factura verificada correctamente (sin envío de email)",
        detalles: {
          ordenId: orden.id,
          servicios: servicios.length,
          total: total,
          emailEnviado: false,
          nota: "Instala el paquete 'resend' y configura RESEND_API_KEY para habilitar email"
        }
      });
    }

    // Inicializar Resend
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Preparar adjunto PDF como base64 para Resend
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString("base64");

    try {
      const sendResponse = await resend.emails.send({
        from: process.env.RESEND_FROM || 'Alyte Servicios <onboarding@resend.dev>', // Cambia esto por tu dominio verificado
        to: [orden.email_cliente],
        subject: "Factura de tu servicio verificado",
        html: `
          <h2>Hola ${orden.cliente},</h2>
          <p>Tu pago ha sido verificado exitosamente. Adjuntamos tu factura en PDF.</p>
          <p><strong>Detalles de la orden:</strong></p>
          <ul>
            <li>Número de orden: ${orden.id}</li>
            <li>Fecha: ${new Date(orden.fecha).toLocaleDateString()}</li>
            <li>Servicios contratados: ${servicios.length}</li>
            <li>Total: ${formatCurrency(total)}</li>
          </ul>
          <p>Trabajador asignado: ${orden.trabajador_nombre}</p>
          <p>Gracias por confiar en nuestros servicios.</p>
        `,
        attachments: [
          {
            filename: archivoFactura,
            type: "application/pdf",
            content: pdfBase64,
            disposition: "attachment",
          },
        ],
      });

      res.json({
        message: "Factura verificada y enviada correctamente.",
        detalles: {
          ordenId: orden.id,
          servicios: servicios.length,
          total: total,
          emailEnviado: orden.email_cliente,
          resendId: sendResponse?.id || null
        }
      });
    } catch (sendError) {
      console.error("Error al enviar email con Resend:", sendError);
      res.status(200).json({
        message: "Factura verificada. No se pudo enviar el correo electrónico.",
        detalles: {
          ordenId: orden.id,
          servicios: servicios.length,
          total: total,
          emailEnviado: false,
          error: sendError.message || sendError
        }
      });
    }
  } catch (error) {
    console.error("Error al verificar y enviar factura:", error);
    res.status(500).json({ error: "Error al procesar la factura", details: error.message });
  }
});

// OBTENER TODAS LAS FACTURAS CON INFORMACIÓN COMPLETA (ACTUALIZADO)
router.get("/", async (req, res) => {
  try {
    const facturas = await db.query(
      `
      SELECT 
        f.id,
        f.id_orden,
        f.subtotal,
        f.iva,
        f.total,
        f.fecha_emision,
        f.archivo,
        f.hora_servicio,
        o.estado AS estado_orden,
        o.id_servicio,
        c.nombre AS cliente_nombre,
        c.email AS cliente_email,
        t.nombre AS trabajador_nombre
      FROM facturas f
      JOIN ordenes o ON f.id_orden = o.id
      JOIN usuarios c ON o.id_cliente = c.id
      JOIN usuarios t ON o.id_trabajador = t.id
      ORDER BY f.fecha_emision DESC
      `
    );

    // Procesar para obtener información de servicios
    const facturasProcesadas = await Promise.all(
      facturas.rows.map(async (factura) => {
        let serviciosInfo = [];
        let serviciosCount = 0;
        
        if (factura.id_servicio) {
          try {
            const serviciosIds = typeof factura.id_servicio === 'string' 
              ? JSON.parse(factura.id_servicio) 
              : factura.id_servicio;
            
            if (Array.isArray(serviciosIds) && serviciosIds.length > 0) {
              serviciosCount = serviciosIds.length;
              const serviciosRes = await db.query(
                "SELECT nombre FROM servicios WHERE id = ANY($1::int[]) LIMIT 3",
                [serviciosIds]
              );
              serviciosInfo = serviciosRes.rows.map(s => s.nombre);
            }
          } catch (error) {
            console.error("Error al procesar servicios:", error);
          }
        }

        return {
          ...factura,
          servicios_nombres: serviciosInfo,
          servicios_count: serviciosCount,
          servicio_principal: serviciosInfo[0] || "Múltiples servicios"
        };
      })
    );

    res.json(facturasProcesadas);
  } catch (error) {
    console.error("Error al obtener facturas:", error);
    res.status(500).json({ error: "Error al obtener facturas" });
  }
});

// OBTENER FACTURAS DEL CLIENTE AUTENTICADO (ACTUALIZADO)
router.get("/cliente/mis-facturas", authenticateToken, async (req, res) => {
  const clienteId = req.user.id;

  try {
    const facturas = await db.query(
      `
      SELECT 
        f.id,
        f.id_orden,
        f.subtotal,
        f.iva,
        f.total,
        f.fecha_emision,
        f.archivo,
        f.hora_servicio,
        o.estado AS estado_orden,
        o.id_servicio,
        t.nombre AS trabajador_nombre
      FROM facturas f
      JOIN ordenes o ON f.id_orden = o.id
      JOIN usuarios t ON o.id_trabajador = t.id
      WHERE o.id_cliente = $1
      ORDER BY f.fecha_emision DESC
      `,
      [clienteId]
    );

    // Procesar para obtener información de servicios
    const facturasProcesadas = await Promise.all(
      facturas.rows.map(async (factura) => {
        let serviciosInfo = [];
        let serviciosCount = 0;
        
        if (factura.id_servicio) {
          try {
            const serviciosIds = typeof factura.id_servicio === 'string' 
              ? JSON.parse(factura.id_servicio) 
              : factura.id_servicio;
            
            if (Array.isArray(serviciosIds) && serviciosIds.length > 0) {
              serviciosCount = serviciosIds.length;
              const serviciosRes = await db.query(
                "SELECT nombre FROM servicios WHERE id = ANY($1::int[])",
                [serviciosIds]
              );
              serviciosInfo = serviciosRes.rows.map(s => s.nombre);
            }
          } catch (error) {
            console.error("Error al procesar servicios:", error);
          }
        }

        return {
          ...factura,
          servicios_nombres: serviciosInfo,
          servicios_count: serviciosCount,
          servicio_principal: serviciosInfo[0] || "Múltiples servicios"
        };
      })
    );

    res.json(facturasProcesadas);
  } catch (error) {
    console.error("Error al obtener facturas del cliente:", error);
    res.status(500).json({ error: "Error al obtener facturas" });
  }
});

// DESCARGAR FACTURA PDF
router.get("/descargar/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const factura = await db.query(
      "SELECT archivo FROM facturas WHERE id = $1",
      [id]
    );

    if (factura.rows.length === 0) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    const archivo = factura.rows[0].archivo;
    const pdfPath = path.join(__dirname, `../uploads/${archivo}`);

    // Verificar si el archivo existe
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: "Archivo PDF no encontrado" });
    }

    // Enviar el archivo PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
    
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error("Error al descargar factura:", error);
    res.status(500).json({ error: "Error al descargar factura" });
  }
});

// VER FACTURA PDF EN EL NAVEGADOR
router.get("/ver/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const factura = await db.query(
      "SELECT archivo FROM facturas WHERE id = $1",
      [id]
    );

    if (factura.rows.length === 0) {
      return res.status(404).json({ error: "Factura no encontrada" });
    }

    const archivo = factura.rows[0].archivo;
    const pdfPath = path.join(__dirname, `../uploads/${archivo}`);

    // Verificar si el archivo existe
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: "Archivo PDF no encontrado" });
    }

    // Mostrar el PDF en el navegador
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${archivo}"`);
    
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error) {
    console.error("Error al mostrar factura:", error);
    res.status(500).json({ error: "Error al mostrar factura" });
  }
});

module.exports = router;