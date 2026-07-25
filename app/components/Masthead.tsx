'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Landscape' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/plan', label: 'Plan' },
];

function Owl() {
  return (
    <svg className="owl" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.4c-1.5 0-2.9.4-4.1 1.2L5.6 2.2a.7.7 0 0 0-1.1.7l.7 2.3A7.6 7.6 0 0 0 3.7 10c0 2.2.9 4.1 2.4 5.5v3.4c0 1.5 1.2 2.7 2.7 2.7h6.4c1.5 0 2.7-1.2 2.7-2.7v-3.4c1.5-1.4 2.4-3.3 2.4-5.5 0-1.8-.6-3.5-1.6-4.8l.7-2.3a.7.7 0 0 0-1.1-.7l-2.3 1.4A7.4 7.4 0 0 0 12 2.4Zm-3 4.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm6 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-3 6.9 1.5 1.7c.3.4 0 .9-.5.9h-2c-.5 0-.8-.5-.5-.9L12 13.8Z"
      />
      <circle cx="9" cy="9.9" r="1.25" fill="var(--surface-1)" />
      <circle cx="15" cy="9.9" r="1.25" fill="var(--surface-1)" />
    </svg>
  );
}

export function Masthead() {
  const path = usePathname();
  return (
    <header className="masthead">
      <Link href="/" className="wordmark">
        <Owl />
        stream<span>master</span>
      </Link>
      <nav>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={path === l.href ? 'page' : undefined}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
