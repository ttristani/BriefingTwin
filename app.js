/* Briefing Twinjet — interface PWA */
(function () {
  'use strict';
  const E = window.Engine, S = E.STATUS;
  const $ = (s) => document.querySelector(s);
  const LABEL = { 0: 'GO', 1: 'VIGILANCE', 2: 'INUTILISABLE', '-1': 'N/D' };
  const VERDICT = { 0: 'GO', 1: 'GO VIGILANCE', 2: 'NO-GO', '-1': 'N/D' };
  const JOURS = ['DI', 'LU', 'MA', 'ME', 'JE', 'VE', 'SA'];
  const DEFAULTS = { maxXw: 25, maxTail: 10, gustWarn: 25 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm = (d) => d.toISOString().slice(11, 16);
  const dm = (d) => d.toISOString().slice(8, 10) + '/' + d.toISOString().slice(5, 7);

  const state = { prog: null, minima: null, wx: null, wxInfo: '', rot: null, paire: null, date: null };

  // ---------------------------------------------------------------- réglages
  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('briefing.settings') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(s) { try { localStorage.setItem('briefing.settings', JSON.stringify(s)); } catch (e) { /* stockage indisponible */ } }
  let settings = loadSettings();

  // ---------------------------------------------------------------- données
  async function getJSON(url, timeout) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout || 10000);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  function repoRawBase() {
    // https://<user>.github.io/<repo>/  →  https://raw.githubusercontent.com/<user>/<repo>/main/
    const h = location.hostname;
    if (!h.endsWith('.github.io')) return null;
    const user = h.replace('.github.io', '');
    const repo = location.pathname.split('/').filter(Boolean)[0];
    return repo ? `https://raw.githubusercontent.com/${user}/${repo}/main/` : null;
  }

  function allIcaos() {
    const s = new Set();
    for (const r of state.prog.rotations) for (const p of r.paires) for (const f of [p.aller, p.retour]) { s.add(f.dpt); s.add(f.arv); f.alt.forEach(a => s.add(a)); }
    return [...s];
  }

  async function loadWx() {
    // 1) fichier collecté par GitHub Actions (METAR, TAF, NOTAM)
    let wx = null;
    const cands = [];
    const raw = repoRawBase();
    if (raw) cands.push(raw + 'data/wx.json?t=' + Date.now());
    cands.push('data/wx.json?t=' + Date.now());
    for (const u of cands) {
      try {
        const j = await getJSON(u, 8000);
        if (!wx || (j.generated || '') > (wx.generated || '')) wx = j;
      } catch (e) { /* essai suivant */ }
    }
    wx = wx || { metar: {}, taf: {}, notam: {}, generated: null };
    let src = wx.generated ? 'collecte GitHub ' + wx.generated.slice(11, 16) + 'Z' : 'aucune collecte';
    // 2) METAR/TAF en direct si le navigateur l'autorise (CORS)
    try {
      const ids = allIcaos().join(',');
      const [m, t] = await Promise.all([
        getJSON(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=2`, 7000),
        getJSON(`https://aviationweather.gov/api/data/taf?ids=${ids}&format=json`, 7000)
      ]);
      const metar = {}, taf = {};
      for (const x of m) { const id = x.icaoId; (metar[id] = metar[id] || []).push(x.rawOb); }
      for (const id in metar) metar[id].sort((a, b) => (b.match(/ (\d{6})Z/) || [])[1] > (a.match(/ (\d{6})Z/) || [])[1] ? 1 : -1);
      for (const x of t) { if (!taf[x.icaoId]) taf[x.icaoId] = x.rawTAF; }
      if (Object.keys(metar).length) { wx.metar = Object.assign({}, wx.metar, metar); wx.taf = Object.assign({}, wx.taf, taf); src = 'METAR/TAF en direct · NOTAM ' + src; wx.live = true; }
    } catch (e) { /* CORS ou hors ligne : on garde la collecte */ }
    state.wx = wx;
    state.wxInfo = src;
    const badge = $('#dataAge');
    badge.textContent = wx.live ? 'Météo en direct' : (wx.generated ? 'Données ' + wx.generated.slice(11, 16) + 'Z' : 'Pas de données');
    const age = wx.generated ? (Date.now() - Date.parse(wx.generated)) / 60e3 : Infinity;
    badge.classList.toggle('old', !wx.live && age > 90);
  }

  // ---------------------------------------------------------------- navigation
  function show(id) {
    for (const s of document.querySelectorAll('.step')) s.classList.add('hidden');
    $('#' + id).classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-back]');
    if (b) show(b.dataset.back);
  });
  $('#homeBtn').addEventListener('click', () => show('stepRotation'));

  function renderRotations() {
    $('#rotations').innerHTML = state.prog.rotations.map((r, i) =>
      `<button class="tile" data-rot="${i}"><div class="big">${esc(r.id)}</div><div class="small">${esc(r.nom)} · ${r.paires.length} horaire${r.paires.length > 1 ? 's' : ''}</div></button>`).join('');
    $('#rotations').onclick = (e) => {
      const b = e.target.closest('[data-rot]'); if (!b) return;
      state.rot = state.prog.rotations[+b.dataset.rot]; renderHoraires(); show('stepHoraire');
    };
  }

  function daysHtml(days) {
    return '<div class="days">' + [1, 2, 3, 4, 5, 6, 0].map(d => `<span class="day ${days.includes(d) ? 'on' : ''}">${JOURS[d]}</span>`).join('') + '</div>';
  }

  function renderHoraires() {
    $('#horaires').innerHTML = state.rot.paires.map((p, i) => {
      const a = p.aller, r = p.retour;
      return `<button class="tile" data-p="${i}">
        <div><div class="big">${esc(a.vol)} / ${esc(r.vol.replace(/^\D+\s?/, ''))}</div>
        <div class="small">${a.dpt} ${a.std}→${a.sta} ${a.arv} · ${r.dpt} ${r.std}→${r.sta} ${r.arv} (UTC)</div></div>
        <div>${daysHtml(a.jours)}${JSON.stringify(a.jours) !== JSON.stringify(r.jours) ? '<div class="small">retour :</div>' + daysHtml(r.jours) : ''}</div>
      </button>`;
    }).join('');
    $('#horaires').onclick = (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      state.paire = state.rot.paires[+b.dataset.p]; renderDates(); show('stepDate');
    };
  }

  function renderDates() {
    const p = state.paire, out = [];
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < 8; i++) {
      const d = new Date(+today + i * 864e5), wd = d.getUTCDay();
      const ok = p.aller.jours.includes(wd) || p.retour.jours.includes(wd);
      out.push(`<button class="chip ${i === 0 ? 'today' : ''}" data-d="${d.toISOString().slice(0, 10)}" ${ok ? '' : 'disabled'}>
        <span>${i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : '&nbsp;'}</span><b>${JOURS[wd]} ${dm(d)}</b></button>`);
    }
    $('#dates').innerHTML = out.join('');
    $('#dates').onclick = (e) => {
      const b = e.target.closest('[data-d]'); if (!b || b.disabled) return;
      state.date = b.dataset.d; renderBriefing(); show('stepBriefing');
    };
  }

  // ---------------------------------------------------------------- briefing
  const pill = (st, txt) => `<span class="pill s${st}">${esc(txt || LABEL[st])}</span>`;

  function renderBriefing() {
    const p = state.paire, wd = new Date(state.date + 'T00:00:00Z').getUTCDay();
    const flights = [p.aller, p.retour].filter(f => f.jours.includes(wd));
    const skipped = [p.aller, p.retour].filter(f => !f.jours.includes(wd));
    const b = E.buildBriefing(flights, state.date, state.wx, state.minima, settings, new Date());
    const dateTxt = new Date(state.date + 'T00:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    let h = '';
    h += `<div class="hdr"><div><h1>BRIEFING PRÉVOL — MÉTÉO &amp; NOTAM</h1><div class="s">Twinjet · B1900D · Perf. classe A · CAT I uniquement</div></div>
      <div class="r"><b>${esc(state.rot.id)}</b><br>${esc(dateTxt)}<br><span class="s">Généré à ${hm(b.generatedAt)}Z</span></div></div>`;
    h += `<div class="proto">Sources : ${esc(state.wxInfo)}. Aide à la décision — ne remplace pas le dossier officiel. Décision CDB.</div>`;
    if (!state.wx.generated && !state.wx.live) h += `<div class="err">Aucune donnée météo disponible. Vérifie la connexion, ou que la collecte GitHub Actions tourne bien.</div>`;
    if (skipped.length) h += `<div class="err">Non programmé ce jour : ${skipped.map(f => esc(f.vol)).join(', ')}.</div>`;

    // synthèse
    h += `<div class="card"><table class="sum"><tr><th>Vol</th><th>Créneau UTC</th><th>Dégagements</th><th></th></tr>`;
    for (const f of b.flights) {
      const alts = f.roles.filter(r => r.role === 'ALT').map(r => r.status === S.BAD ? `<span class="x">${r.icao} ✗</span>` : r.icao).join(' / ');
      h += `<tr><td><b>${esc(f.flight.vol)}</b><br>${f.flight.dpt} → ${f.flight.arv}</td><td>${f.flight.std} – ${f.flight.sta}</td><td>${alts}</td><td style="text-align:right">${pill(f.verdict, VERDICT[f.verdict])}</td></tr>`;
    }
    h += `</table></div>`;

    // points d'attention
    const pts = [];
    const seen = new Set();
    for (const f of b.flights) {
      for (const n of f.notes) pts.push({ st: S.BAD, t: `<b>${esc(f.flight.vol)}</b> : ${esc(n)}` });
      for (const r of f.roles) {
        if (r.status < S.WARN && r.status !== S.NA) continue;
        const key = r.icao + r.role + r.status + r.msgs.join();
        if (seen.has(key)) continue; seen.add(key);
        const main = r.msgs.filter(m => !/^Travers max \d+ kt$/.test(m)).slice(0, 3).join(' · ');
        pts.push({ st: r.status, t: `<b>${r.icao}</b> (${esc(r.label.toLowerCase())} ${esc(f.flight.vol)}) : ${esc(main || 'à surveiller')}` });
      }
    }
    pts.sort((a, b2) => b2.st - a.st);
    h += `<div class="card"><h3>Points d'attention</h3><ul class="pts">${pts.length ? pts.slice(0, 10).map(x => `<li class="bl${x.st} bg${x.st}">${x.t}</li>`).join('') : '<li class="bl0 bg0">Rien de particulier sur les créneaux.</li>'}</ul>
      <p class="hint">À vérifier hors de l'appli : horaires ATS des terrains, NOTAM FIR et en-route, TEMSI / givrage.${Object.values(b.airports).some(a => a.roles.some(r => r.hypothese)) ? ' Minima : hypothèse ILS CAT I (DA/H 200 ft, RVR 550 m) pour les terrains sans approches renseignées.' : ''}</p></div>`;

    // fiches terrains
    h += `<div class="aps">`;
    for (const icao in b.airports) {
      const ap = b.airports[icao];
      const name = (state.minima.terrains[icao] || {}).nom || '';
      h += `<div class="card ap bl${ap.status}"><div class="head"><div class="name"><b>${icao}</b> ${esc(name)}</div>${pill(ap.status)}</div>`;
      for (const r of ap.roles) {
        const w = r.worst, best = w && w.eval.best;
        const req = best ? (r.role === 'ALT' ? `${best.req.txt} → plafond ${best.req.ceil} ft / ${best.req.vis} m` : r.role === 'DEST' ? `Destination : ${best.req.txt} (${best.req.vis} m)` : `Minima d'atterrissage (${best.req.vis} m)`) : '';
        const wind = best ? `Piste QFU ${String(best.app.qfu).padStart(3, '0')} : travers ${best.w.xw} kt, ${best.w.hw >= 0 ? 'face ' + best.w.hw : 'arrière ' + (-best.w.hw)} kt` : '';
        h += `<div class="role bg${r.status}"><div class="rt"><span><b>${esc(r.flight)}</b> · ${esc(r.label)} · ${dm(r.t1)} ${hm(r.t1)}–${hm(r.t2)}Z</span>${pill(r.status)}</div>`;
        if (w) h += `<div class="kv"><span class="k">Pire cas</span><span>${esc(w.txt)} <span class="hint">(${esc(w.src)})</span></span>
          <span class="k">Minima</span><span>${esc(req)}${best && best.met ? ' → OK' : ''}</span>
          <span class="k">Vent</span><span>${esc(wind)}</span></div>`;
        const msgs = r.msgs.filter(m => !/^Travers max/.test(m));
        if (msgs.length) h += `<ul class="msgs">${msgs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>`;
        h += `</div>`;
      }
      // NOTAM
      const ns = ap.notams;
      if (ns.length) {
        const nb = ns.filter(n => n.sev >= S.WARN).length;
        h += `<details class="notams" ${nb ? 'open' : ''}><summary>NOTAM (${ns.length}${nb ? ', dont ' + nb + ' important' + (nb > 1 ? 's' : '') : ''})</summary>`;
        for (const n of ns) {
          const per = `${n.from ? dm(n.from) + ' ' + hm(n.from) : ''} → ${n.perm ? 'PERM' : n.to ? dm(n.to) + ' ' + hm(n.to) + (n.est ? ' EST' : '') : ''}${n.sched ? ' · ' + n.sched : ''}`;
          h += `<div class="notam bl${n.sev}" style="padding-left:8px"><span class="id">${esc(n.id)}</span> ${n.future ? '<span class="fut">À VENIR</span>' : ''} <span class="meta">${esc(per)}</span><br>${esc(n.text)}</div>`;
        }
        h += `</details>`;
      } else if (state.wx.notam && state.wx.notam[icao]) {
        h += `<p class="hint" style="margin:6px 14px">Aucun NOTAM pertinent sur le créneau.</p>`;
      } else {
        h += `<p class="hint" style="margin:6px 14px">NOTAM non disponibles pour ce terrain.</p>`;
      }
      h += `<div class="raw">${esc(ap.metar ? ap.metar.raw : 'METAR indisponible')}\n${esc(ap.taf ? ap.taf.raw.replace(/ (BECMG|PROB\d\d(?: TEMPO)?|TEMPO|FM\d{6})/g, '\n  $1') : 'TAF indisponible')}</div></div>`;
    }
    h += `</div>`;
    h += `<div class="foot">Règles : Air OPS EASA CAT.OP.MPA.182/185, AMC6 (schéma carburant de base). Pire cas sur le créneau, en retenant tous les TEMPO et PROB.
      Créneaux : départ STD→+1 h, destination ETA ±1 h, dégagements ETA→+2 h. Limites de vent : travers ${settings.maxXw} kt, arrière ${settings.maxTail} kt (réglages).
      NOTAM : base FAA (hors FIR et en-route), filtrés par sujet et par période.</div>`;
    $('#briefing').innerHTML = h;
  }

  // ---------------------------------------------------------------- actions
  $('#refreshBtn').addEventListener('click', async () => {
    $('#refreshBtn').disabled = true; $('#refreshBtn').textContent = '…';
    await loadWx(); renderBriefing();
    $('#refreshBtn').disabled = false; $('#refreshBtn').textContent = '↻ Actualiser';
  });
  let openedForPrint = [];
  window.addEventListener('beforeprint', () => { openedForPrint = [...document.querySelectorAll('details:not([open])')]; openedForPrint.forEach(d => d.open = true); });
  window.addEventListener('afterprint', () => { openedForPrint.forEach(d => d.open = false); });
  $('#printBtn').addEventListener('click', () => window.print());

  $('#settingsBtn').addEventListener('click', () => {
    $('#setXw').value = settings.maxXw; $('#setTail').value = settings.maxTail; $('#setGust').value = settings.gustWarn;
    $('#settings').showModal();
  });
  $('#saveSettings').addEventListener('click', () => {
    settings = { maxXw: +$('#setXw').value || DEFAULTS.maxXw, maxTail: +$('#setTail').value || 0, gustWarn: +$('#setGust').value || DEFAULTS.gustWarn };
    saveSettings(settings);
    if (!$('#stepBriefing').classList.contains('hidden')) renderBriefing();
  });

  // ---------------------------------------------------------------- démarrage
  (async function init() {
    try {
      [state.prog, state.minima] = await Promise.all([getJSON('data/programme.json?t=' + Date.now()), getJSON('data/minima.json?t=' + Date.now())]);
    } catch (e) {
      $('#app').innerHTML = '<div class="err">Impossible de charger le programme (data/programme.json).</div>'; return;
    }
    renderRotations();
    await loadWx();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();
