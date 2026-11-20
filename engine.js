/* Moteur d'analyse METAR / TAF / NOTAM — Briefing Twinjet B1900D
 * Règles : Air OPS EASA (CAT.OP.MPA.182/185, AMC6 table 2 — schéma carburant de base).
 * Aide à la décision uniquement. Fonctionne dans le navigateur et sous Node (tests).
 */
(function (root) {
  'use strict';

  const H = 3600e3;
  const STATUS = { OK: 0, WARN: 1, BAD: 2, NA: -1 };

  // ---------------------------------------------------------------- utilitaires
  function dateFromDDHH(dd, hh, mm, ref) {
    // ref : Date (émission). Gère le changement de mois.
    let d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), dd, hh, mm || 0));
    if (d - ref < -10 * 24 * H) d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, dd, hh, mm || 0));
    if (d - ref > 20 * 24 * H) d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, dd, hh, mm || 0));
    return d;
  }

  function issueDate(tok, now) {
    const m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tok);
    if (!m) return null;
    return dateFromDDHH(+m[1], +m[2], +m[3], now || new Date());
  }

  // ---------------------------------------------------------------- éléments météo
  const WX_RE = /^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?((DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+)?$/;

  function parseElements(tokens) {
    // Renvoie uniquement les champs présents (pour fusion).
    const c = {};
    let clouds = null;
    for (const t of tokens) {
      let m;
      if ((m = /^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/.exec(t))) {
        const k = m[5] === 'MPS' ? 1.944 : 1;
        c.wdir = m[1] === 'VRB' ? null : +m[1];
        c.wspd = Math.round(+m[2] * k);
        c.gust = m[4] ? Math.round(+m[4] * k) : null;
        continue;
      }
      if (/^\d{3}V\d{3}$/.test(t)) continue;
      if (t === 'CAVOK') { c.vis = 10000; clouds = []; c.wx = []; c.cavok = true; continue; }
      if ((m = /^(\d{4})(NDV|N|NE|E|SE|S|SW|W|NW)?$/.exec(t))) { c.vis = m[1] === '9999' ? 10000 : +m[1]; continue; }
      if ((m = /^R\d{2}[LCR]?\/[PM]?(\d{4})/.exec(t))) { c.rvr = Math.min(c.rvr || 99999, +m[1]); continue; }
      if (t === 'NSC' || t === 'SKC' || t === 'CLR' || t === 'NCD') { clouds = clouds || []; continue; }
      if ((m = /^(FEW|SCT|BKN|OVC|VV|\/\/\/)(\d{3}|\/\/\/)?(CB|TCU|\/\/\/)?$/.exec(t)) && (m[2] || m[3] || m[1] === 'VV')) {
        clouds = clouds || [];
        clouds.push({ amt: m[1], h: m[2] && m[2] !== '///' ? +m[2] * 100 : null, type: m[3] === '///' ? null : m[3] || null });
        continue;
      }
      if (t === 'NSW') { c.wx = []; continue; }
      if (t.length >= 2 && WX_RE.test(t) && !/^\d/.test(t) && t !== 'VC') { (c.wx = c.wx || []).push(t); continue; }
    }
    if (clouds) {
      c.clouds = clouds;
      let ceil = Infinity;
      for (const cl of clouds) if ((cl.amt === 'BKN' || cl.amt === 'OVC' || cl.amt === 'VV') && cl.h != null) ceil = Math.min(ceil, cl.h);
      c.ceiling = ceil;
      c.cb = clouds.some(cl => cl.type === 'CB');
      c.tcu = clouds.some(cl => cl.type === 'TCU');
    }
    return c;
  }

  function merge(base, ch) {
    const r = Object.assign({}, base);
    for (const k of ['wdir', 'wspd', 'gust', 'vis', 'rvr']) if (k in ch) r[k] = ch[k];
    if ('wspd' in ch && !('gust' in ch)) r.gust = null;
    if ('clouds' in ch) { r.clouds = ch.clouds; r.ceiling = ch.ceiling; r.cb = ch.cb; r.tcu = ch.tcu; }
    if ('wx' in ch) r.wx = ch.wx;
    return r;
  }

  function normalize(c) {
    return Object.assign({ wdir: null, wspd: 0, gust: null, vis: 10000, ceiling: Infinity, clouds: [], wx: [], cb: false, tcu: false }, c);
  }

  // ---------------------------------------------------------------- METAR
  function parseMetar(raw, now) {
    if (!raw) return null;
    const txt = raw.replace(/\s+/g, ' ').trim();
    const main = txt.split(/ (TEMPO|BECMG|NOSIG) /)[0];
    const toks = main.split(' ');
    let i = 0;
    if (toks[i] === 'METAR' || toks[i] === 'SPECI') i++;
    const icao = toks[i++];
    const t = issueDate(toks[i++], now);
    const cond = normalize(parseElements(toks.slice(i)));
    if (cond.rvr) cond.vis = Math.min(cond.vis, cond.rvr);
    return { raw: txt, icao, time: t, cond };
  }

  // ---------------------------------------------------------------- TAF
  function parseTaf(raw, now) {
    if (!raw) return null;
    const txt = raw.replace(/\s+/g, ' ').trim();
    let toks = txt.split(' ');
    while (['TAF', 'AMD', 'COR'].includes(toks[0])) toks.shift();
    const icao = toks.shift();
    const issue = issueDate(toks[0], now);
    if (issue) toks.shift();
    const ref = issue || now || new Date();
    const vm = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(toks[0] || '');
    if (!vm) return { raw: txt, icao, error: 'Période de validité illisible' };
    toks.shift();
    const vFrom = dateFromDDHH(+vm[1], +vm[2], 0, ref), vTo = dateFromDDHH(+vm[3], +vm[4], 0, ref);

    // découpage en groupes
    const groups = [];
    let cur = { kind: 'BASE', toks: [] };
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      let m;
      if (/^(TX|TN)/.test(t) || /^(RMK|QNH)/.test(t)) { if (/^RMK/.test(t)) break; continue; }
      if ((m = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t))) {
        groups.push(cur); cur = { kind: 'FM', from: dateFromDDHH(+m[1], +m[2], +m[3], ref), toks: [] }; continue;
      }
      if (t === 'BECMG' || t === 'TEMPO' || /^PROB(30|40)$/.test(t)) {
        if (cur.kind.startsWith('PROB') && t === 'TEMPO' && !cur.from) { cur.kind += ' TEMPO'; continue; }
        groups.push(cur); cur = { kind: t, toks: [] };
        const p = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(toks[k + 1] || '');
        if (p) { cur.from = dateFromDDHH(+p[1], +p[2], 0, ref); cur.to = dateFromDDHH(+p[3], +p[4], 0, ref); k++; }
        continue;
      }
      if (!cur.from && cur.kind !== 'BASE' && cur.kind !== 'FM') {
        const p = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(t);
        if (p) { cur.from = dateFromDDHH(+p[1], +p[2], 0, ref); cur.to = dateFromDDHH(+p[3], +p[4], 0, ref); continue; }
      }
      cur.toks.push(t);
    }
    groups.push(cur);
    for (const g of groups) g.el = parseElements(g.toks);

    // évolution de l'état prévu (BASE / FM / BECMG) : segments [from,to) avec 1..n conditions possibles
    let segs = [{ from: vFrom, to: vTo, conds: [{ c: normalize(groups[0].el), src: 'BASE' }] }];
    const split = (t) => {
      const out = [];
      for (const s of segs) {
        if (t > s.from && t < s.to) { out.push({ from: s.from, to: t, conds: s.conds }); out.push({ from: t, to: s.to, conds: s.conds }); }
        else out.push(s);
      }
      segs = out;
    };
    const variations = [];
    for (const g of groups.slice(1)) {
      if (g.kind === 'FM' && g.from) {
        split(g.from);
        segs = segs.map(s => s.from >= g.from ? { from: s.from, to: s.to, conds: [{ c: normalize(g.el), src: 'FM' }] } : s);
      } else if (g.kind === 'BECMG' && g.from) {
        split(g.from); split(g.to);
        segs = segs.map(s => {
          if (s.from >= g.to) return { from: s.from, to: s.to, conds: s.conds.map(x => ({ c: merge(x.c, g.el), src: x.src })) };
          if (s.from >= g.from) return { from: s.from, to: s.to, conds: s.conds.concat(s.conds.map(x => ({ c: merge(x.c, g.el), src: 'BECMG' }))) };
          return s;
        });
      } else if (g.from) {
        variations.push({ kind: g.kind, from: g.from, to: g.to, el: g.el });
      }
    }
    return { raw: txt, icao, issue, from: vFrom, to: vTo, segs, variations };
  }

  // Toutes les conditions possibles sur [t1, t2)
  function conditionsInWindow(taf, t1, t2) {
    if (!taf || taf.error) return null;
    const out = [];
    if (t2 <= taf.from || t1 >= taf.to) return null;
    for (const s of taf.segs) {
      if (s.to <= t1 || s.from >= t2) continue;
      for (const x of s.conds) out.push({ c: x.c, src: x.src });
      for (const v of taf.variations) {
        if (v.to <= Math.max(t1, s.from) || v.from >= Math.min(t2, s.to)) continue;
        for (const x of s.conds) out.push({ c: merge(x.c, v.el), src: v.kind });
      }
    }
    const partial = t1 < taf.from || t2 > taf.to;
    return { list: out, partial };
  }

  // ---------------------------------------------------------------- vent
  function windComponents(c, qfu) {
    const sp = c.wspd || 0, g = c.gust || sp;
    if (c.wdir == null) return { xw: g, hw: -sp, xwMean: sp };
    const a = (c.wdir - qfu) * Math.PI / 180;
    return { xw: Math.round(Math.abs(g * Math.sin(a))), hw: Math.round(sp * Math.cos(a)), xwMean: Math.round(Math.abs(sp * Math.sin(a))) };
  }

  function approachesFor(icao, minima) {
    const t = (minima && minima.terrains && minima.terrains[icao]) || { pistes: [] };
    if (t.approches && t.approches.length) return { list: t.approches, hypothese: false };
    return { list: (t.pistes || []).map(q => ({ nom: 'ILS CAT I (hypothèse) QFU ' + String(q).padStart(3, '0'), qfu: q, type: 'B', dh: 200, rvr: 550 })), hypothese: true };
  }

  function requirement(app, role) {
    if (role === 'ALT') {
      if (app.type === 'B') return { ceil: app.dh + 200, vis: app.rvr + 800, txt: 'DA/H+200 ft, RVR+800 m' };
      return { ceil: app.dh + 400, vis: app.rvr + 1500, txt: (app.type === 'C' ? 'MDH' : 'DA/H ou MDA/H') + '+400 ft, VIS+1500 m' };
    }
    return { ceil: app.type === 'B' ? 0 : app.dh, vis: app.rvr, txt: app.type === 'B' ? 'RVR ≥ minima' : 'RVR ≥ minima, plafond ≥ MDH' };
  }

  function fmtCeil(c) { return c === Infinity ? 'pas de plafond' : c + ' ft'; }
  function fmtVis(v) { return v >= 10000 ? '≥10 km' : v + ' m'; }

  // Évalue une condition pour un rôle : meilleure approche utilisable
  function evalCond(c, role, apps, set) {
    let best = null;
    for (const a of apps) {
      const w = windComponents(c, a.qfu);
      const windOk = w.hw >= -set.maxTail && w.xw <= set.maxXw;
      const r = requirement(a, role);
      const met = c.vis >= r.vis && c.ceiling >= r.ceil;
      const marginV = c.vis - r.vis, marginC = c.ceiling - r.ceil;
      const score = (windOk ? 0 : 2) + (met ? 0 : 1);
      const cand = { app: a, w, windOk, req: r, met, marginV, marginC, score };
      const key = score * 1000 + (w.hw < 0 ? 100 : 0) + w.xw;
      cand.key = key;
      if (!best || key < best.key) best = cand;
    }
    if (!best) return { status: STATUS.NA, msgs: ['Aucune piste renseignée'] };
    const msgs = [];
    let st = STATUS.OK;
    if (!best.windOk) {
      st = STATUS.BAD;
      msgs.push(`Vent hors limites sur toutes les pistes (travers ${best.w.xw} kt / arrière ${Math.max(0, -best.w.hw)} kt)`);
    }
    if (!best.met) {
      if (role === 'DEP') { st = Math.max(st, STATUS.WARN); msgs.push('Sous les minima d\'atterrissage → dégagement au décollage nécessaire'); }
      else { st = STATUS.BAD; msgs.push(`Sous les minima (${best.req.txt} : plafond ${best.req.ceil} ft / ${best.req.vis} m requis)`); }
    } else {
      if (best.marginV < 500 || (best.req.ceil > 0 && best.marginC < 200)) { st = Math.max(st, STATUS.WARN); msgs.push('Marge faible sur les minima'); }
      else if (role !== 'ALT' && c.ceiling < best.app.dh + 200) { st = Math.max(st, STATUS.WARN); msgs.push(`Plafond ${c.ceiling} ft proche de la DA/H`); }
    }
    if (c.cb || (c.wx || []).some(x => x.includes('TS'))) { st = Math.max(st, STATUS.WARN); msgs.push('CB / orage'); }
    else if (c.tcu) { st = Math.max(st, STATUS.WARN); msgs.push('TCU'); }
    if ((c.wx || []).some(x => /FZ|SN|PL|GR|GS/.test(x))) { st = Math.max(st, STATUS.WARN); msgs.push('Précipitations givrantes / neige'); }
    if ((c.gust || 0) >= set.gustWarn) { st = Math.max(st, STATUS.WARN); msgs.push(`Rafales ${c.gust} kt`); }
    if (best.windOk && best.w.xw >= 0.8 * set.maxXw) { st = Math.max(st, STATUS.WARN); msgs.push(`Travers ${best.w.xw} kt proche de la limite`); }
    if (best.windOk && best.w.hw < 0) { msgs.push(`Arrière ${-best.w.hw} kt`); }
    return { status: st, best, msgs };
  }

  function describeCond(c) {
    const p = [];
    p.push(c.wdir == null ? `VRB${String(c.wspd).padStart(2, '0')}${c.gust ? 'G' + c.gust : ''}KT` : `${String(c.wdir).padStart(3, '0')}/${c.wspd}${c.gust ? 'G' + c.gust : ''} kt`);
    p.push(fmtVis(c.vis));
    if (c.wx && c.wx.length) p.push(c.wx.join(' '));
    p.push(c.ceiling === Infinity ? 'pas de plafond' : 'plafond ' + c.ceiling + ' ft');
    if (c.cb) p.push('CB'); else if (c.tcu) p.push('TCU');
    return p.join(', ');
  }

  // Analyse d'un rôle (DEP / DEST / ALT) pour un terrain sur un créneau
  function analyseRole(icao, role, t1, t2, wx, minima, set, now) {
    const tafRaw = wx.taf && wx.taf[icao];
    const metRaw = wx.metar && wx.metar[icao] && wx.metar[icao][0];
    const taf = parseTaf(tafRaw, now);
    const metar = parseMetar(metRaw, now);
    const appsInfo = approachesFor(icao, minima);
    const res = { icao, role, t1, t2, taf, metar, hypothese: appsInfo.hypothese };
    const cw = conditionsInWindow(taf, t1, t2);
    const list = cw ? cw.list.slice() : [];
    if (metar && metar.time && now && t1 - now < 1.5 * H && t2 > now) list.push({ c: metar.cond, src: 'METAR' });
    if (!list.length) {
      res.status = STATUS.NA;
      res.msgs = [taf ? 'Le TAF ne couvre pas ce créneau' : 'Pas de TAF disponible'];
      return res;
    }
    let worst = null;
    for (const x of list) {
      const e = evalCond(x.c, role, appsInfo.list, set);
      const sev = e.status * 1e6 - (e.best ? Math.min(e.best.marginV, 9999) + Math.min(e.best.marginC === Infinity ? 9999 : e.best.marginC, 9999) : 0) + (x.c.gust || x.c.wspd || 0);
      if (!worst || sev > worst.sev) worst = { sev, e, x };
    }
    // Agrégation de tous les dangers rencontrés sur le créneau
    const allMsgs = new Set();
    let st = STATUS.OK;
    let maxGust = 0, maxXw = 0;
    for (const x of list) {
      const e = evalCond(x.c, role, appsInfo.list, set); st = Math.max(st, e.status);
      e.msgs.forEach(m => { if (!/^Rafales|^Travers|^Arrière/.test(m)) allMsgs.add(m); });
      maxGust = Math.max(maxGust, x.c.gust || 0);
      if (e.best) maxXw = Math.max(maxXw, e.best.w.xw);
    }
    if (maxGust >= set.gustWarn) allMsgs.add(`Rafales jusqu'à ${maxGust} kt`);
    if (maxXw) allMsgs.add(`Travers max ${maxXw} kt` + (maxXw >= 0.8 * set.maxXw ? ' (proche limite)' : ''));
    res.status = st;
    res.worst = { cond: worst.x.c, src: worst.x.src, eval: worst.e, txt: describeCond(worst.x.c) };
    res.msgs = [...allMsgs];
    if (cw && cw.partial) { res.msgs.push('Créneau partiellement couvert par le TAF'); res.status = Math.max(res.status, STATUS.WARN); }
    return res;
  }

  // ---------------------------------------------------------------- NOTAM
  const NOTAM_KEEP = /^(MR|MX|MD|MT|MU|MW|IC|ID|IG|IL|IM|IN|IO|IS|IT|IU|IW|IX|IY|NA|NB|NC|ND|NF|NL|NM|NN|NO|NT|NV|PA|PD|PI|PU|PO|PM|PH|PL|FA|FU|FI|FF|FH|OB|OL|LA|LB|LC|LD|LE|LF|LG|LH|LI|LJ|LK|LL|LM|LP|LR|LS|LT|LU|LV|LW|LX|LY|LZ|CA|CE|CG|CL|CM|CP|CR|CS|CT|ST|SA|SE|SF|SL|SO|SP|SS|SC|WA|WB|WC|WD|WE|WF|WG|WH|WJ|WL|WM|WP|WR|WS|WT|WU|WV|WW|WZ|RA|RD|RP|RR|RT|AC|AD|AE|AF|AH|AL|AN|AO|AP|AR|AT|AU|AV|AX|AZ)/;
  const NOTAM_DROP = /^(MP|MK|MN|MY|FB|FC|FD|FE|FG|FJ|FL|FM|FO|FP|FS|FT|FW|FZ)/;

  function notamDate(s) {
    const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s || '');
    if (!m) return null;
    return new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  }

  function parseNotam(txt) {
    const t = txt.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const id = (/^([A-Z]\d{4}\/\d{2})/.exec(t) || [])[1] || '';
    const q = (/Q\)\s*[A-Z]{4}\/Q([A-Z]{2})([A-Z]{2})/.exec(t) || []);
    const b = notamDate((/B\)\s*(\d{10})/.exec(t) || [])[1]);
    const cRaw = (/C\)\s*(\S+)/.exec(t) || [])[1] || '';
    const perm = /PERM/.test(cRaw);
    const est = /EST/.test(cRaw);
    const c = perm ? null : notamDate(cRaw);
    const d = (/ D\)\s*(.*?)\s+E\)/.exec(t) || [])[1] || '';
    const e = (/ E\)\s*(.*?)(\s+F\)|\s+G\)|$)/.exec(t) || [])[1] || t;
    return { id, subj: q[1] || '', cond: q[2] || '', from: b, to: c, perm, est, sched: d, text: e, raw: t };
  }

  function notamSeverity(n) {
    const s = n.subj, k = n.cond, e = n.text;
    if ((s === 'FA' && /LC|LT|AP/.test(k)) || /AD CLSD|AERODROME CLOSED|AD CLOSED/.test(e)) return STATUS.BAD;
    if (s === 'MR' && /LC|LT/.test(k)) return STATUS.WARN;
    if (/^I[CDGLMNSTUWXY]/.test(s) && /AS|AU|CC|XX/.test(k)) return STATUS.WARN;
    if ((s === 'FU' || s === 'FI') && /AU|AH|AS|XX/.test(k)) return STATUS.WARN;
    if (/^P[AIDO]/.test(s) && /CH|AU|LT/.test(k)) return STATUS.WARN;
    if (/^N[ABCDFLMNOTV]/.test(s) && /AS|AU|XX/.test(k)) return STATUS.WARN;
    if (/ PPR|PPR /.test(e)) return STATUS.WARN;
    return STATUS.OK;
  }

  function relevantNotams(list, t1, t2) {
    const out = [];
    for (const raw of list || []) {
      const n = parseNotam(raw);
      if (!n.id) continue;
      if (n.cond === 'TT') continue;
      if (NOTAM_DROP.test(n.subj) || (n.subj && !NOTAM_KEEP.test(n.subj))) continue;
      if (n.from && n.from >= t2) { n.future = true; }
      if (n.to && n.to <= t1) continue;
      n.sev = notamSeverity(n);
      if (n.future && n.from - t2 > 7 * 24 * H) continue;
      out.push(n);
    }
    out.sort((a, b) => (b.sev - a.sev) || ((a.future ? 1 : 0) - (b.future ? 1 : 0)));
    return out;
  }

  // D) : renvoie false seulement si l'horaire est une simple liste de plages HHMM-HHMM sans recouvrement
  function scheduleOverlaps(sched, t1, t2) {
    if (!sched) return true;
    const s = sched.trim();
    if (!/^(DAILY\s+)?(\d{4}-\d{4}\s*)+$/.test(s)) return true;
    const ranges = s.replace('DAILY', '').trim().split(/\s+/).map(r => r.split('-').map(x => +x.slice(0, 2) * 60 + +x.slice(2)));
    for (let t = +t1; t < +t2; t += 5 * 60e3) {
      const d = new Date(t), m = d.getUTCHours() * 60 + d.getUTCMinutes();
      for (const [a, b] of ranges) if (a <= b ? (m >= a && m < b) : (m >= a || m < b)) return true;
    }
    return false;
  }

  function notamActive(n, t1, t2) {
    if (n.from && n.from >= t2) return false;
    if (n.to && n.to <= t1) return false;
    return scheduleOverlaps(n.sched, t1, t2);
  }

  // ---------------------------------------------------------------- briefing complet
  function hhmmToDate(dateStr, hhmm) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, m));
  }

  function flightWindows(f, dateStr) {
    const std = hhmmToDate(dateStr, f.std);
    let sta = hhmmToDate(dateStr, f.sta);
    if (sta < std) sta = new Date(+sta + 24 * H);
    return {
      std, sta,
      roles: [
        { icao: f.dpt, role: 'DEP', label: 'Départ', t1: std, t2: new Date(+std + 1 * H) },
        { icao: f.arv, role: 'DEST', label: 'Destination', t1: new Date(+sta - 1 * H), t2: new Date(+sta + 1 * H) },
        ...f.alt.map((a, i) => ({ icao: a, role: 'ALT', label: `Dégagement n°${i + 1}`, t1: new Date(+sta), t2: new Date(+sta + 2 * H) }))
      ]
    };
  }

  function buildBriefing(flights, dateStr, wx, minima, set, now) {
    now = now || new Date();
    const out = { flights: [], airports: {}, generatedAt: now };
    for (const f of flights) {
      const w = flightWindows(f, dateStr);
      const fr = { flight: f, std: w.std, sta: w.sta, roles: [] };
      for (const r of w.roles) {
        const a = analyseRole(r.icao, r.role, r.t1, r.t2, wx, minima, set, now);
        a.label = r.label; a.flight = f.vol;
        a.notamHits = [];
        for (const n of relevantNotams(wx.notam && wx.notam[r.icao], r.t1, r.t2)) {
          if (n.sev < STATUS.WARN || !notamActive(n, r.t1, r.t2)) continue;
          a.notamHits.push(n);
          if (a.status !== STATUS.NA) a.status = Math.max(a.status, n.sev);
          (a.msgs = a.msgs || []).unshift(`NOTAM ${n.id} : ${n.text.slice(0, 90)}${n.text.length > 90 ? '…' : ''}`);
        }
        fr.roles.push(a);
        const ap = out.airports[r.icao] = out.airports[r.icao] || { icao: r.icao, roles: [], t1: r.t1, t2: r.t2 };
        ap.roles.push(a);
        ap.t1 = new Date(Math.min(ap.t1, r.t1)); ap.t2 = new Date(Math.max(ap.t2, r.t2));
      }
      const dep = fr.roles.find(x => x.role === 'DEP'), dest = fr.roles.find(x => x.role === 'DEST');
      const alts = fr.roles.filter(x => x.role === 'ALT');
      const altOk = alts.filter(x => x.status === STATUS.OK || x.status === STATUS.WARN);
      let v = Math.max(dep.status, dest.status === STATUS.BAD ? STATUS.WARN : dest.status);
      const notes = [];
      if (dest.status === STATUS.BAD) notes.push('Destination sous les minima de planification : 2 dégagements requis');
      if (!altOk.length) { v = STATUS.BAD; notes.push('Aucun dégagement à destination utilisable'); }
      else if (altOk.length < alts.length) { v = Math.max(v, STATUS.WARN); notes.push(`Un seul dégagement utilisable (${altOk.map(x => x.icao).join(', ')})`); }
      if (dest.status === STATUS.BAD && altOk.length < 2) v = STATUS.BAD;
      if ([dep, dest].some(x => x.status === STATUS.NA)) v = Math.max(v, STATUS.WARN);
      fr.verdict = v; fr.notes = notes;
      out.flights.push(fr);
    }
    for (const icao in out.airports) {
      const ap = out.airports[icao];
      ap.notams = relevantNotams(wx.notam && wx.notam[icao], ap.t1, ap.t2);
      ap.status = Math.max(...ap.roles.map(r => r.status));
      ap.taf = ap.roles[0].taf; ap.metar = ap.roles[0].metar;
    }
    return out;
  }

  const api = { STATUS, scheduleOverlaps, notamActive, parseMetar, parseTaf, conditionsInWindow, windComponents, evalCond, analyseRole, relevantNotams, parseNotam, buildBriefing, flightWindows, describeCond, approachesFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(this);
