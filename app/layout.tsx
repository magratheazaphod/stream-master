import type { Metadata } from 'next';
import './globals.css';
import { Masthead } from './components/Masthead';
import { getDatasetSource } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'stream-master',
  description: 'What the family pays for, what it wants to watch and when to turn each service on.',
  // Installed on a phone this runs without browser chrome, so the status bar has
  // to be told to match the app rather than sit as a white band above it.
  appleWebApp: { capable: true, title: 'stream-master', statusBarStyle: 'black-translucent' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Masthead dataset={await getDatasetSource()} />
          {children}
        </div>
      </body>
    </html>
  );
}
