import React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  onDisabledClick?: () => void;
}

export function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
  className = '',
  onOpenChange,
  disabled = false,
  onDisabledClick,
}: CollapsibleSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  const handleOpenChange = (newOpen: boolean) => {
    // If disabled, call onDisabledClick instead and prevent state change
    if (disabled && onDisabledClick) {
      onDisabledClick();
      return;
    }

    // Call onOpenChange first to allow it to prevent the change
    if (onOpenChange) {
      onOpenChange(newOpen);
    }
    // Only update state if onOpenChange didn't prevent it
    // (we can't truly prevent it here, so onOpenChange should handle prevention)
    setOpen(newOpen);
  };

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={handleOpenChange}
      className={className}
    >
      <Collapsible.Trigger asChild>
        <button
          className="flex w-full items-center justify-between rounded-none bg-zinc-900/40 px-4 py-3 text-left transition-all border border-transparent hover:border-zinc-700/60"
          aria-label={`Toggle ${title}`}
        >
          <div className="flex items-center gap-2">
            {icon && <span className="text-zinc-400">{icon}</span>}
            <span className="font-medium text-zinc-200 text-sm">{title}</span>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-zinc-400 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
        <div className="px-4 py-3 bg-zinc-950/20 border border-transparent border-t-zinc-800/30 rounded-none">
          {children}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
