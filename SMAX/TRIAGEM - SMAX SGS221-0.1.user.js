// ==UserScript==
// @name         TRIAGEM - SMAX SGS221
// @namespace    https://github.com/DanielMacCruz/SGS221-Triagem
// @version      1.02
// @description  Interface enhancements for triagem workflow
// @author       YOU
// @match        https://suporte.tjsp.jus.br/saw/Requests*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @downloadURL  https://github.com/DanielMacCruz/SGS221-Triagem/raw/refs/heads/master/SMAX/TRIAGEM%20-%20SMAX%20SGS221-0.1.user.js
// @updateURL    https://github.com/DanielMacCruz/SGS221-Triagem/raw/refs/heads/master/SMAX/TRIAGEM%20-%20SMAX%20SGS221-0.1.user.js
// @homepageURL  https://github.com/DanielMacCruz/SGS221-Triagem
// @supportURL   https://chatgpt.com
// ==/UserScript==

(() => {
  'use strict';

  if (window.top && window.top !== window.self) return;

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const getPageCKEditor = () => (pageWindow && pageWindow.CKEDITOR ? pageWindow.CKEDITOR : null);

  /* =========================================================
   * Preferences
   * =======================================================*/
  const PrefStore = (() => {
    const defaults = {
      nameBadgesOn: true,
      collapseOn: false,
      enlargeCommentsOn: true,
      flagSkullOn: true,
      nameGroups: {},
      ausentes: [],
      nameColors: {},
      enableRealWrites: true,
      defaultGlobalChangeId: '',
      personalFinalsRaw: '',
      myPersonId: '',
      myPersonName: '',
      teamsConfigRaw: JSON.stringify([
        {
          id: 'jec',
          name: 'JEC / JUIZADO',
          priority: 10,
          matchers: [

          ],
          workers: []
        },
        {
          id: 'geral',
          name: 'GERAL',
          priority: 1,
          isDefault: true,
          matchers: [],
          workers: []
        }
      ]),
    };

    const state = JSON.parse(JSON.stringify(defaults));

    const load = () => {
      try {
        const saved = GM_getValue('smax_prefs');
        if (!saved) return;
        const parsed = JSON.parse(saved);
        Object.assign(state, defaults, parsed || {});
        console.log('[SMAX] Preferences loaded:', state);
      } catch (err) {
        console.warn('[SMAX] Failed to load preferences:', err);
      }
    };

    const save = () => {
      try {
        GM_setValue('smax_prefs', JSON.stringify(state));
        console.log('[SMAX] Preferences saved:', state);
      } catch (err) {
        console.error('[SMAX] Failed to save preferences:', err);
      }
    };

    load();
    return { state, save, defaults };
  })();

  const prefs = PrefStore.state;
  const savePrefs = PrefStore.save;

  /* =========================================================
   * Activity Log (persistent workload tracking)
   * =======================================================*/
  const ActivityLog = (() => {
    const STORAGE_KEY = 'smax_activity_log';
    const MAX_ENTRIES = 5000;
    let entries = [];

    const load = () => {
      try {
        const saved = GM_getValue(STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          entries = parsed;
          console.log('[SMAX] Activity log loaded:', entries.length, 'entries');
        }
      } catch (err) {
        console.warn('[SMAX] Failed to load activity log:', err);
      }
    };

    const save = () => {
      try {
        // Auto-prune oldest entries if over limit
        if (entries.length > MAX_ENTRIES) {
          entries = entries.slice(entries.length - MAX_ENTRIES);
        }
        GM_setValue(STORAGE_KEY, JSON.stringify(entries));
      } catch (err) {
        console.error('[SMAX] Failed to save activity log:', err);
      }
    };

    const deriveRelevantWork = (data) => {
      // Priority: RESPONDIDO > VINCULO_GLOBAL > TRANSFERIDO > DESIGNADO
      if (data.answered) return 'RESPONDIDO';
      if (data.globalAssigned) return 'VINCULO_GLOBAL';
      if (data.transferred) return 'TRANSFERIDO';
      if (data.assigned) return 'DESIGNADO';
      return 'OUTRO';
    };

    const log = (data) => {
      if (!data || !data.ticketId) return;
      const entry = {
        ts: Date.now(),
        ticketId: String(data.ticketId || ''),
        assigned: !!data.assigned,
        assignedTo: data.assignedTo || '',
        globalAssigned: !!data.globalAssigned,
        globalChangeId: data.globalChangeId || '',
        transferred: !!data.transferred,
        transferredTo: data.transferredTo || '',
        answered: !!data.answered,
        usedScript: !!data.usedScript,
        relevantWork: '',
        user: data.user || prefs.myPersonName || '',
        success: data.success !== false
      };
      entry.relevantWork = deriveRelevantWork(entry);
      entries.push(entry);
      save();
      console.log('[SMAX] Activity logged:', entry);
    };

    const formatDateBrazilian = (ts) => {
      try {
        const d = new Date(ts);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      } catch {
        return '';
      }
    };

    const escapeCSV = (value) => {
      if (value == null) return '';
      const str = String(value);
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const exportCsv = (filterDays = null) => {
      let toExport = entries.slice();
      if (filterDays && filterDays > 0) {
        const cutoff = Date.now() - (filterDays * 24 * 60 * 60 * 1000);
        toExport = toExport.filter((e) => e.ts >= cutoff);
      }
      if (!toExport.length) {
        alert('Nenhuma entrada para exportar.');
        return;
      }
      const headers = ['Data', 'Hora', 'Chamado', 'Trabalho Relevante', 'Atribuído Para', 'Global', 'Transferido Para', 'Respondido', 'Script Utilizado', 'Usuário', 'Sucesso'];
      const rows = toExport.map((e) => {
        const fullDate = formatDateBrazilian(e.ts);
        const [datePart, timePart] = fullDate.split(' ');
        return [
          datePart || '',
          timePart || '',
          e.ticketId,
          e.relevantWork,
          e.assignedTo,
          e.globalChangeId,
          e.transferredTo,
          e.answered ? 'Sim' : 'Não',
          e.usedScript ? 'Sim' : 'Não',
          e.user,
          e.success ? 'Sim' : 'Não'
        ].map(escapeCSV).join(',');
      });
      const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      triggerDownload(blob, 'triagem_log_padrao');
    };

    const triggerDownload = (blob, slug) => {
      const url = URL.createObjectURL(blob);
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const filename = `${slug}_${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      console.log('[SMAX] Exported CSV:', filename);
    };

    const clear = () => {
      if (!confirm('Tem certeza que deseja limpar TODO o log de atividades? Esta ação não pode ser desfeita.')) return false;
      entries = [];
      save();
      console.log('[SMAX] Activity log cleared');
      return true;
    };

    const getCount = () => entries.length;
    const getEntries = () => entries.slice();

    load();

    return { log, exportCsv, clear, getCount, getEntries, load };
  })();

  /* =========================================================
   * Styles
   * =======================================================*/
  GM_addStyle(`
    .slick-cell.tmx-namecell { font-weight:700 !important; transition: box-shadow .15s ease; }
    .slick-cell.tmx-namecell a { color: inherit !important; }
    .slick-cell.tmx-namecell:focus-within { outline: 2px solid rgba(0,0,0,.25); outline-offset: 2px; }
    .slick-cell.tmx-namecell:hover { box-shadow: 0 0 0 2px rgba(0,0,0,.08) inset; }

    .comment-items { height: auto !important; max-height: none !important; }

    .smax-absent-wrapper { display:inline-flex; align-items:center; gap:4px; cursor:pointer; font-size:12px; white-space:nowrap; }
    .smax-absent-input { display:none; }
    .smax-absent-box { width:14px; height:14px; border:1px solid #555; border-radius:2px; background:#fff; box-sizing:border-box; }
    .smax-absent-input:checked + .smax-absent-box { background:#d32f2f; border-color:#d32f2f; box-shadow:0 0 0 1px #d32f2f; }

    #smax-settings-btn { width:50px; height:50px; border-radius:50%; border:none; background:#0f172a; color:#f8fafc; font-size:26px; display:flex; align-items:center; justify-content:center; box-shadow:0 6px 18px rgba(0,0,0,.35); cursor:pointer; }
    #smax-settings-btn:hover { background:#1f2937; }
    #smax-refresh-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 999998; display: none; align-items: center; justify-content: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #smax-refresh-overlay-inner { width:70px; height:70px; border-radius:50%; background:#34c759; display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 2px rgba(255,255,255,.35), 0 0 16px rgba(52,199,89,.8); }
    #smax-refresh-now { width:46px; height:46px; border-radius:50%; border:none; background:transparent; color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:26px; }

    #smax-triage-start-btn { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:999999; padding:12px 28px; border-radius:999px; border:none; cursor:pointer; font-size:16px; font-weight:600; background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%); color:#fff; box-shadow:0 8px 24px rgba(59,130,246,.4),0 0 0 1px rgba(255,255,255,.1) inset; transition:transform .15s ease, box-shadow .15s ease; }
    #smax-triage-start-btn:hover { transform:translateX(-50%) translateY(-2px); box-shadow:0 12px 32px rgba(59,130,246,.5),0 0 0 1px rgba(255,255,255,.15) inset; }
    #smax-triage-hud-backdrop { position:fixed; inset:0; padding:30px 0 20px; background:linear-gradient(180deg,rgba(0,0,0,0.7) 0%,rgba(0,0,0,0.5) 100%); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:999997; display:none; align-items:flex-start; justify-content:center; overflow:auto; }
    #smax-triage-hud { position:relative; background:#0f172a; color:#e5e7eb; border-radius:16px; padding:0; max-width:1340px; width:99vw; max-height:calc(100vh - 60px); box-shadow:0 25px 60px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.08) inset; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; display:flex; gap:0; align-items:stretch; overflow:hidden; }
    .smax-triage-header-nav { display:inline-flex; align-items:center; gap:8px; margin-right:8px; }
    .smax-triage-header-nav button { width:38px; height:32px; border-radius:8px; border:none; background:rgba(255,255,255,.2); color:#fff; font-weight:700; font-size:14px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background 0.15s ease, transform 0.1s ease; }
    .smax-triage-header-nav button:hover:not(:disabled) { background:rgba(255,255,255,.35); transform:scale(1.05); }
    .smax-triage-header-nav button:disabled { opacity:0.35; cursor:not-allowed; }
    #smax-triage-hud-main { display:flex; flex-direction:column; gap:12px; flex:1; min-width:0; }
    #smax-triage-hud-header { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:52px; padding:10px 20px; background:linear-gradient(90deg,#0ea5e9 0%,#3b82f6 50%,#8b5cf6 100%); border-radius:16px 0 0 0; }
    #smax-triage-location-display { font-size:11px; font-weight:400; color:#e2e8f0; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:default; background:rgba(0,0,0,0.35); border-radius:6px; padding:3px 8px; }
    #smax-triage-location-display[data-empty="true"] { color:#94a3b8; font-style:italic; }
    #smax-triage-hud-header .smax-triage-title-bar { display:flex; align-items:center; gap:12px; flex:1; }
    #smax-personal-finals-input { background:#0f172a; border:1px solid #1f2937; border-radius:999px; padding:2px 8px; color:#f8fafc; font-size:11px; min-width:60px; max-width:70px; }
    #smax-triage-gse-wrapper { position:relative; min-width:220px; display:flex; flex-direction:column; gap:4px; }
    #smax-triage-gse-display { width:100%; border-radius:10px; border:1px solid #1f2937; background:#0f172a; color:#f8fafc; font-size:12px; min-height:32px; padding:6px 32px 6px 12px; text-align:left; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:8px; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease, color .15s ease; }
    #smax-triage-gse-display:disabled { opacity:0.6; cursor:not-allowed; }
    .smax-triage-gse-chevron { font-size:11px; color:#94a3b8; transition:transform .15s ease; }
    #smax-triage-gse-wrapper[data-open="true"] .smax-triage-gse-chevron { transform:rotate(180deg); }
    #smax-triage-gse-dropdown { position:absolute; top:calc(100% + 6px); right:0; width:260px; background:#020617; border:1px solid #1f2937; border-radius:12px; box-shadow:0 18px 45px rgba(0,0,0,.55); padding:10px; display:none; flex-direction:column; gap:8px; z-index:9; }
    #smax-triage-gse-wrapper[data-open="true"] #smax-triage-gse-dropdown { display:flex; }
    #smax-triage-gse-filter { background:#0f172a; border:1px solid #1f2937; border-radius:999px; padding:5px 12px; color:#e2e8f0; font-size:12px; transition:border-color .15s ease, box-shadow .15s ease; width:100%; max-width:100%; box-sizing:border-box; }
    #smax-triage-gse-filter::placeholder { color:#64748b; }
    #smax-triage-gse-filter:focus { outline:none; border-color:#38bdf8; box-shadow:0 0 8px rgba(56,189,248,0.35); }
    .smax-triage-gse-options { max-height:240px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; }
    .smax-triage-gse-option { border-radius:9px; border:1px solid transparent; background:rgba(15,23,42,0.85); color:#f8fafc; font-size:12px; padding:7px 10px; text-align:left; cursor:pointer; transition:border-color .12s ease, background .12s ease, color .12s ease; display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .smax-triage-gse-option:hover { border-color:#38bdf8; background:#0f172a; }
    .smax-triage-gse-option[data-active="true"] { border-color:#22c55e; background:#052e16; color:#bbf7d0; box-shadow:0 0 12px rgba(34,197,94,0.35); }
    .smax-triage-gse-option[data-empty="true"] { opacity:0.7; border-style:dashed; cursor:default; justify-content:center; }
    .smax-triage-gse-option[data-ghost="true"] { color:#94a3b8; font-style:italic; }
    .smax-triage-gse-chip { font-size:11px; color:#67e8f9; background:rgba(14,165,233,0.15); border-radius:999px; padding:2px 8px; text-transform:uppercase; letter-spacing:.05em; }
    #smax-triage-gse-empty { font-size:12px; color:#94a3b8; text-align:center; padding:8px 4px; border:1px dashed #334155; border-radius:10px; }
    #smax-triage-gse-wrapper[data-state="staged"] #smax-triage-gse-display { border-color:#22c55e; background:#052e16; color:#bbf7d0; box-shadow:0 0 14px rgba(34,197,94,0.35); }
    #smax-triage-gse-wrapper[data-state="staged"] #smax-triage-gse-dropdown { border-color:#22c55e; box-shadow:0 18px 45px rgba(34,197,94,0.45); }
    #smax-triage-gse-wrapper[data-state="loading"] #smax-triage-gse-display { border-style:dashed; }
    #smax-personal-finals-input::placeholder { color:#6b7280; }
    #smax-triage-hud-body { background:rgba(2,6,23,0.85); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border-radius:12px; padding:14px 16px; margin:0 16px; flex:1; min-height:0; display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(255,255,255,.06); }
    #smax-triage-hud-footer { display:flex; flex-direction:column; gap:14px; padding:0 16px 16px; }
    .smax-triage-top-row { display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:center; }
    .smax-triage-inline-controls { display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; }
    .smax-triage-main-actions { display:flex; flex-direction:column; gap:4px; align-items:flex-end; min-width:210px; }
    .smax-triage-main-actions-buttons { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
    .smax-triage-urg-group { display:flex; flex-wrap:wrap; gap:6px; }
    .smax-triage-auto-panels { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-start; min-width:260px; justify-content:flex-end; margin-left:auto; }
    .smax-triage-indicator { display:flex; flex-direction:column; gap:3px; padding:8px 12px; border-radius:12px; border:1px solid rgba(255,255,255,.1); background:linear-gradient(135deg,rgba(15,23,42,0.9) 0%,rgba(2,6,23,0.95) 100%); min-width:150px; font-size:12px; color:#f1f5f9; transition:all .2s ease; flex:0 0 auto; width:auto; box-shadow:0 4px 12px rgba(0,0,0,.2); }
    .smax-triage-indicator .smax-indicator-label { font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:#64748b; font-weight:500; }
    .smax-triage-indicator[data-state="pending"] { border-color:#facc15; box-shadow:0 0 12px rgba(250,204,21,0.25); }
    .smax-triage-indicator[data-state="staged"] { border-color:#22c55e; box-shadow:0 0 16px rgba(34,197,94,0.35); }
    .smax-triage-indicator[data-state="disabled"] { opacity:0.6; border-style:dashed; box-shadow:none; }
    .smax-triage-global-group { display:flex; flex-direction:column; gap:4px; font-size:12px; color:#e5e7eb; flex:0 0 auto; min-width:170px; }
    .smax-global-input { padding:8px 12px; border-radius:8px; border:1px solid #475569; background:#1e293b; color:#e5e7eb; font-size:12px; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease; }
    .smax-global-input::placeholder { color:#6b7280; opacity:1; }
    .smax-global-input:focus { outline:none; border-color:#38bdf8; box-shadow:0 0 8px rgba(56,189,248,0.35); }
    .smax-global-input[data-state="staged"] { border-color:#22c55e; background:#052e16; color:#bbf7d0; box-shadow:0 0 12px rgba(34,197,94,0.35); }
    .smax-global-input[data-state="pending"] { border-color:#facc15; background:#422006; color:#fde68a; box-shadow:0 0 12px rgba(250,204,21,0.25); }
    .smax-global-hint { font-size:11px; color:#94a3b8; min-height:14px; }
    .smax-global-hint[data-state="staged"] { color:#4ade80; }
    .smax-custom-dropdown-display[data-staged="true"] { border-color:#22c55e !important; box-shadow:0 0 12px rgba(34,197,94,0.4) !important; background:#052e16 !important; color:#bbf7d0 !important; }
    .smax-custom-dropdown-display[data-staged="false"] { border-color:#facc15 !important; box-shadow:0 0 8px rgba(250,204,21,0.25) !important; }
    .smax-triage-status-dropdown { font-weight:600; min-width:110px; max-width:180px; }
    .smax-triage-status-dropdown[data-status="RequestStatusSuspended"] { background-color:rgba(250,204,21,0.25) !important; color:#fde68a !important; border-color:rgba(250,204,21,0.5) !important; }
    .smax-triage-status-dropdown[data-status="RequestStatusActive"],
    .smax-triage-status-dropdown[data-status="RequestStatusInProgress"] { background-color:rgba(34,197,94,0.2) !important; color:#bbf7d0 !important; border-color:rgba(34,197,94,0.4) !important; }
    .smax-triage-status-dropdown[data-status="RequestStatusComplete"] { background-color:rgba(59,130,246,0.2) !important; color:#bfdbfe !important; border-color:rgba(59,130,246,0.4) !important; }
    .smax-triage-status-dropdown[data-status="RequestStatusReady"] { background-color:rgba(34,197,94,0.15) !important; color:#a7f3d0 !important; border-color:rgba(34,197,94,0.3) !important; }
    .smax-triage-status-dropdown[data-status="RequestStatusReject"],
    .smax-triage-status-dropdown[data-status="RequestStatusAbandon"] { background-color:rgba(239,68,68,0.2) !important; color:#fecaca !important; border-color:rgba(239,68,68,0.4) !important; }
    .smax-triage-status-dropdown[data-status="RequestStatusPending"],
    .smax-triage-status-dropdown[data-status="RequestStatusPendingCustomer"],
    .smax-triage-status-dropdown[data-status="RequestStatusPendingApproval"],
    .smax-triage-status-dropdown[data-status="RequestStatusPendingChange"] { background-color:rgba(251,146,60,0.2) !important; color:#fed7aa !important; border-color:rgba(251,146,60,0.4) !important; }
    .smax-triage-status-dropdown[data-status="RequestStatusClassify"] { background-color:rgba(168,85,247,0.2) !important; color:#e9d5ff !important; border-color:rgba(168,85,247,0.4) !important; }
    #smax-triage-commit[data-suspended="true"] { background:linear-gradient(135deg,#facc15 0%,#eab308 100%) !important; color:#111827 !important; box-shadow:0 4px 16px rgba(250,204,21,.45) !important; }
    #smax-triage-commit[data-suspended="true"]:hover { box-shadow:0 8px 24px rgba(250,204,21,.55) !important; }
    .smax-triage-primary { padding:10px 20px; border-radius:10px; border:none; cursor:pointer; background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%); color:#fff; font-weight:600; font-size:14px; box-shadow:0 4px 16px rgba(34,197,94,.35); transition:transform .15s ease, box-shadow .15s ease; }
    .smax-triage-primary:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(34,197,94,.45); }
    .smax-triage-secondary { padding:8px 14px; border-radius:10px; border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.05); color:#e5e7eb; cursor:pointer; font-size:13px; transition:all .15s ease; }
    .smax-triage-secondary:hover { background:rgba(255,255,255,.1); border-color:rgba(255,255,255,.25); }
    .smax-triage-chip { transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease; }
    .smax-triage-chip[data-active="true"], .smax-triage-chip[data-active="selected"] { box-shadow:0 0 0 1px rgba(250,250,250,0.7), 0 0 18px rgba(250,250,250,0.55); transform:translateY(-1px) scale(1.01); }
    .smax-urg-low[data-active="true"]  { background:#facc15;color:#111827;border-color:#facc15; }
    .smax-urg-med[data-active="true"]  { background:#fb923c;color:#111827;border-color:#fb923c; }
    .smax-urg-high[data-active="true"] { background:#f97316;color:#111827;border-color:#f97316; }
    .smax-urg-crit[data-active="true"] { background:#ef4444;color:#fee2e2;border-color:#ef4444; }
    #smax-triage-status { font-size:12px; color:#9ca3af; }
    #smax-triage-discussions { width:340px; background:linear-gradient(180deg,rgba(5,12,29,0.95) 0%,rgba(2,6,23,0.98) 100%); border:1px solid rgba(255,255,255,.08); border-radius:0 0 12px 0; padding:14px; display:flex; flex-direction:column; gap:12px; overflow:auto; flex-shrink:0; min-height:0; max-height:100%; }
    .smax-discussions-placeholder { font-size:13px; color:#64748b; line-height:1.5; }
    .smax-discussion-card { border:1px solid rgba(255,255,255,.1); border-radius:10px; padding:10px 12px; background:linear-gradient(135deg,rgba(15,23,42,0.8) 0%,rgba(30,41,59,0.4) 100%); display:flex; flex-direction:column; gap:8px; transition:border-color .15s ease, box-shadow .15s ease; }
    .smax-discussion-card:hover { border-color:rgba(255,255,255,.2); box-shadow:0 4px 16px rgba(0,0,0,.3); }
    .smax-discussion-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; }
    .smax-discussion-title { font-weight:600; color:#f8fafc; }
    .smax-discussion-privacy { font-size:11px; text-transform:uppercase; letter-spacing:.04em; padding:1px 8px; border-radius:999px; border:1px solid rgba(248,250,252,0.3); color:#e2e8f0; }
    .smax-discussion-card[data-privacy="PUBLIC"] .smax-discussion-privacy { background:#082f49; border-color:#38bdf8; color:#bae6fd; }
    .smax-discussion-card[data-privacy="INTERNAL"] .smax-discussion-privacy { background:#1e1b4b; border-color:#a78bfa; color:#ede9fe; }
    .smax-discussion-card[data-privacy="EXTERNAL"] .smax-discussion-privacy { background:#0f172a; border-color:#4ade80; color:#bbf7d0; }
    .smax-discussion-body { font-size:13px; color:#e2e8f0; line-height:1.45; max-height:150px; overflow:auto; }
    .smax-discussion-body p { margin:0 0 6px; }
    .smax-discussion-body p:last-child { margin-bottom:0; }
    .smax-discussion-meta { font-size:11px; color:#94a3b8; }
    #smax-triage-ticket-details { flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column; }
    #smax-triage-ticket-details img { max-width:100%; height:auto; display:block; border-radius:6px; margin-top:6px; }
    .smax-triage-meta-row { display:flex; flex-wrap:wrap; align-items:center; gap:12px; font-size:13px; color:#cbd5e1; }
    #smax-triage-quickreply-card { border:1px solid #1f2937; border-radius:8px; padding:10px; background:#020617; width:100%; box-sizing:border-box; transition:border-color 0.2s ease, box-shadow 0.2s ease; }
    #smax-triage-quickreply-card[data-staged="true"] { border-color:#38bdf8; box-shadow:0 0 12px rgba(56,189,248,0.35); }
    #smax-triage-quickreply-card textarea { width:100%; min-height:140px; resize:vertical; background:#020617; color:#e5e7eb; border:1px solid #374151; border-radius:6px; padding:8px; font-family:"Segoe UI",sans-serif; box-sizing:border-box; }
    #smax-triage-quickreply-card .cke { width:100% !important; max-width:100%; box-sizing:border-box; }
    #smax-triage-hud .cke { z-index:1000000 !important; }
    body .cke_panel, body .cke_combopanel, body .cke_panel_block { z-index:1000003 !important; }
    body .cke_dialog, body .cke_dialog_container, body .cke_dialog_body, body .cke_dialog_background_cover { z-index:1000005 !important; }
    body .cke_colorauto .cke_colorbox_color { background-color:#000 !important; }
    body .cke_colorauto .cke_colorbox { border-color:#000 !important; }
    body .cke_colorauto { color:#f5f5f5 !important; }
    #smax-triage-status-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding:8px 0 0; border-top:1px solid #1f2937; }
    #smax-triage-status { font-size:12px; color:#cbd5f5; }
    #smax-triage-status-row[data-empty="true"] #smax-triage-status { color:#9ca3af; }
    #smax-triage-attachment-list { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; font-size:12px; color:#94a3b8; min-height:22px; max-width:55%; }
    #smax-triage-attachment-list[data-state="loading"],
    #smax-triage-attachment-list[data-state="empty"],
    #smax-triage-attachment-list[data-state="error"] { display:block; text-align:right; }
    .smax-attachment-chip { border:1px solid #38bdf8; border-radius:999px; padding:3px 8px; background:transparent; color:#38bdf8; font-size:11px; cursor:pointer; transition:background 0.15s ease, color 0.15s ease; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .smax-attachment-chip:hover { background:#38bdf8; color:#0f172a; }
    #smax-attachment-modal { position:fixed; inset:0; background:rgba(2,6,23,0.92); z-index:1000003; display:none; align-items:center; justify-content:center; padding:30px; }
    #smax-attachment-modal[data-visible="true"] { display:flex; }
    #smax-attachment-modal img { max-width:90vw; max-height:90vh; border-radius:10px; box-shadow:0 20px 45px rgba(0,0,0,0.65); }
    #smax-attachment-modal button { position:absolute; top:18px; right:18px; border:none; width:40px; height:40px; border-radius:50%; background:rgba(15,23,42,0.85); color:#f8fafc; font-size:22px; cursor:pointer; }
    #smax-attachment-modal .smax-attachment-caption { position:absolute; bottom:24px; left:50%; transform:translateX(-50%); color:#e2e8f0; font-size:14px; text-align:center; max-width:90vw; }

    #smax-activity-log-panel { margin-top:14px; padding:10px 12px; border:1px solid #ddd; border-radius:6px; background:#f8fafc; }
    #smax-activity-log-panel h4 { margin:0 0 8px; font-size:13px; font-weight:600; color:#1f2937; }
    .smax-log-stats { font-size:12px; color:#4b5563; margin-bottom:10px; }
    .smax-log-actions { display:flex; flex-wrap:wrap; gap:8px; }
    .smax-log-btn { padding:6px 12px; border-radius:6px; border:1px solid #cbd5e1; background:#fff; color:#1f2937; font-size:12px; cursor:pointer; transition:background 0.15s ease, border-color 0.15s ease; }
    .smax-log-btn:hover { background:#e2e8f0; border-color:#94a3b8; }
    .smax-log-btn-primary { background:#1976d2; border-color:#1976d2; color:#fff; }
    .smax-log-btn-primary:hover { background:#1565c0; border-color:#1565c0; }
    .smax-log-btn-danger { background:#dc2626; border-color:#dc2626; color:#fff; }
    .smax-log-btn-danger:hover { background:#b91c1c; border-color:#b91c1c; }
    
    .smax-custom-dropdown-wrapper { position:relative; min-width:140px; display:inline-flex; flex-direction:column; gap:4px; font-family:"Segoe UI",sans-serif; }
    .smax-custom-dropdown-display { width:100%; border-radius:10px; border:1px solid #1f2937; background:#0f172a; color:#f8fafc; font-size:12px; min-height:32px; padding:6px 12px; text-align:left; cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:8px; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease, color .15s ease; outline:none; }
    .smax-custom-dropdown-display:disabled { opacity:0.6; cursor:not-allowed; }
    .smax-custom-chevron { font-size:11px; color:#94a3b8; transition:transform .15s ease; pointer-events:none; }
    .smax-custom-dropdown-wrapper[data-open="true"] .smax-custom-chevron { transform:rotate(180deg); }
    .smax-custom-dropdown-menu { position:absolute; bottom:calc(100% + 6px); left:0; min-width:100%; white-space:nowrap; background:#020617; border:1px solid #1f2937; border-radius:12px; box-shadow:0 18px 45px rgba(0,0,0,.55); padding:8px; display:none; flex-direction:column; z-index:10000; }
    .smax-custom-dropdown-wrapper[data-open="true"] .smax-custom-dropdown-menu { display:flex; }
    #smax-triage-status-wrapper .smax-custom-dropdown-menu { bottom:auto; top:calc(100% + 6px); }
    .smax-custom-dropdown-options { max-height:240px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; }
    .smax-custom-dropdown-item { border-radius:8px; border:1px solid transparent; background:rgba(15,23,42,0.85); color:#e2e8f0; font-size:12px; padding:7px 10px; text-align:left; cursor:pointer; transition:all .12s ease; display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .smax-custom-dropdown-item:hover { border-color:#38bdf8; background:#0f172a; color:#f8fafc; }
    .smax-custom-dropdown-item[data-selected="true"] { border-color:#22c55e; background:#052e16; color:#bbf7d0; }

    /* ── Settings panel · eye-comfort overrides ─────────────────
       Optimised for cold-tone high-DPI Dell institutional monitors.
       Warmer backgrounds, higher contrast borders, readable body text. */
    #smax-settings {
      background: #12161e !important;          /* warmer charcoal vs cold #0f172a */
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      letter-spacing: .01em;
    }
    #smax-settings *, #smax-settings *::placeholder {
      -webkit-font-smoothing: antialiased;
    }
    /* Brighter placeholder text (was invisible gray on dark) */
    #smax-settings input::placeholder,
    #smax-settings textarea::placeholder {
      color: #8899aa !important;
      opacity: 1 !important;
    }
    /* All input/textarea fields: warmer bg, brighter borders, bigger text */
    #smax-settings input[type="text"],
    #smax-settings input[type="number"],
    #smax-settings textarea {
      background: #1a2030 !important;          /* slightly warmer than #1e293b */
      border-color: #566378 !important;        /* more visible than #475569 */
      color: #edf0f4 !important;
      font-size: 13px !important;
      line-height: 1.5;
    }
    #smax-settings input:focus,
    #smax-settings textarea:focus {
      border-color: #6cb4d9 !important;        /* softer focus ring (less electric blue) */
      box-shadow: 0 0 6px rgba(108,180,217,.30) !important;
      outline: none;
    }
    /* Labels: warmer white instead of cool slate */
    #smax-settings label {
      color: #d0d7de !important;
    }
    /* Section headings */
    #smax-settings [style*="font-weight:600"][style*="color:#e5e7eb"],
    #smax-settings [style*="font-weight:600"][style*="color:#38bdf8"] {
      text-shadow: 0 1px 2px rgba(0,0,0,.25);
    }
    /* Inner cards - warmer tint */
    #smax-settings [style*="rgba(2,6,23"] {
      background: rgba(18,22,30,0.92) !important;
    }
    #smax-settings [style*="rgba(15,23,42"] {
      background: rgba(22,28,38,0.75) !important;
    }
    /* Borders: boost visibility across the board */
    #smax-settings [style*="border:1px solid #475569"],
    #smax-settings [style*="border: 1px solid #475569"],
    #smax-settings [style*="border:1px solid rgba(255,255,255,.1)"] {
      border-color: #566378 !important;
    }
    /* Team item cards */
    #smax-settings .smax-team-item {
      border-color: rgba(255,255,255,.14) !important;
      background: linear-gradient(135deg,rgba(22,28,38,0.85) 0%,rgba(30,38,50,0.5) 100%) !important;
    }
    /* Buttons in the bottom action row */
    #smax-settings button {
      font-family: "Segoe UI", system-ui, sans-serif;
    }
  `);


  /* ========================================================
   * Utilities
   * =======================================================*/
  const Utils = (() => {
    const debounce = (fn, wait = 120) => {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
      };
    };

    const getGridViewport = (root = document) => root.querySelector('.slick-viewport') || root;

    const parseSmaxDateTime = (str) => {
      if (!str) return null;
      const match = str.trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (!match) return null;
      let [, d, mo, y, h, mi, s] = match;
      d = parseInt(d, 10);
      mo = parseInt(mo, 10) - 1;
      let year = parseInt(y, 10);
      if (year < 100) year += 2000;
      h = parseInt(h, 10);
      mi = parseInt(mi, 10);
      s = s ? parseInt(s, 10) : 0;
      return new Date(year, mo, d, h, mi, s).getTime();
    };

    const parseDigitRanges = (input) => {
      const digits = [];
      const parts = (input || '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map((s) => parseInt(s.trim(), 10));
          if (!isNaN(start) && !isNaN(end) && start <= end) {
            for (let i = start; i <= end; i += 1) digits.push(i);
          }
        } else {
          const num = parseInt(part, 10);
          if (!isNaN(num)) digits.push(num);
        }
      }
      return [...new Set(digits)].sort((a, b) => a - b);
    };

    const digitsToRangeString = (digits) => {
      if (!digits || !digits.length) return '';
      const sorted = [...new Set(digits)].sort((a, b) => a - b);
      const ranges = [];
      let start = sorted[0];
      let end = sorted[0];

      for (let i = 1; i <= sorted.length; i += 1) {
        if (i < sorted.length && sorted[i] === end + 1) {
          end = sorted[i];
        } else {
          if (end - start >= 2) ranges.push(`${start}-${end}`);
          else if (end === start) ranges.push(`${start}`);
          else ranges.push(`${start},${end}`);
          start = sorted[i];
          end = sorted[i];
        }
      }

      return ranges.join(',');
    };

    const extractTrailingDigits = (text) => {
      const best = String(text || '').match(/(\d{2,})\b(?!.*\d)/);
      if (best) return best[1];
      const fallback = String(text || '').match(/(\d+)(?!.*\d)/);
      return fallback ? fallback[1] : '';
    };

    const normalizeRequestId = (value) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return '';
      const digits = trimmed.replace(/\D/g, '');
      return digits || trimmed;
    };

    const normalizeAttachmentId = (value) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return '';
      return trimmed.replace(/^Attachment:/i, '');
    };

    const locateSolutionEditor = () => {
      const ck = getPageCKEditor();
      if (!(ck && ck.instances)) return null;
      return Object.values(ck.instances).find((inst) => {
        const el = inst.element && inst.element.$;
        if (!el) return false;
        const id = el.id || '';
        const name = el.getAttribute && el.getAttribute('name') || '';
        return /solution|solucao|plCkeditor/i.test(`${id} ${name}`);
      }) || null;
    };

    const focusSolutionEditor = () => {
      try {
        const hasCk = locateSolutionEditor();
        if (!hasCk) {
          const editIcon = document.querySelector('.icon-edit.pl-toolbar-item-icon');
          if (editIcon) editIcon.click();
        }
      } catch (err) {
        console.warn('[SMAX] Failed to toggle CKEditor:', err);
      }

      setTimeout(() => {
        try {
          const inst = locateSolutionEditor();
          if (inst && typeof inst.focus === 'function') {
            inst.focus();
            return;
          }
        } catch (err) {
          console.warn('[SMAX] Failed to focus CKEditor instance:', err);
        }

        const el = document.querySelector('[name="Solution"], #Solution, [id^="plCkeditor"], [data-aid="preview_Solution"]');
        if (el && typeof el.focus === 'function') {
          el.focus();
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 200);
    };

    const pushSolutionHtml = (html, { append = false } = {}) => new Promise((resolve) => {
      if (!html) {
        resolve(false);
        return;
      }
      focusSolutionEditor();
      let tries = 0;
      const attempt = () => {
        const inst = locateSolutionEditor();
        if (inst && typeof inst.setData === 'function') {
          try {
            if (append) inst.setData((inst.getData() || '') + html);
            else inst.setData(html);
            if (typeof inst.focus === 'function') inst.focus();
            resolve(true);
          } catch (err) {
            console.warn('[SMAX] Failed to push HTML into solution editor:', err);
            resolve(false);
          }
          return;
        }
        if (tries >= 10) {
          resolve(false);
          return;
        }
        tries += 1;
        setTimeout(attempt, 250);
      };
      attempt();
    });

    const sanitizeRichText = (html) => {
      if (!html) return '';
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      tmp.querySelectorAll('script, style').forEach((el) => el.remove());
      tmp.querySelectorAll('*').forEach((node) => {
        Array.from(node.attributes || []).forEach((attr) => {
          if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
          if (attr.name.toLowerCase() === 'style') node.removeAttribute(attr.name);
        });
      });
      return tmp.innerHTML;
    };

    const toAbsoluteUrl = (value) => {
      if (!value) return '';
      try {
        return new URL(value, window.location.origin).href;
      } catch {
        return value;
      }
    };

    const escapeHtml = (value) => {
      if (value == null) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const onDomReady = (fn) => {
      if (typeof fn !== 'function') return;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once: true });
      } else {
        fn();
      }
    };

    const normalizeText = (s) => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

    const formatBrDate = (ts, fallbackText, options = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, fallbackDefault = 'Faltando na visão') => {
      if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
        try { return new Date(ts).toLocaleString('pt-BR', options); } catch { }
      }
      const parsed = parseSmaxDateTime(fallbackText || '');
      if (parsed) {
        try { return new Date(parsed).toLocaleString('pt-BR', options); } catch { }
      }
      return fallbackText || fallbackDefault;
    };

    const deepClone = (value) => {
      if (Array.isArray(value)) return value.map((item) => deepClone(item));
      if (value && typeof value === 'object') {
        return Object.entries(value).reduce((acc, [key, val]) => {
          acc[key] = deepClone(val);
          return acc;
        }, {});
      }
      return value;
    };

    const normalizeHtml = (html) => (html || '')
      .replace(/\r/g, '')
      .replace(/\u00a0/gi, ' ')
      .trim();

    const triggerFileDownload = (objectUrl, filename) => {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename || 'anexo';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    };

    // ── CNJ linkifier ────────────────────────────────────────
    // Detecta dois formatos:
    //   Formatado : NNNNNNN-DD.AAAA.J.TT.OOOO  (ex: 4000439-14.2026.8.26.0201)
    //   Bruto     : 20 dígitos seguidos          (ex: 40004391420268260201)
    //
    // Ao clicar, foca/abre a aba nomeada "eproc-consulta" (já logada) e envia o
    // número via postMessage para o bridge script executar a busca de dentro da sessão.
    const CNJ_REGEX = /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|\d{20})\b/g;

    const formatRawCNJ = (raw) =>
      `${raw.slice(0,7)}-${raw.slice(7,9)}.${raw.slice(9,13)}.${raw.slice(13,14)}.${raw.slice(14,16)}.${raw.slice(16,20)}`;

    const normalizeCNJ = (s) => (/^\d{20}$/.test(s.trim()) ? formatRawCNJ(s.trim()) : s.trim());

    const EPROC_ORIGIN = 'https://eproc1g.tjsp.jus.br';
    const EPROC_URL    = 'https://eproc1g.tjsp.jus.br/eproc/controlador.php';

    // Abre (ou foca) a aba do eProc e despacha o número via postMessage.
    // O bridge script rodando no eProc recebe e executa a consulta dentro da sessão ativa.
    const openEprocProcess = (processNumber) => {
      const eprocWin = window.open(EPROC_URL, 'eproc-consulta');
      if (!eprocWin) {
        // Popup bloqueado pelo navegador — copia o número como fallback
        navigator.clipboard?.writeText(processNumber).catch(() => {});
        alert(`Popups bloqueados pelo navegador.\nNúmero copiado: ${processNumber}\n\nPermita popups para este site nas configurações do navegador.`);
        return;
      }
      const msg = { type: 'SMAX_CONSULTAR_PROCESSO', num: processNumber };
      // Envia em múltiplos intervalos para cobrir tab já aberta (rápido) e nova aba (aguarda carregamento)
      [300, 1200, 3000].forEach(d => setTimeout(() => {
        try { eprocWin.postMessage(msg, EPROC_ORIGIN); } catch (_) {}
      }, d));
    };

    // Expõe globalmente para uso em atributos onclick de strings innerHTML
    window._smaxOpenEproc = openEprocProcess;

    const linkifyCNJ = (html) => {
      if (!html) return html;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;

      const makeLink = (match) => {
        const formatted = normalizeCNJ(match);
        const span = document.createElement('span');
        span.textContent = formatted;
        span.style.cssText = 'color:#38bdf8;font-family:monospace;font-weight:600;border-bottom:1px dotted rgba(56,189,248,.6);cursor:pointer;';
        span.title = `Consultar processo no eProc: ${formatted}`;
        span.addEventListener('click', () => openEprocProcess(formatted));
        return span;
      };

      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          CNJ_REGEX.lastIndex = 0;
          const text = node.textContent;
          if (!CNJ_REGEX.test(text)) return;
          CNJ_REGEX.lastIndex = 0;
          const frag = document.createDocumentFragment();
          let last = 0;
          let m;
          while ((m = CNJ_REGEX.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            frag.appendChild(makeLink(m[1]));
            last = m.index + m[0].length;
          }
          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
          node.parentNode.replaceChild(frag, node);
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'A' && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
          Array.from(node.childNodes).forEach(walk);
        }
      };

      Array.from(tmp.childNodes).forEach(walk);
      return tmp.innerHTML;
    };
    // ────────────────────────────────────────────────────────

    return {
      debounce,
      getGridViewport,
      parseDigitRanges,
      digitsToRangeString,
      parseSmaxDateTime,
      extractTrailingDigits,
      locateSolutionEditor,
      focusSolutionEditor,
      pushSolutionHtml,
      sanitizeRichText,
      escapeHtml,
      onDomReady,
      normalizeRequestId,
      normalizeAttachmentId,
      toAbsoluteUrl,
      normalizeText,
      formatBrDate,
      deepClone,
      normalizeHtml,
      triggerFileDownload,
      linkifyCNJ,
      normalizeCNJ,
      openEprocProcess
    };
  })();

  /* =========================================================
   * API client (tenant + REST helpers)
   * =======================================================*/
  const ApiClient = (() => {
    let cachedTenantId = null;

    const readCookie = (key) => {
      if (!key) return null;
      const match = document.cookie.match(new RegExp(`${key}=([^;]+)`));
      return match ? decodeURIComponent(match[1]) : null;
    };

    const pickTenantFromUrl = () => {
      try {
        const search = new URLSearchParams(window.location.search || '');
        return search.get('tenantid') || search.get('TENANTID');
      } catch {
        return null;
      }
    };

    const pickTenantFromHash = () => {
      const hash = window.location.hash || '';
      const match = hash.match(/tenantid=(\d+)/i);
      return match ? match[1] : null;
    };

    const pickTenantFromStorage = () => {
      try {
        return sessionStorage.getItem('smaxTenantId') || localStorage.getItem('smaxTenantId');
      } catch {
        return null;
      }
    };

    const resolveTenantId = () => {
      if (cachedTenantId) return cachedTenantId;
      const explicit = window.SMAX_TENANT_ID || window.globalTenantId;
      cachedTenantId = (explicit || pickTenantFromUrl() || pickTenantFromHash() || readCookie('TENANTID') || pickTenantFromStorage() || '').trim();
      if (!cachedTenantId) cachedTenantId = '';
      return cachedTenantId || null;
    };

    const setTenantId = (value) => {
      cachedTenantId = value ? String(value).trim() : '';
    };

    const getTenantId = () => resolveTenantId();

    const restBase = () => {
      const tenantId = getTenantId();
      return tenantId ? `/rest/${tenantId}` : '/rest';
    };

    const normalizePath = (path = '') => {
      if (!path) return restBase();
      if (/^https?:\/\//i.test(path)) return path;
      if (path.startsWith('/rest/')) return path;
      const trimmed = path.replace(/^\/+/, '');
      return `${restBase()}/${trimmed}`.replace(/\/+$/, '');
    };

    const toSearchParams = (input) => {
      if (!input) return null;
      if (input instanceof URLSearchParams) return input;
      const pairs = Object.entries(input).reduce((acc, [key, value]) => {
        if (value === undefined || value === null || value === '') return acc;
        acc.push([key, String(value)]);
        return acc;
      }, []);
      return pairs.length ? new URLSearchParams(pairs) : null;
    };

    const buildUrl = (path, { searchParams, includeTenantParam } = {}) => {
      const url = new URL(normalizePath(path), window.location.origin);
      const params = toSearchParams(searchParams);
      if (params) params.forEach((value, key) => url.searchParams.set(key, value));
      if (includeTenantParam) {
        const tenantId = getTenantId();
        if (tenantId) url.searchParams.set('TENANTID', tenantId);
      }
      return url.toString().replace(/\+/g, '%20');
    };

    const getXsrfToken = () => readCookie('XSRF-TOKEN');

    const prepareBody = (body, headers) => {
      if (!body || typeof body !== 'object') return body;
      if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) return body;
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json;charset=utf-8';
      return JSON.stringify(body);
    };

    const request = async (path, options = {}) => {
      const {
        method = 'GET',
        headers = {},
        body,
        searchParams,
        includeTenantParam = false,
        useXsrf = false,
        expectJson = true,
        timeout = 0
      } = options;
      const finalHeaders = {
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        ...headers
      };
      if (useXsrf) {
        const token = getXsrfToken();
        if (token) finalHeaders['X-XSRF-TOKEN'] = token;
      }
      let abortTimer;
      const controller = timeout ? new AbortController() : null;
      if (controller && timeout) {
        abortTimer = setTimeout(() => controller.abort(), timeout);
      }
      const url = buildUrl(path, { searchParams, includeTenantParam });
      const response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: prepareBody(body, finalHeaders),
        credentials: 'include',
        signal: controller ? controller.signal : undefined
      });
      if (abortTimer) clearTimeout(abortTimer);
      if (!response.ok) throw new Error(`[ApiClient] HTTP ${response.status}`);
      if (!expectJson) return response.text();
      const text = await response.text();
      if (!text) return null;
      try { return JSON.parse(text); } catch { return text; }
    };

    const emsBulk = (payload, options = {}) => request('ems/bulk', {
      method: 'POST',
      body: payload,
      useXsrf: true,
      ...options
    });

    const collectionQuery = (entity, params = {}) => {
      const search = new URLSearchParams();
      ['filter', 'layout', 'view', 'orderBy', 'offset', 'size', 'fields'].forEach((key) => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          search.set(key, params[key]);
        }
      });
      return request(`ems/${entity}`, {
        method: 'GET',
        searchParams: search,
        includeTenantParam: true
      });
    };

    const authenticate = (login, password, { tenantId } = {}) => {
      const params = {};
      const resolvedTenant = tenantId || getTenantId();
      if (resolvedTenant) params.TENANTID = resolvedTenant;
      return request('/auth/authentication-endpoint/authenticate/token', {
        method: 'POST',
        body: { login, password },
        searchParams: params,
        expectJson: false
      });
    };

    return {
      getTenantId,
      setTenantId,
      request,
      restUrl: normalizePath,
      ems: {
        bulk: emsBulk,
        collection: collectionQuery
      },
      authenticate
    };
  })();

  /* =========================================================
   * Teams Config (Multi-team Logic)
   * =======================================================*/
  const TeamsConfig = (() => {
    let cachedTeams = null;

    const getTeams = () => {
      if (cachedTeams) return cachedTeams;
      try {
        const raw = prefs.teamsConfigRaw;
        // If raw is empty or error, use defaults from PrefStore
        const parsed = JSON.parse(raw || '[]');
        cachedTeams = Array.isArray(parsed) && parsed.length > 0 ? parsed : JSON.parse(PrefStore.defaults.teamsConfigRaw);
        // Ensure regex strings are converted to RegExps if needed
        cachedTeams.forEach(t => {
          if (t.matchers) {
            t.matchers.forEach(m => {
              if (m.type === 'regex' && typeof m.pattern === 'string') {
                // simple conversion assuming flags 'i' if not specified
                // Security note: trusted input only
                m._regex = new RegExp(m.pattern, 'i');
              }
            });
          }
        });
        // Sort by priority desc
        cachedTeams.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      } catch (err) {
        console.warn('[SMAX] Failed to parse teams config:', err);
        cachedTeams = [];
      }
      return cachedTeams;
    };

    const getTeamById = (id) => getTeams().find(t => t.id === id) || null;

    // Suggest a team based on ticket data
    // Suggest a team based on ticket data
    const suggestTeam = (ticket) => {
      const teams = getTeams();
      if (!ticket) return teams.find(t => t.isDefault) || teams[0];

      // Use GSE ID (ExpertGroup) for routing based on user requirement
      const gseId = ticket.assignmentGroupId || ticket.ExpertGroup || '';
      const gseName = (ticket.assignmentGroupName || '').toUpperCase();

      // Combine text for matching: GSE > Location > Description > Subject
      const matchText = [
        gseName,
        ticket.locationName || '',
        ticket.descriptionText || '',
        ticket.subjectText || '',
        ticket.descriptionHtml || '' // sometimes raw html helps if text is missing
      ].join(' ').toUpperCase();

      for (const team of teams) {
        if (team.isDefault) continue;

        // Check gseRules (list of {id, name})
        if (team.gseRules && Array.isArray(team.gseRules)) {
          // Check ID
          if (team.gseRules.some(r => r.id === gseId)) return team;
          // Check Name if ID didn't match (or wasn't present)
          if (gseName && team.gseRules.some(r => (r.name || r.id || '').toUpperCase() === gseName)) return team;
        }

        // Check legacy/simple gseIds
        if (team.gseIds && Array.isArray(team.gseIds)) {
          if (team.gseIds.includes(gseId)) return team;
        }

        // Check matchers (regex) - location-based matching
        if (team.matchers && Array.isArray(team.matchers)) {
          for (const m of team.matchers) {
            if (m.type === 'regex' && m._regex) {
              if (m._regex.test(matchText)) return team;
            }
          }
        }

        // Fallback: Check if Team ID or Name is contained in GSE Name (Loose match for "Work exclusively with GSE")
        if (gseName) {
          const idMatch = team.id && gseName.includes(team.id.toUpperCase());
          // Careful with Name match: "JEC / JUIZADO" might not match "VARA DO JEC".
          // But we can check parts or simpler logic? For now, ID match is safest fallback.
          if (idMatch) return team;
        }
      }

      return teams.find(t => t.isDefault) || teams[0];
    };

    const parseWorkers = (rawText) => {
      // Line-based parser: Name (Digits)
      // e.g. "Douglas (00-10)"
      return rawText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        // simplified matcher
        const match = line.match(/^(.+?)\s*[\(\[]([\d,\-\s]+)[\)\]]$/);
        if (match) {
          return { name: match[1].trim(), digits: match[2].trim() };
        }
        return { name: line, digits: '' }; // fallback
      });
    };

    const suggestWorker = (team, ticketIdOrText) => {
      if (!team || !team.workers || !team.workers.length) return null;

      const digitBlock = Utils.extractTrailingDigits(ticketIdOrText) || '';
      if (digitBlock.length < 2) return null;

      // Sliding window loop: check last 2 digits, if owned by absent (or no one?), shift left.
      // Logic mirrors Distribution.ownerForDigits: checks i=length down to 2.
      // e.g. ...5555510 -> check 10. If absent, check 51. If absent, check 55.
      for (let i = digitBlock.length; i >= 2; i -= 1) {
        const pair = digitBlock.slice(i - 2, i);
        const digit = parseInt(pair, 10);
        if (isNaN(digit)) continue;

        for (const w of team.workers) {
          // Optimization: create ranges once per worker/team reload? For now, keep it simple/safe.
          const ranges = Utils.parseDigitRanges(w.digits);
          if (ranges.includes(digit)) {
            if (w.isAbsent) break; // Found owner but absent -> Break inner loop, continue outer (try next pair)
            return w; // Found owner and present -> Return
          }
        }
      }
      return null;
    };

    const getWorkersForTeam = (id) => {
      const t = getTeamById(id);
      return t ? (t.workers || []) : [];
    };

    const reload = () => { cachedTeams = null; };

    return { getTeams, getTeamById, getWorkersForTeam, suggestTeam, suggestWorker, reload };
  })();

  /* =========================================================
   * Color registry for owner badges (Deterministic Team-Based)
   * =======================================================*/
  const ColorRegistry = (() => {
    // Aesthetic color palettes - each team gets one
    // REDESIGNED: Wider hue ranges for more variety, lower saturation for softer look
    const TEAM_PALETTES = [
      // Team 0: Ocean Blues (wide range from cyan to deep blue)
      { name: 'ocean', hueStart: 185, hueEnd: 245, saturation: 40, lightnessStart: 40, lightnessEnd: 65 },
      // Team 1: Earth Greens (olive to emerald)
      { name: 'forest', hueStart: 80, hueEnd: 160, saturation: 35, lightnessStart: 35, lightnessEnd: 60 },
      // Team 2: Warm Spectrum (peach to terracotta)
      { name: 'warm', hueStart: 5, hueEnd: 45, saturation: 45, lightnessStart: 45, lightnessEnd: 68 },
      // Team 3: Cool Purples (lavender to plum)
      { name: 'purple', hueStart: 250, hueEnd: 320, saturation: 35, lightnessStart: 42, lightnessEnd: 65 },
      // Team 4: Aqua Range (mint to teal)
      { name: 'aqua', hueStart: 155, hueEnd: 200, saturation: 38, lightnessStart: 38, lightnessEnd: 62 },
      // Team 5: Berry Tones (rose to magenta)
      { name: 'berry', hueStart: 320, hueEnd: 360, saturation: 40, lightnessStart: 45, lightnessEnd: 65 },
      // Team 6: Neutral Blues (steel to slate)
      { name: 'slate', hueStart: 200, hueEnd: 230, saturation: 18, lightnessStart: 40, lightnessEnd: 62 },
      // Team 7: Golden Range (sand to amber)
      { name: 'golden', hueStart: 35, hueEnd: 80, saturation: 42, lightnessStart: 48, lightnessEnd: 68 }
    ];

    // Cache for computed colors
    const colorCache = new Map();

    /**
     * Generate a color based on team index and last 2 digits of ticket ID
     * @param {number} teamIndex - Index of the team (0-based)
     * @param {number} lastTwoDigits - Last 2 digits of ticket ID (0-99)
     * @returns {{bg: string, fg: string}}
     */
    const generateForTeamAndDigits = (teamIndex, lastTwoDigits) => {
      // "All colors", forget differentiating teams
      // Map 0-99 to 0-360 degrees for maximum variety
      const t = lastTwoDigits / 99;

      // Use a pseudo-random spread to avoid adjacent numbers having adjacent colors
      // Multiply by a prime number (e.g., 137 degrees - golden angle approx) to scatter colors
      const hue = (lastTwoDigits * 137.5) % 360;

      // High saturation for vibrancy (65-85%)
      const saturation = 70 + (Math.sin(t * Math.PI * 4) * 10);

      // Balanced lightness (45-60%) for readability
      const lightness = 50 + (Math.cos(t * Math.PI * 2) * 8);

      const bg = `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
      // Always white text for these vibrant dark/mid colors
      const fg = '#ffffff';

      return { bg, fg };
    };

    /**
     * Get the team index from TeamsConfig
     * @param {string} teamId - Team ID
     * @returns {number} Team index (0-based)
     */
    const getTeamIndex = (teamId) => {
      if (!teamId) return 0;
      const teams = TeamsConfig.getTeams();
      const idx = teams.findIndex(t => t.id === teamId);
      return idx >= 0 ? idx : 0;
    };

    /**
     * Get deterministic color for a ticket based on team and ID
     * @param {Object} options - Color options
     * @param {string} options.teamId - Team ID
     * @param {string|number} options.ticketId - Ticket ID (will extract last 2 digits)
     * @returns {{bg: string, fg: string}}
     */
    const getForTicket = ({ teamId, ticketId }) => {
      // Extract last 2 digits from ticket ID
      const idStr = String(ticketId || '').replace(/\D/g, '');
      const lastTwo = idStr.length >= 2 ? parseInt(idStr.slice(-2), 10) : 0;
      const teamIndex = getTeamIndex(teamId);

      const cacheKey = `${teamIndex}-${lastTwo}`;
      if (colorCache.has(cacheKey)) return colorCache.get(cacheKey);

      const color = generateForTeamAndDigits(teamIndex, lastTwo);
      colorCache.set(cacheKey, color);
      return color;
    };

    /**
     * Legacy fallback: Get color by name (hash-based)
     * Used when team/ticket info is not available
     * @param {string} name - Worker/owner name
     * @returns {{bg: string, fg: string}}
     */
    const get = (name) => {
      if (!name) return { bg: '#374151', fg: '#fff' };

      // Legacy hash-based generation for backwards compatibility
      let hash = 0;
      for (let i = 0; i < name.length; i += 1) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash % 360);
      const saturation = 45 + (Math.abs(hash >> 8) % 30);
      const lightness = 50 + (Math.abs(hash >> 16) % 20);
      const bg = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
      const fg = lightness > 60 ? '#000' : '#fff';
      return { bg, fg };
    };

    const clearCache = () => colorCache.clear();

    return { get, getForTicket, clearCache };
  })();

  /* =========================================================
   * Data repository (requests + people caches)
   * =======================================================*/
  const DataRepository = (() => {
    const triageCache = new Map();
    let triageIds = [];
    const peopleCache = new Map();
    const manualPeopleSeed = [
      {
        id: '95970',
        name: 'ROBSON SOUZA ALVES',
        upn: 'robsonalves',
        email: 'robsonalves@tjsp.jus.br',
        isVip: false,
        employeeNumber: '367442',
        firstName: 'ROBSON',
        lastName: 'SOUZA ALVES',
        location: '49893064'
      }
    ];
    const supportGroupMap = new Map();
    let supportGroupTotal = null;
    const supportGroupListeners = new Set();
    let supportGroupsLoadPromise = null;
    let supportGroupsLoadedOnce = false;

    const ensureManualPeople = () => {
      manualPeopleSeed.forEach((person) => {
        if (!person || !person.id) return;
        if (!person.email && !person.upn) return;
        if (!peopleCache.has(person.id)) peopleCache.set(person.id, Object.assign({}, person));
      });
    };
    let peopleTotal = null;
    const queueListeners = new Set();
    const peopleListeners = new Set();
    const getSupportGroupsSnapshot = () => Array.from(supportGroupMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const notifySupportGroupListeners = () => {
      const snapshot = getSupportGroupsSnapshot();
      supportGroupListeners.forEach((fn) => {
        try { fn(snapshot); } catch (err) { console.warn('[SMAX] Support group listener failed:', err); }
      });
    };
    ensureManualPeople();
    let peopleLoadPromise = null;
    let peopleLoadedOnce = false;
    const ingestSupportGroupPayload = (payload) => {
      try {
        if (!payload || typeof payload !== 'object') return;
        if (payload.meta && typeof payload.meta.total_count === 'number') supportGroupTotal = payload.meta.total_count;
        const entities = Array.isArray(payload.entities) ? payload.entities : [];
        entities.forEach((ent) => {
          if (!ent || ent.entity_type !== 'PersonGroup') return;
          const props = ent.properties || {};
          const id = props.Id != null ? String(props.Id) : '';
          const name = (props.Name || '').toString().trim();
          if (!id || !name) return;
          supportGroupMap.set(id, { id, name, isDeleted: !!props.IsDeleted });
        });
        notifySupportGroupListeners();
      } catch (err) {
        console.warn('[SMAX] Failed to ingest support group payload:', err);
      }
    };

    const notifyQueueListeners = () => {
      queueListeners.forEach((fn) => {
        try { fn(); } catch (err) { console.warn('[SMAX] Queue listener failed:', err); }
      });
    };

    const notifyPeopleListeners = () => {
      peopleListeners.forEach((fn) => {
        try { fn(peopleCache); } catch (err) { console.warn('[SMAX] People listener failed:', err); }
      });
    };

    const discussionPurposeLabels = {
      SolucaoContorno_c: 'Solução de Contorno',
      FollowUp: 'Acompanhamento',
      StatusUpdate: 'Atualização de status',
      Resolution: 'Resolução',
      Workaround: 'Solução temporária',
      CustomerResponse: 'Resposta do usuário',
      AgentResponse: 'Resposta do agente',
      Information: 'Informação adicional',
      CommunicationLog: 'Registro de comunicação',
      WorkLog: 'Registro de trabalho'
    };

    const mapPurposeLabel = (code) => {
      if (!code) return 'Discussão';
      if (discussionPurposeLabels[code]) return discussionPurposeLabels[code];
      const cleaned = String(code)
        .replace(/_c$/i, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .trim();
      if (!cleaned) return 'Discussão';
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    };

    const mapPrivacyLabel = (privacy) => {
      if (!privacy) return { code: '', label: 'Interno' };
      const normalized = String(privacy).toUpperCase();
      if (normalized === 'PUBLIC') return { code: normalized, label: 'Público' };
      if (normalized === 'EXTERNAL') return { code: normalized, label: 'Externo' };
      return { code: normalized, label: 'Interno' };
    };
    const normalizeGroupIdValue = (value) => {
      if (!value) return '';
      if (typeof value === 'string') {
        const cleaned = value.replace(/PersonGroup:?/i, '').trim();
        const match = cleaned.match(/\d{3,}/g);
        if (match && match.length) return match[match.length - 1];
        return cleaned;
      }
      if (typeof value === 'object') {
        if (value.Id != null) return String(value.Id);
        if (value.id != null) return String(value.id);
        if (value.href) {
          const match = String(value.href).match(/PersonGroup\/([0-9]+)/i);
          if (match) return match[1];
        }
      }
      return '';
    };
    const pickAssignmentGroupMeta = (props = {}, rel = {}) => {
      const relGroup = rel && rel.AssignmentGroup ? rel.AssignmentGroup : null;
      const relExpertGroup = rel && rel.ExpertGroup ? rel.ExpertGroup : null;
      const relAssignedGroup = rel && rel.AssignedToGroup ? rel.AssignedToGroup : null;
      const idSources = [
        props.AssignmentGroup,
        relGroup,
        props.AssignmentGroupRef,
        props.AssignmentGroupId,
        props.AssignmentGroupId_c,
        props.ExpertGroup,
        relExpertGroup,
        relAssignedGroup,
        props.AssignedToGroup
      ];
      let assignmentGroupId = '';
      for (const src of idSources) {
        assignmentGroupId = normalizeGroupIdValue(src);
        if (assignmentGroupId) break;
      }
      const nameCandidates = [
        props.AssignmentGroupDisplayLabel,
        props.AssignmentGroupName,
        relGroup && (relGroup.DisplayLabel || relGroup.Name || relGroup.label),
        relExpertGroup && (relExpertGroup.DisplayLabel || relExpertGroup.Name || relExpertGroup.label),
        relAssignedGroup && (relAssignedGroup.DisplayLabel || relAssignedGroup.Name || relAssignedGroup.label)
      ];
      let assignmentGroupName = '';
      for (const candidate of nameCandidates) {
        if (!candidate) continue;
        const trimmed = String(candidate).trim();
        if (trimmed) {
          assignmentGroupName = trimmed;
          break;
        }
      }
      return { assignmentGroupId, assignmentGroupName };
    };

    const normalizeCommentEntry = (raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const bodySource = raw.CommentBody || raw.Body || raw.body || '';
      let safeHtml = Utils.sanitizeRichText(bodySource);
      if (!safeHtml) {
        const fallback = bodySource ? Utils.escapeHtml(String(bodySource)) : '';
        safeHtml = fallback;
      }
      const tmp = document.createElement('div');
      tmp.innerHTML = safeHtml;
      const bodyText = (tmp.textContent || tmp.innerText || '').trim();
      const timeRaw = raw.CreateTime;
      let createdTs = 0;
      if (typeof timeRaw === 'number') createdTs = timeRaw;
      else if (timeRaw) createdTs = Utils.parseSmaxDateTime(String(timeRaw)) || 0;
      if (!safeHtml && !bodyText) return null;

      const purposeCode = raw.FunctionalPurpose || '';
      const { code: privacyCode, label: privacyLabel } = mapPrivacyLabel(raw.PrivacyType || '');
      const submitter = raw.Submitter || raw.SubmitterId || '';
      let submitterPersonId = '';
      if (submitter) {
        const match = submitter.match(/Person\/(\d+)/i);
        if (match) submitterPersonId = match[1];
      }
      const submitterDisplayCandidates = [raw.SubmitterDisplay, raw.CommentFrom, raw.CommentTo];
      let submitterDisplay = '';
      for (const candidate of submitterDisplayCandidates) {
        if (!candidate) continue;
        const trimmed = String(candidate).trim();
        if (trimmed) {
          submitterDisplay = trimmed;
          break;
        }
      }
      const actualInterface = (raw.ActualInterface || '').toUpperCase();
      const systemGenerated = actualInterface === 'SYSTEM';
      const idFallbackSeed = purposeCode || submitter || 'comment';
      const id = raw.CommentId || raw.id || raw.Id || `${idFallbackSeed}-${createdTs || Date.now()}`;

      return {
        id,
        purposeCode,
        purposeLabel: mapPurposeLabel(purposeCode),
        privacyCode,
        privacyLabel,
        bodyHtml: safeHtml,
        bodyText,
        createdTs,
        createdRaw: timeRaw || '',
        systemGenerated,
        submitter,
        submitterPersonId,
        submitterDisplay
      };
    };

    const parseCommentsCollection = (value) => {
      if (!value) return [];
      let payload = value;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (err) {
          console.warn('[SMAX] Failed to parse comments payload:', err);
          return [];
        }
      }
      let list = [];
      if (Array.isArray(payload)) list = payload;
      else if (Array.isArray(payload.Comment)) list = payload.Comment;
      else if (Array.isArray(payload.comments)) list = payload.comments;
      else if (Array.isArray(payload.complexTypeProperties)) list = payload.complexTypeProperties.map((item) => item && item.properties).filter(Boolean);
      const normalized = [];
      list.forEach((entry) => {
        const parsed = normalizeCommentEntry(entry);
        if (parsed) normalized.push(parsed);
      });
      normalized.sort((a, b) => (a.createdTs || 0) - (b.createdTs || 0));
      return normalized;
    };

    const upsertTriageEntryFromProps = (props, rel) => {
      if (!props) return;

      if (rel && typeof rel === 'object') {
        Object.values(rel).forEach((val) => {
          if (val && typeof val === 'object' && val.Id && val.Name) {
            const pid = String(val.Id);
            if (!DataRepository.peopleCache.has(pid)) {
              let firstName = val.Name;
              let lastName = '';
              const parts = val.Name.split(' ');
              if (parts.length > 1) {
                firstName = parts[0];
                lastName = parts.slice(1).join(' ');
              }
              DataRepository.peopleCache.set(pid, {
                id: pid,
                name: val.Name,
                upn: val.Upn || '',
                firstName,
                lastName,
                fullName: val.Name,
                IsVIP: !!val.IsVIP
              });
            }
          }
        });
      }

      const id = props.Id != null ? String(props.Id) : '';
      if (!id) return;

      const createdRaw = props.CreateTime;
      let createdText = '';
      let createdTs = 0;
      if (typeof createdRaw === 'number') {
        createdTs = createdRaw;
        createdText = new Date(createdRaw).toLocaleString();
      } else if (createdRaw != null) {
        createdText = String(createdRaw);
        createdTs = Utils.parseSmaxDateTime(createdText) || 0;
      }

      const priority = props.Priority || '';
      const isVipPerson = !!(rel && rel.RequestedForPerson && rel.RequestedForPerson.IsVIP);
      const isVip = isVipPerson || /VIP/i.test(String(priority));

      const descHtml = props.Description || '';
      const tmpDiv = document.createElement('div');
      tmpDiv.innerHTML = String(descHtml);
      const fullText = (tmpDiv.textContent || tmpDiv.innerText || '').trim();
      const subjectText = fullText.split('\n')[0] || '';
      const hasInlineImage = /<img\b/i.test(String(descHtml));

      const solutionHtml = props.Solution || '';
      const solutionDiv = document.createElement('div');
      solutionDiv.innerHTML = String(solutionHtml);
      const solutionText = (solutionDiv.textContent || solutionDiv.innerText || '').trim();

      const idNum = parseInt(id.replace(/\D/g, ''), 10);
      const existing = triageCache.get(id) || {};
      let requestedForName = '';
      const requestedRel = rel && rel.RequestedForPerson ? rel.RequestedForPerson : null;
      const requestedProps = props && props.RequestedForPerson ? props.RequestedForPerson : null;
      const requestedCandidates = [
        requestedRel && requestedRel.DisplayLabel,
        requestedRel && requestedRel.Name,
        requestedRel && requestedRel.PrimaryDisplayValue,
        requestedRel && requestedRel.FullName,
        requestedProps && requestedProps.DisplayLabel,
        requestedProps && requestedProps.Name,
        requestedProps && requestedProps.FullName,
        props && props.RequestedForDisplayLabel,
        props && props.RequestedForName
      ];
      for (const candidate of requestedCandidates) {
        if (!candidate) continue;
        const trimmed = String(candidate).trim();
        if (trimmed) {
          requestedForName = trimmed;
          break;
        }
      }
      if (!requestedForName && existing.requestedForName) requestedForName = existing.requestedForName;

      let discussions = parseCommentsCollection(props.Comments || props.comments);
      if (!discussions.length && existing.discussions) discussions = existing.discussions;

      // Extract process number from UserOptions (NumerodoProcesso_c field)
      let processNumber = '';
      try {
        const userOpts = props.UserOptions;
        if (userOpts) {
          let parsed = userOpts;
          if (typeof userOpts === 'string') parsed = JSON.parse(userOpts);
          if (parsed && Array.isArray(parsed.complexTypeProperties) && parsed.complexTypeProperties.length) {
            const innerProps = parsed.complexTypeProperties[0]?.properties;
            if (innerProps && innerProps.NumerodoProcesso_c) {
              processNumber = String(innerProps.NumerodoProcesso_c).trim();
            }
          }
        }
      } catch (err) {
        console.warn('[SMAX] Failed to parse UserOptions for process number:', err);
      }
      if (!processNumber && existing.processNumber) processNumber = existing.processNumber;

      // Extract RegisteredForLocation (read-only display)
      let locationId = '';
      let locationName = '';
      const locationRel = rel && rel.RegisteredForLocation ? rel.RegisteredForLocation : null;
      if (locationRel) {
        locationId = locationRel.Id ? String(locationRel.Id) : '';
        const locationCandidates = [
          locationRel.DisplayLabel,
          locationRel.Name,
          locationRel.DisplayName,
          locationRel.FullName
        ];
        for (const candidate of locationCandidates) {
          if (!candidate) continue;
          const trimmed = String(candidate).trim();
          if (trimmed) {
            locationName = trimmed;
            break;
          }
        }
      }
      if (!locationId && existing.locationId) locationId = existing.locationId;
      if (!locationName && existing.locationName) locationName = existing.locationName;

      // Extract Status (e.g. "RequestStatusSuspended")
      let status = props.Status ? String(props.Status).trim() : '';
      if (!status && existing.status) status = existing.status;

      const { assignmentGroupId, assignmentGroupName } = pickAssignmentGroupMeta(props, rel);
      triageCache.set(id, Object.assign({}, existing, {
        idText: id,
        idNum: Number.isNaN(idNum) ? null : idNum,
        createdText,
        createdTs,
        isVip,
        subjectText,
        descriptionHtml: String(descHtml),
        descriptionText: fullText,
        hasInlineImage,
        solutionHtml: String(solutionHtml),
        solutionText,
        requestedForName,
        discussions,
        assignmentGroupId,
        assignmentGroupName,
        processNumber,
        locationId,
        locationName,
        status
      }));
    };

    const ingestRequestListPayload = (obj) => {
      try {
        if (!obj || typeof obj !== 'object') return;
        const entities = Array.isArray(obj.entities) ? obj.entities : [];
        const list = [];
        for (const ent of entities) {
          if (!ent || typeof ent !== 'object') continue;
          const props = ent.properties || {};
          const rel = ent.related_properties || {};
          upsertTriageEntryFromProps(props, rel);

          const id = props.Id != null ? String(props.Id) : '';
          if (!id) continue;

          const createdRaw = props.CreateTime;
          let createdTs = 0;
          if (typeof createdRaw === 'number') createdTs = createdRaw;

          const priority = props.Priority || '';
          const isVipPerson = !!(rel && rel.RequestedForPerson && rel.RequestedForPerson.IsVIP);
          const isVip = isVipPerson || /VIP/i.test(String(priority));

          const idNum = parseInt(id.replace(/\D/g, ''), 10);
          list.push({
            idText: id,
            idNum: Number.isNaN(idNum) ? null : idNum,
            createdTs,
            isVip,
            assignmentGroupId: props.ExpertGroup || '',
            assignmentGroupName: (rel.ExpertGroup && rel.ExpertGroup.Name) || ''
          });
        }

        if (list.length) {
          list.sort((a, b) => {
            if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
            if (a.createdTs !== b.createdTs) return a.createdTs - b.createdTs;
            if (a.idNum != null && b.idNum != null && a.idNum !== b.idNum) return a.idNum - b.idNum;
            return 0;
          });
          triageIds = list;
          notifyQueueListeners();
        }
      } catch (err) {
        console.warn('[SMAX] Failed to ingest request payload:', err);
      }
    };

    const ingestRequestDetailPayload = (obj) => {
      try {
        if (!obj || typeof obj !== 'object') return;
        const entities = Array.isArray(obj.entities) ? obj.entities : [];
        if (!entities.length) return;
        const ent = entities[0] || {};
        upsertTriageEntryFromProps(ent.properties || {}, ent.related_properties || {});
      } catch (err) {
        console.warn('[SMAX] Failed to ingest request detail payload:', err);
      }
    };

    const ingestPersonListPayload = (obj) => {
      try {
        if (!obj || typeof obj !== 'object') return;
        if (obj.meta && typeof obj.meta.total_count === 'number') {
          peopleTotal = obj.meta.total_count;
        }
        const entities = Array.isArray(obj.entities) ? obj.entities : [];
        for (const ent of entities) {
          if (!ent || typeof ent !== 'object') continue;
          if (ent.entity_type !== 'Person') continue;
          const props = ent.properties || {};
          const id = props.Id != null ? String(props.Id) : '';
          if (!id) continue;

          const payload = {
            id,
            name: (props.Name || '').toString().trim(),
            upn: (props.Upn || '').toString().trim(),
            email: (props.Email || '').toString().trim(),
            isVip: !!props.IsVIP,
            employeeNumber: props.EmployeeNumber || '',
            firstName: props.FirstName || '',
            lastName: props.LastName || '',
            location: props.Location || ''
          };
          if (!payload.email && !payload.upn) continue;
          peopleCache.set(id, payload);
        }
        notifyPeopleListeners();
      } catch (err) {
        console.warn('[SMAX] Failed to ingest person payload:', err);
      }
    };

    const basePeopleParams = {
      filter: '(PersonToGroup[Id in (51642955)])',
      layout: 'Name,Avatar,Location,IsVIP,OrganizationalGroup,Upn,IsDeleted,FirstName,LastName,EmployeeNumber,Email',
      meta: 'totalCount',
      order: 'Name asc',
      size: 50,
      skip: 0
    };
    const supportGroupBaseParams = {
      filter: "(Status = 'Active' or Status = null)",
      layout: 'Id,Name,IsDeleted',
      meta: 'totalCount',
      order: 'Name asc',
      size: 200,
      skip: 0
    };

    const toQueryParams = (base, overrides = {}) => {
      const merged = Object.assign({}, base, overrides);
      return Object.entries(merged).reduce((acc, [key, value]) => {
        if (value === undefined || value === null || value === '') return acc;
        acc[key] = value;
        return acc;
      }, {});
    };

    const fetchPeoplePage = async (skip = 0) => {
      const payload = await ApiClient.request('ems/Person', {
        method: 'GET',
        searchParams: toQueryParams(basePeopleParams, { skip }),
        includeTenantParam: true
      });
      ingestPersonListPayload(payload);
      return payload;
    };
    const fetchSupportGroupPage = async (skip = 0) => {
      const payload = await ApiClient.request('ems/PersonGroup', {
        method: 'GET',
        searchParams: toQueryParams(supportGroupBaseParams, { skip }),
        includeTenantParam: true
      });
      ingestSupportGroupPayload(payload);
      return payload;
    };

    const buildLegacyPeopleUrl = (size, skip) => {
      const encode = (value) => encodeURIComponent(value);
      const base = `${ApiClient.restUrl('ems/Person')}?filter=${encode(basePeopleParams.filter)}&layout=${encode(basePeopleParams.layout)}&meta=${encode(basePeopleParams.meta)}&order=${encode(basePeopleParams.order)}`;
      return `${base}&size=${encode(String(size))}&skip=${encode(String(skip || 0))}`;
    };

    const legacyFetchPeoplePages = () => {
      const pageSize = basePeopleParams.size || 50;
      const headers = { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' };
      const fetchPage = (skip) => fetch(buildLegacyPeopleUrl(pageSize, skip), { credentials: 'include', headers })
        .then((r) => r.text())
        .then((txt) => {
          if (!txt) return;
          try {
            ingestPersonListPayload(JSON.parse(txt));
          } catch (err) {
            console.warn('[SMAX] Legacy people fetch failed to parse page:', err);
          }
        })
        .catch((err) => console.warn('[SMAX] Legacy people fetch failed:', err));

      return fetchPage(0).then(() => {
        if (typeof peopleTotal !== 'number' || peopleTotal <= peopleCache.size) {
          peopleLoadedOnce = true;
          return;
        }
        const tasks = [];
        for (let skip = pageSize; skip < peopleTotal; skip += pageSize) {
          tasks.push(fetchPage(skip));
        }
        return Promise.all(tasks).then(() => {
          peopleLoadedOnce = true;
          console.log('[SMAX] Legacy people cache ready:', peopleCache.size, '/', peopleTotal);
        });
      });
    };

    const ensurePeopleLoaded = ({ force = false } = {}) => {
      if (peopleLoadedOnce && !force) return peopleLoadPromise || Promise.resolve();
      if (peopleLoadPromise) return peopleLoadPromise;
      peopleLoadPromise = fetchPeoplePage(0)
        .then((firstPage) => {
          const total = typeof peopleTotal === 'number'
            ? peopleTotal
            : ((firstPage && firstPage.meta && firstPage.meta.total_count) || peopleCache.size);
          const needed = typeof total === 'number' ? total : 0;
          if (!needed || needed <= peopleCache.size) {
            peopleLoadedOnce = true;
            return;
          }
          const tasks = [];
          for (let skip = basePeopleParams.size; skip < needed; skip += basePeopleParams.size) {
            tasks.push(fetchPeoplePage(skip));
          }
          return Promise.all(tasks).then(() => {
            peopleLoadedOnce = true;
            console.log('[SMAX] People cache ready:', peopleCache.size, '/', needed);
          });
        })
        .catch((err) => {
          console.warn('[SMAX] Failed to load people via API, falling back:', err);
          return legacyFetchPeoplePages();
        })
        .finally(() => {
          peopleLoadPromise = null;
        });
      return peopleLoadPromise;
    };
    const ensureSupportGroups = ({ force = false } = {}) => {
      if (supportGroupsLoadedOnce && !force) return Promise.resolve(getSupportGroupsSnapshot());
      if (supportGroupsLoadPromise) return supportGroupsLoadPromise;
      supportGroupsLoadPromise = fetchSupportGroupPage(0)
        .then((firstPage) => {
          const total = typeof supportGroupTotal === 'number'
            ? supportGroupTotal
            : ((firstPage && firstPage.meta && firstPage.meta.total_count) || supportGroupMap.size);
          if (!total || total <= supportGroupMap.size) {
            supportGroupsLoadedOnce = true;
            return getSupportGroupsSnapshot();
          }
          const tasks = [];
          for (let skip = supportGroupBaseParams.size; skip < total; skip += supportGroupBaseParams.size) {
            tasks.push(fetchSupportGroupPage(skip));
          }
          return Promise.all(tasks).then(() => getSupportGroupsSnapshot());
        })
        .catch((err) => {
          console.warn('[SMAX] Failed to load support groups via API:', err);
          return getSupportGroupsSnapshot();
        })
        .finally(() => {
          supportGroupsLoadPromise = null;
          supportGroupsLoadedOnce = true;
        });
      return supportGroupsLoadPromise;
    };

    const ensureRequestPayload = (id, { force = false, layout = 'FULL_LAYOUT,RELATION_LAYOUT.item' } = {}) => {
      const key = String(id || '').replace(/\D/g, '') || String(id || '');
      if (!key) return Promise.resolve(null);
      const cachedValue = () => triageCache.get(key) || null;
      if (!force && triageCache.has(key)) return Promise.resolve(cachedValue());

      return ApiClient.request(`ems/Request/${encodeURIComponent(key)}`, {
        method: 'GET',
        searchParams: layout ? { layout } : undefined,
        includeTenantParam: true
      })
        .then((payload) => {
          ingestRequestDetailPayload(payload);
          return cachedValue();
        })
        .catch((err) => {
          console.warn('[SMAX] Failed to ensure triage payload:', err);
          return cachedValue();
        });
    };

    const defaultQueueParams = {
      layout: [
        'Id',
        'Description',
        'CreateTime',
        'Priority',
        'Solution',
        'Comments.item',
        'RequestedForPerson.item',
        'RequestedForDisplayLabel',
        'RequestedForName',
        'AssignmentGroupDisplayLabel',
        'AssignmentGroup'
      ].join(','),
      order: 'CreateTime desc',
      size: 50,
      skip: 0
    };

    const refreshQueueFromApi = (params = {}) => {
      const searchParams = toQueryParams(defaultQueueParams, params);
      return ApiClient.request('ems/Request', {
        method: 'GET',
        searchParams,
        includeTenantParam: true
      })
        .then((payload) => {
          ingestRequestListPayload(payload);
          return payload;
        })
        .catch((err) => {
          console.warn('[SMAX] Failed to refresh queue via API:', err);
          throw err;
        });
    };

    const updateCachedSolution = (id, html) => {
      const key = String(id || '');
      if (!key || !triageCache.has(key)) return;
      const current = triageCache.get(key) || {};
      const safeHtml = html != null ? String(html) : '';
      const tmp = document.createElement('div');
      tmp.innerHTML = safeHtml;
      const text = (tmp.textContent || tmp.innerText || '').trim();
      triageCache.set(key, Object.assign({}, current, {
        solutionHtml: safeHtml,
        solutionText: text
      }));
    };

    return {
      triageCache,
      getTriageQueueSnapshot: () => triageIds.slice(),
      peopleCache,
      ingestRequestListPayload,
      ingestPersonListPayload,
      ensurePeopleLoaded,
      ensureSupportGroups,
      ensureRequestPayload,
      refreshQueueFromApi,
      upsertTriageEntryFromProps,
      ingestRequestDetailPayload,
      updateCachedSolution,
      ingestSupportGroupPayload,
      getSupportGroupsSnapshot,
      onQueueUpdate: (fn) => {
        if (typeof fn === 'function') queueListeners.add(fn);
      },
      onPeopleUpdate: (fn) => {
        if (typeof fn !== 'function') return () => { };
        peopleListeners.add(fn);
        return () => peopleListeners.delete(fn);
      },
      onSupportGroupsUpdate: (fn) => {
        if (typeof fn !== 'function') return () => { };
        supportGroupListeners.add(fn);
        return () => supportGroupListeners.delete(fn);
      }
    };
  })();

  /* =========================================================
   * Distribution (digits -> owner)
   * =======================================================*/
  /* =========================================================
   * Refresh overlay helper
   * =======================================================*/

  /* =========================================================
   * Refresh overlay helper
   * =======================================================*/
  const RefreshOverlay = (() => {
    let overlay;
    const ensureOverlay = () => {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.id = 'smax-refresh-overlay';
      overlay.innerHTML = `
        <div id="smax-refresh-overlay-inner">
          <button id="smax-refresh-now" title="Atualizar página">&#x21bb;</button>
        </div>
      `;
      document.body.appendChild(overlay);
      const btn = overlay.querySelector('#smax-refresh-now');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.location.reload();
        });
      }
      return overlay;
    };

    const show = () => {
      ensureOverlay().style.display = 'flex';
    };

    return { show };
  })();

  /* =========================================================
   * Network patch (intercept SMAX payloads)
   * =======================================================*/
  const Network = (() => {
    let patched = false;
    const isRequestDetailUrl = (url = '') => /\/rest\/\d+\/ems\/Request\/\d+/i.test(url);
    const isRequestListUrl = (url = '') => /\/rest\/\d+\/ems\/Request(?:\?|$)/i.test(url) && !isRequestDetailUrl(url);

    const patch = () => {
      if (patched) return;
      patched = true;
      try {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
          try { this.__smaxUrl = url; } catch { }
          return origOpen.call(this, method, url, ...rest);
        };
        XMLHttpRequest.prototype.send = function patchedSend(body) {
          this.addEventListener('load', function onLoad() {
            try {
              const url = this.__smaxUrl || this.responseURL || '';
              if (!/\/rest\/\d+\/ems\/(Request|Person|PersonGroup)/i.test(url)) return;
              if (!this.responseText) return;
              const json = JSON.parse(this.responseText);
              if (isRequestListUrl(url)) {
                DataRepository.ingestRequestListPayload(json);
              } else if (isRequestDetailUrl(url)) {
                DataRepository.ingestRequestDetailPayload(json);
              } else if (/\/rest\/\d+\/ems\/Person/i.test(url)) {
                DataRepository.ingestPersonListPayload(json);
              } else if (/\/rest\/\d+\/ems\/PersonGroup/i.test(url)) {
                DataRepository.ingestSupportGroupPayload(json);
              }
            } catch { }
          });
          return origSend.call(this, body);
        };

        if (window.fetch) {
          const origFetch = window.fetch;
          window.fetch = function patchedFetch(input, init) {
            return origFetch(input, init).then((resp) => {
              try {
                const url = resp.url || (typeof input === 'string' ? input : '');
                if (!/\/rest\/\d+\/ems\/(Request|Person|PersonGroup)/i.test(url)) return resp;
                const clone = resp.clone();
                clone.text().then((txt) => {
                  try {
                    if (!txt) return;
                    const json = JSON.parse(txt);
                    if (isRequestListUrl(url)) {
                      DataRepository.ingestRequestListPayload(json);
                    } else if (isRequestDetailUrl(url)) {
                      DataRepository.ingestRequestDetailPayload(json);
                    } else if (/\/rest\/\d+\/ems\/Person/i.test(url)) {
                      DataRepository.ingestPersonListPayload(json);
                    } else if (/\/rest\/\d+\/ems\/PersonGroup/i.test(url)) {
                      DataRepository.ingestSupportGroupPayload(json);
                    }
                  } catch { }
                });
              } catch { }
              return resp;
            });
          };
        }
      } catch (err) {
        console.warn('[SMAX] Failed to patch network:', err);
      }
    };

    return { patch };
  })();

  Network.patch();

  /* =========================================================
   * API helpers for real updates
   * =======================================================*/
  const Api = (() => {
    const postUpdateRequest = (props) => {
      if (!prefs.enableRealWrites) {
        console.warn('[SMAX] Real writes disabled.');
        return Promise.resolve({ skipped: true, reason: 'real-writes-disabled' });
      }
      if (!props || !props.Id) {
        console.warn('[SMAX] postUpdateRequest missing Id.');
        return Promise.resolve(null);
      }
      const body = {
        entities: [{ entity_type: 'Request', properties: { ...props } }],
        operation: 'UPDATE'
      };
      return ApiClient.ems.bulk(body)
        .catch((err) => {
          console.warn('[SMAX] postUpdateRequest failed:', err);
          return null;
        });
    };

    const postCreateRequestCausesRequest = (globalId, childId) => {
      if (!prefs.enableRealWrites) {
        console.warn('[SMAX] Real writes disabled.');
        return Promise.resolve({ skipped: true, reason: 'real-writes-disabled' });
      }
      const parent = String(globalId || '').trim();
      const child = String(childId || '').trim();
      if (!parent || !child) {
        console.warn('[SMAX] Missing ids for RequestCausesRequest.');
        return Promise.resolve(null);
      }
      const body = {
        relationships: [{
          name: 'RequestCausesRequest',
          firstEndpoint: { Request: parent },
          secondEndpoint: { Request: child }
        }],
        operation: 'CREATE'
      };
      return ApiClient.ems.bulk(body)
        .catch((err) => {
          console.warn('[SMAX] postCreateRequestCausesRequest failed:', err);
          return null;
        });
    };

    const extractBulkErrorMessages = (response) => {
      if (!response) return ['SMAX não retornou resposta.'];
      if (response.skipped) return [];
      const messages = [];
      const pushMessage = (value) => {
        if (value == null) return;
        const text = String(value).trim();
        if (text) messages.push(text);
      };
      const harvest = (source) => {
        if (!source) return;
        if (Array.isArray(source)) {
          source.forEach((entry) => harvest(entry));
          return;
        }
        if (typeof source === 'object') {
          pushMessage(source.message || source.detail || source.description || source.text || source.errorMessage || source.reason);
          return;
        }
        pushMessage(source);
      };
      const meta = response.meta || {};
      harvest(meta.errorDetailsList);
      harvest(meta.errorDetails);
      harvest(meta.errorDetailsMetaList);
      harvest(meta.error_details_list);
      harvest(meta.error_details);
      harvest(response.errorDetailsList);
      harvest(response.errorDetails);
      pushMessage(meta.errorMessage || meta.error_message || meta.error);
      pushMessage(response.message || response.error);
      if (!messages.length && meta.completion_status && meta.completion_status !== 'OK') {
        pushMessage(`Status: ${meta.completion_status}`);
      }
      return messages;
    };

    const summarizeBulkOutcome = (payload, index = 0) => {
      if (payload && payload.skipped) return { ok: true, messages: [] };
      const errors = extractBulkErrorMessages(payload);
      const statusRaw = payload && payload.meta ? (payload.meta.completion_status || payload.meta.completionStatus) : '';
      const normalizedStatus = typeof statusRaw === 'string' ? statusRaw.toUpperCase() : '';
      const ok = normalizedStatus === 'OK' || (!normalizedStatus && !errors.length && !!payload);
      if (ok) return { ok: true, messages: [] };
      if (errors.length) return { ok: false, messages: errors };
      if (!payload) return { ok: false, messages: ['SMAX não retornou resposta.'] };
      return { ok: false, messages: [`Operação ${index + 1} falhou sem detalhes (status: ${normalizedStatus || 'desconhecido'}).`] };
    };

    return { postUpdateRequest, postCreateRequestCausesRequest, extractBulkErrorMessages, summarizeBulkOutcome };
  })();

  /* =========================================================
   * Attachment fetcher + preview
   * =======================================================*/
  const AttachmentService = (() => {
    const cache = new Map();
    const inflight = new Map();

    const normalizeCacheKey = (value) => Utils.normalizeRequestId(value);

    const formatParentReference = (value) => {
      const normalized = normalizeCacheKey(value);
      if (!normalized) return '';
      return /^Request:/i.test(normalized) ? normalized : `Request:${normalized}`;
    };

    const uniqueList = (list) => [...new Set((list || []).filter(Boolean))];

    const isTruthyFlag = (value) => {
      if (typeof value === 'string') return value.toLowerCase() === 'true';
      return Boolean(value);
    };

    const pickAttachmentLabel = (entry) => {
      if (!entry) return '';
      const candidates = [
        entry.file_name,
        entry.FileName,
        entry.DownloadFileName,
        entry.name,
        entry.Name
      ];
      for (const candidate of candidates) {
        if (candidate == null) continue;
        const trimmed = String(candidate).trim();
        if (trimmed) return trimmed;
      }
      return '';
    };

    const shouldSkipAttachmentProps = (props) => {
      if (!props) return true;
      const hiddenFlag = props.IsHidden ?? props.isHidden;
      if (isTruthyFlag(hiddenFlag)) return true;
      const label = pickAttachmentLabel(props);
      if (!label) return true;
      if (/^text-editor-img/i.test(label)) return true;
      return false;
    };

    const buildFrsFileUrl = (attachmentId, { size, draftMode } = {}) => {
      const normalized = Utils.normalizeAttachmentId(attachmentId) || attachmentId;
      if (!normalized) return '';
      const params = new URLSearchParams();
      if (size != null && size !== '') params.set('s', size);
      if (draftMode) params.set('draftMode', 'true');
      const query = params.toString();
      return `/rest/213963628/frs/file-list/${encodeURIComponent(normalized)}${query ? `?${query}` : ''}`;
    };

    const buildDownloadCandidates = (id, fileList = [], context = {}) => {
      const normalizedId = Utils.normalizeAttachmentId(id);
      if (!normalizedId) return [];
      const attachmentVariants = uniqueList([normalizedId, `Attachment:${normalizedId}`]);
      const parentId = normalizeCacheKey(context.parentId);
      const sizeHint = context.sizeHint != null ? context.sizeHint : context.sizeParam;
      const candidates = [];

      if (Array.isArray(fileList) && fileList.length) {
        fileList.forEach((entry) => {
          const direct = entry?.href || entry?.url || entry?.link;
          if (direct) candidates.push(Utils.toAbsoluteUrl(direct));
        });
      }

      const frsDirect = buildFrsFileUrl(normalizedId, { size: sizeHint });
      if (frsDirect) candidates.push(frsDirect);
      const frsDraft = buildFrsFileUrl(normalizedId, { size: sizeHint, draftMode: true });
      if (frsDraft) candidates.push(frsDraft);

      attachmentVariants.forEach((variant) => {
        if (parentId) {
          const params = new URLSearchParams({ attachmentId: variant });
          if (context.fileNameParam) params.append('fileName', context.fileNameParam);
          candidates.push(`/rest/213963628/entity-page/attachment/Request/${encodeURIComponent(parentId)}?${params.toString()}`);
        }
        candidates.push(`/rest/213963628/entity-page/attachment/Attachment/${encodeURIComponent(variant)}`);
        candidates.push(`/rest/213963628/entity-page/attachment/Attachment/${encodeURIComponent(variant)}?attachmentId=${encodeURIComponent(variant)}`);
        candidates.push(`/rest/213963628/ems/file-list/Attachment/${encodeURIComponent(variant)}`);
      });

      return uniqueList(candidates);
    };
    const buildDefaultHeaders = () => {
      const headers = { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' };
      const xsrfMatch = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
      if (xsrfMatch) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrfMatch[1]);
      return headers;
    };

    const toAttachmentRecord = ({ id, name, mime, size, extension, fileList, context = {} }) => {
      const safeId = (id != null ? String(id) : '').trim();
      if (!safeId) return null;
      const label = (name || `Anexo ${safeId}`).toString();
      const lower = label.toLowerCase();
      const ext = (extension || (lower.includes('.') ? lower.split('.').pop() : '') || '').toLowerCase();
      const mimeType = (mime || '').toLowerCase();
      const downloadCandidates = buildDownloadCandidates(
        safeId,
        fileList,
        Object.assign({}, context, {
          fileNameParam: context.fileNameParam || label,
          sizeHint: context.sizeHint != null ? context.sizeHint : size
        })
      );
      if (!downloadCandidates.length) return null;
      const isPdf = mimeType.includes('pdf') || ext === 'pdf';
      const isImage = mimeType.startsWith('image/') || /^(png|jpe?g|gif|bmp|webp|svg)$/i.test(ext);
      return {
        id: safeId,
        name: label,
        mimeType,
        size: Number(size) || 0,
        extension: ext,
        downloadUrl: downloadCandidates[0],
        downloadCandidates,
        parentId: context.parentId ? normalizeCacheKey(context.parentId) : '',
        isPdf,
        isImage
      };
    };

    const parseAttachmentEntities = (payload, { parentId } = {}) => {
      const entities = Array.isArray(payload?.entities) ? payload.entities : [];
      const normalized = [];
      entities.forEach((entity) => {
        const props = entity?.properties || {};
        if (shouldSkipAttachmentProps(props)) return;
        const record = toAttachmentRecord({
          id: props.Id != null ? props.Id : (entity?.entity_id || null),
          name: pickAttachmentLabel(props),
          mime: props.MimeType || props.ContentType,
          size: props.FileSize || props.Size,
          extension: props.FileExtension,
          fileList: props.file_list || props.FileList || entity?.file_list || [],
          context: { parentId }
        });
        if (record) normalized.push(record);
      });
      return normalized;
    };

    const parseRequestAttachmentValue = (value, { requestId } = {}) => {
      if (!value) return [];
      let payload = value;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (err) {
          console.warn('[SMAX] Failed to parse RequestAttachments JSON:', err);
          return [];
        }
      }
      let list = [];
      if (Array.isArray(payload?.complexTypeProperties)) {
        list = payload.complexTypeProperties.map((item) => (item && item.properties) ? item.properties : item);
      } else if (Array.isArray(payload)) {
        list = payload;
      } else if (payload && typeof payload === 'object') {
        list = payload.properties ? [payload.properties] : [];
      }
      const normalized = [];
      list.forEach((entry) => {
        if (!entry) return;
        if (shouldSkipAttachmentProps(entry)) return;
        const record = toAttachmentRecord({
          id: entry.id || entry.Id,
          name: pickAttachmentLabel(entry),
          mime: entry.mime_type || entry.MimeType || entry.content_type,
          size: entry.size || entry.FileSize,
          extension: entry.file_extension || entry.FileExtension,
          fileList: entry.file_list || entry.FileList || [],
          context: { parentId: requestId }
        });
        if (record) normalized.push(record);
      });
      return normalized;
    };

    const fetchViaAttachmentEntity = (requestId) => {
      const parentRef = formatParentReference(requestId);
      const filter = encodeURIComponent(`ParentEntity.Id = "${parentRef}"`);
      const layout = encodeURIComponent('Id,Name,FileName,MimeType,FileSize,file_list');
      const url = `/rest/213963628/ems/Attachment?filter=${filter}&layout=${layout}`;
      return fetch(url, { method: 'GET', credentials: 'include', headers: buildDefaultHeaders() })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then((txt) => {
          if (!txt) return [];
          try {
            return parseAttachmentEntities(JSON.parse(txt), { parentId: requestId });
          } catch (err) {
            console.warn('[SMAX] Failed to parse attachment payload:', err);
            return [];
          }
        })
        .catch((err) => {
          console.warn('[SMAX] Attachment entity lookup failed:', err);
          return [];
        });
    };

    const fetchViaEntityPage = (requestId) => {
      const normalizedId = normalizeCacheKey(requestId);
      if (!normalizedId) return Promise.resolve(null);
      const layoutParam = encodeURIComponent('FORM_LAYOUT.withoutResolution,FORM_LAYOUT.onlyResolution');
      const url = `/rest/213963628/entity-page/initializationDataByLayout/Request/${encodeURIComponent(normalizedId)}?layout=${layoutParam}`;
      return fetch(url, { method: 'GET', credentials: 'include', headers: buildDefaultHeaders() })
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then((txt) => {
          if (!txt) return [];
          try {
            const payload = JSON.parse(txt);
            const attachmentsRaw = payload?.EntityData?.properties?.RequestAttachments;
            return parseRequestAttachmentValue(attachmentsRaw, { requestId: normalizedId });
          } catch (err) {
            console.warn('[SMAX] Failed to parse initializationData attachments:', err);
            return [];
          }
        })
        .catch((err) => {
          console.warn('[SMAX] initializationData attachment lookup failed:', err);
          return null;
        });
    };

    const fetchList = (requestId) => {
      const cacheKey = normalizeCacheKey(requestId);
      if (!cacheKey) return Promise.resolve([]);
      if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey));
      if (inflight.has(cacheKey)) return inflight.get(cacheKey);

      const promise = fetchViaEntityPage(requestId)
        .then((list) => (list !== null ? list : fetchViaAttachmentEntity(requestId)))
        .then((list) => {
          const safeList = Array.isArray(list) ? list : [];
          cache.set(cacheKey, safeList);
          inflight.delete(cacheKey);
          return safeList;
        })
        .catch((err) => {
          inflight.delete(cacheKey);
          console.warn('[SMAX] Failed to load attachments for', requestId, err);
          cache.set(cacheKey, []);
          return [];
        });

      inflight.set(cacheKey, promise);
      return promise;
    };

    const fetchAttachmentMetadata = async (attachmentId) => {
      const normalizedId = Utils.normalizeAttachmentId(attachmentId);
      if (!normalizedId) return null;
      const variants = uniqueList([normalizedId, `Attachment:${normalizedId}`]);
      for (const variant of variants) {
        const url = `/rest/213963628/ems/Attachment/${encodeURIComponent(variant)}?layout=Id,Name,FileName,file_list,FileList`;
        try {
          const resp = await fetch(url, { method: 'GET', credentials: 'include', headers: buildDefaultHeaders() });
          if (!resp.ok) continue;
          const txt = await resp.text();
          if (!txt) continue;
          const parsed = JSON.parse(txt);
          const entity = Array.isArray(parsed?.entities) ? parsed.entities[0] : null;
          if (!entity) continue;
          const props = entity.properties || {};
          const fileList = props.file_list || props.FileList || entity.file_list || entity.FileList;
          if (Array.isArray(fileList) && fileList.length) {
            return { fileList };
          }
        } catch (err) {
          console.warn('[SMAX] Failed to resolve attachment metadata for', variant, err);
        }
      }
      return null;
    };

    const ensureDownloadCandidates = async (attachment) => {
      if (!attachment) return [];
      const existing = Array.isArray(attachment.downloadCandidates) ? attachment.downloadCandidates.filter(Boolean) : [];
      if (existing.length) return existing;
      if (attachment._resolvingCandidates) return attachment._resolvingCandidates;

      attachment._resolvingCandidates = (async () => {
        const metadata = await fetchAttachmentMetadata(attachment.id);
        if (metadata && Array.isArray(metadata.fileList)) {
          const extra = buildDownloadCandidates(attachment.id, metadata.fileList, { parentId: attachment.parentId, fileNameParam: attachment.name });
          if (extra.length) {
            attachment.downloadCandidates = extra;
            attachment.downloadUrl = extra[0];
            return extra;
          }
        }
        return [];
      })()
        .catch((err) => {
          console.warn('[SMAX] Failed to fetch attachment download list:', err);
          return [];
        })
        .finally(() => {
          attachment._resolvingCandidates = null;
        });

      const resolved = await attachment._resolvingCandidates;
      return Array.isArray(resolved) ? resolved : [];
    };

    const AttachmentPreviewer = (() => {
      let modal;
      let img;
      let caption;
      let closeBtn;
      let activeObjectUrl = '';

      const ensureModal = () => {
        if (modal) return;
        modal = document.createElement('div');
        modal.id = 'smax-attachment-modal';
        img = document.createElement('img');
        caption = document.createElement('div');
        caption.className = 'smax-attachment-caption';
        closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✖';
        closeBtn.addEventListener('click', hideModal);
        modal.appendChild(closeBtn);
        modal.appendChild(img);
        modal.appendChild(caption);
        modal.addEventListener('click', (evt) => {
          if (evt.target === modal) hideModal();
        });
        document.body.appendChild(modal);
      };

      const hideModal = () => {
        if (!modal) return;
        modal.dataset.visible = 'false';
        if (activeObjectUrl) {
          URL.revokeObjectURL(activeObjectUrl);
          activeObjectUrl = '';
        }
      };

      const showImage = (objectUrl, title) => {
        ensureModal();
        activeObjectUrl = objectUrl;
        img.src = objectUrl;
        caption.textContent = title || '';
        modal.dataset.visible = 'true';
      };

      const openPdf = async (blobUrl) => {
        const win = window.open(blobUrl, '_blank');
        if (!win) {
          alert('Pop-up bloqueado ao abrir PDF. Permita pop-ups para esta página.');
          URL.revokeObjectURL(blobUrl);
          return;
        }
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      };

      const fetchBlobUrl = async (attachment) => {
        const gatherCandidates = async () => {
          const initial = Array.isArray(attachment?.downloadCandidates) ? attachment.downloadCandidates.filter(Boolean) : [];
          if (initial.length) return initial;
          await ensureDownloadCandidates(attachment);
          return Array.isArray(attachment?.downloadCandidates) ? attachment.downloadCandidates.filter(Boolean) : [];
        };

        const resolved = await gatherCandidates();
        const candidates = resolved.length
          ? resolved
          : (attachment?.downloadUrl ? [attachment.downloadUrl] : []);

        if (!candidates.length) throw new Error('Não consegui localizar o arquivo deste anexo.');
        let lastError;
        for (const url of candidates) {
          try {
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const blob = await resp.blob();
            return { objectUrl: URL.createObjectURL(blob), sourceUrl: url };
          } catch (err) {
            lastError = err;
          }
        }
        throw lastError || new Error('Não consegui baixar este anexo.');
      };

      const open = async (attachment) => {
        if (!attachment || (!attachment.downloadUrl && !attachment.downloadCandidates)) {
          alert('Não consegui localizar o arquivo deste anexo.');
          return;
        }
        try {
          if (attachment.isImage) {
            const { objectUrl } = await fetchBlobUrl(attachment);
            showImage(objectUrl, attachment.name);
            return;
          }
          if (attachment.isPdf) {
            const { objectUrl } = await fetchBlobUrl(attachment);
            await openPdf(objectUrl);
            return;
          }
          const { objectUrl } = await fetchBlobUrl(attachment);
          Utils.triggerFileDownload(objectUrl, attachment.name);
        } catch (err) {
          alert('Erro ao abrir anexo: ' + err.message);
        }
      };

      return { open };
    })();

    const preview = (attachment) => AttachmentPreviewer.open(attachment);

    return { fetchList, preview };
  })();

  /* =========================================================
   * Name badges
   * =======================================================*/
  const NameBadges = (() => {
    const processed = new WeakSet();
    const NAME_MARK_ATTR = 'adMarcado';

    const pickAllLinks = () => {
      const sel = new Set();
      const viewport = Utils.getGridViewport();
      if (!viewport) return [];
      ['a.entity-link-id', '.slick-row a'].forEach((selector) => {
        viewport.querySelectorAll(selector).forEach((anchor) => sel.add(anchor));
      });
      return Array.from(sel);
    };

    const apply = () => {
      if (!prefs.nameBadgesOn) return;

      // Locate columns
      let gseColIndex = -1;
      let descColIndex = -1;
      let subjectColIndex = -1;

      const headers = document.querySelectorAll('.slick-header-column');
      headers.forEach((col, idx) => {
        const title = (col.getAttribute('title') || col.textContent || '').trim().toUpperCase();
        if (title.includes('GRUPO DE ATRIBUI') || title.includes('ASSIGNMENT GROUP') || title.includes('GRUPO')) {
          gseColIndex = idx;
        } else if (title.includes('DESCRI')) {
          descColIndex = idx;
        } else if (title.includes('ASSUNTO') || title.includes('TÍTULO') || title.includes('TITULO') || title.includes('SUBJECT')) {
          subjectColIndex = idx;
        }
      });

      pickAllLinks().forEach((link) => {
        if (!link || processed.has(link)) return;

        const cell = link.closest('.slick-cell');
        if (!cell) return;
        const row = cell.parentElement;
        if (!row) return;

        processed.add(link);

        const label = (link.textContent || '').trim();

        let gseName = '';
        let descriptionText = '';
        let subjectText = '';

        const cells = row.querySelectorAll('.slick-cell');
        if (gseColIndex >= 0 && cells[gseColIndex]) gseName = (cells[gseColIndex].textContent || '').trim();
        if (descColIndex >= 0 && cells[descColIndex]) descriptionText = (cells[descColIndex].textContent || '').trim();
        if (subjectColIndex >= 0 && cells[subjectColIndex]) subjectText = (cells[subjectColIndex].textContent || '').trim();

        // Resolve Team (GSE First)
        const team = TeamsConfig.suggestTeam({
          assignmentGroupName: gseName,
          descriptionText,
          subjectText
        });

        // Resolve Worker
        const worker = TeamsConfig.suggestWorker(team, label);
        const owner = worker ? worker.name : null;

        // Get deterministic color based on owner name (same name = same color everywhere)
        const ownerColor = owner ? ColorRegistry.get(owner) : null;

        if (cell) {
          cell.classList.add('tmx-namecell');
          if (owner && ownerColor) {
            cell.style.background = ownerColor.bg;
            cell.style.color = ownerColor.fg;
            cell.querySelectorAll('a').forEach((a) => { a.style.color = 'inherit'; });
          } else {
            cell.style.background = '#d32f2f';
            cell.style.color = '#fff';
            cell.querySelectorAll('a').forEach((a) => { a.style.color = 'inherit'; });
          }
        }

        if (!link.dataset[NAME_MARK_ATTR]) {
          const tag = document.createElement('span');
          tag.style.marginLeft = '6px';
          tag.style.fontWeight = '600';
          tag.style.padding = '0 4px';
          tag.style.borderRadius = '4px';
          if (owner && ownerColor) {
            tag.textContent = ` ${owner}`;
            tag.style.background = ownerColor.bg;
            tag.style.color = ownerColor.fg;
          } else {
            tag.textContent = ' SEM DONO';
            tag.style.background = '#fff';
            tag.style.color = '#d32f2f';
            tag.style.border = '2px solid #d32f2f';
          }
          link.insertAdjacentElement('afterend', tag);
          link.dataset[NAME_MARK_ATTR] = '1';
        }
      });
    };

    return { apply };
  })();

  /* =========================================================
   * Settings panel
   * =======================================================*/
  const SettingsPanel = (() => {
    let container;
    let toggleBtn;
    let detachPeopleWatcher;
    let currentTeams = []; // Local state for editing
    let editingTeamId = null; // ID of team currently being edited ('__NEW__' for new team)

    // Load fresh config from prefs
    const reloadConfig = () => {
      currentTeams = TeamsConfig.getTeams().map(t => JSON.parse(JSON.stringify(t)));
    };

    const saveConfig = () => {
      prefs.teamsConfigRaw = JSON.stringify(currentTeams, null, 2);
      savePrefs();
      TeamsConfig.reload();
      RefreshOverlay.show();
    };

    const renderHeader = () => `
      <div style="display:flex;justify-content:space-between;align-items:center;min-height:52px;padding:10px 20px;background:linear-gradient(90deg,#0ea5e9 0%,#3b82f6 50%,#8b5cf6 100%);border-radius:12px;margin:-16px -16px 16px -16px;">
        <div style="font-weight:600;font-size:17px;letter-spacing:.03em;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.3);">
          ⚙️ Configurações do Assistente
        </div>
      </div>`;



    // --- Team Editor Methods ---

    const renderTeamsList = () => {
      if (editingTeamId) return renderTeamEditor(editingTeamId);

      const listHtml = currentTeams.map(t => {
        const isDefault = !!t.isDefault;
        return `
          <div class="smax-team-item" style="border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:linear-gradient(135deg,rgba(15,23,42,0.8) 0%,rgba(30,41,59,0.4) 100%);transition:border-color .15s ease,box-shadow .15s ease;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong style="font-size:13px;color:#f8fafc;">${Utils.escapeHtml(t.name || t.id || 'Sem nome')}</strong>
                ${isDefault ? '<span style="font-size:10px;background:rgba(56,189,248,0.2);color:#38bdf8;padding:2px 6px;border-radius:999px;margin-left:6px;border:1px solid rgba(56,189,248,0.3);">Padrão</span>' : ''}
                <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Prioridade: ${t.priority || 0} • Membros: ${t.workers ? t.workers.length : 0}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="smax-team-edit-btn" data-id="${t.id}" style="font-size:11px;padding:6px 12px;cursor:pointer;background:rgba(255,255,255,.05);color:#e5e7eb;border:1px solid rgba(255,255,255,.15);border-radius:6px;transition:all .15s ease;">Editar</button>
                ${!isDefault ? `<button class="smax-team-del-btn" data-id="${t.id}" style="font-size:11px;padding:6px 12px;cursor:pointer;color:#fca5a5;background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.3);border-radius:6px;transition:all .15s ease;">Remover</button>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div style="margin-top:16px;border-top:1px solid rgba(255,255,255,.1);padding-top:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-weight:600;color:#e5e7eb;font-size:14px;">Equipes e Regras</span>
            <button id="smax-add-team-btn" style="font-size:12px;padding:6px 14px;cursor:pointer;background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);color:#fff;border:none;border-radius:8px;transition:transform .15s ease,box-shadow .15s ease;box-shadow:0 4px 12px rgba(59,130,246,.35);">+ Nova Equipe</button>
          </div>
          <div id="smax-teams-list-container">${listHtml}</div>
        </div>
      `;
    };

    const renderTeamEditor = (teamId) => {
      const isNew = teamId === '__NEW__';
      const team = isNew ? { id: '', priority: 0, gseRules: [], workers: [] } : currentTeams.find(t => t.id === teamId);
      if (!team) return '<div>Equipe não encontrada. <button class="smax-cancel-edit">Voltar</button></div>';

      const isGeneralTeam = team.id === 'geral';
      const gseHtml = (team.gseRules || []).map((r, idx) => `
        <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
          <input type="hidden" class="smax-gse-id" value="${Utils.escapeHtml(r.id)}">
          <input type="text" class="smax-gse-name" value="${Utils.escapeHtml(r.name || r.id)}" disabled style="flex:1;font-size:11px;padding:6px;border:1px solid #475569;border-radius:6px;background:rgba(15,23,42,0.6);color:#94a3b8;">
          <button class="smax-gse-del-btn" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;transition:all .15s ease;">✕</button>
        </div>
      `).join('');

      const matchersHtml = (team.matchers || []).filter(m => m.type === 'regex').map((m, idx) => {
        const displayText = m._displayText || m.pattern || '';
        return `
          <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(15,23,42,0.6);border:1px solid #475569;padding:6px 8px;border-radius:8px;">
            <input type="hidden" class="smax-matcher-pattern" value="${Utils.escapeHtml(m.pattern || '')}">
            <span style="flex:1;font-size:11px;color:#94a3b8;">contém: <strong style="color:#e5e7eb;">${Utils.escapeHtml(displayText)}</strong></span>
            <button class="smax-matcher-del-btn" data-idx="${idx}" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;transition:all .15s ease;">✕</button>
          </div>
        `;
      }).join('');

      const workersHtml = (team.workers || []).map((w, idx) => `
        <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(15,23,42,0.6);border:1px solid #475569;padding:8px;border-radius:8px;">
          <input type="text" class="smax-worker-name" data-idx="${idx}" value="${Utils.escapeHtml(w.name || '')}" style="flex:1;font-size:11px;padding:6px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#f8fafc;" placeholder="Nome do Responsável">
          <input type="text" class="smax-worker-digits" data-idx="${idx}" value="${Utils.escapeHtml(w.digits || '')}" style="width:80px;font-size:11px;padding:6px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#f8fafc;" placeholder="Digitos (ex: 0-9)">
          
          <div class="smax-worker-absent-wrapper" style="display:flex;align-items:center;cursor:pointer;user-select:none;">
             <input type="checkbox" class="smax-worker-absent" data-idx="${idx}" ${w.isAbsent ? 'checked' : ''} style="display:none;">
             <div class="smax-absent-fake" style="width:14px;height:14px;border:1px solid ${w.isAbsent ? '#d32f2f' : '#64748b'};margin-right:4px;background:${w.isAbsent ? '#d32f2f' : 'transparent'};border-radius:2px;display:flex;align-items:center;justify-content:center;"></div>
             <span style="font-size:10px;color:#fca5a5;">Ausente</span>
          </div>

          <button class="smax-worker-del-btn" data-idx="${idx}" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;transition:all .15s ease;">✕</button>
        </div>
      `).join('');

      return `
        <div style="margin-top:16px;border:1px solid rgba(56,189,248,.3);padding:14px;border-radius:12px;background:rgba(2,6,23,0.85);backdrop-filter:blur(12px);box-shadow:0 4px 16px rgba(0,0,0,.3);">
          <div style="font-weight:600;margin-bottom:12px;color:#38bdf8;font-size:15px;">${isNew ? '✨ Criar Nova Equipe' : '✏️ Editar Equipe ' + team.id}</div>
          
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:4px;">Qual o nome da equipe?</label>
              <input type="text" id="smax-edit-id" value="${Utils.escapeHtml(team.name || team.id || '')}" ${isGeneralTeam ? 'disabled' : ''} placeholder="Ex: JEC, Cível, Criminal..." style="width:100%;padding:8px 12px;border:1px solid #475569;border-radius:8px;background:${isGeneralTeam ? 'rgba(15,23,42,0.6)' : '#1e293b'};color:${isGeneralTeam ? '#94a3b8' : '#f8fafc'};font-size:13px;transition:border-color .15s ease,box-shadow .15s ease;box-sizing:border-box;${isGeneralTeam ? 'cursor:not-allowed;' : ''}">
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:4px;">Prioridade</label>
              <input type="number" id="smax-edit-prio" value="${team.priority || 0}" style="width:100%;padding:8px 12px;border:1px solid #475569;border-radius:8px;background:#1e293b;color:#f8fafc;font-size:13px;transition:border-color .15s ease,box-shadow .15s ease;box-sizing:border-box;">
            </div>
          </div>


          <div style="margin-bottom:12px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#e5e7eb;">Quais GSE a equipe atende?</div>
            ${isGeneralTeam ? '<div style="font-size:11px;color:#94a3b8;margin-bottom:8px;">⚠️ A equipe GERAL não permite edição de GSEs (aceita todos os grupos).</div>' : `
             <!-- GSE Search -->
            <div style="margin-bottom:8px;border:1px solid #475569;background:#1e293b;border-radius:8px;padding:8px;">
              <input type="text" id="smax-team-gse-search" placeholder="🔍 Buscar GSE para adicionar..." 
                     style="width:100%;padding:6px 10px;border:1px solid #475569;border-radius:6px;font-size:12px;margin-bottom:4px;background:#0f172a;color:#e5e7eb;box-sizing:border-box;">
              <div id="smax-team-gse-results" style="max-height:100px;overflow-y:auto;border-top:1px solid #475569;display:none;background:#0f172a;"></div>
            </div>

            <div id="smax-gse-list">${gseHtml}</div>`}
          </div>

          <div style="margin-bottom:12px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#e5e7eb;">Palavras-chave no campo "Local de Divulgação"</div>
            ${isGeneralTeam ? '<div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">⚠️ A equipe GERAL não permite edição de locais (aceita todos os locais).</div>' : `
            <div style="margin-bottom:6px;font-size:11px;color:#94a3b8;">Equipe será sugerida quando o local do chamado contiver o texto especificado (insensível a maiúsculas/minúsculas)</div>
            
            <!-- Location Matcher Input -->
            <div style="margin-bottom:8px;border:1px solid #475569;background:#1e293b;border-radius:8px;padding:8px;display:flex;gap:6px;align-items:center;">
              <input type="text" id="smax-team-location-input" placeholder="Ex: JUIZADO ESPECIAL CÍVEL" 
                     style="flex:1;padding:6px 10px;border:1px solid #475569;border-radius:6px;font-size:12px;background:#0f172a;color:#e5e7eb;box-sizing:border-box;">
              <button id="smax-add-location-matcher-btn" style="padding:6px 12px;background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3);border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;transition:all .15s ease;">+ Adicionar</button>
            </div>

            <div id="smax-matchers-list">${matchersHtml}</div>`}
          </div>

          <div style="margin-bottom:12px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#e5e7eb;">Membros e Distribuição</div>
            
            <!-- Person Search for Adding Workers -->
            <div style="margin-bottom:8px;border:1px solid #475569;background:#1e293b;border-radius:8px;padding:8px;">
              <input type="text" id="smax-team-person-search" placeholder="🔍 Buscar pessoa para adicionar..." 
                     style="width:100%;padding:6px 10px;border:1px solid #475569;border-radius:6px;font-size:12px;margin-bottom:4px;background:#0f172a;color:#e5e7eb;box-sizing:border-box;">
              <div id="smax-team-person-results" style="max-height:100px;overflow-y:auto;border-top:1px solid #475569;display:none;background:#0f172a;"></div>
            </div>

            <div id="smax-workers-list">${workersHtml}</div>
          </div>

          <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap;">
            <button class="smax-cancel-edit" style="padding:8px 14px;cursor:pointer;background:rgba(255,255,255,.05);color:#e5e7eb;border:1px solid rgba(255,255,255,.15);border-radius:8px;font-size:12px;transition:all .15s ease;">Cancelar</button>
            <button id="smax-save-team-btn" style="padding:8px 16px;cursor:pointer;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;box-shadow:0 4px 16px rgba(34,197,94,.35);transition:transform .15s ease,box-shadow .15s ease;">Salvar Equipe</button>
          </div>
        </div>
      `;
    };

    const wireTeamEvents = () => {
      // List View Events
      const addBtn = container.querySelector('#smax-add-team-btn');
      if (addBtn) addBtn.addEventListener('click', () => { editingTeamId = '__NEW__'; renderPanel(); });

      container.querySelectorAll('.smax-team-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => { editingTeamId = btn.dataset.id; renderPanel(); });
      });

      container.querySelectorAll('.smax-team-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          if (confirm(`Tem certeza que deseja remover a equipe "${id}"?`)) {
            currentTeams = currentTeams.filter(t => t.id !== id);
            saveConfig();
            renderPanel();
          }
        });
      });

      // Edit View Events
      if (editingTeamId) {
        // Toggle Logic for existing rows
        container.querySelectorAll('.smax-worker-absent-wrapper').forEach(wrapper => {
          const chk = wrapper.querySelector('.smax-worker-absent');
          const fake = wrapper.querySelector('.smax-absent-fake');
          wrapper.addEventListener('click', () => {
            chk.checked = !chk.checked;
            fake.style.background = chk.checked ? '#d32f2f' : '#fff';
            fake.style.borderColor = chk.checked ? '#d32f2f' : '#999';
          });
        });

        const cancelBtn = container.querySelector('.smax-cancel-edit');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { editingTeamId = null; renderPanel(); });

        const saveBtn = container.querySelector('#smax-save-team-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => {
          const idInput = container.querySelector('#smax-edit-id');
          const prioInput = container.querySelector('#smax-edit-prio');
          const newId = idInput.value.trim();
          const newPrio = parseInt(prioInput.value, 10) || 0;

          if (!newId) return alert('O ID da equipe é obrigatório.');
          if (editingTeamId === '__NEW__' && currentTeams.some(t => t.id === newId)) return alert('Já existe uma equipe com este ID.');

          // Collect GSEs
          const newGseRules = [];
          container.querySelectorAll('#smax-gse-list > div').forEach(div => {
            const idInput = div.querySelector('.smax-gse-id');
            const nameInput = div.querySelector('.smax-gse-name');
            if (idInput && nameInput) {
              newGseRules.push({ id: idInput.value, name: nameInput.value });
            }
          });

          // Collect workers
          const newWorkers = [];
          container.querySelectorAll('#smax-workers-list > div').forEach(div => {
            const nameInput = div.querySelector('.smax-worker-name');
            const digitsInput = div.querySelector('.smax-worker-digits');
            const absentInput = div.querySelector('.smax-worker-absent');
            if (nameInput && digitsInput) {
              const name = nameInput.value.trim();
              const digits = digitsInput.value.trim();
              const isAbsent = absentInput ? !!absentInput.checked : false;
              if (name) newWorkers.push({ name, digits, isAbsent });
            }
          });
          // Sort workers alphabetically by name for better UX
          newWorkers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }));

          // Collect location matchers
          const newMatchers = [];
          container.querySelectorAll('#smax-matchers-list > div').forEach(div => {
            const patternInput = div.querySelector('.smax-matcher-pattern');
            if (patternInput) {
              const pattern = patternInput.value.trim();
              if (pattern) {
                // Store both pattern and original text for display
                newMatchers.push({
                  type: 'regex',
                  pattern: pattern,
                  _displayText: pattern.replace(/\\/g, '') // Store unescaped for display
                });
              }
            }
          });

          // Update state
          if (editingTeamId === '__NEW__') {
            const newTeam = { id: newId, name: newId, priority: newPrio, gseRules: newGseRules, workers: newWorkers, matchers: newMatchers };
            currentTeams.push(newTeam);
          } else {
            const idx = currentTeams.findIndex(t => t.id === editingTeamId);
            if (idx !== -1) {
              const existingTeam = currentTeams[idx];
              const isDefault = !!existingTeam.isDefault;
              const updatedName = isDefault ? existingTeam.name : newId;
              const updatedId = isDefault ? existingTeam.id : newId;
              currentTeams[idx] = { ...existingTeam, id: updatedId, name: updatedName, priority: newPrio, gseRules: newGseRules, workers: newWorkers, matchers: newMatchers };
            }
          }

          editingTeamId = null;
          saveConfig();
          renderPanel();
        });

        // --- GSE Search Logic ---
        const gseSearchInput = container.querySelector('#smax-team-gse-search');
        const gseResultsEl = container.querySelector('#smax-team-gse-results');

        const addGseResult = (id, name) => {
          const list = container.querySelector('#smax-gse-list');
          const tempDiv = document.createElement('div');
          tempDiv.style.display = 'flex';
          tempDiv.style.gap = '6px';
          tempDiv.style.marginBottom = '6px';
          tempDiv.style.alignItems = 'center';
          tempDiv.innerHTML = `
            <input type="hidden" class="smax-gse-id" value="${Utils.escapeHtml(id)}">
            <input type="text" class="smax-gse-name" value="${Utils.escapeHtml(name)}" disabled style="flex:1;font-size:11px;padding:6px;border:1px solid #475569;border-radius:6px;background:rgba(15,23,42,0.6);color:#94a3b8;">
            <button class="smax-gse-del-btn" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;transition:all .15s ease;">✕</button>
          `;
          tempDiv.querySelector('.smax-gse-del-btn').addEventListener('click', (e) => e.target.closest('div').remove());
          if (list) list.appendChild(tempDiv);
          gseSearchInput.value = '';
          gseResultsEl.style.display = 'none';
        };

        if (gseSearchInput && gseResultsEl) {
          gseSearchInput.addEventListener('input', () => {
            const q = gseSearchInput.value.toUpperCase();
            gseResultsEl.style.display = q ? 'block' : 'none';
            if (!q) return;

            // Search supportGroupMap from DataRepository
            // Note: supportGroupMap keys are IDs. Values are objects? 
            // We need to access the map. DataRepository doesn't expose it directly but has 'getSupportGroupsSnapshot'
            // Actually currently 'DataRepository.getSupportGroupsSnapshot' returns array.
            // Let's check getSupportGroupsSnapshot signature.
            // It returns Array.from(supportGroupMap.values())

            const groups = DataRepository.getSupportGroupsSnapshot();
            if (!groups.length) {
              gseResultsEl.innerHTML = '<div style="padding:4px;color:#999;font-size:10px;">Carregando GSEs... (clique no HUD para forçar)</div>';
              DataRepository.ensureSupportGroups(); // Trigger load if needed
              return;
            }

            const matches = groups.filter(g => (g.name || '').toUpperCase().includes(q) || (g.id || '').includes(q)).slice(0, 15);

            if (!matches.length) {
              gseResultsEl.innerHTML = '<div style="padding:4px;color:#999;font-size:10px;">Nenhum resultado.</div>';
            } else {
              gseResultsEl.innerHTML = matches.map(g => `
                  <div class="smax-gse-pick" data-id="${g.id}" data-name="${Utils.escapeHtml(g.name)}" style="padding:3px 6px;cursor:pointer;font-size:10px;border-bottom:1px solid #f5f5f5;">
                    <div><strong>${Utils.escapeHtml(g.name)}</strong></div>
                    <div style="color:#666;font-size:9px;">ID: ${g.id}</div>
                  </div>
               `).join('');

              gseResultsEl.querySelectorAll('.smax-gse-pick').forEach(el => {
                el.addEventListener('click', () => {
                  addGseResult(el.dataset.id, el.dataset.name);
                });
              });
            }
          });
          gseSearchInput.addEventListener('blur', () => setTimeout(() => { gseResultsEl.style.display = 'none'; }, 200));
          gseSearchInput.addEventListener('focus', () => DataRepository.ensureSupportGroups());
        }

        // Existing deletes for initial render
        container.querySelectorAll('.smax-gse-del-btn').forEach(b => b.addEventListener('click', e => e.target.closest('div').remove()));

        // --- Location Matcher Logic ---
        const locationInput = container.querySelector('#smax-team-location-input');
        const addLocationBtn = container.querySelector('#smax-add-location-matcher-btn');

        if (addLocationBtn && locationInput) {
          addLocationBtn.addEventListener('click', () => {
            const text = locationInput.value.trim();
            if (!text) return;

            // Escape regex special characters except accents
            // PT-BR: preserve á é í ó ú ã õ ç etc.
            const escapedPattern = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const list = container.querySelector('#smax-matchers-list');
            const tempDiv = document.createElement('div');
            tempDiv.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(15,23,42,0.6);border:1px solid #475569;padding:6px 8px;border-radius:8px;';
            tempDiv.innerHTML = `
              <input type="hidden" class="smax-matcher-pattern" value="${Utils.escapeHtml(escapedPattern)}">
              <span style="flex:1;font-size:11px;color:#94a3b8;">contém: <strong style="color:#e5e7eb;">${Utils.escapeHtml(text)}</strong></span>
              <button class="smax-matcher-del-btn" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;transition:all .15s ease;">✕</button>
            `;
            tempDiv.querySelector('.smax-matcher-del-btn').addEventListener('click', () => tempDiv.remove());
            if (list) list.appendChild(tempDiv);
            locationInput.value = '';
          });

          // Allow Enter key to add matcher
          locationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addLocationBtn.click();
            }
          });
        }

        // Existing matcher deletes for initial render
        container.querySelectorAll('.smax-matcher-del-btn').forEach(b => b.addEventListener('click', () => b.closest('div').remove()));

        // --- Person Search Logic (Existing) ---
        const searchInput = container.querySelector('#smax-team-person-search');
        const resultsEl = container.querySelector('#smax-team-person-results');

        const addWorkerResult = (name) => {
          const list = container.querySelector('#smax-workers-list');
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = `
            <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(15,23,42,0.6);border:1px solid #475569;padding:8px;border-radius:8px;">
              <input type="text" class="smax-worker-name" value="${Utils.escapeHtml(name)}" style="flex:1;font-size:11px;padding:6px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#f8fafc;" placeholder="Nome do Responsável">
              <input type="text" class="smax-worker-digits" value="" style="width:80px;font-size:11px;padding:6px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#f8fafc;" placeholder="Digitos (ex: 0-9)">
              <div class="smax-worker-absent-wrapper" style="display:flex;align-items:center;cursor:pointer;user-select:none;">
                <input type="checkbox" class="smax-worker-absent" style="display:none;">
                <div class="smax-absent-fake" style="width:14px;height:14px;border:1px solid #64748b;margin-right:4px;background:transparent;border-radius:2px;display:flex;align-items:center;justify-content:center;"></div>
                <span style="font-size:10px;color:#fca5a5;">Ausente</span>
              </div>
              <button class="smax-remove-temp-row" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;transition:all .15s ease;">✕</button>
            </div>`;
          const row = tempDiv.firstElementChild;
          row.querySelector('.smax-remove-temp-row').addEventListener('click', () => row.remove());

          // Custom toggle logic
          const wrapper = row.querySelector('.smax-worker-absent-wrapper');
          const chk = row.querySelector('.smax-worker-absent');
          const fake = row.querySelector('.smax-absent-fake');

          wrapper.addEventListener('click', () => {
            chk.checked = !chk.checked;
            fake.style.background = chk.checked ? '#d32f2f' : 'transparent';
            fake.style.borderColor = chk.checked ? '#d32f2f' : '#64748b';
          });
          if (list) list.appendChild(tempDiv.firstElementChild);
          // Clear search
          searchInput.value = '';
          resultsEl.style.display = 'none';
        };

        if (searchInput && resultsEl) {
          const attachPickHandlers = () => {
            resultsEl.querySelectorAll('.smax-person-pick').forEach(el => {
              el.addEventListener('click', () => {
                const name = el.getAttribute('data-name');
                if (name) addWorkerResult(name);
              });
            });
          };

          const renderSearchResults = (term) => {
            const q = (term || '').trim().toUpperCase();
            resultsEl.style.display = q ? 'block' : 'none';
            if (!q) return;

            if (!DataRepository.peopleCache.size) {
              resultsEl.innerHTML = '<div style="padding:4px;color:#999;font-size:10px;">Carregando...</div>';
              return;
            }

            const matches = [];
            for (const p of DataRepository.peopleCache.values()) {
              const name = (p.name || '').toUpperCase();
              const upn = (p.upn || '').toUpperCase();
              if (name.includes(q) || upn.includes(q)) {
                matches.push(p);
                if (matches.length >= 20) break;
              }
            }

            if (!matches.length) {
              resultsEl.innerHTML = '<div style="padding:4px;color:#999;font-size:10px;">Nenhum resultado.</div>';
            } else {
              resultsEl.innerHTML = matches.map(p => `
                   <div class="smax-person-pick" data-name="${Utils.escapeHtml(p.name)}" style="padding:3px 6px;cursor:pointer;font-size:10px;border-bottom:1px solid #f5f5f5;">
                     <strong>${p.name}</strong> ${p.upn ? `<span>(${p.upn})</span>` : ''}
                   </div>
                 `).join('');
              attachPickHandlers();
            }
          };

          searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
          searchInput.addEventListener('focus', () => renderSearchResults(searchInput.value));
          // Hide on blur delayed to allow click
          searchInput.addEventListener('blur', () => setTimeout(() => { resultsEl.style.display = 'none'; }, 200));
        }

        const addWorkerBtn = container.querySelector('#smax-add-worker-btn');
        if (addWorkerBtn) addWorkerBtn.addEventListener('click', () => addWorkerResult('')); // Add empty if manual

        // Existing deletes
        container.querySelectorAll('.smax-worker-del-btn').forEach(b => b.addEventListener('click', e => e.target.closest('div').remove()));
      }
    };

    const renderPanel = () => {
      if (!container) return;

      // Triador selection UI - friendly and simple
      const triadorName = prefs.myPersonName || '';
      const triadorSection = `
        <div style="margin-top:16px;padding:14px;border-radius:12px;background:rgba(2,6,23,0.85);backdrop-filter:blur(12px);border:1px solid rgba(56,189,248,.2);box-shadow:0 4px 16px rgba(0,0,0,.3);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <span style="font-size:20px;">👤</span>
            <div>
              <div style="font-weight:600;color:#38bdf8;font-size:15px;">Quem é você?</div>
              <div style="font-size:11px;color:#94a3b8;">Seu nome será vinculado aos chamados globais</div>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:stretch;flex-wrap:wrap;">
            <div style="flex:1;position:relative;min-width:200px;">
              <input type="text" id="smax-triador-search" placeholder="Digite seu nome para buscar..." 
                style="width:100%;padding:10px 12px;border:1px solid #475569;border-radius:8px;font-size:13px;background:#1e293b;color:#f8fafc;transition:border-color .15s ease,box-shadow .15s ease;box-sizing:border-box;">
              <div id="smax-triador-results" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:250px;overflow-y:auto;background:#020617;border:1px solid #475569;border-top:none;border-radius:0 0 8px 8px;z-index:100;box-shadow:0 12px 24px rgba(0,0,0,.5);"></div>
            </div>
            ${triadorName ? `
              <div id="smax-triador-current" style="display:flex;align-items:center;padding:8px 14px;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);border-radius:8px;font-size:12px;color:#fff;font-weight:500;white-space:nowrap;box-shadow:0 4px 12px rgba(34,197,94,.35);flex-shrink:0;">
                ✓ ${Utils.escapeHtml(triadorName)}
              </div>
            ` : `
              <div id="smax-triador-current" style="display:flex;align-items:center;padding:8px 14px;background:rgba(220,38,38,.15);border:1px solid rgba(220,38,38,.4);border-radius:8px;font-size:12px;color:#fca5a5;white-space:nowrap;flex-shrink:0;">
                ⚠️ Não configurado
              </div>
            `}
          </div>
        </div>
      `;

      container.innerHTML = `
        ${renderHeader()}
        ${renderTeamsList()}
        ${triadorSection}
        
        <div style="margin-top:16px;display:flex;flex-wrap:wrap;gap:8px;">
          <button type="button" id="smax-log-export-all" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(56,189,248,.2);background:rgba(2,6,23,0.85);backdrop-filter:blur(12px);color:#e5e7eb;font-size:12px;cursor:pointer;transition:all .15s ease;box-shadow:0 4px 16px rgba(0,0,0,.3);display:flex;align-items:center;gap:6px;">
            <span style="font-size:14px;">📊</span> Exportar logs <span style="color:#38bdf8;font-weight:600;">(${ActivityLog.getCount()})</span>
          </button>
          <button type="button" id="smax-config-toggle-btn" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(56,189,248,.2);background:rgba(2,6,23,0.85);backdrop-filter:blur(12px);color:#e5e7eb;font-size:12px;cursor:pointer;transition:all .15s ease;box-shadow:0 4px 16px rgba(0,0,0,.3);display:flex;align-items:center;gap:6px;">
            <span style="font-size:14px;">🔧</span> Configuração manual
          </button>
          <button type="button" id="smax-guide-toggle-btn" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(56,189,248,.2);background:rgba(2,6,23,0.85);backdrop-filter:blur(12px);color:#e5e7eb;font-size:12px;cursor:pointer;transition:all .15s ease;box-shadow:0 4px 16px rgba(0,0,0,.3);display:flex;align-items:center;gap:6px;">
            <span style="font-size:14px;">📖</span> Guia Rápido
          </button>
        </div>

        <div id="smax-config-editor-panel" style="display:none;margin-top:12px;padding:14px;border-radius:12px;background:rgba(2,6,23,0.85);backdrop-filter:blur(12px);border:1px solid rgba(56,189,248,.2);box-shadow:0 4px 16px rgba(0,0,0,.3);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:11px;color:#94a3b8;">Edite o JSON abaixo e clique em Salvar. Copie para enviar a colegas.</div>
            <button type="button" id="smax-config-close-btn" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;padding:2px 6px;line-height:1;" title="Fechar">✕</button>
          </div>
          <textarea id="smax-config-io-textarea" spellcheck="false"
            style="width:100%;min-height:160px;max-height:400px;resize:vertical;padding:10px 12px;border:1px solid #475569;border-radius:8px;font-size:11px;font-family:'Cascadia Code','Fira Code','Consolas',monospace;background:#1e293b;color:#e2e8f0;line-height:1.5;box-sizing:border-box;transition:border-color .15s ease;"></textarea>
          <div id="smax-config-io-status" style="font-size:11px;color:#94a3b8;min-height:16px;margin:8px 0;"></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button type="button" id="smax-config-copy-btn" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:#e5e7eb;font-size:12px;cursor:pointer;transition:all .15s ease;">📋 Copiar</button>
            <button type="button" id="smax-config-save-btn" style="padding:8px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:#fff;font-size:12px;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease;box-shadow:0 4px 12px rgba(34,197,94,.35);font-weight:500;">💾 Salvar</button>
          </div>
        </div>

        <div id="smax-guide-panel" style="display:none;margin-top:12px;padding:14px;border-radius:12px;background:rgba(2,6,23,0.85);backdrop-filter:blur(12px);border:1px solid rgba(56,189,248,.2);box-shadow:0 4px 16px rgba(0,0,0,.3);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:13px;font-weight:600;color:#38bdf8;">📖 Guia Rápido</div>
            <button type="button" id="smax-guide-close-btn" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;padding:2px 6px;line-height:1;" title="Fechar">✕</button>
          </div>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#e2e8f0;line-height:1.6;">
            <li>Use os botões de urgência para definir impacto antes de atribuir.</li>
            <li>"Meus finais" limita a fila de triagem aos IDs desejados.</li>
            <li>Editar a resposta rápida já a deixa pronta; "ENVIAR" grava tudo no SMAX.</li>
            <li>Filtre os chamados através do SMAX corretamente antes de começar a Triagem.</li>
            <li>Configure corretamente os finais e colegas ausentes através do ícone de configuração.</li>
            <li>No mesmo painel, escolha quem assume automaticamente globais vinculados.</li>
            <li>O filtro (não a coluna) "Hora de Criação" do SMAX permite escolher um intervalo de datas.</li>
            <li>Os chamados são ordenados sempre por VIP, e mais antigos primeiro.</li>
            <li style="color:#fca5a5;font-weight:600;">CUIDADO DOBRADO: Vincular Global NÃO VERIFICA se o número é válido.</li>
          </ul>
        </div>
      `;
      wirePanelEvents();
      wireTeamEvents();
      wireBottomPanelEvents();
    };

    // Shareable config keys (no personal identity — meant for team distribution)
    const CONFIG_KEYS = [
      'nameBadgesOn', 'collapseOn', 'enlargeCommentsOn', 'flagSkullOn',
      'nameGroups', 'ausentes', 'nameColors', 'enableRealWrites',
      'defaultGlobalChangeId', 'personalFinalsRaw', 'teamsConfigRaw'
    ];

    const buildConfigJSON = () => {
      const obj = {};
      CONFIG_KEYS.forEach(key => {
        if (prefs[key] === undefined) return;
        if (key === 'teamsConfigRaw') {
          try { obj.teams = JSON.parse(prefs[key]); } catch { obj.teams = prefs[key]; }
        } else {
          obj[key] = prefs[key];
        }
      });
      obj._version = '1.0';
      return JSON.stringify(obj, null, 2);
    };

    const applyConfigJSON = (raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return { ok: false, msg: `JSON inválido: ${err.message}` };
      }
      if (typeof parsed !== 'object' || parsed === null) {
        return { ok: false, msg: 'O JSON deve ser um objeto { ... }.' };
      }
      let count = 0;
      CONFIG_KEYS.forEach(key => {
        if (key === 'teamsConfigRaw' && parsed.teams !== undefined) {
          prefs.teamsConfigRaw = typeof parsed.teams === 'string'
            ? parsed.teams
            : JSON.stringify(parsed.teams);
          count++;
        } else if (parsed[key] !== undefined) {
          prefs[key] = parsed[key];
          count++;
        }
      });
      if (!count) return { ok: false, msg: 'Nenhuma chave de configuração reconhecida.' };
      savePrefs();
      TeamsConfig.reload();
      reloadConfig();
      return { ok: true, msg: `${count} configurações aplicadas. ✓` };
    };

    const wireBottomPanelEvents = () => {
      if (!container) return;

      // --- Log export button ---
      const logBtn = container.querySelector('#smax-log-export-all');
      if (logBtn) logBtn.addEventListener('click', () => ActivityLog.exportCsv());

      // --- Config editor toggle ---
      const toggleBtn = container.querySelector('#smax-config-toggle-btn');
      const editorPanel = container.querySelector('#smax-config-editor-panel');
      const closeBtn = container.querySelector('#smax-config-close-btn');
      const textarea = container.querySelector('#smax-config-io-textarea');
      const statusEl = container.querySelector('#smax-config-io-status');
      const copyBtn = container.querySelector('#smax-config-copy-btn');
      const saveBtn = container.querySelector('#smax-config-save-btn');

      const setIOStatus = (msg, color = '#94a3b8') => {
        if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
      };

      const openEditor = () => {
        if (!editorPanel || !textarea) return;
        textarea.value = buildConfigJSON();
        editorPanel.style.display = 'block';
        setIOStatus('');
      };

      const closeEditor = () => {
        if (editorPanel) editorPanel.style.display = 'none';
      };

      if (toggleBtn) toggleBtn.addEventListener('click', () => {
        if (editorPanel && editorPanel.style.display !== 'none') closeEditor();
        else openEditor();
      });

      if (closeBtn) closeBtn.addEventListener('click', closeEditor);

      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          if (!textarea || !textarea.value.trim()) return;
          textarea.select();
          navigator.clipboard.writeText(textarea.value).then(() => {
            setIOStatus('Copiado! ✓', '#4ade80');
          }).catch(() => {
            document.execCommand('copy');
            setIOStatus('Copiado! ✓', '#4ade80');
          });
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          if (!textarea) return;
          const raw = (textarea.value || '').trim();
          if (!raw) { setIOStatus('O campo está vazio.', '#fca5a5'); return; }
          const result = applyConfigJSON(raw);
          if (!result.ok) { setIOStatus(result.msg, '#fca5a5'); return; }
          setIOStatus(result.msg, '#4ade80');
          // Re-render to reflect changes
          setTimeout(() => renderPanel(), 300);
        });
      }

      // --- Guide panel toggle ---
      const guideToggle = container.querySelector('#smax-guide-toggle-btn');
      const guidePanel = container.querySelector('#smax-guide-panel');
      const guideCloseBtn = container.querySelector('#smax-guide-close-btn');

      if (guideToggle && guidePanel) {
        guideToggle.addEventListener('click', () => {
          guidePanel.style.display = guidePanel.style.display !== 'none' ? 'none' : 'block';
        });
      }
      if (guideCloseBtn && guidePanel) {
        guideCloseBtn.addEventListener('click', () => {
          guidePanel.style.display = 'none';
        });
      }
    };

    const wirePanelEvents = () => {
      if (!container) return;

      // Triador search logic
      const triadorSearch = container.querySelector('#smax-triador-search');
      const triadorResults = container.querySelector('#smax-triador-results');
      const triadorCurrent = container.querySelector('#smax-triador-current');

      if (triadorSearch && triadorResults && triadorCurrent) {
        const selectTriador = (personId, personName) => {
          prefs.myPersonId = personId;
          prefs.myPersonName = personName;
          savePrefs();
          triadorCurrent.textContent = personName || '(Não selecionado)';
          triadorSearch.value = '';
          triadorResults.style.display = 'none';
        };

        const renderTriadorResults = (query) => {
          const q = (query || '').toUpperCase().trim();
          if (!q) {
            triadorResults.style.display = 'none';
            return;
          }

          DataRepository.ensurePeopleLoaded();
          const people = Array.from(DataRepository.peopleCache.values());

          if (!people.length) {
            triadorResults.innerHTML = '<div style="padding:8px;color:#999;font-size:11px;">Carregando pessoas...</div>';
            triadorResults.style.display = 'block';
            return;
          }

          const matches = people.filter(p =>
            (p.name || '').toUpperCase().includes(q) ||
            (p.upn || '').toUpperCase().includes(q)
          ).slice(0, 10);

          if (!matches.length) {
            triadorResults.innerHTML = '<div style="padding:8px;color:#999;font-size:11px;">Nenhum resultado.</div>';
          } else {
            triadorResults.innerHTML = matches.map(p => `
              <div class="smax-triador-pick" data-id="${p.id}" data-name="${Utils.escapeHtml(p.name)}" 
                style="padding:6px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid #f0f0f0;transition:background .1s;">
                <div style="font-weight:500;">${Utils.escapeHtml(p.name)}</div>
                <div style="color:#666;font-size:10px;">${Utils.escapeHtml(p.upn || p.id)}</div>
              </div>
            `).join('');

            triadorResults.querySelectorAll('.smax-triador-pick').forEach(el => {
              el.addEventListener('mouseenter', () => { el.style.background = '#f0f9ff'; });
              el.addEventListener('mouseleave', () => { el.style.background = '#fff'; });
              el.addEventListener('click', () => {
                selectTriador(el.dataset.id, el.dataset.name);
              });
            });
          }
          triadorResults.style.display = 'block';
        };

        triadorSearch.addEventListener('input', () => renderTriadorResults(triadorSearch.value));
        triadorSearch.addEventListener('focus', () => {
          DataRepository.ensurePeopleLoaded();
          if (triadorSearch.value) renderTriadorResults(triadorSearch.value);
        });
        triadorSearch.addEventListener('blur', () => {
          setTimeout(() => { triadorResults.style.display = 'none'; }, 200);
        });
      }
    };

    const init = () => {
      if (container) return;
      toggleBtn = document.createElement('button');
      toggleBtn.id = 'smax-settings-btn';
      toggleBtn.textContent = '⚙️';
      toggleBtn.title = 'Configurações de Equipes e Triagem';
      Object.assign(toggleBtn.style, { position: 'fixed', right: '12px', bottom: '12px', zIndex: 999999, border: 'none' });
      document.body.appendChild(toggleBtn);

      container = document.createElement('div');
      container.id = 'smax-settings';
      Object.assign(container.style, {
        position: 'fixed', right: '12px', bottom: '70px', minWidth: '420px', maxWidth: '650px', maxHeight: '85vh', minHeight: '300px', overflow: 'auto', zIndex: 999999, padding: '16px', borderRadius: '16px', background: '#0f172a', boxShadow: '0 25px 60px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.08) inset', display: 'none', backdropFilter: 'blur(8px)', color: '#e5e7eb', fontSize: '14px'
      });
      document.body.appendChild(container);

      toggleBtn.addEventListener('click', () => {
        const visible = container.style.display !== 'none';
        if (!visible) {
          DataRepository.ensurePeopleLoaded();
          reloadConfig();
          renderPanel();
          container.style.display = 'block';
        } else {
          container.style.display = 'none';
        }
      });
    };



    return { init, renderPanel };
  })();

  /* =========================================================
   * Comment auto height
   * =======================================================*/
  const CommentExpander = (() => {
    const init = () => {
      if (!prefs.enlargeCommentsOn) return;
      const obs = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return;
            if (node.matches('.comment-items')) {
              node.style.height = 'auto';
              node.style.maxHeight = 'none';
            } else {
              node.querySelectorAll('.comment-items').forEach((el) => {
                el.style.height = 'auto';
                el.style.maxHeight = 'none';
              });
            }
          });
        });
      });
      obs.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
    };
    return { init };
  })();

  /* =========================================================
   * Section tweaks (collapse catalogue block)
   * =======================================================*/
  const SectionTweaks = (() => {
    const init = () => {
      if (!prefs.collapseOn) return;
      const SECTION_SELECTOR = '#form-section-5, [data-aid="section-catalog-offering"]';
      const IDS_TO_REMOVE = ['form-section-1', 'form-section-7', 'form-section-8'];
      const collapsedOnce = new WeakSet();

      const isOpen = (section) => {
        const content = section?.querySelector?.('.pl-entity-page-component-content');
        return !!content && !content.classList.contains('ng-hide');
      };

      const fixAria = (header, section) => {
        if (!header || !section) return;
        if (header.getAttribute('aria-expanded') !== 'false') header.setAttribute('aria-expanded', 'false');
        const sr = section.querySelector('.pl-entity-page-component-header-sr');
        if (sr && /Expandido/i.test(sr.textContent || '')) sr.textContent = sr.textContent.replace(/Expandido/ig, 'Recolhido');
        const icon = header.querySelector('[pl-bidi-collapse-arrow]') || header.querySelector('.icon-arrow-med-down, .icon-arrow-med-right');
        if (icon) {
          icon.classList.remove('icon-arrow-med-down');
          icon.classList.add('icon-arrow-med-right');
        }
      };

      const collapseSectionOnce = (section) => {
        if (section.dataset.userInteracted === '1') return;
        if (collapsedOnce.has(section)) return;
        const header = section.querySelector('.pl-entity-page-component-header[role="button"]');
        if (!header) return;
        if (isOpen(section)) {
          header.click();
          setTimeout(() => fixAria(header, section), 0);
        } else {
          fixAria(header, section);
        }
        collapsedOnce.add(section);
      };

      const removeSections = () => {
        IDS_TO_REMOVE.forEach((id) => {
          const el = document.getElementById(id);
          if (el && el.parentNode) el.remove();
        });
      };

      const applyAll = () => {
        document.querySelectorAll(SECTION_SELECTOR).forEach(collapseSectionOnce);
        removeSections();
      };

      document.addEventListener('click', (event) => {
        const header = event.target.closest('.pl-entity-page-component-header[role="button"]');
        if (!header) return;
        const section = header.closest('#form-section-5, [data-aid="section-catalog-offering"]');
        if (section) section.dataset.userInteracted = '1';
      }, { capture: true });

      const schedule = Utils.debounce(applyAll, 100);
      const obs = new MutationObserver(() => schedule());
      setTimeout(applyAll, 300);
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
    };

    return { init };
  })();

  /* =========================================================
   * Orchestrator for repeated UI refresh
   * =======================================================*/
  const Orchestrator = (() => {
    const runAll = () => {
      if ('requestIdleCallback' in window) requestIdleCallback(NameBadges.apply, { timeout: 500 });
      else setTimeout(NameBadges.apply, 0);
    };

    const schedule = Utils.debounce(runAll, 80);

    const init = () => {
      runAll();
      const obsMain = new MutationObserver(() => schedule());
      obsMain.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-expanded']
      });

      const headerEl = document.querySelector('.slick-header-columns') || document.body;
      const obsHeader = new MutationObserver(() => schedule());
      obsHeader.observe(headerEl, { childList: true, subtree: true, attributes: true });

      window.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule, { passive: true });
      window.addEventListener('beforeunload', () => { obsMain.disconnect(); obsHeader.disconnect(); }, { once: true });
    };

    return { init };
  })();

  /* =========================================================
   * Skull flag for detractor users
   * =======================================================*/
  const SkullFlag = (() => {
    const FLAG_SET = new Set([
      'Adriano Zilli', 'Adriana Da Silva Ferreira Oliveira', 'Alessandra Sousa Nunes', 'Bruna Marques Dos Santos', 'Breno Medeiros Malfati', 'Carlos Henrique Scala De Almeida', 'Cassia Santos Alves De Lima', 'Dalete Rodrigues Silva', 'David Lopes De Oliveira', 'Davi Dos Reis Garcia', 'Deaulas De Campos Salviano', 'Diego Oliveira Da Silva', 'Diogo Mendonça Aniceto', 'Elaine Moriya', 'Ester Naili Dos Santos', 'Fabiano Barbosa Dos Reis', 'Fabricio Christiano Tanobe Lyra', 'Gabriel Teixeira Ludvig', 'Gilberto Sintoni Junior', 'Giovanna Coradini Teixeira', 'Gislene Ferreira Sant\'Ana Ramos', 'Guilherme Cesar De Sousa', 'Gustavo De Meira Gonçalves', 'Jackson Alcantara Santana', 'Janaina Dos Passos Silvestre', 'Jefferson Silva De Carvalho Soares', 'Joyce Da Silva Oliveira', 'Juan Campos De Souza', 'Juliana Lino Dos Santos Rosa', 'Karina Nicolau Samaan', 'Karine Barbara Vitor De Lima Souza', 'Kaue Nunes Silva Farrelly', 'Kelly Ferreira De Freitas', 'Larissa Ferreira Fumero', 'Lucas Alves Dos Santos', 'Lucas Carneiro Peres Ferreira', 'Marcos Paulo Silva Madalena', 'Maria Fernanda De Oliveira Bento', 'Natalia Yurie Shiba', 'Paulo Roberto Massoca', 'Pedro Henrique Palacio Baritti', 'Rafaella Silva Lima Petrolini', 'Renata Aparecida Mendes Bonvechio', 'Rodrigo Silva Oliveira', 'Ryan Souza Carvalho', 'Tatiana Lourenço Da Costa Antunes', 'Tatiane Araujo Da Cruz', 'Thiago Tadeu Faustino De Oliveira', 'Tiago Carvalho De Freitas Meneses', 'Victor Viana Roca'
    ].map(Utils.normalizeText));

    const apply = (personItem) => {
      try {
        if (!(personItem instanceof HTMLElement)) return;
        const clone = personItem.cloneNode(true);
        while (clone.firstChild) {
          if (clone.firstChild.nodeType === Node.ELEMENT_NODE) clone.removeChild(clone.firstChild);
          else break;
        }
        const leading = clone.textContent || '';
        if (!FLAG_SET.has(Utils.normalizeText(leading))) return;
        const img = personItem.querySelector('img.ts-avatar, img.pl-shared-item-img, img.ts-image') || personItem.querySelector('img');
        if (img && img.dataset.__g1Applied !== '1') {
          img.dataset.__g1Applied = '1';
          img.src = 'https://cdn-icons-png.flaticon.com/512/564/564619.png';
          img.alt = 'Alerta de Usuário Detrator';
          img.title = 'Alerta de Usuário Detrator';
          Object.assign(img.style, { border: '3px solid #ff0000', borderRadius: '50%', padding: '2px', backgroundColor: '#ff000022', boxShadow: '0 0 10px #ff0000' });
        }
        personItem.style.color = '#ff0000';
      } catch { }
    };

    const init = () => {
      if (!prefs.flagSkullOn) return;
      const obs = new MutationObserver(() => document.querySelectorAll('span.pl-person-item').forEach(apply));
      obs.observe(document.body, { childList: true, subtree: true });
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('span.pl-person-item').forEach(apply));
      } else {
        document.querySelectorAll('span.pl-person-item').forEach(apply);
      }
      window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
    };

    return { init };
  })();

  /* =========================================================
   * Grid tracker for triage HUD
   * =======================================================*/
  const GridTracker = (() => {
    let needsRebuild = false;

    const markDirty = () => {
      needsRebuild = true;
    };

    const init = () => {
      try {
        const viewport = Utils.getGridViewport();
        if (!viewport) return;
        let lastCount = viewport.querySelectorAll('.slick-row').length;
        const obs = new MutationObserver(() => {
          const currentCount = viewport.querySelectorAll('.slick-row').length;
          if (currentCount !== lastCount) {
            lastCount = currentCount;
            markDirty();
          }
        });
        obs.observe(viewport, { childList: true, subtree: true });
        window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
      } catch (err) {
        console.warn('[SMAX] Failed to observe grid changes:', err);
      }
    };

    const consume = () => {
      const flag = needsRebuild;
      needsRebuild = false;
      return flag;
    };

    DataRepository.onQueueUpdate(markDirty);

    return { init, consume, markDirty };
  })();

  /* =========================================================
   * Triage HUD
   * =======================================================*/
  const TriageHUD = (() => {
    const quickReplyCompletionCode = 'CompletionCodeFulfilled';
    let startBtn;
    let backdrop;
    let triageQueue = [];
    let triageIndex = -1;
    const stagedState = {
      urgency: null,
      assign: false,
      assignPersonId: '',
      parentId: '',
      parentSelected: false,
      assignmentGroupId: '',
      assignmentGroupName: '',
      assignmentGroupSelected: false,
      selectedTeamId: '',
      selectedWorkerId: '',
      stagedStatus: ''  // raw SMAX status key chosen by the user, empty = no change
    };
    let quickReplyHtml = '';
    let quickReplyEditor = null;
    let quickReplyEditorAttempts = 0;
    let quickReplyEditorConfig = null;
    let globalCkSnapshot = null;
    let nativeWatcherArmed = false;
    let quickReplyFallbackNotified = false;
    let quickReplyEditorPollTimer = null;
    let activeTicketId = null;
    let editorBaselineHtml = '';
    let quickReplyDirtyState = false;
    let baselineSyncTimer = null;
    let currentOwnerName = '';
    let personalFinalsSet = new Set(Utils.parseDigitRanges(prefs.personalFinalsRaw || ''));
    let attachmentsFetchSeq = 0;
    let currentAttachmentList = [];
    const inlineAttachmentHints = new Map();
    let queueSyncPromise = null;
    let supportGroupOptions = DataRepository.getSupportGroupsSnapshot ? DataRepository.getSupportGroupsSnapshot() : [];
    let supportGroupLoading = false;
    let supportGroupError = '';
    let currentAssignmentGroupId = '';
    let currentAssignmentGroupName = '';
    let supportGroupFilter = '';
    let gseDropdownOpen = false;
    let gseOutsideHandler = null;

    const normalizeSupportGroupText = (value) => Utils.normalizeText(value).toLowerCase();

    const getSupportGroupFilterTokens = () => {
      const normalized = normalizeSupportGroupText(supportGroupFilter).trim();
      if (!normalized) return [];
      return normalized.split(/\s+/).filter(Boolean);
    };

    const filterSupportGroupOptions = (tokens = getSupportGroupFilterTokens()) => {
      const source = Array.isArray(supportGroupOptions) ? supportGroupOptions : [];
      if (!tokens.length) return source.slice();
      return source.filter((group) => {
        if (!group) return false;
        const haystack = normalizeSupportGroupText(`${group.name || ''} ${group.id || ''}`);
        return tokens.every((token) => haystack.includes(token));
      });
    };

    const resolveSupportGroupLabel = (groupId) => {
      if (!groupId) return '';
      if (stagedState.assignmentGroupSelected && stagedState.assignmentGroupId === groupId && stagedState.assignmentGroupName) {
        return stagedState.assignmentGroupName;
      }
      if (currentAssignmentGroupId === groupId && currentAssignmentGroupName) {
        return currentAssignmentGroupName;
      }
      const list = Array.isArray(supportGroupOptions) ? supportGroupOptions : [];
      const match = list.find((group) => group && group.id === groupId);
      return match ? (match.name || '') : '';
    };

    DataRepository.onQueueUpdate(() => inlineAttachmentHints.clear());
    DataRepository.onPeopleUpdate(() => {
      if (!backdrop || backdrop.style.display !== 'flex') return;
      refreshButtons();
    });
    if (typeof DataRepository.onSupportGroupsUpdate === 'function') {
      DataRepository.onSupportGroupsUpdate((list) => {
        supportGroupOptions = Array.isArray(list) ? list : [];
        supportGroupLoading = false;
        supportGroupError = '';
        refreshGseSelect();
      });
    }

    const parseHtmlForAttachmentRefs = (html, hints) => {
      if (!html || !hints) return;
      const container = document.createElement('div');
      container.innerHTML = String(html);
      const nodes = container.querySelectorAll('[src],[href]');
      nodes.forEach((node) => {
        const raw = node.getAttribute('src') || node.getAttribute('href');
        if (!raw) return;
        const absolute = raw.startsWith('http') ? raw : Utils.toAbsoluteUrl(raw);
        const ids = new Set();
        const directMatch = absolute.match(/Attachment(?:%3A|:|\/)([a-z0-9-]{6,})/i);
        if (directMatch) ids.add(directMatch[1]);
        try {
          const parsed = new URL(absolute, window.location.origin);
          const param = parsed.searchParams.get('attachmentId');
          if (param) ids.add(param.replace(/^Attachment:/i, ''));
        } catch { }
        ids.forEach((rawId) => {
          const clean = Utils.normalizeAttachmentId(rawId);
          if (!clean) return;
          hints.ids.add(clean);
          if (!hints.urlById.has(clean)) hints.urlById.set(clean, absolute);
        });
      });
    };

    const getInlineAttachmentHints = (requestId) => {
      const normalized = Utils.normalizeRequestId(requestId);
      if (!normalized) return { ids: new Set(), urlById: new Map() };
      if (inlineAttachmentHints.has(normalized)) return inlineAttachmentHints.get(normalized);
      const hints = { ids: new Set(), urlById: new Map() };
      const cache = DataRepository.triageCache;
      if (cache && cache.has(normalized)) {
        const entry = cache.get(normalized) || {};
        parseHtmlForAttachmentRefs(entry.descriptionHtml, hints);
        parseHtmlForAttachmentRefs(entry.solutionHtml, hints);
        if (Array.isArray(entry.discussions)) entry.discussions.forEach((disc) => parseHtmlForAttachmentRefs(disc && disc.bodyHtml, hints));
      }
      inlineAttachmentHints.set(normalized, hints);
      return hints;
    };

    const applyInlineAttachmentFilter = (list, requestId) => {
      if (!Array.isArray(list)) return { filtered: [], removed: 0 };
      const hints = getInlineAttachmentHints(requestId);
      if (!hints.ids.size) return { filtered: list, removed: 0 };
      const filtered = list.filter((item) => !hints.ids.has(Utils.normalizeAttachmentId(item.id)));
      return { filtered, removed: list.length - filtered.length };
    };

    const urgencyMap = {
      low: { Urgency: 'NoDisruption', ImpactScope: 'SingleUser' },
      med: { Urgency: 'SlightDisruption', ImpactScope: 'SiteOrDepartment' },
      high: { Urgency: 'TotalLossOfService', ImpactScope: 'SiteOrDepartment' },
      crit: { Urgency: 'TotalLossOfService', ImpactScope: 'Enterprise' }
    };

    const REQUEST_STATUS_MAP = {
      RequestStatusInProgress: 'Em Andamento',
      RequestStatusActive: 'Ativo',
      RequestStatusSuspended: 'Suspenso',
      RequestStatusComplete: 'Concluído',
      RequestStatusAccepted: 'Aceito',
      RequestStatusReject: 'Rejeitado',
      RequestStatusPendingApproval: 'Aguardando Aprovação',
      RequestStatusPendingCustomer: 'Aguardando Solicitante',
      RequestStatusClassify: 'Classificar',
      RequestStatusAbandon: 'Abandonado',
      RequestStatusPendingChange: 'Aguardando Mudança',
      RequestStatusPending: 'Usuário Final Pendente',
      RequestStatusReady: 'Pronto'
    };

    // Statuses exposed to the user in the dropdown (subset of the full map)
    const EDITABLE_STATUSES = [
      'RequestStatusSuspended',
      'RequestStatusInProgress',
      'RequestStatusReady',
      'RequestStatusPending',
      'RequestStatusReject',
      'RequestStatusComplete'
    ];

    const humanReadableStatus = (raw) => {
      if (!raw) return '';
      if (REQUEST_STATUS_MAP[raw]) return REQUEST_STATUS_MAP[raw];
      // Fallback: strip 'RequestStatus' prefix and add spaces before capitals
      return raw.replace(/^RequestStatus/i, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    };

    let currentTicketOriginalStatus = ''; // tracks the ticket's API status so user can revert

    const getQuickReplyField = () => (backdrop ? backdrop.querySelector('#smax-triage-quickreply-editor') : null);

    const setQuickReplyHtml = (html, { syncBaseline = false } = {}) => {
      quickReplyHtml = html || '';
      if (quickReplyEditor && typeof quickReplyEditor.setData === 'function') {
        try {
          quickReplyEditor.setData(quickReplyHtml);
        } catch (err) {
          console.warn('[SMAX] Falha ao atualizar o CKEditor da resposta rápida:', err);
        }
      } else {
        const field = getQuickReplyField();
        if (field) field.value = quickReplyHtml;
      }
      if (syncBaseline) {
        editorBaselineHtml = Utils.normalizeHtml(quickReplyHtml);
        updateQuickReplyStageState();
      } else {
        syncBaselineFromEditor({ immediate: !quickReplyEditor });
      }
    };

    const readQuickReplyHtml = () => {
      if (quickReplyEditor && typeof quickReplyEditor.getData === 'function') {
        return quickReplyEditor.getData();
      }
      const field = getQuickReplyField();
      return field ? field.value : '';
    };

    const clearQuickReplyState = () => {
      setQuickReplyHtml('', { syncBaseline: true });
    };

    const syncQuickReplyBaseline = (html) => {
      const safe = html != null ? String(html) : '';
      setQuickReplyHtml(safe, { syncBaseline: true });
    };

    const hasUnsavedSolution = () => Utils.normalizeHtml(readQuickReplyHtml()) !== editorBaselineHtml;

    const syncBaselineFromEditor = ({ immediate = false } = {}) => {
      if (baselineSyncTimer) clearTimeout(baselineSyncTimer);
      const apply = () => {
        baselineSyncTimer = null;
        editorBaselineHtml = Utils.normalizeHtml(readQuickReplyHtml());
        updateQuickReplyStageState();
      };
      if (immediate || !quickReplyEditor) {
        apply();
        return;
      }
      baselineSyncTimer = setTimeout(apply, 80);
    };

    const updateQuickReplyStageState = ({ announce = false } = {}) => {
      const staged = hasUnsavedSolution();
      if (backdrop) {
        const card = backdrop.querySelector('#smax-triage-quickreply-card');
        if (card) card.dataset.staged = staged ? 'true' : 'false';
      }
      if (backdrop && announce && staged && !quickReplyDirtyState) {
        setStatus('Resposta pronta. Use ENVIAR para gravá-la no chamado.', 3500);
      }
      quickReplyDirtyState = staged;
      if (backdrop) {
        refreshButtons();
        setBaselineStatus();
      }
    };

    const handleQuickReplyChange = (nextHtml) => {
      quickReplyHtml = nextHtml != null ? nextHtml : readQuickReplyHtml();
      updateQuickReplyStageState({ announce: true });
    };


    const refreshPersonalFinalsSet = () => {
      personalFinalsSet = new Set(Utils.parseDigitRanges(prefs.personalFinalsRaw || ''));
    };

    const updateAttachmentPanel = ({ state, items = [], message } = {}) => {
      if (!backdrop) return;
      const listEl = backdrop.querySelector('#smax-triage-attachment-list');
      const row = backdrop.querySelector('#smax-triage-status-row');
      if (!listEl) return;
      if (state === 'loading') {
        currentAttachmentList = [];
        listEl.dataset.state = 'loading';
        listEl.textContent = 'Carregando anexos...';
        if (row) row.dataset.empty = 'true';
        return;
      }
      if (state === 'error') {
        currentAttachmentList = [];
        listEl.dataset.state = 'error';
        listEl.textContent = 'Não consegui carregar os anexos deste chamado.';
        if (row) row.dataset.empty = 'true';
        return;
      }
      if (!items.length) {
        currentAttachmentList = [];
        listEl.dataset.state = 'empty';
        listEl.textContent = message || 'Sem anexos.';
        if (row) row.dataset.empty = 'true';
        return;
      }
      currentAttachmentList = items;
      listEl.dataset.state = 'ready';
      listEl.innerHTML = items.map((att) => `
        <button type="button" class="smax-attachment-chip" data-attachment-id="${Utils.escapeHtml(att.id)}" title="${Utils.escapeHtml(att.name)}">
          ${Utils.escapeHtml(att.name)}
        </button>
      `).join('');
      if (row) row.dataset.empty = 'false';
    };
    const currentGseSelectValue = () => (stagedState.assignmentGroupSelected ? stagedState.assignmentGroupId : currentAssignmentGroupId || '');
    const refreshGseSelect = () => {
      if (!backdrop) return;
      const wrapper = backdrop.querySelector('#smax-triage-gse-wrapper');
      const displayBtn = backdrop.querySelector('#smax-triage-gse-display');
      const labelEl = backdrop.querySelector('#smax-triage-gse-display-label');
      const dropdown = backdrop.querySelector('#smax-triage-gse-dropdown');
      const optionsEl = backdrop.querySelector('#smax-triage-gse-options');
      const emptyEl = backdrop.querySelector('#smax-triage-gse-empty');
      const filterInput = backdrop.querySelector('#smax-triage-gse-filter');
      if (!wrapper || !displayBtn || !labelEl || !dropdown || !optionsEl || !emptyEl || !filterInput) return;
      if (filterInput.value !== supportGroupFilter) filterInput.value = supportGroupFilter;

      const activeValue = currentGseSelectValue();
      const filterTokens = getSupportGroupFilterTokens();
      const filteredOptions = filterSupportGroupOptions(filterTokens);
      const isFiltering = filterTokens.length > 0;
      let renderList = filteredOptions.slice();

      if (activeValue) {
        const exists = renderList.some((group) => group && group.id === activeValue);
        if (!exists) {
          const fallbackLabel = resolveSupportGroupLabel(activeValue) || 'GSE selecionado';
          renderList.unshift({ id: activeValue, name: fallbackLabel, forced: isFiltering });
        }
      }

      if (renderList.length || activeValue) {
        const clearLabel = activeValue ? 'Remover seleção (padrão)' : 'Selecionar GSE...';
        renderList.unshift({ id: '', name: clearLabel, ghost: true });
      }

      const fragments = [];
      renderList.forEach((group) => {
        if (!group || group.id == null) return;
        const rawValue = String(group.id);
        const value = rawValue.trim();
        const label = group.name || (value ? `Grupo ${value}` : 'Sem GSE');
        const active = value && activeValue && value === activeValue;
        const forcedChip = group.forced && isFiltering ? '<span class="smax-triage-gse-chip">Selecionado</span>' : '';
        fragments.push(`
          <button type="button" role="option" class="smax-triage-gse-option" data-value="${Utils.escapeHtml(value)}" data-label="${Utils.escapeHtml(label)}" data-active="${active ? 'true' : 'false'}" data-ghost="${group.ghost ? 'true' : 'false'}">
            <span class="smax-triage-gse-option-name">${Utils.escapeHtml(label)}</span>
            ${forcedChip}
          </button>
        `);
      });

      const noOptions = !fragments.length;
      if (noOptions) {
        optionsEl.innerHTML = '';
        optionsEl.dataset.empty = 'true';
        emptyEl.style.display = 'block';
        if (!supportGroupOptions.length && supportGroupLoading) emptyEl.textContent = 'Carregando GSEs...';
        else if (supportGroupError) emptyEl.textContent = supportGroupError;
        else if (isFiltering) emptyEl.textContent = 'Nenhum GSE corresponde ao filtro.';
        else emptyEl.textContent = 'Nenhum GSE disponível.';
      } else {
        optionsEl.innerHTML = fragments.join('');
        optionsEl.dataset.empty = 'false';
        emptyEl.style.display = 'none';
      }

      let displayLabel = 'Selecionar GSE...';
      if (activeValue) {
        displayLabel = resolveSupportGroupLabel(activeValue) || `Grupo ${activeValue}`;
      } else if (!renderList.length && supportGroupLoading) {
        displayLabel = 'Carregando GSEs...';
      }
      labelEl.textContent = displayLabel;

      const allowToggle = !(!supportGroupOptions.length && !activeValue && supportGroupLoading);
      displayBtn.disabled = !allowToggle;
      if (!allowToggle && gseDropdownOpen) closeGseDropdown();

      if (wrapper) {
        if (stagedState.assignmentGroupSelected) wrapper.dataset.state = 'staged';
        else if (supportGroupLoading && !supportGroupOptions.length && !activeValue) wrapper.dataset.state = 'loading';
        else if (activeValue) wrapper.dataset.state = 'ready';
        else if (renderList.length) wrapper.dataset.state = 'ready';
        else wrapper.dataset.state = 'empty';
      }
    };
    const ensureSupportGroupsReady = () => {
      if (supportGroupOptions.length || supportGroupLoading) return;
      supportGroupLoading = true;
      supportGroupError = '';
      refreshGseSelect();
      if (typeof DataRepository.ensureSupportGroups === 'function') {
        DataRepository.ensureSupportGroups({ force: false })
          .catch((err) => {
            console.warn('[SMAX] Falha ao carregar lista de GSEs:', err);
            supportGroupError = 'Falha ao carregar GSEs.';
          })
          .finally(() => {
            supportGroupLoading = false;
            refreshGseSelect();
          });
      }
    };
    const stageAssignmentGroup = (groupId, groupName) => {
      const trimmedId = groupId ? String(groupId).trim() : '';
      const trimmedName = groupName ? groupName.trim() : '';
      if (trimmedId && trimmedId !== currentAssignmentGroupId) {
        stagedState.assignmentGroupId = trimmedId;
        stagedState.assignmentGroupName = trimmedName || (supportGroupOptions.find((g) => g.id === trimmedId)?.name) || '';
        stagedState.assignmentGroupSelected = true;
      } else {
        stagedState.assignmentGroupId = '';
        stagedState.assignmentGroupName = '';
        stagedState.assignmentGroupSelected = false;
      }
      refreshGseSelect();
      refreshButtons();
      setBaselineStatus();
    };
    const handleGseOptionClick = (evt) => {
      if (!backdrop) return;
      const button = evt.target.closest('.smax-triage-gse-option');
      if (!button) return;
      const value = button.dataset.value || '';
      const label = button.dataset.label || button.textContent.trim();
      stageAssignmentGroup(value, label);
      closeGseDropdown({ focusButton: true });
    };
    const handleGseFilterInput = () => {
      if (!backdrop) return;
      const input = backdrop.querySelector('#smax-triage-gse-filter');
      if (!input) return;
      if (input.value.length > 80) input.value = input.value.slice(0, 80);
      supportGroupFilter = input.value;
      refreshGseSelect();
      ensureSupportGroupsReady();
    };
    const handleGseDropdownKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeGseDropdown({ focusButton: true });
      }
    };
    function closeGseDropdown({ focusButton = false } = {}) {
      if (!backdrop) return;
      const wrapper = backdrop.querySelector('#smax-triage-gse-wrapper');
      const displayBtn = backdrop.querySelector('#smax-triage-gse-display');
      if (wrapper) wrapper.dataset.open = 'false';
      if (!gseDropdownOpen) return;
      gseDropdownOpen = false;
      if (gseOutsideHandler) {
        document.removeEventListener('mousedown', gseOutsideHandler, true);
        document.removeEventListener('touchstart', gseOutsideHandler, true);
        gseOutsideHandler = null;
      }
      if (focusButton && displayBtn) displayBtn.focus();
    }
    function openGseDropdown() {
      if (!backdrop || gseDropdownOpen) return;
      const wrapper = backdrop.querySelector('#smax-triage-gse-wrapper');
      const filterInput = backdrop.querySelector('#smax-triage-gse-filter');
      if (!wrapper) return;
      gseDropdownOpen = true;
      wrapper.dataset.open = 'true';
      if (!gseOutsideHandler) {
        gseOutsideHandler = (evt) => {
          if (!wrapper.contains(evt.target)) closeGseDropdown();
        };
        document.addEventListener('mousedown', gseOutsideHandler, true);
        document.addEventListener('touchstart', gseOutsideHandler, true);
      }
      ensureSupportGroupsReady();
      refreshGseSelect();
      if (filterInput) {
        filterInput.focus();
        filterInput.select();
      }
    }
    const toggleGseDropdown = () => {
      if (gseDropdownOpen) closeGseDropdown();
      else openGseDropdown();
    };

    const fetchAttachmentsForRequest = (requestId) => {
      attachmentsFetchSeq += 1;
      const token = attachmentsFetchSeq;
      const normalized = Utils.normalizeRequestId(requestId);
      if (!normalized) {
        updateAttachmentPanel({ state: 'empty', items: [] });
        return;
      }
      updateAttachmentPanel({ state: 'loading' });
      AttachmentService.fetchList(normalized).then((list) => {
        if (token !== attachmentsFetchSeq) return;
        const { filtered, removed } = applyInlineAttachmentFilter(list, normalized);
        if (removed && !filtered.length) {
          updateAttachmentPanel({
            state: 'empty',
            items: [],
            message: 'Apenas imagens já embutidas na descrição/discussões.'
          });
          return;
        }
        updateAttachmentPanel({ state: 'ready', items: filtered });
      }).catch(() => {
        if (token !== attachmentsFetchSeq) return;
        updateAttachmentPanel({ state: 'error' });
      });
    };

    const finalPairFromEntry = (entry) => {
      if (!entry) return null;
      if (typeof entry.idNum === 'number' && !Number.isNaN(entry.idNum)) {
        return ((Math.abs(entry.idNum) % 100) + 100) % 100;
      }
      const trailing = Utils.extractTrailingDigits(entry.idText || '') || '';
      if (!trailing) return null;
      const slice = trailing.slice(-2);
      if (!slice) return null;
      const parsed = parseInt(slice, 10);
      if (Number.isNaN(parsed)) return null;
      return ((Math.abs(parsed) % 100) + 100) % 100;
    };

    const matchesPersonalFinals = (entry) => {
      if (!personalFinalsSet.size) return true;
      const target = finalPairFromEntry(entry);
      return target != null && personalFinalsSet.has(target);
    };

    const applyPersonalFinalsFilter = (queue) => {
      if (!personalFinalsSet.size || !Array.isArray(queue)) return queue;
      return queue.filter((entry) => matchesPersonalFinals(entry));
    };

    const ensureSourceButton = (toolbar) => {
      if (!Array.isArray(toolbar)) return;
      const hasSource = toolbar.some((group) => {
        if (!group) return false;
        if (typeof group === 'string') return group === 'Source';
        if (Array.isArray(group)) return group.includes('Source');
        const items = Array.isArray(group.items) ? group.items : null;
        return items ? items.includes('Source') : false;
      });
      if (hasSource) return;
      if (toolbar.length) {
        const first = toolbar[0];
        if (typeof first === 'string') toolbar.unshift('Source');
        else if (Array.isArray(first)) first.unshift('Source');
        else if (first && Array.isArray(first.items)) first.items.unshift('Source');
        else toolbar.unshift({ name: 'document', items: ['Source'] });
      } else {
        toolbar.push({ name: 'document', items: ['Source'] });
      }
    };

    const defaultQuickReplyConfig = () => ({
      height: 180,
      allowedContent: true,
      removePlugins: 'elementspath',
      extraPlugins: 'colorbutton,font',
      toolbar: [
        { name: 'document', items: ['Source', 'Preview'] },
        { name: 'clipboard', items: ['Undo', 'Redo'] },
        { name: 'basicstyles', items: ['Bold', 'Italic', 'Underline', 'Strike', 'RemoveFormat'] },
        { name: 'paragraph', items: ['NumberedList', 'BulletedList', '-', 'Outdent', 'Indent'] },
        { name: 'links', items: ['Link', 'Unlink'] },
        { name: 'insert', items: ['Table', 'HorizontalRule'] },
        { name: 'styles', items: ['Format', 'Font', 'FontSize'] },
        { name: 'colors', items: ['TextColor', 'BGColor'] }
      ]
    });

    const copyConfigKeys = (source) => {
      if (!source) return null;
      const cfg = {
        height: source.height || 180,
        allowedContent: source.allowedContent !== undefined ? source.allowedContent : true,
        removePlugins: source.removePlugins || 'elementspath',
        extraPlugins: source.extraPlugins || ''
      };
      const keys = [
        'toolbar', 'toolbarGroups', 'font_names', 'fontSize_sizes', 'format_tags', 'contentsCss',
        'skin', 'uiColor', 'colorButton_foreStyle', 'colorButton_backStyle', 'stylesSet',
        'enterMode', 'shiftEnterMode', 'removeButtons'
      ];
      keys.forEach((key) => {
        if (source[key] !== undefined) cfg[key] = Utils.deepClone(source[key]);
      });
      if (cfg.toolbar) ensureSourceButton(cfg.toolbar);
      return cfg;
    };

    const appendEditorCss = (config, cssText) => {
      if (!config || !cssText) return;
      const dataUri = `data:text/css,${encodeURIComponent(cssText)}`;
      if (Array.isArray(config.contentsCss)) {
        config.contentsCss.push(dataUri);
      } else if (typeof config.contentsCss === 'string' && config.contentsCss.length) {
        config.contentsCss = [config.contentsCss, dataUri];
      } else {
        config.contentsCss = [dataUri];
      }
    };

    const pickAnyEditorInstance = () => {
      const ck = getPageCKEditor();
      if (!(ck && ck.instances)) return null;
      const list = Object.values(ck.instances);
      if (!list.length) return null;
      const target = list.find((inst) => {
        try {
          const id = `${inst.name || ''} ${inst.element && inst.element.getName ? inst.element.getName() : ''}`;
          return /solution|solucao|plCkeditor/i.test(id);
        } catch {
          return false;
        }
      });
      return target || list[0];
    };

    const captureGlobalConfigSnapshot = () => {
      const ck = getPageCKEditor();
      if (globalCkSnapshot || !(ck && ck.config)) return globalCkSnapshot;
      try {
        globalCkSnapshot = copyConfigKeys(ck.config) || null;
      } catch (err) {
        console.warn('[SMAX] Failed to snapshot global CKEditor config:', err);
        globalCkSnapshot = null;
      }
      return globalCkSnapshot;
    };

    const captureQuickReplyConfig = () => {
      if (quickReplyEditorConfig) return quickReplyEditorConfig;
      const ck = getPageCKEditor();
      if (ck && ck.instances) {
        const native = (Utils.locateSolutionEditor && Utils.locateSolutionEditor()) || pickAnyEditorInstance();
        if (native && native.config) {
          quickReplyEditorConfig = copyConfigKeys(native.config);
          if (quickReplyEditorConfig) {
            quickReplyFallbackNotified = false;
            return quickReplyEditorConfig;
          }
        }
      }
      quickReplyEditorConfig = captureGlobalConfigSnapshot();
      if (quickReplyEditorConfig && !quickReplyFallbackNotified) {
        quickReplyFallbackNotified = true;
        console.warn('[SMAX] CKEditor nativo ainda não foi aberto; usando configuração global detectada.');
      }
      return quickReplyEditorConfig;
    };

    const hookNativeEditors = () => {
      if (nativeWatcherArmed) return;
      nativeWatcherArmed = true;
      console.info('[SMAX] Aguardando o CKEditor nativo para copiar a configuração...');
      const attempt = () => {
        const ck = getPageCKEditor();
        if (!(ck && ck.on)) {
          setTimeout(attempt, 800);
          return;
        }
        const tryCapture = (editor) => {
          if (!editor || !editor.config) return;
          const cfg = copyConfigKeys(editor.config);
          if (cfg) {
            quickReplyEditorConfig = cfg;
            quickReplyFallbackNotified = false;
            console.info('[SMAX] Configuração do CKEditor clonada para a resposta rápida.');
            if (!quickReplyEditor) ensureQuickReplyEditor();
          }
        };
        Object.values(ck.instances || {}).forEach(tryCapture);
        ck.on('instanceReady', (evt) => {
          tryCapture(evt && evt.editor);
        });
      };
      attempt();
    };

    const buildQuickReplyConfig = () => {
      const captured = captureQuickReplyConfig();
      if (captured) return Utils.deepClone(captured);
      const fallback = defaultQuickReplyConfig();
      ensureSourceButton(fallback.toolbar);
      if (!quickReplyFallbackNotified) {
        quickReplyFallbackNotified = true;
        console.warn('[SMAX] CKEditor nativo não detectado; usando configuração padrão na resposta rápida.');
      }
      return fallback;
    };

    const ensureQuickReplyEditor = () => {
      const ck = getPageCKEditor();
      if (!ck || !ck.replace || quickReplyEditor) return;
      const field = getQuickReplyField();
      if (!field) return;
      const config = buildQuickReplyConfig();
      if (!config) return;
      try {
        console.info('[SMAX] Inicializando editor de resposta rápida.');
        const instanceConfig = Object.assign({ resize_enabled: true }, config);
        appendEditorCss(instanceConfig, 'body{color:#000000 !important;}');
        quickReplyEditor = ck.replace(field, instanceConfig);
        const enforceDefaultColor = () => {
          try {
            if (!quickReplyEditor) return;
            const editable = typeof quickReplyEditor.editable === 'function' ? quickReplyEditor.editable() : null;
            if (editable && typeof editable.setStyle === 'function') {
              editable.setStyle('color', '#000000');
              editable.removeClass('smax-quickreply-muted');
            }
          } catch (err) {
            console.warn('[SMAX] Failed to enforce default CKEditor text color:', err);
          }
        };
        quickReplyEditor.on('instanceReady', () => {
          enforceDefaultColor();
          quickReplyEditor.setData(quickReplyHtml || '');
          setTimeout(() => syncBaselineFromEditor({ immediate: true }), 60);
          console.info('[SMAX] Editor de resposta rápida pronto e sincronizado.');
        });
        quickReplyEditor.on('contentDom', enforceDefaultColor);
        quickReplyEditor.on('change', () => {
          handleQuickReplyChange(quickReplyEditor.getData());
        });
      } catch (err) {
        console.warn('[SMAX] Failed to init quick reply editor:', err);
        console.error('[SMAX] Não consegui carregar o CKEditor no painel de resposta rápida.');
      }
    };

    const scheduleQuickReplyEditor = () => {
      if (quickReplyEditor) return;
      if (quickReplyEditorPollTimer) clearTimeout(quickReplyEditorPollTimer);
      quickReplyEditorAttempts += 1;
      const ck = getPageCKEditor();
      const ckReady = Boolean(ck && ck.replace);
      if (ckReady) {
        ensureQuickReplyEditor();
      } else {
        if (quickReplyEditorAttempts === 1) {
          console.info('[SMAX] Carregando scripts do CKEditor para a resposta rápida...');
        }
      }
      if (!quickReplyEditor) {
        const delay = Math.min(1200, 600 + quickReplyEditorAttempts * 40);
        quickReplyEditorPollTimer = setTimeout(scheduleQuickReplyEditor, delay);
      } else {
        quickReplyEditorPollTimer = null;
      }
    };

    const captureSelectedIdFromDom = () => {
      try {
        const viewport = Utils.getGridViewport();
        if (!viewport) return null;
        const row = viewport.querySelector('.slick-row.active, .slick-row.ui-state-active, .slick-row.selected');
        if (!row) return null;
        const anchor = row.querySelector('a.entity-link-id, a');
        if (anchor) return (anchor.textContent || '').trim();
        const cell = row.querySelector('.slick-cell');
        return cell ? (cell.textContent || '').trim() : null;
      } catch (err) {
        console.warn('[SMAX] Failed to capture selected row id:', err);
        return null;
      }
    };

    const buildQueue = () => {
      const snapshot = DataRepository.getTriageQueueSnapshot();
      const selectedFromDom = captureSelectedIdFromDom();
      if (snapshot.length) {
        return { list: applyPersonalFinalsFilter(snapshot.slice()), selectedId: selectedFromDom };
      }
      const viewport = Utils.getGridViewport();
      if (!viewport) return [];
      let idColIndex = 0;
      let createTimeColIndex = null;
      try {
        const headerColumns = document.querySelectorAll('.slick-header-column');
        headerColumns.forEach((col, idx) => {
          const aid = col.getAttribute('data-aid') || '';
          if (/grid_header_Id$/i.test(aid)) idColIndex = idx;
          if (/grid_header_CreateTime$/i.test(aid)) createTimeColIndex = idx;
        });
      } catch { }

      const rows = Array.from(viewport.querySelectorAll('.slick-row'));
      const queue = [];
      let selectedId = null;
      for (const row of rows) {
        const cells = row.querySelectorAll('.slick-cell');
        if (!cells.length) continue;
        const idCell = cells[idColIndex] || cells[0];
        const idText = (idCell.textContent || '').trim();
        const idNum = parseInt(idText.replace(/\D/g, ''), 10);
        if (!idText) continue;
        if (!selectedId && row.classList.contains('active')) selectedId = idText;
        else if (!selectedId && row.classList.contains('ui-state-active')) selectedId = idText;
        else if (!selectedId && row.classList.contains('selected')) selectedId = idText;
        let createdCell = null;
        if (createTimeColIndex != null && cells[createTimeColIndex]) {
          createdCell = cells[createTimeColIndex];
        } else {
          createdCell = Array.from(cells).find((c) => /Hora de Cria/i.test(c.getAttribute('title') || '') || /Hora de Cria/i.test(c.textContent || ''));
        }
        const createdText = createdCell ? (createdCell.textContent || '').trim() : '';
        const createdTs = Utils.parseSmaxDateTime(createdText) || 0;
        const vipCell = Array.from(cells).find((c) => /VIP/i.test(c.textContent || ''));
        const isVip = !!vipCell && /VIP/i.test(vipCell.textContent || '');
        queue.push({ idText, idNum: Number.isNaN(idNum) ? null : idNum, createdText, createdTs, isVip });
      }
      queue.sort((a, b) => {
        if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
        if (a.createdTs !== b.createdTs) return a.createdTs - b.createdTs;
        if (a.idNum != null && b.idNum != null && a.idNum !== b.idNum) return a.idNum - b.idNum;
        return 0;
      });
      return { list: applyPersonalFinalsFilter(queue), selectedId: selectedId || selectedFromDom || null };
    };

    const currentItem = () => {
      if (!triageQueue.length) return null;
      if (triageIndex < 0 || triageIndex >= triageQueue.length) return triageQueue[0];
      return triageQueue[triageIndex];
    };

    const rebuildQueueForPersonalFinals = () => {
      if (!backdrop || backdrop.style.display !== 'flex') return;
      const currentId = currentItem()?.idText || null;
      const { list } = buildQueue();
      triageQueue = list;
      if (!triageQueue.length) {
        triageIndex = -1;
      } else if (currentId) {
        const idx = triageQueue.findIndex((entry) => entry.idText === currentId);
        triageIndex = idx >= 0 ? idx : 0;
      } else {
        triageIndex = 0;
      }
      render();
    };

    const resetStaged = () => {
      stagedState.urgency = null;
      stagedState.assign = false;
      stagedState.assignPersonId = '';
      stagedState.parentId = '';
      stagedState.parentSelected = false;
      stagedState.assignmentGroupId = '';
      stagedState.assignmentGroupName = '';
      stagedState.assignmentGroupSelected = false;
      stagedState.selectedTeamId = '';
      stagedState.selectedWorkerId = '';
      stagedState.stagedStatus = '';
      currentTicketOriginalStatus = '';
      const ck = backdrop.querySelector('#smax-triage-used-script');
      if (ck) ck.checked = false;
    };

    const anyStaged = () => Boolean(
      stagedState.urgency
      || stagedState.assign
      || stagedState.parentSelected
      || stagedState.assignmentGroupSelected
      || stagedState.stagedStatus
      || hasUnsavedSolution()
    );

    const ownerForCurrent = () => {
      const item = currentItem();
      if (!item) return null;
      // Use Team-based resolution (GSE First) instead of global Distribution
      const team = TeamsConfig.suggestTeam(item);
      const worker = TeamsConfig.suggestWorker(team, item.idText || (item.idNum != null ? String(item.idNum) : ''));
      return worker ? worker.name : null;
    };

    const resolvePersonIdByName = (name) => {
      const target = Utils.normalizeText(name);
      if (!target) return '';
      let resolved = '';
      DataRepository.peopleCache.forEach((person) => {
        if (resolved || !person) return;
        const composite = [
          person.name,
          [person.firstName, person.lastName].filter(Boolean).join(' '),
          person.DisplayLabel,
          person.FullName
        ].find((entry) => entry && Utils.normalizeText(entry) === target);
        if (composite) resolved = String(person.id);
      });
      return resolved;
    };

    const DISCUSSION_DATE_OPTIONS = {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    };
    const resolveSubmitterName = (entry) => {
      if (!entry) return '';
      if (entry.submitterPersonId && DataRepository.peopleCache.has(entry.submitterPersonId)) {
        const person = DataRepository.peopleCache.get(entry.submitterPersonId);
        if (person && person.name) return person.name;
      }
      if (entry.submitterDisplay) {
        const lower = entry.submitterDisplay.toLowerCase();
        if (lower !== 'agent' && lower !== 'user' && lower !== 'system') {
          return entry.submitterDisplay;
        }
      }
      return entry.submitterDisplay || '';
    };

    const buildDiscussionListMarkup = (entries) => {
      if (!Array.isArray(entries) || !entries.length) {
        return '<div class="smax-discussions-placeholder">Nenhuma discussão registrada neste chamado.</div>';
      }
      return entries.map((entry) => {
        const title = Utils.escapeHtml(entry.purposeLabel || 'Discussão');
        const privacy = Utils.escapeHtml(entry.privacyCode || '');
        const privacyLabel = Utils.escapeHtml(entry.privacyLabel || 'Interno');
        const bodyHtml = Utils.linkifyCNJ(entry.bodyHtml) || '<div style="color:#94a3b8;">(Sem conteúdo)</div>';
        const timestamp = Utils.formatBrDate(entry.createdTs, entry.createdRaw, DISCUSSION_DATE_OPTIONS, 'Data desconhecida');
        const name = resolveSubmitterName(entry);
        const authorName = name ? String(name) : (entry.submitterDisplay ? String(entry.submitterDisplay) : 'Registro manual');
        const author = entry.systemGenerated
          ? 'GERADO AUTOMATICAMENTE'
          : Utils.escapeHtml(authorName).toUpperCase();
        return `
          <article class="smax-discussion-card" data-privacy="${privacy}">
            <div class="smax-discussion-heading">
              <span class="smax-discussion-title">${title}</span>
              <span class="smax-discussion-privacy">${privacyLabel}</span>
            </div>
            <div class="smax-discussion-body">${bodyHtml}</div>
            <div class="smax-discussion-meta">${author} | ${timestamp}</div>
          </article>
        `;
      }).join('');
    };

    const populateTeamsDropdown = (selectedTeamId = '') => {
      if (!backdrop) return;
      const display = backdrop.querySelector('#smax-triage-team-display');
      const label = backdrop.querySelector('#smax-triage-team-label');
      const optionsEl = backdrop.querySelector('#smax-triage-team-options');
      const wrapper = backdrop.querySelector('#smax-triage-team-wrapper');
      if (!optionsEl) return;

      const teams = TeamsConfig.getTeams();
      let html = '';
      let selName = '(Sem nome)';
      teams.forEach(t => {
        const isSel = String(t.id) === String(selectedTeamId);
        const displayName = t.name || t.id || '(Sem nome)';
        if (isSel) selName = displayName;
        html += `<div class="smax-custom-dropdown-item" data-value="${Utils.escapeHtml(t.id)}" data-label="${Utils.escapeHtml(displayName)}" data-selected="${isSel ? 'true' : 'false'}">${Utils.escapeHtml(displayName)}</div>`;
      });
      optionsEl.innerHTML = html;
      display.disabled = false;
      if (label) label.textContent = selName;
      if (wrapper) wrapper.dataset.value = selectedTeamId;
      stagedState.selectedTeamId = selectedTeamId;
    };

    const populateWorkerDropdown = (teamId, selectedWorkerName = '') => {
      if (!backdrop) return;
      const display = backdrop.querySelector('#smax-triage-worker-display');
      const label = backdrop.querySelector('#smax-triage-worker-label');
      const optionsEl = backdrop.querySelector('#smax-triage-worker-options');
      const wrapper = backdrop.querySelector('#smax-triage-worker-wrapper');
      if (!optionsEl) return;

      const workers = TeamsConfig.getWorkersForTeam(teamId);
      if (!workers || !workers.length) {
        optionsEl.innerHTML = '<div class="smax-custom-dropdown-item" data-value="">(Sem atendentes)</div>';
        display.disabled = true;
        if (label) label.textContent = '(Sem atendentes)';
        stagedState.selectedWorkerId = '';
        if (wrapper) wrapper.dataset.value = '';
        return;
      }

      let html = '';
      let selName = selectedWorkerName || '(Sem atribuição)';
      workers.forEach(w => {
        const isSel = w.name === selectedWorkerName;
        if (isSel) selName = w.name;
        const rangeLabel = w.ranges ? ` <span style="color:#94a3b8;font-size:10px;">(${Utils.escapeHtml(w.ranges)})</span>` : '';
        html += `<div class="smax-custom-dropdown-item" data-value="${Utils.escapeHtml(w.name)}" data-label="${Utils.escapeHtml(w.name)}" data-selected="${isSel ? 'true' : 'false'}">
                   <span>${Utils.escapeHtml(w.name)}</span>${rangeLabel}
                 </div>`;
      });
      optionsEl.innerHTML = html;
      display.disabled = false;
      if (label) label.textContent = selName;
      if (wrapper) wrapper.dataset.value = selectedWorkerName;
      stagedState.selectedWorkerId = selectedWorkerName;
    };

    const render = (force = false) => {
      if (!backdrop) return;
      closeGseDropdown();

      const item = currentItem();
      const nextId = item ? item.idText : null;
      if (!force && activeTicketId && activeTicketId === nextId) {
        setBaselineStatus();
        return;
      }

      const ticketDetailsEl = backdrop.querySelector('#smax-triage-ticket-details');
      const discussionsEl = backdrop.querySelector('#smax-triage-discussions');
      const statusEl = backdrop.querySelector('#smax-triage-status');
      const prevBtn = backdrop.querySelector('#smax-triage-prev');
      const nextBtn = backdrop.querySelector('#smax-triage-next');
      const commitBtn = backdrop.querySelector('#smax-triage-commit');
      const inputGlobal = backdrop.querySelector('#smax-triage-global-id');
      const globalHint = backdrop.querySelector('#smax-triage-global-hint');
      const urgencyButtons = {
        low: backdrop.querySelector('#smax-triage-urg-low'),
        med: backdrop.querySelector('#smax-triage-urg-med'),
        high: backdrop.querySelector('#smax-triage-urg-high'),
        crit: backdrop.querySelector('#smax-triage-urg-crit')
      };
      const assignPanel = backdrop.querySelector('#smax-triage-assign-panel');
      const assignValue = backdrop.querySelector('#smax-triage-assign-value');

      if (!triageQueue.length) {
        triageIndex = -1;
        if (ticketDetailsEl) ticketDetailsEl.innerHTML = '<div style="font-size:14px;color:#e5e7eb;">Nenhum chamado encontrado na lista atual. Verifique o campo "meus finais", logo acima.</div>';
        if (discussionsEl) discussionsEl.innerHTML = '<div class="smax-discussions-placeholder">Nenhuma discussão disponível.</div>';
        statusEl.textContent = personalFinalsSet.size
          ? 'Nenhum chamado corresponde aos finais configurados.'
          : 'Verifique se a visão contém ID, Descrição e Hora de Criação.';
        if (nextBtn) nextBtn.disabled = true;
        if (prevBtn) prevBtn.disabled = true;
        Object.values(urgencyButtons).forEach((btn) => { btn.disabled = true; btn.dataset.active = 'false'; });
        currentOwnerName = '';
        stagedState.assign = false;
        stagedState.parentId = '';
        stagedState.parentSelected = false;
        currentAssignmentGroupId = '';
        currentAssignmentGroupName = '';
        stageAssignmentGroup('', '');
        refreshGseSelect();
        if (assignPanel) {
          assignPanel.dataset.state = 'disabled';
          // Clear dropdowns
          const tSelect = backdrop.querySelector('#smax-triage-team-options');
          const tDisplay = backdrop.querySelector('#smax-triage-team-display');
          const wSelect = backdrop.querySelector('#smax-triage-worker-options');
          const wDisplay = backdrop.querySelector('#smax-triage-worker-display');
          if (tSelect) { tSelect.innerHTML = ''; tDisplay.disabled = true; backdrop.querySelector('#smax-triage-team-label').textContent = 'Equipe...'; }
          if (wSelect) { wSelect.innerHTML = ''; wDisplay.disabled = true; backdrop.querySelector('#smax-triage-worker-label').textContent = 'Atendente...'; }
        }
        if (inputGlobal) inputGlobal.value = '';
        if (inputGlobal) inputGlobal.dataset.state = 'inactive';
        if (globalHint) {
          globalHint.dataset.state = 'inactive';
          globalHint.textContent = 'Sem vínculo global';
        }
        commitBtn.disabled = true;
        activeTicketId = null;
        clearQuickReplyState();
        updateAttachmentPanel({ state: 'empty', items: [] });
        const statusOptions = backdrop.querySelector('#smax-triage-status-options');
        const statusDisplay = backdrop.querySelector('#smax-triage-status-display');
        if (statusOptions) { statusOptions.innerHTML = ''; statusDisplay.disabled = true; statusDisplay.dataset.status = ''; backdrop.querySelector('#smax-triage-status-label').textContent = 'Carregando...'; }
        return;
      }

      if (nextBtn) nextBtn.disabled = false;
      if (prevBtn) prevBtn.disabled = false;
      activeTicketId = nextId;
      const pendingRequestId = activeTicketId;
      resetStaged();
      currentAssignmentGroupId = '';
      currentAssignmentGroupName = '';
      stageAssignmentGroup('', '');
      refreshGseSelect();
      if (inputGlobal) {
        inputGlobal.value = '';
        inputGlobal.dataset.state = 'inactive';
      }
      if (globalHint) {
        globalHint.dataset.state = 'inactive';
        globalHint.textContent = 'Sem vínculo global';
      }
      clearQuickReplyState();
      // (removed: "Carregando solução" message — redundant with real-time loading indicators)
      updateAttachmentPanel({ state: 'loading' });

      if (ticketDetailsEl) {
        ticketDetailsEl.innerHTML = `
          <div style="font-size:14px;color:#e5e7eb;">
            Carregando detalhes completos do chamado ${item.idText || '-'}...
          </div>
        `;
      }
      if (discussionsEl) {
        discussionsEl.innerHTML = '<div class="smax-discussions-placeholder">Carregando discussões deste chamado...</div>';
      }

      DataRepository.ensureRequestPayload(pendingRequestId, { force: true }).then((full) => {
        if (!pendingRequestId || activeTicketId !== pendingRequestId) return;
        if (!full) {
          if (ticketDetailsEl) {
            ticketDetailsEl.innerHTML = `
              <div style="font-size:14px;color:#fecaca;">
                Não foi possível carregar os detalhes completos deste chamado.
              </div>
            `;
          }
          if (discussionsEl) {
            discussionsEl.innerHTML = '<div class="smax-discussions-placeholder">Não consegui carregar as discussões deste chamado.</div>';
          }
          setStatus('Não consegui carregar a solução deste chamado.', 4000);
          updateAttachmentPanel({ state: 'error' });
          return;
        }
        const missing = [];
        if (!full.idText) missing.push('ID');
        if (!full.descriptionText && !full.subjectText) missing.push('Descrição');
        if (!full.createdText) missing.push('Hora de Criação');
        currentAssignmentGroupId = full.assignmentGroupId || '';
        currentAssignmentGroupName = full.assignmentGroupName || '';
        stageAssignmentGroup('', '');
        refreshGseSelect();
        const warning = missing.length
          ? `<div style="margin-bottom:6px;padding:6px 8px;border-radius:6px;background:#7f1d1d;color:#fee2e2;font-size:12px;">
               Aviso: faltam ${missing.join(', ')} na visão atual.
             </div>`
          : '';
        const vipBadge = full.isVip ? '<span style="margin-left:8px;padding:2px 6px;border-radius:999px;background:#facc15;color:#854d0e;font-size:11px;font-weight:700;">VIP</span>' : '';
        const requestedForHtml = full.requestedForName
          ? `<span style="color:#64748b;">→</span> ${Utils.escapeHtml(full.requestedForName)}`
          : '';
        // Process number (optional field) - link to eProc if CNJ format detected (formatado ou 20 dígitos brutos)
        const rawProcNum = (full.processNumber || '').trim();
        const isCNJFormatted = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(rawProcNum);
        const isCNJRaw = /^\d{20}$/.test(rawProcNum);
        const isCNJFormat = rawProcNum && (isCNJFormatted || isCNJRaw);
        const displayProcNum = isCNJFormat ? Utils.normalizeCNJ(rawProcNum) : rawProcNum;
        const processNumberHtml = rawProcNum
          ? `<span style="color:#64748b;">•</span> ${isCNJFormat
              ? `<span onclick="window._smaxOpenEproc('${displayProcNum}')" style="color:#38bdf8;font-family:monospace;font-weight:600;border-bottom:1px dotted rgba(56,189,248,.6);cursor:pointer;" title="Consultar processo no eProc: ${Utils.escapeHtml(displayProcNum)}">${Utils.escapeHtml(displayProcNum)}</span>`
              : `<span style="font-family:monospace;color:#a5b4fc;">${Utils.escapeHtml(rawProcNum)}</span>`
            }`
          : '';
        if (!ticketDetailsEl) return;
        const createdDisplay = Utils.formatBrDate(full.createdTs, full.createdText);
        const descHtml = Utils.linkifyCNJ(Utils.sanitizeRichText(full.descriptionHtml || full.descriptionText || full.subjectText || ''));
        const descDisplay = descHtml || `<span style="color:#64748b;">(Sem descrição disponível)</span>`;
        const idLink = full.idText
          ? `<a href="https://suporte.tjsp.jus.br/saw/Request/${encodeURIComponent(full.idText)}/general" target="_blank" rel="noreferrer noopener" style="color:#38bdf8;text-decoration:none;font-weight:600;">${full.idText}</a>`
          : '-';
        ticketDetailsEl.innerHTML = `
          ${warning}
          <div class="smax-triage-meta-row" style="flex-shrink:0;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:8px;">
            ${idLink}${vipBadge}
            <span style="color:#64748b;">${createdDisplay}</span>
            ${requestedForHtml}
            ${processNumberHtml}
          </div>
          <div class="smax-triage-desc-scroll" style="flex:1;overflow-y:auto;color:#e2e8f0;font-size:14px;line-height:1.55;">${descDisplay}</div>
        `;

        if (discussionsEl) {
          discussionsEl.innerHTML = buildDiscussionListMarkup(Array.isArray(full.discussions) ? full.discussions : []);
        }

        const solutionHtml = full.solutionHtml != null ? full.solutionHtml : '';
        syncQuickReplyBaseline(solutionHtml);
        if (solutionHtml) setStatus('Solução atual carregada deste chamado.', 2500);
        else setBaselineStatus();

        // Calculate and set suggestions
        const suggestedTeam = TeamsConfig.suggestTeam(full);
        const suggestedTeamId = suggestedTeam ? suggestedTeam.id : '';
        const suggestedWorker = TeamsConfig.suggestWorker(suggestedTeam, full.idText || full.Id);

        populateTeamsDropdown(suggestedTeamId);
        populateWorkerDropdown(suggestedTeamId, suggestedWorker ? suggestedWorker.name : '');

        // Update location display in header
        const locationDisplayEl = backdrop.querySelector('#smax-triage-location-display');
        if (locationDisplayEl) {
          const locationName = full.locationName || '';
          if (locationName) {
            locationDisplayEl.textContent = locationName;
            locationDisplayEl.title = `Local de divulgação: ${locationName}`;
            locationDisplayEl.dataset.empty = 'false';
          } else {
            locationDisplayEl.textContent = 'Sem local';
            locationDisplayEl.title = 'Local de divulgação não disponível';
            locationDisplayEl.dataset.empty = 'true';
          }
        }

        // Update status dropdown in header
        const statusWrapper = backdrop.querySelector('#smax-triage-status-wrapper');
        const statusDisplay = backdrop.querySelector('#smax-triage-status-display');
        const statusLabel = backdrop.querySelector('#smax-triage-status-label');
        const statusOptions = backdrop.querySelector('#smax-triage-status-options');
        if (statusOptions) {
          const rawStatus = full.status || '';
          currentTicketOriginalStatus = rawStatus;
          stagedState.stagedStatus = ''; // reset on ticket change

          let optionsHtml = '';
          const editableSet = new Set(EDITABLE_STATUSES);
          let selLabel = humanReadableStatus(rawStatus) + (editableSet.has(rawStatus) ? '' : ' (atual)');

          if (rawStatus && !editableSet.has(rawStatus)) {
            optionsHtml += `<div class="smax-custom-dropdown-item" data-value="${Utils.escapeHtml(rawStatus)}" data-label="${Utils.escapeHtml(selLabel)}" data-selected="true">${Utils.escapeHtml(selLabel)}</div>`;
          }
          EDITABLE_STATUSES.forEach(key => {
            const isCurrent = key === rawStatus;
            const hr = humanReadableStatus(key);
            optionsHtml += `<div class="smax-custom-dropdown-item" data-value="${Utils.escapeHtml(key)}" data-label="${Utils.escapeHtml(hr)}" data-selected="${isCurrent ? 'true' : 'false'}">${Utils.escapeHtml(hr)}</div>`;
            if (isCurrent) selLabel = hr;
          });
          statusOptions.innerHTML = optionsHtml;
          statusDisplay.disabled = false;
          statusDisplay.dataset.status = rawStatus;
          if (statusLabel) statusLabel.textContent = selLabel;
          if (statusWrapper) statusWrapper.dataset.value = rawStatus;
        }

        // Sync assignment source-of-truth
        currentOwnerName = suggestedWorker ? suggestedWorker.name : '';

        refreshButtons(); // Update stages based on new suggestions

        fetchAttachmentsForRequest(pendingRequestId);
      });

      Object.entries(urgencyButtons).forEach(([key, btn]) => {
        btn.disabled = false;
        btn.dataset.active = 'false';
        btn.onclick = () => toggleUrgency(key);
      });

      const owner = ownerForCurrent();
      currentOwnerName = owner || '';

      if (inputGlobal && !inputGlobal.dataset.wired) {
        inputGlobal.dataset.wired = '1';
        inputGlobal.addEventListener('input', () => {
          const cleaned = inputGlobal.value.replace(/\D/g, '');
          if (cleaned !== inputGlobal.value) inputGlobal.value = cleaned;
          stagedState.parentId = inputGlobal.value.trim();
          if (!stagedState.parentId) stagedState.parentSelected = false;
          refreshButtons();
          setBaselineStatus();
        });
      }

      // Native change listeners removed, event logic delegated to backdrop click

      refreshButtons();
      setBaselineStatus();
      ensureQuickReplyEditor();
    };

    const updateAutoStages = (quickReplyDirty) => {
      if (!backdrop) return;
      const assignPanel = backdrop.querySelector('#smax-triage-assign-panel');
      const assignValue = backdrop.querySelector('#smax-triage-assign-value');

      // Check if global parent is set — if so, ticket goes to triador, not digits-owner
      const parentId = (stagedState.parentId || '').trim();
      stagedState.parentId = parentId;
      const hasParent = !!parentId;
      stagedState.parentSelected = hasParent;

      // Global or not, the owner is always the one chosen in the HUD dropdown
      const effectiveOwner = currentOwnerName || ownerForCurrent();
      const ownerFirst = effectiveOwner ? (effectiveOwner.trim().split(/\s+/)[0] || effectiveOwner) : '';
      const effectiveDisplayName = ownerFirst || effectiveOwner || 'o dono configurado';

      const hasOwner = !!effectiveOwner;
      const urgencySet = !!stagedState.urgency;
      const resolvedPersonId = hasOwner ? resolvePersonIdByName(effectiveOwner) : '';
      if (hasOwner) {
        console.debug('[SMAX][Triagem] Owner mapping check', {
          owner: effectiveOwner,
          isGlobal: hasParent,
          resolvedPersonId,
          peopleCacheSize: DataRepository.peopleCache.size
        });
      }
      stagedState.assignPersonId = resolvedPersonId;
      const hasPerson = !!resolvedPersonId;
      const readyForOwner = hasOwner && hasPerson && urgencySet && !quickReplyDirty;
      stagedState.assign = readyForOwner;

      // Update worker select staging visual
      const workerDisplay = backdrop.querySelector('#smax-triage-worker-display');
      if (workerDisplay) {
        workerDisplay.dataset.staged = readyForOwner ? 'true' : (hasOwner ? 'false' : '');
      }

      if (assignPanel && assignValue) {
        assignPanel.title = hasOwner ? `Atribuir para ${effectiveOwner}` : 'Sem dono configurado';
        if (!hasOwner) {
          assignPanel.dataset.state = 'disabled';
          assignValue.textContent = 'Sem dono configurado';
        } else if (!hasPerson) {
          assignPanel.dataset.state = 'pending';
          assignValue.textContent = 'Carregando cadastro do dono...';
        } else if (quickReplyDirty) {
          assignPanel.dataset.state = 'pending';
          assignValue.textContent = 'Resposta em edição — aguardando envio';
        } else if (!urgencySet) {
          assignPanel.dataset.state = 'pending';
          assignValue.textContent = `Defina a urgência para ${effectiveDisplayName}`;
        } else {
          assignPanel.dataset.state = 'staged';
          assignValue.textContent = hasParent
            ? `Global → atribuindo a ${effectiveDisplayName}`
            : `Pronto para ${effectiveDisplayName}`;
        }
      }

      const globalInput = backdrop.querySelector('#smax-triage-global-id');
      const globalHint = backdrop.querySelector('#smax-triage-global-hint');
      if (globalInput) globalInput.dataset.state = hasParent ? 'staged' : 'inactive';
      if (globalHint) {
        if (hasParent) {
          globalHint.dataset.state = 'staged';
          globalHint.textContent = `Vinculando ao #${parentId}`;
        } else {
          globalHint.dataset.state = 'inactive';
          globalHint.textContent = 'Sem vínculo global';
        }
      }
    };

    const refreshButtons = () => {
      if (!backdrop) return;
      const quickReplyDirty = hasUnsavedSolution();
      const urgencyButtons = {
        low: backdrop.querySelector('#smax-triage-urg-low'),
        med: backdrop.querySelector('#smax-triage-urg-med'),
        high: backdrop.querySelector('#smax-triage-urg-high'),
        crit: backdrop.querySelector('#smax-triage-urg-crit')
      };
      Object.entries(urgencyButtons).forEach(([key, btn]) => {
        if (btn) btn.dataset.active = stagedState.urgency === key ? 'true' : 'false';
      });

      updateAutoStages(quickReplyDirty);

      const commitBtn = backdrop.querySelector('#smax-triage-commit');
      if (commitBtn) {
        commitBtn.disabled = !anyStaged();
        // Determine the effective status (user-selected or ticket's current)
        const effectiveStatus = stagedState.stagedStatus || currentTicketOriginalStatus;
        const isNormalEnvio = effectiveStatus === 'RequestStatusInProgress' || effectiveStatus === 'RequestStatusReady';
        commitBtn.textContent = isNormalEnvio ? 'ENVIAR' : 'ENVIAR (Checar status)';
        commitBtn.dataset.suspended = isNormalEnvio ? 'false' : 'true';
      }
    };

    const setBaselineStatus = () => {
      if (!backdrop) return;
      if (statusLockedUntil && Date.now() < statusLockedUntil) return;
      const statusEl = backdrop.querySelector('#smax-triage-status');
      if (!statusEl) return;
      if (!triageQueue.length) {
        statusEl.textContent = 'Nenhum chamado na fila de triagem.';
        return;
      }
      const total = triageQueue.length;
      const position = Math.min(Math.max(triageIndex, 0) + 1, total);
      const stagedBits = [];
      if (stagedState.urgency) stagedBits.push('urgência');
      if (stagedState.assign) stagedBits.push('atribuir');
      if (stagedState.parentSelected && stagedState.parentId) stagedBits.push('global');
      if (stagedState.assignmentGroupSelected) stagedBits.push('GSE');
      if (stagedState.stagedStatus) stagedBits.push('status');
      if (hasUnsavedSolution()) stagedBits.push('resposta');
      const pending = stagedBits.length ? ` Pendências: ${stagedBits.join(', ')}.` : '';
      statusEl.textContent = `${position} de ${total}.${pending}`;
    };

    const toggleUrgency = (level) => {
      stagedState.urgency = stagedState.urgency === level ? null : level;
      refreshButtons();
      setBaselineStatus();
    };

    const commit = () => {
      const item = currentItem();
      if (!item) return;
      const props = { Id: String(item.idText) };
      if (stagedState.urgency) Object.assign(props, urgencyMap[stagedState.urgency]);
      const solutionHtml = hasUnsavedSolution() ? readQuickReplyHtml() : '';
      if (solutionHtml) {
        props.Solution = solutionHtml;
        props.CompletionCode = quickReplyCompletionCode;
      }
      const usedScriptCheckbox = backdrop.querySelector('#smax-triage-used-script');
      const usedScript = usedScriptCheckbox ? !!usedScriptCheckbox.checked : false;

      let expertAssigneeId = '';
      // Only set ExpertAssignee if we are explicitly assigning (stagedState.assign equal true)
      if (stagedState.assign && stagedState.assignPersonId) {
        expertAssigneeId = String(stagedState.assignPersonId);
      } else if (stagedState.assign && !stagedState.assignPersonId) {
        console.warn('[SMAX][Triagem] Assignment requested but no person ID resolved for owner.');
      }

      if (expertAssigneeId) {
        props.ExpertAssignee = expertAssigneeId;
      }
      if (stagedState.assignmentGroupSelected && stagedState.assignmentGroupId) {
        props.ExpertGroup = stagedState.assignmentGroupId;
      }
      if (stagedState.stagedStatus) {
        props.Status = stagedState.stagedStatus;
      }

      const doGlobal = stagedState.parentSelected && stagedState.parentId;
      if (!stagedState.urgency && !props.ExpertAssignee && !doGlobal && !props.Solution && !props.ExpertGroup && !props.Status) {
        setStatus('Nada para gravar.', 2500);
        return;
      }

      if (!prefs.enableRealWrites) {
        setStatus('Modo simulação ativo (Verifique Settings). Mudanças não foram gravadas.', 2500);
        advanceQueue();
        return;
      }

      setStatus('Gravando alterações...');
      const tasks = [];
      if (stagedState.urgency || props.ExpertAssignee || props.Solution || props.ExpertGroup || props.Status) tasks.push(Api.postUpdateRequest(props));
      if (doGlobal) {
        // When linking to a Global, assign the ticket to the owner chosen in the HUD (dono dos finais)
        const ownerId = stagedState.assignPersonId;

        if (!ownerId) {
          setStatus('⚠️ Dono não encontrado! Verifique a configuração de equipes.', 4000);
          return;
        }

        tasks.push(
          Api.postCreateRequestCausesRequest(stagedState.parentId, props.Id).then((relRes) => {
            if (!(relRes && relRes.meta && relRes.meta.completion_status === 'OK')) return relRes;
            // First update: set PhaseId, Status, AND assign to the chosen owner
            return Api.postUpdateRequest({
              Id: props.Id,
              PhaseId: 'Escalate',
              Status: 'RequestStatusSuspended',
              ExpertAssignee: ownerId  // Assign to dono dos finais
            }).then((firstUpdateRes) => {
              // Wait a couple seconds for server routine to complete, then set StatusSCCDSMAX_c
              // This prevents the server from overwriting it back to match the parent's status
              return new Promise((resolve) => {
                setTimeout(() => {
                  Api.postUpdateRequest({
                    Id: props.Id,
                    StatusSCCDSMAX_c: 'AguardandoOutraEquipe_c'
                  }).then(resolve).catch(() => resolve(firstUpdateRes));
                }, 2000); // 2 second delay to let server routine complete
              });
            });
          })
        );
      }
      Promise.all(tasks).then((results) => {
        const outcomes = results.map((payload, idx) => Api.summarizeBulkOutcome(payload, idx));
        const firstFailure = outcomes.find((entry) => !entry.ok);
        if (!firstFailure && props.Solution) {
          syncQuickReplyBaseline(props.Solution);
          if (DataRepository.updateCachedSolution) DataRepository.updateCachedSolution(props.Id, props.Solution);
        }
        if (firstFailure) {
          const detailMessage = firstFailure.messages && firstFailure.messages.length
            ? firstFailure.messages[0]
            : 'SMAX recusou a gravação.';
          console.warn('[SMAX] Falha ao gravar alterações:', { results, outcomes });
          setStatus(`SMAX recusou a gravação: ${detailMessage}`, 4000);
          // Log failed activity
          // Derive assignedTo: if answering, always prioritize myPersonName
          const logAssignedToFailed = props.Solution
            ? (prefs.myPersonName || '')
            : (props.ExpertAssignee ? (currentOwnerName || prefs.myPersonName || '') : '');
          ActivityLog.log({
            ticketId: props.Id,
            assigned: !!props.ExpertAssignee,
            assignedTo: logAssignedToFailed,
            globalAssigned: !!doGlobal,
            globalChangeId: doGlobal ? stagedState.parentId : '',
            transferred: !!(stagedState.assignmentGroupSelected && stagedState.assignmentGroupId && stagedState.assignmentGroupId !== currentAssignmentGroupId),
            transferredTo: (stagedState.assignmentGroupSelected && stagedState.assignmentGroupId !== currentAssignmentGroupId) ? stagedState.assignmentGroupName : '',
            answered: !!props.Solution,
            usedScript: usedScript,
            success: false
          });
        } else {
          // Capture transfer info BEFORE updating currentAssignmentGroupId
          const originalGroupId = currentAssignmentGroupId;
          const wasTransferred = stagedState.assignmentGroupSelected && stagedState.assignmentGroupId && stagedState.assignmentGroupId !== originalGroupId;
          const transferTargetName = wasTransferred ? stagedState.assignmentGroupName : '';

          if (props.ExpertGroup && stagedState.assignmentGroupSelected) {
            currentAssignmentGroupId = stagedState.assignmentGroupId;
            currentAssignmentGroupName = stagedState.assignmentGroupName || currentAssignmentGroupName;
            stageAssignmentGroup('', '');
            refreshGseSelect();
          }
          // Log successful activity
          // Derive assignedTo: if answering, always prioritize myPersonName
          const logAssignedTo = props.Solution
            ? (prefs.myPersonName || '')
            : (props.ExpertAssignee ? (currentOwnerName || prefs.myPersonName || '') : '');
          ActivityLog.log({
            ticketId: props.Id,
            assigned: !!props.ExpertAssignee,
            assignedTo: logAssignedTo,
            globalAssigned: !!doGlobal,
            globalChangeId: doGlobal ? stagedState.parentId : '',
            transferred: wasTransferred,
            transferredTo: transferTargetName,
            answered: !!props.Solution,
            usedScript: usedScript,
            success: true
          });
          setStatus('Alterações gravadas com sucesso.', 2000);
          advanceQueue();
        }
      }).catch((err) => {
        console.warn('[SMAX] Erro inesperado durante gravação:', err);
        setStatus('Erro ao gravar alterações.', 4000);
      });
    };

    let statusTimer = null;
    let statusLockedUntil = 0;
    const setStatus = (msg, duration = 2000) => {
      if (!backdrop) return;
      const statusEl = backdrop.querySelector('#smax-triage-status');
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusLockedUntil = Date.now() + duration;
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        statusTimer = null;
        statusLockedUntil = 0;
        setBaselineStatus();
      }, duration);
    };

    const syncQueueFromApi = ({ force = false, announce = false } = {}) => {
      if (queueSyncPromise && !force) return queueSyncPromise;
      if (announce && backdrop && backdrop.style.display === 'flex') setStatus('Sincronizando fila com SMAX...', 4000);
      queueSyncPromise = DataRepository.refreshQueueFromApi()
        .catch((err) => {
          console.warn('[SMAX] Falha ao sincronizar fila via API:', err);
          // Only show error if queue is actually empty — grid intercepts may have already populated it
          if (announce && backdrop && backdrop.style.display === 'flex' && !triageQueue.length) {
            setStatus('Não foi possível atualizar a fila via API.', 4000);
          }
          return null;
        })
        .finally(() => {
          queueSyncPromise = null;
          if (backdrop && backdrop.style.display === 'flex') rebuildQueueForPersonalFinals();
        });
      return queueSyncPromise;
    };

    const navigateQueue = (delta) => {
      if (hasUnsavedSolution()) {
        const discard = window.confirm('A resposta atual não foi salva. Deseja descartá-la antes de continuar?');
        if (!discard) {
          setStatus('Navegação cancelada para preservar a resposta não salva.', 3500);
          return;
        }
        clearQuickReplyState();
        setStatus('Resposta descartada. Carregando outro chamado...', 3000);
      }
      if (!triageQueue.length) {
        render();
        return;
      }

      const currentId = currentItem()?.idText || null;

      if (GridTracker.consume()) {
        const { list: rebuilt } = buildQueue();
        if (rebuilt.length) {
          triageQueue = rebuilt;
          if (currentId) {
            const nextIndex = rebuilt.findIndex((entry) => entry.idText === currentId);
            if (nextIndex >= 0) triageIndex = (nextIndex + delta + rebuilt.length) % rebuilt.length;
            else triageIndex = delta > 0 ? 0 : rebuilt.length - 1;
          } else {
            triageIndex = delta > 0 ? 0 : rebuilt.length - 1;
          }
        } else {
          triageQueue = rebuilt;
          triageIndex = -1;
        }
      } else if (triageQueue.length) {
        const length = triageQueue.length;
        triageIndex = (triageIndex + delta + length) % length;
      }

      render();
    };

    const advanceQueue = () => navigateQueue(1);
    const retreatQueue = () => navigateQueue(-1);

    const updateStartBtnText = () => {
      if (!startBtn) return;
      if (activeTicketId) {
        startBtn.textContent = 'Restaurar triagem';
        startBtn.style.background = '#0ea5e9';
        startBtn.style.border = '1px solid #38bdf8';
        startBtn.style.boxShadow = '0 0 12px rgba(14,165,233,.5)';
      } else {
        startBtn.textContent = 'Iniciar triagem';
        startBtn.style.background = '';
        startBtn.style.border = '';
        startBtn.style.boxShadow = '';
      }
    };

    const openHud = () => {
      DataRepository.ensurePeopleLoaded();
      ensureSupportGroupsReady();
      if (startBtn) startBtn.style.display = 'none';
      backdrop.style.display = 'flex';
      const finalsInput = backdrop.querySelector('#smax-personal-finals-input');
      if (finalsInput) finalsInput.value = prefs.personalFinalsRaw || '';
      syncQueueFromApi({ force: true, announce: true }).catch(() => { });
      const { list, selectedId } = buildQueue();
      triageQueue = list;

      if (!triageQueue.length) {
        triageIndex = -1;
      } else if (activeTicketId) {
        const focusIdx = triageQueue.findIndex((entry) => entry.idText === activeTicketId);
        triageIndex = focusIdx >= 0 ? focusIdx : 0;
      } else if (selectedId) {
        const focusIdx = triageQueue.findIndex((entry) => entry.idText === selectedId);
        triageIndex = focusIdx >= 0 ? focusIdx : 0;
      } else {
        triageIndex = 0;
      }

      render();
      const realFlag = backdrop.querySelector('#smax-triage-real-flag');
      if (realFlag) realFlag.style.display = prefs.enableRealWrites ? 'block' : 'none';
    };

    const closeHud = () => {
      backdrop.style.display = 'none';
      if (startBtn) {
        startBtn.style.display = 'block';
        updateStartBtnText();
      }
      closeGseDropdown();
    };

    const init = () => {
      if (startBtn) return;
      hookNativeEditors();
      startBtn = document.createElement('button');
      startBtn.id = 'smax-triage-start-btn';
      startBtn.textContent = 'Iniciar triagem';
      document.body.appendChild(startBtn);

      backdrop = document.createElement('div');
      backdrop.id = 'smax-triage-hud-backdrop';
      backdrop.innerHTML = `
        <div id="smax-triage-hud">
          <aside id="smax-triage-discussions">
            <div class="smax-discussions-placeholder">Inicie a triagem para carregar as discussões deste chamado.</div>
          </aside>
          <div id="smax-triage-hud-main">
            <div id="smax-triage-hud-header">
              <div class="smax-triage-title-bar">
                <label id="smax-personal-finals-label" title="Limite os chamados pelos seus dígitos finais">
                  <input type="text" id="smax-personal-finals-input" placeholder="Finais (0-32)" inputmode="numeric" autocomplete="off" />
                </label>
                <div id="smax-triage-gse-wrapper" data-state="loading" data-open="false" title="Grupo de suporte">
                  <button type="button" id="smax-triage-gse-display" disabled>
                    <span id="smax-triage-gse-display-label">Carregando GSEs...</span>
                    <span class="smax-triage-gse-chevron">▾</span>
                  </button>
                  <div id="smax-triage-gse-dropdown" role="listbox" data-empty="true">
                    <input type="text" id="smax-triage-gse-filter" placeholder="Filtrar GSE..." autocomplete="off" />
                    <div class="smax-triage-gse-options" id="smax-triage-gse-options"></div>
                    <div id="smax-triage-gse-empty">Nenhum GSE disponível.</div>
                  </div>
                </div>
                <div id="smax-triage-location-display" data-empty="true" title="Local de divulgação">Sem local</div>
                <div id="smax-triage-status-wrapper" class="smax-custom-dropdown-wrapper" data-open="false">
                  <button type="button" id="smax-triage-status-display" class="smax-custom-dropdown-display smax-triage-status-dropdown" disabled>
                    <span id="smax-triage-status-label">Carregando...</span>
                    <span class="smax-custom-chevron">▾</span>
                  </button>
                  <div class="smax-custom-dropdown-menu">
                    <div class="smax-custom-dropdown-options" id="smax-triage-status-options"></div>
                  </div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="smax-triage-header-nav">
                  <button type="button" id="smax-triage-prev" disabled aria-label="Chamado anterior" title="Chamado anterior">&#x2039;</button>
                  <button type="button" id="smax-triage-next" disabled aria-label="Próximo chamado" title="Próximo chamado">&#x203A;</button>
                </span>
                <button type="button" class="smax-triage-secondary" id="smax-triage-refresh" title="Sincronizar fila">&#x21bb;</button>
                <button type="button" class="smax-triage-secondary" id="smax-triage-close" title="Minimizar triagem">_</button>
              </div>
            </div>
            <div id="smax-triage-hud-body">
              <div id="smax-triage-ticket-details">
                <div style="font-size:14px;color:#9ca3af;">Inicie a triagem para carregar um chamado.</div>
              </div>
            </div>
            <div id="smax-triage-hud-footer">
              <div class="smax-triage-top-row" style="flex-wrap:nowrap;gap:14px;align-items:center;">
                <div class="smax-triage-urg-group">
                  <button type="button" class="smax-triage-secondary smax-triage-chip smax-urg-low" id="smax-triage-urg-low" disabled>Baixa</button>
                  <button type="button" class="smax-triage-secondary smax-triage-chip smax-urg-med" id="smax-triage-urg-med" disabled>Média</button>
                  <button type="button" class="smax-triage-secondary smax-triage-chip smax-urg-high" id="smax-triage-urg-high" disabled>Alta</button>
                  <button type="button" class="smax-triage-secondary smax-triage-chip smax-urg-crit" id="smax-triage-urg-crit" disabled>Crítica</button>
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <div id="smax-triage-team-wrapper" class="smax-custom-dropdown-wrapper" data-open="false" style="min-width:100px;">
                    <button type="button" id="smax-triage-team-display" class="smax-custom-dropdown-display" disabled>
                      <span id="smax-triage-team-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Equipe...</span>
                      <span class="smax-custom-chevron">▾</span>
                    </button>
                    <div class="smax-custom-dropdown-menu">
                      <div class="smax-custom-dropdown-options" id="smax-triage-team-options"></div>
                    </div>
                  </div>
                  <div id="smax-triage-worker-wrapper" class="smax-custom-dropdown-wrapper" data-open="false" style="min-width:140px;">
                    <button type="button" id="smax-triage-worker-display" class="smax-custom-dropdown-display" disabled>
                      <span id="smax-triage-worker-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Atendente...</span>
                      <span class="smax-custom-chevron">▾</span>
                    </button>
                    <div class="smax-custom-dropdown-menu">
                      <div class="smax-custom-dropdown-options" id="smax-triage-worker-options"></div>
                    </div>
                  </div>
                </div>
                <input type="text" class="smax-global-input" id="smax-triage-global-id" placeholder="Global ID" inputmode="numeric" autocomplete="off" style="width:100px;" />
                <div style="display:none;" id="smax-triage-real-flag"></div>
                <div style="display:none;"><input type="checkbox" id="smax-triage-used-script"></div>
                <span class="smax-indicator-value" id="smax-triage-assign-value" style="display:none;">Sem dono configurado</span>
                <div id="smax-triage-assign-panel" data-state="disabled" style="display:none;"></div>
                <div class="smax-global-hint" id="smax-triage-global-hint" style="display:none;"></div>
                <button type="button" class="smax-triage-primary smax-triage-chip" id="smax-triage-commit" disabled>ENVIAR</button>
              </div>
              <div id="smax-triage-quickreply-card" data-staged="false">
                <textarea id="smax-triage-quickreply-editor" placeholder="Digite aqui sua resposta..."></textarea>
              </div>
              <div id="smax-triage-status-row" data-empty="true">
                <div id="smax-triage-status">Fila de triagem ainda não inicializada.</div>
                <div id="smax-triage-attachment-list" data-state="empty">Sem anexos.</div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);

      startBtn.addEventListener('click', openHud);
      backdrop.querySelector('#smax-triage-close').addEventListener('click', closeHud);
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) {
          closeHud();
          return;
        }

        const display = event.target.closest('.smax-custom-dropdown-display');
        if (display && !display.disabled) {
          const wrapper = display.closest('.smax-custom-dropdown-wrapper');
          const isOpen = wrapper.dataset.open === 'true';
          document.querySelectorAll('.smax-custom-dropdown-wrapper, #smax-triage-gse-wrapper').forEach(w => w.dataset.open = 'false');
          if (!isOpen) wrapper.dataset.open = 'true';
          return;
        }

        const item = event.target.closest('.smax-custom-dropdown-item');
        if (item) {
          const wrapper = item.closest('.smax-custom-dropdown-wrapper');
          wrapper.dataset.open = 'false';
          if (wrapper.id === 'smax-triage-team-wrapper') {
            stagedState.selectedTeamId = item.dataset.value;
            const tick = currentItem();
            const newTeam = TeamsConfig.getTeamById(stagedState.selectedTeamId);
            const suggInfo = TeamsConfig.suggestWorker(newTeam, tick ? (tick.idText || tick.idNum) : '');
            const newWorkerName = suggInfo ? suggInfo.name : '';
            populateTeamsDropdown(stagedState.selectedTeamId);
            populateWorkerDropdown(stagedState.selectedTeamId, newWorkerName);
            currentOwnerName = newWorkerName;
            stagedState.selectedWorkerId = newWorkerName;
            refreshButtons();
            setBaselineStatus();
          } else if (wrapper.id === 'smax-triage-worker-wrapper') {
            stagedState.selectedWorkerId = item.dataset.value;
            currentOwnerName = item.dataset.value;
            populateWorkerDropdown(stagedState.selectedTeamId, stagedState.selectedWorkerId);
            refreshButtons();
            setBaselineStatus();
          } else if (wrapper.id === 'smax-triage-status-wrapper') {
            const val = item.dataset.value;
            stagedState.stagedStatus = (val !== currentTicketOriginalStatus) ? val : '';
            wrapper.querySelector('.smax-custom-dropdown-display').dataset.status = val;
            wrapper.querySelector('#smax-triage-status-label').textContent = item.dataset.label;
            wrapper.querySelectorAll('.smax-custom-dropdown-item').forEach(opt => opt.dataset.selected = opt === item ? 'true' : 'false');
            refreshButtons();
            setBaselineStatus();
          }
          return;
        }

        if (!event.target.closest('.smax-custom-dropdown-wrapper') && !event.target.closest('#smax-triage-gse-wrapper')) {
          document.querySelectorAll('.smax-custom-dropdown-wrapper, #smax-triage-gse-wrapper').forEach(w => w.dataset.open = 'false');
          if (typeof closeGseDropdown === 'function') closeGseDropdown();
        }
      });
      const prevBtn = backdrop.querySelector('#smax-triage-prev');
      if (prevBtn) prevBtn.addEventListener('click', () => retreatQueue());
      backdrop.querySelector('#smax-triage-next').addEventListener('click', () => advanceQueue());
      const refreshBtn = backdrop.querySelector('#smax-triage-refresh');
      if (refreshBtn) refreshBtn.addEventListener('click', () => syncQueueFromApi({ force: true, announce: true }));
      backdrop.querySelector('#smax-triage-commit').addEventListener('click', () => commit());
      const quickTextarea = backdrop.querySelector('#smax-triage-quickreply-editor');
      if (quickTextarea) quickTextarea.addEventListener('input', () => {
        if (!quickReplyEditor) handleQuickReplyChange(quickTextarea.value);
      });
      const attachmentListEl = backdrop.querySelector('#smax-triage-attachment-list');
      if (attachmentListEl) {
        attachmentListEl.addEventListener('click', (evt) => {
          const chip = evt.target.closest('.smax-attachment-chip');
          if (!chip) return;
          const attachment = currentAttachmentList.find((item) => item.id === chip.dataset.attachmentId);
          if (!attachment) return;
          AttachmentService.preview(attachment);
        });
      }
      const gseDisplay = backdrop.querySelector('#smax-triage-gse-display');
      if (gseDisplay) {
        gseDisplay.addEventListener('click', () => {
          if (gseDisplay.disabled) return;
          toggleGseDropdown();
        });
      }
      const gseDropdown = backdrop.querySelector('#smax-triage-gse-dropdown');
      if (gseDropdown) {
        gseDropdown.addEventListener('click', handleGseOptionClick);
        gseDropdown.addEventListener('keydown', handleGseDropdownKeydown);
      }
      const gseFilter = backdrop.querySelector('#smax-triage-gse-filter');
      if (gseFilter) {
        gseFilter.value = supportGroupFilter;
        gseFilter.addEventListener('input', handleGseFilterInput);
        gseFilter.addEventListener('focus', ensureSupportGroupsReady);
      }
      refreshGseSelect();
      ensureSupportGroupsReady();
      const finalsInput = backdrop.querySelector('#smax-personal-finals-input');
      if (finalsInput) {
        finalsInput.value = prefs.personalFinalsRaw || '';
        finalsInput.addEventListener('input', () => {
          const cleaned = finalsInput.value.replace(/[^0-9,\-\s]/g, '');
          if (cleaned !== finalsInput.value) finalsInput.value = cleaned;
          prefs.personalFinalsRaw = cleaned.trim();
          refreshPersonalFinalsSet();
          savePrefs();
          rebuildQueueForPersonalFinals();
        });
      }
      rebuildQueueForPersonalFinals();


      // NOTE: team/worker select event handlers are wired inside render() with dataset.wired guards


      scheduleQuickReplyEditor();
    };

    DataRepository.onQueueUpdate(() => {
      if (!backdrop || backdrop.style.display !== 'flex') return;
      rebuildQueueForPersonalFinals();
    });

    return { init };
  })();

  /* =========================================================
   * Boot
   * =======================================================*/
  const boot = () => {
    CommentExpander.init();
    SectionTweaks.init();
    Orchestrator.init();
    SettingsPanel.init();
    GridTracker.init();
    TriageHUD.init();
    SkullFlag.init();
    DataRepository.refreshQueueFromApi().catch(() => { });
    DataRepository.ensureSupportGroups().catch(() => { });
  };

  Utils.onDomReady(boot);
})();
