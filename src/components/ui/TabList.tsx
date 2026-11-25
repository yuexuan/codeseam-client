import { useRef, type ReactNode } from 'react';
import styles from './TabList.module.css';

export function TabList<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  items: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          ref={(element) => {
            refs.current[index] = element;
          }}
          id={`${id}-tab-${item.value}`}
          aria-controls={`${id}-panel`}
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : event.key === 'ArrowRight'
                    ? (index + 1) % items.length
                    : event.key === 'ArrowLeft'
                      ? (index + items.length - 1) % items.length
                      : undefined;
            if (next === undefined) return;
            event.preventDefault();
            onChange(items[next].value);
            refs.current[next]?.focus();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
