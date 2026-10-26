import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pin, PinOff } from 'lucide-react';

export default function ColumnContextMenu({
  x,
  y,
  pinned,
  onToggle,
  onClose,
}: {
  x: number;
  y: number;
  pinned: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(24, Math.min(x, window.innerWidth - rect.width - 24)),
      top: Math.max(24, Math.min(y, window.innerHeight - rect.height - 24)),
    });
    ref.current?.querySelector('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      className="column-context-menu"
      role="menu"
      aria-label="Spaltenoptionen"
      style={position}
    >
      <button
        role="menuitem"
        onClick={() => {
          onToggle();
          onClose();
        }}
      >
        {pinned ? <PinOff size={15} /> : <Pin size={15} />}{' '}
        {pinned ? 'Fixierung aufheben' : 'Spalte links fixieren'}
      </button>
    </div>,
    document.body
  );
}
