// TextField.tsx — the app's text input, and the only kind of element that
// keeps its case and lets its text be selected (.phone lowercases and blocks
// selection everywhere else). It focuses itself on mount and claims its own
// pointer down, so tapping into it never reaches an Overlay's back gesture.

import type { CSSProperties, KeyboardEvent } from 'react';

type TextFieldProps = {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  onBlur?: () => void;
  style?: CSSProperties;
};

export function TextField({ value, placeholder, onChange, onEnter, onEscape, onBlur, style }: TextFieldProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onEnter?.();
    else if (e.key === 'Escape') onEscape?.();
    else return;
    e.preventDefault();
  };

  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ ...style, textTransform: 'none', userSelect: 'text', WebkitUserSelect: 'text' }}
    />
  );
}
