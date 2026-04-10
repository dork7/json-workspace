import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JSON workspace',
  description:
    'Multi-tab JSON editor; tabs can also hold plain text or code. Tree, watch, and format require valid JSON.',
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
