import { existsSync, readFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, serializeError } from '../util/logger.js'
import { CUST_PW_PREFIX, DRV_PW_PREFIX } from './zohoAppCredentialNotes.js'
import { getModuleById, updateModule } from './zohoBooksService.js'

const log = createLogger('migrate-json')

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', '..', 'data')
const AUTH_JSON = join(DATA_DIR, 'auth-users.json')
const DRIVER_JSON = join(DATA_DIR, 'driver-users.json')

/**
 * One-time: copy password hashes from legacy JSON into Zoho contact `notes`, then rename files to *.bak.
 */
export async function migrateLegacyJsonCredentialsOnce() {
  if (existsSync(AUTH_JSON)) {
    try {
      const raw = readFileSync(AUTH_JSON, 'utf8')
      const rows = JSON.parse(raw)
      if (Array.isArray(rows)) {
        const { findCustomerByEmail } = await import('./zohoBooksService.js')
        for (const row of rows) {
          if (!row?.email || !row?.passwordHash) continue
          const email = String(row.email).trim().toLowerCase()
          let contact = null
          if (row.zohoContactId) {
            const data = await getModuleById('/contacts', row.zohoContactId).catch(() => null)
            contact = data?.contact || data
          }
          if (!contact?.contact_id) {
            contact = await findCustomerByEmail(email)
          }
          if (!contact?.contact_id) continue
          if (String(contact.notes || '').includes(CUST_PW_PREFIX)) continue
          const notes = `${CUST_PW_PREFIX}${row.passwordHash}`
          await updateModule('/contacts', contact.contact_id, {
            contact_id: contact.contact_id,
            notes
          })
          log.info('Migrated customer app login from JSON to Zoho notes', { email })
        }
      }
      renameSync(AUTH_JSON, `${AUTH_JSON}.bak`)
      log.info('Renamed auth-users.json to .bak')
    } catch (err) {
      log.error('auth-users.json migration failed', serializeError(err))
    }
  }

  if (existsSync(DRIVER_JSON)) {
    try {
      const raw = readFileSync(DRIVER_JSON, 'utf8')
      const rows = JSON.parse(raw)
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (!row?.email || !row?.passwordHash || !row?.zohoContactId) continue
          const data = await getModuleById('/contacts', row.zohoContactId).catch(() => null)
          const contact = data?.contact || data
          if (!contact?.contact_id) continue
          if (String(contact.notes || '').includes(DRV_PW_PREFIX)) continue
          const notes = `${DRV_PW_PREFIX}${row.passwordHash}`
          await updateModule('/contacts', contact.contact_id, {
            contact_id: contact.contact_id,
            notes,
            is_active: row.disabled ? false : true
          })
          log.info('Migrated driver app login from JSON to Zoho notes', { email: row.email })
        }
      }
      renameSync(DRIVER_JSON, `${DRIVER_JSON}.bak`)
      log.info('Renamed driver-users.json to .bak')
    } catch (err) {
      log.error('driver-users.json migration failed', serializeError(err))
    }
  }
}
