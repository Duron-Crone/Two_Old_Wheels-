/**
 * llms.txt, le résumé du site destiné aux moteurs de réponse qui citent des
 * sources. Généré à partir des mêmes contenus que les pages : un
 * fichier statique aurait divergé dès la première modification faite depuis
 * l'administration.
 */
import type { APIRoute } from 'astro';
import { SITE } from '@/consts';
import { adresseComplete, lireMotos, lirePrestations, lireReglages } from '@/lib/contenu';

export const GET: APIRoute = async () => {
  const reglages = await lireReglages();
  const prestations = await lirePrestations();
  const motosDisponibles = (await lireMotos()).filter((m) => !m.vendue).length;

  const lignes = [
    `# ${SITE.name}`,
    '',
    `> ${reglages.presentation}`,
    '',
    '## Prestations',
    '',
    ...prestations.map((p) => `- ${p.titre} : ${p.texte}`),
    '',
    '## Contact',
    '',
    `- Adresse : ${adresseComplete()}, France.`,
    `- Téléphone : ${reglages.telephone}.`,
    // Pas d'adresse e-mail ici : ce fichier est écrit pour les machines, et
    // c'est précisément ce à quoi l'adresse doit échapper.
    ...(reglages.instagram ? [`- Instagram : ${reglages.instagram}`] : []),
    ...(reglages.facebook ? [`- Facebook : ${reglages.facebook}`] : []),
    '',
    '## Pages',
    '',
    `- [Accueil](${SITE.url}/)`,
    `- [Réparation](${SITE.url}/reparation) : les prestations.`,
    `- [Vente](${SITE.url}/vente) : vente et dépôt-vente${motosDisponibles ? `, ${motosDisponibles} moto${motosDisponibles > 1 ? 's' : ''} en vente` : ''}.`,
    `- [Galerie photos](${SITE.url}/galerie-photos) : réalisations.`,
    `- [Contact](${SITE.url}/contact) : téléphone, adresse, réseaux.`,
    '',
  ];

  return new Response(lignes.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
