import { getRates, saveRates } from '../data/chargeConfig.js'

export async function chargeConfigHandler() {
  return { rates: getRates() }
}

export async function updateChargeConfigHandler(req, reply) {
  try {
    const rates = await saveRates(req.body || {})
    return { rates }
  } catch (error) {
    return reply.code(400).send({ error: error.message })
  }
}
