import { Router } from 'express'
import { streamItemImageFromZoho } from '../services/zohoItemImageService.js'

export const itemImageRoutes = Router()

const CACHE_CONTROL = 'public, max-age=3600'

itemImageRoutes.get('/:itemId/image', async (req, res, next) => {
  try {
    const { itemId } = req.params
    if (!itemId?.trim()) {
      return res.status(400).json({ message: 'Missing item id' })
    }

    const result = await streamItemImageFromZoho(itemId)

    if (!result.ok) {
      const status = result.status === 404 ? 404 : 500
      return res.status(status).json({ message: result.message || 'Unable to load image' })
    }

    res.setHeader('Cache-Control', CACHE_CONTROL)
    if (result.contentLength) {
      res.setHeader('Content-Length', result.contentLength)
    }
    res.setHeader('Content-Type', result.contentType)

    result.stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).end()
      } else {
        res.destroy(err)
      }
    })

    result.stream.pipe(res)
  } catch (error) {
    next(error)
  }
})
