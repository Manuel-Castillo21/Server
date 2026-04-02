const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const pool = require('../db');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

const ADMIN_EMAIL = "alyte84@gmail.com";

router.post('/chat', async (req, res) => {
    try {
        const { message, history, userEmail, userTelefono } = req.body;

        let userRole = "invitado";
        let userData = null;

        if (userEmail === ADMIN_EMAIL) {
            userRole = "admin";
        } else {
            const query = 'SELECT * FROM usuarios WHERE email = $1 OR telefono = $2 LIMIT 1';
            const { rows } = await pool.query(query, [userEmail, userTelefono]);
            if (rows.length > 0) {
                userData = rows[0];
                userRole = userData.tipo_user; 
            }
        }

        let roleInstruction = "";

        if (userRole === "admin") {
            roleInstruction = `
            TU ROL ACTUAL: GUIA PARA EL ADMINISTRADOR.
            MANUAL DEL PANEL:
            SECCION DE ESTADISTICAS (INICIO): Graficas de ordenes por trabajador e ingresos.
            SECCION DE EMPLEADOS: Lista de personal con sus datos.
            SECCION DE ORDENES PENDIENTES: Validar servicios. BOTON VERDE valida y BOTON ROJO rechaza.
            SECCION DE PRODUCTOS: Gestion de inventario y BARRA DE BUSQUEDA.
            SECCION DE SERVICIOS: Gestion de ofertas de Chiwire.
            SECCION DE TRABAJADORES PENDIENTES: Solicitudes de empleo.
            SECCION DE FACTURAS: Registro de transacciones y descarga PDF.`;
        } else if (userRole === "trabajador") {
            roleInstruction = `
            TU ROL ACTUAL: GUIA PARA EL TRABAJADOR.
            HOLA ${userData?.nombre || 'COLEGA'}.
            MANUAL DEL PANEL:
            SECCION PERFIL: Ver datos, ICONO DE LA CAMARA y boton EDITAR.
            SECCION ESTADISTICAS: Graficas de rendimiento e ingresos.
            SECCION TAREAS PENDIENTES: ICONO DE ACEPTAR para iniciar y presionar de nuevo para FINALIZAR.`;
        } else {
            roleInstruction = `
            TU ROL ACTUAL: GUIA PARA EL CLIENTE.
            HOLA ${userData?.nombre || 'ESTIMADO CLIENTE'}.
            MANUAL DEL PANEL:
            SECCION PERFIL: Ver datos, ICONO DE LA CAMARA y boton EDITAR en la barra lateral.
            SOLICITAR SERVICIOS: Menu SERVICIOS, elegir categoria, llenar formulario y añadir EXTRAS.
            RESUMEN Y PAGO: Elegir metodo, subir FOTO DEL PAGO y REFERENCIA.
            HISTORIAL DE PEDIDOS: Seguimiento de ordenes, ICONO DEL OJO para factura e ICONO DE DESCARGA.`;
        }

        // REFUERZO ANTIASTERISCO: Definimos reglas de salida prohibidas
        const systemInstruction = `
        Eres Alyte-Bot, asistente guia de la aplicacion Alyte. Tu unico trabajo es explicar el uso de la plataforma.

        REGLAS DE SALIDA (ESTRICTAS):
        1. PROHIBIDO EL USO DE ASTERISCOS: Nunca escribas **palabra** ni *palabra*. Tampoco uses guiones de lista (-).
        2. RESALTADO: Para resaltar algo IMPORTANTE usa solamente MAYUSCULAS.
        3. FORMATO: Escribe instrucciones numeradas (1. 2. 3.) y usa saltos de linea entre cada paso para que sea legible.
        4. NO MARKDOWN: Tu respuesta debe ser TEXTO PLANO PURÍSIMO.
        5. EJEMPLO PROHIBIDO: **Paso 1** (MAL).
        6. EJEMPLO CORRECTO: PASO 1 (BIEN).
        
        ${roleInstruction}
        `;

        const chatMessages = [
            { role: "system", content: systemInstruction },
            ...(history || []).map(h => ({
                role: h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user',
                content: h.text || (h.parts && h.parts[0]?.text) || ""
            })),
            { role: "user", content: message }
        ];

        const completion = await groq.chat.completions.create({
            messages: chatMessages,
            model: "llama-3.1-8b-instant", 
            temperature: 0.1, // Bajamos a 0.1 para que sea menos propenso a usar sus habitos de entrenamiento
            max_tokens: 1024,
            top_p: 1,
        });

        const responseText = completion.choices[0].message.content;

        res.json({ 
            response: responseText, 
            detectedRole: userRole 
        });

    } catch (error) {
        console.error("Error en el chatbot:", error);
        res.status(500).json({ error: "Error en el servidor del chat" });
    }
});

module.exports = router;