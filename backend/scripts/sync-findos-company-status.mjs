import { pool } from '../dist/db.js';
import { transaction, updateRecord } from '../dist/repositories/entities.js';

// Read-only snapshot returned by Findos MCP (Dynamo) on 2026-10-27.
// Re-run after refreshing this list from the MCP to version the new source values.
const sourceCompanies = [
  ['Angelina Yachtcharter', 'Angelina', 'P - Portfolio', 'EUR'],
  ['Angels', 'Jeannie', 'X - Exited', 'EUR'],
  ['Badelement', 'Baldo', 'P - Portfolio', 'DKK'],
  ['Centroplan GmbH', 'Cedric', 'P - Portfolio', 'EUR'],
  ['Collectia A/S', 'Inga', 'X - Exited', 'DKK'],
  ['D&M Rolladentechnik GmbH', 'Roland', 'X - Exited', 'EUR'],
  ['European LifeCare Group', 'Valena', 'P - Portfolio', 'EUR'],
  ['FFW Deutschland GmbH (vormals CELLULAR GmbH)', 'Celine', 'X - Exited', 'DKK'],
  ['FUXTEC GmbH', 'Fadri', 'P - Portfolio', 'EUR'],
  ['GEDK (K-MG Gruppe)', 'Carl', 'P - Portfolio', 'EUR'],
  ['HTS tentiQ GmbH', 'Pagode', 'P - Portfolio', 'EUR'],
  ['Joli Berlin', 'Julia', 'P - Portfolio', 'EUR'],
  ['karriere tutor GmbH', 'Tarek', 'X - Exited', 'EUR'],
  ['Lexit Group', 'Alexa', 'P - Portfolio', 'NOK'],
  ['m Group GmbH', 'Markus', 'P - Portfolio', 'EUR'],
  ['MAIT GmbH', 'Cosima', null, 'EUR'],
  ['Medperion GmbH', 'Camilla', 'P - Portfolio', 'EUR'],
  ['monta Klebebandwerk GmbH', 'Mona', 'X - Exited', 'EUR'],
  ['Mos Mosh A/S', 'Kate', 'X - Exited', 'DKK'],
  ['Nordiq (BidCo Group)', 'Norbert', 'P - Portfolio', 'DKK'],
  ['Obsidian', 'Oskar', 'P - Portfolio', 'DKK'],
  ['OMB Saleri', 'Valeria', 'P - Portfolio', 'EUR'],
  ['Rameder Anhängerkupplungen und Autoteile GmbH', 'Ralf', 'X - Exited', 'EUR'],
  ['Rampf Formen GmbH', 'Renate', 'P - Portfolio', 'EUR'],
  ['Ray Sono', 'Christopher', 'X - Exited', 'EUR'],
  ['Rhenoflex GmbH', 'Rhea', 'X - Exited', 'EUR'],
  ['Roventa-Henex SA', 'Momo', 'P - Portfolio', 'CHF'],
  ['Unicon Software GmbH', 'Ulrich', 'X - Exited', 'EUR'],
  ['Vilhelm Lauritzen Arkitekter A/S', 'Laurie', 'P - Portfolio', 'DKK'],
  ['Zizzi Fashion', 'Sissi', 'P - Portfolio', 'DKK'],
];

let updated = 0;
let unchanged = 0;
try {
  const actorResult = await pool.query(
    `SELECT u."objectId" FROM portal.users u
     JOIN portal.user_group_memberships m ON m.user_id=u."objectId" AND m."archivedAt" IS NULL
     JOIN portal.user_groups g ON g."objectId"=m.group_id AND g."archivedAt" IS NULL
     WHERE u.active AND u."archivedAt" IS NULL AND g.name='Administrators'
     ORDER BY u."createdAt" LIMIT 1`
  );
  const actor = actorResult.rows[0]?.objectId;
  if (!actor) throw new Error('No active administrator is available for the audited import.');
  await transaction(actor, async (client) => {
    for (const [name, internalName, status, currency] of sourceCompanies) {
      const result = await client.query(
        `SELECT "objectId",id,status,currency FROM portal.companies
         WHERE "archivedAt" IS NULL AND (name=$1 OR internal_name=$2)`,
        [name, internalName]
      );
      if (result.rowCount !== 1)
        throw new Error(`Expected one Company for ${name}; found ${result.rowCount}.`);
      const previous = result.rows[0];
      if (previous.status === status && previous.currency === currency) {
        unchanged += 1;
        continue;
      }
      await updateRecord(client, 'companies', previous.objectId, previous.id, { status, currency });
      updated += 1;
    }
  });
  console.log(
    `Findos MCP company status sync complete: ${updated} versioned updates, ${unchanged} unchanged.`
  );
} finally {
  await pool.end();
}
