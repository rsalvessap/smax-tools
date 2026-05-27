// ==UserScript==
// @name         SMAX Consulta de Chamados - TJSP
// @namespace    https://github.com/rsalvessap/SMAX-TOOLS
// @version      1.03
// @description  Consulta detalhada de chamados SMAX por lista de IDs. Exporta em Word, Markdown e CSV.
// @author       rsalvessap
// @match        https://suporte.tjsp.jus.br/saw/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  // ─── Constantes ──────────────────────────────────────────────────────────────

  const STORAGE_KEY    = 'smax_consulta_pos';
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

  // ─── Tenant ID ───────────────────────────────────────────────────────────────

  const getTenantId = () => {
    const fromCookie = document.cookie.match(/TENANTID=(\d+)/i);
    if (fromCookie) return fromCookie[1];
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('TENANTID') || params.get('tenantid');
    if (fromUrl) return fromUrl;
    const fromHash = (location.hash || '').match(/tenantid=(\d+)/i);
    if (fromHash) return fromHash[1];
    try {
      const s = sessionStorage.getItem('smaxTenantId') || localStorage.getItem('smaxTenantId');
      if (s) return s;
    } catch {}
    return (window.SMAX_TENANT_ID || window.globalTenantId || '').toString();
  };

  // ─── API ─────────────────────────────────────────────────────────────────────

  const fetchTicket = async (id) => {
    const tenantId = getTenantId();
    if (!tenantId) throw new Error('Tenant ID não encontrado. Acesse um chamado primeiro.');
    const url = `/rest/${tenantId}/ems/Request/${encodeURIComponent(id.trim())}` +
      `?layout=FULL_LAYOUT,RELATION_LAYOUT.item&TENANTID=${tenantId}`;
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}${body ? ': ' + body.substring(0, 120) : ''}`);
    }
    return resp.json();
  };

  // ─── Extração de dados ───────────────────────────────────────────────────────

  const htmlToText = (html) => {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
  };

  const fmtDate = (ts) => {
    if (!ts) return '—';
    return new Date(Number(ts)).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const fmtDateShort = (ts) => {
    if (!ts) return '—';
    return new Date(Number(ts)).toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  };

  const fmtSccd = (raw) => {
    if (!raw) return '—';
    return raw.replace(/_c$/i, '').replace(/([A-Z])/g, ' $1').trim();
  };

  const extractTicketData = (payload, id) => {
    let ent = {};
    if (Array.isArray(payload?.entities) && payload.entities.length) ent = payload.entities[0];
    else if (payload?.entity_type) ent = payload;
    const props = ent.properties        || {};
    const rel   = ent.related_properties || {};

    const ticketId    = String(props.Id || id || '');
    const subject     = (props.DisplayLabel || props.Subject || props.Title || '').trim();
    const statusRaw   = props.Status || '';
    const statusLabel = STATUS_LABELS[statusRaw] || statusRaw || '—';
    const statusColor = STATUS_COLORS[statusRaw] || '#6b7280';
    const statusEmoji = STATUS_EMOJI[statusRaw]  || '🔴';

    const statusSCCDRaw   = props.StatusSCCDSMAX_c || '';
    const statusSCCDLabel = statusSCCDRaw ? fmtSccd(statusSCCDRaw) : '—';

    const createTime     = fmtDate(props.CreateTime);
    const lastUpdateTime = fmtDate(props.LastUpdateTime);

    const globalRel  = rel.GlobalId_c || {};
    const globalId   = globalRel.Id   ? String(globalRel.Id)   : '';
    const globalName = globalRel.Name ? String(globalRel.Name) : '';
    const isGlobal   = !!globalId;

    const requestedFor = rel.RequestedForPerson?.DisplayLabel
      || rel.RequestedForPerson?.Name
      || String(props.RequestedForPerson || props.RequestedForDisplayLabel || '') || '—';

    const group = rel.ExpertGroup?.Name
      || rel.AssignedToGroup?.Name
      || rel.ExpertGroup?.DisplayLabel || '—';

    const assignee = rel.ExpertAssignee?.Name
      || rel.ExpertAssignee?.DisplayLabel
      || (props.ExpertAssignee ? `#${props.ExpertAssignee}` : '—');

    const descHtml     = props.Description || '';
    const solutionHtml = props.Solution    || '';

    let lastComments = [];
    if (props.Comments) {
      try {
        const parsed = typeof props.Comments === 'string' ? JSON.parse(props.Comments) : props.Comments;
        const all = Array.isArray(parsed?.Comment) ? parsed.Comment : [];
        const userComments = all.filter(c => !c.IsSystem);
        userComments.sort((a, b) => (Number(b.CreateTime) || 0) - (Number(a.CreateTime) || 0));
        lastComments = userComments.slice(0, 3).map(c => ({
          body    : c.CommentBody || '',
          bodyText: htmlToText(c.CommentBody || ''),
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
      createTime, lastUpdateTime,
      isGlobal, globalId, globalName,
      requestedFor, group, assignee,
      descHtml, solutionHtml, lastComments,
    };
  };

  // ─── Concorrência ────────────────────────────────────────────────────────────

  const runConcurrent = async (items, fn, concurrency, onProgress) => {
    const results = new Array(items.length);
    let idx = 0;
    const worker = async () => {
      while (idx < items.length) {
        const i = idx++;
        try   { results[i] = { ok: true,  data: await fn(items[i]) }; }
        catch (e) { results[i] = { ok: false, error: e.message, id: items[i] }; }
        onProgress(results.filter(Boolean).length, items.length);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  };

  // ─── Export: Markdown ────────────────────────────────────────────────────────

  const buildMarkdown = (results, ids) => {
    const today = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const lines = [`# Consulta de Chamados SMAX — ${today}`, '', '---', ''];
    ids.forEach((id, i) => {
      const r = results[i];
      if (!r) return;
      if (!r.ok) {
        lines.push(`❌ **${id}** — Erro: ${r.error || 'desconhecido'}`, '', '&nbsp;', '', '---', '', '&nbsp;', '');
        return;
      }
      const d = r.data;
      const globalPart  = d.isGlobal ? ` — Global pai: #${d.globalId}` : '';
      const subjectPart = d.subject  ? ` — ${d.subject}` : '';
      lines.push(`${d.statusEmoji} **${d.ticketId}**${subjectPart}${globalPart}`);
      lines.push([
        `**Status:** ${d.statusLabel}`,
        `**Status Operacional:** ${d.statusSCCDLabel}`,
        `**GSE:** ${d.group}`,
        `**Especialista:** ${d.assignee}`,
        `**Solicitante:** ${d.requestedFor}`,
        `**Abertura:** ${d.createTime}`,
        `**Última atualização:** ${d.lastUpdateTime}`,
      ].join(' | '), '');
      if (!d.lastComments.length) {
        lines.push('*Sem comentários registrados.*', '');
      } else {
        [...d.lastComments].sort((a, b) => a.ts - b.ts).forEach(c => {
          lines.push(`> **${c.from || 'Agente'} | ${c.date}**`);
          (c.bodyText || '').split(/\n/).map(l => l.trim()).filter(Boolean)
            .forEach(l => lines.push(`> ${l}`));
          if (!c.bodyText) lines.push('> *(sem texto)*');
          lines.push('');
        });
      }
      lines.push('&nbsp;', '', '---', '', '&nbsp;', '');
    });
    return lines.join('\n');
  };

  // ─── Export: CSV ─────────────────────────────────────────────────────────────

  const buildCsv = (results, ids) => {
    const cols = ['ID','Assunto','Status','Status Operacional','Abertura','Últ. Atualização',
      'É Global','Global Pai','Solicitante','Grupo','Especialista',
      'Descrição (texto)','Solução (texto)','Comentário 1','Comentário 2','Comentário 3'];
    const e = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    const comText = (c) => c ? `[${c.date}] ${c.from}: ${c.bodyText}` : '';
    const rows = ids.map((id, i) => {
      const r = results[i];
      if (!r?.ok) return [id, 'ERRO: ' + (r?.error || ''), ...Array(cols.length - 2).fill('')].map(e).join(',');
      const d = r.data;
      return [
        d.ticketId, d.subject, d.statusLabel, d.statusSCCDLabel,
        d.createTime, d.lastUpdateTime,
        d.isGlobal ? 'Sim' : 'Não', d.globalId,
        d.requestedFor, d.group, d.assignee,
        htmlToText(d.descHtml), htmlToText(d.solutionHtml),
        comText(d.lastComments[2]), comText(d.lastComments[1]), comText(d.lastComments[0]),
      ].map(e).join(',');
    });
    return [cols.map(e).join(','), ...rows].join('\r\n');
  };

  // ─── Export: Word (.doc HTML) ─────────────────────────────────────────────────

  const buildWordHtml = (results, ids) => {
    const today = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });

    const ticketBlocks = ids.map((id, i) => {
      const r = results[i];
      if (!r) return `<p><b style="color:#c00">❌ ${id}</b> — Sem resposta.</p><hr>`;
      if (!r.ok) return `<p><b style="color:#c00">❌ ${id}</b> — Erro: ${r.error || 'desconhecido'}</p><hr>`;
      const d = r.data;

      const globalInfo = d.isGlobal
        ? `<span style="color:#c00;font-weight:bold;"> — Global pai: #${d.globalId}</span>`
        : '';

      const commentsHtml = d.lastComments.length === 0
        ? '<p style="color:#888;font-style:italic;margin:4pt 0 4pt 20pt;">Sem comentários registrados.</p>'
        : [...d.lastComments].sort((a, b) => a.ts - b.ts).map(c => `
            <table style="border-left:3pt solid #3b82f6;margin:6pt 0 6pt 12pt;width:95%;" cellpadding="0" cellspacing="0">
              <tr><td style="padding:4pt 10pt;">
                <p style="margin:0;font-size:9pt;color:#555;">
                  <b>${c.from || 'Agente'}</b> &nbsp;|&nbsp; ${c.date}
                  &nbsp;<span style="color:#7c3aed;font-size:8pt;">${c.privacy}</span>
                </p>
                <div style="margin-top:4pt;font-size:10pt;color:#1e293b;">${c.body || '<em>(sem texto)</em>'}</div>
              </td></tr>
            </table>`).join('');

      const descBlock = d.descHtml
        ? `<div style="background:#f8fafc;border:1pt solid #e2e8f0;border-radius:4pt;padding:8pt 12pt;margin:6pt 0;font-size:10pt;color:#1e293b;">${d.descHtml}</div>`
        : '<p style="color:#888;font-style:italic;font-size:10pt;">Sem descrição.</p>';

      const solBlock = d.solutionHtml
        ? `<div style="background:#f0fdf4;border:1pt solid #bbf7d0;border-radius:4pt;padding:8pt 12pt;margin:6pt 0;font-size:10pt;color:#14532d;">${d.solutionHtml}</div>`
        : '<p style="color:#888;font-style:italic;font-size:10pt;">Sem solução registrada.</p>';

      return `
        <div style="margin-bottom:18pt;page-break-inside:avoid;">
          <p style="margin:0 0 4pt 0;font-size:13pt;font-weight:bold;color:#1e3a5f;">
            ${d.statusEmoji} <span style="color:#1d4ed8;">#${d.ticketId}</span>
            ${d.subject ? `<span style="color:#374151;font-size:11pt;font-weight:normal;"> — ${d.subject}</span>` : ''}
            ${globalInfo}
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:8pt;" cellpadding="3" cellspacing="0">
            <tr style="background:#f1f5f9;">
              <td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Status</b><br>${d.statusLabel}</td>
              <td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Status Operacional</b><br>${d.statusSCCDLabel}</td>
              <td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>GSE</b><br>${d.group}</td>
              <td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Especialista</b><br>${d.assignee}</td>
            </tr>
            <tr>
              <td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Solicitante</b><br>${d.requestedFor}</td>
              <td style="border:1pt solid #e2e8f0;padding:4pt 8pt;"><b>Abertura</b><br>${d.createTime}</td>
              <td style="border:1pt solid #e2e8f0;padding:4pt 8pt;" colspan="2"><b>Última atualização</b><br>${d.lastUpdateTime}</td>
            </tr>
          </table>

          <p style="margin:6pt 0 2pt;font-size:9pt;font-weight:bold;color:#475569;text-transform:uppercase;letter-spacing:.5pt;">Descrição</p>
          ${descBlock}

          <p style="margin:6pt 0 2pt;font-size:9pt;font-weight:bold;color:#475569;text-transform:uppercase;letter-spacing:.5pt;">Solução</p>
          ${solBlock}

          <p style="margin:6pt 0 2pt;font-size:9pt;font-weight:bold;color:#475569;text-transform:uppercase;letter-spacing:.5pt;">Últimos comentários</p>
          ${commentsHtml}
          <hr style="border:none;border-top:1pt solid #e2e8f0;margin:12pt 0 0;">
        </div>`;
    }).join('');

    return `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
      <head>
        <meta charset="utf-8">
        <title>Consulta de Chamados SMAX — ${today}</title>
        <style>
          body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1e293b; margin: 2cm; }
          p { margin: 0 0 4pt; line-height: 1.5; }
          img { max-width: 100%; height: auto; }
          table { border-collapse: collapse; }
          hr { border: none; border-top: 1pt solid #e2e8f0; }
        </style>
      </head>
      <body>
        <h1 style="color:#1e3a5f;font-size:18pt;margin:0 0 4pt;">Consulta de Chamados SMAX</h1>
        <p style="color:#64748b;font-size:10pt;margin:0 0 18pt;">${today} &nbsp;·&nbsp; ${ids.length} chamado${ids.length !== 1 ? 's' : ''}</p>
        <hr style="border:none;border-top:2pt solid #1d4ed8;margin:0 0 18pt;">
        ${ticketBlocks}
      </body>
      </html>`;
  };

  // ─── Download ─────────────────────────────────────────────────────────────────

  const downloadFile = (content, filename, mime) => {
    const blob = new Blob(['\uFEFF' + content], { type: mime + ';charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // ─── CSS ─────────────────────────────────────────────────────────────────────

  GM_addStyle(`
    /* Botão de acesso no topo */
    #sqc-topbar-btn {
      position:fixed; top:10px; left:50%; transform:translateX(-50%);
      z-index:2147483640; padding:5px 18px; border:none; border-radius:20px;
      background:linear-gradient(135deg,#3b82f6,#1d4ed8); color:#fff;
      font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      box-shadow:0 2px 12px rgba(59,130,246,.5);
      transition:box-shadow .15s, transform .15s;
    }
    #sqc-topbar-btn:hover { box-shadow:0 4px 20px rgba(59,130,246,.65); transform:translateX(-50%) scale(1.04); }

    /* Painel tela cheia */
    #sqc-panel {
      position:fixed; inset:0; z-index:2147483639;
      background:#0d1117; display:flex; flex-direction:column; overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px; color:#e5e7eb;
    }

    /* Header */
    #sqc-header {
      display:flex; align-items:center; gap:12px; padding:10px 20px;
      border-bottom:1px solid rgba(255,255,255,.08); flex-shrink:0;
      background:rgba(255,255,255,.03);
    }
    #sqc-title { font-size:15px; font-weight:700; color:#e2e8f0; }
    #sqc-last-query { font-size:10px; color:#4b5563; margin-left:4px; }
    #sqc-header-spacer { flex:1; }
    #sqc-close {
      border:1px solid rgba(255,255,255,.2); background:rgba(0,0,0,.3);
      color:rgba(255,255,255,.8); font-size:14px; width:30px; height:30px;
      border-radius:6px; cursor:pointer;
    }
    #sqc-close:hover { background:rgba(248,113,113,.2); border-color:#f87171; color:#f87171; }

    /* Layout principal: sidebar + resultados */
    #sqc-main { display:flex; flex:1; overflow:hidden; }

    /* Sidebar */
    #sqc-sidebar {
      width:260px; flex-shrink:0; display:flex; flex-direction:column; gap:10px;
      padding:16px; border-right:1px solid rgba(255,255,255,.07);
      background:rgba(255,255,255,.02); overflow-y:auto;
    }
    #sqc-sidebar-title { font-size:11px; font-weight:600; color:#6b7280; text-transform:uppercase; letter-spacing:.07em; }
    #sqc-ids {
      width:100%; box-sizing:border-box; flex:0 0 auto;
      min-height:140px; max-height:260px; resize:vertical;
      background:#0a0f1e; border:1px solid rgba(255,255,255,.15); border-radius:8px;
      color:#e2e8f0; font-size:12px; font-family:monospace; padding:8px 10px; outline:none;
    }
    #sqc-ids:focus { border-color:#3b82f6; }
    #sqc-ids::placeholder { color:#374151; }

    .sqc-btn-primary {
      width:100%; padding:10px 0; border:none; border-radius:8px;
      background:linear-gradient(135deg,#3b82f6,#1d4ed8); color:#fff;
      font-size:13px; font-weight:700; cursor:pointer;
    }
    .sqc-btn-primary:hover:not(:disabled) { background:linear-gradient(135deg,#60a5fa,#3b82f6); }
    .sqc-btn-primary:disabled { opacity:.45; cursor:default; }

    #sqc-export-section { display:none; flex-direction:column; gap:6px; }
    #sqc-export-section.visible { display:flex; }
    #sqc-export-label { font-size:10px; font-weight:600; color:#6b7280; text-transform:uppercase; letter-spacing:.07em; margin-top:4px; }
    .sqc-btn-export {
      width:100%; padding:8px 0; border:1px solid rgba(255,255,255,.15); border-radius:8px;
      background:rgba(255,255,255,.05); color:#d1d5db;
      font-size:12px; font-weight:600; cursor:pointer; transition:all .12s;
    }
    .sqc-btn-export:hover { border-color:#3b82f6; color:#60a5fa; background:rgba(59,130,246,.1); }

    #sqc-progress { font-size:11px; color:#6b7280; min-height:14px; }

    /* Área de resultados */
    #sqc-results-area {
      flex:1; overflow-y:auto; padding:16px 20px;
      display:flex; flex-direction:column; gap:12px;
    }
    #sqc-results-area::-webkit-scrollbar { width:6px; }
    #sqc-results-area::-webkit-scrollbar-thumb { background:rgba(255,255,255,.1); border-radius:10px; }
    #sqc-placeholder { color:#374151; font-size:13px; text-align:center; margin-top:80px; }

    /* Cards */
    .sqc-card {
      border:1px solid rgba(255,255,255,.08); border-radius:10px;
      background:rgba(15,23,42,.8); padding:14px 16px;
    }
    .sqc-card-error { border-color:rgba(248,113,113,.25); background:rgba(248,113,113,.04); }
    .sqc-card-header { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
    .sqc-ticket-id { font-size:16px; font-weight:800; color:#60a5fa; text-decoration:none; flex-shrink:0; }
    .sqc-ticket-id:hover { text-decoration:underline; }
    .sqc-subject { font-size:12px; color:#94a3b8; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sqc-badges  { display:flex; gap:5px; flex-wrap:wrap; flex-shrink:0; }
    .sqc-badge   { font-size:10px; padding:2px 8px; border-radius:12px; border:1px solid rgba(255,255,255,.2); color:#9ca3af; }
    .sqc-badge-sccd   { color:#a78bfa; border-color:rgba(167,139,250,.35); }
    .sqc-badge-global { color:#f87171; border-color:rgba(248,113,113,.35); }
    .sqc-badge-local  { color:#374151; border-color:rgba(75,85,99,.2); }

    .sqc-meta-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:6px 14px; margin-bottom:10px; }
    .sqc-meta-item  { display:flex; flex-direction:column; gap:1px; }
    .sqc-meta-label { font-size:9px; color:#6b7280; text-transform:uppercase; letter-spacing:.06em; }
    .sqc-meta-val   { font-size:12px; color:#d1d5db; }

    .sqc-section { border-top:1px solid rgba(255,255,255,.05); padding-top:7px; margin-top:7px; }
    .sqc-toggle  { background:none; border:none; color:#6b7280; font-size:11px; cursor:pointer; padding:0; text-align:left; }
    .sqc-toggle:hover { color:#94a3b8; }
    .sqc-toggle.open  { color:#93c5fd; }
    .sqc-collapsible { display:none; margin-top:8px; font-size:12px; color:#d1d5db; line-height:1.6; max-height:320px; overflow-y:auto; }
    .sqc-collapsible.open { display:block; }
    .sqc-collapsible img { max-width:100%; border-radius:6px; display:block; margin:4px 0; }
    .sqc-collapsible p   { margin:0 0 6px; }
    .sqc-collapsible ul,.sqc-collapsible ol { margin:0 0 6px; padding-left:18px; }

    .sqc-comment      { border-left:2px solid rgba(59,130,246,.35); padding:6px 10px; margin-bottom:6px; }
    .sqc-comment-meta { display:flex; gap:10px; font-size:10px; color:#6b7280; margin-bottom:4px; flex-wrap:wrap; }
    .sqc-privacy { background:rgba(167,139,250,.1); border-radius:4px; padding:0 5px; color:#a78bfa; }
    .sqc-empty   { font-size:11px; color:#6b7280; font-style:italic; }
  `);

  // ─── HTML do painel ───────────────────────────────────────────────────────────

  const buildPanel = () => {
    const panel = document.createElement('div');
    panel.id = 'sqc-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div id="sqc-header">
        <span id="sqc-title">🔍 Consulta de Chamados SMAX</span>
        <span id="sqc-last-query"></span>
        <div id="sqc-header-spacer"></div>
        <button id="sqc-close" title="Fechar (Esc)">✕</button>
      </div>
      <div id="sqc-main">
        <div id="sqc-sidebar">
          <div class="sqc-sidebar-title">IDs dos chamados</div>
          <textarea id="sqc-ids" placeholder="Cole os IDs aqui&#10;(um por linha, vírgula ou espaço)"></textarea>
          <button class="sqc-btn-primary" id="sqc-btn-fetch">🔍 Consultar</button>
          <div id="sqc-progress"></div>

          <div id="sqc-export-section">
            <div id="sqc-export-label">Exportar resultados</div>
            <button class="sqc-btn-export" id="sqc-btn-word">📄 Word (.doc)</button>
            <button class="sqc-btn-export" id="sqc-btn-md">📝 Markdown (.md)</button>
            <button class="sqc-btn-export" id="sqc-btn-csv">📊 CSV (.csv)</button>
          </div>
        </div>

        <div id="sqc-results-area">
          <div id="sqc-placeholder">Cole os IDs dos chamados ao lado e clique em <b>Consultar</b>.</div>
        </div>
      </div>`;
    return panel;
  };

  // ─── Cards ────────────────────────────────────────────────────────────────────

  const esc = (s) => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const buildCard = (d) => {
    const globalBadge = d.isGlobal
      ? `<span class="sqc-badge sqc-badge-global" title="${esc(d.globalName)}">⬆ Global #${esc(d.globalId)}</span>`
      : `<span class="sqc-badge sqc-badge-local">Local</span>`;

    const commentsHtml = !d.lastComments.length
      ? '<div class="sqc-empty">Sem comentários de usuário/agente.</div>'
      : [...d.lastComments].sort((a,b) => a.ts - b.ts).map(c => `
          <div class="sqc-comment">
            <div class="sqc-comment-meta">
              <span>${esc(c.from)}</span><span>${esc(c.date)}</span>
              <span class="sqc-privacy">${esc(c.privacy)}</span>
            </div>
            <div>${c.body}</div>
          </div>`).join('');

    return `
      <div class="sqc-card">
        <div class="sqc-card-header">
          <span style="font-size:17px;">${d.statusEmoji}</span>
          <a class="sqc-ticket-id" href="https://suporte.tjsp.jus.br/saw/Request/${esc(d.ticketId)}/general" target="_blank">#${esc(d.ticketId)}</a>
          ${d.subject ? `<span class="sqc-subject" title="${esc(d.subject)}">${esc(d.subject)}</span>` : ''}
          <div class="sqc-badges">
            <span class="sqc-badge" style="border-color:${d.statusColor};color:${d.statusColor};">${esc(d.statusLabel)}</span>
            <span class="sqc-badge sqc-badge-sccd">${esc(d.statusSCCDLabel)}</span>
            ${globalBadge}
          </div>
        </div>
        <div class="sqc-meta-grid">
          <div class="sqc-meta-item"><span class="sqc-meta-label">Solicitante</span><span class="sqc-meta-val">${esc(d.requestedFor)}</span></div>
          <div class="sqc-meta-item"><span class="sqc-meta-label">Grupo</span><span class="sqc-meta-val">${esc(d.group)}</span></div>
          <div class="sqc-meta-item"><span class="sqc-meta-label">Especialista</span><span class="sqc-meta-val">${esc(d.assignee)}</span></div>
          <div class="sqc-meta-item"><span class="sqc-meta-label">Abertura</span><span class="sqc-meta-val">${esc(d.createTime)}</span></div>
          <div class="sqc-meta-item"><span class="sqc-meta-label">Últ. atualização</span><span class="sqc-meta-val">${esc(d.lastUpdateTime)}</span></div>
        </div>
        <div class="sqc-section">
          <button class="sqc-toggle" data-target="sqc-desc-${esc(d.ticketId)}">▸ Descrição</button>
          <div class="sqc-collapsible" id="sqc-desc-${esc(d.ticketId)}">${d.descHtml || '<em style="color:#6b7280">Sem descrição.</em>'}</div>
        </div>
        <div class="sqc-section">
          <button class="sqc-toggle" data-target="sqc-sol-${esc(d.ticketId)}">▸ Solução</button>
          <div class="sqc-collapsible" id="sqc-sol-${esc(d.ticketId)}">${d.solutionHtml || '<em style="color:#6b7280">Sem solução registrada.</em>'}</div>
        </div>
        <div class="sqc-section">
          <button class="sqc-toggle" data-target="sqc-com-${esc(d.ticketId)}">▸ Últimos comentários (${d.lastComments.length})</button>
          <div class="sqc-collapsible" id="sqc-com-${esc(d.ticketId)}">${commentsHtml}</div>
        </div>
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

  // ─── Lógica principal ─────────────────────────────────────────────────────────

  let panel       = null;
  let lastResults = [];
  let lastIds     = [];

  const parseIds = (text) =>
    text.split(/[\n,;\s]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s));

  const openPanel = () => {
    if (!panel) {
      panel = buildPanel();
      document.body.appendChild(panel);

      // Fechar
      panel.querySelector('#sqc-close').addEventListener('click', closePanel);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel?.style.display !== 'none') closePanel(); });

      // Toggle colapsável
      panel.querySelector('#sqc-results-area').addEventListener('click', (e) => {
        const btn = e.target.closest('.sqc-toggle');
        if (!btn) return;
        const content = panel.querySelector('#' + btn.dataset.target);
        if (!content) return;
        const open = content.classList.toggle('open');
        btn.classList.toggle('open', open);
        btn.textContent = (open ? '▾ ' : '▸ ') + btn.textContent.replace(/^[▸▾] /, '');
      });

      // Consultar
      panel.querySelector('#sqc-btn-fetch').addEventListener('click', runQuery);

      // Exportar
      panel.querySelector('#sqc-btn-word').addEventListener('click', () => {
        if (!lastResults.length) return;
        const today = new Date().toISOString().slice(0,10);
        downloadFile(buildWordHtml(lastResults, lastIds), `consulta_chamados_${today}.doc`, 'application/msword');
      });
      panel.querySelector('#sqc-btn-md').addEventListener('click', () => {
        if (!lastResults.length) return;
        const today = new Date().toISOString().slice(0,10);
        downloadFile(buildMarkdown(lastResults, lastIds), `consulta_chamados_${today}.md`, 'text/markdown');
      });
      panel.querySelector('#sqc-btn-csv').addEventListener('click', () => {
        if (!lastResults.length) return;
        const today = new Date().toISOString().slice(0,10);
        downloadFile(buildCsv(lastResults, lastIds), `consulta_chamados_${today}.csv`, 'text/csv');
      });

      // Última consulta salva
      const lastQuery = GM_getValue(LAST_QUERY_KEY, '');
      const lastEl = panel.querySelector('#sqc-last-query');
      if (lastEl && lastQuery) lastEl.textContent = `Última consulta: ${lastQuery}`;
    }
    panel.style.display = 'flex';
  };

  const closePanel = () => { if (panel) panel.style.display = 'none'; };

  const runQuery = async () => {
    const ids = parseIds(panel.querySelector('#sqc-ids').value.trim());
    if (!ids.length) {
      panel.querySelector('#sqc-progress').textContent = 'Nenhum ID válido encontrado.';
      return;
    }

    const fetchBtn     = panel.querySelector('#sqc-btn-fetch');
    const exportSec    = panel.querySelector('#sqc-export-section');
    const progressEl   = panel.querySelector('#sqc-progress');
    const resultsArea  = panel.querySelector('#sqc-results-area');

    fetchBtn.disabled = true;
    exportSec.classList.remove('visible');
    resultsArea.innerHTML = '';
    lastResults = [];
    lastIds = ids;
    progressEl.textContent = `Consultando… 0/${ids.length}`;

    const fetched = await runConcurrent(
      ids,
      async (id) => extractTicketData(await fetchTicket(id), id),
      CONCURRENCY,
      (done, total) => { progressEl.textContent = `Consultando… ${done}/${total}`; }
    );

    lastResults = fetched;
    resultsArea.innerHTML = ids.map((id, i) => {
      const r = fetched[i];
      if (!r)    return buildErrorCard(id, 'Sem resposta.');
      if (!r.ok) return buildErrorCard(id, r.error || 'Erro desconhecido.');
      return buildCard(r.data);
    }).join('');

    const ok  = fetched.filter(r => r?.ok).length;
    const err = fetched.length - ok;
    const now = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    GM_setValue(LAST_QUERY_KEY, now);
    const lastEl = panel.querySelector('#sqc-last-query');
    if (lastEl) lastEl.textContent = `Última consulta: ${now}`;

    progressEl.textContent =
      `✓ ${ok} chamado${ok !== 1 ? 's' : ''} carregado${ok !== 1 ? 's' : ''}` +
      (err ? ` · ${err} erro${err !== 1 ? 's' : ''}` : '') +
      ` — ${now}`;

    fetchBtn.disabled = false;
    if (ok > 0) exportSec.classList.add('visible');
  };

  // ─── Botão no topo ────────────────────────────────────────────────────────────

  const topBtn = document.createElement('button');
  topBtn.id          = 'sqc-topbar-btn';
  topBtn.textContent = '🔍 Consulta de Chamados';
  topBtn.addEventListener('click', openPanel);
  document.body.appendChild(topBtn);

})();
