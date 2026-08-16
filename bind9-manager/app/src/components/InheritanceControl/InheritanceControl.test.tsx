import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { InheritanceControl, type InheritanceMode } from './InheritanceControl';

// Stateful wrapper: InheritanceControl is presentational, so the test owns
// the mode and re-renders it on the matching callback, exactly like a real
// panel would after a write + refetch.
function Wrapper({
  onInherit,
  onOverride,
  onDisable,
}: {
  onInherit: () => void;
  onOverride: () => void;
  onDisable: () => void;
}) {
  const [mode, setMode] = useState<InheritanceMode>('INHERIT');
  return (
    <InheritanceControl
      label="allow-transfer"
      mode={mode}
      inheritedDisplay="10.20.30.11"
      onInherit={() => {
        onInherit();
        setMode('INHERIT');
      }}
      onOverride={() => {
        onOverride();
        setMode('OVERRIDE');
      }}
      onDisable={() => {
        onDisable();
        setMode('DISABLE');
      }}
    >
      <input aria-label="override value" defaultValue="10.20.30.12" />
    </InheritanceControl>
  );
}

describe('InheritanceControl', () => {
  test('Inherit shows the inherited value read-only and hides the editor', () => {
    render(<Wrapper onInherit={vi.fn()} onOverride={vi.fn()} onDisable={vi.fn()} />);
    expect(screen.getByText('10.20.30.11')).toBeInTheDocument();
    expect(screen.queryByLabelText('override value')).not.toBeInTheDocument();
  });

  test('Inherit -> Override fires onOverride and reveals the editor', () => {
    const onOverride = vi.fn();
    render(<Wrapper onInherit={vi.fn()} onOverride={onOverride} onDisable={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Override' }));

    expect(onOverride).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('override value')).toBeInTheDocument();
  });

  test('Override -> Inherit fires onInherit', () => {
    const onInherit = vi.fn();
    render(<Wrapper onInherit={onInherit} onOverride={vi.fn()} onDisable={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Override' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Inherit' }));

    expect(onInherit).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('override value')).not.toBeInTheDocument();
  });

  test('-> Disable fires onDisable and shows the disabled note', () => {
    const onDisable = vi.fn();
    render(<Wrapper onInherit={vi.fn()} onOverride={vi.fn()} onDisable={onDisable} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Disable' }));

    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/disabled — clause omitted/i)).toBeInTheDocument();
  });
});
