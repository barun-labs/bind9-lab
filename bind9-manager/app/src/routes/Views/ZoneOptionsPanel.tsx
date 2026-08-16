import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { EffectiveOption, DeploymentOptionRow } from '../../data/apiAdapter';
import { useApi } from '../../data/store';
import { InheritanceControl, type InheritanceMode } from '../../components/InheritanceControl/InheritanceControl';
import { OptionValueEditor } from '../../components/OptionValueEditor/OptionValueEditor';
import { ZONE_SCOPE_KEYS, OPTION_ALLOWLIST, defaultValueForKind } from '../../lib/optionKinds';

interface OptionEntry {
  key: string;
  mode: InheritanceMode;
  inheritedValue: unknown;
  rowId?: string;
  rowValue?: unknown;
}

function formatInheritedValue(value: unknown): string {
  if (value === undefined || value === null) return '(not set)';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)';
  return String(value);
}

export function ZoneOptionsPanel() {
  const { configId = 'dns-lab', zoneId = '' } = useParams();
  const api = useApi();

  const [effective, setEffective] = useState<EffectiveOption[]>([]);
  const [rows, setRows] = useState<DeploymentOptionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [eff, zoneRows] = await Promise.all([
      api.getEffectiveZoneOptions(configId, zoneId),
      api.listDeploymentOptions(configId, 'ZONE', zoneId),
    ]);
    setEffective(eff);
    setRows(zoneRows);
    setLoading(false);
  }, [api, configId, zoneId]);

  useEffect(() => {
    load();
  }, [load]);

  const entries: OptionEntry[] = useMemo(
    () =>
      ZONE_SCOPE_KEYS.map((key) => {
        const eff = effective.find((o) => o.key === key);
        const row = rows.find((r) => r.key === key);
        return {
          key,
          mode: eff?.mode ?? 'INHERIT',
          inheritedValue: eff?.inheritedValue,
          rowId: row?.id,
          rowValue: row?.value,
        };
      }),
    [effective, rows]
  );

  const handleOverride = async (entry: OptionEntry) => {
    const kind = OPTION_ALLOWLIST[entry.key].kind;
    if (entry.rowId) {
      const seeded = entry.rowValue ?? entry.inheritedValue ?? defaultValueForKind(kind);
      await api.updateDeploymentOption(configId, entry.rowId, { disabled: false, value: seeded });
    } else {
      const seeded = entry.inheritedValue ?? defaultValueForKind(kind);
      await api.createDeploymentOption(configId, { scope: 'ZONE', scopeId: zoneId, key: entry.key, value: seeded });
    }
    await load();
  };

  const handleInherit = async (entry: OptionEntry) => {
    if (entry.rowId) {
      await api.deleteDeploymentOption(configId, entry.rowId);
    }
    await load();
  };

  const handleDisable = async (entry: OptionEntry) => {
    if (entry.rowId) {
      await api.updateDeploymentOption(configId, entry.rowId, { disabled: true });
    } else {
      await api.createDeploymentOption(configId, { scope: 'ZONE', scopeId: zoneId, key: entry.key, disabled: true });
    }
    await load();
  };

  // ponytail: writes fire on every editor change (no debounce/blur commit) —
  // fine for a lab tool against an in-memory fixture store; add debouncing
  // if this ever hits a real network on every keystroke.
  const handleValueChange = async (entry: OptionEntry, value: unknown) => {
    if (!entry.rowId) return;
    await api.updateDeploymentOption(configId, entry.rowId, { value });
    await load();
  };

  if (loading) {
    return <div style={{ padding: '20px 32px' }}>Loading…</div>;
  }

  return (
    <div style={{ padding: '20px 32px', maxWidth: 'var(--chrome-max-content-w, 1040px)', width: '100%', boxSizing: 'border-box' }}>
      <p
        style={{
          margin: '0 0 14px',
          fontSize: '12px',
          color: 'color-mix(in srgb, var(--color-text) 60%, transparent)',
          maxWidth: '68ch',
        }}
      >
        Inherit takes the value set on this zone's view. Override sets a zone-specific value.
        Disable omits the clause for this zone entirely.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {entries.map((entry) => {
          const kind = OPTION_ALLOWLIST[entry.key].kind;
          return (
            <div
              key={entry.key}
              data-testid={`zone-option-${entry.key}`}
              style={{ border: '1px solid var(--color-divider)', background: 'var(--color-surface)', padding: '12px 16px' }}
            >
              <InheritanceControl
                label={entry.key}
                mode={entry.mode}
                inheritedDisplay={formatInheritedValue(entry.inheritedValue)}
                onInherit={() => handleInherit(entry)}
                onOverride={() => handleOverride(entry)}
                onDisable={() => handleDisable(entry)}
              >
                <OptionValueEditor
                  kind={kind}
                  value={entry.rowValue}
                  onChange={(value) => handleValueChange(entry, value)}
                  aria-label={`${entry.key} value`}
                />
              </InheritanceControl>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ZoneOptionsPanel;
