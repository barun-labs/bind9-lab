import { Input } from '../Input/Input';
import { Checkbox } from '../Checkbox/Checkbox';
import { Select } from '../Select/Select';
import type { OptionValueKind } from '../../lib/optionKinds';

export interface OptionValueEditorProps {
  kind: OptionValueKind;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

// Splits ACL/IP-list text on commas, whitespace, or newlines into tokens.
function splitTokens(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

// Per-kind value editor shared by ZoneOptionsPanel and ViewOptionsPanel — one
// widget per OptionValueKind (see lib/optionKinds.ts), so zone and view
// scopes never grow divergent input behavior for the same key.
export function OptionValueEditor({ kind, value, onChange, disabled, id, 'aria-label': ariaLabel }: OptionValueEditorProps) {
  if (kind === 'ACL_TOKENS' || kind === 'IP_LIST') {
    const text = Array.isArray(value) ? value.join(', ') : '';
    return (
      <Input
        id={id}
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => onChange(splitTokens(e.target.value))}
        placeholder={kind === 'IP_LIST' ? '10.20.30.1, 10.20.30.2:53' : '10.0.0.0/8, !10.0.0.5'}
        mono
        disabled={disabled}
      />
    );
  }

  if (kind === 'BOOLEAN') {
    return (
      <Checkbox
        id={id}
        aria-label={ariaLabel}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        label="Enabled"
      />
    );
  }

  if (kind === 'FORWARD') {
    return (
      <Select
        id={id}
        aria-label={ariaLabel}
        value={typeof value === 'string' ? value : 'first'}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { label: 'only', value: 'only' },
          { label: 'first', value: 'first' },
        ]}
        disabled={disabled}
      />
    );
  }

  // DNSSEC_VALIDATION
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={typeof value === 'string' ? value : 'auto'}
      onChange={(e) => onChange(e.target.value)}
      options={[
        { label: 'yes', value: 'yes' },
        { label: 'no', value: 'no' },
        { label: 'auto', value: 'auto' },
      ]}
      disabled={disabled}
    />
  );
}

export default OptionValueEditor;
