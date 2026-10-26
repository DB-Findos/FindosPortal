import { pool } from '../db.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { transaction, createRecord, updateRecord } from '../repositories/entities.js';
const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
const password = z
  .string()
  .min(12)
  .max(72)
  .refine((value) => Buffer.byteLength(value) <= 72)
  .parse(process.env.ADMIN_PASSWORD);
try {
  const existing = (
    await pool.query('SELECT 1 FROM portal.users WHERE email=$1 AND "archivedAt" IS NULL', [email])
  ).rowCount;
  if (existing) console.log('Admin already exists; credentials unchanged.');
  else {
    const actor = (
      await pool.query(
        'SELECT "objectId" FROM portal.users WHERE active AND "archivedAt" IS NULL ORDER BY "createdAt" LIMIT 1'
      )
    ).rows[0];
    if (!actor) throw Error('Initialize the database with db:migrate first.');
    await transaction(actor.objectId, async (client) => {
      const contact = await createRecord(client, 'contacts', {
        first_name: 'Portal',
        last_name: 'Administrator',
        email,
      });
      const user = await createRecord(client, 'users', {
        email,
        password_hash: await bcrypt.hash(password, 12),
        contact_id: contact.objectId,
        active: true,
      });
      let group = (
        await client.query(
          'SELECT * FROM portal.user_groups WHERE name=$1 AND "archivedAt" IS NULL',
          ['Administrators']
        )
      ).rows[0];
      if (!group)
        group = await createRecord(client, 'user_groups', {
          name: 'Administrators',
          description: 'Portal administration',
        });
      const rights = (
        await client.query(
          'SELECT * FROM portal.permissions WHERE group_id=$1 AND "archivedAt" IS NULL',
          [group.objectId]
        )
      ).rows;
      for (const permission of rights)
        if (
          !permission.can_create ||
          !permission.can_read ||
          !permission.can_update ||
          !permission.can_delete
        )
          await updateRecord(client, 'permissions', permission.objectId, permission.id, {
            can_create: true,
            can_read: true,
            can_update: true,
            can_delete: true,
          });
      await createRecord(client, 'user_group_memberships', {
        user_id: user.objectId,
        group_id: group.objectId,
      });
    });
    console.log('Initial administrator created with audit history.');
  }
} finally {
  await pool.end();
}
