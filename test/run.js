const E=require('../engine.js'),fs=require('fs');
const wx=JSON.parse(fs.readFileSync(__dirname+'/wx_fixture.json'));
const prog=JSON.parse(fs.readFileSync(__dirname+'/../data/programme.json'));
const minima=JSON.parse(fs.readFileSync(__dirname+'/../data/minima.json'));
const set={maxXw:25,maxTail:10,gustWarn:25};
const p=prog.rotations.find(r=>r.id==='SXB-LYS-SXB').paires[1];
const b=E.buildBriefing([p.aller,p.retour],'2026-11-20',wx,minima,set,new Date('2026-11-20T14:05:00Z'));
const S=['OK','WARN','BAD'];S[-1]='NA';
for(const f of b.flights){console.log('\n==',f.flight.vol,'verdict',S[f.verdict],f.notes);
 for(const r of f.roles) console.log(' ',r.icao,r.label,S[r.status],'| pire:',r.worst&&r.worst.src,r.worst&&r.worst.txt,'| app:',r.worst&&r.worst.eval.best&&r.worst.eval.best.app.qfu,'xw',r.worst&&r.worst.eval.best&&r.worst.eval.best.w.xw,'|',r.msgs.join('; '));}
for(const k in b.airports){const a=b.airports[k];console.log(k,'notams:',a.notams.map(n=>n.id+'/'+S[n.sev]+(n.future?'(fut)':'')).join(' '));}
