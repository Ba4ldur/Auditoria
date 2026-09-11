'use client';

import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Sidebar } from './sidebar';

/** Navigation drawer for viewports narrower than the `lg` breakpoint. */
export function MobileNav({ organizationName }: { organizationName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="no-print lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir navegacao"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-line-strong text-navy-700 transition-colors hover:bg-navy-50"
      >
        <Menu size={18} aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-navy-950/50"
            onClick={() => setOpen(false)}
            role="presentation"
          />
          {/* Closing on click lets a navigation link inside the sidebar dismiss the drawer. */}
          <div
            className="relative h-full w-64 shadow-[var(--shadow-panel)]"
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar navegacao"
              className="absolute top-4 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-navy-200 hover:bg-white/10 hover:text-white"
            >
              <X size={18} aria-hidden />
            </button>
            <Sidebar organizationName={organizationName} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
