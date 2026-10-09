# Ponerlo en producción

Coste orientativo: **5–8 € al mes** por un VPS de 2 vCPU y 4 GB, por ejemplo un Hetzner CX22 o equivalente en OVH o Contabo, con centro de datos en la UE. Un solo servidor puede atender a varios restaurantes, cada uno con su carpeta, su dominio y su `.env`.

## 1 · Servidor

1. Crea un servidor con Ubuntu 24.04 e instala Docker:

   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

2. Apunta un subdominio a la IP del servidor con un registro A, por ejemplo `reservas.restaurante.es`.
3. Abre en el cortafuegos solo los puertos 22, 80 y 443.

## 2 · Instalar

```bash
git clone https://github.com/hodeione/reservas-n8n /opt/reservas-n8n
cd /opt/reservas-n8n
cp .env.example .env
nano .env
```

En el `.env`:

| Variable | Valor en producción |
|---|---|
| `URL_PUBLICA` | `https://reservas.restaurante.es` |
| `DOMINIO` | `reservas.restaurante.es` |
| `N8N_SECURE_COOKIE` | `true` |
| `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY` | Valores largos y aleatorios: `openssl rand -hex 24` |
| `N8N_ADMIN_PASSWORD`, `REST_CLAVE_PANEL`, `REST_CLAVE_AGENTE` | Contraseñas fuertes y distintas |
| `SMTP_*` | Un proveedor real (ver abajo) |
| `REST_*` | Los datos del restaurante |

Arranca e instala los flujos:

```bash
docker compose --profile prod up -d
docker run --rm --network host -v "$PWD":/app -w /app node:22-alpine node scripts/setup.mjs
```

Caddy obtiene el certificado HTTPS él solo.

| Qué | Dirección |
|---|---|
| Reservas para clientes | `https://reservas.restaurante.es/webhook/reservar` |
| Panel del restaurante | `https://reservas.restaurante.es/webhook/panel?clave=…` |
| Editor de n8n | `https://reservas.restaurante.es` |

## 3 · Correo

| Proveedor | SMTP | Notas |
|---|---|---|
| Brevo | `smtp-relay.brevo.com:587` | 300 emails al día gratis. Verifica el dominio con SPF y DKIM. |
| Gmail o Google Workspace | `smtp.gmail.com:465` (`SMTP_SECURE=true`) | Usa una contraseña de aplicación. Límite de unos 500 al día. |
| Resend | `smtp.resend.com:465` (`SMTP_SECURE=true`) | Usuario `resend` y la clave de API como contraseña. |

Si cambias el `.env`, vuelve a ejecutar el instalador. Recrea la credencial y actualiza los flujos sin borrar reservas.

## 4 · Dónde poner el enlace de reservas

- **Botón «Reservar» del Perfil de Empresa de Google.** Es el que más reservas trae.
- Biografía de Instagram y botón de WhatsApp Business.
- Web del restaurante, como botón o como `<iframe>`.

## 5 · Mantenimiento

- **Copias de seguridad.** Programa `scripts/backup.sh` en el cron, por ejemplo cada día a las 4:00, y copia la carpeta `backups/` fuera del servidor.
- **Actualizaciones.** Cambia la versión de la imagen en `docker-compose.yml`, ejecuta `docker compose pull && docker compose --profile prod up -d` y después las pruebas en un entorno de pruebas.
- **Errores.** n8n guarda las ejecuciones fallidas: en el editor, pestaña *Executions*.
