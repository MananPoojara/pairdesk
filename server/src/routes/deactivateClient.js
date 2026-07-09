import { query } from '../db/pg.js'

export async function deactivateClientHandler(req, reply) {
  const code = req.params.code?.toUpperCase()
  if (!code) return reply.code(400).send({ error: 'code is required.' })

  const { rows } = await query(
    `UPDATE clients SET is_active = FALSE WHERE UPPER(code) = $1 AND is_active = TRUE RETURNING code, name`,
    [code]
  )
  if (!rows.length) return reply.code(404).send({ error: `Client "${code}" not found or already inactive.` })

  return { code: rows[0].code, name: rows[0].name, is_active: false }
}
