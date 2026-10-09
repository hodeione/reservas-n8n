# Web del restaurante

Web pública (portada, carta digital en 3D y reservas con plano de mesas) y panel de administración en `/admin`.

React 19, TypeScript, Tailwind 4 y Vite. La API son los flujos de n8n bajo `/webhook`.

```bash
npm ci
npm run dev     # http://localhost:5173, con la API redirigida a n8n (localhost:5680)
npm run build   # genera dist/, que sirve Caddy
```

Modelos 3D: [Food Kit de Kenney](https://kenney.nl/assets/food-kit), dominio público (CC0).
