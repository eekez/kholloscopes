/**
 * service-worker.js — minimal, requis par certains navigateurs (Chrome/Android)
 * pour proposer "Ajouter à l'écran d'accueil". Ne mémorise aucune donnée hors
 * ligne volontairement : le planning de khôlles doit toujours être lu en direct
 * depuis Google Sheets, jamais depuis une version mise en cache qui pourrait
 * devenir obsolète après un changement de créneau.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {
  // Intentionnellement vide : toutes les requêtes passent directement au réseau,
  // sans aucune mise en cache, pour garantir des données toujours à jour.
});
