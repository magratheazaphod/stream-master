import type { NextConfig } from 'next';

/**
 * A stock Next app on Vercel needs no configuration, so everything here has to
 * earn its line. Three things do.
 */
const nextConfig: NextConfig = {
  // The app is private and there is no reason to advertise the framework version
  // to anybody scanning for it.
  poweredByHeader: false,

  // The dataset and both Cowork files are read per request. A stray trailing
  // slash redirect on an API route is noise nobody needs to debug.
  trailingSlash: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Behind a password nothing here is crawlable anyway, but a search
          // engine that somehow gets a session should still refuse to index a
          // page listing four households' spend.
          { key: 'x-robots-tag', value: 'noindex, nofollow' },
          { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
          { key: 'x-content-type-options', value: 'nosniff' },
          // No part of this app belongs in somebody else's iframe. A clickjacked
          // pause button cancels a real subscription.
          { key: 'x-frame-options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
