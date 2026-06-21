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
  nom = nom.replace(/^(M\.|Mme|Mr|Mlle)\s*/i, '').trim();

  return { matiere, horaireLigne, salle, nom, brut: texte };
}

function parserDateFr(s) {
  if (!s) return null;
  s = s.trim();
  // Format affiché habituel (DD/MM/YYYY)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
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
 * colonnes (options.nomRecherche).
 */
function extraireCreneaux(rows, classeNom, options) {
  const resultats = [];
  let derniereDateConnue = null;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 5) continue;

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

      const creneau = analyserCreneau(texte);
      if (!creneau) continue;

      if (options.nomRecherche) {
        const motif = new RegExp(
          '(?:^|\\b)' + options.nomRecherche.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\b|$)', 'i'
        );
        if (!motif.test(creneau.nom)) continue;
      }

      resultats.push({
        date: derniereDateConnue,
        groupeIndex: c - 4 + 1,
        classe: classeNom,
        ...creneau,
      });
    }
  }
  return resultats;
}

function estMathsTB1(item) {
  return item.classe === 'TB1' && /math/i.test(item.matiere);
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

  for (const item of items) {
    const d = formatBilletDate(item.date);
    const isMathsTB1 = estMathsTB1(item);
    const afficherClasseGroupe = options.afficherClasseGroupe !== false;
    const afficherNomProf = options.afficherNomProf !== false;

    html += '<article class="billet' + (isMathsTB1 ? ' maths-tb1' : '') + '">' +
      '<div class="billet-heure"><span class="jour">' + d.jour + '</span>' +
      '<span class="date">' + d.numero + '</span>' +
      '<span class="mois">' + d.mois + '</span></div>' +
      '<div class="billet-corps">' +
      '<div class="billet-matiere">' + escapeHtml(item.matiere || 'Khôlle') + '</div>' +
      '<div class="billet-details">' +
      '<span>🕐 ' + escapeHtml(item.horaireLigne || '') + '</span>' +
      (item.salle ? '<span>📍 ' + escapeHtml(item.salle) + '</span>' : '') +
      (afficherClasseGroupe && item.classe ? '<span>' + escapeHtml(item.classe) + ' – Groupe ' + item.groupeIndex + '</span>' : '') +
      (afficherNomProf && item.nom ? '<span>👤 ' + escapeHtml(item.nom) + '</span>' : '') +
      '</div>' +
      (isMathsTB1 ? '<span class="badge-maths">Durée variable selon la semaine</span>' : '') +
      '</div></article>';
  }
  zoneResultats.innerHTML = html;
}
