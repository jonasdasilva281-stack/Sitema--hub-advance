// Avisos por WhatsApp (CallMeBot): manhã = o que fazer hoje; noite = feito + por fazer.
// Chamado pelo Vercel Cron (vercel.json). Variáveis no Vercel: WHATSAPP_PHONE, CALLMEBOT_KEY, CRON_SECRET.
const SB_URL = process.env.SUPABASE_URL || 'https://jgrigjpnosogzqpbewdx.supabase.co';
const SB_KEY = process.env.SUPABASE_KEY || 'sb_publishable_zLh98VRheLdpxnak0PqxtQ_4x66kGs9';

const AREAS = { mentorias: 'Mentorias', solutions: 'Solutions' };
const FIM = ['fechado', 'perdido', 'standby'];

function hojeLisboa() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
}
const dia = (iso) => String(iso || '').slice(0, 10);
const da = (x) => (x && AREAS[x.area]) ? x.area : null; // sem área → aparece em todas? não: vai para "Geral"

function dadosArea(DB, area, hoje) {
  const doArea = (x) => (x.area || 'mentorias') === area;
  const nomeLead = (id) => ((DB.leads || []).find((l) => l.id === id) || {}).nome;

  const reunioes = (DB.reunioes || []).filter((r) => doArea(r) && r.data === hoje);
  const reuPend = reunioes.filter((r) => (r.estado || 'agendada') === 'agendada')
    .sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
  const reuFeitas = reunioes.filter((r) => r.estado === 'realizada');

  const tarefas = (DB.tarefas || []).filter(doArea);
  const tarPend = tarefas.filter((t) => !t.done && t.prazo && t.prazo <= hoje);
  const tarFeitas = tarefas.filter((t) => t.done && t.doneEm === hoje);

  const follow = (DB.leads || []).filter((l) => doArea(l) && !FIM.includes(l.etapa) && l.proxData && l.proxData <= hoje);

  const pagPend = (DB.pagamentos || []).filter((p) => doArea(p) && p.estado === 'Pendente' && p.data && p.data <= hoje);
  const pagFeitos = (DB.pagamentos || []).filter((p) => doArea(p) && p.estado === 'Pago' && p.data === hoje);

  const movidos = (DB.leads || []).filter((l) => doArea(l)).reduce((n, l) =>
    n + (l.interacoes || []).filter((i) => dia(i.data) === hoje && i.tipo === 'Mudança de etapa').length, 0);

  const lista = ((DB.prospecao || {}).lista || []).filter((p) => p.area === area);
  const metaDia = (((DB.prospecao || {}).meta) || {})[area] || (area === 'mentorias' ? 60 : 30);
  const abord = lista.reduce((s, p) => s + (p.msgs || []).filter((m) => typeof m.p === 'number' && m.d === hoje).length, 0);

  const camps = (DB.mktPlanos || []).filter((p) => doArea(p) && p.ini && p.ini <= hoje && (!p.fim || p.fim >= hoje));

  return { reuPend, reuFeitas, tarPend, tarFeitas, follow, pagPend, pagFeitos, movidos, abord, metaDia, camps, nomeLead };
}

const eur = (v) => '€' + Math.round(+v || 0).toLocaleString('pt-PT');
const lin = (arr, f, max = 6) => arr.slice(0, max).map((x) => '• ' + f(x)).join('\n') + (arr.length > max ? '\n• +' + (arr.length - max) + ' mais' : '');

function construir(DB, tipo, hoje) {
  const [y, m, d] = hoje.split('-');
  const cab = tipo === 'manha' ? '☀️ *Hoje, ' + d + '/' + m + '*' : '🌙 *Balanço de ' + d + '/' + m + '*';
  const blocos = [];
  for (const area of Object.keys(AREAS)) {
    const a = dadosArea(DB, area, hoje);
    const fazer = [];
    if (a.reuPend.length) fazer.push('*Reuniões (' + a.reuPend.length + ')*\n' + lin(a.reuPend, (r) => (r.hora ? r.hora + ' ' : '') + (r.who || r.tipo || 'Reunião')));
    if (a.tarPend.length) fazer.push('*Tarefas (' + a.tarPend.length + ')*\n' + lin(a.tarPend, (t) => t.nome + (t.prazo < hoje ? ' (atrasada)' : '')));
    if (a.follow.length) fazer.push('*Contactos a fazer (' + a.follow.length + ')*\n' + lin(a.follow, (l) => l.nome + (l.proxTipo ? ' · ' + l.proxTipo : '')));
    if (a.pagPend.length) fazer.push('*Pagamentos por receber (' + a.pagPend.length + ')*\n' + lin(a.pagPend, (p) => (p.cliente || '—') + ' ' + eur(p.valor)));
    if (a.abord < a.metaDia) fazer.push('*Prospeção:* ' + a.abord + '/' + a.metaDia + ' abordagens' + (tipo === 'manha' ? '' : ' hoje'));
    if (tipo === 'manha' && a.camps.length) fazer.push('*Campanhas ativas:* ' + a.camps.map((c) => c.nome).join(', '));

    const feito = [];
    if (a.reuFeitas.length) feito.push('Reuniões realizadas: ' + a.reuFeitas.length);
    if (a.tarFeitas.length) feito.push('Tarefas concluídas: ' + a.tarFeitas.length + '\n' + lin(a.tarFeitas, (t) => t.nome, 4));
    if (a.pagFeitos.length) feito.push('Pagamentos recebidos: ' + a.pagFeitos.length + ' (' + eur(a.pagFeitos.reduce((s, p) => s + (+p.valor || 0), 0)) + ')');
    if (a.movidos) feito.push('Leads que avançaram de etapa: ' + a.movidos);
    if (a.abord) feito.push('Abordagens feitas: ' + a.abord);

    let txt = '';
    if (tipo === 'manha') {
      if (fazer.length) txt = fazer.join('\n\n');
    } else {
      if (feito.length) txt += '✅ *Feito*\n' + feito.join('\n');
      if (fazer.length) txt += (txt ? '\n\n' : '') + '⏳ *Ficou por fazer*\n' + fazer.filter((x) => !x.startsWith('*Campanhas')).join('\n\n');
    }
    if (txt) blocos.push('▪️ *Hub ' + AREAS[area] + '*\n' + txt);
  }
  if (!blocos.length) blocos.push(tipo === 'manha' ? 'Nada marcado para hoje. Bom dia!' : 'Sem movimentos registados hoje.');
  return cab + '\n\n' + blocos.join('\n\n———\n\n');
}

async function carregar() {
  const r = await fetch(SB_URL + '/rest/v1/hub_advance_data?id=eq.1&select=data', {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, cache: 'no-store',
  });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  const j = await r.json();
  return (j[0] && j[0].data) || {};
}

async function enviar(texto) {
  const phone = process.env.WHATSAPP_PHONE, key = process.env.CALLMEBOT_KEY;
  if (!phone || !key) throw new Error('Faltam WHATSAPP_PHONE e CALLMEBOT_KEY no Vercel');
  const u = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(phone) + '&apikey=' + encodeURIComponent(key) + '&text=' + encodeURIComponent(texto);
  const r = await fetch(u);
  if (!r.ok) throw new Error('CallMeBot ' + r.status + ' ' + (await r.text()).slice(0, 120));
}

module.exports = async (req, res) => {
  try {
    const seg = process.env.CRON_SECRET;
    if (seg && req.headers.authorization !== 'Bearer ' + seg && req.query.chave !== seg) return res.status(401).json({ erro: 'sem permissão' });
    const tipo = req.query.tipo === 'noite' ? 'noite' : 'manha';
    const texto = construir(await carregar(), tipo, hojeLisboa());
    if (req.query.ver) return res.status(200).send(texto); // pré-visualização sem enviar
    await enviar(texto);
    res.status(200).json({ ok: true, tipo });
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
};
module.exports.construir = construir;
