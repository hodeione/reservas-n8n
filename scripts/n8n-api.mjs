// Cliente mínimo de la API de n8n (REST interna + API pública), sin dependencias.
import { readFileSync } from 'node:fs'

export function loadEnv(path = new URL('../.env', import.meta.url)) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!m) continue
    // Quita comentarios en línea ("valor   # comentario") y comillas.
    env[m[1]] = m[2].replace(/\s+#.*$/, '').trim().replace(/^"(.*)"$/, '$1')
  }
  return env
}

export class N8n {
  constructor(base) {
    this.base = base.replace(/\/$/, '')
    this.cookie = ''
    this.apiKey = ''
  }

  async waitHealthy(timeoutMs = 120_000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      try {
        // /healthz responde antes de que la API esté lista: se espera a /rest/settings con JSON.
        const r = await fetch(`${this.base}/rest/settings`)
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) return
      } catch {}
      await new Promise((r) => setTimeout(r, 1500))
    }
    throw new Error('n8n no responde en ' + this.base)
  }

  async rest(method, path, body) {
    const res = await fetch(`${this.base}/rest${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) this.cookie = set.split(';')[0]
    const text = await res.text()
    const data = text ? JSON.parse(text) : {}
    if (!res.ok) throw new Error(`${method} /rest${path} -> ${res.status}: ${text.slice(0, 300)}`)
    return data.data ?? data
  }

  async api(method, path, body) {
    const res = await fetch(`${this.base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'X-N8N-API-KEY': this.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} /api/v1${path} -> ${res.status}: ${text.slice(0, 400)}`)
    return text ? JSON.parse(text) : {}
  }

  async ensureOwnerAndLogin(email, password) {
    const settings = await this.rest('GET', '/settings')
    if (settings.userManagement?.showSetupOnFirstLoad) {
      await this.rest('POST', '/owner/setup', { email, firstName: 'Admin', lastName: 'Restaurante', password })
    }
    await this.rest('POST', '/login', { emailOrLdapLoginId: email, password })
    this.project = await this.rest('GET', '/projects/personal')
  }

  async createApiKey() {
    const k = await this.rest('POST', '/api-keys', {
      label: `instalador-${Date.now()}`,
      expiresAt: null,
      scopes: [
        'workflow:create', 'workflow:read', 'workflow:update', 'workflow:delete', 'workflow:list', 'workflow:activate', 'workflow:deactivate',
        'credential:create', 'credential:delete', 'execution:read', 'execution:list',
      ],
    })
    this.apiKey = k.rawApiKey ?? k.apiKey
    if (!this.apiKey || this.apiKey.includes('*')) throw new Error('No se pudo obtener la clave de API.')
  }

  async ensureDataTable(name, columns) {
    const pid = this.project.id
    const list = await this.rest('GET', `/projects/${pid}/data-tables?take=100`)
    const found = (list.data ?? list).find?.((t) => t.name === name)
    if (found) {
      // Añade columnas nuevas si el esquema ha crecido.
      const cols = await this.rest('GET', `/projects/${pid}/data-tables/${found.id}/columns`)
      for (const c of columns) {
        if (!cols.some((x) => x.name === c.name)) await this.rest('POST', `/projects/${pid}/data-tables/${found.id}/columns`, c)
      }
      return found.id
    }
    const created = await this.rest('POST', `/projects/${pid}/data-tables`, { name, columns })
    return created.id
  }

  async rows(tableId) {
    const r = await this.rest('GET', `/projects/${this.project.id}/data-tables/${tableId}/rows?take=500`)
    return r.data ?? r
  }

  async clearRows(tableId) {
    const rows = await this.rows(tableId)
    if (!rows.length) return
    await this.rest('DELETE', `/projects/${this.project.id}/data-tables/${tableId}/rows?filter=${encodeURIComponent(JSON.stringify({ type: 'or', filters: rows.map((r) => ({ columnName: 'id', condition: 'eq', value: r.id })) }))}`)
  }

  async upsertWorkflow(wf) {
    const list = await this.api('GET', '/workflows?limit=250')
    const existing = list.data.find((w) => w.name === wf.name)
    const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? { executionOrder: 'v1' } }
    let id
    if (existing) {
      if (existing.active) await this.api('POST', `/workflows/${existing.id}/deactivate`)
      await this.api('PUT', `/workflows/${existing.id}`, body)
      id = existing.id
    } else {
      id = (await this.api('POST', '/workflows', body)).id
    }
    await this.api('POST', `/workflows/${id}/activate`)
    return id
  }
}
