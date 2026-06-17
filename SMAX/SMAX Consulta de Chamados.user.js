// ==UserScript==
// @name         SMAX Consulta de Chamados - TJSP
// @namespace    https://github.com/rsalvessap/SMAX-TOOLS
// @version      2.26
// @description  Consulta de chamados SMAX com listas salvas, detecção de mudanças, exportação Word/Markdown/PDF/Relatório e painel redimensionável.
// @author       rsalvessap
// @updateURL    https://raw.githubusercontent.com/rsalvessap/SMAX-TOOLS/master/SMAX/SMAX%20Consulta%20de%20Chamados.user.js
// @downloadURL  https://raw.githubusercontent.com/rsalvessap/SMAX-TOOLS/master/SMAX/SMAX%20Consulta%20de%20Chamados.user.js
// @match        https://suporte.tjsp.jus.br/saw/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════
  // CONSTANTES
  // ══════════════════════════════════════════════════════════════════

  const LISTS_KEY      = 'smax_consulta_lists_v2';
  const LAST_QUERY_KEY = 'smax_consulta_last_query';
  const CONCURRENCY    = 4;

  const STATUS_LABELS = {
    RequestStatusNew:        'Novo',
    RequestStatusPending:    'Pendente',
    RequestStatusInProgress: 'Em Andamento',
    RequestStatusSuspended:  'Suspenso',
    RequestStatusReady:      'Pronto',
    RequestStatusComplete:   'Concluído',
    RequestStatusRejected:   'Rejeitado',
    RequestStatusCancelled:  'Cancelado',
  };
  const STATUS_COLORS = {
    RequestStatusNew:        '#60a5fa',
    RequestStatusPending:    '#facc15',
    RequestStatusInProgress: '#34d399',
    RequestStatusSuspended:  '#f97316',
    RequestStatusReady:      '#a78bfa',
    RequestStatusComplete:   '#6b7280',
    RequestStatusRejected:   '#f87171',
    RequestStatusCancelled:  '#6b7280',
  };
  const STATUS_EMOJI = {
    RequestStatusNew:        '🆕',
    RequestStatusPending:    '🟡',
    RequestStatusInProgress: '🔵',
    RequestStatusSuspended:  '⏸️',
    RequestStatusReady:      '🟣',
    RequestStatusComplete:   '✅',
    RequestStatusRejected:   '❌',
    RequestStatusCancelled:  '⛔',
  };
  const CLOSED_STATUSES = new Set(['RequestStatusComplete','RequestStatusRejected','RequestStatusCancelled']);

  const FIELD_DEFS = [
    { key:'status',       label:'Status',             group:'Básico',   tracked:true  },
    { key:'statusSCCD',   label:'Status Operacional', group:'Básico',   tracked:true  },
    { key:'createTime',   label:'Data de abertura',   group:'Básico',   tracked:false },
    { key:'lastUpdate',   label:'Últ. atualização',   group:'Básico',   tracked:true  },
    { key:'global',       label:'Global pai',         group:'Relações', tracked:true  },
    { key:'linkedCount',  label:'Vinculados',         group:'Relações', tracked:true  },
    { key:'requestedFor',      label:'Solicitado por',       group:'Relações', tracked:false },
    { key:'requestedForTitle', label:'Cargo do solicitante', group:'Relações', tracked:false },
    { key:'group',             label:'Grupo (GSE)',          group:'Relações', tracked:true  },
    { key:'assignee',     label:'Especialista',       group:'Relações', tracked:true  },
    { key:'description',  label:'Descrição',          group:'Conteúdo', tracked:false },
    { key:'solution',     label:'Solução',            group:'Conteúdo', tracked:false },
    { key:'comments',     label:'Comentários',        group:'Conteúdo', tracked:true  },
  ];
  const DEFAULT_FIELDS = ['status','statusSCCD','lastUpdate','global','linkedCount','requestedFor','group','comments'];

  // ══════════════════════════════════════════════════════════════════
  // STORAGE
  // ══════════════════════════════════════════════════════════════════

  const genId    = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
  const loadLists = () => { try { return JSON.parse(GM_getValue(LISTS_KEY,'[]')); } catch { return []; } };
  const saveLists = (ls) => GM_setValue(LISTS_KEY, JSON.stringify(ls));

  const makeNewList = (name, ids, fields) => ({
    id: genId(), name, ids, fields,
    createdAt: nowStr(), lastQuery: null,
  });

  // ══════════════════════════════════════════════════════════════════
  // UTILITÁRIOS
  // ══════════════════════════════════════════════════════════════════

  const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const nowStr = () => new Date().toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const todayStr = () => new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});

  const isToday = (ts) => {
    if (!ts) return false;
    const d = new Date(Number(ts));
    const n = new Date();
    return d.getDate()===n.getDate() && d.getMonth()===n.getMonth() && d.getFullYear()===n.getFullYear();
  };

  const fmtDate = (ts) => {
    if (!ts) return '—';
    return new Date(Number(ts)).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  };
  const fmtDateShort = (ts) => {
    if (!ts) return '—';
    return new Date(Number(ts)).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'});
  };
  const fmtSccd = (raw) => raw ? raw.replace(/_c$/i,'').replace(/([A-Z])/g,' $1').trim() : '—';

  const htmlToText = (html) => {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent||d.innerText||'').replace(/\s+/g,' ').trim();
  };

  const parseIds = (text) =>
    text.split(/[\n,;\s]+/).map(s=>s.trim()).filter(s=>/^\d+$/.test(s));

  const truncate = (s, n) => s.length > n ? s.slice(0,n).trim() + '…' : s;

  // ══════════════════════════════════════════════════════════════════
  // TENANT + API
  // ══════════════════════════════════════════════════════════════════

  const getTenantId = () => {
    const c = document.cookie.match(/TENANTID=(\d+)/i);
    if (c) return c[1];
    const p = new URLSearchParams(location.search);
    const u = p.get('TENANTID') || p.get('tenantid');
    if (u) return u;
    const h = (location.hash||'').match(/tenantid=(\d+)/i);
    if (h) return h[1];
    try { const s = sessionStorage.getItem('smaxTenantId')||localStorage.getItem('smaxTenantId'); if (s) return s; } catch {}
    return (window.SMAX_TENANT_ID||window.globalTenantId||'').toString();
  };

  const fetchTicket = async (id) => {
    const t = getTenantId();
    if (!t) throw new Error('Tenant ID não encontrado. Acesse um chamado primeiro.');
    const url = `/rest/${t}/ems/Request/${encodeURIComponent(id.trim())}?layout=FULL_LAYOUT,RELATION_LAYOUT.item&TENANTID=${t}`;
    const r = await fetch(url, { credentials:'same-origin' });
    if (!r.ok) { const b = await r.text().catch(()=>''); throw new Error(`HTTP ${r.status}${b?': '+b.slice(0,100):''}`); }
    return r.json();
  };

  // Conta chamados filhos buscando Requests cujo GlobalId_c aponta para este ticket.
  // Esta é a mesma abordagem do SMAX Toolkit (ResponseHUD fetchGlobalChildCounts).
  // NÃO usa RequestCausesRequest — esse endpoint retorna 403 em consulta direta.
  const fetchLinkedCount = async (id) => {
    const t = getTenantId();
    if (!t) return 0;
    const key = String(id || '').trim();
    if (!key) return 0;
    try {
      const filter = encodeURIComponent(`GlobalId_c='${key}'`);
      const url = `/rest/${t}/ems/Request?filter=${filter}&layout=Id,GlobalId_c&meta=totalCount&size=500&TENANTID=${t}`;
      const r = await fetch(url, { credentials:'same-origin' });
      if (!r.ok) return 0;
      const data = await r.json();
      // Prefere total_count do meta; fallback = contar entities retornadas
      return Number(
        data.meta?.total_count
        ?? data.meta?.totalCount
        ?? (Array.isArray(data.entities) ? data.entities.length : 0)
      );
    } catch { return 0; }
  };

  // Busca o cargo (Title) do solicitante pelo ID da pessoa
  // O campo Title é confirmado pelo atributo data-aid="title" no popover de pessoa do SMAX.
  const fetchPersonTitle = async (personId) => {
    if (!personId) return '';
    const t = getTenantId();
    if (!t) return '';
    try {
      // Inclui o campo Title explicitamente para garantir que venha no layout
      const url = `/rest/${t}/ems/Person/${encodeURIComponent(String(personId).trim())}?layout=FULL_LAYOUT&TENANTID=${t}`;
      const r = await fetch(url, { credentials:'same-origin' });
      if (!r.ok) return '';
      const data = await r.json();
      let ent = {};
      if (Array.isArray(data?.entities) && data.entities.length) ent = data.entities[0];
      else if (data?.entity_type) ent = data;
      const p = ent.properties || {};
      const rp = ent.related_properties || {};
      // data-aid="title" confirma que o campo API é "Title" na entidade Person
      return p.Title || rp.Title || p.JobTitle || p.Ucn || p.Role
        || p.EmployeeType || p.Position_c || p.Cargo_c || '';
    } catch { return ''; }
  };

  // ══════════════════════════════════════════════════════════════════
  // EXTRAÇÃO DE DADOS
  // ══════════════════════════════════════════════════════════════════

  const extractLinkedCount = (props, rel) => {
    // Try various possible API paths for linked/related request count
    for (const key of ['RequestCausesRequest','UpstreamRequest','DownstreamRequest','RelatedRequest']) {
      const v = rel[key];
      if (!v) continue;
      if (typeof v.count === 'number') return v.count;
      if (Array.isArray(v)) return v.length;
      if (Array.isArray(v.entities)) return v.entities.length;
    }
    if (props.RequestCausesRequestCount) return Number(props.RequestCausesRequestCount) || 0;
    return 0;
  };

  const extractTicketData = (payload, id, overrideLinkedCount = -1) => {
    let ent = {};
    if (Array.isArray(payload?.entities) && payload.entities.length) ent = payload.entities[0];
    else if (payload?.entity_type) ent = payload;
    const props = ent.properties        || {};
    const rel   = ent.related_properties || {};

    const ticketId    = String(props.Id || id || '');
    const subject     = (props.DisplayLabel||props.Subject||props.Title||'').trim();
    const statusRaw   = props.Status || '';
    const statusLabel = STATUS_LABELS[statusRaw] || statusRaw || '—';
    const statusColor = STATUS_COLORS[statusRaw] || '#6b7280';
    const statusEmoji = STATUS_EMOJI[statusRaw]  || '🔴';

    const statusSCCDRaw   = props.StatusSCCDSMAX_c || '';
    const statusSCCDLabel = fmtSccd(statusSCCDRaw);

    const createTime    = fmtDate(props.CreateTime);
    const lastUpdateTs  = Number(props.LastUpdateTime) || 0;
    const lastUpdateTime = fmtDate(lastUpdateTs);

    const globalRel  = rel.GlobalId_c || {};
    const globalId   = globalRel.Id   ? String(globalRel.Id)   : '';
    const globalName = globalRel.Name ? String(globalRel.Name) : '';
    const isGlobal   = !!globalId;

    // linkedCount: usa valor secundário (busca de filhos) se disponível
    const linkedCount = overrideLinkedCount >= 0 ? overrideLinkedCount : extractLinkedCount(props, rel);
    // isGlobalParent: este chamado É um global (pai). Detectado por filhos ou flag booleana na API.
    const isGlobalParent = linkedCount > 0
      || !!(props.IsGlobal_c || props.GlobalRequest_c || props.IsGlobalRequest_c || props.Global_c);

    const requestedFor = rel.RequestedForPerson?.DisplayLabel || rel.RequestedForPerson?.Name
      || String(props.RequestedForPerson||props.RequestedForDisplayLabel||'') || '—';
    // Cargo: tentativa direta no objeto da pessoa; se não vier, será preenchido por fetchPersonTitle
    const requestedForTitle = rel.RequestedForPerson?.Title || rel.RequestedForPerson?.JobTitle
      || rel.RequestedForPerson?.Ucn || rel.RequestedForPerson?.Role
      || props.RequestedForTitle_c || props.RequestedForJobTitle_c || '';
    const group    = rel.ExpertGroup?.Name || rel.AssignedToGroup?.Name || rel.ExpertGroup?.DisplayLabel || '—';
    const assignee = rel.ExpertAssignee?.Name || rel.ExpertAssignee?.DisplayLabel
      || (props.ExpertAssignee ? `#${props.ExpertAssignee}` : '—');

    const descHtml     = props.Description || '';
    const solutionHtml = props.Solution    || '';

    let lastComments = [];
    if (props.Comments) {
      try {
        const parsed = typeof props.Comments === 'string' ? JSON.parse(props.Comments) : props.Comments;
        const all = Array.isArray(parsed?.Comment) ? parsed.Comment : [];
        all.filter(c=>!c.IsSystem).sort((a,b)=>(Number(b.CreateTime)||0)-(Number(a.CreateTime)||0))
          .slice(0,5).forEach(c => lastComments.push({
            body    : c.CommentBody || '',
            bodyText: htmlToText(c.CommentBody||''),
            date    : fmtDateShort(c.CreateTime),
            from    : c.CommentFrom || '',
            privacy : c.PrivacyType || '',
            ts      : Number(c.CreateTime) || 0,
          }));
      } catch {}
    }

    return {
      ticketId, subject,
      statusRaw, statusLabel, statusColor, statusEmoji,
      statusSCCDRaw, statusSCCDLabel,
      createTime, lastUpdateTs, lastUpdateTime,
      isGlobal, globalId, globalName,
      linkedCount, isGlobalParent,
      requestedFor, requestedForTitle, group, assignee,
      descHtml, solutionHtml, lastComments,
    };
  };

  // ══════════════════════════════════════════════════════════════════
  // SNAPSHOT + DETECÇÃO DE MUDANÇAS
  // ══════════════════════════════════════════════════════════════════

  const makeSnapshot = (d) => ({
    statusRaw:       d.statusRaw,
    statusLabel:     d.statusLabel,
    statusSCCDRaw:   d.statusSCCDRaw,
    statusSCCDLabel: d.statusSCCDLabel,
    group:           d.group,
    assignee:        d.assignee,
    globalId:        d.globalId,
    linkedCount:     d.linkedCount,
    lastUpdateTs:    d.lastUpdateTs,
    lastUpdateTime:  d.lastUpdateTime,
    lastCommentTs:   d.lastComments.length ? Math.max(...d.lastComments.map(c=>c.ts||0)) : 0,
  });

  const detectChanges = (cur, prev, fields) => {
    if (!prev) return { isNew:true, hasChanges:true, changes:[] };
    const changes = [];
    if (fields.has('status')      && cur.statusRaw      !== prev.statusRaw)
      changes.push({ label:'Status',             from:prev.statusLabel,     to:cur.statusLabel });
    if (fields.has('statusSCCD')  && cur.statusSCCDRaw  !== prev.statusSCCDRaw)
      changes.push({ label:'Status Operacional', from:prev.statusSCCDLabel, to:cur.statusSCCDLabel });
    if (fields.has('group')       && cur.group          !== prev.group)
      changes.push({ label:'Grupo',              from:prev.group,           to:cur.group });
    if (fields.has('assignee')    && cur.assignee       !== prev.assignee)
      changes.push({ label:'Especialista',       from:prev.assignee,        to:cur.assignee });
    if (fields.has('global')      && cur.globalId       !== prev.globalId)
      changes.push({ label:'Global',             from:prev.globalId||'—',   to:cur.globalId||'—' });
    if (fields.has('linkedCount') && prev.linkedCount !== undefined && cur.linkedCount !== prev.linkedCount)
      changes.push({ label:'Vinculados', from:String(prev.linkedCount), to:String(cur.linkedCount), isLinkedChange:true });
    if (fields.has('comments')) {
      const prevMaxTs   = prev.lastCommentTs || 0;
      const newComments = cur.lastComments.filter(c=>(c.ts||0)>prevMaxTs);
      if (newComments.length) changes.push({ label:'Novos comentários', newComments });
    }
    if (fields.has('lastUpdate') && cur.lastUpdateTs !== prev.lastUpdateTs && !changes.length)
      changes.push({ label:'Última atualização', from:prev.lastUpdateTime, to:cur.lastUpdateTime });
    return { isNew:false, hasChanges:changes.length>0, changes };
  };

  // ══════════════════════════════════════════════════════════════════
  // CONCORRÊNCIA
  // ══════════════════════════════════════════════════════════════════

  const runConcurrent = async (items, fn, concurrency, onProgress) => {
    const results = new Array(items.length);
    let idx = 0;
    const worker = async () => {
      while (idx < items.length) {
        const i = idx++;
        try   { results[i] = { ok:true,  data:await fn(items[i]) }; }
        catch (e) { results[i] = { ok:false, error:e.message, id:items[i] }; }
        onProgress(results.filter(Boolean).length, items.length);
      }
    };
    await Promise.all(Array.from({length:concurrency}, worker));
    return results;
  };

  // ══════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO — MARKDOWN (simples)
  // ══════════════════════════════════════════════════════════════════

  const buildMarkdown = (results, ids, changes, listName) => {
    const isComparison = !!changes;
    const title = isComparison
      ? `Relatório de Atualização${listName ? ' — ' + listName : ''} — ${todayStr()}`
      : `Consulta de Chamados SMAX — ${todayStr()}`;

    const lines = [`# ${title}`, '', '---', ''];

    const mdTicket = (id, i) => {
      const r = results[i];
      if (!r) return [`❌ **${id}** — Sem resposta.`, '', '---', ''];
      if (!r.ok) return [`❌ **${id}** — Erro: ${r.error||'desconhecido'}`, '', '---', ''];
      const d = r.data;
      const chg = changes?.[id];
      const out = [];
      const globalPart = d.isGlobal ? ` — Global pai: #${d.globalId}` : '';
      const linkedPart = fields.has('linkedCount') && d.linkedCount ? ` · ${d.linkedCount} vinculados` : '';
      const ticketUrl = `https://suporte.tjsp.jus.br/saw/Request/${d.ticketId}/general`;
      out.push(`${d.statusEmoji} **[${d.ticketId}](${ticketUrl})**${d.subject ? ' — ' + d.subject : ''}${globalPart}${linkedPart}`);
      const metaParts = [];
      if (fields.has('status'))             metaParts.push(`**Status:** ${d.statusLabel}`);
      if (fields.has('statusSCCD'))         metaParts.push(`**Status Operacional:** ${d.statusSCCDLabel}`);
      if (fields.has('group'))              metaParts.push(`**GSE:** ${d.group}`);
      if (fields.has('assignee'))           metaParts.push(`**Especialista:** ${d.assignee}`);
      if (fields.has('requestedFor'))       metaParts.push(`**Solicitado por:** ${d.requestedFor}`);
      if (fields.has('requestedForTitle') && d.requestedForTitle) metaParts.push(`**Cargo:** ${d.requestedForTitle}`);
      if (fields.has('createTime'))         metaParts.push(`**Abertura:** ${d.createTime}`);
      if (fields.has('lastUpdate'))         metaParts.push(`**Última atualização:** ${d.lastUpdateTime}`);
      out.push(metaParts.join(' | '), '');
      if (isComparison && chg?.hasChanges && !chg.isNew) {
        const textChanges = chg.changes.filter(c=>!c.newComments);
        if (textChanges.length) {
          out.push('**Alterações:**');
          textChanges.forEach(c => out.push(`- ${c.label}: ${c.from} → ${c.to}`));
          out.push('');
        }
      }
      if (fields.has('comments')) {
        const commentsToShow = isComparison && chg?.hasChanges
          ? (chg.changes.find(c=>c.newComments)?.newComments || [])
          : [...d.lastComments].sort((a,b)=>a.ts-b.ts);
        if (!commentsToShow.length && !isComparison) out.push('*Sem comentários registrados.*', '');
        commentsToShow.forEach(c => {
          out.push(`> **${c.from||'Agente'} | ${c.date}**`);
          (c.bodyText||'').split(/\n/).map(l=>l.trim()).filter(Boolean).forEach(l=>out.push(`> ${l}`));
          if (!c.bodyText) out.push('> *(sem texto)*');
          out.push('');
        });
      }
      out.push('---', '');
      return out;
    };

    if (isComparison) {
      const groups = [
        { label:'## ✅ ENCERRADO',        filter:(id,i)=>{ const r=results[i]; return r?.ok && CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; } },
        { label:'## 🔄 COM ATUALIZAÇÃO',  filter:(id,i)=>{ const r=results[i]; return r?.ok && !CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; } },
        { label:'## ⏸️ SEM ATUALIZAÇÃO', filter:(id,i)=>{ const r=results[i]; return r?.ok && !changes[id]?.hasChanges; } },
      ];
      groups.forEach(g => {
        const ticketsInGroup = ids.filter((id,i)=>g.filter(id,i));
        if (!ticketsInGroup.length) return;
        lines.push(g.label, '');
        ticketsInGroup.forEach(id => mdTicket(id, ids.indexOf(id)).forEach(l => lines.push(l)));
      });
    } else {
      ids.forEach((id,i) => mdTicket(id,i).forEach(l=>lines.push(l)));
    }
    return lines.join('\n');
  };

  // ══════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO — RELATÓRIO (novo formato — replica o exemplo)
  // ══════════════════════════════════════════════════════════════════

  const buildRelatorioMd = (results, ids, changes, listName) => {
    const title = `Atualização do status de chamados${listName ? ' sobre ' + listName : ''} — ${todayStr()}`;
    const lines = [title, ''];

    const fmtLinked = (d, chg) => {
      const linkedChange = chg?.changes?.find(c=>c.isLinkedChange);
      return linkedChange ? `${d.linkedCount} (era ${linkedChange.from})` : String(d.linkedCount||0);
    };

    const ticketLines = (id, i) => {
      const r = results[i];
      if (!r?.ok) return [`❌ ${id} — ${r?.error||'Sem resposta.'}`, ''];
      const d = r.data;
      const chg = changes?.[id];
      const out = [];

      const isClosed = CLOSED_STATUSES.has(d.statusRaw);
      const isNew    = chg?.isNew;
      const lineEmoji = isNew ? '🆕' : (isClosed ? '🟢' : '🔴');
      const newMarker = isNew ? ' (NOVO)' : '';
      const globalPart = d.isGlobal && !d.isGlobalParent ? ` — filho de #${d.globalId}` : '';
      const ticketUrl = `https://suporte.tjsp.jus.br/saw/Request/${d.ticketId}/general`;
      out.push(`${lineEmoji} [${d.ticketId}](${ticketUrl})${newMarker}${d.subject ? ' — ' + d.subject : ''}${globalPart}`);

      const todayMark = isToday(d.lastUpdateTs) ? ' 🆕 HOJE' : '';
      const metaParts = [];
      const linkedChanged = chg?.changes?.find(c=>c.isLinkedChange);
      if (fields.has('linkedCount') && (d.linkedCount > 0 || linkedChanged)) metaParts.push(`Vinculados: ${fmtLinked(d, chg)}`);
      if (fields.has('statusSCCD'))  metaParts.push(`Status Operacional: ${d.statusSCCDLabel}`);
      if (fields.has('group'))       metaParts.push(`GSE: ${d.group}`);
      if (fields.has('lastUpdate'))  metaParts.push(`Última atualização: ${d.lastUpdateTime}${todayMark}`);
      out.push(metaParts.join(' | '));

      // Field changes (não-comentários, não-linkedCount — já está na metadata)
      if (changes && chg?.hasChanges && !chg.isNew) {
        const textChanges = chg.changes.filter(c=>!c.newComments && !c.isLinkedChange);
        textChanges.forEach(c => out.push(`  ↳ ${c.label}: ${c.from} → ${c.to}`));
      }

      // Comments
      if (fields.has('comments')) {
        let commentsToShow = [];
        if (changes && chg?.hasChanges) {
          commentsToShow = chg.changes.find(c=>c.newComments)?.newComments || [];
        } else {
          commentsToShow = [...d.lastComments].sort((a,b)=>a.ts-b.ts).slice(0,3);
        }
        if (!commentsToShow.length) {
          out.push('Nenhuma discussão registrada.');
        } else {
          out.push('');
          commentsToShow.forEach(c => {
            out.push(`${c.from||'Agente'} | ${c.date}`);
            const text = (c.bodyText||'').trim();
            if (text) out.push(text);
          });
        }
      }
      out.push('');
      return out;
    };

    if (changes) {
      const sections = [
        { label:'✅ ENCERRADO',       filter:(id,i)=>{ const r=results[i]; return r?.ok && CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; } },
        { label:'⏸️ SEM ATUALIZAÇÃO', filter:(id,i)=>{ const r=results[i]; return r?.ok && !changes[id]?.hasChanges; } },
        { label:'🆕 NOVA ATUALIZAÇÃO', filter:(id,i)=>{ const r=results[i]; return r?.ok && !CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; } },
      ];
      sections.forEach(s => {
        const inSection = ids.filter((id,i)=>s.filter(id,i));
        if (!inSection.length) return;
        lines.push(s.label, '');
        inSection.forEach(id => ticketLines(id, ids.indexOf(id)).forEach(l => lines.push(l)));
      });
    } else {
      ids.forEach((id,i) => ticketLines(id,i).forEach(l => lines.push(l)));
    }
    return lines.join('\n');
  };

  const buildRelatorioWord = (results, ids, changes, listName) => {
    const title = `Atualização do status de chamados${listName ? ' sobre ' + listName : ''} — ${todayStr()}`;

    const fmtLinked = (d, chg) => {
      const linkedChange = chg?.changes?.find(c=>c.isLinkedChange);
      return linkedChange ? `${d.linkedCount} (era ${linkedChange.from})` : String(d.linkedCount||0);
    };

    const ticketHtml = (id, i) => {
      const r = results[i];
      if (!r?.ok) return `<p style="color:#c00"><b>❌ ${esc(id)}</b> — ${esc(r?.error||'Sem resposta.')}</p>`;
      const d = r.data;
      const chg = changes?.[id];

      const isClosed  = CLOSED_STATUSES.has(d.statusRaw);
      const isNew     = chg?.isNew;
      const lineEmoji = isNew ? '🆕' : (isClosed ? '🟢' : '🔴');
      const newMarker = isNew ? ' <span style="color:#059669;font-weight:bold;">(NOVO)</span>' : '';
      const globalPart = d.isGlobal && !d.isGlobalParent
        ? ` <span style="color:#6b7280;font-weight:normal;font-size:10pt;">— filho de #${esc(d.globalId)}</span>` : '';

      const todayMark = isToday(d.lastUpdateTs)
        ? ' <span style="color:#f59e0b;font-size:8pt;font-weight:bold;">🆕 HOJE</span>' : '';
      const metaParts = [];
      if (fields.has('linkedCount')) metaParts.push(`Vinculados: <b>${esc(fmtLinked(d, chg))}</b>`);
      if (fields.has('statusSCCD'))  metaParts.push(`Status Operacional: <b>${esc(d.statusSCCDLabel)}</b>`);
      if (fields.has('group'))       metaParts.push(`GSE: <b>${esc(d.group)}</b>`);
      if (fields.has('lastUpdate'))  metaParts.push(`Última atualização: <b>${esc(d.lastUpdateTime)}</b>${todayMark}`);
      const metaLine = metaParts.join(' | ');

      // Field changes
      let changesHtml = '';
      if (changes && chg?.hasChanges && !chg.isNew) {
        const textChanges = chg.changes.filter(c=>!c.newComments && !c.isLinkedChange);
        if (textChanges.length) {
          changesHtml = textChanges.map(c=>
            `<div style="font-size:9pt;color:#78350f;margin-left:16pt;">↳ ${esc(c.label)}: <span style="color:#dc2626;">${esc(c.from)}</span> → <span style="color:#16a34a;font-weight:bold;">${esc(c.to)}</span></div>`
          ).join('');
        }
      }

      // Comments
      let commentsHtml = '';
      if (fields.has('comments')) {
        let commentsToShow = [];
        if (changes && chg?.hasChanges) {
          commentsToShow = chg.changes.find(c=>c.newComments)?.newComments || [];
        } else {
          commentsToShow = [...d.lastComments].sort((a,b)=>a.ts-b.ts).slice(0,3);
        }
        if (!commentsToShow.length) {
          commentsHtml = `<p style="margin:4pt 0;font-size:9pt;color:#9ca3af;font-style:italic;">Nenhuma discussão registrada.</p>`;
        } else {
          commentsHtml = commentsToShow.map(c=>`
            <div style="margin:6pt 0 0 8pt;border-left:3pt solid #3b82f6;padding-left:8pt;">
              <p style="margin:0;font-size:9pt;color:#374151;font-weight:bold;">${esc(c.from||'Agente')} | ${esc(c.date)}</p>
              <div style="margin-top:2pt;font-size:10pt;color:#111827;line-height:1.5;">${c.body||'<em style="color:#9ca3af">(sem texto)</em>'}</div>
            </div>`).join('');
        }
      }

      return `<div style="margin-bottom:14pt;padding-bottom:10pt;border-bottom:1pt solid #e5e7eb;"><a name="t-${esc(d.ticketId)}"></a>
        <p style="margin:0 0 2pt;font-size:13pt;font-weight:bold;color:#111827;">
          ${lineEmoji} <a href="https://suporte.tjsp.jus.br/saw/Request/${esc(d.ticketId)}/general" style="color:#1d4ed8;text-decoration:none;">${esc(d.ticketId)}</a>${newMarker}
          ${d.subject ? `<span style="font-size:11pt;font-weight:normal;color:#374151;"> — ${esc(d.subject)}</span>` : ''}${globalPart}
        </p>
        <p style="margin:0 0 4pt;font-size:9pt;color:#4b5563;">${metaLine}</p>
        ${changesHtml}
        ${commentsHtml}
      </div>`;
    };

    const sectionHtml = (heading, color, bg, border, ticketsInSection) => `
      <div style="margin:16pt 0 8pt;page-break-before:always;">
        <h2 style="color:${color};background:${bg};border-left:4pt solid ${border};padding:6pt 12pt;font-size:13pt;margin:0 0 10pt;">${heading} (${ticketsInSection.length})</h2>
        ${ticketsInSection.map(id => ticketHtml(id, ids.indexOf(id))).join('')}
      </div>`;

    let body = '';
    if (changes) {
      const encerrado = ids.filter((id,i)=>{ const r=results[i]; return r?.ok && CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; });
      const semAtu    = ids.filter((id,i)=>{ const r=results[i]; return r?.ok && !changes[id]?.hasChanges; });
      const comAtu    = ids.filter((id,i)=>{ const r=results[i]; return r?.ok && !CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; });
      if (encerrado.length) body += sectionHtml('✅ ENCERRADO',       '#14532d','#f0fdf4','#4ade80', encerrado);
      if (semAtu.length)    body += sectionHtml('⏸️ SEM ATUALIZAÇÃO', '#374151','#f9fafb','#d1d5db', semAtu);
      if (comAtu.length)    body += sectionHtml('🆕 NOVA ATUALIZAÇÃO','#1e3a5f','#eff6ff','#93c5fd', comAtu);
    } else {
      ids.forEach((id,i) => { body += ticketHtml(id, i); });
    }

    // Build summary stats
    const statusCount = {};
    ids.forEach((id,i) => {
      const r = results[i];
      if (!r?.ok) return;
      const lbl = r.data.statusLabel || 'Desconhecido';
      statusCount[lbl] = (statusCount[lbl]||0) + 1;
    });
    const okCount = ids.filter((_,i) => results[i]?.ok).length;
    const errCount = ids.length - okCount;
    const globalCount = ids.filter((_,i) => results[i]?.ok && results[i].data.isGlobalParent).length;

    let situacaoHtml = '';
    if (changes) {
      const cEnc = ids.filter((id,i) => results[i]?.ok && CLOSED_STATUSES.has(results[i].data.statusRaw) && changes[id]?.hasChanges).length;
      const cAtu = ids.filter((id,i) => results[i]?.ok && !CLOSED_STATUSES.has(results[i].data.statusRaw) && changes[id]?.hasChanges).length;
      const cSem = ids.filter((id,i) => results[i]?.ok && !changes[id]?.hasChanges).length;
      situacaoHtml = `
        <tr><td colspan="4" style="padding:6pt 10pt 2pt;font-weight:bold;font-size:9pt;color:#475569;border-top:1pt solid #e2e8f0;">Situação (vs. consulta anterior)</td></tr>
        <tr>
          <td style="padding:2pt 10pt;font-size:9pt;">Com atualização: <b>${cAtu}</b></td>
          <td style="padding:2pt 10pt;font-size:9pt;">Sem atualização: <b>${cSem}</b></td>
          <td style="padding:2pt 10pt;font-size:9pt;">Encerrados: <b>${cEnc}</b></td>
          <td style="padding:2pt 10pt;font-size:9pt;">${errCount ? `Erros: <b style="color:#dc2626;">${errCount}</b>` : ''}</td>
        </tr>`;
    }

    const statusCells = Object.entries(statusCount).map(([lbl,n]) => `<td style="padding:2pt 10pt;font-size:9pt;">${esc(lbl)}: <b>${n}</b></td>`);
    const statusRows = [];
    for (let i = 0; i < statusCells.length; i += 4) {
      statusRows.push(`<tr>${statusCells.slice(i, i+4).join('')}</tr>`);
    }

    const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;margin:0 0 14pt;background:#f8fafc;border:1pt solid #e2e8f0;border-radius:4pt;">
      <tr><td colspan="4" style="padding:6pt 10pt 2pt;font-weight:bold;font-size:9pt;color:#475569;">Por status</td></tr>
      ${statusRows.join('')}
      <tr><td colspan="4" style="padding:2pt 10pt;font-size:9pt;color:#6b7280;">Globais (pai): <b>${globalCount}</b></td></tr>
      ${situacaoHtml}
    </table>`;

    // Build TOC
    let tocHtml = '<div style="margin:0 0 18pt;"><h2 style="color:#1e3a5f;font-size:13pt;margin:0 0 8pt;">📑 Índice</h2>';

    if (changes) {
      const tocSections = [
        { label:'✅ Encerrado', items: ids.filter((id,i)=>{ const r=results[i]; return r?.ok && CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; }) },
        { label:'⏸️ Sem atualização', items: ids.filter((id,i)=>{ const r=results[i]; return r?.ok && !changes[id]?.hasChanges; }) },
        { label:'🆕 Nova atualização', items: ids.filter((id,i)=>{ const r=results[i]; return r?.ok && !CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; }) },
      ];
      tocSections.forEach(s => {
        if (!s.items.length) return;
        tocHtml += `<p style="margin:8pt 0 2pt;font-size:10pt;font-weight:bold;color:#374151;">${s.label} (${s.items.length})</p>`;
        s.items.forEach(id => {
          const idx = ids.indexOf(id);
          const r = results[idx];
          const subj = r?.ok ? r.data.subject : '';
          tocHtml += `<p style="margin:0 0 1pt;font-size:9pt;padding-left:12pt;"><a href="#t-${esc(id)}" style="color:#1d4ed8;text-decoration:none;">#${esc(id)}</a>${subj ? ` — ${esc(truncate(subj,60))}` : ''}</p>`;
        });
      });
    } else {
      ids.forEach((id,i) => {
        const r = results[i];
        const subj = r?.ok ? r.data.subject : '';
        const emoji = r?.ok ? r.data.statusEmoji : '❌';
        tocHtml += `<p style="margin:0 0 1pt;font-size:9pt;"><a href="#t-${esc(id)}" style="color:#1d4ed8;text-decoration:none;">${emoji} #${esc(id)}</a>${subj ? ` — ${esc(truncate(subj,60))}` : ''}</p>`;
      });
    }
    tocHtml += '</div>';

    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
    <head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;color:#111827;margin:2cm;}p{margin:0 0 4pt;line-height:1.5;}img{max-width:100%;}table{border-collapse:collapse;}@page{@bottom-center{content:"Página " counter(page);font-size:8pt;color:#6b7280;}}</style>
    </head><body>
    <h1 style="color:#1e3a5f;font-size:17pt;margin:0 0 4pt;">${esc(title)}</h1>
    <p style="color:#6b7280;font-size:9pt;margin:0 0 14pt;">${ids.length} chamado${ids.length!==1?'s':''}</p>
    <hr style="border:none;border-top:2pt solid #1d4ed8;margin:0 0 16pt;">
    ${summaryHtml}
    ${tocHtml}
    ${body}</body></html>`;
  };

  // ══════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO — WORD (simples, original)
  // ══════════════════════════════════════════════════════════════════

  const buildWordHtml = (results, ids, changes, listName) => {
    const isComparison = !!changes;
    const title = isComparison
      ? `Relatório de Atualização${listName ? ' — ' + listName : ''}`
      : 'Consulta de Chamados SMAX';

    const ticketHtml = (id, i) => {
      const r = results[i];
      if (!r||!r.ok) return `<p style="color:#c00"><b>❌ ${esc(id)}</b> — ${esc(r?.error||'Sem resposta.')}</p><hr>`;
      const d = r.data;
      const chg = changes?.[id];

      const globalInfo = d.isGlobalParent
        ? `<span style="color:#1d4ed8;font-weight:bold;"> — 🌐 Global</span>` : (d.isGlobal
        ? `<span style="color:#9ca3af;font-size:10pt;"> — filho de #${d.globalId}</span>` : '');

      const linkedInfo = fields.has('linkedCount') && d.linkedCount > 0
        ? ` <span style="color:#7c3aed;font-size:9pt;">(${d.linkedCount} vinculados)</span>` : '';

      let changesBlock = '';
      if (isComparison && chg?.hasChanges && !chg.isNew) {
        const textChanges = chg.changes.filter(c=>!c.newComments);
        if (textChanges.length) {
          changesBlock = `<div style="background:#fef9c3;border:1pt solid #fde047;border-radius:4pt;padding:6pt 10pt;margin:6pt 0;">
            <b style="font-size:9pt;color:#854d0e;">Alterações detectadas:</b><ul style="margin:4pt 0;padding-left:16pt;">
            ${textChanges.map(c=>`<li style="font-size:9pt;color:#713f12;">${esc(c.label)}: <span style="color:#9a3412;">${esc(c.from)}</span> → <b>${esc(c.to)}</b></li>`).join('')}
            </ul></div>`;
        }
      }

      let commentsToShow = [];
      if (fields.has('comments')) {
        if (isComparison && chg?.hasChanges)
          commentsToShow = chg.changes.find(c=>c.newComments)?.newComments || [];
        else
          commentsToShow = [...d.lastComments].sort((a,b)=>a.ts-b.ts);
      }

      const commentsBlock = !commentsToShow.length ? ''
        : commentsToShow.map(c=>`
            <table style="border-left:3pt solid #3b82f6;margin:5pt 0 5pt 10pt;width:94%;" cellpadding="0" cellspacing="0"><tr><td style="padding:4pt 10pt;">
              <p style="margin:0;font-size:9pt;color:#555;"><b>${esc(c.from||'Agente')}</b> &nbsp;|&nbsp; ${esc(c.date)} <span style="color:#7c3aed;font-size:8pt;">${esc(c.privacy)}</span></p>
              <div style="margin-top:3pt;font-size:10pt;color:#1e293b;">${c.body||'<em>(sem texto)</em>'}</div>
            </td></tr></table>`).join('');

      const metaRows = [];
      const meta1 = [], meta2 = [];
      if (fields.has('status'))       meta1.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Status</b><br>${esc(d.statusLabel)}</td>`);
      if (fields.has('statusSCCD'))   meta1.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Status Operacional</b><br>${esc(d.statusSCCDLabel)}</td>`);
      if (fields.has('linkedCount'))  meta1.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Vinculados</b><br>${d.linkedCount||0}</td>`);
      if (fields.has('group'))        meta1.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>GSE</b><br>${esc(d.group)}</td>`);
      if (fields.has('assignee'))     meta1.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Especialista</b><br>${esc(d.assignee)}</td>`);
      if (fields.has('requestedFor'))       meta2.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Solicitado por</b><br>${esc(d.requestedFor)}</td>`);
      if (fields.has('requestedForTitle') && d.requestedForTitle) meta2.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Cargo</b><br>${esc(d.requestedForTitle)}</td>`);
      if (fields.has('createTime'))   meta2.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Abertura</b><br>${esc(d.createTime)}</td>`);
      if (fields.has('lastUpdate'))   meta2.push(`<td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Última atualização</b><br>${esc(d.lastUpdateTime)}</td>`);
      if (meta1.length) metaRows.push(`<tr style="background:#f1f5f9;">${meta1.join('')}</tr>`);
      if (meta2.length) metaRows.push(`<tr>${meta2.join('')}</tr>`);
      const metaTable = metaRows.length
        ? `<table style="width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:8pt;" cellpadding="3" cellspacing="0">${metaRows.join('')}</table>` : '';

      const descBlock = fields.has('description') && d.descHtml
        ? `<p style="margin:5pt 0 2pt;font-size:9pt;font-weight:bold;color:#475569;">DESCRIÇÃO</p>
           <div style="background:#f8fafc;border:1pt solid #e2e8f0;border-radius:4pt;padding:7pt 10pt;font-size:10pt;color:#1e293b;">${d.descHtml}</div>` : '';
      const solBlock = fields.has('solution') && d.solutionHtml
        ? `<p style="margin:5pt 0 2pt;font-size:9pt;font-weight:bold;color:#475569;">SOLUÇÃO</p>
           <div style="background:#f0fdf4;border:1pt solid #bbf7d0;border-radius:4pt;padding:7pt 10pt;font-size:10pt;color:#14532d;">${d.solutionHtml}</div>` : '';
      const comLabel = fields.has('comments') && commentsBlock
        ? `<p style="margin:5pt 0 2pt;font-size:9pt;font-weight:bold;color:#475569;">${isComparison && chg?.hasChanges ? 'NOVOS COMENTÁRIOS' : 'ÚLTIMOS COMENTÁRIOS'}</p>` : '';

      return `<div style="margin-bottom:16pt;page-break-inside:avoid;"><a name="t-${esc(d.ticketId)}"></a>
        <p style="margin:0 0 4pt;font-size:13pt;font-weight:bold;color:#1e3a5f;">
          ${d.statusEmoji} <a href="https://suporte.tjsp.jus.br/saw/Request/${esc(d.ticketId)}/general" style="color:#1d4ed8;text-decoration:none;">#${d.ticketId}</a>
          ${d.subject ? `<span style="color:#374151;font-size:11pt;font-weight:normal;"> — ${esc(d.subject)}</span>` : ''}${globalInfo}${linkedInfo}
        </p>
        ${metaTable}${changesBlock}${descBlock}${solBlock}${comLabel}${commentsBlock}
        <hr style="border:none;border-top:1pt solid #e2e8f0;margin:10pt 0 0;">
      </div>`;
    };

    let body = '';
    if (isComparison) {
      const sections = [
        { heading:'✅ ENCERRADO',        color:'#14532d', bg:'#f0fdf4', border:'#4ade80',
          filter:(id,i)=>{ const r=results[i]; return r?.ok && CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; } },
        { heading:'🔄 COM ATUALIZAÇÃO',  color:'#1e3a5f', bg:'#eff6ff', border:'#93c5fd',
          filter:(id,i)=>{ const r=results[i]; return r?.ok && !CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; } },
        { heading:'⏸️ SEM ATUALIZAÇÃO', color:'#374151', bg:'#f9fafb', border:'#d1d5db',
          filter:(id,i)=>{ const r=results[i]; return r?.ok && !changes[id]?.hasChanges; } },
      ];
      sections.forEach(s => {
        const inSection = ids.filter((id,i)=>s.filter(id,i));
        if (!inSection.length) return;
        body += `<h2 style="color:${s.color};background:${s.bg};border-left:4pt solid ${s.border};padding:8pt 12pt;margin:16pt 0 10pt;font-size:13pt;page-break-before:always;">${s.heading} (${inSection.length})</h2>`;
        inSection.forEach(id => { body += ticketHtml(id, ids.indexOf(id)); });
      });
    } else {
      ids.forEach((id,i) => { body += ticketHtml(id,i); });
    }

    // Build summary stats
    const statusCount = {};
    ids.forEach((id,i) => {
      const r = results[i];
      if (!r?.ok) return;
      const lbl = r.data.statusLabel || 'Desconhecido';
      statusCount[lbl] = (statusCount[lbl]||0) + 1;
    });
    const okCount = ids.filter((_,i) => results[i]?.ok).length;
    const errCount = ids.length - okCount;
    const globalCount = ids.filter((_,i) => results[i]?.ok && results[i].data.isGlobalParent).length;

    let situacaoHtml = '';
    if (changes) {
      const cEnc = ids.filter((id,i) => results[i]?.ok && CLOSED_STATUSES.has(results[i].data.statusRaw) && changes[id]?.hasChanges).length;
      const cAtu = ids.filter((id,i) => results[i]?.ok && !CLOSED_STATUSES.has(results[i].data.statusRaw) && changes[id]?.hasChanges).length;
      const cSem = ids.filter((id,i) => results[i]?.ok && !changes[id]?.hasChanges).length;
      situacaoHtml = `
        <tr><td colspan="4" style="padding:6pt 10pt 2pt;font-weight:bold;font-size:9pt;color:#475569;border-top:1pt solid #e2e8f0;">Situação (vs. consulta anterior)</td></tr>
        <tr>
          <td style="padding:2pt 10pt;font-size:9pt;">Com atualização: <b>${cAtu}</b></td>
          <td style="padding:2pt 10pt;font-size:9pt;">Sem atualização: <b>${cSem}</b></td>
          <td style="padding:2pt 10pt;font-size:9pt;">Encerrados: <b>${cEnc}</b></td>
          <td style="padding:2pt 10pt;font-size:9pt;">${errCount ? `Erros: <b style="color:#dc2626;">${errCount}</b>` : ''}</td>
        </tr>`;
    }

    const statusCells = Object.entries(statusCount).map(([lbl,n]) => `<td style="padding:2pt 10pt;font-size:9pt;">${esc(lbl)}: <b>${n}</b></td>`);
    const statusRows = [];
    for (let i = 0; i < statusCells.length; i += 4) {
      statusRows.push(`<tr>${statusCells.slice(i, i+4).join('')}</tr>`);
    }

    const summaryHtml = `
    <table style="width:100%;border-collapse:collapse;margin:0 0 14pt;background:#f8fafc;border:1pt solid #e2e8f0;border-radius:4pt;">
      <tr><td colspan="4" style="padding:6pt 10pt 2pt;font-weight:bold;font-size:9pt;color:#475569;">Por status</td></tr>
      ${statusRows.join('')}
      <tr><td colspan="4" style="padding:2pt 10pt;font-size:9pt;color:#6b7280;">Globais (pai): <b>${globalCount}</b></td></tr>
      ${situacaoHtml}
    </table>`;

    // Build TOC
    let tocHtml = '<div style="margin:0 0 18pt;"><h2 style="color:#1e3a5f;font-size:13pt;margin:0 0 8pt;">📑 Índice</h2>';

    if (changes) {
      const tocSections = [
        { label:'✅ Encerrado', items: ids.filter((id,i)=>{ const r=results[i]; return r?.ok && CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; }) },
        { label:'⏸️ Sem atualização', items: ids.filter((id,i)=>{ const r=results[i]; return r?.ok && !changes[id]?.hasChanges; }) },
        { label:'🆕 Nova atualização', items: ids.filter((id,i)=>{ const r=results[i]; return r?.ok && !CLOSED_STATUSES.has(r.data.statusRaw) && changes[id]?.hasChanges; }) },
      ];
      tocSections.forEach(s => {
        if (!s.items.length) return;
        tocHtml += `<p style="margin:8pt 0 2pt;font-size:10pt;font-weight:bold;color:#374151;">${s.label} (${s.items.length})</p>`;
        s.items.forEach(id => {
          const idx = ids.indexOf(id);
          const r = results[idx];
          const subj = r?.ok ? r.data.subject : '';
          tocHtml += `<p style="margin:0 0 1pt;font-size:9pt;padding-left:12pt;"><a href="#t-${esc(id)}" style="color:#1d4ed8;text-decoration:none;">#${esc(id)}</a>${subj ? ` — ${esc(truncate(subj,60))}` : ''}</p>`;
        });
      });
    } else {
      ids.forEach((id,i) => {
        const r = results[i];
        const subj = r?.ok ? r.data.subject : '';
        const emoji = r?.ok ? r.data.statusEmoji : '❌';
        tocHtml += `<p style="margin:0 0 1pt;font-size:9pt;"><a href="#t-${esc(id)}" style="color:#1d4ed8;text-decoration:none;">${emoji} #${esc(id)}</a>${subj ? ` — ${esc(truncate(subj,60))}` : ''}</p>`;
      });
    }
    tocHtml += '</div>';

    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
    <head><meta charset="utf-8"><title>${esc(title)} — ${todayStr()}</title>
    <style>body{font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;color:#1e293b;margin:2cm;}p{margin:0 0 4pt;line-height:1.5;}img{max-width:100%;height:auto;}table{border-collapse:collapse;}hr{border:none;border-top:1pt solid #e2e8f0;}@page{@bottom-center{content:"Página " counter(page);font-size:8pt;color:#6b7280;}}</style>
    </head><body>
    <h1 style="color:#1e3a5f;font-size:18pt;margin:0 0 4pt;">${esc(title)}</h1>
    <p style="color:#64748b;font-size:10pt;margin:0 0 18pt;">${todayStr()} · ${ids.length} chamado${ids.length!==1?'s':''}</p>
    <hr style="border:none;border-top:2pt solid #1d4ed8;margin:0 0 18pt;">
    ${summaryHtml}
    ${tocHtml}
    ${body}</body></html>`;
  };

  // ══════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO — EXCEL (.xls — tabela HTML)
  // ══════════════════════════════════════════════════════════════════

  const buildExcelHtml = (results, ids) => {
    const cols = ['ID','Título','Status','Status Operacional','É Global','Vinculados',
      'Global Pai','GSE','Especialista','Solicitado por','Cargo',
      'Abertura','Últ. Atualização'];
    const th = cols.map(c=>`<th style="background:#1e3a5f;color:#fff;padding:5px 10px;white-space:nowrap;font-size:10pt;">${esc(c)}</th>`).join('');
    const rows = ids.map((id,i) => {
      const r = results[i];
      if (!r?.ok) return `<tr><td>${esc(id)}</td><td colspan="${cols.length-1}" style="color:#c00;">ERRO: ${esc(r?.error||'')}</td></tr>`;
      const d = r.data;
      const bg = CLOSED_STATUSES.has(d.statusRaw) ? '#f0fdf4' : i%2===0 ? '#fff' : '#f8fafc';
      const cells = [
        d.ticketId, d.subject, d.statusLabel, d.statusSCCDLabel,
        d.isGlobalParent ? 'Sim' : 'Não', d.linkedCount||0,
        d.globalId||'', d.group, d.assignee,
        d.requestedFor, d.requestedForTitle||'',
        d.createTime, d.lastUpdateTime,
      ].map(v => `<td style="padding:4px 8px;font-size:10pt;border:1px solid #e2e8f0;">${esc(String(v??''))}</td>`).join('');
      return `<tr style="background:${bg};">${cells}</tr>`;
    });
    return `<html><head><meta charset="utf-8">
    <style>table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;}
    th{border:1px solid #1e3a5f;text-align:left;}
    tr:hover td{background:#eff6ff!important;}</style>
    </head><body>
    <h2 style="font-family:Calibri,Arial,sans-serif;color:#1e3a5f;">Consulta de Chamados SMAX — ${todayStr()}</h2>
    <table><thead><tr>${th}</tr></thead><tbody>${rows.join('')}</tbody></table>
    </body></html>`;
  };

  const buildExcelRelatorioHtml = (results, ids, changes) => {
    const cols = ['ID','Título','Status','Status Operacional','É Global','Vinculados',
      'GSE','Últ. Atualização','Situação','Alterações'];
    const th = cols.map(c=>`<th style="background:#1e3a5f;color:#fff;padding:5px 10px;white-space:nowrap;font-size:10pt;">${esc(c)}</th>`).join('');
    const rows = ids.map((id,i) => {
      const r = results[i];
      if (!r?.ok) return `<tr><td>${esc(id)}</td><td colspan="${cols.length-1}" style="color:#c00;">ERRO: ${esc(r?.error||'')}</td></tr>`;
      const d = r.data;
      const chg = changes?.[id];
      const isClosed = CLOSED_STATUSES.has(d.statusRaw);
      const situacao = !chg ? '—' : chg.isNew ? 'Novo' : (isClosed && chg.hasChanges) ? 'Encerrado' : chg.hasChanges ? 'Atualizado' : 'Sem mudança';
      const bgMap = { 'Encerrado':'#f0fdf4', 'Atualizado':'#eff6ff', 'Novo':'#fefce8', 'Sem mudança':'#f9fafb' };
      const bg = bgMap[situacao] || (i%2===0 ? '#fff' : '#f8fafc');
      const alteracoes = chg?.changes?.filter(c=>!c.newComments).map(c=>`${c.label}: ${c.from}→${c.to}`).join('; ') || '';
      const linkedChange = chg?.changes?.find(c=>c.isLinkedChange);
      const linkedStr = linkedChange ? `${d.linkedCount} (era ${linkedChange.from})` : String(d.linkedCount||0);
      const cells = [
        d.ticketId, d.subject, d.statusLabel, d.statusSCCDLabel,
        d.isGlobalParent ? 'Sim' : 'Não', linkedStr,
        d.group, d.lastUpdateTime, situacao, alteracoes,
      ].map(v => `<td style="padding:4px 8px;font-size:10pt;border:1px solid #e2e8f0;">${esc(String(v??''))}</td>`).join('');
      return `<tr style="background:${bg};">${cells}</tr>`;
    });
    return `<html><head><meta charset="utf-8">
    <style>table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;}
    th{border:1px solid #1e3a5f;text-align:left;}
    tr:hover td{background:#eff6ff!important;}</style>
    </head><body>
    <h2 style="font-family:Calibri,Arial,sans-serif;color:#1e3a5f;">Relatório de Atualização — ${todayStr()}</h2>
    <table><thead><tr>${th}</tr></thead><tbody>${rows.join('')}</tbody></table>
    </body></html>`;
  };

  // ══════════════════════════════════════════════════════════════════
  // EXPORTAÇÃO — PDF (print)
  // ══════════════════════════════════════════════════════════════════

  const printAsPdf = (htmlContent) => {
    const win = window.open('','_blank','width=900,height=700');
    if (!win) { alert('Popup bloqueado. Permita popups para este site.'); return; }
    win.document.write(htmlContent.replace('</head>','<style>@media print{body{margin:1cm;}*{-webkit-print-color-adjust:exact;}@page{@bottom-center{content:"Página " counter(page);font-size:8pt;color:#6b7280;}}}</style></head>'));
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  };

  // ══════════════════════════════════════════════════════════════════
  // DOWNLOAD
  // ══════════════════════════════════════════════════════════════════

  const downloadFile = (content, filename, mime) => {
    const blob = new Blob(['\uFEFF'+content],{type:mime+';charset=utf-8;'});
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'),{href:url,download:filename}).click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  };

  // ══════════════════════════════════════════════════════════════════
  // CSS
  // ══════════════════════════════════════════════════════════════════

  GM_addStyle(`
    #sqc-topbar-btn {
      position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483640;
      padding:5px 18px;border:none;border-radius:20px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);
      color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      box-shadow:0 2px 12px rgba(59,130,246,.5);transition:box-shadow .15s,transform .15s;
    }
    #sqc-topbar-btn:hover{box-shadow:0 4px 20px rgba(59,130,246,.65);transform:translateX(-50%) scale(1.04);}

    #sqc-panel{position:fixed;inset:0;z-index:2147483639;background:#0d1117;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#e5e7eb;}

    /* Header */
    #sqc-header{display:flex;align-items:center;gap:12px;padding:10px 20px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0;background:rgba(255,255,255,.03);}
    #sqc-title{font-size:15px;font-weight:700;color:#e2e8f0;}
    #sqc-last-query{font-size:10px;color:#4b5563;}
    #sqc-header-spacer{flex:1;}
    #sqc-close{border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:rgba(255,255,255,.8);font-size:14px;width:30px;height:30px;border-radius:6px;cursor:pointer;}
    #sqc-close:hover{background:rgba(248,113,113,.2);border-color:#f87171;color:#f87171;}

    /* Layout */
    #sqc-main{display:flex;flex:1;overflow:hidden;}

    /* Sidebar */
    #sqc-sidebar{width:260px;min-width:160px;max-width:520px;flex-shrink:0;display:flex;flex-direction:column;gap:0;border-right:none;background:rgba(255,255,255,.02);overflow-y:auto;}
    #sqc-sidebar::-webkit-scrollbar{width:7px;}
    #sqc-sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.25);border-radius:10px;}
    #sqc-sidebar::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.4);}
    .sqc-sb-section{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);}
    .sqc-sb-label{font-size:9px;font-weight:700;color:#4b5563;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}

    /* Resize handle */
    #sqc-resize-handle{width:5px;flex-shrink:0;cursor:ew-resize;background:rgba(255,255,255,.07);transition:background .15s;position:relative;}
    #sqc-resize-handle:hover,#sqc-resize-handle.dragging{background:rgba(59,130,246,.5);}
    #sqc-resize-handle::after{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);height:32px;width:3px;border-radius:2px;background:rgba(255,255,255,.2);}

    /* Modo */
    #sqc-mode-tabs{display:flex;border:1px solid rgba(255,255,255,.1);border-radius:8px;overflow:hidden;}
    .sqc-mode-tab{flex:1;padding:6px 0;border:none;background:transparent;color:#6b7280;font-size:11px;font-weight:600;cursor:pointer;transition:all .12s;}
    .sqc-mode-tab.active{background:rgba(59,130,246,.25);color:#93c5fd;}

    /* Listas */
    #sqc-list-box{width:100%;box-sizing:border-box;background:#0a0f1e;border:1px solid rgba(255,255,255,.15);border-radius:6px;max-height:150px;overflow-y:auto;margin-bottom:6px;}
    #sqc-list-box::-webkit-scrollbar{width:5px;}
    #sqc-list-box::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:4px;}
    .sqc-list-item{padding:6px 8px;font-size:11px;color:#9ca3af;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04);word-break:break-word;line-height:1.3;transition:background .1s;}
    .sqc-list-item:last-child{border-bottom:none;}
    .sqc-list-item:hover{background:rgba(255,255,255,.06);color:#e2e8f0;}
    .sqc-list-item.active{background:rgba(59,130,246,.18);color:#93c5fd;border-left:2px solid #3b82f6;padding-left:6px;}
    .sqc-list-item-count{color:#4b5563;font-size:10px;}
    .sqc-list-item-empty{padding:10px 8px;font-size:11px;color:#4b5563;text-align:center;font-style:italic;cursor:default;}
    #sqc-list-filter{width:100%;box-sizing:border-box;background:#0a0f1e;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e8f0;font-size:11px;padding:4px 8px;outline:none;margin-bottom:4px;}
    #sqc-list-filter:focus{border-color:#3b82f6;}
    #sqc-list-filter::placeholder{color:#374151;}
    .sqc-list-item-date{font-size:9px;color:#374151;display:block;margin-top:1px;}
    @keyframes sqc-pulse{0%,100%{box-shadow:0 2px 12px rgba(59,130,246,.5);}50%{box-shadow:0 4px 20px rgba(239,68,68,.75);}}
    #sqc-topbar-btn.alert{background:linear-gradient(135deg,#ef4444,#b91c1c) !important;animation:sqc-pulse 1.5s ease-in-out infinite;}
    .sqc-list-actions{display:flex;gap:4px;}
    .sqc-list-act-btn{flex:1;padding:5px 0;border:1px solid rgba(255,255,255,.12);border-radius:6px;background:transparent;color:#9ca3af;font-size:10px;cursor:pointer;transition:all .12s;}
    .sqc-list-act-btn:hover{border-color:rgba(255,255,255,.3);color:#e2e8f0;}
    .sqc-list-act-btn.danger{color:#f87171;}
    .sqc-list-act-btn.danger:hover{border-color:#f87171;}
    #sqc-list-snapshot-info{font-size:10px;color:#4b5563;margin-top:6px;min-height:14px;}
    /* Modal */
    #sqc-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:100001;display:flex;align-items:center;justify-content:center;}
    #sqc-modal{background:#0f1729;border:1px solid rgba(255,255,255,.15);border-radius:12px;width:540px;max-width:92vw;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.7);}
    #sqc-modal-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.1);flex-shrink:0;}
    #sqc-modal-title{font-size:13px;font-weight:600;color:#e2e8f0;}
    #sqc-modal-close{background:none;border:none;color:#6b7280;font-size:16px;cursor:pointer;padding:2px 6px;border-radius:4px;line-height:1;}
    #sqc-modal-close:hover{color:#e2e8f0;background:rgba(255,255,255,.08);}
    #sqc-modal-body{flex:1;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px;}
    #sqc-modal-body::-webkit-scrollbar{width:5px;}
    #sqc-modal-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:4px;}
    .sqc-modal-label{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;display:block;}
    #sqc-modal-name{width:100%;box-sizing:border-box;background:#0a0f1e;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e8f0;font-size:13px;padding:7px 10px;outline:none;}
    #sqc-modal-name:focus{border-color:#3b82f6;}
    #sqc-modal-ids,#sqc-modal-new-ids{width:100%;box-sizing:border-box;background:#0a0f1e;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e8f0;font-size:11px;padding:7px 10px;outline:none;resize:vertical;font-family:monospace;line-height:1.5;}
    #sqc-modal-ids{min-height:100px;max-height:200px;}
    #sqc-modal-new-ids{min-height:72px;max-height:140px;}
    #sqc-modal-ids:focus,#sqc-modal-new-ids:focus{border-color:#3b82f6;}
    #sqc-modal-new-ids::placeholder{color:#374151;}
    #sqc-modal-diff{display:flex;flex-direction:column;gap:6px;}
    .sqc-mdiff-result{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;font-size:11px;display:flex;flex-direction:column;gap:5px;}
    .sqc-mdiff-row{line-height:1.4;word-break:break-all;}
    .sqc-mdiff-row.new{color:#4ade80;}.sqc-mdiff-row.dup{color:#facc15;}.sqc-mdiff-row.saved{color:#9ca3af;}
    .sqc-mdiff-actions{display:flex;flex-direction:column;gap:4px;margin-top:6px;}
    .sqc-modal-divider{height:1px;background:rgba(255,255,255,.08);}
    #sqc-modal-footer{display:flex;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid rgba(255,255,255,.1);flex-shrink:0;}
    #sqc-modal-footer-right{display:flex;gap:8px;margin-left:auto;}

    /* IDs textarea */
    #sqc-ids{width:100%;box-sizing:border-box;min-height:110px;max-height:200px;resize:vertical;background:#0a0f1e;border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e2e8f0;font-size:11px;font-family:monospace;padding:7px 9px;outline:none;}
    #sqc-ids:focus{border-color:#3b82f6;}
    #sqc-ids::placeholder{color:#374151;}
    #sqc-ids-count{font-size:10px;color:#4b5563;margin-top:4px;}

    /* Campos */
    .sqc-field-group{margin-bottom:10px;}
    .sqc-field-group-label{font-size:9px;color:#6b7280;font-weight:600;margin-bottom:4px;}
    .sqc-field-row{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:5px;cursor:pointer;border:1px solid transparent;transition:background .1s,border-color .1s;}
    .sqc-field-row:hover{background:rgba(255,255,255,.05);}
    .sqc-field-row.is-checked{background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.3);}
    .sqc-field-row input{cursor:pointer;accent-color:#3b82f6;width:14px;height:14px;flex-shrink:0;}
    .sqc-field-row span{font-size:11px;color:#6b7280;transition:color .1s;}
    .sqc-field-row.is-checked span{color:#93c5fd;font-weight:600;}
    #sqc-fields-count{font-size:10px;color:#4b5563;float:right;}

    /* Auto-refresh */
    #sqc-autorefresh-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
    #sqc-autorefresh-row label{font-size:11px;color:#6b7280;display:flex;align-items:center;gap:6px;cursor:pointer;}
    #sqc-autorefresh-interval{background:#0a0f1e;border:1px solid rgba(255,255,255,.15);border-radius:5px;color:#e2e8f0;font-size:11px;padding:3px 6px;outline:none;}
    #sqc-autorefresh-countdown{font-size:10px;color:#a78bfa;min-height:13px;margin-top:2px;}

    /* Botões */
    .sqc-btn-primary{width:100%;padding:9px 0;border:none;border-radius:8px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:4px;}
    .sqc-btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#60a5fa,#3b82f6);}
    .sqc-btn-primary:disabled{opacity:.45;cursor:default;}
    .sqc-btn-secondary{width:100%;padding:7px 0;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:transparent;color:#9ca3af;font-size:12px;font-weight:600;cursor:pointer;margin-bottom:4px;}
    .sqc-btn-secondary:hover:not(:disabled){border-color:rgba(255,255,255,.3);color:#e2e8f0;}
    .sqc-btn-secondary:disabled{opacity:.4;cursor:default;}
    .sqc-export-divider{font-size:9px;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px;border-top:1px solid rgba(255,255,255,.05);padding-top:8px;}

    #sqc-progress{font-size:11px;color:#6b7280;min-height:14px;margin-top:4px;}
    #sqc-export-section{display:none;}
    #sqc-export-section.visible{display:block;}

    /* Summary bar */
    #sqc-summary{display:none;padding:8px 20px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0;gap:16px;background:rgba(0,0,0,.2);}
    #sqc-summary.visible{display:flex;}
    .sqc-sum-item{font-size:11px;font-weight:600;}

    /* Filter/sort bar */
    #sqc-toolbar{display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0;background:rgba(0,0,0,.15);}
    #sqc-filter-input{flex:1;background:#0a0f1e;border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#e2e8f0;font-size:11px;padding:5px 9px;outline:none;}
    #sqc-filter-input:focus{border-color:#3b82f6;}
    #sqc-filter-input::placeholder{color:#374151;}
    #sqc-sort-select{background:#0a0f1e;border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#9ca3af;font-size:11px;padding:5px 8px;outline:none;cursor:pointer;}
    #sqc-sort-select:focus{border-color:#3b82f6;}
    #sqc-toolbar-count{font-size:10px;color:#4b5563;white-space:nowrap;}

    /* Results */
    #sqc-results-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;}
    #sqc-results-area{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px;}
    #sqc-results-area::-webkit-scrollbar{width:6px;}
    #sqc-results-area::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:10px;}
    #sqc-placeholder{color:#374151;font-size:13px;text-align:center;margin-top:80px;}

    /* Cards */
    .sqc-card{border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(15,23,42,.8);padding:14px 16px;}
    .sqc-card.changed{border-color:rgba(59,130,246,.3);background:rgba(59,130,246,.04);}
    .sqc-card.closed{border-color:rgba(74,222,128,.25);background:rgba(74,222,128,.03);}
    .sqc-card.no-change{opacity:.75;}
    .sqc-card-error{border-color:rgba(248,113,113,.25);background:rgba(248,113,113,.04);}
    .sqc-card-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;}
    .sqc-ticket-id{font-size:16px;font-weight:800;color:#60a5fa;text-decoration:none;flex-shrink:0;}
    .sqc-ticket-id:hover{text-decoration:underline;}
    .sqc-subject{font-size:12px;color:#94a3b8;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .sqc-badges{display:flex;gap:5px;flex-wrap:wrap;flex-shrink:0;}
    .sqc-badge{font-size:10px;padding:2px 8px;border-radius:12px;border:1px solid rgba(255,255,255,.2);color:#9ca3af;}
    .sqc-badge-sccd{color:#a78bfa;border-color:rgba(167,139,250,.35);}
    .sqc-badge-global{color:#f87171;border-color:rgba(248,113,113,.35);}
    .sqc-badge-linked{color:#fb923c;border-color:rgba(251,146,60,.35);}
    .sqc-badge-local{color:#374151;border-color:rgba(75,85,99,.2);}
    .sqc-badge-changed{color:#93c5fd;border-color:rgba(59,130,246,.4);background:rgba(59,130,246,.1);}
    .sqc-badge-new{color:#4ade80;border-color:rgba(74,222,128,.4);background:rgba(74,222,128,.08);}
    .sqc-badge-nochange{color:#4b5563;border-color:rgba(75,85,99,.2);}
    .sqc-badge-today{color:#f59e0b;border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.08);}
    .sqc-changes-block{background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:6px;padding:7px 10px;margin-bottom:8px;font-size:11px;}
    .sqc-changes-block p{margin:0 0 3px;color:#93c5fd;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;}
    .sqc-change-row{color:#d1d5db;}
    .sqc-change-from{color:#f87171;text-decoration:line-through;}
    .sqc-change-to{color:#4ade80;font-weight:600;}
    .sqc-meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:5px 14px;margin-bottom:10px;}
    .sqc-meta-item{display:flex;flex-direction:column;gap:1px;}
    .sqc-meta-label{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;}
    .sqc-meta-val{font-size:12px;color:#d1d5db;}
    .sqc-comment-preview{font-size:11px;color:#6b7280;font-style:italic;margin-bottom:8px;padding:5px 8px;border-left:2px solid rgba(255,255,255,.1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sqc-section{border-top:1px solid rgba(255,255,255,.05);padding-top:7px;margin-top:7px;}
    .sqc-toggle{background:none;border:none;color:#6b7280;font-size:11px;cursor:pointer;padding:0;text-align:left;}
    .sqc-toggle:hover{color:#94a3b8;}
    .sqc-toggle.open{color:#93c5fd;}
    .sqc-collapsible{display:none;margin-top:8px;font-size:12px;color:#d1d5db;line-height:1.6;max-height:320px;overflow-y:auto;}
    .sqc-collapsible.open{display:block;}
    .sqc-collapsible img{max-width:100%;border-radius:6px;display:block;margin:4px 0;}
    .sqc-collapsible p{margin:0 0 6px;}
    .sqc-comment{border-left:2px solid rgba(59,130,246,.35);padding:6px 10px;margin-bottom:6px;}
    .sqc-comment.new-comment{border-color:#4ade80;background:rgba(74,222,128,.05);}
    .sqc-comment-meta{display:flex;gap:10px;font-size:10px;color:#6b7280;margin-bottom:4px;flex-wrap:wrap;}
    .sqc-privacy{background:rgba(167,139,250,.1);border-radius:4px;padding:0 5px;color:#a78bfa;}
    .sqc-remove-btn{margin-top:8px;padding:4px 10px;border:1px solid rgba(248,113,113,.35);border-radius:6px;background:transparent;color:#f87171;font-size:10px;cursor:pointer;transition:all .12s;}
    .sqc-remove-btn:hover{background:rgba(248,113,113,.12);border-color:#f87171;}
  `);

  // ══════════════════════════════════════════════════════════════════
  // ESTADO
  // ══════════════════════════════════════════════════════════════════

  let panel        = null;
  let lists        = loadLists();
  let mode         = 'simple';
  let activeListId = null;
  let fields       = new Set(DEFAULT_FIELDS);
  let lastResults  = [];
  let lastIds      = [];
  let lastChanges  = null;
  let lastClosedIds = [];
  let sortMode     = 'default';
  let filterText   = '';
  let arTimer      = null;   // auto-refresh interval handle
  let arCountdown  = 0;      // seconds remaining
  let arTickHandle = null;   // setInterval for countdown tick
  let originalDocTitle = document.title;

  // ══════════════════════════════════════════════════════════════════
  // SORT + FILTER HELPERS
  // ══════════════════════════════════════════════════════════════════

  const getSortedFilteredIndices = () => {
    const ft = filterText.toLowerCase().trim();
    let indices = lastIds.map((id,i) => i);

    if (ft) {
      indices = indices.filter(i => {
        const id = lastIds[i];
        const d  = lastResults[i]?.data;
        if (id.includes(ft)) return true;
        if (!d) return false;
        return (d.subject||'').toLowerCase().includes(ft)
          || (d.group||'').toLowerCase().includes(ft)
          || (d.assignee||'').toLowerCase().includes(ft)
          || (d.statusLabel||'').toLowerCase().includes(ft);
      });
    }

    if (sortMode === 'default') return indices;

    const score = (i) => {
      const id  = lastIds[i];
      const r   = lastResults[i];
      const d   = r?.data;
      const chg = lastChanges?.[id];
      if (sortMode === 'changed_first') {
        if (!r?.ok) return 99;
        if (chg?.isNew) return 0;
        if (chg?.hasChanges && CLOSED_STATUSES.has(d?.statusRaw)) return 1;
        if (chg?.hasChanges) return 2;
        return 3;
      }
      if (sortMode === 'closed_first') {
        if (!r?.ok) return 99;
        if (CLOSED_STATUSES.has(d?.statusRaw)) return 0;
        return 1;
      }
      if (sortMode === 'by_status') {
        const order = ['RequestStatusInProgress','RequestStatusPending','RequestStatusNew',
          'RequestStatusReady','RequestStatusSuspended','RequestStatusComplete',
          'RequestStatusRejected','RequestStatusCancelled'];
        return order.indexOf(d?.statusRaw ?? '') === -1 ? 50 : order.indexOf(d?.statusRaw);
      }
      if (sortMode === 'recent_update') {
        return -(d?.lastUpdateTs || 0);
      }
      return i;
    };

    return [...indices].sort((a,b) => score(a) - score(b));
  };

  // ══════════════════════════════════════════════════════════════════
  // CONSTRUÇÃO DO PAINEL
  // ══════════════════════════════════════════════════════════════════

  const buildPanel = () => {
    const p = document.createElement('div');
    p.id = 'sqc-panel';

    const fieldGroupsHtml = Object.entries(
      FIELD_DEFS.reduce((acc,f)=>{ (acc[f.group]=acc[f.group]||[]).push(f); return acc; }, {})
    ).map(([grp, defs]) => `
      <div class="sqc-field-group">
        <div class="sqc-field-group-label">${grp}</div>
        ${defs.map(f=>`
          <label class="sqc-field-row${DEFAULT_FIELDS.includes(f.key)?' is-checked':''}">
            <input type="checkbox" class="sqc-field-cb" data-key="${f.key}" ${DEFAULT_FIELDS.includes(f.key)?'checked':''}>
            <span>${f.label}</span>
          </label>`).join('')}
      </div>`).join('');

    p.innerHTML = `
      <div id="sqc-header">
        <span id="sqc-title">🔍 Consulta de Chamados SMAX</span>
        <span id="sqc-last-query"></span>
        <div id="sqc-header-spacer"></div>
        <button id="sqc-close" title="Fechar (Esc)">✕</button>
      </div>
      <div id="sqc-summary">
        <span class="sqc-sum-item" id="sqc-sum-changed" style="color:#93c5fd;"></span>
        <span class="sqc-sum-item" id="sqc-sum-nochange" style="color:#6b7280;"></span>
        <span class="sqc-sum-item" id="sqc-sum-closed" style="color:#4ade80;"></span>
        <span class="sqc-sum-item" id="sqc-sum-errors" style="color:#f87171;"></span>
      </div>
      <div id="sqc-main">

        <div id="sqc-sidebar">

          <div class="sqc-sb-section">
            <div class="sqc-sb-label">Modo</div>
            <div id="sqc-mode-tabs">
              <button class="sqc-mode-tab active" data-mode="simple">Simples</button>
              <button class="sqc-mode-tab" data-mode="list">📋 Lista salva</button>
            </div>
          </div>

          <div class="sqc-sb-section" id="sqc-list-section" style="display:none;">
            <div class="sqc-sb-label">Lista</div>
            <input id="sqc-list-filter" type="text" placeholder="Filtrar listas…">
            <div id="sqc-list-box"><div class="sqc-list-item-empty">Nenhuma lista salva</div></div>
            <div class="sqc-list-actions">
              <button class="sqc-list-act-btn" id="sqc-btn-new-list">+ Nova</button>
              <button class="sqc-list-act-btn" id="sqc-btn-manage-list">✏️ Gerenciar</button>
            </div>
            <div id="sqc-list-snapshot-info"></div>
          </div>

          <div class="sqc-sb-section">
            <div class="sqc-sb-label">IDs dos chamados</div>
            <textarea id="sqc-ids" placeholder="Cole os IDs aqui&#10;(um por linha, vírgula ou espaço)&#10;Ctrl+Enter para consultar"></textarea>
            <div id="sqc-ids-count"></div>
          </div>

          <div class="sqc-sb-section">
            <div class="sqc-sb-label">Campos <span id="sqc-fields-count"></span></div>
            ${fieldGroupsHtml}
          </div>

          <div class="sqc-sb-section">
            <button class="sqc-btn-primary" id="sqc-btn-fetch">🔍 Consultar</button>
            <button class="sqc-btn-secondary" id="sqc-btn-save-list" style="display:none;">💾 Salvar como nova lista</button>
            <div id="sqc-progress"></div>

            <div id="sqc-autorefresh-section" style="display:none;">
              <div id="sqc-autorefresh-row">
                <label><input type="checkbox" id="sqc-ar-cb"> Auto-refresh</label>
                <select id="sqc-autorefresh-interval">
                  <option value="60">1 min</option>
                  <option value="300">5 min</option>
                  <option value="600">10 min</option>
                  <option value="1800">30 min</option>
                </select>
              </div>
              <div id="sqc-autorefresh-countdown"></div>
            </div>

            <div id="sqc-export-section">
              <button class="sqc-btn-secondary" id="sqc-btn-remove-closed" style="display:none;border-color:rgba(248,113,113,.4);color:#f87171;">🗑️ Remover encerrados da lista</button>
              <div class="sqc-export-divider">Exportar consulta</div>
              <button class="sqc-btn-secondary" id="sqc-btn-word">📄 Word (.doc)</button>
              <button class="sqc-btn-secondary" id="sqc-btn-excel">📊 Excel (.xls)</button>
              <button class="sqc-btn-secondary" id="sqc-btn-pdf-consulta">🖨️ PDF</button>
              <button class="sqc-btn-secondary" id="sqc-btn-md">📝 Markdown (.md)</button>
              <div class="sqc-export-divider">Exportar relatório</div>
              <button class="sqc-btn-secondary" id="sqc-btn-rel-word">📋 Word (.doc)</button>
              <button class="sqc-btn-secondary" id="sqc-btn-rel-excel">📊 Excel (.xls)</button>
              <button class="sqc-btn-secondary" id="sqc-btn-pdf">🖨️ PDF</button>
              <button class="sqc-btn-secondary" id="sqc-btn-rel-md">📋 Markdown (.md)</button>
            </div>
          </div>

        </div>

        <div id="sqc-resize-handle" title="Arrastar para redimensionar"></div>

        <div id="sqc-results-wrap">
          <div id="sqc-toolbar">
            <input id="sqc-filter-input" type="text" placeholder="Filtrar por ID, assunto, grupo…">
            <select id="sqc-sort-select">
              <option value="default">Ordem padrão</option>
              <option value="changed_first">Atualizado primeiro</option>
              <option value="closed_first">Encerrado primeiro</option>
              <option value="by_status">Por status</option>
              <option value="recent_update">Últ. atualização</option>
            </select>
            <span id="sqc-toolbar-count"></span>
          </div>
          <div id="sqc-results-area">
            <div id="sqc-placeholder">Cole os IDs dos chamados ao lado e clique em <b>Consultar</b>.<br><span style="font-size:11px;color:#4b5563;">Atalho: Ctrl+Shift+Q para abrir/fechar · Ctrl+Enter para consultar</span></div>
          </div>
        </div>
      </div>

      <div id="sqc-modal-overlay" style="display:none;">
        <div id="sqc-modal">
          <div id="sqc-modal-header">
            <span id="sqc-modal-title">📋 Gerenciar Lista</span>
            <button id="sqc-modal-close" title="Fechar">✕</button>
          </div>
          <div id="sqc-modal-body">
            <div>
              <label class="sqc-modal-label">Nome da lista</label>
              <input id="sqc-modal-name" type="text" placeholder="Nome da lista…">
            </div>
            <div>
              <label class="sqc-modal-label">IDs na lista — <span id="sqc-modal-count">0</span> chamados</label>
              <textarea id="sqc-modal-ids" placeholder="Um ID por linha…"></textarea>
            </div>
            <div class="sqc-modal-divider"></div>
            <div>
              <label class="sqc-modal-label">Adicionar / Comparar — cole nova lista de IDs</label>
              <textarea id="sqc-modal-new-ids" placeholder="Cole aqui os IDs para comparar com a lista acima…"></textarea>
              <button class="sqc-btn-secondary" id="sqc-modal-btn-compare" style="margin-top:6px;">🔀 Comparar</button>
              <div id="sqc-modal-diff"></div>
            </div>
          </div>
          <div id="sqc-modal-footer">
            <button class="sqc-list-act-btn danger" id="sqc-modal-btn-delete">🗑️ Excluir lista</button>
            <div id="sqc-modal-footer-right">
              <button class="sqc-btn-secondary" id="sqc-modal-btn-cancel">Cancelar</button>
              <button class="sqc-btn-primary" id="sqc-modal-btn-save">💾 Salvar</button>
            </div>
          </div>
        </div>
      </div>`;
    return p;
  };

  // ══════════════════════════════════════════════════════════════════
  // RENDERIZAÇÃO
  // ══════════════════════════════════════════════════════════════════

  const refreshListSelect = () => {
    if (!panel) return;
    const box = panel.querySelector('#sqc-list-box');
    if (!box) return;
    const ft = (panel.querySelector('#sqc-list-filter')?.value || '').toLowerCase().trim();
    const filtered = lists.filter(l => !ft || l.name.toLowerCase().includes(ft));
    if (!filtered.length) {
      box.innerHTML = `<div class="sqc-list-item-empty">${lists.length ? 'Nenhuma lista encontrada' : 'Nenhuma lista salva'}</div>`;
      return;
    }
    box.innerHTML = filtered.map(l => {
      const lastEntry = l.history?.[0] || l.lastQuery;
      const dateHtml = lastEntry ? `<span class="sqc-list-item-date">📸 ${esc(lastEntry.timestamp)}</span>` : '';
      return `<div class="sqc-list-item${l.id===activeListId?' active':''}" data-id="${esc(l.id)}">${esc(l.name)} <span class="sqc-list-item-count">(${l.ids.length})</span>${dateHtml}</div>`;
    }).join('');
  };

  const refreshSnapshotInfo = () => {
    if (!panel) return;
    const el = panel.querySelector('#sqc-list-snapshot-info');
    if (!el) return;
    const list = lists.find(l=>l.id===activeListId);
    if (!list) { el.innerHTML = ''; return; }
    const history = list.history || (list.lastQuery ? [list.lastQuery] : []);
    if (!history.length) {
      el.textContent = 'Sem snapshot — primeira consulta criará o baseline.';
      return;
    }
    el.innerHTML = history.map((h, i) =>
      `<div style="font-size:10px;color:${i===0?'#6b7280':'#374151'};">📸 ${esc(h.timestamp)}</div>`
    ).join('');
  };

  const buildCard = (id, i, chg) => {
    const r = lastResults[i];
    if (!r) return buildErrorCard(id,'Sem resposta.');
    if (!r.ok) return buildErrorCard(id, r.error||'Erro desconhecido.');
    const d = r.data;

    let cardClass = 'sqc-card';
    let changeBadge = '';
    const newCommentCount = chg?.changes?.find(c=>c.newComments)?.newComments?.length || 0;
    if (chg) {
      if (CLOSED_STATUSES.has(d.statusRaw) && chg.hasChanges) {
        cardClass += ' closed';
        changeBadge = '<span class="sqc-badge sqc-badge-new">✅ Encerrado</span>';
      } else if (chg.isNew) {
        cardClass += ' changed';
        changeBadge = '<span class="sqc-badge sqc-badge-new">🆕 Novo</span>';
      } else if (chg.hasChanges) {
        cardClass += ' changed';
        const commentPart = newCommentCount > 0 ? ` · ${newCommentCount} 💬` : '';
        changeBadge = `<span class="sqc-badge sqc-badge-changed">🔄 Atualizado${commentPart}</span>`;
      } else {
        cardClass += ' no-change';
        changeBadge = '<span class="sqc-badge sqc-badge-nochange">⏸️ Sem mudança</span>';
      }
    }

    // Today badge
    const todayBadge = isToday(d.lastUpdateTs)
      ? '<span class="sqc-badge sqc-badge-today">🆕 Hoje</span>' : '';

    // Changes block
    let changesBlock = '';
    if (chg?.hasChanges && !chg.isNew) {
      const textChanges = chg.changes.filter(c=>!c.newComments);
      if (textChanges.length) {
        changesBlock = `<div class="sqc-changes-block"><p>Alterações detectadas</p>` +
          textChanges.map(c=>`<div class="sqc-change-row">${esc(c.label)}: <span class="sqc-change-from">${esc(c.from)}</span> → <span class="sqc-change-to">${esc(c.to)}</span></div>`).join('') +
          '</div>';
      }
    }

    // Comments
    const newComments = chg ? (chg.changes?.find(c=>c.newComments)?.newComments||[]) : [];
    const commentsToShow = (chg && chg.hasChanges) ? newComments : [...d.lastComments].sort((a,b)=>a.ts-b.ts);
    const commentsHtml = !commentsToShow.length
      ? '<div style="font-size:11px;color:#6b7280;font-style:italic;">Sem comentários.</div>'
      : commentsToShow.map(c=>`
          <div class="sqc-comment${newComments.includes(c)?' new-comment':''}">
            <div class="sqc-comment-meta">
              <span>${esc(c.from)}</span><span>${esc(c.date)}</span>
              <span class="sqc-privacy">${esc(c.privacy)}</span>
              ${newComments.includes(c)?'<span style="color:#4ade80;font-weight:700;">🆕 Novo</span>':''}
            </div>
            <div>${c.body}</div>
          </div>`).join('');

    // Comment preview (most recent, shown inline)
    let commentPreview = '';
    if (fields.has('comments') && d.lastComments.length) {
      const latest = d.lastComments[0];
      const previewText = truncate(latest.bodyText||'', 120);
      if (previewText) {
        commentPreview = `<div class="sqc-comment-preview" title="${esc(latest.bodyText||'')}">💬 ${esc(latest.from||'')}${latest.from?': ':''}${esc(previewText)}</div>`;
      }
    }

    const metaItems = [];
    if (fields.has('requestedFor'))      metaItems.push(`<div class="sqc-meta-item"><span class="sqc-meta-label">Solicitado por</span><span class="sqc-meta-val">${esc(d.requestedFor)}</span></div>`);
    if (fields.has('requestedForTitle') && d.requestedForTitle) metaItems.push(`<div class="sqc-meta-item"><span class="sqc-meta-label">Cargo</span><span class="sqc-meta-val">${esc(d.requestedForTitle)}</span></div>`);
    if (fields.has('group'))             metaItems.push(`<div class="sqc-meta-item"><span class="sqc-meta-label">Grupo</span><span class="sqc-meta-val">${esc(d.group)}</span></div>`);
    if (fields.has('assignee'))          metaItems.push(`<div class="sqc-meta-item"><span class="sqc-meta-label">Especialista</span><span class="sqc-meta-val">${esc(d.assignee)}</span></div>`);
    if (fields.has('createTime'))        metaItems.push(`<div class="sqc-meta-item"><span class="sqc-meta-label">Abertura</span><span class="sqc-meta-val">${esc(d.createTime)}</span></div>`);
    if (fields.has('lastUpdate'))        metaItems.push(`<div class="sqc-meta-item"><span class="sqc-meta-label">Últ. atualização</span><span class="sqc-meta-val">${esc(d.lastUpdateTime)}</span></div>`);
    // Global pai (se este chamado for filho de um global, mostra na metadata)
    if (d.isGlobal) metaItems.push(`<div class="sqc-meta-item"><span class="sqc-meta-label">Global pai</span><span class="sqc-meta-val"><a href="https://suporte.tjsp.jus.br/saw/Request/${esc(d.globalId)}/general" target="_blank" style="color:#f87171;">#${esc(d.globalId)}</a></span></div>`);

    // Badge global: indica se ESTE chamado É um global (pai)
    let globalBadge = '';
    if (fields.has('global') && d.isGlobalParent) {
      globalBadge = `<span class="sqc-badge sqc-badge-global">🌐 Global</span>`;
    }
    let linkedBadge = '';
    if (fields.has('linkedCount') && d.linkedCount > 0) {
      const linkedChange = chg?.changes?.find(c=>c.isLinkedChange);
      const linkedLabel = linkedChange ? `${d.linkedCount} vinc. (era ${linkedChange.from})` : `${d.linkedCount} vinculados`;
      linkedBadge = `<span class="sqc-badge sqc-badge-linked" title="Chamados vinculados">🔗 ${esc(linkedLabel)}</span>`;
    }

    const sections = [];
    if (fields.has('description')) sections.push(`
      <div class="sqc-section">
        <button class="sqc-toggle" data-target="sqc-desc-${esc(d.ticketId)}">▸ Descrição</button>
        <div class="sqc-collapsible" id="sqc-desc-${esc(d.ticketId)}">${d.descHtml||'<em style="color:#6b7280">Sem descrição.</em>'}</div>
      </div>`);
    if (fields.has('solution')) sections.push(`
      <div class="sqc-section">
        <button class="sqc-toggle" data-target="sqc-sol-${esc(d.ticketId)}">▸ Solução</button>
        <div class="sqc-collapsible" id="sqc-sol-${esc(d.ticketId)}">${d.solutionHtml||'<em style="color:#6b7280">Sem solução.</em>'}</div>
      </div>`);
    if (fields.has('comments')) sections.push(`
      <div class="sqc-section">
        <button class="sqc-toggle" data-target="sqc-com-${esc(d.ticketId)}">▸ ${chg?.hasChanges?'Novos comentários':'Comentários'} (${commentsToShow.length})</button>
        <div class="sqc-collapsible" id="sqc-com-${esc(d.ticketId)}">${commentsHtml}</div>
      </div>`);

    const isSccdFechado = d.statusSCCDLabel.toLowerCase().includes('fechado');
    const removeBtn = isSccdFechado
      ? `<button class="sqc-remove-btn" data-remove-id="${esc(d.ticketId)}" title="Status operacional: ${esc(d.statusSCCDLabel)} — remover da lista">🗑️ Remover da lista</button>`
      : '';

    return `<div class="${cardClass}" data-ticket-id="${esc(d.ticketId)}">
      <div class="sqc-card-header">
        <span style="font-size:17px;">${d.statusEmoji}</span>
        <a class="sqc-ticket-id" href="https://suporte.tjsp.jus.br/saw/Request/${esc(d.ticketId)}/general" target="_blank">#${esc(d.ticketId)}</a>
        ${d.subject?`<span class="sqc-subject" title="${esc(d.subject)}">${esc(d.subject)}</span>`:''}
        <div class="sqc-badges">
          ${fields.has('status')?`<span class="sqc-badge" style="border-color:${d.statusColor};color:${d.statusColor};">${esc(d.statusLabel)}</span>`:''}
          ${fields.has('statusSCCD')?`<span class="sqc-badge sqc-badge-sccd">${esc(d.statusSCCDLabel)}</span>`:''}
          ${globalBadge}${linkedBadge}${todayBadge}${changeBadge}
        </div>
      </div>
      ${changesBlock}
      ${metaItems.length?`<div class="sqc-meta-grid">${metaItems.join('')}</div>`:''}
      ${commentPreview}
      ${sections.join('')}
      ${removeBtn}
    </div>`;
  };

  const buildErrorCard = (id, msg) => `
    <div class="sqc-card sqc-card-error">
      <div class="sqc-card-header">
        <span class="sqc-ticket-id">#${esc(id)}</span>
        <span class="sqc-badge" style="color:#f87171;border-color:#f87171;">Erro</span>
      </div>
      <div style="font-size:12px;color:#f87171;">${esc(msg)}</div>
    </div>`;

  const renderResults = () => {
    const area = panel?.querySelector('#sqc-results-area');
    if (!area) return;
    if (!lastIds.length) { area.innerHTML = '<div id="sqc-placeholder">Cole os IDs dos chamados ao lado e clique em <b>Consultar</b>.</div>'; return; }
    const indices = getSortedFilteredIndices();
    const countEl = panel.querySelector('#sqc-toolbar-count');
    if (countEl) countEl.textContent = indices.length !== lastIds.length ? `${indices.length}/${lastIds.length}` : `${lastIds.length} chamado${lastIds.length!==1?'s':''}`;
    area.innerHTML = indices.length
      ? indices.map(i => buildCard(lastIds[i], i, lastChanges?.[lastIds[i]])).join('')
      : '<div id="sqc-placeholder" style="margin-top:40px;">Nenhum resultado para o filtro atual.</div>';
  };

  const renderSummary = () => {
    const bar = panel?.querySelector('#sqc-summary');
    if (!bar || !lastChanges) { bar?.classList.remove('visible'); return; }
    const nChanged  = lastIds.filter(id=>lastChanges[id]?.hasChanges && !CLOSED_STATUSES.has(lastResults[lastIds.indexOf(id)]?.data?.statusRaw)).length;
    const nClosed   = lastIds.filter(id=>lastChanges[id]?.hasChanges && CLOSED_STATUSES.has(lastResults[lastIds.indexOf(id)]?.data?.statusRaw)).length;
    const nNoChange = lastIds.filter(id=>lastResults[lastIds.indexOf(id)]?.ok && !lastChanges[id]?.hasChanges).length;
    const nErrors   = lastResults.filter(r=>!r?.ok).length;
    bar.querySelector('#sqc-sum-changed').textContent  = nChanged  ? `🔄 ${nChanged} atualizado${nChanged!==1?'s':''}` : '';
    bar.querySelector('#sqc-sum-closed').textContent   = nClosed   ? `✅ ${nClosed} encerrado${nClosed!==1?'s':''}` : '';
    bar.querySelector('#sqc-sum-nochange').textContent = nNoChange ? `⏸️ ${nNoChange} sem mudança` : '';
    bar.querySelector('#sqc-sum-errors').textContent   = nErrors   ? `❌ ${nErrors} erro${nErrors!==1?'s':''}` : '';
    bar.classList.add('visible');
  };

  // ══════════════════════════════════════════════════════════════════
  // AUTO-REFRESH
  // ══════════════════════════════════════════════════════════════════

  const stopAutoRefresh = () => {
    if (arTimer)      { clearTimeout(arTimer);   arTimer = null; }
    if (arTickHandle) { clearInterval(arTickHandle); arTickHandle = null; }
    const el = panel?.querySelector('#sqc-autorefresh-countdown');
    if (el) el.textContent = '';
  };

  const startAutoRefresh = (secs) => {
    stopAutoRefresh();
    arCountdown = secs;
    const tick = () => {
      arCountdown--;
      const el = panel?.querySelector('#sqc-autorefresh-countdown');
      if (el) el.textContent = arCountdown > 0 ? `Próxima consulta em ${arCountdown}s` : 'Consultando…';
      if (arCountdown <= 0) {
        clearInterval(arTickHandle);
        arTickHandle = null;
        runQuery().then(() => {
          if (lastChanges) {
            const nChanged = lastIds.filter(id => lastChanges[id]?.hasChanges).length;
            const btn = document.querySelector('#sqc-topbar-btn');
            if (nChanged > 0) {
              document.title = `🔴 ${nChanged} atualiz. — ${originalDocTitle.replace(/^🔴.*?— /,'')}`;
              if (btn) btn.classList.add('alert');
            } else {
              document.title = originalDocTitle;
              if (btn) btn.classList.remove('alert');
            }
          }
          const cb = panel?.querySelector('#sqc-ar-cb');
          if (cb?.checked) startAutoRefresh(Number(panel.querySelector('#sqc-autorefresh-interval').value)||60);
        });
      }
    };
    arTickHandle = setInterval(tick, 1000);
  };

  // ══════════════════════════════════════════════════════════════════
  // CONSULTA
  // ══════════════════════════════════════════════════════════════════

  const runQuery = async () => {
    const ids = parseIds(panel.querySelector('#sqc-ids').value.trim());
    if (!ids.length) { panel.querySelector('#sqc-progress').textContent = 'Nenhum ID válido.'; return; }

    const fetchBtn   = panel.querySelector('#sqc-btn-fetch');
    const exportSec  = panel.querySelector('#sqc-export-section');
    const progressEl = panel.querySelector('#sqc-progress');
    const area       = panel.querySelector('#sqc-results-area');

    fetchBtn.disabled = true;
    exportSec.classList.remove('visible');
    panel.querySelector('#sqc-summary').classList.remove('visible');
    area.innerHTML = '';
    lastResults = []; lastIds = ids; lastChanges = null;
    progressEl.textContent = `Consultando… 0/${ids.length}`;

    const fetched = await runConcurrent(
      ids,
      async (id) => {
        const [payload, linkedCount] = await Promise.all([
          fetchTicket(id),
          fetchLinkedCount(id),
        ]);
        const d = extractTicketData(payload, id, linkedCount);
        // Cargo do solicitante: busca secundária na entidade Person
        if (!d.requestedForTitle) {
          // Prioridade: Id do objeto expandido em related_properties (mais confiável)
          // Fallback: ID numérico em properties
          const ent0 = Array.isArray(payload?.entities) && payload.entities.length
            ? payload.entities[0]
            : (payload?.entity_type ? payload : {});
          const personId = ent0?.related_properties?.RequestedForPerson?.Id
            || ent0?.properties?.RequestedForPerson;
          if (personId) d.requestedForTitle = await fetchPersonTitle(personId);
        }
        return d;
      },
      CONCURRENCY,
      (done,total) => { progressEl.textContent = `Consultando… ${done}/${total}`; }
    );
    lastResults = fetched;

    if (mode === 'list' && activeListId) {
      const list = lists.find(l=>l.id===activeListId);
      const lastEntry = list?.history?.[0] || list?.lastQuery;
      if (lastEntry?.snapshot) {
        const snap = lastEntry.snapshot;
        lastChanges = {};
        ids.forEach((id,i) => {
          const r = fetched[i];
          if (r?.ok) lastChanges[id] = detectChanges(r.data, snap[id]||null, fields);
        });
      }
      const snapshot = {};
      ids.forEach((id,i) => { if (fetched[i]?.ok) snapshot[id] = makeSnapshot(fetched[i].data); });
      const now = nowStr();
      const idx = lists.findIndex(l=>l.id===activeListId);
      if (idx>=0) {
        const newEntry = { timestamp: now, snapshot };
        if (!lists[idx].history) lists[idx].history = [];
        lists[idx].history.unshift(newEntry);
        if (lists[idx].history.length > 3) lists[idx].history.length = 3;
        lists[idx].lastQuery = newEntry;
        lists[idx].ids = ids;
        saveLists(lists);
        refreshSnapshotInfo();
        refreshListSelect();
      }
    }

    renderResults();
    renderSummary();

    // Atualiza botão bulk "Remover fechados (status operacional)"
    lastClosedIds = ids.filter((id, i) => {
      const r = fetched[i];
      return r?.ok && r.data.statusSCCDLabel.toLowerCase().includes('fechado');
    });
    const removeClosedBtn = panel.querySelector('#sqc-btn-remove-closed');
    if (removeClosedBtn) {
      if (lastClosedIds.length > 0) {
        removeClosedBtn.textContent = `🗑️ Remover ${lastClosedIds.length} fechado${lastClosedIds.length !== 1 ? 's' : ''} da lista`;
        removeClosedBtn.style.display = 'block';
      } else {
        removeClosedBtn.style.display = 'none';
      }
    }

    const ok  = fetched.filter(r=>r?.ok).length;
    const err = fetched.length - ok;
    const now = nowStr();
    GM_setValue(LAST_QUERY_KEY, now);
    const lastEl = panel.querySelector('#sqc-last-query');
    if (lastEl) lastEl.textContent = `Última consulta: ${now}`;
    progressEl.textContent = `✓ ${ok} chamado${ok!==1?'s':''} carregado${ok!==1?'s':''}` +
      (err?` · ${err} erro${err!==1?'s':''}`:'')+` — ${now}`;
    fetchBtn.disabled = false;
    if (ok>0) {
      exportSec.classList.add('visible');
      panel.querySelector('#sqc-autorefresh-section').style.display = 'block';
    }
  };

  // ══════════════════════════════════════════════════════════════════
  // ABRIR / FECHAR PAINEL
  // ══════════════════════════════════════════════════════════════════

  const openPanel = () => {
    if (!panel) {
      panel = buildPanel();
      document.body.appendChild(panel);

      const lq = GM_getValue(LAST_QUERY_KEY,'');
      if (lq) panel.querySelector('#sqc-last-query').textContent = `Última consulta: ${lq}`;

      // Fechar
      panel.querySelector('#sqc-close').addEventListener('click', () => { panel.style.display='none'; stopAutoRefresh(); });
      document.addEventListener('keydown', e => {
        if (e.key==='Escape' && panel.style.display!=='none') { panel.style.display='none'; stopAutoRefresh(); }
      });

      // Atalho global Ctrl+Shift+Q
      document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='q') {
          e.preventDefault();
          panel.style.display = panel.style.display==='none' ? 'flex' : 'none';
          if (panel.style.display==='none') stopAutoRefresh();
        }
      });

      // Ctrl+Enter no textarea
      panel.querySelector('#sqc-ids').addEventListener('keydown', e => {
        if (e.ctrlKey && e.key==='Enter') { e.preventDefault(); runQuery(); }
      });

      // Resize handle
      const handle  = panel.querySelector('#sqc-resize-handle');
      const sidebar = panel.querySelector('#sqc-sidebar');
      let dragging = false, startX = 0, startW = 0;
      handle.addEventListener('mousedown', e => {
        dragging = true; startX = e.clientX; startW = sidebar.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.userSelect = 'none';
      });
      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const newW = Math.max(160, Math.min(520, startW + (e.clientX - startX)));
        sidebar.style.width = newW + 'px';
      });
      document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
      });

      // Toggle modo
      panel.querySelectorAll('.sqc-mode-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          mode = btn.dataset.mode;
          panel.querySelectorAll('.sqc-mode-tab').forEach(b=>b.classList.toggle('active',b===btn));
          panel.querySelector('#sqc-list-section').style.display = mode==='list' ? 'block' : 'none';
          panel.querySelector('#sqc-btn-save-list').style.display = mode==='simple' ? 'block' : 'none';
          if (mode==='list') { refreshListSelect(); refreshSnapshotInfo(); }
          if (mode==='simple') { activeListId=null; }
        });
      });

      // Seleção de lista
      panel.querySelector('#sqc-list-box').addEventListener('click', e => {
        const item = e.target.closest('.sqc-list-item[data-id]');
        if (!item) return;
        activeListId = item.dataset.id || null;
        const list = lists.find(l=>l.id===activeListId);
        if (list) {
          panel.querySelector('#sqc-ids').value = list.ids.join('\n');
          updateIdsCount();
          if (list.fields) {
            fields = new Set(list.fields);
            panel.querySelectorAll('.sqc-field-cb').forEach(cb => {
              cb.checked = fields.has(cb.dataset.key);
              cb.closest('.sqc-field-row').classList.toggle('is-checked', cb.checked);
            });
            updateFieldsCount();
          }
        }
        refreshSnapshotInfo();
        lastChanges = null;
        panel.querySelector('#sqc-summary').classList.remove('visible');
      });

      // Filtro de listas
      panel.querySelector('#sqc-list-filter').addEventListener('input', () => refreshListSelect());

      // Nova lista
      panel.querySelector('#sqc-btn-new-list').addEventListener('click', () => {
        const name = prompt('Nome da nova lista:');
        if (!name?.trim()) return;
        const ids = parseIds(panel.querySelector('#sqc-ids').value);
        const list = makeNewList(name.trim(), ids, [...fields]);
        lists.push(list);
        saveLists(lists);
        activeListId = list.id;
        refreshListSelect();
        refreshSnapshotInfo();
      });

      // Gerenciar lista — abre modal
      const openManageModal = (listId) => {
        const list = lists.find(l=>l.id===listId);
        if (!list) return;
        const overlay   = panel.querySelector('#sqc-modal-overlay');
        const nameInput = panel.querySelector('#sqc-modal-name');
        const idsTA     = panel.querySelector('#sqc-modal-ids');
        const countEl   = panel.querySelector('#sqc-modal-count');
        const newIdsTA  = panel.querySelector('#sqc-modal-new-ids');
        const diffEl    = panel.querySelector('#sqc-modal-diff');

        nameInput.value     = list.name;
        idsTA.value         = list.ids.join('\n');
        countEl.textContent = list.ids.length;
        newIdsTA.value      = '';
        diffEl.innerHTML    = '';
        overlay.style.display = 'flex';
        nameInput.focus();

        // Atualiza contagem ao editar os IDs
        idsTA.oninput = () => { countEl.textContent = parseIds(idsTA.value).length; };

        // Fechar modal
        const closeModal = () => { overlay.style.display = 'none'; };
        panel.querySelector('#sqc-modal-close').onclick      = closeModal;
        panel.querySelector('#sqc-modal-btn-cancel').onclick = closeModal;
        overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

        // Comparar
        panel.querySelector('#sqc-modal-btn-compare').onclick = () => {
          const currentIds    = parseIds(idsTA.value);
          const newIds        = parseIds(newIdsTA.value);
          if (!newIds.length) { newIdsTA.focus(); return; }

          const currentSet    = new Set(currentIds);
          const newSet        = new Set(newIds);
          const onlyNew       = newIds.filter(id => !currentSet.has(id));
          const duplicates    = newIds.filter(id =>  currentSet.has(id));
          const onlyInCurrent = currentIds.filter(id => !newSet.has(id));
          const fmtIds = (arr) => arr.length <= 8
            ? arr.join(', ')
            : arr.slice(0,8).join(', ') + ` … (+${arr.length-8})`;

          diffEl.innerHTML = `
            <div class="sqc-mdiff-result">
              ${onlyNew.length    ? `<div class="sqc-mdiff-row new"><b>🆕 Novos (${onlyNew.length}):</b> ${fmtIds(onlyNew)}</div>` : '<div class="sqc-mdiff-row new">🆕 Nenhum ID novo</div>'}
              ${duplicates.length ? `<div class="sqc-mdiff-row dup"><b>🔁 Já na lista (${duplicates.length}):</b> ${fmtIds(duplicates)}</div>` : ''}
              ${onlyInCurrent.length ? `<div class="sqc-mdiff-row saved"><b>📌 Só na lista atual (${onlyInCurrent.length}):</b> ${fmtIds(onlyInCurrent)}</div>` : ''}
              <div class="sqc-mdiff-actions">
                ${onlyNew.length ? `<button class="sqc-btn-secondary" id="sqc-mdiff-add" style="color:#4ade80;border-color:rgba(74,222,128,.4);" title="Acrescenta os IDs novos à lista acima. O que já estava é preservado.">➕ Acrescentar ${onlyNew.length} novo${onlyNew.length!==1?'s':''} (preserva lista atual)</button>` : ''}
                <button class="sqc-btn-secondary" id="sqc-mdiff-replace" style="color:#fb923c;border-color:rgba(251,146,60,.4);" title="Substitui a lista pelos IDs do campo acima. ${onlyInCurrent.length} chamado${onlyInCurrent.length!==1?'s':''} da lista atual ${onlyInCurrent.length!==1?'serão removidos':'será removido'}.">🔄 Substituir lista pelos IDs do campo${onlyInCurrent.length ? ` (remove ${onlyInCurrent.length})` : ''}</button>
              </div>
            </div>`;

          diffEl.querySelector('#sqc-mdiff-add')?.addEventListener('click', () => {
            const merged = [...parseIds(idsTA.value), ...onlyNew];
            idsTA.value = merged.join('\n');
            countEl.textContent = merged.length;
            newIdsTA.value = '';
            diffEl.innerHTML = '';
          });

          diffEl.querySelector('#sqc-mdiff-replace')?.addEventListener('click', () => {
            const replaced = [...new Set(newIds)];
            if (onlyInCurrent.length && !confirm(`Substituir a lista?\n${onlyInCurrent.length} chamado${onlyInCurrent.length!==1?'s':''} serão removidos:\n${fmtIds(onlyInCurrent)}`)) return;
            idsTA.value = replaced.join('\n');
            countEl.textContent = replaced.length;
            newIdsTA.value = '';
            diffEl.innerHTML = '';
          });
        };

        // Salvar (nome + IDs editados diretamente)
        panel.querySelector('#sqc-modal-btn-save').onclick = () => {
          const newName = nameInput.value.trim();
          if (!newName) { nameInput.focus(); return; }
          const newIds = parseIds(idsTA.value);
          list.name   = newName;
          list.ids    = newIds;
          list.fields = [...fields];
          saveLists(lists);
          panel.querySelector('#sqc-ids').value = newIds.join('\n');
          updateIdsCount();
          refreshListSelect();
          refreshSnapshotInfo();
          closeModal();
        };

        // Excluir
        panel.querySelector('#sqc-modal-btn-delete').onclick = () => {
          if (!confirm(`Excluir a lista "${list.name}"?`)) return;
          lists = lists.filter(l=>l.id!==listId);
          saveLists(lists);
          activeListId = null;
          panel.querySelector('#sqc-ids').value = '';
          updateIdsCount();
          refreshListSelect();
          panel.querySelector('#sqc-list-snapshot-info').textContent = '';
          closeModal();
        };
      };

      panel.querySelector('#sqc-btn-manage-list').addEventListener('click', () => {
        if (!activeListId) { alert('Selecione uma lista primeiro.'); return; }
        openManageModal(activeListId);
      });

      // Salvar como lista (modo simples)
      panel.querySelector('#sqc-btn-save-list').addEventListener('click', () => {
        const name = prompt('Nome da nova lista:');
        if (!name?.trim()) return;
        const ids = parseIds(panel.querySelector('#sqc-ids').value);
        if (!ids.length) { alert('Nenhum ID válido.'); return; }
        const list = makeNewList(name.trim(), ids, [...fields]);
        lists.push(list);
        saveLists(lists);
        alert(`Lista "${list.name}" salva com ${ids.length} IDs.`);
      });

      // Checkboxes de campos
      const updateFieldsCount = () => {
        const el = panel.querySelector('#sqc-fields-count');
        if (el) el.textContent = `${fields.size}/${FIELD_DEFS.length} ativos`;
      };
      updateFieldsCount();

      panel.querySelectorAll('.sqc-field-cb').forEach(cb => {
        cb.addEventListener('change', () => {
          cb.checked ? fields.add(cb.dataset.key) : fields.delete(cb.dataset.key);
          cb.closest('.sqc-field-row').classList.toggle('is-checked', cb.checked);
          updateFieldsCount();
          if (activeListId) {
            const list = lists.find(l=>l.id===activeListId);
            if (list) { list.fields = [...fields]; saveLists(lists); }
          }
          if (lastResults.length) renderResults();
        });
      });

      // Contador de IDs
      panel.querySelector('#sqc-ids').addEventListener('input', updateIdsCount);

      // Collapsibles + remover card individual
      panel.querySelector('#sqc-results-area').addEventListener('click', e => {
        // Toggle collapsible
        const toggleBtn = e.target.closest('.sqc-toggle');
        if (toggleBtn) {
          const content = panel.querySelector('#'+toggleBtn.dataset.target);
          if (!content) return;
          const open = content.classList.toggle('open');
          toggleBtn.classList.toggle('open', open);
          toggleBtn.textContent = (open?'▾ ':'▸ ') + toggleBtn.textContent.replace(/^[▸▾] /,'');
          return;
        }

        // Remover chamado da lista
        const removeBtn = e.target.closest('.sqc-remove-btn[data-remove-id]');
        if (!removeBtn) return;
        const ticketId = removeBtn.dataset.removeId;
        if (!ticketId) return;
        if (!confirm(`Remover o chamado #${ticketId} da lista?`)) return;

        // Remove do textarea
        const textarea = panel.querySelector('#sqc-ids');
        const remaining = parseIds(textarea.value).filter(id => id !== ticketId);
        textarea.value = remaining.join('\n');
        updateIdsCount();

        // Atualiza lista salva se houver uma ativa
        if (activeListId) {
          const list = lists.find(l => l.id === activeListId);
          if (list) {
            list.ids = remaining;
            saveLists(lists);
            refreshListSelect();
          }
        }

        // Atualiza estado interno
        const idx = lastIds.indexOf(ticketId);
        if (idx !== -1) {
          lastIds.splice(idx, 1);
          lastResults.splice(idx, 1);
          if (lastChanges) delete lastChanges[ticketId];
        }
        const cidx = lastClosedIds.indexOf(ticketId);
        if (cidx !== -1) lastClosedIds.splice(cidx, 1);

        // Atualiza botão bulk se existir
        const bulkBtn = panel.querySelector('#sqc-btn-remove-closed');
        if (bulkBtn) {
          if (lastClosedIds.length > 0) {
            bulkBtn.textContent = `🗑️ Remover ${lastClosedIds.length} encerrado${lastClosedIds.length !== 1 ? 's' : ''} da lista`;
          } else {
            bulkBtn.style.display = 'none';
          }
        }

        renderResults();
        renderSummary();
      });

      // Sort + filter
      panel.querySelector('#sqc-sort-select').addEventListener('change', e => {
        sortMode = e.target.value;
        if (lastResults.length) renderResults();
      });
      panel.querySelector('#sqc-filter-input').addEventListener('input', e => {
        filterText = e.target.value;
        if (lastResults.length) renderResults();
      });

      // Auto-refresh toggle
      panel.querySelector('#sqc-ar-cb').addEventListener('change', e => {
        if (e.target.checked) {
          const secs = Number(panel.querySelector('#sqc-autorefresh-interval').value) || 60;
          startAutoRefresh(secs);
        } else {
          stopAutoRefresh();
        }
      });
      panel.querySelector('#sqc-autorefresh-interval').addEventListener('change', () => {
        const cb = panel.querySelector('#sqc-ar-cb');
        if (cb.checked) {
          const secs = Number(panel.querySelector('#sqc-autorefresh-interval').value) || 60;
          startAutoRefresh(secs);
        }
      });

      // Remover encerrados da lista
      panel.querySelector('#sqc-btn-remove-closed').addEventListener('click', () => {
        if (!lastClosedIds.length) return;
        const n = lastClosedIds.length;
        const msg = `Remover ${n} chamado${n !== 1 ? 's' : ''} encerrado${n !== 1 ? 's' : ''} da lista?\n\nIDs: ${lastClosedIds.join(', ')}`;
        if (!confirm(msg)) return;

        const closedSet = new Set(lastClosedIds);

        // Atualiza textarea
        const textarea = panel.querySelector('#sqc-ids');
        const remaining = parseIds(textarea.value).filter(id => !closedSet.has(id));
        textarea.value = remaining.join('\n');
        updateIdsCount();

        // Atualiza lista salva se houver uma ativa
        if (activeListId) {
          const list = lists.find(l => l.id === activeListId);
          if (list) {
            list.ids = remaining;
            saveLists(lists);
            refreshListSelect();
          }
        }

        // Atualiza estado interno (lastIds / lastResults / lastChanges)
        const kept = lastIds.map((id, i) => ({ id, i })).filter(({ id }) => !closedSet.has(id));
        lastIds     = kept.map(x => x.id);
        lastResults = kept.map(x => lastResults[x.i]);
        if (lastChanges) {
          const newChanges = {};
          lastIds.forEach(id => { if (lastChanges[id]) newChanges[id] = lastChanges[id]; });
          lastChanges = newChanges;
        }
        lastClosedIds = [];

        // Esconde o botão e atualiza resultados
        panel.querySelector('#sqc-btn-remove-closed').style.display = 'none';
        renderResults();
        renderSummary();
      });

      // Consultar
      panel.querySelector('#sqc-btn-fetch').addEventListener('click', runQuery);

      // Exports — consulta
      const fname = () => `consulta_${todayStr().replace(/\//g,'-')}`;
      const activeList = () => activeListId ? lists.find(l=>l.id===activeListId) : null;
      panel.querySelector('#sqc-btn-word').addEventListener('click', () => {
        if (!lastResults.length) return;
        downloadFile(buildWordHtml(lastResults,lastIds,lastChanges,activeList()?.name), `${fname()}.doc`, 'application/msword');
      });
      panel.querySelector('#sqc-btn-excel').addEventListener('click', () => {
        if (!lastResults.length) return;
        downloadFile(buildExcelHtml(lastResults,lastIds), `${fname()}.xls`, 'application/vnd.ms-excel');
      });
      panel.querySelector('#sqc-btn-pdf-consulta').addEventListener('click', () => {
        if (!lastResults.length) return;
        printAsPdf(buildWordHtml(lastResults,lastIds,lastChanges,activeList()?.name));
      });
      panel.querySelector('#sqc-btn-md').addEventListener('click', () => {
        if (!lastResults.length) return;
        downloadFile(buildMarkdown(lastResults,lastIds,lastChanges,activeList()?.name), `${fname()}.md`, 'text/markdown');
      });
      // Exports — relatório
      panel.querySelector('#sqc-btn-rel-word').addEventListener('click', () => {
        if (!lastResults.length) return;
        downloadFile(buildRelatorioWord(lastResults,lastIds,lastChanges,activeList()?.name), `relatorio_${fname()}.doc`, 'application/msword');
      });
      panel.querySelector('#sqc-btn-rel-excel').addEventListener('click', () => {
        if (!lastResults.length) return;
        downloadFile(buildExcelRelatorioHtml(lastResults,lastIds,lastChanges), `relatorio_${fname()}.xls`, 'application/vnd.ms-excel');
      });
      panel.querySelector('#sqc-btn-pdf').addEventListener('click', () => {
        if (!lastResults.length) return;
        printAsPdf(buildRelatorioWord(lastResults,lastIds,lastChanges,activeList()?.name));
      });
      panel.querySelector('#sqc-btn-rel-md').addEventListener('click', () => {
        if (!lastResults.length) return;
        downloadFile(buildRelatorioMd(lastResults,lastIds,lastChanges,activeList()?.name), `relatorio_${fname()}.md`, 'text/markdown');
      });

      refreshListSelect();
    }
    panel.style.display = 'flex';
    // Limpar notificação de auto-refresh ao abrir o painel
    document.title = originalDocTitle;
    document.querySelector('#sqc-topbar-btn')?.classList.remove('alert');
  };

  const updateIdsCount = () => {
    const ids = parseIds(panel?.querySelector('#sqc-ids')?.value||'');
    const el = panel?.querySelector('#sqc-ids-count');
    if (el) el.textContent = ids.length ? `${ids.length} ID${ids.length!==1?'s':''} detectado${ids.length!==1?'s':''}` : '';
  };

  // ══════════════════════════════════════════════════════════════════
  // BOTÃO DE ACESSO + ATALHO
  // ══════════════════════════════════════════════════════════════════

  const topBtn = document.createElement('button');
  topBtn.id = 'sqc-topbar-btn';
  topBtn.textContent = '🔍 Consulta de Chamados';
  topBtn.addEventListener('click', openPanel);
  document.body.appendChild(topBtn);

  // Ctrl+Shift+Q abre sem precisar clicar no botão
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='q') {
      e.preventDefault();
      if (!panel || panel.style.display==='none') openPanel();
      else { panel.style.display='none'; stopAutoRefresh(); }
    }
  });

})();
