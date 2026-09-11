import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Attivare Auditor',
    template: '%s · Attivare Auditor',
  },
  description:
    'Motor de auditoria e cruzamento automatizado de obrigações fiscais, tributárias, contábeis e trabalhistas.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a1a2f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
