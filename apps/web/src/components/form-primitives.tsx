"use client";

import {
  type HTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  closeOnBackdrop?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
    ) ?? []);
    focusable()[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      const restore = restoreRef.current;
      queueMicrotask(() => restore?.focus());
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop modal d-block"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-surface modal-dialog modal-dialog-scrollable"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="modal-content">
          <header className="modal-header">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description && <p id={descriptionId}>{description}</p>}
            </div>
            <button className="icon-button btn-close btn-close-white" type="button" onClick={onClose} aria-label={`Close ${title}`}></button>
          </header>
          <div className="modal-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function FormGrid(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`form-grid ${props.className ?? ""}`.trim()} />;
}

export function Field({ label, help, children, className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement> & { label: string; help?: string; children: ReactNode }) {
  return <label {...props} className={`form-field form-group ${className}`.trim()}><span className="form-label">{label}</span>{children}{help && <small className="form-text">{help}</small>}</label>;
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="form-actions">{children}</div>;
}
