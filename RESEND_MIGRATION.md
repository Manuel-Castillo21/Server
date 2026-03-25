# Migración de Nodemailer a Resend

## Cambios realizados

Se ha migrado el sistema de envío de emails de **Nodemailer** a **Resend** para simplificar la configuración y mejorar la fiabilidad.

## Instalación

```bash
npm uninstall nodemailer
npm install resend
```

## Configuración

### Variables de entorno (.env)

**Antes (Nodemailer):**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-contraseña-app
SMTP_FROM=tu-email@gmail.com
SMTP_SECURE=false
SMTP_REJECT_UNAUTHORIZED=true
```

**Ahora (Resend):**
```env
RESEND_API_KEY=tu-api-key-de-resend-aqui
```

### Cómo obtener la API Key de Resend

1. Ve a [resend.com](https://resend.com) y crea una cuenta
2. Ve a tu dashboard y copia la API Key
3. Pégala en tu archivo `.env` como `RESEND_API_KEY`

### Configuración del dominio remitente

Por defecto, Resend usa `onboarding@resend.dev` como remitente. Para usar tu propio dominio:

1. Ve a tu dashboard de Resend
2. Ve a "Domains" y agrega/verifica tu dominio
3. Cambia la línea `from` en el código:
   ```javascript
   from: 'Tu App <noreply@tu-dominio.com>',
   ```

## Ventajas de Resend vs Nodemailer

- ✅ **Más simple**: Solo necesitas una API key
- ✅ **Mejor deliverability**: Resend está optimizado para emails transaccionales
- ✅ **Dashboard completo**: Métricas detalladas de envío
- ✅ **Soporte nativo**: Para adjuntos, templates, etc.
- ✅ **Sin configuración SMTP**: No necesitas hosts, puertos, TLS, etc.

## Código actualizado

El código en `routes/facturas.js` ahora usa:

```javascript
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// Enviar email
const { data, error } = await resend.emails.send({
  from: 'Alyte Servicios <onboarding@resend.dev>',
  to: [orden.email_cliente],
  subject: "Factura de tu servicio verificado",
  html: `...`,
  attachments: [...]
});
```

## Testing

Para probar que funciona:

1. Configura tu `RESEND_API_KEY`
2. Reinicia el servidor
3. Aprueba una orden pendiente
4. Verifica que se envíe el email (revisa el dashboard de Resend)

## Notas importantes

- Resend tiene un límite gratuito generoso (100 emails/día)
- Los adjuntos funcionan igual que con Nodemailer
- El HTML del email se mantiene igual
- Si no hay API key configurada, la factura se guarda pero no se envía email