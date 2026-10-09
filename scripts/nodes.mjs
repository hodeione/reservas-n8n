// Fábricas de nodos de n8n 1.120 y utilidades para conectar flujos.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const LIB = readFileSync(new URL('../src/lib.js', import.meta.url), 'utf8')

// Ids estables (derivados del nombre) para que reimportar no cambie nada.
const stableId = (s) => {
  const h = createHash('sha1').update(s).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export class Flow {
  constructor(name) {
    this.name = name
    this.nodes = []
    this.connections = {}
    this.x = 0
  }
  add(node, [x, y] = [this.x += 240, 0]) {
    node.id = stableId(this.name + '/' + node.name)
    node.position = [x, y]
    this.nodes.push(node)
    return node.name
  }
  /** connect('A', 'B') o connect('IF', 'B', 1) para la salida «false» de un IF. */
  connect(from, to, output = 0) {
    const c = (this.connections[from] ??= { main: [] })
    while (c.main.length <= output) c.main.push([])
    c.main[output].push({ node: to, type: 'main', index: 0 })
  }
  chain(...names) {
    for (let i = 0; i < names.length - 1; i++) this.connect(names[i], names[i + 1])
  }
  toJSON() {
    return { name: this.name, nodes: this.nodes, connections: this.connections, settings: { executionOrder: 'v1', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none', callerPolicy: 'workflowsFromSameOwner' } }
  }
}

export const webhook = (name, method, path, responseMode = 'responseNode') => ({
  name,
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  webhookId: stableId('webhook/' + method + '/' + path),
  parameters: { httpMethod: method, path, responseMode, options: {} },
})

export const schedule = (name, rule) => ({ name, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, parameters: { rule: { interval: [rule] } } })

/** Nodo Code con la librería común delante. */
export const code = (name, body) => ({
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  parameters: { jsCode: `${LIB}\n/* ---- ${name} ---- */\n${body.trim()}\n` },
})

const table = (key) => ({ __rl: true, mode: 'id', value: `__DT_${key}__` })
const conds = (list) => ({ conditions: list.map(([keyName, condition, keyValue]) => ({ keyName, condition, keyValue })) })

export const dtGet = (name, key, conditions, extra = {}) => ({
  name,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  alwaysOutputData: true,
  ...extra,
  parameters: { resource: 'row', operation: 'get', dataTableId: table(key), matchType: 'allConditions', filters: conds(conditions), returnAll: true },
})

export const dtInsert = (name, key) => ({
  name,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  parameters: {
    resource: 'row',
    operation: 'insert',
    dataTableId: table(key),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: false },
    options: {},
  },
})

/** Actualiza las filas que cumplan `conditions` con los campos del item de entrada. */
export const dtUpdate = (name, key, conditions) => ({
  name,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  parameters: {
    resource: 'row',
    operation: 'update',
    dataTableId: table(key),
    matchType: 'allConditions',
    filters: conds(conditions),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: false },
    options: {},
  },
})

/** Email HTML. El item debe traer { para, asunto, html }. Si falla, el flujo sigue. */
export const email = (name) => ({
  name,
  type: 'n8n-nodes-base.emailSend',
  typeVersion: 2.1,
  onError: 'continueRegularOutput',
  credentials: { smtp: { id: '__SMTP__', name: 'SMTP restaurante' } },
  parameters: {
    fromEmail: '={{ $env.REST_NOMBRE }} <{{ $env.REST_EMAIL_REMITENTE }}>',
    toEmail: '={{ $json.para }}',
    subject: '={{ $json.asunto }}',
    emailFormat: 'html',
    html: '={{ $json.html }}',
    options: { appendAttribution: false },
  },
})

/** Si el item trae `ok` verdadero sigue por la salida 0; si no, por la 1. */
export const ifTrue = (name, field = 'ok') => ({
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 1,
  parameters: { conditions: { boolean: [{ value1: `={{ !!$json.${field} }}`, value2: true }] } },
})

/** Responde con { status, body } del item: JSON o HTML según el tipo de body. */
export const respondJson = (name) => ({
  name,
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  parameters: {
    respondWith: 'json',
    responseBody: '={{ $json.body }}',
    options: { responseCode: '={{ $json.status || 200 }}', responseHeaders: { entries: [{ name: 'cache-control', value: 'no-store' }] } },
  },
})

export const respondHtml = (name) => ({
  name,
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  parameters: {
    respondWith: 'text',
    responseBody: '={{ $json.html }}',
    options: {
      responseCode: '={{ $json.status || 200 }}',
      responseHeaders: {
        entries: [
          { name: 'content-type', value: 'text/html; charset=utf-8' },
          { name: 'cache-control', value: 'no-store' },
          { name: 'x-frame-options', value: 'DENY' },
        ],
      },
    },
  },
})

/** Llamada HTTP interna (p. ej. para avisar a la lista de espera). Si falla, sigue. */
export const httpPost = (name, url, jsonBody) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  onError: 'continueRegularOutput',
  parameters: { method: 'POST', url, sendBody: true, specifyBody: 'json', jsonBody, options: { timeout: 15000 } },
})

/** IF con expresión libre (salida 0 = verdadero). */
export const ifExpr = (name, expr) => ({
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 1,
  parameters: { conditions: { boolean: [{ value1: `={{ ${expr} }}`, value2: true }] } },
})

/** Actualiza con valores fijos (no depende del item de entrada). */
export const dtSet = (name, key, conditions, values) => ({
  name,
  type: 'n8n-nodes-base.dataTable',
  typeVersion: 1,
  parameters: {
    resource: 'row',
    operation: 'update',
    dataTableId: table(key),
    matchType: 'allConditions',
    filters: conds(conditions),
    columns: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('=') ? v : `={{ ${JSON.stringify(v)} }}`])),
      matchingColumns: [],
      schema: Object.entries(values).map(([k, v]) => ({
        id: k, displayName: k, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true,
        type: typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string',
      })),
      attemptToConvertTypes: false,
      convertFieldsToString: false,
    },
    options: {},
  },
})

/** Respuesta JSON con cuerpo y código calculados por expresión. */
export const respondExpr = (name, bodyExpr, statusExpr = '200') => ({
  name,
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  parameters: {
    respondWith: 'json',
    responseBody: `={{ ${bodyExpr} }}`,
    options: { responseCode: `={{ ${statusExpr} }}`, responseHeaders: { entries: [{ name: 'cache-control', value: 'no-store' }] } },
  },
})
