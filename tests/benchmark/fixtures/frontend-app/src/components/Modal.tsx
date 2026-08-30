import { useRef } from 'react';
import type { ReactNode } from 'react';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children?: ReactNode;
}

// BUG: no keyboard support — the dialog can't be dismissed from the
// keyboard, and focus can move to elements behind the overlay instead of
// staying trapped inside the dialog.
export default function Modal({ title, onClose, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <h2>{title}</h2>
        {children}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
