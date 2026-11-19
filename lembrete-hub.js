// Worker "lembrete-hub" (Cloudflare): avisos detalhados no WhatsApp (e Telegram, se configurado).
// 08h00 de Lisboa = o que fazer hoje | 20h00 de Lisboa = feito + ficou por fazer.
// Segredos (Settings > Variables and Secrets): WHATSAPP_PHONE, CALLMEBOT_KEY
//   opcionais: TELEGRAM_TOKEN, TELEGRAM_CHAT, CHAVE_TESTE (para testar no browser)
// Cron Triggers (UTC): 0 7 * * *, 0 8 * * *, 0 19 * * *, 0 20 * * *  (o código só envia à hora certa de Lisboa)
const SB_URL = 'https://jgrigjpnosogzqpbewdx.supabase.co';
const SB_KEY = 'sb_publishable_zLh98VRheLdpxnak0PqxtQ_4x66kGs9';

function hojeLisboa() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(new Date());
}
function horaLisboa() {
  return +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hour12: false }).format(new Date());
}
const AREAS = { mentorias: 'Mentorias', solutions: 'Solutions' };
const FIM = ['fechado', 'perdido', 'standby'];

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
  const r = await fetch(SB_URL + '/rest/v1/hub_advance_data?id=eq.1&select=data', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  const j = await r.json();
  return (j[0] && j[0].data) || {};
}

async function enviar(env, texto) {
  const falhas = [];
  if (env.WHATSAPP_PHONE && env.CALLMEBOT_KEY) {
    const r = await fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(env.WHATSAPP_PHONE) + '&apikey=' + encodeURIComponent(env.CALLMEBOT_KEY) + '&text=' + encodeURIComponent(texto));
    if (!r.ok) falhas.push('WhatsApp ' + r.status);
  } else falhas.push('faltam WHATSAPP_PHONE / CALLMEBOT_KEY');
  if (env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT) {
    const r = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT, text: texto.replace(/\*/g, '') }),
    });
    if (!r.ok) falhas.push('Telegram ' + r.status);
  }
  return falhas;
}

async function correr(env, tipo, forcar) {
  const h = horaLisboa();
  if (!forcar && !((tipo === 'manha' && h === 8) || (tipo === 'noite' && h === 20))) return 'fora de hora';
  const texto = construir(await carregar(), tipo, hojeLisboa());
  const f = await enviar(env, texto);
  return f.length ? 'erro: ' + f.join(', ') : 'enviado';
}

export default {
  async scheduled(event, env, ctx) {
    const h = horaLisboa();
    ctx.waitUntil(correr(env, h < 14 ? 'manha' : 'noite', false));
  },
  // teste no browser: https://SEU-WORKER.workers.dev/?tipo=noite&chave=CHAVE_TESTE  (&ver=1 só mostra, não envia)
  async fetch(req, env) {
    const u = new URL(req.url);
    if (!env.CHAVE_TESTE || u.searchParams.get('chave') !== env.CHAVE_TESTE) return new Response('lembrete-hub', { status: 200 });
    const tipo = u.searchParams.get('tipo') === 'noite' ? 'noite' : 'manha';
    if (u.searchParams.get('ver')) return new Response(construir(await carregar(), tipo, hojeLisboa()), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(await correr(env, tipo, true));
  },
};
