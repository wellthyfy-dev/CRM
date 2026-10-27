import * as React from 'react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = React.createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const push = React.useCallback((message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, kind, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[60] flex w-96 max-w-[90vw] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'rounded-md border px-4 py-3 text-sm shadow-lg',
              t.kind === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
              t.kind === 'error' && 'border-red-200 bg-red-50 text-red-900',
              t.kind === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}
