/** @typedef {'error' | 'warn' | 'info' | 'http' | 'debug'} LogLevel */

const LEVEL_INDEX = /** @type {const} */ ({
  error: 0,
  warn: 1,
  info: 2,
  /** Access / request lines — same threshold as `info` so defaults keep them on */
  http: 2,
  debug: 3
})

function defaultLevelName() {
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

function minLevelIndex() {
  const raw = String(process.env.LOG_LEVEL || defaultLevelName()).toLowerCase()
  if (raw in LEVEL_INDEX) return LEVEL_INDEX[/** @type {keyof typeof LEVEL_INDEX} */ (raw)]
  return LEVEL_INDEX.info
}

function jsonFormat() {
  return String(process.env.LOG_FORMAT || '').toLowerCase() === 'json'
}

/**
 * @param {unknown} err
 * @returns {Record<string, unknown>}
 */
export function serializeError(err) {
  if (err instanceof Error) {
    return { errName: err.name, errMessage: err.message, stack: err.stack }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return { errMessage: String(/** @type {{ message?: unknown }} */ (err).message) }
  }
  return { errMessage: String(err) }
}

/**
 * @param {object} err axios error shape
 */
export function serializeAxiosError(err) {
  const response = 'response' in err ? err.response : undefined
  const config = 'config' in err ? err.config : undefined
  const status = response && typeof response === 'object' && 'status' in response ? response.status : undefined
  const data = response && typeof response === 'object' && 'data' in response ? response.data : undefined
  const url = config && typeof config === 'object' && 'url' in config ? config.url : undefined
  const method = config && typeof config === 'object' && 'method' in config ? config.method : undefined
  const message = 'message' in err && typeof err.message === 'string' ? err.message : String(err)
  return {
    errMessage: message,
    status,
    method,
    url,
    ...(data !== undefined ? { zohoResponse: data } : {})
  }
}

function formatHuman(record) {
  const { ts, level, scope, msg, ...rest } = record
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''
  return `${ts} ${String(level).toUpperCase().padEnd(5)} [${scope}] ${msg}${extra}`
}

/**
 * @param {LogLevel} level
 * @param {string} scope
 * @param {string} msg
 * @param {Record<string, unknown>} [meta]
 */
function emit(level, scope, msg, meta = {}) {
  if (LEVEL_INDEX[level] > minLevelIndex()) return

  const { terminalLine, ...restMeta } = meta
  const record = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...restMeta
  }

  let line
  if (jsonFormat()) {
    line = JSON.stringify(record)
  } else if (typeof terminalLine === 'string') {
    line = terminalLine
  } else {
    line = formatHuman(record)
  }

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * @param {string} scope
 */
export function createLogger(scope) {
  return {
    /** @param {string} msg @param {Record<string, unknown>} [meta] */
    error: (msg, meta) => emit('error', scope, msg, meta),
    /** @param {string} msg @param {Record<string, unknown>} [meta] */
    warn: (msg, meta) => emit('warn', scope, msg, meta),
    /** @param {string} msg @param {Record<string, unknown>} [meta] */
    info: (msg, meta) => emit('info', scope, msg, meta),
    /** @param {string} msg @param {Record<string, unknown>} [meta] */
    http: (msg, meta) => emit('http', scope, msg, meta),
    /** @param {string} msg @param {Record<string, unknown>} [meta] */
    debug: (msg, meta) => emit('debug', scope, msg, meta),
    /** @param {string} childScope */
    child(childScope) {
      return createLogger(`${scope}:${childScope}`)
    }
  }
}
