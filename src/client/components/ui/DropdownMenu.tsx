import type { ComponentProps, ReactNode } from 'react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

/*
 * Styled Radix dropdown menu. Usage:
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild><IconButton label="More" icon={<Ellipsis />} /></DropdownMenuTrigger>
 *     <DropdownMenuContent align="end">
 *       <DropdownMenuItem icon={<Pencil />} onSelect={rename}>Rename</DropdownMenuItem>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuItem tone="danger" icon={<Trash />} onSelect={remove}>Delete</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 */

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuSub = MenuPrimitive.Sub;

const PANEL =
  'z-50 min-w-44 overflow-hidden rounded-control border border-border bg-surface p-1 text-fg shadow-overlay outline-none ' +
  'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto ' +
  'origin-[var(--radix-dropdown-menu-content-transform-origin)] data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in';

const ITEM =
  'relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-base outline-none select-none ' +
  'data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

export function DropdownMenuContent({ className, sideOffset = 6, collisionPadding = 8, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content sideOffset={sideOffset} collisionPadding={collisionPadding} className={cn(PANEL, className)} {...props} />
    </MenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  icon?: ReactNode;
  /** Right-aligned hint such as a shortcut (<Kbd combo="mod+e" />) or a count. */
  shortcut?: ReactNode;
  tone?: 'default' | 'danger';
}

export function DropdownMenuItem({ icon, shortcut, tone = 'default', className, children, ...props }: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item
      className={cn(ITEM, tone === 'danger' ? 'text-danger data-[highlighted]:bg-danger-soft' : '[&_svg]:text-muted', className)}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? <span className="ml-4 text-sm text-subtle">{shortcut}</span> : null}
    </MenuPrimitive.Item>
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(ITEM, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="text-primary" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={cn(ITEM, 'pl-8', className)} {...props}>
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <span className="block size-1.5 rounded-full bg-primary-fg" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn('px-2 pt-1.5 pb-1 text-xs font-medium text-subtle', className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export function DropdownMenuSubTrigger({ icon, className, children, ...props }: ComponentProps<typeof MenuPrimitive.SubTrigger> & { icon?: ReactNode }) {
  return (
    <MenuPrimitive.SubTrigger className={cn(ITEM, 'data-[state=open]:bg-hover [&_svg]:text-muted', className)} {...props}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight aria-hidden="true" className="ml-2" />
    </MenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent sideOffset={4} className={cn(PANEL, className)} {...props} />
    </MenuPrimitive.Portal>
  );
}
