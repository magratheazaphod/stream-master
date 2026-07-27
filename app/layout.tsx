import type { Metadata } from 'next';
import './globals.css';
import { Masthead } from './components/Masthead';
import { getDatasetSource } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'stream-master',
  description: 'What the family pays for, what it wants to watch and when to turn each service on.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Masthead dataset={getDatasetSource()} />
          {children}
        </div>
      </body>
    </html>
  );
}
