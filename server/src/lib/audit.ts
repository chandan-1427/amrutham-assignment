import type { Database } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export async function recordAuditLog(
  executor: Pick<Database, 'insert'>,
  params: { actorId: string | null; entityType: string; entityId: string; action: string; diff?: unknown }
) {
  await executor.insert(auditLogs).values({
    actorId: params.actorId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    diffJson: params.diff ?? null,
  });
}