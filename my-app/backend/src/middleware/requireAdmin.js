import { verifyAdminToken } from '../services/jwtService.js'

export function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const m = header.match(/^Bearer\s+(.+)$/i)
    if (!m) {
      return res.status(401).json({ message: 'Missing Authorization Bearer token' })
    }
    verifyAdminToken(m[1].trim())
    req.adminEmail = 'admin'
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired admin session' })
  }
}
