# Ponerlo en producción

Coste orientativo: **5–8 € al mes** por un VPS de 2 vCPU y 4 GB, por ejemplo un Hetzner CX22 o equivalente en OVH o Contabo, con centro de datos en la UE. Un solo servidor puede atender a varios restaurantes, cada uno con su carpeta, su dominio y su `.env`.

## 1 · Servidor

1. Crea un servidor con Ubuntu 24.04 e instala Docker:

   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

2. Apunta dos nombres a la IP del servidor con registros A: el dominio de la web, por ejemplo `restaurante.es`, y uno para el editor de n8n, por ejemplo `n8n.restaurante.es`.
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
| `URL_PUBLICA` | `https://restaurante.es` |
| `DOMINIO` | `restaurante.es` |
| `URL_EDITOR` | `https://n8n.restaurante.es` |
| `DOMINIO_EDITOR` | `n8n.restaurante.es` |
| `N8N_SECURE_COOKIE` | `true` |
| `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY` | Valores largos y aleatorios: `openssl rand -hex 24` |
| `N8N_ADMIN_PASSWORD`, `REST_CLAVE_PANEL`, `REST_CLAVE_AGENTE` | Contraseñas fuertes y distintas |
| `SMTP_*` | Un proveedor real (ver abajo) |
| `REST_*` | Valores iniciales. Después todo se cambia desde el panel, en Ajustes. |

Compila la web, arranca e instala los flujos:

```bash
docker run --rm -v "$PWD/web":/app -w /app node:22-alpine sh -c "npm ci && npm run build"
docker compose --profile prod up -d
docker run --rm --network host -v "$PWD":/app -w /app node:22-alpine node scripts/setup.mjs
```

Caddy obtiene el certificado HTTPS él solo.

| Qué | Dirección |
|---|---|
| Web del restaurante y reservas | `https://restaurante.es` |
| Carta digital (para el QR de las mesas) | `https://restaurante.es/carta` |
| Panel del restaurante | `https://restaurante.es/admin` |
| Editor de n8n | `https://n8n.restaurante.es` |

Los datos de muestra (Taberna Luna) se cargan solo la primera vez. El restaurante los cambia desde el panel: nombre, horario, plano y carta. El QR de la carta se imprime desde Ajustes.

La realidad aumentada de la carta necesita HTTPS, que Caddy ya pone.

## 3 · Correo

| Proveedor | SMTP | Notas |
|---|---|---|
| Brevo | `smtp-relay.brevo.com:587` | 300 emails al día gratis. Verifica el dominio con SPF y DKIM. |
| Gmail o Google Workspace | `smtp.gmail.com:465` (`SMTP_SECURE=true`) | Usa una contraseña de aplicación. Límite de unos 500 al día. |
| Resend | `smtp.resend.com:465` (`SMTP_SECURE=true`) | Usuario `resend` y la clave de API como contraseña. |

Si cambias el `.env`, vuelve a ejecutar el instalador. Recrea la credencial y actualiza los flujos sin borrar reservas.

## 4 · Dónde poner el enlace de la web

- **Botón «Reservar» del Perfil de Empresa de Google.** Es el que más reservas trae.
- Biografía de Instagram y botón de WhatsApp Business.
- El QR de la carta en cada mesa, impreso desde el panel.

## 5 · Mantenimiento

- **Copias de seguridad.** Programa `scripts/backup.sh` en el cron, por ejemplo cada día a las 4:00, y copia la carpeta `backups/` fuera del servidor.
- **Actualizaciones.** Cambia la versión de la imagen en `docker-compose.yml`, ejecuta `docker compose pull && docker compose --profile prod up -d` y después las pruebas en un entorno de pruebas.
- **Cambios en la web.** `git pull`, vuelve a compilar `web/` con el mismo comando y Caddy sirve la versión nueva sin reiniciar.
- **Errores.** n8n guarda las ejecuciones fallidas: en el editor, pestaña *Executions*.
