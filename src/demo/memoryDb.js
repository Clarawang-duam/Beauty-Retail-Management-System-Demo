import { DEMO_STORAGE_KEY } from './mode'
import { buildSeedData } from './seed'

const OP = Symbol('demo-op')

function mark(op, payload = {}) {
  return { [OP]: op, ...payload }
}

function isOp(v) {
  return v && typeof v === 'object' && OP in v
}

function toComparable(v) {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  return v
}

function matchOp(fieldVal, opObj) {
  const op = opObj[OP]
  const val = toComparable(fieldVal)

  switch (op) {
    case 'eq':
      return val === toComparable(opObj.value)
    case 'neq':
      return val !== toComparable(opObj.value)
    case 'gt':
      return val > toComparable(opObj.value)
    case 'gte':
      return val >= toComparable(opObj.value)
    case 'lt':
      return val < toComparable(opObj.value)
    case 'lte':
      return val <= toComparable(opObj.value)
    case 'in':
      return (opObj.value || []).some((x) => toComparable(x) === val)
    case 'and':
      return (opObj.ops || []).every((sub) => matchOp(fieldVal, sub))
    case 'or':
      return (opObj.ops || []).some((sub) => matchOp(fieldVal, sub))
    case 'regexp': {
      try {
        const re = new RegExp(opObj.regexp || '', opObj.options || '')
        return re.test(String(fieldVal ?? ''))
      } catch {
        return false
      }
    }
    default:
      return false
  }
}

function matchWhere(doc, where) {
  if (!where) return true

  if (isOp(where) && where[OP] === 'or') {
    return (where.conditions || []).some((cond) => matchWhere(doc, cond))
  }

  return Object.entries(where).every(([key, expected]) => {
    const actual = doc[key]
    if (isOp(expected)) return matchOp(actual, expected)
    return toComparable(actual) === toComparable(expected)
  })
}

function applyUpdate(doc, data) {
  const next = { ...doc }
  for (const [key, value] of Object.entries(data || {})) {
    if (isOp(value) && value[OP] === 'remove') {
      delete next[key]
    } else if (isOp(value) && value[OP] === 'set') {
      next[key] = value.value
    } else if (isOp(value) && value[OP] === 'inc') {
      next[key] = (Number(next[key]) || 0) + Number(value.value || 0)
    } else {
      next[key] = value
    }
  }
  return next
}

function reviveDates(obj) {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(reviveDates)
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (
      typeof v === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(v) &&
      (k.endsWith('_at') || k === 'scheduled_time' || k === 'date' && v.includes('T'))
    ) {
      out[k] = new Date(v)
    } else if (v && typeof v === 'object') {
      out[k] = reviveDates(v)
    } else {
      out[k] = v
    }
  }
  return out
}

function cloneStore(store) {
  return JSON.parse(JSON.stringify(store), (_, v) => v)
}

export function createMemoryDb() {
  let store = null

  const load = () => {
    if (store) return store
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY)
      if (raw) {
        store = reviveDates(JSON.parse(raw))
        return store
      }
    } catch (err) {
      console.warn('演示数据读取失败，将重建', err)
    }
    store = buildSeedData()
    persist()
    return store
  }

  const persist = () => {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(store))
    } catch (err) {
      console.warn('演示数据写入失败', err)
    }
  }

  const ensureCol = (name) => {
    const s = load()
    if (!s[name]) s[name] = []
    return s[name]
  }

  const command = {
    eq: (value) => mark('eq', { value }),
    neq: (value) => mark('neq', { value }),
    gt: (value) => mark('gt', { value }),
    gte: (value) => mark('gte', { value }),
    lte: (value) => mark('lte', { value }),
    lt: (value) => mark('lt', { value }),
    in: (value) => mark('in', { value }),
    or: (conditions) => mark('or', { conditions }),
    RegExp: ({ regexp, options } = {}) => mark('regexp', { regexp, options }),
    remove: () => mark('remove'),
    set: (value) => mark('set', { value }),
    inc: (value) => mark('inc', { value }),
  }

  Object.keys(command).forEach((name) => {
    if (name === 'or' || name === 'remove' || name === 'set' || name === 'inc') return
    const orig = command[name]
    command[name] = (value) => {
      const node = orig(value)
      node.and = (other) => mark('and', { ops: [node, other] })
      return node
    }
  })

  class Query {
    constructor(collectionName) {
      this.collectionName = collectionName
      this._where = null
      this._order = null
      this._skip = 0
      this._limit = null
    }

    where(cond) {
      this._where = cond
      return this
    }

    orderBy(field, direction = 'asc') {
      this._order = { field, direction }
      return this
    }

    skip(n) {
      this._skip = n || 0
      return this
    }

    limit(n) {
      this._limit = n
      return this
    }

    _rows() {
      let rows = ensureCol(this.collectionName).filter((d) => matchWhere(d, this._where))
      if (this._order) {
        const { field, direction } = this._order
        const dir = direction === 'desc' ? -1 : 1
        rows = [...rows].sort((a, b) => {
          const av = toComparable(a[field])
          const bv = toComparable(b[field])
          if (av === bv) return 0
          if (av == null) return 1
          if (bv == null) return -1
          return av > bv ? dir : -dir
        })
      }
      if (this._skip) rows = rows.slice(this._skip)
      if (this._limit != null) rows = rows.slice(0, this._limit)
      return rows.map((r) => ({ ...r }))
    }

    async get() {
      return { data: this._rows() }
    }

    async count() {
      const all = ensureCol(this.collectionName).filter((d) => matchWhere(d, this._where))
      return { total: all.length }
    }

    async add(data) {
      const col = ensureCol(this.collectionName)
      const _id = data._id || `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const doc = { ...data, _id }
      col.push(doc)
      persist()
      return { id: _id }
    }

    doc(docId) {
      const self = this
      return {
        async get() {
          const found = ensureCol(self.collectionName).find((d) => d._id === docId)
          return { data: found ? [{ ...found }] : [] }
        },
        async update(data) {
          const col = ensureCol(self.collectionName)
          const idx = col.findIndex((d) => d._id === docId)
          if (idx === -1) throw new Error(`文档不存在: ${docId}`)
          col[idx] = applyUpdate(col[idx], data)
          persist()
          return { updated: 1 }
        },
        async remove() {
          const col = ensureCol(self.collectionName)
          const idx = col.findIndex((d) => d._id === docId)
          if (idx >= 0) col.splice(idx, 1)
          persist()
          return { deleted: 1 }
        },
      }
    }
  }

  const db = {
    command,
    RegExp: command.RegExp,
    collection(name) {
      return new Query(name)
    },
  }

  const reset = () => {
    store = buildSeedData()
    persist()
  }

  const getSnapshot = () => cloneStore(load())

  return { db, reset, getSnapshot, load }
}

export function createDemoAuth() {
  let loggedIn = true
  return {
    getLoginState: async () => (loggedIn ? { isLoggedIn: true } : null),
    anonymousAuthProvider: () => ({
      signIn: async () => {
        loggedIn = true
        return {}
      },
    }),
    signOut: async () => {
      loggedIn = false
    },
  }
}

export function createDemoApp(db) {
  return {
    auth: () => createDemoAuth(),
    database: () => db,
    uploadFile: async ({ cloudPath, filePath }) => {
      let url = ''
      try {
        if (filePath instanceof Blob) url = URL.createObjectURL(filePath)
      } catch (_) {}
      return { fileID: `demo-file://${cloudPath}`, download_url: url }
    },
    getTempFileURL: async ({ fileList }) => ({
      fileList: (fileList || []).map((id) => ({
        fileID: id,
        tempFileURL: typeof id === 'string' && id.startsWith('demo-file://') ? '' : id,
      })),
    }),
    deleteFile: async () => ({ fileList: [] }),
  }
}
