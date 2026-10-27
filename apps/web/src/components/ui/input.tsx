import * as React from 'react';
import { cn } from '@/lib/utils';

const base =
  'w-full rounded-md border border-input bg-card text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn('flex h-9 px-3 py-1 file:border-0 file:bg-transparent file:text-sm', base, className)}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea className={cn('flex min-h-[80px] px-3 py-2', base, className)} ref={ref} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select className={cn('flex h-9 px-2 py-1', base, className)} ref={ref} {...props} />
  ),
);
Select.displayName = 'Select';
