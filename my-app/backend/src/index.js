import cors from 'cors'
import express from 'express'
import { authRoutes } from './routes/authRoutes.js'
import { adminRoutes } from './routes/adminRoutes.js'
import { customerRoutes } from './routes/customerRoutes.js'
import { paymentRoutes } from './routes/paymentRoutes.js'
import { deliveryAuthRoutes } from './routes/deliveryAuthRoutes.js'
import { env } from './config/env.js'
import { createLogger, serializeError } from './util/logger.js'
import { errorHandler } from './middleware/errorHandler.js'
import { requestLogger } from './middleware/requestLogger.js'
import { requireAdmin } from './middleware/requireAdmin.js'
import { healthRoutes } from './routes/healthRoutes.js'
import { itemImageRoutes } from './routes/itemImageRoutes.js'
import { zohoRoutes } from './routes/zohoRoutes.js'
import { seedDefaultUser } from './services/authStore.js'
import { migrateLegacyJsonCredentialsOnce } from './services/migrateLegacyJsonCredentials.js'
import { warmItemCategoryIndex } from './services/itemCategoryIndexCache.js'
import { startZohoDynamoSyncCron, warmDynamoListCaches } from './services/dynamoSyncScheduler.js'
import { isDynamoConfigured } from './services/dynamo/dynamoClient.js'

const log = createLogger('bootstrap')

const app = express()

// Allow any browser / Capacitor / WebView origin. Reflect the request `Origin` (not `*`) so preflight +
// credentialed requests work; echo requested headers on OPTIONS (cors default when allowedHeaders unset).
app.use(
  cors({
    origin: (_origin, cb) => cb(null, true),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    optionsSuccessStatus: 204
  })
)

app.use(express.json({ limit: '1mb' }))
app.use(requestLogger)

app.use('/health', healthRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/customer', customerRoutes)
app.use('/api/customer/payments', paymentRoutes)
app.use('/api/delivery', deliveryAuthRoutes)
app.use('/api/items', itemImageRoutes)
app.use('/api/zoho', requireAdmin, zohoRoutes)

app.use(errorHandler)

async function start() {
  try {
    await migrateLegacyJsonCredentialsOnce()
    await seedDefaultUser()
  } catch (err) {
    log.error('Startup data init failed', serializeError(err))
  }

  app.listen(env.PORT, () => {
    log.info('HTTP server listening', {
      port: env.PORT,
      url: `http://localhost:${env.PORT}`,
      nodeEnv: process.env.NODE_ENV || 'development',
      zohoRegion: env.ZOHO_REGION,
      dynamodbConfigured: isDynamoConfigured(),
      dynamodbReads: env.DYNAMODB_READS,
      dynamodbWrites: env.DYNAMODB_ENABLED
    })
    log.info('Default customer login email (dev reference)', { email: env.AUTH_DEFAULT_CUSTOMER_EMAIL })
    // Prefetch Dynamo list scans + category index so admin pages are fast after boot.
    warmDynamoListCaches()
    warmItemCategoryIndex()
    // Prefetch pricing tiers / product categories catalogs (single contact GETs).
    void import('./services/customerPricingZohoService.js')
      .then((m) => (m.isCustomerPricingConfigured() ? m.listPricingTiers() : null))
      .catch(() => {})
    void import('./services/productCategoryZohoService.js')
      .then((m) => (m.isProductCategoryConfigured() ? m.listProductCategories() : null))
      .catch(() => {})
    startZohoDynamoSyncCron()
  })
}

start()
