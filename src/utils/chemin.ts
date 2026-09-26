/**
 * Chemin d'une page tel que le visiteur le voit : `/contact`, jamais
 * `/contact.html` ni `/contact/`.
 *
 * Avec `build.format: 'file'`, Astro expose au build `Astro.url.pathname` sous
 * la forme `/contact.html` (et `/index.html` pour l'accueil), alors que le site
 * est servi sans extension (cf. public/.htaccess).
 */
export function cheminPublic(pathname: string): string {
  const chemin = pathname
    .replace(/\.html$/, '')
    .replace(/(^|\/)index$/, '/')
    .replace(/\/+$/, '');
  return chemin === '' ? '/' : chemin;
}
