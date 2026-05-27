// ==UserScript==
// @name         SMAX Consulta de Chamados - TJSP
// @namespace    https://github.com/rsalvessap/SMAX-TOOLS
// @version      1.00
// @description  Consulta detalhada de chamados SMAX por lista de IDs: status, operacional, datas, solicitante, grupo, descrição, solução e comentários
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

  const STORAGE_KEY = 'smax_consulta_pos';
  const CONCURRENCY  = 4;

  const STATUS_LABELS = {
    RequestStatusNew:       'Novo',
    RequestStatusPending:   'Pendente',
    RequestStatusInProgress:'Em Andamento',
    RequestStatusSuspended: 'Suspenso',
    RequestStatusReady:     'Pronto',
    RequestStatusComplete:  'Concluído',
    RequestStatusRejected:  'Rejeitado',
    RequestStatusCancelled: 'Cancelado',
  };

  const STATUS_COLORS = {
    RequestStatusNew:        '#60a5fa',
    RequestStatusPending:    '#facc15',
    RequestStatusInProgress: '#34d399',
    RequestStatusSuspended:  '#f87171',
    RequestStatusReady:      '#a78bfa',
    RequestStatusComplete:   '#6b7280',
    RequestStatusRejected:   '#f87171',
    RequestStatusCancelled:  '#6b7280',
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
      const fromSession = sessionStorage.getItem('smaxTenantId') || localStorage.getItem('smaxTenantId');
      if (fromSession) return fromSession;
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
    return (d.textContent || d.innerText || '').trim();
  };

  const fmtDate = (ts) => {
    if (!ts) return '—';
    return new Date(Number(ts)).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const fmtSccd = (raw) => {
    if (!raw) return '—';
    return raw.replace(/_c$/i, '').replace(/([A-Z])/g, ' $1').trim();
  };

  const extractTicketData = (payload, id) => {
    let ent = {};
    if (Array.isArray(payload?.entities) && payload.entities.length) {
      ent = payload.entities[0];
    } else if (payload?.entity_type) {
      ent = payload;
    }
    const props = ent.properties || {};
    const rel   = ent.related_properties || {};

    // Identificação
    const ticketId = String(props.Id || id || '');

    // Status
    const statusRaw  = props.Status || '';
    const statusLabel = STATUS_LABELS[statusRaw] || statusRaw || '—';
    const statusColor = STATUS_COLORS[statusRaw] || '#6b7280';

    // Status Operacional
    const statusSCCDRaw   = props.StatusSCCDSMAX_c || '';
    const statusSCCDLabel = statusSCCDRaw ? fmtSccd(statusSCCDRaw) : '—';

    // Datas
    const createTime     = fmtDate(props.CreateTime);
    const lastUpdateTime = fmtDate(props.LastUpdateTime);

    // Global
    const globalRel  = rel.GlobalId_c || {};
    const globalId   = globalRel.Id   ? String(globalRel.Id)   : '';
    const globalName = globalRel.Name ? String(globalRel.Name) : '';
    const isGlobal   = !!globalId;

    // Pessoas e grupos
    const requestedFor = rel.RequestedForPerson?.DisplayLabel
      || rel.RequestedForPerson?.Name
      || String(props.RequestedForPerson || props.RequestedForDisplayLabel || '')
      || '—';

    const group = rel.ExpertGroup?.Name
      || rel.AssignedToGroup?.Name
      || rel.ExpertGroup?.DisplayLabel
      || '—';

    const assignee = rel.ExpertAssignee?.Name
      || rel.ExpertAssignee?.DisplayLabel
      || (props.ExpertAssignee ? `#${props.ExpertAssignee}` : '—');

    // Descrição e solução
    const descHtml     = props.Description || '';
    const solutionHtml = props.Solution    || '';

    // Comentários — filtra sistema, ordena desc, pega os 3 mais recentes
    let lastComments = [];
    if (props.Comments) {
      try {
        const parsed = typeof props.Comments === 'string'
          ? JSON.parse(props.Comments)
          : props.Comments;
        const all = Array.isArray(parsed?.Comment) ? parsed.Comment : [];
        const userComments = all.filter(c => !c.IsSystem);
        userComments.sort((a, b) => (Number(b.CreateTime) || 0) - (Number(a.CreateTime) || 0));
        lastComments = userComments.slice(0, 3).map(c => ({
          body    : c.CommentBody || '',
          date    : fmtDate(c.CreateTime),
          from    : c.CommentFrom || '',
          privacy : c.PrivacyType || '',
        }));
      } catch {}
    }

    return {
      ticketId, statusRaw, statusLabel, statusColor,
      statusSCCDRaw, statusSCCDLabel,
      createTime, lastUpdateTime,
      isGlobal, globalId, globalName,
      requestedFor, group, assignee,
      descHtml, solutionHtml,
      lastComments,
    };
  };

  // ─── Concorrência controlada ─────────────────────────────────────────────────

  const runConcurrent = async (items, fn, concurrency, onProgress) => {
    const results = new Array(items.length);
    let idx = 0;
    const worker = async () => {
      while (idx < items.length) {
        const i = idx++;
        try {
          results[i] = { ok: true,  data: await fn(items[i]) };
        } catch (e) {
          results[i] = { ok: false, error: e.message, id: items[i] };
        }
        onProgress(results.filter(Boolean).length, items.length);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  };

  // ─── Renderização de cards ───────────────────────────────────────────────────

  const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const buildCard = (d) => {
    const globalBadge = d.isGlobal
      ? `<span class="sqc-badge sqc-badge-global" title="${esc(d.globalName)}">⬆ Global #${esc(d.globalId)}</span>`
      : `<span class="sqc-badge sqc-badge-local">Local</span>`;

    const commentsHtml = d.lastComments.length === 0
      ? '<div class="sqc-empty">Sem comentários de usuário/agente.</div>'
      : d.lastComments.map((c, i) => `
          <div class="sqc-comment">
            <div class="sqc-comment-meta">
              <span>${esc(c.from)}</span>
              <span>${esc(c.date)}</span>
              <span class="sqc-privacy">${esc(c.privacy)}</span>
            </div>
            <div class="sqc-comment-body">${c.body}</div>
          </div>`).join('');

    return `
      <div class="sqc-card" data-id="${esc(d.ticketId)}">
        <div class="sqc-card-header">
          <a class="sqc-ticket-id" href="https://suporte.tjsp.jus.br/saw/Request/${esc(d.ticketId)}/general" target="_blank">#${esc(d.ticketId)}</a>
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
          <button class="sqc-toggle" data-target="desc-${esc(d.ticketId)}">▸ Descrição</button>
          <div class="sqc-collapsible" id="desc-${esc(d.ticketId)}">${d.descHtml || '<em style="color:#6b7280">Sem descrição.</em>'}</div>
        </div>

        <div class="sqc-section">
          <button class="sqc-toggle" data-target="sol-${esc(d.ticketId)}">▸ Solução</button>
          <div class="sqc-collapsible" id="sol-${esc(d.ticketId)}">${d.solutionHtml || '<em style="color:#6b7280">Sem solução registrada.</em>'}</div>
        </div>

        <div class="sqc-section">
          <button class="sqc-toggle" data-target="com-${esc(d.ticketId)}">▸ Últimos comentários (${d.lastComments.length})</button>
          <div class="sqc-collapsible" id="com-${esc(d.ticketId)}">${commentsHtml}</div>
        </div>
      </div>`;
  };

  const buildErrorCard = (id, msg) => `
    <div class="sqc-card sqc-card-error">
      <div class="sqc-card-header">
        <span class="sqc-ticket-id">#${esc(id)}</span>
        <span class="sqc-badge" style="color:#f87171;border-color:#f87171;">Erro</span>
      </div>
      <div style="font-size:12px;color:#f87171;padding:4px 0;">${esc(msg)}</div>
    </div>`;

  // ─── Export CSV ──────────────────────────────────────────────────────────────

  const buildCsv = (results) => {
    const cols = ['ID','Status','Status Operacional','Abertura','Últ. Atualização','É Global','Global Pai','Solicitante','Grupo','Especialista','Descrição (texto)','Solução (texto)','Comentário 1','Comentário 2','Comentário 3'];
    const csvEsc = (v) => `"${String(v||'').replace(/"/g,'""')}"`;
    const rows = results
      .filter(r => r?.ok)
      .map(r => {
        const d = r.data;
        const comText = (c) => c ? `[${c.date}] ${c.from}: ${htmlToText(c.body)}` : '';
        return [
          d.ticketId, d.statusLabel, d.statusSCCDLabel,
          d.createTime, d.lastUpdateTime,
          d.isGlobal ? 'Sim' : 'Não', d.globalId,
          d.requestedFor, d.group, d.assignee,
          htmlToText(d.descHtml), htmlToText(d.solutionHtml),
          comText(d.lastComments[0]), comText(d.lastComments[1]), comText(d.lastComments[2]),
        ].map(csvEsc).join(',');
      });
    return [cols.map(csvEsc).join(','), ...rows].join('\r\n');
  };

  const downloadCsv = (csv) => {
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `consulta_chamados_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // ─── CSS ─────────────────────────────────────────────────────────────────────

  GM_addStyle(`
    #sqc-panel {
      position:fixed; top:60px; right:20px; width:860px; max-width:calc(100vw - 40px);
      max-height:90vh; background:#0d1117; border:1px solid rgba(255,255,255,.12);
      border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.7); display:flex;
      flex-direction:column; z-index:2147483640; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px; color:#e5e7eb; overflow:hidden;
    }
    #sqc-header {
      display:flex; align-items:center; gap:10px; padding:12px 16px;
      border-bottom:1px solid rgba(255,255,255,.08); flex-shrink:0; cursor:move;
      background:rgba(255,255,255,.03);
    }
    #sqc-title { font-size:14px; font-weight:700; color:#e2e8f0; flex:1; user-select:none; }
    #sqc-close {
      border:1px solid rgba(255,255,255,.2); background:rgba(0,0,0,.3); color:rgba(255,255,255,.8);
      font-size:14px; width:28px; height:28px; border-radius:6px; cursor:pointer; flex-shrink:0;
    }
    #sqc-close:hover { background:rgba(248,113,113,.2); border-color:#f87171; color:#f87171; }
    #sqc-body { display:flex; flex-direction:column; flex:1; overflow:hidden; padding:14px 16px; gap:10px; }
    #sqc-input-row { display:flex; gap:8px; align-items:flex-start; flex-shrink:0; }
    #sqc-ids {
      flex:1; min-height:72px; max-height:140px; resize:vertical;
      background:#0a0f1e; border:1px solid rgba(255,255,255,.15); border-radius:8px;
      color:#e2e8f0; font-size:12px; font-family:monospace; padding:8px 10px; outline:none;
    }
    #sqc-ids:focus { border-color:#3b82f6; }
    #sqc-ids::placeholder { color:#4b5563; }
    #sqc-actions { display:flex; flex-direction:column; gap:6px; flex-shrink:0; }
    #sqc-btn-fetch {
      padding:8px 18px; border:none; border-radius:8px;
      background:linear-gradient(135deg,#3b82f6,#1d4ed8); color:#fff;
      font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap;
    }
    #sqc-btn-fetch:hover { background:linear-gradient(135deg,#60a5fa,#3b82f6); }
    #sqc-btn-fetch:disabled { opacity:.5; cursor:default; }
    #sqc-btn-csv {
      padding:6px 12px; border:1px solid rgba(255,255,255,.15); border-radius:8px;
      background:rgba(255,255,255,.05); color:#9ca3af; font-size:12px; cursor:pointer;
      display:none; white-space:nowrap;
    }
    #sqc-btn-csv:hover { border-color:#3b82f6; color:#60a5fa; }
    #sqc-progress { font-size:11px; color:#6b7280; flex-shrink:0; min-height:16px; }
    #sqc-results { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:10px; padding-right:2px; }
    #sqc-results::-webkit-scrollbar { width:5px; }
    #sqc-results::-webkit-scrollbar-track { background:transparent; }
    #sqc-results::-webkit-scrollbar-thumb { background:rgba(255,255,255,.1); border-radius:10px; }

    .sqc-card {
      border:1px solid rgba(255,255,255,.08); border-radius:10px;
      background:rgba(15,23,42,.8); padding:12px 14px;
    }
    .sqc-card-error { border-color:rgba(248,113,113,.25); background:rgba(248,113,113,.05); }
    .sqc-card-header { display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
    .sqc-ticket-id {
      font-size:15px; font-weight:800; color:#60a5fa;
      text-decoration:none; flex-shrink:0;
    }
    .sqc-ticket-id:hover { text-decoration:underline; }
    .sqc-badges { display:flex; gap:5px; flex-wrap:wrap; }
    .sqc-badge {
      font-size:10px; padding:2px 8px; border-radius:12px;
      border:1px solid rgba(255,255,255,.2); color:#9ca3af;
    }
    .sqc-badge-sccd  { color:#a78bfa; border-color:rgba(167,139,250,.35); }
    .sqc-badge-global { color:#f87171; border-color:rgba(248,113,113,.35); }
    .sqc-badge-local  { color:#6b7280; border-color:rgba(107,114,128,.25); }

    .sqc-meta-grid {
      display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
      gap:6px 12px; margin-bottom:10px;
    }
    .sqc-meta-item { display:flex; flex-direction:column; gap:1px; }
    .sqc-meta-label { font-size:9px; color:#6b7280; text-transform:uppercase; letter-spacing:.06em; }
    .sqc-meta-val   { font-size:12px; color:#d1d5db; }

    .sqc-section { border-top:1px solid rgba(255,255,255,.05); padding-top:6px; margin-top:6px; }
    .sqc-toggle {
      background:none; border:none; color:#6b7280; font-size:11px; cursor:pointer;
      padding:0; text-align:left; transition:color .1s;
    }
    .sqc-toggle:hover { color:#94a3b8; }
    .sqc-toggle.open  { color:#93c5fd; }
    .sqc-collapsible {
      display:none; margin-top:8px; font-size:12px; color:#d1d5db;
      line-height:1.6; max-height:300px; overflow-y:auto;
    }
    .sqc-collapsible.open { display:block; }
    .sqc-collapsible img { max-width:100%; height:auto; border-radius:6px; margin:4px 0; display:block; }
    .sqc-collapsible p { margin:0 0 6px; }
    .sqc-collapsible ul,.sqc-collapsible ol { margin:0 0 6px; padding-left:18px; }

    .sqc-comment { border-left:2px solid rgba(255,255,255,.1); padding:6px 10px; margin-bottom:6px; }
    .sqc-comment-meta { display:flex; gap:10px; font-size:10px; color:#6b7280; margin-bottom:4px; flex-wrap:wrap; }
    .sqc-comment-body { font-size:12px; color:#d1d5db; line-height:1.5; }
    .sqc-comment-body img { max-width:100%; border-radius:4px; display:block; margin:4px 0; }
    .sqc-privacy { background:rgba(167,139,250,.1); border-radius:4px; padding:0 5px; color:#a78bfa; }
    .sqc-empty { font-size:11px; color:#6b7280; font-style:italic; }

    #sqc-fab {
      position:fixed; bottom:24px; right:24px; z-index:2147483639;
      width:48px; height:48px; border-radius:50%; border:none;
      background:linear-gradient(135deg,#3b82f6,#1d4ed8);
      color:#fff; font-size:20px; cursor:pointer;
      box-shadow:0 4px 16px rgba(59,130,246,.45); transition:transform .12s;
    }
    #sqc-fab:hover { transform:scale(1.1); }
  `);

  // ─── HTML do painel ──────────────────────────────────────────────────────────

  const buildPanel = () => {
    const panel = document.createElement('div');
    panel.id = 'sqc-panel';
    panel.innerHTML = `
      <div id="sqc-header">
        <span id="sqc-title">🔍 Consulta de Chamados SMAX</span>
        <button id="sqc-close" title="Fechar">✕</button>
      </div>
      <div id="sqc-body">
        <div id="sqc-input-row">
          <textarea id="sqc-ids" placeholder="Cole os IDs dos chamados aqui (um por linha, ou separados por vírgula/espaço)…"></textarea>
          <div id="sqc-actions">
            <button id="sqc-btn-fetch">🔍 Consultar</button>
            <button id="sqc-btn-csv">⬇ Exportar CSV</button>
          </div>
        </div>
        <div id="sqc-progress"></div>
        <div id="sqc-results"></div>
      </div>`;
    return panel;
  };

  // ─── Lógica principal ────────────────────────────────────────────────────────

  let panel = null;
  let lastResults = [];

  const parseIds = (text) =>
    text.split(/[\n,;\s]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s));

  const setProgress = (done, total) => {
    const el = panel.querySelector('#sqc-progress');
    if (el) el.textContent = total > 0 ? `Consultando… ${done}/${total}` : '';
  };

  const openPanel = () => {
    if (panel) { panel.style.display = 'flex'; return; }
    panel = buildPanel();

    // Posição salva
    try {
      const saved = JSON.parse(GM_getValue(STORAGE_KEY, '{}'));
      if (saved.top)  panel.style.top  = saved.top;
      if (saved.left) { panel.style.right = 'auto'; panel.style.left = saved.left; }
    } catch {}

    document.body.appendChild(panel);

    // Fechar
    panel.querySelector('#sqc-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    // Drag
    const header = panel.querySelector('#sqc-header');
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.id === 'sqc-close') return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth  - 100, e.clientX - ox));
      const top  = Math.max(0, Math.min(window.innerHeight - 40,  e.clientY - oy));
      panel.style.left  = left + 'px';
      panel.style.top   = top  + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      GM_setValue(STORAGE_KEY, JSON.stringify({ top: panel.style.top, left: panel.style.left }));
    });

    // Toggle colapsável (delegação)
    panel.querySelector('#sqc-results').addEventListener('click', (e) => {
      const btn = e.target.closest('.sqc-toggle');
      if (!btn) return;
      const targetId = btn.dataset.target;
      const content  = panel.querySelector('#' + targetId);
      if (!content) return;
      const open = content.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.textContent = (open ? '▾ ' : '▸ ') + btn.textContent.replace(/^[▸▾] /, '');
    });

    // Consultar
    panel.querySelector('#sqc-btn-fetch').addEventListener('click', async () => {
      const idsText = panel.querySelector('#sqc-ids').value.trim();
      const ids = parseIds(idsText);
      if (!ids.length) {
        panel.querySelector('#sqc-progress').textContent = 'Nenhum ID válido encontrado.';
        return;
      }

      const btn     = panel.querySelector('#sqc-btn-fetch');
      const csvBtn  = panel.querySelector('#sqc-btn-csv');
      const results = panel.querySelector('#sqc-results');
      btn.disabled = true;
      csvBtn.style.display = 'none';
      results.innerHTML = '';
      lastResults = [];
      setProgress(0, ids.length);

      const fetched = await runConcurrent(
        ids,
        async (id) => {
          const payload = await fetchTicket(id);
          return extractTicketData(payload, id);
        },
        CONCURRENCY,
        (done, total) => setProgress(done, total)
      );

      lastResults = fetched;

      // Preserva ordem original dos IDs
      results.innerHTML = ids.map((id, i) => {
        const r = fetched[i];
        if (!r) return buildErrorCard(id, 'Sem resposta.');
        if (!r.ok) return buildErrorCard(id, r.error || 'Erro desconhecido.');
        return buildCard(r.data);
      }).join('');

      const ok  = fetched.filter(r => r?.ok).length;
      const err = fetched.length - ok;
      panel.querySelector('#sqc-progress').textContent =
        `Concluído: ${ok} chamado${ok !== 1 ? 's' : ''} carregado${ok !== 1 ? 's' : ''}` +
        (err ? `, ${err} erro${err !== 1 ? 's' : ''}` : '') + '.';

      btn.disabled = false;
      if (ok > 0) csvBtn.style.display = '';
    });

    // Exportar CSV
    panel.querySelector('#sqc-btn-csv').addEventListener('click', () => {
      if (!lastResults.length) return;
      downloadCsv(buildCsv(lastResults));
    });
  };

  // ─── FAB (botão de acesso) ────────────────────────────────────────────────────

  const fab = document.createElement('button');
  fab.id        = 'sqc-fab';
  fab.title     = 'Consulta de Chamados';
  fab.textContent = '🔍';
  fab.addEventListener('click', openPanel);
  document.body.appendChild(fab);

})();
