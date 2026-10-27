'use client';

import { Search, X } from 'lucide-react';
import { Button } from '@mantle/web-ui/ui/button';
import { Input } from '@mantle/web-ui/ui/input';

/**
 * The search box of the item tree's top row (components/item-tree), for the
 * chat column and the New message form: the magnifier inside, a clear button
 * while there is text, Escape clears.
 */
export function ColumnSearch({
  value,
  onChange,
  placeholder,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        className="h-9 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <Button
          variant="ghost"
          size="icon-2xs"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
