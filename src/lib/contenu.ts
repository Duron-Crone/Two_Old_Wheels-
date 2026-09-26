/**
 * Lecture des contenus éditables (src/content/*.yml) et petites dérivations
 * dont les pages ont besoin. Les pages ne lisent jamais les collections
 * directement : tout passe par ici, pour que les règles (variables dans les
 * textes, ancres, noms de transition) restent les mêmes partout.
 */
import { getEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import { SITE } from '@/consts';

function exiger<T>(entree: { data: T } | undefined, fichier: string): T {
  if (!entree) throw new Error(`Contenu introuvable : src/content/${fichier}.yml`);
  return entree.data;
}

export const lireReglages = async () => exiger(await getEntry('reglages', 'reglages'), 'reglages');
export const lirePageAccueil = async () => exiger(await getEntry('pageAccueil', 'page-accueil'), 'page-accueil');
export const lirePageReparation = async () => exiger(await getEntry('pageReparation', 'page-reparation'), 'page-reparation');
export const lirePageVente = async () => exiger(await getEntry('pageVente', 'page-vente'), 'page-vente');
export const lirePageGalerie = async () => exiger(await getEntry('pageGalerie', 'page-galerie'), 'page-galerie');
export const lirePageContact = async () => exiger(await getEntry('pageContact', 'page-contact'), 'page-contact');
export const lireGalerie = async () => exiger(await getEntry('galerie', 'galerie'), 'galerie').photos;
export const lireMotos = async () => exiger(await getEntry('motos', 'motos'), 'motos').motos;

export type Reglages = Awaited<ReturnType<typeof lireReglages>>;

// --- Coordonnées ----------------------------------------------------------

export const adresseComplete = () => `${SITE.address.street}, ${SITE.address.postalCode} ${SITE.address.city}`;

/** « 06 70 79 86 67 » -> « +33670798667 », pour les liens tel: et les données structurées. */
export function telephoneInternational(telephone: string): string {
  const chiffres = telephone.replace(/[^\d+]/g, '');
  if (chiffres.startsWith('+')) return chiffres;
  if (chiffres.startsWith('0') && chiffres.length === 10) return `+33${chiffres.slice(1)}`;
  return chiffres;
}

/**
 * Remplace les variables écrites dans l'administration par leur valeur du
 * moment. Guillaume change son numéro une seule fois, dans Coordonnées, et
 * toutes les phrases qui le citent suivent.
 */
export function remplir(texte: string, reglages: Reglages): string {
  return texte.replaceAll('{telephone}', reglages.telephone).replaceAll('{adresse}', adresseComplete());
}

// --- Listes ------------------------------------------------------------------

export function slugifier(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Garantit des identifiants distincts : deux prestations au même titre ne partagent pas une ancre. */
function dedoublonneur() {
  const vus = new Map<string, number>();
  return (base: string) => {
    const n = (vus.get(base) ?? 0) + 1;
    vus.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

export async function lirePrestations() {
  const unique = dedoublonneur();
  const liste = exiger(await getEntry('prestations', 'prestations'), 'prestations').prestations;
  // L'ancre (/reparation#moteur) découle du titre : elle est recalculée à chaque
  // build, pour l'accueil comme pour la page Réparation, et reste donc cohérente.
  return liste.map((p) => ({ ...p, ancre: unique(slugifier(p.titre) || 'prestation') }));
}

export async function lireFaq() {
  const reglages = await lireReglages();
  const { questions } = exiger(await getEntry('faq', 'faq'), 'faq');
  return questions.map((q) => ({ question: remplir(q.question, reglages), reponse: remplir(q.reponse, reglages) }));
}

// --- Transitions entre pages ------------------------------------------------------

/** Nom stable d'une photo, tiré de son fichier : `/_astro/moteur-883.Hx1.jpg` -> `moteur-883`. */
export function nomPhoto(photo: ImageMetadata): string {
  const fichier = photo.src.split('/').pop()?.split('?')[0] ?? '';
  return slugifier(fichier.split('.')[0] ?? '') || 'photo';
}

/**
 * Deux éléments d'une même page ne doivent jamais porter le même nom de
 * transition : le navigateur annulerait toute la transition. Si Guillaume met
 * la même photo à deux endroits de l'accueil, seule la première la garde.
 */
export function nommeurDeTransitions() {
  const pris = new Set<string>();
  return (nom: string): string | undefined => {
    if (pris.has(nom)) return undefined;
    pris.add(nom);
    return nom;
  };
}

// --- Horaires -----------------------------------------------------------------------

const JOURS_SCHEMA: Record<string, string> = {
  lundi: 'Monday',
  mardi: 'Tuesday',
  mercredi: 'Wednesday',
  jeudi: 'Thursday',
  vendredi: 'Friday',
  samedi: 'Saturday',
  dimanche: 'Sunday',
};
const ORDRE_JOURS = Object.keys(JOURS_SCHEMA);

export function horairesSchemaOrg(reglages: Reglages) {
  return reglages.horaires.map((plage) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: plage.jours.map((j) => JOURS_SCHEMA[j]),
    opens: plage.ouverture,
    closes: plage.fermeture,
  }));
}

/** `09:30` -> `9 h 30`, `14:00` -> `14 h`. */
const heureLisible = (h: string) => {
  const [hh, mm] = h.split(':');
  return `${Number(hh)} h${mm === '00' ? '' : ` ${mm}`}`;
};

/** « Mardi, mercredi : de 9 h à 18 h », une ligne par plage. */
export function horairesLisibles(reglages: Reglages): string[] {
  return reglages.horaires.map((plage) => {
    const jours = [...plage.jours].sort((a, b) => ORDRE_JOURS.indexOf(a) - ORDRE_JOURS.indexOf(b));
    const liste = jours.join(', ');
    return `${liste.charAt(0).toUpperCase()}${liste.slice(1)} : de ${heureLisible(plage.ouverture)} à ${heureLisible(plage.fermeture)}`;
  });
}
