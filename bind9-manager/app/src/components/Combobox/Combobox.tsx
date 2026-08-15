import React, { useState, useEffect, useRef, useId } from 'react';

export interface ComboboxOption {
  label: string;
  value: string;
  meta?: string;
}

export interface ComboboxProps {
  value?: string;
  onChange?: (value: string) => void;
  onSearch?: (query: string) => Promise<ComboboxOption[]> | ComboboxOption[];
  options?: ComboboxOption[];
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  error?: string;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  'aria-label'?: string;
}

export function Combobox({
  value = '',
  onChange,
  onSearch,
  options = [],
  loading: externalLoading = false,
  placeholder,
  disabled = false,
  mono = false,
  error,
  className = '',
  style,
  id,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const autoId = useId();
  const inputId = id || autoId;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<ComboboxOption[]>(options);
  const [internalLoading, setInternalLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const isLoading = externalLoading || internalLoading;

  useEffect(() => {
    let isCancelled = false;

    if (!onSearch) {
      if (value.trim()) {
        const qLower = value.toLowerCase();
        setSearchResults(
          options.filter(
            (opt) =>
              opt.label.toLowerCase().includes(qLower) ||
              opt.value.toLowerCase().includes(qLower)
          )
        );
      } else {
        setSearchResults(options);
      }
      return;
    }

    setInternalLoading(true);
    Promise.resolve(onSearch(value))
      .then((res) => {
        if (!isCancelled) {
          setSearchResults(res || []);
          setInternalLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setSearchResults([]);
          setInternalLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [value, onSearch, options]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value;
    onChange?.(nextVal);
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleSelectOption = (opt: ComboboxOption) => {
    onChange?.(opt.value);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightedIndex((prev) =>
          prev < searchResults.length - 1 ? prev + 1 : 0
        );
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : searchResults.length - 1
        );
      }
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
        e.preventDefault();
        handleSelectOption(searchResults[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`combobox-container ${className}`.trim()}
      style={{ position: 'relative', width: '100%', ...style }}
    >
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-invalid={!!error}
        className="input"
        style={{
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          borderColor: error ? 'var(--state-error)' : undefined,
          cursor: disabled ? 'not-allowed' : undefined,
          opacity: disabled ? 0.5 : undefined,
          width: '100%',
        }}
      />

      {isOpen && !disabled && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: '220px',
            overflowY: 'auto',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-divider)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {isLoading ? (
            <div
              style={{
                padding: '8px 12px',
                fontSize: '12px',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              Loading suggestions…
            </div>
          ) : searchResults.length === 0 ? (
            <div
              style={{
                padding: '8px 12px',
                fontSize: '12px',
                color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
              }}
            >
              No matching targets
            </div>
          ) : (
            searchResults.map((opt, idx) => {
              const isHighlighted = idx === highlightedIndex;
              const isSelected = opt.value === value;

              return (
                <div
                  key={opt.value + idx}
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectOption(opt);
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  style={{
                    padding: '6px 10px',
                    fontSize: '13px',
                    fontFamily: mono ? 'var(--font-mono)' : undefined,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    background: isHighlighted
                      ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)'
                      : isSelected
                      ? 'color-mix(in srgb, var(--color-accent) 8%, transparent)'
                      : 'transparent',
                    color: 'var(--color-text)',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label || opt.value}
                  </span>
                  {opt.meta && (
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
                        flex: 'none',
                      }}
                    >
                      {opt.meta}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default Combobox;
