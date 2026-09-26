/**
 * Feuille de style des transitions partagées, générée à chaque build.
 *
 * Les photos portent un attribut `data-vt` ; cette feuille lui associe le
 * `view-transition-name` correspondant, pour qu'une même photo se déplace d'une
 * page à l'autre au lieu de se refondre.
 *
 * Pourquoi un fichier généré et pas la directive `transition:name` d'Astro :
 * celle-ci émet une balise <style> inline par élément, qu'Astro n'empreinte pas
 * dans sa CSP ; la politique les bloquerait en production. Et pourquoi pas des
 * règles écrites à la main : les photos sont désormais gérées depuis
 * l'administration, une liste figée ne connaîtrait pas les nouvelles.
 *
 * Servie depuis le domaine, la feuille est couverte par `style-src 'self'`.
 */
import type { APIRoute } from 'astro';
import { lireGalerie, lireMotos, lirePageAccueil, lirePrestations, nomPhoto } from '@/lib/contenu';

export const GET: APIRoute = async () => {
  const noms = new Set<string>();
  for (const p of await lirePrestations()) noms.add(`service-${p.ancre}`);
  const accueil = await lirePageAccueil();
  const photos = [
    accueil.atelier.photo,
    accueil.vente.photo,
    ...(await lireGalerie()).map((g) => g.photo),
    ...(await lireMotos()).map((m) => m.photo),
  ];
  for (const photo of photos) noms.add(`photo-${nomPhoto(photo)}`);

  const css = [...noms]
    .sort()
    .map((nom) => `[data-vt='${nom}']{view-transition-name:${nom}}`)
    .join('\n');

  return new Response(css + '\n', { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
};
