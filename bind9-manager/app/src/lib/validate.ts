import type { RecordType, ResourceRecord } from '../types/entities';

export interface ValidateRecordInput {
  name: string;
  type: RecordType;
  ttl: number;
}

export interface ValidateRecordContext {
  zoneName: string;
  existing: ResourceRecord[];
  externalHostFqdns: string[];
  editingId?: string;
  target?: string;
}

export interface ValidationResult {
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

const LABEL_REGEX = /^(@|[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)$/;

function normalizeFqdn(s: string): string {
  return s.replace(/\.+$/, '').toLowerCase();
}

export function validateRecord(
  input: ValidateRecordInput,
  ctx: ValidateRecordContext
): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};

  // 1. DNS-label syntax per label
  const labels = input.name.split('.');
  const isValidLabels =
    input.name.length > 0 && labels.every((label) => LABEL_REGEX.test(label));

  if (!isValidLabels) {
    errors.name = 'Not a valid DNS label.';
  } else {
    // 2. Combined name + '.' + zoneName <= 253
    const fullName =
      input.name === '@' ? ctx.zoneName : `${input.name}.${ctx.zoneName}`;
    if (fullName.length > 253) {
      errors.name = "This record's full name is too long (over 253 characters).";
    }
  }

  // 3. CNAME not at apex (name === '@')
  if (input.type === 'CNAME' && input.name === '@') {
    errors.type = "CNAME records can't be created at the zone apex.";
  }

  // 4. Duplicate on (name, type) excluding editingId
  if (!errors.name) {
    const isDuplicate = (ctx.existing || []).some(
      (r) =>
        r.name === input.name &&
        r.type === input.type &&
        r.id !== ctx.editingId
    );
    if (isDuplicate) {
      errors.name = `A ${input.type} record named '${input.name}' already exists in this zone.`;
    }
  }

  // 5. TTL integer 0..2147483647 with sub-60 warning
  if (
    typeof input.ttl !== 'number' ||
    !Number.isInteger(input.ttl) ||
    input.ttl < 0 ||
    input.ttl > 2147483647
  ) {
    errors.ttl = 'TTL must be a whole number of seconds.';
  } else if (input.ttl < 60) {
    warnings.ttl = 'TTLs under 60s can cause excessive query load.';
  }

  // 6. Dangling-target warning when target is set and not found in existing names nor externalHostFqdns
  if (ctx.target !== undefined && ctx.target.trim() !== '') {
    const targetNorm = normalizeFqdn(ctx.target);
    const zoneNameNorm = normalizeFqdn(ctx.zoneName);

    const knownTargets = new Set<string>();

    // Add apex representations
    knownTargets.add('@');
    if (zoneNameNorm) {
      knownTargets.add(zoneNameNorm);
    }

    // Add external host FQDNs
    for (const host of ctx.externalHostFqdns || []) {
      knownTargets.add(normalizeFqdn(host));
    }

    // Add existing records in the zone
    for (const record of ctx.existing || []) {
      const recordNameNorm = normalizeFqdn(record.name);
      knownTargets.add(recordNameNorm);
      if (record.name === '@') {
        if (zoneNameNorm) {
          knownTargets.add(zoneNameNorm);
        }
      } else if (zoneNameNorm) {
        knownTargets.add(`${recordNameNorm}.${zoneNameNorm}`);
      }
    }

    if (!knownTargets.has(targetNorm)) {
      warnings.target =
        'Target not found in this zone or in External Hosts — this will create a dangling reference.';
    }
  }

  return { errors, warnings };
}
