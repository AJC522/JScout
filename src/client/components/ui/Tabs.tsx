import type { ComponentProps, ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/** Tab set root. Controlled (value/onValueChange) or uncontrolled (defaultValue). */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex min-w-0 flex-col', className)} {...props} />;
}

/** The row of tabs; scrolls horizontally when it does not fit. */
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex items-center gap-4 overflow-x-auto border-b border-border [scrollbar-width:none]', className)}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  /** A count after the label, e.g. number of applications in a status. */
  count?: ReactNode;
  icon?: ReactNode;
}

export function TabsTrigger({ count, icon, className, children, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-0.5 text-base font-medium whitespace-nowrap text-muted transition-colors',
        'hover:text-fg focus-visible:rounded-sm disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:border-primary-fg data-[state=active]:text-fg [&_svg]:size-4',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {count !== undefined && count !== null ? (
        <span className="rounded-full bg-surface-3 px-1.5 text-xs leading-[1.125rem] font-medium text-muted tabular-nums">{count}</span>
      ) : null}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('min-w-0 pt-5 focus-visible:outline-offset-4', className)} {...props} />;
}
