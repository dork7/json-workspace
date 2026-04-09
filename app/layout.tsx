import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JSON workspace',
  description: 'Multi-tab JSON editor with tree view, watch paths, and compare',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
