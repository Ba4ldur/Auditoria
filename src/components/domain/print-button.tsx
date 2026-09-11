'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Sends the report to the browser's print dialog, which also produces the PDF
 * ("Salvar como PDF"). A server-side PDF renderer can be added later without
 * changing the report markup, which is why the layout is plain printable HTML.
 */
export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      <Printer size={15} aria-hidden />
      Imprimir / Salvar PDF
    </Button>
  );
}
