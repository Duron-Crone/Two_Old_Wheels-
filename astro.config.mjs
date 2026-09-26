import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';
import sveltiaCms from './integrations/sveltia-cms.mjs';

export default defineConfig({
  // Site entièrement statique : aucune route à la demande. L'hébergement OVH
  // (Apache) sert `dist/` tel quel, voir public/.htaccess.
  output: 'static',
  site: 'https://www.twooldwheels.fr',

  // Une seule forme d'URL fait autorité : `/contact`, sans slash final. Liens
  // internes, canoniques et sitemap disent tous la même chose.
  trailingSlash: 'never',

  // Une page = un fichier (`contact.html`), pas un dossier (`contact/index.html`).
  // Apache ajoute d'office un « / » final à toute adresse qui désigne un dossier,
  // avant même de lire le .htaccess : avec des dossiers, `/contact` et
  // `/contact/` se redirigeaient l'un vers l'autre à l'infini. Avec des
  // fichiers, le .htaccess sert `contact.html` à l'adresse `/contact`.
  build: {
    format: 'file',
  },

  // CSP à empreintes : Astro calcule le hash de chaque script et style qu'il
  // produit, ce qui permet de se passer de `unsafe-inline`.
  experimental: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        // `frame-ancestors` n'est volontairement pas ici : il est ignoré quand
        // la politique est portée par un <meta>, et le navigateur le signale
        // par un avertissement sur chaque page. Il est déclaré en en-tête HTTP
        // dans `public/.htaccess`, seul endroit où il a un effet.
      ],
    },
  },

  integrations: [
    sitemap({
      filter: (page) => !page.includes('/mentions-legales') && !page.includes('/404'),
      // Note : `trailingSlash: 'never'` rabote aussi le slash de la racine, le
      // sitemap sort donc `https://www.twooldwheels.fr` quand la canonique de
      // l'accueil dit `https://www.twooldwheels.fr/`. La normalisation a lieu
      // après `serialize`, qui ne peut donc pas la contrer. Sans conséquence :
      // un chemin vide équivaut à `/` (RFC 3986 §6.2.3), tous les crawlers
      // rapprochent les deux formes.
    }),
    tailwind(),
    // Administration des contenus sous /admin, cf. integrations/sveltia-cms.mjs.
    sveltiaCms(),
  ],
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        limitInputPixels: false,
      },
    },
    formats: ['avif', 'webp'],
  },
});
