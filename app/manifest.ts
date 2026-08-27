/**
 * The web app manifest, and the reason the home-screen icon was a letter.
 *
 * There was no manifest at all. `app/icon.svg` and `app/apple-icon.png` both
 * draw the owl, but neither is what a phone reads when somebody installs the
 * site: Chrome wants manifest icons, and with no manifest it generates a tile
 * from the first letter of the name. That is where the S came from - not a
 * missing owl, a missing file.
 *
 * `purpose` matters as much as the sizes. A launcher crops a maskable icon to
 * whatever shape it uses, so the full-bleed variant exists to survive a circle
 * without losing the owl's ear tufts, while the plain one keeps the rounded
 * square for anywhere the icon is shown uncropped.
 */

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'stream-master',
    short_name: 'stream-master',
    description:
      'What the family pays for, and whether a show is already covered.',
    start_url: '/',
    display: 'standalone',
    // The owl's teal, and the app's background. Matching them stops the flash of
    // a white splash screen on launch.
    background_color: '#0a1011',
    theme_color: '#17707f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
