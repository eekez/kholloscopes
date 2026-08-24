/**
 * khollescope-commun.js
 * Logique partagée par les pages élèves (tb1.html, tb2.html, bcpst1.html, bcpst2.html)
 * et la page professeurs (prof.html). Ce fichier ne contient aucune référence à un
 * formulaire HTML précis : chaque page l'utilise à sa façon.
 *
 * Dépend de PapaParse (chargé séparément dans chaque page) et de la variable
 * globale SHEET_ID définie dans chaque page avant l'inclusion de ce fichier.
 */

const MOIS_COURT = ["JANV","FÉVR","MARS","AVR","MAI","JUIN","JUIL","AOÛT","SEPT","OCT","NOV","DÉC"];
const JOURS_COURT = ["DIM","LUN","MAR","MER","JEU","VEN","SAM"];

const ONGLETS = {
  TB1: "TB1 (élèves)",
  TB2: "TB2 (élèves)",
  BCPST1: "BCPST1 (élèves)",
  BCPST2: "BCPST2 (élèves)",
};

const ONGLET_EXPORT_WEB = "Export Web";

// Emplacements des 3 zones dans l'onglet "Export Web" (0-indexé : ligne 1 = index 0).
const ZONE_PIVOT = { ligne: 0, colonne: 0 }; // A1
const CLASSES_CONNUES = ['TB1', 'TB2', 'BCPST1', 'BCPST2'];

/**
 * Charge l'intégralité de l'onglet "Export Web" et en extrait les 3 informations
 * utiles à prof.html : le pivot Maths TB1, les heures par khôlleur et par lot, et
 * la liste des groupes non vides (pour ne pas afficher de khôlle sur un groupe
 * sans élève). Cet onglet est le SEUL, avec les 4 onglets élèves, à devoir être
 * publié sur le web — aucun autre onglet du classeur n'a besoin de l'être.
 *
 * IMPORTANT : Google Sheets (gviz) supprime de la réponse toute ligne ENTIÈREMENT
 * vide, ce qui décale silencieusement les numéros de ligne dès qu'une ligne
 * intermédiaire n'a pas encore été remplie (ex: un groupe sans élève cette année,
 * ou un khôlleur sans heures sur un lot). On ne peut donc pas se fier à une plage
 * de lignes fixe : chaque ligne est identifiée par son CONTENU, pas sa position.
 */
async function chargerExportWeb() {
  const rows = await chargerOnglet(ONGLET_EXPORT_WEB);

  const pivotBrut = rows[ZONE_PIVOT.ligne] && rows[ZONE_PIVOT.ligne][ZONE_PIVOT.colonne];
  const pivot = parseInt(pivotBrut, 10);

  const heuresParNom = {};
  const groupesNonVides = new Set();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const col0 = (row[0] || '').toString().trim();
    if (!col0) continue;

    if (CLASSES_CONNUES.includes(col0)) {
      // Ligne de la Zone "groupes" : Classe | Groupe | Élèves
      const groupe = row[1];
      // Colonne H (index 7) plutôt que C : contournement d'un bug connu de l'API
      // gviz de Google, qui fige sa détection de structure colonne par colonne lors
      // de son premier accès et ignore ensuite tout contenu ajouté dans une colonne
      // qu'il avait alors vue entièrement vide (cas de la colonne C ici).
      const eleves = row[7];
      if (groupe && eleves && eleves.toString().trim()) {
        groupesNonVides.add(col0 + '|' + parseInt(groupe, 10));
      }
    } else if (col0 !== 'Nom' && col0 !== 'Classe' && col0 !== 'Pivot Maths TB1') {
      // Ligne de la Zone "heures" : Nom | Lot1 | Lot2 | Lot3 | Lot4
      // (on exclut les lignes d'en-tête "Nom"/"Classe" tapées manuellement)
      heuresParNom[col0] = [1, 2, 3, 4].map(c => parseNombreFr(row[c]));
    }
  }

  return {
    pivot: isNaN(pivot) ? null : pivot,
    heuresParNom,
    groupesNonVides,
  };
}

function groupeEstNonVide(donneesExportWeb, classe, groupeIndex) {
  return donneesExportWeb.groupesNonVides.has(classe + '|' + groupeIndex);
}

function formatHeuresParLot(heures) {
  if (!heures) return '';
  return heures.map((h, i) => 'Lot ' + (i + 1) + ' : ' + formatDuree(h)).join(' · ');
}

const N_GROUPES = { TB1: 8, TB2: 12, BCPST1: 12, BCPST2: 10 };

let _compteurCallback = 0;

/**
 * Charge un onglet via le protocole JSONP natif de Google Visualization (gviz).
 * On utilise volontairement une balise <script> dynamique plutôt que fetch() :
 * les URLs gviz de Google Sheets ne renvoient pas d'en-tête CORS, donc fetch()
 * échoue silencieusement dès que la page est hébergée sur un autre domaine que
 * docs.google.com — même si l'URL fonctionne très bien ouverte directement dans
 * le navigateur. Le mode JSONP (chargement via <script>) n'est pas soumis à
 * cette restriction.
 */
function chargerOnglet(nomOnglet) {
  return new Promise((resolve, reject) => {
    const nomCallback = '__khollescope_cb_' + (_compteurCallback++);
    const idScript = nomCallback + '_script';

    const minuteur = setTimeout(() => {
      nettoyer();
      reject(new Error('Délai dépassé pour charger ' + nomOnglet));
    }, 12000);

    function nettoyer() {
      clearTimeout(minuteur);
      delete window[nomCallback];
      const s = document.getElementById(idScript);
      if (s) s.remove();
    }

    window[nomCallback] = function (reponse) {
      nettoyer();
      if (!reponse || reponse.status === 'error') {
        reject(new Error('Réponse invalide pour ' + nomOnglet));
        return;
      }
      try {
        resolve(tableVersLignes(reponse.table));
      } catch (e) {
        reject(e);
      }
    };

    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
      '/gviz/tq?tqx=responseHandler:' + nomCallback +
      '&sheet=' + encodeURIComponent(nomOnglet);

    const script = document.createElement('script');
    script.id = idScript;
    script.src = url;
    script.onerror = () => {
      nettoyer();
      reject(new Error('Impossible de joindre Google Sheets pour ' + nomOnglet));
    };
    document.head.appendChild(script);
  });
}

/**
 * Convertit la structure {cols, rows} renvoyée par gviz en un tableau de lignes
 * "à plat" (même forme que le CSV qu'on utilisait auparavant : rows[i][j] = valeur
 * texte de la cellule ligne i, colonne j, en partant de la colonne A = index 0).
 */
function tableVersLignes(table) {
  if (!table || !table.rows) return [];
  return table.rows.map(row => {
    if (!row || !row.c) return [];
    return row.c.map(cell => {
      if (!cell) return '';
      // Pour les dates, gviz renvoie souvent v sous forme "Date(2026,8,7)" ; on
      // privilégie le texte formaté (f) quand il existe, sinon la valeur brute.
      if (typeof cell.f === 'string' && cell.f !== '') return cell.f;
      if (cell.v === null || cell.v === undefined) return '';
      return String(cell.v);
    });
  });
}

/**
 * Analyse le texte d'une cellule de créneau. Formats acceptés :
 *  - "Matière\nJour Horaire\nSalle - Nom"   (format complet)
 *  - "Jour Horaire\nSalle - Nom"            (sans matière)
 *  - "Matière\nSalle - Nom"                 (sans horaire)
 *  - "Nom" ou "M. Nom"                       (saisie courte, juste le nom)
 */
function analyserCreneau(texte) {
  if (!texte || !texte.trim()) return null;
  const lignes = texte.split('\n').map(l => l.trim()).filter(Boolean);
  if (lignes.length === 0) return null;

  let matiere = '', horaireLigne = '', salleLigne = '';
  const ressembleHoraire = (s) => /\d{1,2}h|lundi|mardi|mercredi|jeudi|vendredi|samedi/i.test(s);

  if (lignes.length >= 3) {
    matiere = lignes[0];
    horaireLigne = lignes[1];
    salleLigne = lignes[2];
  } else if (lignes.length === 2) {
    if (ressembleHoraire(lignes[0])) {
      horaireLigne = lignes[0];
      salleLigne = lignes[1];
    } else {
      matiere = lignes[0];
      salleLigne = lignes[1];
    }
  } else {
    salleLigne = lignes[0];
  }

  let salle = salleLigne, nom = '';
  const idxTiret = salleLigne.lastIndexOf('-');
  if (idxTiret !== -1) {
    salle = salleLigne.slice(0, idxTiret).trim();
    nom = salleLigne.slice(idxTiret + 1).trim();
  } else {
    nom = salleLigne.trim();
    salle = '';
  }
  let civilite = '';
  const matchCivilite = nom.match(/^(M\.|Mme|Mr|Mlle)\s*/i);
  if (matchCivilite) {
    civilite = matchCivilite[1];
    // Normalisation légère (M -> M., MME -> Mme) pour un affichage homogène
    // même si la saisie d'origine variait en casse ou ponctuation.
    const civiliteMinuscule = civilite.toLowerCase().replace('.', '');
    if (civiliteMinuscule === 'm') civilite = 'M.';
    else if (civiliteMinuscule === 'mme') civilite = 'Mme';
    else if (civiliteMinuscule === 'mr') civilite = 'M.';
    else if (civiliteMinuscule === 'mlle') civilite = 'Mlle';
  }
  nom = nom.replace(/^(M\.|Mme|Mr|Mlle)\s*/i, '').trim();

  return { matiere, horaireLigne, salle, nom, civilite, brut: texte };
}

/**
 * Convertit un nombre tel que renvoyé par Google Sheets en paramètres régionaux
 * français (virgule décimale, ex: "1,75") en un nombre JS classique (point).
 * parseFloat seul s'arrêterait au premier caractère non numérique et tronquerait
 * "1,75" en 1 — d'où la nécessité de remplacer la virgule avant conversion.
 */
function parseNombreFr(valeur) {
  if (valeur === null || valeur === undefined) return 0;
  const n = parseFloat(String(valeur).trim().replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function parserDateFr(s) {
  if (!s) return null;
  s = s.trim();
  // Format affiché habituel : JJ/MM/AAAA ou J/M/AA (Google Sheets peut omettre les zéros
  // de tête et abréger l'année sur 2 chiffres selon le format régional du navigateur).
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    let annee = parseInt(m[3], 10);
    if (m[3].length === 2) annee += 2000; // "26" -> 2026 (toujours années 2000+ dans ce contexte)
    return new Date(annee, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  }
  // Format brut gviz quand la valeur formatée n'est pas disponible : Date(2026,8,7)
  const m2 = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
  if (m2) return new Date(parseInt(m2[1], 10), parseInt(m2[2], 10), parseInt(m2[3], 10));
  return null;
}

function formatBilletDate(date) {
  return {
    jour: JOURS_COURT[date.getDay()],
    numero: date.getDate(),
    mois: MOIS_COURT[date.getMonth()],
  };
}

/**
 * Construit la liste des créneaux à partir des lignes CSV d'un onglet élève,
 * pour UN groupe (options.colonneIndex) ou en cherchant un NOM dans toutes les
 * colonnes (options.nomRecherche). options.pivotMathsTB1 (numéro de semaine,
 * optionnel) permet de calculer la durée exacte des khôlles de maths en TB1.
 */
function extraireCreneaux(rows, classeNom, options) {
  const resultats = [];
  let derniereDateConnue = null;
  let dernierNumeroSemaine = null;
  let dernierLibelleSemaine = null;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 5) continue;

    const numSemaineCell = parseInt(row[0], 10);
    if (!isNaN(numSemaineCell)) dernierNumeroSemaine = numSemaineCell;

    if (row[3] && row[3].trim() && !row[3].toUpperCase().includes('VACANCES')) {
      dernierLibelleSemaine = row[3].trim();
    }

    const dateCell = parserDateFr(row[1]);
    if (dateCell) derniereDateConnue = dateCell;
    if (!derniereDateConnue) continue;

    const colonnesACheck = options.colonneIndex !== undefined
      ? [options.colonneIndex]
      : row.map((_, i) => i).filter(i => i >= 4);

    for (const c of colonnesACheck) {
      const texte = row[c];
      if (!texte || !texte.trim()) continue;
      if (texte.toUpperCase().includes('VACANCES')) continue;

      const groupeIndex = c - 4 + 1;

      if (!options.nomRecherche && options.exportWeb && !groupeEstNonVide(options.exportWeb, classeNom, groupeIndex)) {
        continue; 
      }

      const creneau = analyserCreneau(texte);
      if (!creneau) continue;

      if (options.nomRecherche) {
        const motif = new RegExp(
          '(?:^|\\b)' + options.nomRecherche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\b|$)', 'i'
        );
        if (!motif.test(creneau.nom)) continue;
      }

      const item = {
        date: derniereDateConnue,
        numeroSemaine: dernierNumeroSemaine,
        libelleSemaine: dernierLibelleSemaine,
        groupeIndex: groupeIndex,
        classe: classeNom,
        ...creneau,
      };
      item.duree = calculerDuree(item, options.pivotMathsTB1);
      resultats.push(item);
    }
  }
  return resultats;
}

/**
 * Durée d'une khôlle en heures : 1h par défaut, sauf Maths en TB1 où elle dépend
 * de la semaine pivot (0h45 avant, 1h30 à partir de cette semaine), reproduisant
 * la même règle que le fichier Excel (Bilan lot 1!L13).
 */
function calculerDuree(item, pivotMathsTB1) {
  if (!estMathsTB1(item) || !pivotMathsTB1 || !item.numeroSemaine) return 1;
  return item.numeroSemaine < pivotMathsTB1 ? 0.75 : 1.5;
}

function formatDuree(heures) {
  // Arrondi direct à la minute (pas d'arrondi intermédiaire au dixième d'heure,
  // qui décalait à tort des durées exactes comme 0.75h/45min vers 0.8h/48min).
  const minutes = Math.round(heures * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return m + ' min';
  if (m === 0) return h + 'h';
  return h + 'h' + String(m).padStart(2, '0');
}

function estMathsTB1(item) {
  return item.classe === 'TB1' && /math/i.test(item.matiere);
}

const MOTIF_REPORTE = /\breport(é|ée|e|ee)?(?=[\s\-–]|$)/i;

function estReporte(item) {
  return MOTIF_REPORTE.test(item.brut || '');
}

/**
 * Retire la mention "reporté/reportée/..." (et un éventuel tiret orphelin
 * laissé autour) du texte brut d'un créneau reporté, pour n'afficher que ce
 * qui reste — en préservant la structure en lignes d'origine (matière/horaire/
 * salle-nom), pour que analyserCreneau() puisse encore la décomposer normalement
 * si le créneau reporté contenait un texte complet plutôt qu'une simple initiale.
 */
function nettoyerTexteReporte(brut) {
  return (brut || '')
    .split('\n')
    .map(ligne => {
      let l = ligne.replace(MOTIF_REPORTE, ' ');
      l = l.replace(/^[\s\-–]+|[\s\-–]+$/g, '');
      return l.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean)
    .join('\n');
}

// Palette par matière (vue élève) — distincte et lisible, indépendante des
// couleurs de classe utilisées côté professeur. Couleurs choisies/ajustées pour
// garantir un contraste suffisant (WCAG AA, ratio >= 4.5:1) avec du texte blanc.
const PALETTE_MATIERES = {
  maths: '#3D6EA5',
  physique: '#A0692E',
  pc: '#A0692E',
  svt: '#478356',
  btk: '#7A5C9E',
  anglais: '#B5483F',
  français: '#89752F',
  francais: '#89752F',
  géo: '#527D7D',
  geo: '#527D7D',
  info: '#6B6B6B',
};
const COULEUR_MATIERE_DEFAUT = '#8A8478';

function couleurMatiere(matiere) {
  if (!matiere) return COULEUR_MATIERE_DEFAUT;
  const cle = matiere.trim().toLowerCase();
  return PALETTE_MATIERES[cle] || COULEUR_MATIERE_DEFAUT;
}

// Palette par classe (vue professeur) — reprend les teintes déjà utilisées
// dans le classeur Excel, légèrement ajustées pour le contraste avec texte blanc.
const PALETTE_CLASSES = {
  TB1: '#4A6FA5',
  TB2: '#4C7C59',
  BCPST1: '#B1621C',
  BCPST2: '#6B4E71',
};

function couleurClasse(classe) {
  return PALETTE_CLASSES[classe] || COULEUR_MATIERE_DEFAUT;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function afficherChargement(zoneResultats) {
  zoneResultats.innerHTML =
    '<div class="etat"><div class="spinner" role="status" aria-label="Chargement"></div>Recherche du planning…</div>';
}

function afficherErreur(zoneResultats, message) {
  zoneResultats.innerHTML = '<div class="etat erreur">' + escapeHtml(message) + '</div>';
}

function afficherResultats(zoneResultats, items, sousTitre, options) {
  options = options || {};
  if (items.length === 0) {
    zoneResultats.innerHTML =
      '<div class="etat">Aucune khôlle trouvée pour le moment.<br>Le planning sera mis à jour au fil de l\'année.</div>';
    return;
  }
  items.sort((a, b) => a.date - b.date);

  let html = '<div class="resultats-entete"><h2>' + escapeHtml(sousTitre) + '</h2>' +
    '<span class="compte">' + items.length + (items.length > 1 ? ' khôlles' : ' khôlle') + '</span></div>';

  let derniereSemaineAffichee = null;
  let idSemaineCourante = null;
  let semaineCouranteTrouvee = false;
  const aujourdHui = new Date();
  aujourdHui.setHours(0, 0, 0, 0);

  for (const item of items) {
    const d = formatBilletDate(item.date);
    const isMathsTB1 = estMathsTB1(item);
    const reporte = estReporte(item);
    const afficherClasseGroupe = options.afficherClasseGroupe !== false;
    const afficherNomProf = options.afficherNomProf !== false;

    if (item.libelleSemaine && item.libelleSemaine !== derniereSemaineAffichee) {
      // Premier en-tête de semaine dont la date n'est pas encore entièrement passée
      // (la khôlle elle-même, ou la fin de sa semaine si on raisonne large) : on lui
      // donne un identifiant pour pouvoir y défiler automatiquement à l'ouverture.
      let idAttribut = '';
      // On compare à la FIN de la semaine (vendredi, +4 jours) plutôt qu'à sa date
      // de début : sinon, en plein milieu d'une semaine de khôlles, le marqueur
      // sautait déjà à la semaine suivante alors que la semaine en cours n'est pas
      // encore terminée.
      const finDeSemaine = new Date(item.date.getTime());
      finDeSemaine.setDate(finDeSemaine.getDate() + 4);
      if (!semaineCouranteTrouvee && finDeSemaine >= aujourdHui) {
        idSemaineCourante = 'semaine-courante';
        idAttribut = ' id="' + idSemaineCourante + '"';
        semaineCouranteTrouvee = true;
      }
      html += '<div class="entete-semaine"' + idAttribut + '>' + escapeHtml(item.libelleSemaine) + '</div>';
      derniereSemaineAffichee = item.libelleSemaine;
    }

    // Mode prof (afficherClasseGroupe=true) : couleur par classe, classe+groupe en titre.
    // Mode élève (afficherClasseGroupe=false) : couleur par matière, matière en titre.
    const couleurAccent = afficherClasseGroupe ? couleurClasse(item.classe) : couleurMatiere(item.matiere);

    // Pour un créneau reporté, on réanalyse le texte UNE FOIS la mention "reportée"
    // retirée : si la case ne contenait qu'une initiale ("M. L"), seul le nom
    // s'affichera ; si elle contenait un créneau complet, matière/horaire/salle
    // s'afficheront normalement, avec la même mise en forme qu'un billet standard
    // (seule l'opacité du billet + le tampon signalent qu'il est reporté).
    const donneesAffichees = reporte ? (analyserCreneau(nettoyerTexteReporte(item.brut)) || {}) : item;
    const titrePrincipal = afficherClasseGroupe && item.classe
      ? item.classe + ' – Groupe ' + item.groupeIndex
      : (donneesAffichees.matiere || (reporte ? '' : 'Khôlle'));

    html += '<article class="billet' + (isMathsTB1 ? ' maths-tb1' : '') + (reporte ? ' reporte' : '') +
      '" style="border-left-color:' + couleurAccent + ';">' +
      (reporte ? '<span class="tampon-reporte">Reportée</span>' : '') +
      '<div class="billet-heure" style="background:' + couleurAccent + ';"><span class="jour">' + d.jour + '</span>' +
      '<span class="date">' + d.numero + '</span>' +
      '<span class="mois">' + d.mois + '</span></div>' +
      '<div class="billet-corps">' +
      (titrePrincipal ? '<div class="billet-matiere">' + escapeHtml(titrePrincipal) + '</div>' : '') +
      '<div class="billet-details">' +
      (donneesAffichees.horaireLigne ? '<span>🕐 ' + escapeHtml(donneesAffichees.horaireLigne) + '</span>' : '') +
      (!reporte && item.duree ? '<span>⏱ ' + formatDuree(item.duree) + '</span>' : '') +
      (donneesAffichees.salle ? '<span>📍 ' + escapeHtml(donneesAffichees.salle) + '</span>' : '') +
      (afficherClasseGroupe && donneesAffichees.matiere ? '<span>' + escapeHtml(donneesAffichees.matiere) + '</span>' : '') +
      (!afficherClasseGroupe && afficherNomProf && donneesAffichees.nom
        ? '<span>👤 ' + escapeHtml((donneesAffichees.civilite ? donneesAffichees.civilite + ' ' : '') + donneesAffichees.nom) + '</span>'
        : '') +
      '</div>' +
      (!reporte && isMathsTB1 && !item.duree ? '<span class="badge-maths">Durée variable selon la semaine</span>' : '') +
      '</div>' +
      '</article>';
  }
  zoneResultats.innerHTML = html;

  // Défilement automatique vers la semaine en cours/à venir, pour que l'élève
  // n'ait pas à chercher en remontant tout le planning depuis la rentrée.
  if (idSemaineCourante) {
    const cible = document.getElementById(idSemaineCourante);
    if (cible) {
      // Léger délai pour laisser le navigateur terminer le rendu avant de défiler.
      setTimeout(() => cible.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }
}

/**
 * Initialise le bandeau d'installation de l'app sur l'écran d'accueil.
 * - Sur Chrome/Android (et navigateurs Chromium) : capture l'événement natif
 *   et propose un bouton "Installer" qui déclenche directement la fenêtre
 *   native, sans passer par le menu ⋮.
 * - Sur iOS/Safari : aucune API équivalente n'existe ; on affiche à la place
 *   une instruction simple (partager > Sur l'écran d'accueil).
 * - Sur desktop ou si l'app est déjà installée : le bandeau ne s'affiche pas.
 */
function initBandeauInstallation(nomAppCourt) {
  const estIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const estStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (estStandalone) return; // déjà installée, rien à proposer

  const conteneur = document.createElement('div');
  conteneur.className = 'bandeau-install';
  conteneur.style.display = 'none';

  function construireBandeau(innerHtml) {
    conteneur.innerHTML = '<div class="bandeau-install-contenu">' + innerHtml + '</div>';
    conteneur.style.display = '';
  }

  if (estIOS) {
    // Pas d'API d'installation programmatique sur iOS : on guide manuellement.
    construireBandeau(
      '<span>📲 Pour garder ' + escapeHtml(nomAppCourt) + ' sur votre écran d\'accueil : ' +
      'appuyez sur le bouton de partage <strong>⬆️</strong> puis « Sur l\'écran d\'accueil ».</span>' +
      '<button type="button" class="bandeau-install-fermer" aria-label="Fermer">✕</button>'
    );
    conteneur.querySelector('.bandeau-install-fermer').addEventListener('click', () => {
      conteneur.style.display = 'none';
    });
  } else {
    let evenementDiffere = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      evenementDiffere = e;
      construireBandeau(
        '<span>📲 Installez ' + escapeHtml(nomAppCourt) + ' sur votre écran d\'accueil pour y accéder en un geste.</span>' +
        '<button type="button" id="btn-install-pwa">Installer</button>'
      );
      const btn = conteneur.querySelector('#btn-install-pwa');
      btn.addEventListener('click', async () => {
        if (!evenementDiffere) return;
        evenementDiffere.prompt();
        await evenementDiffere.userChoice;
        evenementDiffere = null;
        conteneur.style.display = 'none';
      });
    });
    window.addEventListener('appinstalled', () => {
      conteneur.style.display = 'none';
    });
  }

  const header = document.querySelector('header');
  if (header && header.nextSibling) {
    header.parentNode.insertBefore(conteneur, header.nextSibling);
  } else {
    document.body.insertBefore(conteneur, document.body.firstChild);
  }
}

/**
 * Détecte si le planning des 3 prochaines semaines (semaine en cours incluse) a
 * changé depuis la dernière consultation de cet élève sur cet appareil, et
 * affiche un encart si c'est le cas. Compromis pragmatique face à l'absence de
 * vraie notification push (qui nécessiterait un serveur permanent) : l'alerte
 * n'apparaît qu'à l'ouverture de l'app, pas en tâche de fond.
 */
function verifierModificationsRecentes(zoneResultats, items, cleStockage) {
  const aujourdHui = new Date();
  aujourdHui.setHours(0, 0, 0, 0);
  const limite = new Date(aujourdHui.getTime());
  limite.setDate(limite.getDate() + 21); // 3 semaines

  const itemsProches = items
    .filter(it => it.date >= aujourdHui && it.date <= limite)
    .sort((a, b) => a.date - b.date);

  const empreinteActuelle = itemsProches
    .map(it => it.date.toISOString().slice(0, 10) + '|' + (it.brut || ''))
    .join(';;');

  const empreinteStockee = localStorage.getItem(cleStockage);

  if (empreinteStockee !== null && empreinteStockee !== empreinteActuelle) {
    const bandeau = document.createElement('div');
    bandeau.className = 'bandeau-modif';
    bandeau.innerHTML =
      '⚡ Le planning des prochaines semaines a changé depuis votre dernière visite.';
    zoneResultats.insertBefore(bandeau, zoneResultats.firstChild);
  }

  localStorage.setItem(cleStockage, empreinteActuelle);
}
