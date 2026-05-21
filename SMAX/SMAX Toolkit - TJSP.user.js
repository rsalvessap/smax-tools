// ==UserScript==
// @name         SMAX Toolkit - TJSP
// @namespace    https://github.com/rsalvessap/SMAX-TOOLS
// @version      1.92
// @description  Conjunto de ferramentas para o SMAX TJSP: triagem, scripts de respostas, radar, Zen Mode e consulta de processos no eProc
// @author       rsalvessap
// @match        https://suporte.tjsp.jus.br/saw/*
// @match        https://eproc1g.tjsp.jus.br/eproc/controlador.php*
// @match        https://davidpestilli.github.io/gerenciador-chamados/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @downloadURL  https://github.com/rsalvessap/SMAX-TOOLS/raw/refs/heads/master/SMAX/SMAX%20Toolkit%20-%20TJSP.user.js
// @updateURL    https://github.com/rsalvessap/SMAX-TOOLS/raw/refs/heads/master/SMAX/SMAX%20Toolkit%20-%20TJSP.user.js
// @homepageURL  https://github.com/rsalvessap/SMAX-TOOLS
// @supportURL   https://github.com/rsalvessap/SMAX-TOOLS/issues
// ==/UserScript==

(() => {
  'use strict';

  if (window.top && window.top !== window.self) return;

  /* ── Integração com o Gerenciador de Chamados ── */
  if (window.location.hostname === 'davidpestilli.github.io') {
    // Captura o equipeId assim que o localStorage estiver disponível
    const captureEquipeId = () => {
      const id = localStorage.getItem('equipeId');
      if (id) { GM_setValue('smax_gerenciador_equipe_id', id); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', captureEquipeId);
    else captureEquipeId();
    return; // Não executa o restante do toolkit nesta página
  }

  // Código SMAX roda apenas no domínio do SMAX
  if (window.location.hostname !== 'suporte.tjsp.jus.br') return;

  /* Supabase — Gerenciador de Chamados (chave pública exposta no bundle do app) */
  const SMAX_SB_URL = 'https://rlcbmrjkojopipiwpktf.supabase.co';
  const SMAX_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsY2Jtcmprb2pvcGlwaXdwa3RmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODczMjQxOSwiZXhwIjoyMDk0MzA4NDE5fQ.TBaNcvK1PShHyuWFRHQpBshZpX7TENOya8dO6SZDI6k';

  const SMAX_TOOLKIT_VERSION = '1.92';
  console.log('%c[SMAX Toolkit] v' + SMAX_TOOLKIT_VERSION + ' carregado', 'color:#60a5fa;font-weight:bold;font-size:13px;');

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
      zenModeOn: false,
      radarOn: true,
      nameGroups: {},
      ausentes: [],
      nameColors: {},
      enableRealWrites: true,
      defaultGlobalChangeId: '',
      personalFinalsRaw: '',
      myPersonId: '',
      myPersonName: '',
      sharedConfigUrl: 'https://raw.githubusercontent.com/rsalvessap/SMAX-TOOLS/master/shared-config.json',
      forwardingButtonsRaw: JSON.stringify([
        { label: 'STI \u2013 Migra\u00e7\u00e3o', text: 'Encaminhado para STI \u2013 Migra\u00e7\u00e3o.' },
        { label: 'N3',            text: 'Encaminhado para N3.' },
        { label: 'SPI',           text: 'Encaminhado para SPI.' },
        { label: 'Devolu\u00e7\u00e3o SAJ', text: 'Devolvido ao SAJ.' },
      ]),
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
   * PersonalStore — configurações pessoais (não compartilhadas)
   * Cada usuário tem seus próprios valores; não entra no export
   * de config da equipe (CONFIG_KEYS).
   * Inclui: cores por servidor, detratores, destaques (futuro).
   * =======================================================*/
  const PersonalStore = (() => {
    const STORAGE_KEY = 'smax_personal_prefs';
    const defaults = {
      myColors:    {},  // { "NOME NORMALIZADO": { bg: "#hex", fg: "#hex" } }
      myDestaque:  [],  // ["NOME NORMALIZADO", ...] — usuários em destaque (pessoal)
      themeMode:   'dark', // 'dark' | 'light'
    };

    const state = JSON.parse(JSON.stringify(defaults));

    const load = () => {
      try {
        const saved = GM_getValue(STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        // One-time migration from old key name
        if (Array.isArray(parsed.myDetratores) && !parsed.myDestaque) {
          parsed.myDestaque = parsed.myDetratores;
          delete parsed.myDetratores;
        }
        Object.assign(state, defaults, parsed || {});
      } catch (err) {
        console.warn('[SMAX] PersonalStore load error:', err);
      }
    };

    const save = () => {
      try { GM_setValue(STORAGE_KEY, JSON.stringify(state)); }
      catch (err) { console.error('[SMAX] PersonalStore save error:', err); }
    };

    load();
    return { state, save };
  })();

  const personal     = PersonalStore.state;
  const savePersonal = PersonalStore.save;

  /* =========================================================
   * ThemeManager — light / dark mode
   * =======================================================*/
  const ThemeManager = (() => {
    const apply = (mode) => {
      const m = (mode === 'light') ? 'light' : 'dark';
      document.documentElement.dataset.smaxTheme = m; // on <html> so vars cascade everywhere
      document.body.dataset.smaxTheme = m;
      personal.themeMode = m;
      savePersonal();
      // Update toggle button if visible
      const btn = document.getElementById('smax-theme-toggle-btn');
      if (btn) {
        btn.textContent = m === 'light' ? '🌙' : '☀️';
        btn.title = m === 'light' ? 'Mudar para modo escuro' : 'Mudar para modo claro';
      }
    };
    const toggle = () => apply(personal.themeMode === 'light' ? 'dark' : 'light');
    const init   = () => apply(personal.themeMode || 'dark');
    return { apply, toggle, init };
  })();

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

    // ── Supabase sync ──────────────────────────────────────────
    const SB_WRITE_HEADERS = {
      apikey:          SMAX_SB_KEY,
      Authorization:   `Bearer ${SMAX_SB_KEY}`,
      'Content-Type':  'application/json',
      'Accept-Profile':'public',
      'Prefer':        'return=minimal,resolution=ignore-duplicates',
    };
    const SB_READ_HEADERS = {
      apikey:          SMAX_SB_KEY,
      Authorization:   `Bearer ${SMAX_SB_KEY}`,
      'Accept-Profile':'public',
    };

    const syncToSupabase = (entry) => {
      try {
        const equipeId = GM_getValue('smax_gerenciador_equipe_id', null);
        const row = {
          ts:               entry.ts,
          ticket_id:        entry.ticketId,
          relevant_work:    entry.relevantWork  || null,
          answered:         !!entry.answered,
          assigned:         !!entry.assigned,
          assigned_to:      entry.assignedTo    || null,
          global_assigned:  !!entry.globalAssigned,
          global_change_id: entry.globalChangeId || null,
          transferred:      !!entry.transferred,
          transferred_to:   entry.transferredTo  || null,
          used_script:      !!entry.usedScript,
          user_name:        entry.user           || null,
          equipe_id:        equipeId             || null,
          success:          entry.success !== false,
        };
        fetch(`${SMAX_SB_URL}/rest/v1/smax_activity_log`, {
          method:  'POST',
          headers: SB_WRITE_HEADERS,
          body:    JSON.stringify(row),
        }).catch(e => console.warn('[SMAX] ActivityLog Supabase sync failed:', e));
      } catch (e) {
        console.warn('[SMAX] ActivityLog syncToSupabase error:', e);
      }
    };

    const fetchFromSupabase = async (fromTs, toTs) => {
      const equipeId = GM_getValue('smax_gerenciador_equipe_id', null);
      const eqFilter = equipeId ? `&equipe_id=eq.${encodeURIComponent(equipeId)}` : '';
      const url = `${SMAX_SB_URL}/rest/v1/smax_activity_log`
        + `?ts=gte.${fromTs}&ts=lte.${toTs}&order=ts.asc&limit=10000${eqFilter}`;
      const resp = await fetch(url, { headers: SB_READ_HEADERS });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return (data || []).map(r => ({
        ts:             r.ts,
        ticketId:       r.ticket_id,
        relevantWork:   r.relevant_work    || '',
        answered:       r.answered,
        assigned:       r.assigned,
        assignedTo:     r.assigned_to      || '',
        globalAssigned: r.global_assigned,
        globalChangeId: r.global_change_id || '',
        transferred:    r.transferred,
        transferredTo:  r.transferred_to   || '',
        usedScript:     r.used_script,
        user:           r.user_name        || '',
        success:        r.success,
      }));
    };
    // ──────────────────────────────────────────────────────────

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
      syncToSupabase(entry);
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

    // Retorna Map<ticketId, globalChangeId> com o vínculo global mais recente por chamado
    const getGlobalMap = () => {
      const map = new Map();
      for (const e of entries) {
        if (e.globalAssigned && e.globalChangeId && e.ticketId) {
          map.set(String(e.ticketId), String(e.globalChangeId));
        }
      }
      return map;
    };

    load();

    return { log, exportCsv, clear, getCount, getEntries, getGlobalMap, load, fetchFromSupabase };
  })();

  /* =========================================================
   * Styles
   * =======================================================*/
  GM_addStyle(`
    /* ── Theme variables ── */
    body[data-smax-theme="dark"] {
      --sp-bg: #12161e;
      --sp-surface: rgba(15,23,42,0.9);
      --sp-surface-2: rgba(2,6,23,0.9);
      --sp-text: #e5e7eb;
      --sp-text-muted: #94a3b8;
      --sp-text-dim: #64748b;
      --sp-border: rgba(255,255,255,.1);
      --sp-border-strong: rgba(255,255,255,.18);
      --sp-primary: #38bdf8;
      --sp-primary-bg: rgba(56,189,248,.1);
      --sp-primary-hover: rgba(56,189,248,.18);
      --sp-sidebar-bg: #0d1117;
      --sp-sidebar-text: #94a3b8;
      --sp-sidebar-active-bg: rgba(56,189,248,.12);
      --sp-sidebar-active-text: #38bdf8;
      --sp-input-bg: #1a2030;
      --sp-input-border: #566378;
      --sp-input-text: #edf0f4;
      --sp-shadow: 0 25px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.07) inset;
      --sp-card-bg: rgba(15,23,42,0.75);
      --sp-danger-bg: rgba(239,68,68,.12);
      --sp-danger-text: #fca5a5;
      --sp-danger-border: rgba(239,68,68,.3);
      --sp-success-bg: rgba(34,197,94,.12);
      --sp-success-text: #86efac;
    }
    body[data-smax-theme="light"] {
      --sp-bg: #f3f5f9;
      --sp-surface: #ffffff;
      --sp-surface-2: #f1f5f9;
      --sp-text: #0f172a;
      --sp-text-muted: #475569;
      --sp-text-dim: #94a3b8;
      --sp-border: rgba(0,0,0,.1);
      --sp-border-strong: rgba(0,0,0,.18);
      --sp-primary: #135bec;
      --sp-primary-bg: rgba(19,91,236,.08);
      --sp-primary-hover: rgba(19,91,236,.15);
      --sp-sidebar-bg: #e8ecf3;
      --sp-sidebar-text: #475569;
      --sp-sidebar-active-bg: rgba(19,91,236,.1);
      --sp-sidebar-active-text: #135bec;
      --sp-input-bg: #ffffff;
      --sp-input-border: #cbd5e1;
      --sp-input-text: #1e293b;
      --sp-shadow: 0 8px 40px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06) inset;
      --sp-card-bg: #ffffff;
      --sp-danger-bg: rgba(239,68,68,.06);
      --sp-danger-text: #dc2626;
      --sp-danger-border: rgba(239,68,68,.2);
      --sp-success-bg: rgba(34,197,94,.08);
      --sp-success-text: #16a34a;
    }

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

    /* ── Response HUD ── */
    #smax-resp-hud-backdrop { position:fixed; inset:0; padding:8px; background:linear-gradient(180deg,rgba(0,0,0,0.75) 0%,rgba(0,0,0,0.55) 100%); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); z-index:999997; display:none; align-items:center; justify-content:center; }
    #smax-resp-hud { position:relative; background:#0f172a; color:#e5e7eb; border-radius:12px; width:100%; max-width:1800px; height:calc(100vh - 16px); box-shadow:0 25px 60px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08) inset; font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; display:flex; overflow:hidden; }
    #smax-resp-hud-list { width:270px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid rgba(255,255,255,.07); background:rgba(2,6,23,.6); overflow:hidden; }
    #smax-resp-filter-panel { border-bottom:1px solid rgba(255,255,255,.07); flex-shrink:0; display:flex; flex-direction:column; }
    #smax-resp-filter-header { padding:8px 12px 6px; display:flex; align-items:center; justify-content:space-between; gap:6px; }
    #smax-resp-filter-criteria { padding:0 12px 10px; overflow-y:auto; max-height:38vh; }
    #smax-resp-filter-criteria.collapsed { display:none; }
    #smax-resp-ticket-list { flex:1; overflow-y:auto; }
    .smax-resp-ticket-item { display:flex; align-items:flex-start; gap:8px; padding:8px 10px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,.05); transition:background .12s; }
    .smax-resp-ticket-item:hover { background:rgba(255,255,255,.04); }
    .smax-resp-ticket-item.active { background:rgba(59,130,246,.12); border-left:3px solid #3b82f6; }
    .smax-resp-ticket-cb { margin-top:2px; flex-shrink:0; accent-color:#3b82f6; cursor:pointer; }
    .smax-resp-ticket-info { flex:1; min-width:0; }
    .smax-resp-ticket-id { font-size:11px; font-weight:700; color:#60a5fa; }
    .smax-resp-ticket-subject { font-size:11px; color:#d1d5db; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .smax-resp-ticket-status { font-size:10px; color:#6b7280; margin-top:2px; }
    #smax-resp-hud-main { flex:1; display:flex; flex-direction:column; min-width:0; overflow:hidden; }
    #smax-resp-hud-header { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 16px; background:linear-gradient(90deg,#0ea5e9 0%,#3b82f6 50%,#8b5cf6 100%); flex-shrink:0; }
    #smax-resp-hud-body { flex:1; display:flex; min-height:0; overflow:hidden; }
    #smax-resp-content-area { flex:1; display:flex; flex-direction:column; padding:14px 16px; gap:12px; overflow-y:auto; min-width:0; }
    #smax-resp-desc-panel { background:rgba(2,6,23,.7); border:1px solid rgba(255,255,255,.07); border-radius:10px; padding:10px 12px; flex-shrink:0; }
    #smax-resp-desc-content { font-size:12px; color:#d1d5db; overflow-y:auto; min-height:40px; max-height:28vh; line-height:1.5; }
    #smax-resp-desc-content img { max-width:100%; height:auto; border-radius:4px; }
    #smax-resp-solution-panel { display:flex; flex-direction:column; gap:6px; flex-shrink:0; }
    #smax-resp-solution-toolbar { display:flex; gap:2px; padding:4px 6px; background:rgba(0,0,0,.3); border:1px solid rgba(255,255,255,.1); border-bottom:none; border-radius:8px 8px 0 0; flex-wrap:wrap; }
    .smax-resp-tb-btn { background:transparent; border:1px solid transparent; border-radius:4px; color:#9ca3af; cursor:pointer; font-size:12px; line-height:1; padding:3px 7px; transition:background .12s,color .12s; }
    .smax-resp-tb-btn:hover { background:rgba(255,255,255,.1); color:#e5e7eb; }
    .smax-resp-tb-sep { width:1px; background:rgba(255,255,255,.12); margin:3px 2px; align-self:stretch; }
    #smax-resp-solution-editor { min-height:105px; width:100%; box-sizing:border-box; background:#0a0f1e; border:1px solid rgba(255,255,255,.1); border-radius:0 0 8px 8px; padding:10px 12px; color:#e5e7eb; font-size:13px; line-height:1.6; outline:none; font-family:inherit; transition:border-color .15s; overflow-y:auto; max-height:40vh; }
    #smax-resp-solution-editor:focus { border-color:#3b82f6; }
    #smax-resp-solution-editor:empty::before { content:attr(data-placeholder); color:#4b5563; pointer-events:none; display:block; }
    #smax-resp-solution-editor p { margin:0 0 4px; }
    #smax-resp-solution-editor ul, #smax-resp-solution-editor ol { margin:4px 0 4px 20px; }
    .smax-resp-list-desc { font-size:10px; color:#9ca3af; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-style:italic; }
    .smax-sort-btn { font-size:10px; padding:2px 6px; border-radius:4px; border:1px solid rgba(255,255,255,.1); background:transparent; color:#6b7280; cursor:pointer; transition:all .12s; white-space:nowrap; line-height:1.4; }
    .smax-sort-btn:hover { color:#9ca3af; border-color:rgba(255,255,255,.2); }
    .smax-sort-btn.active { background:rgba(59,130,246,.2); border-color:#3b82f6; color:#93c5fd; }
    .smax-resp-disc-recent { border-color:rgba(59,130,246,.35) !important; background:rgba(59,130,246,.08) !important; }
    #smax-gse-fwd-editor { min-height:72px; max-height:200px; overflow-y:auto; background:#1e293b; border:1px solid rgba(255,255,255,.15); border-radius:6px; color:#e2e8f0; font-size:11px; padding:6px; outline:none; line-height:1.5; font-family:inherit; }
    #smax-gse-fwd-editor:empty::before { content:attr(data-placeholder); color:#6b7280; pointer-events:none; display:block; }
    #smax-gse-fwd-editor img { max-width:100%; height:auto; border-radius:4px; vertical-align:middle; }
    .smax-resp-disc-footer { display:flex; justify-content:flex-end; margin-top:5px; padding-top:4px; border-top:1px solid rgba(255,255,255,.05); }
    .smax-resp-disc-replicate-btn { font-size:10px; padding:2px 8px; border-radius:4px; border:1px solid rgba(255,255,255,.1); background:transparent; color:#6b7280; cursor:pointer; transition:all .12s; }
    .smax-resp-disc-replicate-btn:hover:not(:disabled) { border-color:rgba(59,130,246,.5); color:#93c5fd; background:rgba(59,130,246,.1); }
    .smax-resp-disc-replicate-btn:disabled { opacity:.5; cursor:default; }
    #smax-resp-attachment-row { display:flex; align-items:center; gap:8px; padding:4px 0; min-height:22px; flex-shrink:0; }
    #smax-resp-attachment-row[data-empty="true"] { display:none; }
    #smax-resp-attachment-list { display:flex; flex-wrap:wrap; gap:5px; flex:1; }
    #smax-resp-attachment-list[data-state="loading"] { color:#6b7280; font-size:11px; font-style:italic; }
    #smax-resp-global-link-btn { padding:4px 8px; border:1px solid rgba(255,255,255,.25); border-radius:6px; background:rgba(0,0,0,.3); color:rgba(255,255,255,.8); font-size:11px; cursor:pointer; white-space:nowrap; transition:background .12s; }
    #smax-resp-global-link-btn:hover { background:rgba(59,130,246,.25); border-color:#3b82f6; }
    #smax-resp-hud-discussions { width:300px; flex-shrink:0; border-left:1px solid rgba(255,255,255,.07); display:flex; flex-direction:column; overflow:hidden; background:rgba(2,6,23,.5); }
    #smax-resp-discussions-list { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:8px; }
    .smax-resp-discussion-item { border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:8px 10px; background:rgba(15,23,42,.7); font-size:12px; }
    .smax-resp-disc-meta { display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px; font-size:10px; color:#6b7280; }
    .smax-resp-disc-author { color:#94a3b8; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px; }
    .smax-resp-disc-body { color:#d1d5db; line-height:1.45; font-size:11px; max-height:80px; overflow-y:auto; }
    .smax-resp-disc-body p { margin:0 0 4px; }
    #smax-resp-hud-footer { padding:10px 16px; border-top:1px solid rgba(255,255,255,.07); display:flex; align-items:center; justify-content:space-between; gap:10px; flex-shrink:0; background:rgba(2,6,23,.4); }
    #smax-resp-script-picker { display:none; position:absolute; left:0; right:0; bottom:100%; z-index:20; background:#0d1117; border:1px solid rgba(255,255,255,.15); border-radius:10px; margin-bottom:6px; box-shadow:0 8px 28px rgba(0,0,0,.55); overflow:hidden; }
    .smax-resp-script-item { padding:8px 12px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,.05); font-size:12px; color:#d1d5db; transition:background .1s; }
    .smax-resp-script-item:hover { background:rgba(59,130,246,.15); color:#93c5fd; }
    .smax-resp-person-pick { transition:background .1s; }
    #smax-resp-no-ticket { color:#4b5563; font-size:14px; text-align:center; }
    #smax-resp-detail { display:flex; flex-direction:column; flex:1; min-height:0; gap:10px; }
    #smax-resp-meta-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; flex-shrink:0; }
    .smax-resp-meta-chip { display:inline-flex; align-items:center; gap:5px; padding:5px 11px; border-radius:20px; border:1px solid rgba(255,255,255,.13); background:rgba(255,255,255,.05); color:#c4cdd8; font-size:11px; font-family:inherit; cursor:pointer; transition:all .15s; white-space:nowrap; max-width:260px; overflow:hidden; text-overflow:ellipsis; }
    .smax-resp-meta-chip:hover { border-color:rgba(255,255,255,.3); background:rgba(255,255,255,.1); color:#fff; }
    .smax-resp-meta-chip.dirty { border-color:#f59e0b; background:rgba(245,158,11,.15); color:#fcd34d; }
    .smax-resp-meta-chip .chip-edit { font-size:9px; opacity:.5; margin-left:2px; }
    .smax-resp-field-picker { display:none; position:fixed; z-index:999999; background:#0d1117; border:1px solid rgba(255,255,255,.16); border-radius:10px; box-shadow:0 12px 36px rgba(0,0,0,.75); overflow:hidden; width:380px; }
    #smax-gse-fwd-editor { min-height:80px; max-height:220px; overflow-y:auto; border:1px solid rgba(255,255,255,.12); border-radius:6px; padding:7px 9px; color:#e2e8f0; font-size:12px; line-height:1.5; background:rgba(255,255,255,.04); outline:none; cursor:text; }
    #smax-gse-fwd-editor:empty:before { content:attr(data-placeholder); color:#6b7280; pointer-events:none; }
    .smax-resp-field-picker-search { display:block; width:100%; box-sizing:border-box; background:transparent; border:none; border-bottom:1px solid rgba(255,255,255,.1); padding:9px 12px; color:#e5e7eb; font-size:12px; outline:none; font-family:inherit; }
    .smax-resp-field-picker-list { max-height:230px; overflow-y:auto; }
    .smax-resp-field-picker-item { padding:7px 12px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,.04); font-size:12px; color:#d1d5db; transition:background .1s; display:flex; align-items:center; gap:7px; }
    .smax-resp-field-picker-item:hover { background:rgba(59,130,246,.18); color:#93c5fd; }
    .smax-resp-field-picker-item.active { color:#60a5fa; font-weight:600; }
    .smax-resp-field-picker-item .fpi-sub { font-size:10px; color:#6b7280; margin-left:auto; white-space:nowrap; }
    .smax-resp-field-picker-empty { padding:10px 12px; color:#6b7280; font-size:11px; text-align:center; }
    #smax-resp-status-picker .smax-resp-field-picker-item.status-current { color:#60a5fa; font-weight:600; }
    #smax-batch-confirm-overlay { position:fixed; inset:0; z-index:9999999; background:rgba(0,0,0,.7); display:flex; align-items:center; justify-content:center; padding:16px; }
    #smax-batch-confirm-box { background:#0f172a; border:1px solid rgba(255,255,255,.12); border-radius:14px; width:100%; max-width:720px; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,.7); font-family:system-ui,-apple-system,sans-serif; color:#e5e7eb; overflow:hidden; }
    #smax-batch-confirm-header { padding:14px 18px; border-bottom:1px solid rgba(255,255,255,.08); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; background:rgba(255,255,255,.03); }
    #smax-batch-confirm-body { flex:1; overflow-y:auto; padding:14px 18px; display:flex; flex-direction:column; gap:14px; }
    .smax-bc-section-title { font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:.07em; margin-bottom:6px; }
    .smax-bc-changes { display:flex; flex-wrap:wrap; gap:6px; }
    .smax-bc-change-pill { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:20px; font-size:11px; }
    .smax-bc-change-pill.gse { background:rgba(59,130,246,.15); border:1px solid rgba(59,130,246,.4); color:#93c5fd; }
    .smax-bc-change-pill.assignee { background:rgba(167,139,250,.15); border:1px solid rgba(167,139,250,.4); color:#c4b5fd; }
    .smax-bc-change-pill.solution { background:rgba(34,197,94,.12); border:1px solid rgba(34,197,94,.35); color:#86efac; }
    .smax-bc-ticket-table { border-collapse:collapse; width:100%; font-size:11px; }
    .smax-bc-ticket-table th { text-align:left; padding:5px 8px; color:#6b7280; font-size:10px; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,.07); }
    .smax-bc-ticket-table td { padding:5px 8px; border-bottom:1px solid rgba(255,255,255,.04); vertical-align:middle; }
    .smax-bc-ticket-table tr:hover td { background:rgba(255,255,255,.03); }
    .smax-bc-tag { display:inline-flex; align-items:center; padding:1px 6px; border-radius:10px; font-size:10px; font-weight:600; }
    .smax-bc-tag.ok { background:rgba(34,197,94,.15); color:#4ade80; }
    .smax-bc-tag.skip { background:rgba(107,114,128,.15); color:#9ca3af; }
    .smax-bc-tag.partial { background:rgba(245,158,11,.15); color:#fbbf24; }
    #smax-batch-confirm-footer { padding:12px 18px; border-top:1px solid rgba(255,255,255,.08); display:flex; align-items:center; justify-content:space-between; gap:10px; flex-shrink:0; background:rgba(255,255,255,.02); }
    #smax-batch-confirm-summary { font-size:12px; color:#9ca3af; }

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

    /* ── Settings panel ── */
    #smax-settings {
      background: var(--sp-bg, #12161e);
      color: var(--sp-text, #e5e7eb);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      letter-spacing: .01em;
    }
    #smax-settings *, #smax-settings *::placeholder {
      -webkit-font-smoothing: antialiased;
    }
    #smax-settings input::placeholder,
    #smax-settings textarea::placeholder {
      color: var(--sp-text-dim, #8899aa) !important;
      opacity: 1 !important;
    }
    #smax-settings input[type="text"],
    #smax-settings input[type="number"],
    #smax-settings textarea {
      background: var(--sp-input-bg, #1a2030) !important;
      border-color: var(--sp-input-border, #566378) !important;
      color: var(--sp-input-text, #edf0f4) !important;
      font-size: 13px !important;
      line-height: 1.5;
    }
    #smax-settings input:focus,
    #smax-settings textarea:focus {
      border-color: var(--sp-primary, #38bdf8) !important;
      box-shadow: 0 0 6px rgba(56,189,248,.25) !important;
      outline: none;
    }
    #smax-settings label {
      color: var(--sp-text, #d0d7de) !important;
    }
    #smax-settings .smax-sp-card {
      background: var(--sp-surface, rgba(15,23,42,0.85));
      border: 1px solid var(--sp-border, rgba(255,255,255,.1));
      border-radius: 10px;
      padding: 14px;
    }
    #smax-settings .smax-sp-section-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--sp-text, #e5e7eb);
      margin-bottom: 10px;
    }
    #smax-settings .smax-sp-muted {
      font-size: 11px;
      color: var(--sp-text-muted, #94a3b8);
    }
    #smax-settings .smax-team-item {
      border-color: var(--sp-border-strong, rgba(255,255,255,.14)) !important;
      background: var(--sp-card-bg, rgba(15,23,42,0.75)) !important;
    }
    #smax-settings button {
      font-family: "Segoe UI", system-ui, sans-serif;
    }
    /* Sidebar nav */
    #smax-settings-sidebar .smax-sidebar-item {
      width: 100%;
      text-align: left;
      padding: 10px 14px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-size: 13px;
      background: transparent;
      color: var(--sp-sidebar-text, #94a3b8);
      transition: all .15s ease;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #smax-settings-sidebar .smax-sidebar-item:hover {
      background: var(--sp-primary-hover, rgba(56,189,248,.1));
      color: var(--sp-primary, #38bdf8);
    }
    #smax-settings-sidebar .smax-sidebar-item.active {
      background: var(--sp-sidebar-active-bg, rgba(56,189,248,.12));
      color: var(--sp-sidebar-active-text, #38bdf8);
      font-weight: 600;
    }
    /* Content area */
    #smax-settings-content {
      flex: 1;
      overflow-y: auto;
      padding: 24px 28px;
      min-width: 0;
    }
    #smax-settings-content::-webkit-scrollbar { width: 6px; }
    #smax-settings-content::-webkit-scrollbar-track { background: transparent; }
    #smax-settings-content::-webkit-scrollbar-thumb { background: var(--sp-border-strong, rgba(255,255,255,.2)); border-radius: 999px; }
    /* Module toggle rows */
    .smax-module-group-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .09em;
      color: var(--sp-text-dim, #64748b);
      padding: 10px 2px 5px;
    }
    .smax-module-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--sp-border, rgba(255,255,255,.1));
      cursor: pointer;
      transition: background .15s, border-color .15s, opacity .15s;
      user-select: none;
      margin-bottom: 4px;
    }
    .smax-module-row:hover { border-color: var(--sp-border-strong); }
    .smax-module-row.smax-active { background: var(--sp-primary-bg); border-color: var(--sp-primary); }
    .smax-module-row:not(.smax-active) { opacity: 0.55; }
    .smax-module-row:not(.smax-active):hover { opacity: 0.9; }
    .smax-module-icon { font-size: 18px; flex-shrink: 0; width: 24px; text-align: center; }
    .smax-module-info { flex: 1; min-width: 0; }
    .smax-module-name { font-size: 13px; font-weight: 500; color: var(--sp-text); }
    .smax-module-desc { font-size: 11px; color: var(--sp-text-muted); margin-top: 2px; }
    /* Toggle pill */
    .smax-toggle-sw { position: relative; width: 38px; height: 22px; flex-shrink: 0; }
    .smax-toggle-sw input { opacity: 0; width: 0; height: 0; position: absolute; }
    .smax-toggle-track { position: absolute; inset: 0; border-radius: 999px; background: var(--sp-border-strong, rgba(255,255,255,.2)); transition: background .2s; }
    .smax-toggle-sw input:checked + .smax-toggle-track { background: var(--sp-primary, #38bdf8); }
    .smax-toggle-track::before { content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #fff; top: 3px; left: 3px; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
    .smax-toggle-sw input:checked + .smax-toggle-track::before { transform: translateX(16px); }
    /* Detractor items */
    .smax-det-item {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--sp-danger-bg, rgba(239,68,68,.06));
      border: 1px solid var(--sp-danger-border, rgba(239,68,68,.2));
      border-radius: 6px;
      padding: 6px 10px;
    }
    .smax-det-item span { flex:1; font-size:12px; color: var(--sp-danger-text, #fca5a5); }
    .smax-det-item button { font-size:10px; padding:2px 8px; border-radius:4px; border:none; background: var(--sp-danger-bg); color: var(--sp-danger-text); cursor:pointer; }
    /* Team items in light mode */
    body[data-smax-theme="light"] .smax-team-item {
      background: #f8fafc !important;
      border-color: rgba(0,0,0,.1) !important;
    }
    body[data-smax-theme="light"] .smax-team-item strong {
      color: #1e293b !important;
    }
    body[data-smax-theme="light"] .smax-team-item .smax-team-prio-info {
      color: #475569 !important;
    }
    body[data-smax-theme="light"] .smax-team-edit-btn {
      color: #1e293b !important;
      background: rgba(0,0,0,.06) !important;
      border-color: rgba(0,0,0,.2) !important;
    }
    body[data-smax-theme="light"] .smax-team-del-btn {
      color: #b91c1c !important;
      background: rgba(220,38,38,.08) !important;
      border-color: rgba(220,38,38,.25) !important;
    }
    body[data-smax-theme="light"] #smax-settings-sidebar {
      border-right-color: rgba(0,0,0,.1);
    }
    /* Input overrides for light mode */
    body[data-smax-theme="light"] #smax-settings input[type="text"],
    body[data-smax-theme="light"] #smax-settings input[type="number"],
    body[data-smax-theme="light"] #smax-settings textarea {
      background: #ffffff !important;
      border-color: #cbd5e1 !important;
      color: #1e293b !important;
    }

    /* ── Ticket Info Bar ── */
    #smax-ticket-info-bar {
      width: 100%;
      background: #0f172a;
      border-bottom: 1px solid rgba(56,189,248,.25);
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 12px;
      z-index: 9000;
    }
    body[data-smax-theme="light"] #smax-ticket-info-bar {
      background: #1e293b;
    }
    .smax-ib-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 16px;
    }
    .smax-ib-fields {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px 0;
    }
    .smax-ib-field {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 10px;
    }
    .smax-ib-label { color: #64748b; white-space: nowrap; }
    .smax-ib-val   { color: #e2e8f0; font-weight: 500; }
    .smax-ib-divider { color: #334155; padding: 0 2px; user-select: none; }
    .smax-ib-att-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 8px;
      margin: 0 3px;
      border-radius: 999px;
      border: 1px solid rgba(56,189,248,.35);
      background: rgba(56,189,248,.08);
      color: #38bdf8;
      font-size: 11px;
      text-decoration: none;
      cursor: pointer;
      transition: background .15s, color .15s;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .smax-ib-att-chip:hover { background: #38bdf8; color: #0f172a; }
    .smax-ib-close {
      border: none;
      background: none;
      color: #475569;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      line-height: 1;
      flex-shrink: 0;
      transition: color .15s;
    }
    .smax-ib-close:hover { color: #94a3b8; }

    /* ── Contextual Solution / Discussion Bank ── */
    .smax-ctx-bank-bar {
      width: 100%;
      margin-bottom: 8px;
      padding: 6px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      background: var(--sp-surface-2, #f1f5f9);
      border: 1px solid var(--sp-border, rgba(0,0,0,.1));
      border-radius: 6px;
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 12px;
    }
    .smax-ctx-bank-label {
      color: var(--sp-text-muted, #475569);
      white-space: nowrap;
      font-weight: 600;
    }
    .smax-ctx-bank-select {
      flex: 1;
      min-width: 160px;
      max-width: 320px;
      padding: 4px 8px;
      border-radius: 5px;
      border: 1px solid var(--sp-input-border, #cbd5e1);
      background: var(--sp-input-bg, #fff);
      color: var(--sp-input-text, #1e293b);
      font-size: 12px;
      cursor: pointer;
      height: 28px;
      box-sizing: border-box;
    }
    .smax-ctx-bank-btn {
      padding: 4px 12px;
      border-radius: 5px;
      border: 1px solid var(--sp-border, rgba(0,0,0,.1));
      background: var(--sp-surface, #fff);
      color: var(--sp-text-muted, #475569);
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      height: 28px;
      line-height: 1;
    }
    .smax-ctx-bank-btn:hover { background: var(--sp-primary-hover, rgba(19,91,236,.15)); color: var(--sp-primary, #135bec); }

    /* ── Zen Mode ── */
    body.smax-zen-active div[id*="Fabricante_c_container"],
    body.smax-zen-active div[id*="TicketFornecedor_c_container"],
    body.smax-zen-active div[id*="TicketAuxiliar_c_container"],
    body.smax-zen-active div[id*="DataEnvioFornecedor_c_container"],
    body.smax-zen-active div[id*="Garantia_c_container"],
    body.smax-zen-active div[id*="DataAgendamento_c_container"],
    body.smax-zen-active div[id*="PreferredContactMethod_container"],
    body.smax-zen-active div[data-aid="related-knowledge-preview"],
    body.smax-zen-active div[id*="RegisteredForServiceComponent_container"],
    body.smax-zen-active div[id*="SubscriptionActionType_container"],
    body.smax-zen-active div[id*="TipoAtendimento_c_container"],
    body.smax-zen-active div[data-aid="tab-panel-nav-task-plan"],
    body.smax-zen-active div[data-aid="tab-panel-nav-slts"],
    body.smax-zen-active div[data-aid="tab-panel-nav-involved-cis"],
    body.smax-zen-active div[data-aid="tab-panel-nav-related-news"],
    body.smax-zen-active div[data-aid="tab-panel-nav-reservation"] { display: none !important; }

    /* ── Radar badge ── */
    #smax-radar-badge { position:fixed; top:10px; right:130px; z-index:999998; background:#ef4444; color:#fff; font-size:11px; font-weight:700; min-width:22px; padding:3px 7px; border-radius:999px; cursor:pointer; display:none; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(239,68,68,.5); font-family:system-ui,sans-serif; }
    #smax-radar-badge:hover { background:#dc2626; }
    #smax-radar-dropdown { position:fixed; top:36px; right:80px; z-index:999999; background:#0f172a; border:1px solid rgba(255,255,255,.1); border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,.5); padding:10px; min-width:240px; max-height:360px; overflow-y:auto; display:none; font-family:system-ui,sans-serif; }
    .smax-radar-item { padding:7px 10px; border-radius:6px; font-size:12px; color:#e2e8f0; display:flex; align-items:center; gap:8px; cursor:pointer; }
    .smax-radar-item:hover { background:rgba(255,255,255,.07); }
    .smax-radar-pill { font-size:10px; font-weight:700; padding:2px 6px; border-radius:999px; white-space:nowrap; }
    .smax-radar-pill.rejected { background:rgba(239,68,68,.2); color:#fca5a5; border:1px solid rgba(239,68,68,.4); }
    .smax-radar-pill.accept   { background:rgba(34,197,94,.2);  color:#86efac; border:1px solid rgba(34,197,94,.4); }

    /* ── Templates ── */
    #smax-tpl-btn { position:fixed; right:16px; bottom:80px; z-index:999998; width:46px; height:46px; border-radius:50%; border:none; background:#0f172a; color:#f8fafc; font-size:20px; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 14px rgba(0,0,0,.4); cursor:pointer; transition:background .15s; }
    #smax-tpl-btn:hover { background:#1e293b; }
    #smax-tpl-modal { position:fixed; inset:0; z-index:1000001; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.55); backdrop-filter:blur(4px); }
    #smax-tpl-modal.open { display:flex; }
    #smax-tpl-box { background:#0f172a; border:1px solid rgba(255,255,255,.1); border-radius:14px; width:680px; max-width:96vw; max-height:85vh; display:flex; flex-direction:column; box-shadow:0 24px 56px rgba(0,0,0,.6); overflow:hidden; font-family:system-ui,sans-serif; }
    #smax-tpl-box h3 { margin:0; padding:14px 18px; font-size:15px; font-weight:600; color:#f8fafc; background:linear-gradient(90deg,#0ea5e9,#8b5cf6); }
    .smax-tpl-tabs { display:flex; border-bottom:1px solid rgba(255,255,255,.08); }
    .smax-tpl-tab { flex:1; padding:9px; text-align:center; font-size:12px; font-weight:600; color:#94a3b8; cursor:pointer; transition:color .15s,background .15s; }
    .smax-tpl-tab.active { color:#38bdf8; background:rgba(56,189,248,.06); border-bottom:2px solid #38bdf8; }
    .smax-tpl-list { flex:1; overflow-y:auto; padding:10px; }
    .smax-tpl-empty { color:#64748b; font-size:13px; text-align:center; padding:30px; }
    .smax-tpl-item { padding:10px 12px; border-radius:8px; border:1px solid rgba(255,255,255,.07); margin-bottom:7px; background:rgba(255,255,255,.02); cursor:pointer; transition:background .15s,border-color .15s; }
    .smax-tpl-item:hover { background:rgba(56,189,248,.08); border-color:rgba(56,189,248,.3); }
    .smax-tpl-item-title { font-size:13px; font-weight:600; color:#e2e8f0; }
    .smax-tpl-item-preview { font-size:11px; color:#64748b; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .smax-tpl-item-actions { display:flex; gap:6px; margin-top:6px; }
    .smax-tpl-item-actions button { font-size:10px; padding:3px 8px; border-radius:4px; border:none; cursor:pointer; }
    .smax-tpl-edit-btn { background:rgba(56,189,248,.15); color:#38bdf8; }
    .smax-tpl-del-btn  { background:rgba(239,68,68,.15);  color:#fca5a5; }
    .smax-tpl-form { padding:12px; border-top:1px solid rgba(255,255,255,.08); display:flex; flex-direction:column; gap:8px; }
    .smax-tpl-form input, .smax-tpl-form textarea { background:#1e293b; border:1px solid #475569; border-radius:6px; color:#f8fafc; padding:8px 10px; font-size:12px; width:100%; box-sizing:border-box; font-family:system-ui,sans-serif; }
    .smax-tpl-form textarea { min-height:80px; resize:vertical; }
    .smax-tpl-form-actions { display:flex; gap:8px; justify-content:flex-end; }
    .smax-tpl-save-btn { background:linear-gradient(135deg,#22c55e,#16a34a); color:#fff; border:none; padding:7px 16px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; }
    .smax-tpl-cancel-btn { background:rgba(255,255,255,.06); color:#94a3b8; border:1px solid rgba(255,255,255,.1); padding:7px 14px; border-radius:6px; font-size:12px; cursor:pointer; }
    .smax-tpl-add-btn { display:block; width:100%; padding:8px; text-align:center; font-size:12px; color:#38bdf8; background:rgba(56,189,248,.06); border:1px dashed rgba(56,189,248,.3); border-radius:6px; cursor:pointer; margin-top:4px; }
    .smax-tpl-footer { display:flex; gap:8px; padding:10px 12px; border-top:1px solid rgba(255,255,255,.08); justify-content:flex-end; }
    .smax-tpl-footer button { font-size:12px; padding:7px 16px; border-radius:6px; cursor:pointer; }
    .smax-tpl-close-btn { background:rgba(255,255,255,.06); color:#94a3b8; border:1px solid rgba(255,255,255,.1); }

    /* ── Botões de resolução no topo ── */
    .tmx-top-actions { display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
    .tmx-lifecycle-menu { position:fixed; z-index:999999; background:#0f172a; border:1px solid rgba(255,255,255,.12); border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.5); padding:4px 0; min-width:180px; display:none; }
    .tmx-lifecycle-menu-item { padding:8px 14px; cursor:pointer; font-size:13px; color:#e2e8f0; }
    .tmx-lifecycle-menu-item:hover { background:rgba(255,255,255,.07); }
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

    // Ticket detail URL: /saw/Request/<ID>/... — ID is alphanumeric, not just "Request"
    const isTicketDetailPage = () => /\/Request\/[A-Za-z0-9]{8,}/.test(window.location.href);
    const isListPage = () => !isTicketDetailPage();

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
      const instances = Object.values(ck.instances);
      // 1) Try specific field names first
      const specific = instances.find((inst) => {
        const el = inst.element && inst.element.$;
        if (!el) return false;
        const id = el.id || '';
        const name = el.getAttribute && el.getAttribute('name') || '';
        return /solution|solucao|plCkeditor|resposta|reply|answer|discussion/i.test(`${id} ${name}`);
      });
      if (specific) return specific;
      // 2) Fallback: any visible (non-detached) CKEditor instance
      return instances.find(inst => {
        try {
          const el = inst.element && inst.element.$;
          return el && document.body.contains(el) && el.offsetParent !== null;
        } catch { return false; }
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

    // Abre sempre em nova aba e despacha o número via postMessage para o bridge executar a consulta.
    const openEprocProcess = (processNumber) => {
      const eprocWin = window.open(EPROC_URL, '_blank');
      if (!eprocWin) {
        // Popup bloqueado pelo navegador — copia o número como fallback
        navigator.clipboard?.writeText(processNumber).catch(() => {});
        alert(`Popups bloqueados pelo navegador.\nNúmero copiado: ${processNumber}\n\nPermita popups para este site nas configurações do navegador.`);
        return;
      }
      const msg = { type: 'SMAX_CONSULTAR_PROCESSO', num: processNumber };
      // Envia em múltiplos intervalos: a nova aba precisa carregar antes de receber a mensagem
      [800, 2000, 4000].forEach(d => setTimeout(() => {
        try { eprocWin.postMessage(msg, EPROC_ORIGIN); } catch (_) {}
      }, d));
    };

    const linkifyCNJ = (html) => {
      if (!html) return html;
      const tmp = document.createElement('div');
      tmp.innerHTML = html;

      const makeLink = (match) => {
        const formatted = normalizeCNJ(match);
        const span = document.createElement('span');
        span.textContent = formatted;
        span.dataset.smaxProc = formatted;
        span.style.cssText = 'color:#38bdf8;font-family:monospace;font-weight:600;border-bottom:1px dotted rgba(56,189,248,.6);cursor:pointer;';
        span.title = `Consultar processo no eProc: ${formatted}`;
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
      isTicketDetailPage,
      isListPage,
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

  // Delegação global de cliques em spans CNJ (data-smax-proc)
  // Usa fase de captura para interceptar antes do router SPA do SMAX
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-smax-proc]');
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    Utils.openEprocProcess(target.dataset.smaxProc);
  }, true);

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
      if (!response.ok) {
        let errBody = '';
        try { errBody = await response.text(); } catch {}
        if (errBody) console.warn(`[ApiClient] HTTP ${response.status} body:`, errBody.slice(0, 500));
        throw new Error(`[ApiClient] HTTP ${response.status}`);
      }
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
    let _sharedTeams = [];

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
        // Append shared teams whose id isn't already defined locally
        const localIds = new Set(cachedTeams.map(t => t.id));
        for (const st of _sharedTeams) {
          if (!localIds.has(st.id)) cachedTeams.push({ ...st, _shared: true });
        }
        // Sort by priority desc
        cachedTeams.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      } catch (err) {
        console.warn('[SMAX] Failed to parse teams config:', err);
        cachedTeams = [];
      }
      return cachedTeams;
    };

    const setSharedTeams = (teams) => {
      _sharedTeams = Array.isArray(teams) ? teams : [];
      cachedTeams = null; // force rebuild on next getTeams()
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

        // Check matchers — scope: 'location' = só Local de Registro; 'text' = assunto+descrição; outros = qualquer campo
        if (team.matchers && Array.isArray(team.matchers)) {
          for (const m of team.matchers) {
            if (m.type === 'regex' && m._regex) {
              const scope = m.scope || 'location';
              const testStr = scope === 'location'
                ? (ticket.locationName || '').toUpperCase()
                : scope === 'text'
                  ? [ticket.subjectText || '', ticket.descriptionText || ''].join(' ').toUpperCase()
                  : matchText;
              if (m._regex.test(testStr)) return team;
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

    return { getTeams, getTeamById, getWorkersForTeam, suggestTeam, suggestWorker, reload, setSharedTeams };
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

      // Cor pessoal definida pelo usuário tem prioridade
      const normalized = Utils.normalizeText(name);
      if (personal.myColors[normalized]) return personal.myColors[normalized];

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
      const privacyRaw  = raw.PrivacyType || '';
      const { code: privacyCode, label: privacyLabel } = mapPrivacyLabel(privacyRaw);
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
        privacyRaw,
        privacyLabel,
        bodyRaw: bodySource,
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
      const expertAssigneeId = props.ExpertAssignee ? String(props.ExpertAssignee) : (existing.expertAssigneeId || '');

      // Extrai chamado global (pai) via rel.GlobalId_c — campo customizado TJSP
      let globalChangeId = existing.globalChangeId || '';
      if (!globalChangeId && rel && rel.GlobalId_c) {
        const rawId = String(rel.GlobalId_c.Id || rel.GlobalId_c.id || '').trim();
        if (rawId && rawId !== id) globalChangeId = rawId;
      }

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
        expertAssigneeId,
        processNumber,
        locationId,
        locationName,
        status,
        statusSCCD: props.StatusSCCDSMAX_c || existing.statusSCCD || '',
        globalChangeId
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
        'RequestedForPerson.item',
        'RequestedForDisplayLabel',
        'RequestedForName',
        'ExpertGroup.item'
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

    // Ingere resposta de RequestCausesRequest (interceptada do SMAX UI)
    // firstEndpoint = pai (global), secondEndpoint = filho
    const ingestParentRelationshipPayload = (payload) => {
      try {
        const entities = payload?.entities || [];
        for (const ent of entities) {
          const props = ent?.properties || {};
          const firstRaw = String(props.firstEndpoint || props.FirstEndpoint || '').replace(/^IMRfc:/i, '').replace(/^IMchg:/i, '').trim();
          const secondRaw = String(props.secondEndpoint || props.SecondEndpoint || '').replace(/^IMRfc:/i, '').replace(/^IMchg:/i, '').trim();
          if (!firstRaw || !secondRaw || firstRaw === secondRaw) continue;
          // firstEndpoint é o pai → o filho (secondEndpoint) aponta para ele
          const existing = triageCache.get(secondRaw) || {};
          if (!existing.globalChangeId) {
            triageCache.set(secondRaw, Object.assign({}, existing, { globalChangeId: firstRaw }));
            console.log('[SMAX] RequestCausesRequest interceptado → filho', secondRaw, 'pai', firstRaw);
          }
        }
      } catch (err) {
        console.warn('[SMAX] ingestParentRelationshipPayload falhou:', err);
      }
    };

    // Busca o chamado pai (global) via relacionamento RequestCausesRequest
    // secondEndpoint = filho, firstEndpoint = pai (global)
    const fetchParentRequest = async (id) => {
      const key = String(id || '').replace(/\D/g, '') || String(id || '');
      if (!key) return null;
      // Se já temos, não busca de novo
      const cached = triageCache.get(key);
      if (cached?.globalChangeId) return cached.globalChangeId;
      try {
        const payload = await ApiClient.request('ems/RequestCausesRequest', {
          method: 'GET',
          searchParams: {
            filter: `(secondEndpoint='${key}')`,
            layout: 'firstEndpoint,secondEndpoint',
            size: 1
          },
          includeTenantParam: true
        });
        const entities = payload?.entities || [];
        if (!entities.length) return null;
        const props = entities[0]?.properties || {};
        const parentRaw = props.firstEndpoint || props.FirstEndpoint || '';
        const parentId = String(parentRaw).replace(/^IMRfc:/, '').replace(/^IMchg:/, '').trim();
        if (!parentId || parentId === key) return null;
        // Persiste no triageCache
        const existing = triageCache.get(key) || {};
        triageCache.set(key, Object.assign({}, existing, { globalChangeId: parentId }));
        console.log('[SMAX] RequestCausesRequest → chamado', key, 'tem pai global:', parentId);
        return parentId;
      } catch (err) {
        console.warn('[SMAX] fetchParentRequest falhou para', key, err);
        return null;
      }
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
      fetchParentRequest,
      ingestParentRelationshipPayload,
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
    let _capturedPageFilter = null; // último filtro capturado da lista de chamados do SMAX
    const isRequestDetailUrl = (url = '') => /\/rest\/\d+\/ems\/Request\/\d+/i.test(url);
    const isRequestListUrl = (url = '') => /\/rest\/\d+\/ems\/Request(?:\?|$)/i.test(url) && !isRequestDetailUrl(url);

    const tryCapurePageFilter = (url = '') => {
      if (!isRequestListUrl(url)) return;
      try {
        const u = new URL(url, window.location.origin);
        const f = u.searchParams.get('filter');
        // Só captura se vier da página (não dos nossos próprios fetches identificados pelo layout)
        const layout = u.searchParams.get('layout') || '';
        if (f && !layout.includes('StatusSCCDSMAX_c')) {
          _capturedPageFilter = f;
          console.log('[SMAX] Filtro de lista capturado:', f.slice(0, 120));
        }
      } catch { }
    };

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
              tryCapurePageFilter(url);
              if (!this.responseText) return;
              const json = JSON.parse(this.responseText);
              if (/\/rest\/\d+\/ems\/RequestCausesRequest/i.test(url)) {
                DataRepository.ingestParentRelationshipPayload(json);
              } else if (isRequestListUrl(url)) {
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
                tryCapurePageFilter(url);
                const clone = resp.clone();
                clone.text().then((txt) => {
                  try {
                    if (!txt) return;
                    const json = JSON.parse(txt);
                    if (/\/rest\/\d+\/ems\/RequestCausesRequest/i.test(url)) {
                      DataRepository.ingestParentRelationshipPayload(json);
                    } else if (isRequestListUrl(url)) {
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

    const getCapturedPageFilter = () => _capturedPageFilter;
    return { patch, getCapturedPageFilter };
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

    // Converte PrivacyType da forma curta (leitura) para prefixada (escrita)
    const toSmaxPrivacyType = (raw) => {
      if (!raw) return 'PrivacyTypeInternal';
      if (raw.startsWith('PrivacyType')) return raw;
      const u = raw.toUpperCase();
      if (u === 'PUBLIC')   return 'PrivacyTypePublic';
      if (u === 'EXTERNAL') return 'PrivacyTypeExternal';
      if (u === 'AGENT')    return 'PrivacyTypeAgent';
      return 'PrivacyTypeInternal';
    };

    const postDiscussion = (ticketId, { bodyHtml, purposeCode, privacyRaw } = {}) => {
      if (!prefs.enableRealWrites) return Promise.resolve({ skipped: true });
      if (!ticketId || !bodyHtml) return Promise.resolve(null);
      const body = {
        entities: [{
          entity_type: 'Comment',
          properties: {
            Request:           String(ticketId),
            CommentBody:       bodyHtml,
            FunctionalPurpose: purposeCode || 'StatusUpdate',
            PrivacyType:       toSmaxPrivacyType(privacyRaw),
          }
        }],
        operation: 'CREATE'
      };
      return ApiClient.ems.bulk(body).then(res => {
        return res;
      }).catch(err => {
        console.warn('[SMAX] postDiscussion failed:', err);
        return null;
      });
    };

    return { postUpdateRequest, postCreateRequestCausesRequest, postDiscussion, extractBulkErrorMessages, summarizeBulkOutcome };
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
    let activeSection = 'geral'; // current sidebar section

    const SECTIONS = [
      { id: 'geral',         icon: '⚙️',  label: 'Geral' },
      { id: 'equipes',       icon: '👥',  label: 'Equipes' },
      { id: 'especialistas', icon: '👤',  label: 'Especialistas' },
      { id: 'destaque',      icon: '⭐',  label: 'Destaque' },
      { id: 'templates',     icon: '📋',  label: 'Scripts' },
      { id: 'triagem',       icon: '🎯',  label: 'Triagem' },
      { id: 'respostas',     icon: '📨',  label: 'Respostas' },
    ];

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

    const renderHeader = () => {
      const isDark = (personal.themeMode || 'dark') === 'dark';
      return `
      <div id="smax-settings-header" style="display:flex;align-items:center;justify-content:space-between;min-height:52px;padding:10px 18px;background:linear-gradient(90deg,#0ea5e9 0%,#3b82f6 50%,#8b5cf6 100%);border-radius:12px 12px 0 0;flex-shrink:0;gap:12px;">
        <div style="font-weight:700;font-size:16px;letter-spacing:.03em;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap;">
          ⚙️ SMAX Toolkit
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button id="smax-theme-toggle-btn"
            title="${isDark ? 'Mudar para modo claro' : 'Mudar para modo escuro'}"
            style="border:none;background:rgba(255,255,255,.18);color:#fff;font-size:17px;width:34px;height:34px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s ease;flex-shrink:0;">
            ${isDark ? '☀️' : '🌙'}
          </button>
          <button id="smax-settings-close-btn"
            title="Fechar"
            style="border:none;background:rgba(255,255,255,.18);color:#fff;font-size:18px;width:34px;height:34px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s ease;flex-shrink:0;">
            ✕
          </button>
        </div>
      </div>`;
    };

    const renderSidebar = () => `
      <nav id="smax-settings-sidebar" style="width:220px;flex-shrink:0;background:var(--sp-sidebar-bg,#0d1117);border-right:1px solid var(--sp-border,rgba(255,255,255,.1));padding:14px 10px;display:flex;flex-direction:column;gap:3px;overflow-y:auto;">
        <div style="font-size:11px;font-weight:600;color:var(--sp-text-dim);text-transform:uppercase;letter-spacing:.08em;padding:4px 12px 10px;">Navegação</div>
        ${SECTIONS.map(s => `
          <button class="smax-sidebar-item${s.id === activeSection ? ' active' : ''}" data-section="${s.id}">
            <span style="font-size:15px;flex-shrink:0;">${s.icon}</span>
            <span>${s.label}</span>
          </button>
        `).join('')}
      </nav>`;

    // --- Team Editor Methods ---

    const renderTeamsList = () => {
      if (editingTeamId) return renderTeamEditor(editingTeamId);

      const listHtml = currentTeams.map(t => {
        const isDefault = !!t.isDefault;
        return `
          <div class="smax-team-item" style="border:1px solid var(--sp-border);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--sp-surface-2);transition:border-color .15s ease,box-shadow .15s ease;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong style="font-size:13px;color:var(--sp-text);">${Utils.escapeHtml(t.name || t.id || 'Sem nome')}</strong>
                ${isDefault ? '<span style="font-size:10px;background:rgba(56,189,248,0.2);color:#38bdf8;padding:2px 6px;border-radius:999px;margin-left:6px;border:1px solid rgba(56,189,248,0.3);">Padrão</span>' : ''}
                <div class="smax-team-prio-info" style="font-size:11px;color:var(--sp-text-muted);margin-top:2px;">Prioridade: ${t.priority || 0} • Membros: ${t.workers ? t.workers.length : 0}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="smax-team-edit-btn" data-id="${t.id}" style="font-size:11px;padding:6px 12px;cursor:pointer;background:var(--sp-surface);color:var(--sp-text);border:1px solid var(--sp-border);border-radius:6px;transition:all .15s ease;">Editar</button>
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

      const matcherRowHtml = (m) => {
        const displayText = m._displayText || m.pattern || '';
        const scope = m.scope || 'location';
        return `
          <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(15,23,42,0.6);border:1px solid #475569;padding:6px 8px;border-radius:8px;">
            <input type="hidden" class="smax-matcher-pattern" value="${Utils.escapeHtml(m.pattern || '')}">
            <input type="hidden" class="smax-matcher-scope" value="${Utils.escapeHtml(scope)}">
            <span style="flex:1;font-size:11px;color:#94a3b8;">contém: <strong style="color:#e5e7eb;">${Utils.escapeHtml(displayText)}</strong></span>
            <button class="smax-matcher-del-btn" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;transition:all .15s ease;">✕</button>
          </div>`;
      };
      const locationMatchersHtml = (team.matchers || []).filter(m => m.type === 'regex' && (m.scope || 'location') === 'location').map(matcherRowHtml).join('');
      const textMatchersHtml    = (team.matchers || []).filter(m => m.type === 'regex' && m.scope === 'text').map(matcherRowHtml).join('');

      const workersHtml = (team.workers || []).map((w, idx) => {
        const normName = Utils.normalizeText(w.name || '');
        const myColor  = personal.myColors[normName] || {};
        const bgVal    = myColor.bg || '#1e293b';
        const fgVal    = myColor.fg || '#f8fafc';
        return `
        <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(15,23,42,0.6);border:1px solid #475569;padding:8px;border-radius:8px;flex-wrap:wrap;">
          <input type="text" class="smax-worker-name" data-idx="${idx}" value="${Utils.escapeHtml(w.name || '')}" style="flex:1;min-width:120px;font-size:11px;padding:6px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#f8fafc;" placeholder="Nome do Responsável">
          <input type="text" class="smax-worker-digits" data-idx="${idx}" value="${Utils.escapeHtml(w.digits || '')}" style="width:80px;font-size:11px;padding:6px;border:1px solid #475569;border-radius:6px;background:#1e293b;color:#f8fafc;" placeholder="Dígitos (ex: 0-9)">
          <div title="Cor de fundo (pessoal)" style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            <span style="font-size:9px;color:#64748b;">Fundo</span>
            <input type="color" class="smax-worker-color-bg" data-idx="${idx}" value="${Utils.escapeHtml(bgVal.startsWith('hsl') ? '#1e293b' : bgVal)}" style="width:28px;height:24px;border:none;border-radius:4px;cursor:pointer;padding:0;background:none;">
          </div>
          <div title="Cor do texto (pessoal)" style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            <span style="font-size:9px;color:#64748b;">Texto</span>
            <input type="color" class="smax-worker-color-fg" data-idx="${idx}" value="${Utils.escapeHtml(fgVal.startsWith('hsl') ? '#ffffff' : fgVal)}" style="width:28px;height:24px;border:none;border-radius:4px;cursor:pointer;padding:0;background:none;">
          </div>
          <div class="smax-worker-absent-wrapper" style="display:flex;align-items:center;cursor:pointer;user-select:none;">
             <input type="checkbox" class="smax-worker-absent" data-idx="${idx}" ${w.isAbsent ? 'checked' : ''} style="display:none;">
             <div class="smax-absent-fake" style="width:14px;height:14px;border:1px solid ${w.isAbsent ? '#d32f2f' : '#64748b'};margin-right:4px;background:${w.isAbsent ? '#d32f2f' : 'transparent'};border-radius:2px;display:flex;align-items:center;justify-content:center;"></div>
             <span style="font-size:10px;color:#fca5a5;">Ausente</span>
          </div>

          <button class="smax-worker-del-btn" data-idx="${idx}" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;transition:all .15s ease;">✕</button>
        </div>
      `; }).join('');

      return `
        <div style="margin-top:16px;border:1px solid rgba(56,189,248,.3);padding:14px;border-radius:12px;background:rgba(2,6,23,0.85);backdrop-filter:blur(12px);box-shadow:0 4px 16px rgba(0,0,0,.3);">
          <div style="font-weight:600;margin-bottom:12px;color:#38bdf8;font-size:15px;">${isNew ? '✨ Criar Nova Equipe' : '✏️ Editar Equipe ' + team.id}</div>
          
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:12px;">
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:4px;">Qual o nome da equipe?</label>
              <input type="text" id="smax-edit-id" value="${Utils.escapeHtml(team.name || team.id || '')}" ${isGeneralTeam ? 'disabled' : ''} placeholder="Ex: JEC, Cível, Criminal..." style="width:100%;padding:8px 12px;border:1px solid #475569;border-radius:8px;background:${isGeneralTeam ? 'rgba(15,23,42,0.6)' : '#1e293b'};color:${isGeneralTeam ? '#94a3b8' : '#f8fafc'};font-size:13px;transition:border-color .15s ease,box-shadow .15s ease;box-sizing:border-box;${isGeneralTeam ? 'cursor:not-allowed;' : ''}">
            </div>
            <div>
              <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:2px;">Prioridade
                <span title="Define a ordem de verificação na triagem automática. A equipe com maior prioridade é verificada primeiro. Use valores altos (ex: 10) para equipes específicas e baixos (ex: 1) para a equipe geral (fallback). Assim, chamados de um GSE específico vão para a equipe certa antes de cair no grupo geral." style="cursor:help;margin-left:4px;font-size:11px;color:#64748b;font-weight:400;">ℹ️</span>
              </label>
              <input type="number" id="smax-edit-prio" value="${team.priority || 0}" style="width:100%;padding:8px 12px;border:1px solid #475569;border-radius:8px;background:#1e293b;color:#f8fafc;font-size:13px;transition:border-color .15s ease,box-shadow .15s ease;box-sizing:border-box;">
            </div>
          </div>


          <div style="margin-bottom:12px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;color:#e5e7eb;">Quais GSE a equipe atende?
              <span title="GSE = Grupo de Suporte Especializado (ExpertGroup no SMAX). Chamados atribuídos a esses grupos serão roteados automaticamente para esta equipe na triagem. Também são usados como filtro na janela de Consulta de Chamados." style="cursor:help;margin-left:4px;font-size:11px;color:#64748b;font-weight:400;">ℹ️</span>
            </div>
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
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;color:#e5e7eb;">Palavras-chave para roteamento
              <span title="Rota alternativa ao GSE: quando o chamado não bate com nenhum GSE configurado, o sistema verifica essas palavras-chave. Usado APENAS na triagem — não serve para o filtro de Consulta de Chamados." style="cursor:help;margin-left:4px;font-size:11px;color:#64748b;font-weight:400;">ℹ️</span>
            </div>
            ${isGeneralTeam ? '<div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">⚠️ A equipe GERAL não utiliza palavras-chave (é o fallback para tudo que não bateu em nenhuma regra).</div>' : `
            <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">A equipe será sugerida quando o chamado contiver a palavra-chave no campo correspondente (insensível a maiúsculas/minúsculas).</div>

            <!-- Local de Registro -->
            <div style="margin-bottom:10px;border:1px solid #334155;border-radius:8px;padding:10px;background:rgba(15,23,42,0.5);">
              <div style="font-size:11px;font-weight:600;color:#38bdf8;margin-bottom:6px;">📍 Local de Registro
                <span style="font-weight:400;color:#64748b;margin-left:4px;">(campo RegisteredForLocation do chamado)</span>
              </div>
              <div style="display:flex;gap:6px;margin-bottom:6px;">
                <input type="text" id="smax-team-location-input" placeholder="Ex: CAMPINAS, SANTOS, CAPITAL..."
                       style="flex:1;padding:6px 10px;border:1px solid #475569;border-radius:6px;font-size:12px;background:#0f172a;color:#e5e7eb;box-sizing:border-box;">
                <button id="smax-add-location-matcher-btn" style="padding:6px 12px;background:rgba(56,189,248,.15);color:#38bdf8;border:1px solid rgba(56,189,248,.3);border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap;">+ Adicionar</button>
              </div>
              <div id="smax-matchers-list-location">${locationMatchersHtml}</div>
            </div>

            <!-- Assunto / Descrição -->
            <div style="border:1px solid #334155;border-radius:8px;padding:10px;background:rgba(15,23,42,0.5);">
              <div style="font-size:11px;font-weight:600;color:#a78bfa;margin-bottom:6px;">📝 Assunto / Descrição
                <span style="font-weight:400;color:#64748b;margin-left:4px;">(título e corpo do chamado)</span>
              </div>
              <div style="display:flex;gap:6px;margin-bottom:6px;">
                <input type="text" id="smax-team-text-input" placeholder="Ex: IMPRESSORA, VPN, SENHA..."
                       style="flex:1;padding:6px 10px;border:1px solid #475569;border-radius:6px;font-size:12px;background:#0f172a;color:#e5e7eb;box-sizing:border-box;">
                <button id="smax-add-text-matcher-btn" style="padding:6px 12px;background:rgba(167,139,250,.15);color:#a78bfa;border:1px solid rgba(167,139,250,.3);border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap;">+ Adicionar</button>
              </div>
              <div id="smax-matchers-list-text">${textMatchersHtml}</div>
            </div>`}
          </div>

          <div style="margin-bottom:12px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;color:#e5e7eb;">Membros e Distribuição
              <span title="Cada membro recebe um intervalo de dígitos finais do ID do chamado (ex: '0-9' significa que chamados terminados em 0 a 9 são desse membro). A triagem usa isso para sugerir automaticamente quem deve atender. Marque 'Ausente' para que o sistema pule para o próximo par de dígitos ao sugerir responsável." style="cursor:help;margin-left:4px;font-size:11px;color:#64748b;font-weight:400;">ℹ️</span>
            </div>
            
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

          // Collect matchers from both scope sections
          const newMatchers = [];
          const collectMatchers = (listId, scope) => {
            container.querySelectorAll(`#${listId} > div`).forEach(div => {
              const patternInput = div.querySelector('.smax-matcher-pattern');
              if (patternInput) {
                const pattern = patternInput.value.trim();
                if (pattern) newMatchers.push({ type: 'regex', pattern, scope, _displayText: pattern.replace(/\\/g, '') });
              }
            });
          };
          collectMatchers('smax-matchers-list-location', 'location');
          collectMatchers('smax-matchers-list-text', 'text');

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

        // --- Matcher Logic (location + text scopes) ---
        const wireMatcherInput = (inputId, btnId, listId, scope) => {
          const input = container.querySelector(`#${inputId}`);
          const btn   = container.querySelector(`#${btnId}`);
          const list  = container.querySelector(`#${listId}`);
          if (!input || !btn || !list) return;

          const addRow = () => {
            const text = input.value.trim();
            if (!text) return;
            const escapedPattern = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center;background:rgba(15,23,42,0.6);border:1px solid #475569;padding:6px 8px;border-radius:8px;';
            row.innerHTML = `
              <input type="hidden" class="smax-matcher-pattern" value="${Utils.escapeHtml(escapedPattern)}">
              <input type="hidden" class="smax-matcher-scope" value="${Utils.escapeHtml(scope)}">
              <span style="flex:1;font-size:11px;color:#94a3b8;">contém: <strong style="color:#e5e7eb;">${Utils.escapeHtml(text)}</strong></span>
              <button class="smax-matcher-del-btn" style="color:#fca5a5;border:none;background:rgba(220,38,38,.1);padding:4px 8px;border-radius:4px;cursor:pointer;">✕</button>`;
            row.querySelector('.smax-matcher-del-btn').addEventListener('click', () => row.remove());
            list.appendChild(row);
            input.value = '';
          };

          btn.addEventListener('click', addRow);
          input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } });
        };

        wireMatcherInput('smax-team-location-input', 'smax-add-location-matcher-btn', 'smax-matchers-list-location', 'location');
        wireMatcherInput('smax-team-text-input',     'smax-add-text-matcher-btn',     'smax-matchers-list-text',     'text');

        // Delete buttons for rows rendered on load
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

        // Color pickers — salvos imediatamente em PersonalStore (não compartilhado)
        const syncColor = (nameInput, bgInput, fgInput) => {
          const name = Utils.normalizeText((nameInput?.value || '').trim());
          if (!name) return;
          personal.myColors[name] = { bg: bgInput.value, fg: fgInput.value };
          savePersonal();
          ColorRegistry.clearCache();
        };
        container.querySelectorAll('.smax-worker-color-bg, .smax-worker-color-fg').forEach(input => {
          input.addEventListener('change', () => {
            const idx = input.dataset.idx;
            const row = input.closest('div[style]');
            const nameInput   = row?.querySelector(`.smax-worker-name[data-idx="${idx}"]`);
            const bgInput     = row?.querySelector(`.smax-worker-color-bg[data-idx="${idx}"]`);
            const fgInput     = row?.querySelector(`.smax-worker-color-fg[data-idx="${idx}"]`);
            if (nameInput && bgInput && fgInput) syncColor(nameInput, bgInput, fgInput);
          });
        });
      }
    };

    // Shareable config keys (no personal identity — meant for team distribution)
    const CONFIG_KEYS = [
      'nameBadgesOn', 'collapseOn', 'enlargeCommentsOn', 'flagSkullOn',
      'zenModeOn', 'radarOn',
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
      try { parsed = JSON.parse(raw); }
      catch (err) { return { ok: false, msg: `JSON inválido: ${err.message}` }; }
      if (typeof parsed !== 'object' || parsed === null) return { ok: false, msg: 'O JSON deve ser um objeto.' };
      let count = 0;
      CONFIG_KEYS.forEach(key => {
        if (key === 'teamsConfigRaw' && parsed.teams !== undefined) {
          prefs.teamsConfigRaw = typeof parsed.teams === 'string' ? parsed.teams : JSON.stringify(parsed.teams);
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

    /* ── Section content renderers ── */

    const renderSectionGeral = () => {
      const triadorName = prefs.myPersonName || '';
      return `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div class="smax-sp-card">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
              <span style="font-size:20px;">👤</span>
              <div>
                <div style="font-weight:600;color:var(--sp-primary,#38bdf8);font-size:15px;">Quem é você?</div>
                <div class="smax-sp-muted">Seu nome será vinculado aos chamados globais</div>
              </div>
            </div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <div style="flex:1;position:relative;min-width:180px;">
                <input type="text" id="smax-triador-search" placeholder="Buscar por nome..."
                  style="width:100%;padding:9px 12px;border-radius:8px;font-size:13px;box-sizing:border-box;transition:border-color .15s,box-shadow .15s;">
                <div id="smax-triador-results" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:220px;overflow-y:auto;background:var(--sp-surface-2,#020617);border:1px solid var(--sp-input-border,#475569);border-top:none;border-radius:0 0 8px 8px;z-index:200;box-shadow:0 12px 24px rgba(0,0,0,.5);"></div>
              </div>
              ${triadorName ? `
                <div id="smax-triador-current" style="display:flex;align-items:center;padding:8px 14px;background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:8px;font-size:12px;color:#fff;font-weight:500;white-space:nowrap;box-shadow:0 4px 12px rgba(34,197,94,.35);flex-shrink:0;">
                  ✓ ${Utils.escapeHtml(triadorName)}
                </div>
              ` : `
                <div id="smax-triador-current" style="display:flex;align-items:center;padding:8px 14px;background:var(--sp-danger-bg);border:1px solid var(--sp-danger-border);border-radius:8px;font-size:12px;color:var(--sp-danger-text);white-space:nowrap;flex-shrink:0;">
                  ⚠️ Não configurado
                </div>
              `}
            </div>
          </div>
          <div class="smax-sp-card">
            <div class="smax-sp-section-title">Opções dos módulos</div>
            <div class="smax-module-group-label">📋 Tela de Lista (fila de chamados)</div>
            ${[
              ['radarOn',      '📡', 'Radar de pendentes',  'Badge com chamados rejeitados ou aguardando aceite'],
              ['flagSkullOn',  '⭐', 'Usuários Destaque',   'Destaca linha inteira do chamado para usuários da lista de destaque'],
              ['nameBadgesOn', '🏷️', 'Badges na grid',      'Exibe o responsável ao lado do chamado na lista'],
            ].map(([key, icon, label, tip]) => `
              <div class="smax-module-row${prefs[key] ? ' smax-active' : ''}" data-key="${key}">
                <div class="smax-module-icon">${icon}</div>
                <div class="smax-module-info">
                  <div class="smax-module-name">${label}</div>
                  <div class="smax-module-desc">${tip}</div>
                </div>
                <label class="smax-toggle-sw" onclick="event.stopPropagation()">
                  <input type="checkbox" class="smax-pref-toggle" data-key="${key}" ${prefs[key] ? 'checked' : ''}>
                  <span class="smax-toggle-track"></span>
                </label>
              </div>
            `).join('')}
            <div class="smax-module-group-label" style="margin-top:6px;">🎫 Tela de Chamado (interno)</div>

            ${[
              ['zenModeOn',  '🧘', 'Zen Mode',       'Oculta campos desnecessários no formulário de chamado'],
              ['collapseOn', '📂', 'Recolher seções', 'Recolhe automaticamente seções desnecessárias'],
            ].map(([key, icon, label, tip]) => `
              <div class="smax-module-row${prefs[key] ? ' smax-active' : ''}" data-key="${key}">
                <div class="smax-module-icon">${icon}</div>
                <div class="smax-module-info">
                  <div class="smax-module-name">${label}</div>
                  <div class="smax-module-desc">${tip}</div>
                </div>
                <label class="smax-toggle-sw" onclick="event.stopPropagation()">
                  <input type="checkbox" class="smax-pref-toggle" data-key="${key}" ${prefs[key] ? 'checked' : ''}>
                  <span class="smax-toggle-track"></span>
                </label>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">☁️ Config. Compartilhada</div>
          <div class="smax-sp-muted" style="margin-bottom:10px;">
            Equipes e scripts carregados de um arquivo JSON público (GitHub). Todos os usuários que apontarem para a mesma URL recebem as mesmas configurações automaticamente.
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
            <input type="text" id="smax-shared-url-input" value="${Utils.escapeHtml(prefs.sharedConfigUrl || '')}"
              placeholder="https://raw.githubusercontent.com/..."
              style="flex:1;min-width:200px;padding:7px 10px;border-radius:7px;font-size:11px;box-sizing:border-box;">
            <button type="button" id="smax-shared-save-btn" style="padding:7px 14px;border:none;border-radius:7px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Salvar</button>
            <button type="button" id="smax-shared-refresh-btn" style="padding:7px 14px;border:1px solid var(--sp-border);border-radius:7px;background:var(--sp-surface-2);color:var(--sp-text);font-size:11px;cursor:pointer;">↺ Atualizar</button>
          </div>
          <div id="smax-shared-status" style="font-size:11px;color:var(--sp-text-muted);min-height:16px;"></div>
        </div>`;
    };

    const renderSectionEquipes = () => `<div style="display:flex;flex-direction:column;gap:14px;">${renderTeamsList()}</div>`;

    const renderSectionEspecialistas = () => {
      const allWorkers = [];
      currentTeams.forEach(t => (t.workers || []).forEach(w => allWorkers.push({ ...w, teamName: t.name || t.id })));
      if (!allWorkers.length) return `<div class="smax-sp-card"><div class="smax-sp-muted" style="text-align:center;padding:20px;">Nenhum especialista cadastrado nas equipes.</div></div>`;
      return `
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">Cores personalizadas por especialista</div>
          <div class="smax-sp-muted" style="margin-bottom:10px;">Cores salvas localmente — não afetam outros usuários.</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${allWorkers.map(w => {
              const normName = Utils.normalizeText(w.name || '');
              const myColor  = personal.myColors[normName] || {};
              const bgVal    = myColor.bg || '#1e293b';
              const fgVal    = myColor.fg || '#f8fafc';
              return `
                <div style="display:flex;gap:8px;align-items:center;padding:8px 10px;border:1px solid var(--sp-border);border-radius:8px;background:var(--sp-surface-2);flex-wrap:wrap;">
                  <div style="flex:1;min-width:100px;">
                    <div style="font-size:13px;font-weight:500;color:var(--sp-text);">${Utils.escapeHtml(w.name || '')}</div>
                    <div class="smax-sp-muted">${Utils.escapeHtml(w.teamName)}</div>
                  </div>
                  <label style="font-size:11px;color:var(--sp-text-muted);">Fundo</label>
                  <input type="color" class="smax-worker-color-bg" data-name="${Utils.escapeHtml(normName)}" value="${bgVal}" style="width:30px;height:26px;border:1px solid var(--sp-border);border-radius:4px;cursor:pointer;padding:1px;">
                  <label style="font-size:11px;color:var(--sp-text-muted);">Texto</label>
                  <input type="color" class="smax-worker-color-fg" data-name="${Utils.escapeHtml(normName)}" value="${fgVal}" style="width:30px;height:26px;border:1px solid var(--sp-border);border-radius:4px;cursor:pointer;padding:1px;">
                  <div class="smax-color-preview" data-name="${Utils.escapeHtml(normName)}" style="width:56px;height:24px;border-radius:6px;background:${bgVal};color:${fgVal};font-size:11px;display:flex;align-items:center;justify-content:center;font-weight:600;">
                    Prévia
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    };

    const renderSectionDestaque = () => `
      <div class="smax-sp-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div>
            <div class="smax-sp-section-title" style="margin-bottom:2px;">⭐ Usuários Destaque</div>
            <div class="smax-sp-muted">Lista pessoal — não compartilhada com a equipe. A linha inteira do chamado é destacada na fila.</div>
          </div>
          <button type="button" id="smax-det-add-btn" style="font-size:11px;padding:5px 12px;border-radius:6px;border:none;background:rgba(245,158,11,.12);color:#f59e0b;cursor:pointer;border:1px solid rgba(245,158,11,.3);">+ Adicionar</button>
        </div>
        <div id="smax-det-list" style="display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto;margin-bottom:4px;">
          ${(personal.myDestaque || []).length === 0
            ? `<div style="font-size:12px;color:var(--sp-text-dim);text-align:center;padding:24px;">Nenhum usuário destaque cadastrado.</div>`
            : (personal.myDestaque || []).map((name, i) => `
              <div class="smax-det-item">
                <span>⭐ ${Utils.escapeHtml(name)}</span>
                <button class="smax-det-del" data-idx="${i}">✕</button>
              </div>`).join('')
          }
        </div>
        <div id="smax-det-input-row" style="display:none;margin-top:8px;gap:6px;">
          <input type="text" id="smax-det-input" placeholder="Nome completo do usuário" style="flex:1;padding:7px 10px;border-radius:6px;font-size:12px;min-width:0;">
          <button type="button" id="smax-det-confirm" style="padding:7px 14px;border-radius:6px;border:none;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:12px;cursor:pointer;flex-shrink:0;">Salvar</button>
          <button type="button" id="smax-det-cancel" style="padding:7px 10px;border-radius:6px;border:1px solid var(--sp-border);background:var(--sp-surface);color:var(--sp-text-muted);font-size:12px;cursor:pointer;flex-shrink:0;">✕</button>
        </div>
      </div>`;

    const renderSectionTemplates = () => `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="smax-sp-card">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            <div class="smax-sp-section-title" style="margin-bottom:0;">📋 Scripts de Respostas</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button id="smax-tpl-clip-btn" title="Colar HTML do clipboard (OneNote, Word, etc.)" style="padding:6px 12px;border-radius:6px;border:1px solid var(--sp-border);background:var(--sp-surface);color:var(--sp-text);font-size:11px;cursor:pointer;">📎 Do clipboard</button>
              <button id="smax-tpl-export-btn" style="padding:6px 12px;border-radius:6px;border:1px solid var(--sp-border);background:var(--sp-surface);color:var(--sp-text);font-size:11px;cursor:pointer;">📤 Exportar JSON</button>
              <button id="smax-tpl-import-btn" style="padding:6px 12px;border-radius:6px;border:1px solid var(--sp-border);background:var(--sp-surface);color:var(--sp-text);font-size:11px;cursor:pointer;">📥 Importar JSON</button>
              <button id="smax-tpl-sync-btn" title="Importar scripts do Gerenciador de Chamados" style="padding:6px 12px;border-radius:6px;border:1px solid var(--sp-border);background:var(--sp-surface);color:var(--sp-text);font-size:11px;cursor:pointer;">☁️ Do Gerenciador</button>
              <button id="smax-tpl-new-btn" style="padding:6px 14px;border-radius:6px;border:none;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;font-size:11px;font-weight:600;cursor:pointer;">+ Novo</button>
            </div>
          </div>
          <div style="display:flex;gap:0;border-bottom:1px solid var(--sp-border);margin-bottom:10px;">
            <button class="smax-tpl-sp-tab active" data-disc="false" style="padding:7px 16px;border:none;border-bottom:2px solid var(--sp-primary,#38bdf8);background:none;color:var(--sp-primary,#38bdf8);font-size:12px;font-weight:600;cursor:pointer;">Solução</button>
            <button class="smax-tpl-sp-tab" data-disc="true" style="padding:7px 16px;border:none;border-bottom:2px solid transparent;background:none;color:var(--sp-text-muted);font-size:12px;cursor:pointer;">Discussão</button>
          </div>
          <div id="smax-tpl-sp-list" style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;min-height:40px;">
            <div style="color:var(--sp-text-dim);font-size:12px;text-align:center;padding:20px;">Carregando...</div>
          </div>
        </div>
        <div id="smax-tpl-sp-form" class="smax-sp-card" style="display:none;flex-direction:column;gap:10px;">
          <div class="smax-sp-section-title" style="margin-bottom:4px;">✏️ <span id="smax-tpl-sp-form-title-lbl">Novo script</span></div>
          <input id="smax-tpl-sp-title" type="text" placeholder="Título do script..." style="padding:8px 10px;border-radius:6px;font-size:13px;width:100%;box-sizing:border-box;">
          <div class="smax-sp-muted">Conteúdo (aceita HTML. Cole diretamente do OneNote, Word ou qualquer editor rico):</div>
          <textarea id="smax-tpl-sp-body" placeholder="Cole o conteúdo aqui ou escreva HTML..." style="min-height:140px;resize:vertical;padding:8px 10px;border-radius:6px;font-size:12px;font-family:'Segoe UI',system-ui,sans-serif;width:100%;box-sizing:border-box;line-height:1.5;"></textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
            <button id="smax-tpl-sp-cancel" style="padding:7px 14px;border-radius:6px;border:1px solid var(--sp-border);background:var(--sp-surface);color:var(--sp-text-muted);font-size:12px;cursor:pointer;">Cancelar</button>
            <button id="smax-tpl-sp-save" style="padding:7px 18px;border-radius:6px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Salvar script</button>
          </div>
        </div>
        <div id="smax-tpl-import-area" class="smax-sp-card" style="display:none;flex-direction:column;gap:8px;">
          <div class="smax-sp-section-title" style="margin-bottom:4px;">📥 Importar scripts (JSON)</div>
          <div class="smax-sp-muted">Cole o JSON exportado anteriormente:</div>
          <textarea id="smax-tpl-import-json-input" style="min-height:100px;resize:vertical;padding:8px 10px;border-radius:6px;font-size:11px;font-family:monospace;width:100%;box-sizing:border-box;"></textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="smax-tpl-import-cancel" style="padding:6px 12px;border-radius:6px;border:1px solid var(--sp-border);background:var(--sp-surface);color:var(--sp-text-muted);font-size:12px;cursor:pointer;">Cancelar</button>
            <button id="smax-tpl-import-confirm" style="padding:6px 14px;border-radius:6px;border:none;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;font-size:12px;font-weight:600;cursor:pointer;">Importar</button>
          </div>
        </div>
      </div>`;

    const renderSectionTriagem = () => `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">🎯 HUD de Triagem</div>
          <div class="smax-sp-muted" style="margin-bottom:14px;">
            Abre o painel de triagem sobre a lista de chamados. Navegue pelos chamados, defina urgência, atribua responsável e envie respostas rapidamente.<br>
            <strong style="color:var(--sp-text);font-size:11px;">Dica:</strong> filtre e ordene os chamados no SMAX antes de iniciar.
          </div>
          <button id="smax-launch-triage-btn" style="padding:12px 32px;border-radius:10px;border:none;cursor:pointer;font-size:15px;font-weight:700;background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);color:#fff;box-shadow:0 6px 20px rgba(59,130,246,.4),0 0 0 1px rgba(255,255,255,.1) inset;transition:transform .15s,box-shadow .15s;">
            🚀 Iniciar Triagem
          </button>
        </div>
        <div class="smax-sp-card">
          <div class="smax-sp-section-title" style="margin-bottom:8px;">⚙️ Opções de Triagem</div>
          <div class="smax-module-row${prefs.enlargeCommentsOn ? ' smax-active' : ''}" data-key="enlargeCommentsOn">
            <div class="smax-module-icon">💬</div>
            <div class="smax-module-info">
              <div class="smax-module-name">Comentários expandidos</div>
              <div class="smax-module-desc">Exibe todos os comentários do chamado sem limite de altura</div>
            </div>
            <label class="smax-toggle-sw" onclick="event.stopPropagation()">
              <input type="checkbox" class="smax-pref-toggle" data-key="enlargeCommentsOn" ${prefs.enlargeCommentsOn ? 'checked' : ''}>
              <span class="smax-toggle-track"></span>
            </label>
          </div>
        </div>
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">📖 Guia Rápido</div>
          <ul style="margin:4px 0 0;padding-left:18px;font-size:12px;color:var(--sp-text);line-height:1.7;">
            <li>Use os botões de urgência para definir impacto antes de atribuir.</li>
            <li>"Meus finais" limita a fila aos IDs desejados (ex: 0-32, 50).</li>
            <li>Edite a resposta rápida e clique ENVIAR para gravar tudo de uma vez.</li>
            <li>Os chamados são ordenados por VIP e mais antigos primeiro.</li>
            <li style="color:var(--sp-danger-text);font-weight:600;">CUIDADO: Vincular Global NÃO verifica se o número é válido.</li>
          </ul>
        </div>
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">📊 Log de Atividades</div>
          <div class="smax-sp-muted" style="margin-bottom:10px;">${ActivityLog.getCount()} registros armazenados localmente.</div>
          <button type="button" id="smax-log-export-all" style="padding:9px 18px;border-radius:8px;border:1px solid var(--sp-border);background:var(--sp-surface-2);color:var(--sp-text);font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">
            📥 Exportar CSV
          </button>
        </div>
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">🔧 Configuração JSON</div>
          <div class="smax-sp-muted" style="margin-bottom:10px;">Edite e clique Salvar. Copie para compartilhar com colegas.</div>
          <textarea id="smax-config-io-textarea" spellcheck="false"
            style="width:100%;min-height:180px;max-height:320px;resize:vertical;padding:10px 12px;border-radius:8px;font-size:11px;font-family:'Cascadia Code','Fira Code','Consolas',monospace;line-height:1.5;box-sizing:border-box;transition:border-color .15s ease;"></textarea>
          <div id="smax-config-io-status" style="font-size:11px;color:var(--sp-text-muted);min-height:16px;margin:8px 0;"></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button type="button" id="smax-config-copy-btn" style="padding:8px 14px;border-radius:8px;border:1px solid var(--sp-border);background:var(--sp-surface);color:var(--sp-text);font-size:12px;cursor:pointer;">📋 Copiar</button>
            <button type="button" id="smax-config-save-btn" style="padding:8px 14px;border-radius:8px;border:none;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:12px;cursor:pointer;box-shadow:0 4px 12px rgba(34,197,94,.35);font-weight:500;">💾 Salvar</button>
          </div>
        </div>
      </div>`;

    const renderSectionRespostas = () => `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">📨 Módulo de Respostas</div>
          <div class="smax-sp-muted" style="margin-bottom:14px;">
            Abre o painel de respostas em cima da tela atual. Selecione um colaborador, filtre por equipe e status, redija a solução com editor de texto e envie em lote.
          </div>
          <button id="smax-launch-resp-btn" style="padding:12px 32px;border-radius:10px;border:none;cursor:pointer;font-size:15px;font-weight:700;background:linear-gradient(135deg,#8b5cf6 0%,#6d28d9 100%);color:#fff;box-shadow:0 6px 20px rgba(139,92,246,.4),0 0 0 1px rgba(255,255,255,.1) inset;transition:transform .15s,box-shadow .15s;">
            📨 Abrir Respostas
          </button>
        </div>
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">📖 Como usar</div>
          <ul style="margin:4px 0 0;padding-left:18px;font-size:12px;color:var(--sp-text);line-height:1.7;">
            <li>Selecione as equipes e clique <strong>↺ Carregar</strong> para buscar os chamados.</li>
            <li>Filtre por status operacional (Ativo, Em Andamento, Aguardando…).</li>
            <li>Clique num chamado para ver descrição, discussões, anexos e redigir a solução.</li>
            <li>Use <strong>📋 Scripts de Respostas</strong> para inserir um texto pronto.</li>
            <li>Selecione vários chamados (checkbox) e clique <strong>ENVIAR</strong> para responder em lote.</li>
            <li>Use <strong>🔗 Vincular</strong> para vincular um ou vários chamados a um Global — sem especialista, a designação é automática.</li>
            <li>Use o campo <strong>🔍 Buscar por número</strong> (topo da lista) para carregar qualquer chamado pelo ID, mesmo fora da lista atual.</li>
            <li>Chamados VIP e usuários em destaque são sinalizados no cabeçalho do detalhe.</li>
            <li style="color:var(--sp-danger-text);font-weight:600;">CUIDADO: Vincular Global não verifica se o número informado é válido.</li>
          </ul>
        </div>
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">📤 Botões de Encaminhamento Rápido</div>
          <div class="smax-sp-muted" style="margin-bottom:10px;">Configure os botões exibidos ao alterar GSE com encaminhamento. Cada botão tem um rótulo e um texto pré-definido.</div>
          <div id="smax-fwd-btns-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;"></div>
          <button id="smax-fwd-btns-add" style="padding:4px 14px;border-radius:6px;border:1px solid var(--sp-border);background:var(--sp-surface-2);color:var(--sp-text);font-size:11px;cursor:pointer;">+ Adicionar</button>
        </div>
        <div class="smax-sp-card">
          <div class="smax-sp-section-title">📊 Relatório de Atividades</div>
          <div class="smax-sp-muted" style="margin-bottom:10px;">Filtre por período e veja um resumo das ações realizadas (respostas, vínculos, transferências…).</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
            <label style="font-size:11px;color:var(--sp-text-muted);">De:</label>
            <input type="date" id="smax-resp-report-from-sp" style="background:var(--sp-surface-2);border:1px solid var(--sp-border);border-radius:5px;padding:4px 8px;color:var(--sp-text);font-size:11px;outline:none;">
            <label style="font-size:11px;color:var(--sp-text-muted);">Até:</label>
            <input type="date" id="smax-resp-report-to-sp" style="background:var(--sp-surface-2);border:1px solid var(--sp-border);border-radius:5px;padding:4px 8px;color:var(--sp-text);font-size:11px;outline:none;">
            <button type="button" id="smax-resp-report-gen-sp" style="padding:5px 14px;border:none;border-radius:6px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Gerar</button>
            <button type="button" id="smax-resp-report-export-sp" style="padding:5px 14px;border:1px solid var(--sp-border);border-radius:6px;background:var(--sp-surface-2);color:var(--sp-text);font-size:11px;cursor:pointer;display:none;">⬇ Exportar CSV</button>
          </div>
          <div id="smax-resp-report-content-sp"></div>
        </div>
      </div>`;

    const renderSectionContent = () => {
      switch (activeSection) {
        case 'geral':         return renderSectionGeral();
        case 'equipes':       return renderSectionEquipes();
        case 'especialistas': return renderSectionEspecialistas();
        case 'destaque':      return renderSectionDestaque();
        case 'templates':     return renderSectionTemplates();
        case 'triagem':       return renderSectionTriagem();
        case 'respostas':     return renderSectionRespostas();
        default:              return renderSectionGeral();
      }
    };

    /* ── Per-section event wiring ── */

    const wireGeralEvents = () => {
      if (!container) return;
      const triadorSearch  = container.querySelector('#smax-triador-search');
      const triadorResults = container.querySelector('#smax-triador-results');

      if (triadorSearch && triadorResults) {
        const selectTriador = (personId, personName) => {
          prefs.myPersonId   = personId;
          prefs.myPersonName = personName;
          savePrefs();
          triadorSearch.value = '';
          triadorResults.style.display = 'none';
          renderPanel();
        };
        const renderTriadorResults = (term) => {
          const q = (term || '').trim().toUpperCase();
          triadorResults.style.display = q ? 'block' : 'none';
          if (!q) return;
          if (!DataRepository.peopleCache.size) {
            triadorResults.innerHTML = '<div style="padding:8px;color:#999;font-size:11px;">Carregando...</div>';
            return;
          }
          const people = [...DataRepository.peopleCache.values()];
          const matches = people.filter(p =>
            (p.name || '').toUpperCase().includes(q) || (p.upn || '').toUpperCase().includes(q)
          ).slice(0, 10);
          if (!matches.length) {
            triadorResults.innerHTML = '<div style="padding:8px;color:#999;font-size:11px;">Nenhum resultado.</div>';
          } else {
            triadorResults.innerHTML = matches.map(p => `
              <div class="smax-triador-pick" data-id="${p.id}" data-name="${Utils.escapeHtml(p.name)}"
                style="padding:6px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--sp-border,#eee);transition:background .1s;">
                <div style="font-weight:500;color:var(--sp-text);">${Utils.escapeHtml(p.name)}</div>
                <div style="color:var(--sp-text-muted);font-size:10px;">${Utils.escapeHtml(p.upn || p.id)}</div>
              </div>
            `).join('');
            triadorResults.querySelectorAll('.smax-triador-pick').forEach(el => {
              el.addEventListener('click', () => selectTriador(el.dataset.id, el.dataset.name));
            });
          }
        };
        triadorSearch.addEventListener('input', () => renderTriadorResults(triadorSearch.value));
        triadorSearch.addEventListener('focus', () => {
          DataRepository.ensurePeopleLoaded();
          if (triadorSearch.value) renderTriadorResults(triadorSearch.value);
        });
        triadorSearch.addEventListener('blur', () => setTimeout(() => { triadorResults.style.display = 'none'; }, 200));
      }

      // Row click (outside the pill) toggles the switch
      container.querySelectorAll('.smax-module-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.smax-toggle-sw')) return;
          const cb = row.querySelector('.smax-pref-toggle');
          if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        });
      });
      // Checkbox change: save state, update row style, trigger module
      container.querySelectorAll('.smax-pref-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
          const key = cb.dataset.key;
          if (!(key in prefs)) return;
          prefs[key] = cb.checked;
          savePrefs();
          const row = cb.closest('.smax-module-row');
          if (row) row.classList.toggle('smax-active', cb.checked);
          if (key === 'zenModeOn')      ZenMode.apply();
          if (key === 'radarOn' && cb.checked) RadarRevisar.query();
          if (key === 'flagSkullOn')    HighlightUser.applyAll();
          if (key === 'nameBadgesOn')   NameBadges.apply();
          if (key === 'collapseOn')     SectionTweaks.applyAll();
        });
      });

      // SharedConfig — salvar URL e atualizar
      const sharedStatusEl = container.querySelector('#smax-shared-status');
      const showSharedStatus = () => {
        if (!sharedStatusEl) return;
        const { text, loading } = SharedConfig.getStatus();
        sharedStatusEl.textContent = loading ? '⏳ ' + text : text;
      };
      showSharedStatus();

      container.querySelector('#smax-shared-save-btn')?.addEventListener('click', () => {
        const urlInput = container.querySelector('#smax-shared-url-input');
        const newUrl = (urlInput?.value || '').trim();
        prefs.sharedConfigUrl = newUrl;
        savePrefs();
        if (sharedStatusEl) sharedStatusEl.textContent = 'URL salva. Clique em Atualizar para buscar.';
      });

      container.querySelector('#smax-shared-refresh-btn')?.addEventListener('click', async () => {
        const urlInput = container.querySelector('#smax-shared-url-input');
        const newUrl = (urlInput?.value || '').trim();
        if (newUrl) { prefs.sharedConfigUrl = newUrl; savePrefs(); }
        if (sharedStatusEl) sharedStatusEl.textContent = '⏳ Buscando...';
        await SharedConfig.refresh(true);
        showSharedStatus();
      });
    };

    const wireEspecialistasEvents = () => {
      if (!container) return;
      container.querySelectorAll('.smax-worker-color-bg, .smax-worker-color-fg').forEach(input => {
        input.addEventListener('change', () => {
          const normName = input.dataset.name;
          const row = input.closest('div[style]');
          const bgInput = row?.querySelector(`.smax-worker-color-bg[data-name="${normName}"]`);
          const fgInput = row?.querySelector(`.smax-worker-color-fg[data-name="${normName}"]`);
          if (bgInput && fgInput) {
            personal.myColors[normName] = { bg: bgInput.value, fg: fgInput.value };
            savePersonal();
            ColorRegistry.clearCache();
            const preview = row.querySelector(`.smax-color-preview[data-name="${normName}"]`);
            if (preview) { preview.style.background = bgInput.value; preview.style.color = fgInput.value; }
          }
        });
      });
    };

    const wireDestaqueEvents = () => {
      if (!container) return;
      const detAddBtn   = container.querySelector('#smax-det-add-btn');
      const detInputRow = container.querySelector('#smax-det-input-row');
      const detInput    = container.querySelector('#smax-det-input');
      const detConfirm  = container.querySelector('#smax-det-confirm');
      const detCancel   = container.querySelector('#smax-det-cancel');
      if (detAddBtn) detAddBtn.addEventListener('click', () => { detInputRow.style.display = 'flex'; detInput?.focus(); });
      if (detCancel) detCancel.addEventListener('click', () => { detInputRow.style.display = 'none'; if (detInput) detInput.value = ''; });
      if (detConfirm) detConfirm.addEventListener('click', () => {
        const name = (detInput?.value || '').trim();
        if (!name) return;
        if (!Array.isArray(personal.myDestaque)) personal.myDestaque = [];
        if (!personal.myDestaque.includes(name)) personal.myDestaque.push(name);
        savePersonal();
        renderPanel();
      });
      if (detInput) detInput.addEventListener('keydown', e => { if (e.key === 'Enter') detConfirm?.click(); });
      container.querySelectorAll('.smax-det-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx, 10);
          if (!isNaN(idx)) { personal.myDestaque.splice(idx, 1); savePersonal(); renderPanel(); }
        });
      });
    };

    const wireTemplatesEvents = () => {
      if (!container) return;
      let tplActiveDisc = false;
      let tplEditingIdx = null;

      const getTplList = () => container.querySelector('#smax-tpl-sp-list');
      const getForm    = () => container.querySelector('#smax-tpl-sp-form');
      const getImport  = () => container.querySelector('#smax-tpl-import-area');

      const renderTplList = () => {
        const listEl = getTplList();
        if (!listEl) return;
        const items = Templates.load(tplActiveDisc);
        if (!items.length) {
          listEl.innerHTML = `<div style="color:var(--sp-text-dim);font-size:12px;text-align:center;padding:20px;">Nenhum script. Clique em "+ Novo" para criar.</div>`;
          return;
        }
        listEl.innerHTML = items.map((t, i) => `
          <div class="smax-tpl-sp-item" data-idx="${i}" style="display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--sp-border);border-radius:8px;background:var(--sp-surface-2);cursor:pointer;transition:border-color .15s,background .15s;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:var(--sp-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Utils.escapeHtml(t.title)}</div>
              <div style="font-size:11px;color:var(--sp-text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Utils.escapeHtml((t.html||'').replace(/<[^>]+>/g,' ').trim().slice(0,80))}</div>
            </div>
            <button class="smax-tpl-sp-use" data-idx="${i}" title="Inserir no editor" style="flex-shrink:0;padding:4px 10px;border-radius:5px;border:none;background:var(--sp-primary-bg);color:var(--sp-primary);font-size:11px;font-weight:600;cursor:pointer;">Usar</button>
            <button class="smax-tpl-sp-edit-btn" data-idx="${i}" title="Editar" style="flex-shrink:0;padding:4px 8px;border-radius:5px;border:1px solid var(--sp-border);background:none;color:var(--sp-text-muted);font-size:11px;cursor:pointer;">✏️</button>
            <button class="smax-tpl-sp-del-btn" data-idx="${i}" title="Excluir" style="flex-shrink:0;padding:4px 8px;border-radius:5px;border:1px solid var(--sp-danger-border);background:var(--sp-danger-bg);color:var(--sp-danger-text);font-size:11px;cursor:pointer;">✕</button>
          </div>
        `).join('');

        listEl.querySelectorAll('.smax-tpl-sp-use').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx, 10);
            const tpl = Templates.load(tplActiveDisc)[idx];
            if (!tpl) return;

            // Fechar painel primeiro para que o CKEditor possa receber foco
            container.style.display = 'none';
            const bd = document.getElementById('smax-settings-backdrop');
            if (bd) bd.style.display = 'none';

            // pushSolutionHtml: abre o editor se necessário e insere com retry
            const ok = await Utils.pushSolutionHtml(tpl.html);
            if (!ok) {
              // Fallback: insere no último editor ativo sem foco
              const ck = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window)?.CKEDITOR;
              if (ck) {
                const instances = Object.values(ck.instances || {});
                const last = instances[instances.length - 1];
                if (last) { last.insertHtml(tpl.html); return; }
              }
              // Último recurso: copiar para clipboard
              navigator.clipboard?.writeText(tpl.html).catch(() => {});
              const toast = document.createElement('div');
              toast.textContent = '📋 Template copiado — cole no campo de resposta (Ctrl+V)';
              toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#f8fafc;padding:11px 22px;border-radius:10px;font-size:13px;z-index:9999999;box-shadow:0 4px 18px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.1);';
              document.body.appendChild(toast);
              setTimeout(() => toast.remove(), 3500);
            }
          });
        });
        listEl.querySelectorAll('.smax-tpl-sp-edit-btn').forEach(btn => {
          btn.addEventListener('click', (e) => { e.stopPropagation(); openTplForm(parseInt(btn.dataset.idx, 10)); });
        });
        listEl.querySelectorAll('.smax-tpl-sp-del-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx, 10);
            const arr = Templates.load(tplActiveDisc);
            if (confirm(`Excluir "${arr[idx]?.title}"?`)) {
              arr.splice(idx, 1);
              Templates.save(tplActiveDisc, arr);
              renderTplList();
            }
          });
        });
      };

      const openTplForm = (idx = null) => {
        tplEditingIdx = idx;
        const formEl = getForm();
        if (!formEl) return;
        const arr = Templates.load(tplActiveDisc);
        const tpl = idx !== null ? arr[idx] : null;
        formEl.querySelector('#smax-tpl-sp-form-title-lbl').textContent = idx !== null ? 'Editar script' : 'Novo script';
        formEl.querySelector('#smax-tpl-sp-title').value = tpl?.title || '';
        formEl.querySelector('#smax-tpl-sp-body').value  = tpl?.html  || '';
        formEl.style.display = 'flex';
        formEl.querySelector('#smax-tpl-sp-title').focus();
        // Hide import area
        const imp = getImport(); if (imp) imp.style.display = 'none';
      };

      const closeTplForm = () => {
        tplEditingIdx = null;
        const formEl = getForm(); if (formEl) formEl.style.display = 'none';
      };

      const saveTplForm = () => {
        const formEl = getForm(); if (!formEl) return;
        const title = (formEl.querySelector('#smax-tpl-sp-title').value || '').trim();
        const html  = (formEl.querySelector('#smax-tpl-sp-body').value  || '').trim();
        if (!title) { alert('Informe um título para o script.'); return; }
        const arr = Templates.load(tplActiveDisc);
        if (tplEditingIdx !== null) arr[tplEditingIdx] = { title, html };
        else arr.push({ title, html });
        Templates.save(tplActiveDisc, arr);
        closeTplForm();
        renderTplList();
      };

      // Tabs
      container.querySelectorAll('.smax-tpl-sp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tplActiveDisc = tab.dataset.disc === 'true';
          container.querySelectorAll('.smax-tpl-sp-tab').forEach(t => {
            const isActive = t === tab;
            t.style.borderBottomColor  = isActive ? 'var(--sp-primary,#38bdf8)' : 'transparent';
            t.style.color = isActive ? 'var(--sp-primary,#38bdf8)' : 'var(--sp-text-muted)';
            t.style.fontWeight = isActive ? '600' : '400';
            if (isActive) t.classList.add('active'); else t.classList.remove('active');
          });
          closeTplForm();
          renderTplList();
        });
      });

      // New button
      container.querySelector('#smax-tpl-new-btn')?.addEventListener('click', () => openTplForm(null));

      // Form buttons
      container.querySelector('#smax-tpl-sp-save')?.addEventListener('click', saveTplForm);
      container.querySelector('#smax-tpl-sp-cancel')?.addEventListener('click', closeTplForm);

      // Paste from clipboard (OneNote / Word rich HTML)
      container.querySelector('#smax-tpl-clip-btn')?.addEventListener('click', async () => {
        openTplForm(null);
        const bodyEl = container.querySelector('#smax-tpl-sp-body');
        if (!bodyEl) return;
        try {
          // Tenta ler HTML do clipboard (Chrome 86+, Firefox 127+)
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes('text/html')) {
              const blob = await item.getType('text/html');
              const html = await blob.text();
              bodyEl.value = html;
              return;
            }
          }
          // Fallback: plain text
          const text = await navigator.clipboard.readText();
          bodyEl.value = text;
        } catch {
          // Fallback silencioso: usuário pode colar manualmente no campo
          bodyEl.placeholder = 'Cole o conteúdo aqui com Ctrl+V...';
          bodyEl.focus();
        }
      });

      // Sync from Gerenciador de Chamados (Supabase)
      container.querySelector('#smax-tpl-sync-btn')?.addEventListener('click', async () => {
        const btn = container.querySelector('#smax-tpl-sync-btn');
        const origLabel = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Importando...'; }
        try {
          const equipeId = await GM_getValue('smax_gerenciador_equipe_id', null);
          let url = `${SMAX_SB_URL}/rest/v1/scripts_customizados?select=nome,conteudo_bruto&deletado=eq.false&order=nome`;
          if (equipeId) url += `&equipe_id=eq.${equipeId}`;
          const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${SMAX_SB_KEY}`, 'apikey': SMAX_SB_KEY, 'Accept': 'application/json' }
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const scripts = await resp.json();
          if (!Array.isArray(scripts)) throw new Error('Resposta inesperada da API');
          const arr = Templates.load(tplActiveDisc);
          let added = 0;
          scripts.forEach(s => {
            if (s.nome && s.conteudo_bruto && !arr.find(t => t.title === s.nome)) {
              arr.push({ title: s.nome, html: s.conteudo_bruto });
              added++;
            }
          });
          Templates.save(tplActiveDisc, arr);
          renderTplList();
          alert(`✅ ${added} script(s) importado(s). ${scripts.length - added} já existiam.`);
        } catch(e) {
          alert('Erro ao importar do Gerenciador: ' + e.message + (e.message.includes('equipe') ? '\n\nDica: abra o Gerenciador de Chamados uma vez para sincronizar sua equipe.' : ''));
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = origLabel; }
        }
      });

      // Export JSON
      container.querySelector('#smax-tpl-export-btn')?.addEventListener('click', () => {
        const data = { sol: Templates.load(false), disc: Templates.load(true) };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'smax_templates.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });

      // Import JSON — show textarea
      container.querySelector('#smax-tpl-import-btn')?.addEventListener('click', () => {
        const imp = getImport(); if (!imp) return;
        imp.style.display = imp.style.display === 'flex' ? 'none' : 'flex';
        closeTplForm();
      });
      container.querySelector('#smax-tpl-import-cancel')?.addEventListener('click', () => {
        const imp = getImport(); if (imp) imp.style.display = 'none';
      });
      container.querySelector('#smax-tpl-import-confirm')?.addEventListener('click', () => {
        const raw = (container.querySelector('#smax-tpl-import-json-input')?.value || '').trim();
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            // Format: array of {title, html}
            const arr = Templates.load(tplActiveDisc);
            parsed.forEach(t => { if (t.title) arr.push(t); });
            Templates.save(tplActiveDisc, arr);
          } else if (parsed.sol || parsed.disc) {
            // Format: {sol:[...], disc:[...]}
            if (Array.isArray(parsed.sol))  { const s = Templates.load(false); parsed.sol.forEach(t => s.push(t));  Templates.save(false, s); }
            if (Array.isArray(parsed.disc)) { const d = Templates.load(true);  parsed.disc.forEach(t => d.push(t)); Templates.save(true,  d); }
          }
          const imp = getImport(); if (imp) imp.style.display = 'none';
          renderTplList();
          alert('Scripts importados com sucesso!');
        } catch(e) { alert('JSON inválido: ' + e.message); }
      });

      // Initial render
      renderTplList();
    };

    const wireTriagemEvents = () => {
      if (!container) return;

      // Triagem option toggles (same pattern as wireGeralEvents)
      container.querySelectorAll('.smax-module-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.smax-toggle-sw')) return;
          const cb = row.querySelector('.smax-pref-toggle');
          if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        });
      });
      container.querySelectorAll('.smax-pref-toggle').forEach(cb => {
        cb.addEventListener('change', () => {
          const key = cb.dataset.key;
          if (!(key in prefs)) return;
          prefs[key] = cb.checked;
          savePrefs();
          const row = cb.closest('.smax-module-row');
          if (row) row.classList.toggle('smax-active', cb.checked);
          if (key === 'enlargeCommentsOn') CommentExpander.expandAll();
        });
      });

      // Launch triage
      const launchBtn = container.querySelector('#smax-launch-triage-btn');
      if (launchBtn) {
        launchBtn.addEventListener('mouseenter', () => { launchBtn.style.transform = 'translateY(-2px)'; launchBtn.style.boxShadow = '0 10px 28px rgba(59,130,246,.55),0 0 0 1px rgba(255,255,255,.15) inset'; });
        launchBtn.addEventListener('mouseleave', () => { launchBtn.style.transform = ''; launchBtn.style.boxShadow = ''; });
        launchBtn.addEventListener('click', () => {
          container.style.display = 'none';
          const bd = document.getElementById('smax-settings-backdrop');
          if (bd) bd.style.display = 'none';
          TriageHUD.open();
        });
      }

      // Log + config (reuse same logic)
      const textarea = container.querySelector('#smax-config-io-textarea');
      const statusEl = container.querySelector('#smax-config-io-status');
      const copyBtn  = container.querySelector('#smax-config-copy-btn');
      const saveBtn  = container.querySelector('#smax-config-save-btn');
      const logBtn   = container.querySelector('#smax-log-export-all');

      if (textarea) textarea.value = buildConfigJSON();

      const setIOStatus = (msg, color) => {
        if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || 'var(--sp-text-muted)'; }
      };
      if (logBtn) logBtn.addEventListener('click', () => ActivityLog.exportCsv());
      if (copyBtn) copyBtn.addEventListener('click', () => {
        if (!textarea?.value.trim()) return;
        navigator.clipboard.writeText(textarea.value)
          .then(() => setIOStatus('Copiado! ✓', '#4ade80'))
          .catch(() => { textarea.select(); document.execCommand('copy'); setIOStatus('Copiado! ✓', '#4ade80'); });
      });
      if (saveBtn) saveBtn.addEventListener('click', () => {
        const raw = (textarea?.value || '').trim();
        if (!raw) { setIOStatus('O campo está vazio.', '#fca5a5'); return; }
        const result = applyConfigJSON(raw);
        setIOStatus(result.msg, result.ok ? '#4ade80' : '#fca5a5');
        if (result.ok) setTimeout(() => renderPanel(), 300);
      });
    };

    const wireRespostasEvents = () => {
      if (!container) return;

      // ── Botões de encaminhamento rápido ──
      const fwdListEl = container.querySelector('#smax-fwd-btns-list');
      const fwdAddBtn = container.querySelector('#smax-fwd-btns-add');

      const getForwardingButtons = () => {
        try { return JSON.parse(prefs.forwardingButtonsRaw || '[]'); } catch { return []; }
      };
      const saveForwardingButtons = () => {
        const rows = fwdListEl ? fwdListEl.querySelectorAll('.smax-fwd-btn-row') : [];
        const btns = Array.from(rows).map(row => ({
          label: row.querySelector('.smax-fwd-btn-label')?.value?.trim() || '',
          text:  row.querySelector('.smax-fwd-btn-text')?.value?.trim()  || '',
        })).filter(b => b.label || b.text);
        prefs.forwardingButtonsRaw = JSON.stringify(btns);
        savePrefs();
      };
      const renderForwardingRow = (btn, idx) => {
        const row = document.createElement('div');
        row.className = 'smax-fwd-btn-row';
        row.style.cssText = 'display:flex;align-items:flex-start;gap:5px;margin-bottom:6px;';
        row.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;">
            <input class="smax-fwd-btn-label" placeholder="Rótulo" value="${Utils.escapeHtml(btn.label || '')}"
              style="width:110px;padding:4px 7px;border-radius:5px;border:1px solid var(--sp-border);background:var(--sp-surface-2);color:var(--sp-text);font-size:11px;outline:none;">
            <button class="smax-fwd-btn-remove" style="padding:2px 8px;border-radius:5px;border:1px solid rgba(248,113,113,.35);background:rgba(248,113,113,.1);color:#f87171;font-size:12px;cursor:pointer;">× Remover</button>
          </div>
          <textarea class="smax-fwd-btn-text" placeholder="Texto de encaminhamento (pode ser elaborado, com múltiplas linhas)..."
            style="flex:1;min-height:72px;padding:5px 7px;border-radius:5px;border:1px solid var(--sp-border);background:var(--sp-surface-2);color:var(--sp-text);font-size:11px;outline:none;resize:vertical;line-height:1.5;font-family:inherit;">${Utils.escapeHtml(btn.text || '')}</textarea>`;
        row.querySelector('.smax-fwd-btn-label')?.addEventListener('input', saveForwardingButtons);
        row.querySelector('.smax-fwd-btn-text')?.addEventListener('input', saveForwardingButtons);
        row.querySelector('.smax-fwd-btn-remove')?.addEventListener('click', () => { row.remove(); saveForwardingButtons(); });
        return row;
      };
      const renderForwardingList = () => {
        if (!fwdListEl) return;
        fwdListEl.innerHTML = '';
        getForwardingButtons().forEach((btn, i) => fwdListEl.appendChild(renderForwardingRow(btn, i)));
      };
      renderForwardingList();
      fwdAddBtn?.addEventListener('click', () => {
        if (!fwdListEl) return;
        fwdListEl.appendChild(renderForwardingRow({ label: '', text: '' }, fwdListEl.children.length));
      });

      const launchBtn = container.querySelector('#smax-launch-resp-btn');
      if (launchBtn) {
        launchBtn.addEventListener('mouseenter', () => { launchBtn.style.transform = 'translateY(-2px)'; launchBtn.style.boxShadow = '0 10px 28px rgba(139,92,246,.55),0 0 0 1px rgba(255,255,255,.15) inset'; });
        launchBtn.addEventListener('mouseleave', () => { launchBtn.style.transform = ''; launchBtn.style.boxShadow = ''; });
        launchBtn.addEventListener('click', () => {
          container.style.display = 'none';
          const bd = document.getElementById('smax-settings-backdrop');
          if (bd) bd.style.display = 'none';
          ResponseHUD.open();
        });
      }

      // Pré-preenche datas ao renderizar
      const today = new Date();
      const pad = n => String(n).padStart(2, '0');
      const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const toInput = container.querySelector('#smax-resp-report-to-sp');
      const fromInput = container.querySelector('#smax-resp-report-from-sp');
      if (toInput && !toInput.value) toInput.value = fmt(today);
      if (fromInput && !fromInput.value) {
        const from = new Date(today); from.setDate(from.getDate() - 30);
        fromInput.value = fmt(from);
      }

      const genBtn = container.querySelector('#smax-resp-report-gen-sp');
      const exportBtn = container.querySelector('#smax-resp-report-export-sp');
      const contentEl = container.querySelector('#smax-resp-report-content-sp');

      genBtn?.addEventListener('click', async () => {
        const fromVal = fromInput?.value;
        const toVal = toInput?.value;
        if (!fromVal || !toVal || !contentEl) return;
        const fromTs = new Date(fromVal + 'T00:00:00').getTime();
        const toTs = new Date(toVal + 'T23:59:59').getTime();
        genBtn.disabled = true;
        genBtn.textContent = '…';
        contentEl.innerHTML = '<div style="color:var(--sp-text-muted);font-size:12px;padding:10px 0;">Consultando Supabase…</div>';
        let entries, source;
        try {
          entries = await ActivityLog.fetchFromSupabase(fromTs, toTs);
          source = '☁ Supabase';
        } catch (e) {
          console.warn('[SMAX] Supabase fetch failed, using local:', e);
          entries = ActivityLog.getEntries().filter(e => e.ts >= fromTs && e.ts <= toTs);
          source = '⚠ Local';
        }
        genBtn.disabled = false;
        genBtn.textContent = 'Gerar';
        if (!entries.length) {
          contentEl.innerHTML = '<div style="color:var(--sp-text-muted);font-size:12px;padding:10px 0;">Nenhuma atividade no período.</div>';
          if (exportBtn) exportBtn.style.display = 'none';
          return;
        }
        const counts = { RESPONDIDO: 0, VINCULO_GLOBAL: 0, TRANSFERIDO: 0, DESIGNADO: 0, OUTRO: 0 };
        for (const e of entries) counts[e.relevantWork] = (counts[e.relevantWork] || 0) + 1;
        const uniqueTickets = new Set(entries.map(e => e.ticketId)).size;
        const pad2 = n => String(n).padStart(2, '0');
        const fmtTs = ts => { const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
        const summaryHtml = `
          <div style="font-size:10px;color:var(--sp-text-muted);margin-bottom:8px;">Fonte: <b>${source}</b> — ${entries.length} registro(s)</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
            ${[['Respondidos','RESPONDIDO','#4ade80'],['Vinc. Global','VINCULO_GLOBAL','#60a5fa'],['Transferidos','TRANSFERIDO','#c084fc'],['Designados','DESIGNADO','#fbbf24'],['Outros','OUTRO','#6b7280']].map(([label, key, color]) =>
              `<div style="background:var(--sp-surface-2);border:1px solid var(--sp-border);border-radius:8px;padding:6px 12px;text-align:center;">
                <div style="font-size:16px;font-weight:700;color:${color};">${counts[key]||0}</div>
                <div style="font-size:10px;color:var(--sp-text-muted);">${label}</div>
              </div>`
            ).join('')}
            <div style="background:var(--sp-surface-2);border:1px solid var(--sp-border);border-radius:8px;padding:6px 12px;text-align:center;">
              <div style="font-size:16px;font-weight:700;color:var(--sp-text);">${uniqueTickets}</div>
              <div style="font-size:10px;color:var(--sp-text-muted);">Chamados únicos</div>
            </div>
            <div style="background:var(--sp-surface-2);border:1px solid var(--sp-border);border-radius:8px;padding:6px 12px;text-align:center;">
              <div style="font-size:16px;font-weight:700;color:var(--sp-text);">${entries.length}</div>
              <div style="font-size:10px;color:var(--sp-text-muted);">Total ações</div>
            </div>
          </div>
          <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="background:var(--sp-surface-2);">
              <th style="padding:5px 8px;text-align:left;color:var(--sp-text-muted);font-weight:600;white-space:nowrap;">Data/Hora</th>
              <th style="padding:5px 8px;text-align:left;color:var(--sp-text-muted);font-weight:600;">Chamado</th>
              <th style="padding:5px 8px;text-align:left;color:var(--sp-text-muted);font-weight:600;">Descrição</th>
              <th style="padding:5px 8px;text-align:left;color:var(--sp-text-muted);font-weight:600;">Ação</th>
              <th style="padding:5px 8px;text-align:left;color:var(--sp-text-muted);font-weight:600;">Detalhe</th>
              <th style="padding:5px 8px;text-align:left;color:var(--sp-text-muted);font-weight:600;">Usuário</th>
            </tr></thead>
            <tbody>${entries.slice().reverse().map((e, i) => {
              const desc = (DataRepository.triageCache.get(e.ticketId)?.subjectText || '').slice(0, 60);
              const detalhe = e.globalChangeId ? `→ Global #${e.globalChangeId}` : e.transferredTo ? `→ ${e.transferredTo}` : e.assignedTo ? `→ ${e.assignedTo}` : '';
              return `<tr style="background:${i%2===0?'transparent':'var(--sp-surface-2)'};border-bottom:1px solid var(--sp-border);">
                <td style="padding:4px 8px;color:var(--sp-text-muted);white-space:nowrap;">${fmtTs(e.ts)}</td>
                <td style="padding:4px 8px;color:#60a5fa;white-space:nowrap;">#${Utils.escapeHtml(e.ticketId)}</td>
                <td style="padding:4px 8px;color:var(--sp-text);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.escapeHtml(desc)}">${Utils.escapeHtml(desc)}</td>
                <td style="padding:4px 8px;color:var(--sp-text);white-space:nowrap;">${Utils.escapeHtml(e.relevantWork)}</td>
                <td style="padding:4px 8px;color:var(--sp-text-muted);white-space:nowrap;">${Utils.escapeHtml(detalhe)}</td>
                <td style="padding:4px 8px;color:var(--sp-text-muted);white-space:nowrap;">${Utils.escapeHtml(e.user||'')}</td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>
          </div>`;
        contentEl.innerHTML = summaryHtml;
        if (exportBtn) { exportBtn.style.display = ''; exportBtn._filteredEntries = entries; }
      });

      exportBtn?.addEventListener('click', function() {
        const entriesToExport = this._filteredEntries;
        if (!entriesToExport?.length) return;
        const pad2 = n => String(n).padStart(2, '0');
        const fmtFull = ts => { const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
        const esc = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
        const headers = ['Data/Hora','Chamado','Descrição','Ação','Atribuído Para','Global','Transferido Para','Respondido','Script','Usuário','Sucesso'];
        const rows = entriesToExport.map(e => {
          const desc = (DataRepository.triageCache.get(e.ticketId)?.subjectText || '');
          return [
            fmtFull(e.ts), e.ticketId, desc, e.relevantWork, e.assignedTo||'', e.globalChangeId||'',
            e.transferredTo||'', e.answered?'Sim':'Não', e.usedScript?'Sim':'Não', e.user||'', e.success?'Sim':'Não'
          ].map(esc).join(',');
        });
        const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const now = new Date();
        const fn = `smax_relatorio_${pad2(now.getDate())}-${pad2(now.getMonth()+1)}-${now.getFullYear()}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fn;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
    };

    /* ── Main render ── */

    const renderPanel = () => {
      if (!container) return;

      container.innerHTML = `
        ${renderHeader()}
        <div style="display:flex;flex:1;min-height:0;overflow:hidden;">
          ${renderSidebar()}
          <div id="smax-settings-content">
            ${renderSectionContent()}
          </div>
        </div>
      `;

      // Header button events
      const themeToggleBtn = container.querySelector('#smax-theme-toggle-btn');
      if (themeToggleBtn) themeToggleBtn.addEventListener('click', ThemeManager.toggle);
      const panelCloseBtn = container.querySelector('#smax-settings-close-btn');
      if (panelCloseBtn) panelCloseBtn.addEventListener('click', () => {
        container.style.display = 'none';
        const bd = document.getElementById('smax-settings-backdrop');
        if (bd) bd.style.display = 'none';
      });

      // Sidebar navigation
      container.querySelectorAll('.smax-sidebar-item').forEach(btn => {
        btn.addEventListener('click', () => {
          activeSection = btn.dataset.section;
          editingTeamId = null;
          renderPanel();
        });
      });

      // Section event wiring
      switch (activeSection) {
        case 'geral':         wireGeralEvents();         break;
        case 'equipes':       wireTeamEvents();          break;
        case 'especialistas': wireEspecialistasEvents(); break;
        case 'destaque':      wireDestaqueEvents();      break;
        case 'templates':     wireTemplatesEvents();     break;
        case 'triagem':       wireTriagemEvents();       break;
        case 'respostas':     wireRespostasEvents();     break;
      }
    };

    const init = () => {
      if (container) return;
      toggleBtn = document.createElement('button');
      toggleBtn.id = 'smax-settings-btn';
      toggleBtn.textContent = '⚙️';
      toggleBtn.title = 'Configurações';
      Object.assign(toggleBtn.style, { position: 'fixed', right: '12px', bottom: '12px', zIndex: 999999, border: 'none' });
      document.body.appendChild(toggleBtn);

      const backdropEl = document.createElement('div');
      backdropEl.id = 'smax-settings-backdrop';
      backdropEl.style.cssText = 'position:fixed;inset:0;z-index:999998;display:none;background:rgba(0,0,0,0.38);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);transition:opacity .2s;';
      document.body.appendChild(backdropEl);

      container = document.createElement('div');
      container.id = 'smax-settings';
      Object.assign(container.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        bottom: '0',
        left: 'auto',
        width: '50vw',
        height: '100vh',
        zIndex: '999999',
        borderRadius: '0',
        boxShadow: '-6px 0 40px rgba(0,0,0,0.45)',
        display: 'none',
        fontSize: '14px',
        flexDirection: 'column',
        overflow: 'hidden',
      });
      document.body.appendChild(container);

      const openPanel = () => {
        DataRepository.ensurePeopleLoaded();
        reloadConfig();
        renderPanel();
        container.style.display = 'flex';
        backdropEl.style.display = 'block';
        ThemeManager.init();
      };
      const closePanel = () => {
        container.style.display = 'none';
        backdropEl.style.display = 'none';
      };

      backdropEl.addEventListener('click', closePanel);

      toggleBtn.addEventListener('click', () => {
        const visible = container.style.display === 'flex';
        if (!visible) openPanel(); else closePanel();
      });
    };

    return { init, renderPanel };
  })();

  /* =========================================================
   * Comment auto height
   * =======================================================*/
  const CommentExpander = (() => {
    const expandAll = () => {
      if (!prefs.enlargeCommentsOn) return;
      document.querySelectorAll('.comment-items').forEach(el => {
        el.style.height = 'auto';
        el.style.maxHeight = 'none';
      });
    };

    const init = () => {
      // Observer always registered — pref check is inside callback
      const obs = new MutationObserver((mutations) => {
        if (!prefs.enlargeCommentsOn) return;
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
      expandAll();
      window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
    };
    return { init, expandAll };
  })();

  /* =========================================================
   * Section tweaks (collapse catalogue block)
   * =======================================================*/
  const SectionTweaks = (() => {
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
      if (!prefs.collapseOn) return; // pref check here, not in init
      document.querySelectorAll(SECTION_SELECTOR).forEach(collapseSectionOnce);
      removeSections();
    };

    const init = () => {
      // Click tracking: mark sections the user manually interacted with
      document.addEventListener('click', (event) => {
        const header = event.target.closest('.pl-entity-page-component-header[role="button"]');
        if (!header) return;
        const section = header.closest('#form-section-5, [data-aid="section-catalog-offering"]');
        if (section) section.dataset.userInteracted = '1';
      }, { capture: true });

      // Observer always registered — pref check is inside applyAll
      const schedule = Utils.debounce(applyAll, 100);
      const obs = new MutationObserver(() => schedule());
      setTimeout(applyAll, 300);
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
    };

    return { init, applyAll };
  })();

  /* =========================================================
   * Orchestrator for repeated UI refresh
   * =======================================================*/
  const Orchestrator = (() => {
    const runAll = () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(NameBadges.apply, { timeout: 500 });
        requestIdleCallback(HighlightUser.applyAll, { timeout: 500 });
      } else {
        setTimeout(NameBadges.apply, 0);
        setTimeout(HighlightUser.applyAll, 0);
      }
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
   * Highlight user — destaque âmbar na lista de chamados
   * =======================================================*/
  const HighlightUser = (() => {
    const isHighlighted = (nameRaw) => {
      const key = Utils.normalizeText(nameRaw);
      if (!key || key.length < 3) return false;
      const list = (personal.myDestaque || []).map(Utils.normalizeText).filter(Boolean);
      return list.some(d => d === key || (key.length >= 8 && d.length >= 4 && (key.includes(d) || d.includes(key))));
    };

    // Applies (or removes) amber highlight on a single .slick-row.
    // SlickGrid reuses row elements during scroll — so we always re-evaluate, never cache on the row.
    const applyRow = (row) => {
      try {
        if (!(row instanceof HTMLElement)) return;
        const cells = row.querySelectorAll('.slick-cell');
        let found = false;
        cells.forEach(cell => {
          if (found) return;
          const text = (cell.textContent || '').trim();
          if (text && isHighlighted(text)) found = true;
        });
        if (found) {
          row.style.setProperty('background', 'linear-gradient(90deg, rgba(251,191,36,.18) 0%, rgba(245,158,11,.07) 100%)', 'important');
          row.style.setProperty('box-shadow', 'inset 3px 0 0 #f59e0b', 'important');
        } else {
          row.style.removeProperty('background');
          row.style.removeProperty('box-shadow');
        }
      } catch { }
    };

    const applyAll = () => {
      if (!prefs.flagSkullOn) return;
      if (!Utils.isListPage()) return; // only on list page, not on ticket detail
      Utils.getGridViewport().querySelectorAll('.slick-row').forEach(applyRow);
    };

    const init = () => {
      // Observer always registered — pref check is inside applyAll
      const obs = new MutationObserver(Utils.debounce(applyAll, 200));
      obs.observe(document.body, { childList: true, subtree: true });
      applyAll();
      window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
    };

    return { init, applyAll, isHighlighted };
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

    const QUICK_REPLY_MAX_ATTEMPTS = 60; // ~50s máximo de polling
    const scheduleQuickReplyEditor = () => {
      if (quickReplyEditor) return;
      if (quickReplyEditorPollTimer) clearTimeout(quickReplyEditorPollTimer);
      quickReplyEditorAttempts += 1;
      if (quickReplyEditorAttempts > QUICK_REPLY_MAX_ATTEMPTS) {
        quickReplyEditorPollTimer = null;
        console.warn('[SMAX] scheduleQuickReplyEditor: CKEditor não encontrado após', QUICK_REPLY_MAX_ATTEMPTS, 'tentativas. Polling encerrado.');
        return;
      }
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
              ? `<span data-smax-proc="${Utils.escapeHtml(displayProcNum)}" style="color:#38bdf8;font-family:monospace;font-weight:600;border-bottom:1px dotted rgba(56,189,248,.6);cursor:pointer;" title="Consultar processo no eProc: ${Utils.escapeHtml(displayProcNum)}">${Utils.escapeHtml(displayProcNum)}</span>`
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
      if (backdrop) return; // já inicializado
      hookNativeEditors();
      // Botão flutuante removido — triagem iniciada pelo painel de configurações
      startBtn = null;

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

      if (startBtn) startBtn.addEventListener('click', openHud);
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

    return { init, open: openHud };
  })();

  /* =========================================================
   * ResponseHUD — painel de respostas a chamados
   * =======================================================*/
  const ResponseHUD = (() => {
    let backdrop = null;

    // State
    let selectedPersonId = '';
    let selectedPersonName = '';
    const selectedStatuses  = new Set(); // vazio = sem filtro de status (mostra todos)
    const selectedAssignees = new Set(); // vazio = sem filtro de designado (mostra todos); '' = nenhum
    const selectedTeamIds   = new Set();  // equipes selecionadas para busca por GSE
    let ticketList = [];
    let allFetchedEntries = []; // todos os resultados da última busca (antes do filtro de status)
    let selectedTicketIds = new Set();
    let activeTicketId = '';
    let realChildCountMap = new Map(); // parentId -> contagem real de filhos (via API)
    let personSearchTimeout = null;
    let scriptsCache = null;
    // Alterações pendentes compartilhadas — aplicadas a TODOS os tickets selecionados ao enviar
    let batchPending = {}; // { gse?: {id,name}, assignee?: {id,name} }
    // Cache das discussões renderizadas — permite lookup por índice no handler do botão Replicar
    let currentDiscussions = [];
    // Filtro de texto livre sobre a lista já carregada
    let textFilter = '';
    // Ordenação da lista
    let sortField = 'id';   // 'id' | 'createTime' | 'status' | 'assignee'
    let sortDir   = 'desc';

    const getBatchPending = () => batchPending;
    const setBatchPending = (field, value) => {
      if (value === null) delete batchPending[field];
      else batchPending[field] = value;
    };
    const clearBatchPending = () => { batchPending = {}; };

    const resolveAssigneeName = (personId) => {
      if (!personId) return '';
      const p = DataRepository.peopleCache.get(personId);
      return p?.name || p?.fullName || personId;
    };

    const STATUS_LABELS = {
      RequestStatusActive: 'Ativo',
      RequestStatusInProgress: 'Em Andamento',
      RequestStatusSuspended: 'Suspenso',
      RequestStatusComplete: 'Concluído',
      RequestStatusPendingCustomer: 'Aguardando Solicitante',
      RequestStatusClassify: 'Classificar',
      RequestStatusPending: 'Usuário Final Pendente',
      RequestStatusReject: 'Rejeitado',
      RequestStatusReady: 'Pronto',
      RequestStatusPendingApproval: 'Aguardando Aprovação',
      RequestStatusPendingChange: 'Aguardando Mudança',
    };

    const FILTER_STATUSES = [
      'RequestStatusActive',
      'RequestStatusInProgress',
      'RequestStatusPendingCustomer',
      'RequestStatusSuspended',
      'RequestStatusClassify',
      'RequestStatusPending',
    ];

    const close = () => { if (backdrop) backdrop.style.display = 'none'; };

    const setStatusMsg = (msg, color) => {
      const el = backdrop?.querySelector('#smax-resp-status-msg');
      if (!el) return;
      el.textContent = msg;
      el.style.color = color || '#9ca3af';
    };

    const updateSendButton = () => {
      const btn = backdrop?.querySelector('#smax-resp-send-btn');
      if (!btn) return;
      const count = selectedTicketIds.size;
      const solEl = backdrop?.querySelector('#smax-resp-solution-editor');
      const hasSolution = !!(solEl?.textContent || '').trim();
      const pending = getBatchPending();
      const hasPending = !!(pending.gse || pending.assignee || pending.status);
      if (count > 1) {
        btn.textContent = hasSolution ? `Enviar em lote (${count})` : `Atualizar em lote (${count})`;
        btn.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
      } else if (!hasSolution && hasPending) {
        btn.textContent = 'Atualizar';
        btn.style.background = 'linear-gradient(135deg,#3b82f6,#1d4ed8)';
      } else {
        btn.textContent = 'Enviar';
        btn.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
      }
    };

    const updateBatchBar = () => {
      const bar = backdrop?.querySelector('#smax-resp-batch-bar');
      if (!bar) return;
      const count = selectedTicketIds.size;
      bar.style.display = count >= 1 ? 'flex' : 'none';
      const countEl = bar.querySelector('#smax-resp-batch-count');
      if (countEl) countEl.textContent = `${count} selecionado${count !== 1 ? 's' : ''}`;
      updateSendButton();
    };

    // Converte HTML para texto puro (para checagem de vazio e preview)
    const htmlToText = (html) => {
      if (!html) return '';
      const div = document.createElement('div');
      div.innerHTML = html;
      return (div.textContent || div.innerText || '').trim();
    };
    // Adiciona suporte a colar imagem (base64 inline) em qualquer editor contenteditable
    const addImagePasteHandler = (editor, onInput) => {
      if (!editor) return;
      editor.addEventListener('paste', e => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;
            const reader = new FileReader();
            reader.onload = ev => {
              document.execCommand('insertImage', false, ev.target.result);
              if (onInput) onInput();
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      });
    };

    // Painel de anexos do ResponseHUD
    let attachFetchSeq = 0;
    const updateRespAttachPanel = ({ state, items = [] } = {}) => {
      const row  = backdrop?.querySelector('#smax-resp-attachment-row');
      const list = backdrop?.querySelector('#smax-resp-attachment-list');
      if (!row || !list) return;
      if (state === 'loading') {
        row.dataset.empty = 'false';
        list.dataset.state = 'loading';
        list.textContent = 'Carregando anexos...';
        return;
      }
      if (!items.length) {
        row.dataset.empty = 'true';
        list.dataset.state = 'empty';
        list.innerHTML = '';
        return;
      }
      row.dataset.empty = 'false';
      list.dataset.state = 'ready';
      list.innerHTML = items.map(a =>
        `<button type="button" class="smax-attachment-chip" data-att-id="${Utils.escapeHtml(a.id)}" title="${Utils.escapeHtml(a.name)}">${Utils.escapeHtml(a.name)}</button>`
      ).join('');
      list.querySelectorAll('.smax-attachment-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const att = items.find(a => a.id === chip.dataset.attId);
          if (att) AttachmentService.preview(att);
        });
      });
    };

    const fetchRespAttachments = (ticketId) => {
      attachFetchSeq += 1;
      const token = attachFetchSeq;
      const normalized = Utils.normalizeRequestId(ticketId);
      if (!normalized) { updateRespAttachPanel({ state: 'empty' }); return; }
      updateRespAttachPanel({ state: 'loading' });
      AttachmentService.fetchList(normalized).then(list => {
        if (token !== attachFetchSeq) return;
        updateRespAttachPanel({ state: 'ready', items: (list || []).filter(a => a && a.id) });
      }).catch(() => {
        if (token !== attachFetchSeq) return;
        updateRespAttachPanel({ state: 'empty' });
      });
    };

    // Busca a contagem real de filhos para tickets globais via API (uma única requisição com OR)
    const fetchGlobalChildCounts = async (parentIds) => {
      if (!parentIds.length) return;
      try {
        const tenantId = ApiClient.getTenantId() || '213963628';
        const filter = parentIds.length === 1
          ? `GlobalId_c='${parentIds[0]}'`
          : `(${parentIds.map(id => `GlobalId_c='${id}'`).join(' or ')})`;
        const url = `/rest/${tenantId}/ems/Request?filter=${encodeURIComponent(filter)}&layout=Id,GlobalId_c&size=1000&TENANTID=${tenantId}`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json();
        for (const e of (data?.entities || [])) {
          const rel = e.related_properties || {};
          const p   = e.properties || {};
          const pid = rel.GlobalId_c
            ? String(rel.GlobalId_c.Id || rel.GlobalId_c.id || rel.GlobalId_c || '').replace(/^IMRfc:/i, '').trim()
            : String(p.GlobalId_c || '').replace(/^IMRfc:/i, '').trim();
          if (pid) realChildCountMap.set(pid, (realChildCountMap.get(pid) || 0) + 1);
        }
        renderTicketList();
      } catch (e) {
        console.warn('[SMAX ResponseHUD] fetchGlobalChildCounts:', e);
      }
    };

    const applyDestaqueHighlights = () => {
      if (!backdrop) return;
      backdrop.querySelectorAll('.smax-resp-ticket-item').forEach(el => {
        const entry = ticketList.find(t => t.id === el.dataset.id);
        if (entry && HighlightUser.isHighlighted(entry.requestedForName || '')) {
          el.style.setProperty('background', 'linear-gradient(90deg,rgba(251,191,36,.18) 0%,rgba(245,158,11,.07) 100%)', 'important');
          el.style.setProperty('box-shadow', 'inset 3px 0 0 #f59e0b', 'important');
        }
      });
    };

    const renderTicketList = () => {
      const listEl = backdrop?.querySelector('#smax-resp-ticket-list');
      if (!listEl) return;
      if (!ticketList.length) {
        listEl.innerHTML = '<div style="padding:16px 10px;color:#6b7280;font-size:12px;text-align:center;">Nenhum chamado encontrado.</div>';
        updateSendButton();
        return;
      }

      // Mapa de vínculo global: combina ActivityLog + triageCache
      const globalLogMap = ActivityLog.getGlobalMap(); // ticketId -> globalChangeId (via log de ações)
      const getGlobalId = (tid) =>
        globalLogMap.get(tid) || DataRepository.triageCache.get(tid)?.globalChangeId || '';

      // Contagem local (filhos visíveis na lista) — só usada como fallback antes da API responder
      const localChildCount = new Map();
      for (const t of ticketList) {
        const gid = getGlobalId(t.id);
        if (gid) localChildCount.set(gid, (localChildCount.get(gid) || 0) + 1);
      }

      listEl.innerHTML = ticketList.map(t => {
        const isActive = t.id === activeTicketId;
        const isChecked = selectedTicketIds.has(t.id);
        const statusLabel = t.statusSCCD || STATUS_LABELS[t.status] || (t.status || '').replace('RequestStatus', '') || '';
        const globalChangeId = getGlobalId(t.id);              // este chamado é filho de globalChangeId
        const isGlobalParent = realChildCountMap.has(t.id) || localChildCount.has(t.id);
        const childCount = realChildCountMap.get(t.id) ?? localChildCount.get(t.id) ?? 0;
        const isBothParentAndChild = isGlobalParent && !!globalChangeId; // cenário inválido

        // Linha do ID: número + badge de global (tudo inline)
        let idLineHtml;
        if (isBothParentAndChild) {
          // Ticket é ao mesmo tempo pai e filho de outro global — configuração inválida
          idLineHtml = `<span style="color:#fb923c;font-weight:700;">#${Utils.escapeHtml(t.id)}</span>`
            + ` <span class="smax-warning-badge" style="color:#fb923c;font-size:9px;padding:1px 5px;border-radius:10px;border:1px solid rgba(251,146,60,.5);vertical-align:middle;">⚠️ Global — filho de #${Utils.escapeHtml(globalChangeId)}</span>`;
        } else if (isGlobalParent) {
          idLineHtml = `<span style="color:#4ade80;font-weight:700;">#${Utils.escapeHtml(t.id)}</span>`
            + `<span style="margin-left:5px;color:#4ade80;font-size:9px;padding:1px 5px;border-radius:10px;border:1px solid rgba(74,222,128,.45);vertical-align:middle;">🌐 Global (${childCount} filho${childCount !== 1 ? 's' : ''})</span>`;
        } else if (globalChangeId) {
          idLineHtml = `<span style="color:#60a5fa;font-weight:700;">#${Utils.escapeHtml(t.id)}</span>`
            + ` <span style="color:#f87171;font-size:9px;padding:1px 5px;border-radius:10px;border:1px solid rgba(248,113,113,.35);vertical-align:middle;">⬆ Global #${Utils.escapeHtml(globalChangeId)}</span>`;
        } else {
          idLineHtml = `#${Utils.escapeHtml(t.id)}`;
        }
        if (t.isVip) idLineHtml += ' <span style="padding:1px 5px;border-radius:999px;background:#facc15;color:#854d0e;font-size:9px;font-weight:700;vertical-align:middle;">VIP</span>';

        // Assunto: não mostra se for igual ao ID (placeholder antes do carregamento completo)
        const subjectText = t.subject && t.subject !== t.id ? (t.subject || '').slice(0, 55) : '';

        return `
          <div class="smax-resp-ticket-item${isActive ? ' active' : ''}" data-id="${Utils.escapeHtml(t.id)}" style="display:flex;align-items:flex-start;gap:6px;padding:7px 8px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);">
            <div class="smax-resp-tick-sel" data-id="${Utils.escapeHtml(t.id)}" title="Selecionar para lote"
              style="flex-shrink:0;width:16px;height:16px;border-radius:4px;margin-top:2px;border:1.5px solid ${isChecked ? '#3b82f6' : 'rgba(255,255,255,.25)'};background:${isChecked ? '#3b82f6' : 'transparent'};display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;transition:all .12s;cursor:pointer;">
              ${isChecked ? '✓' : ''}
            </div>
            <div class="smax-resp-ticket-info" style="flex:1;min-width:0;">
              <div class="smax-resp-ticket-id">${idLineHtml}</div>
              ${t.descSnippet ? `<div class="smax-resp-list-desc" title="${Utils.escapeHtml(t.descSnippet)}">${Utils.escapeHtml(t.descSnippet.slice(0, 80))}</div>` : ''}
              <div class="smax-resp-ticket-status">${Utils.escapeHtml(statusLabel)}</div>
            </div>
          </div>`;
      }).join('');
      applyDestaqueHighlights();
      updateSendButton();

      listEl.querySelectorAll('.smax-resp-tick-sel').forEach(sel => {
        sel.addEventListener('click', e => {
          e.stopPropagation();
          const id = sel.dataset.id;
          if (selectedTicketIds.has(id)) {
            selectedTicketIds.delete(id);
            sel.style.border = '1.5px solid rgba(255,255,255,.25)';
            sel.style.background = 'transparent';
            sel.textContent = '';
          } else {
            selectedTicketIds.add(id);
            sel.style.border = '1.5px solid #3b82f6';
            sel.style.background = '#3b82f6';
            sel.textContent = '✓';
          }
          updateBatchBar();
        });
      });

      listEl.querySelectorAll('.smax-resp-ticket-item').forEach(row => {
        row.addEventListener('click', e => {
          if (e.target.closest('.smax-resp-tick-sel')) return;
          loadTicket(row.dataset.id);
        });
      });
    };

    const resolveSubmitterName = (entry) => {
      if (!entry) return '';
      if (entry.submitterPersonId && DataRepository.peopleCache.has(entry.submitterPersonId)) {
        const person = DataRepository.peopleCache.get(entry.submitterPersonId);
        if (person && person.name) return person.name;
      }
      return entry.submitterDisplay || '';
    };

    const replicateDiscussion = async (disc, btn) => {
      if (!activeTicketId) { setStatusMsg('Nenhum chamado ativo.', '#fca5a5'); return; }
      if (!prefs.enableRealWrites) { setStatusMsg('⚠️ Escritas reais desativadas.', '#facc15'); return; }
      if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
      setStatusMsg('Replicando discussão...', '#93c5fd');
      try {
        const result = await Api.postDiscussion(activeTicketId, {
          bodyHtml:    disc.bodyRaw || disc.bodyHtml,
          purposeCode: disc.purposeCode,
          privacyRaw:  disc.privacyRaw,
        });
        const outcome = Api.summarizeBulkOutcome(result);
        if (outcome?.ok !== false) {
          setStatusMsg('✓ Discussão replicada.', '#4ade80');
          await loadTicket(activeTicketId); // recarrega para mostrar a nova discussão
        } else {
          setStatusMsg(`Erro: ${(outcome?.messages || []).join('; ')}`, '#fca5a5');
          if (btn) { btn.disabled = false; btn.textContent = '↺ Replicar'; }
        }
      } catch (e) {
        setStatusMsg(`Erro: ${e.message}`, '#fca5a5');
        if (btn) { btn.disabled = false; btn.textContent = '↺ Replicar'; }
      }
    };

    const renderDiscussions = (discussions) => {
      const el = backdrop?.querySelector('#smax-resp-discussions-list');
      if (!el) return;
      if (!discussions || !discussions.length) {
        currentDiscussions = [];
        el.innerHTML = '<div style="color:#6b7280;font-size:11px;padding:8px;">Sem discussões.</div>';
        return;
      }
      // Ordena por data crescente (mais antigas primeiro, mais recentes no final/baixo)
      currentDiscussions = [...discussions].sort((a, b) => (a.createdTs || 0) - (b.createdTs || 0));
      const recentThreshold = 24 * 60 * 60 * 1000; // 24h
      const nowTs = Date.now();
      el.innerHTML = currentDiscussions.map((d, idx) => {
        const dateStr = d.createdTs ? new Date(d.createdTs).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const submitter = resolveSubmitterName(d);
        const isRecent = !!(d.createdTs && (nowTs - d.createdTs) < recentThreshold);
        return `
          <div class="smax-resp-discussion-item${isRecent ? ' smax-resp-disc-recent' : ''}">
            <div class="smax-resp-disc-meta">
              <span class="smax-resp-disc-author">${Utils.escapeHtml(submitter)}</span>
              <span>${Utils.escapeHtml(dateStr)}</span>
            </div>
            <div class="smax-resp-disc-body">${d.bodyHtml || Utils.escapeHtml(d.body || '')}</div>
            <div class="smax-resp-disc-footer">
              <button class="smax-resp-disc-replicate-btn" data-disc-idx="${idx}" title="Relançar esta discussão com o mesmo texto">↺ Replicar</button>
            </div>
          </div>`;
      }).join('');
      // Event listeners dos botões Replicar
      el.querySelectorAll('.smax-resp-disc-replicate-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const disc = currentDiscussions[parseInt(btn.dataset.discIdx, 10)];
          if (disc) replicateDiscussion(disc, btn);
        });
      });
      // Scroll para a discussão mais recente (último item)
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    };

    const renderTicketDetail = (entry) => {
      if (!backdrop) return;
      const noTicket = backdrop.querySelector('#smax-resp-no-ticket');
      const detailPanel = backdrop.querySelector('#smax-resp-detail');
      if (!entry) {
        if (noTicket) noTicket.style.display = 'flex';
        if (detailPanel) detailPanel.style.display = 'none';
        return;
      }
      if (noTicket) noTicket.style.display = 'none';
      if (detailPanel) detailPanel.style.display = 'flex';

      const idLink = backdrop.querySelector('#smax-resp-ticket-id-link');
      if (idLink) {
        idLink.textContent = `#${entry.idText}`;
        idLink.href = `https://suporte.tjsp.jus.br/saw/Request/${encodeURIComponent(entry.idText)}/general`;
      }

      // Badge de global no painel de detalhe (mesmas regras da lista)
      const tid = entry.idText || '';
      const detailGlobalId = (ActivityLog.getGlobalMap ? ActivityLog.getGlobalMap().get(tid) : '') || DataRepository.triageCache.get(tid)?.globalChangeId || '';
      const detailIsParent = realChildCountMap.has(tid);
      const detailChildCount = realChildCountMap.get(tid) ?? 0;
      const detailIsBoth = detailIsParent && !!detailGlobalId;
      const detailGlobalBadge = backdrop.querySelector('#smax-resp-detail-global-badge');
      if (detailGlobalBadge) {
        const mkLink = id => `https://suporte.tjsp.jus.br/saw/Request/${encodeURIComponent(id)}/general`;
        if (detailIsBoth) {
          detailGlobalBadge.innerHTML = `<span style="color:#fb923c;font-size:12px;padding:2px 7px;border-radius:10px;border:1px solid rgba(251,146,60,.5);white-space:nowrap;">⚠️ filho de <a href="${mkLink(detailGlobalId)}" target="_blank" style="color:#fb923c;text-decoration:underline;">#${Utils.escapeHtml(detailGlobalId)}</a></span>`;
          detailGlobalBadge.style.display = '';
        } else if (detailIsParent) {
          detailGlobalBadge.innerHTML = `<span style="color:#4ade80;font-size:12px;padding:2px 7px;border-radius:10px;border:1px solid rgba(74,222,128,.45);white-space:nowrap;">🌐 Global (${detailChildCount} filho${detailChildCount !== 1 ? 's' : ''})</span>`;
          detailGlobalBadge.style.display = '';
        } else if (detailGlobalId) {
          detailGlobalBadge.innerHTML = `<span style="color:#f87171;font-size:12px;padding:2px 7px;border-radius:10px;border:1px solid rgba(248,113,113,.35);white-space:nowrap;">⬆ Global <a href="${mkLink(detailGlobalId)}" target="_blank" style="color:#f87171;text-decoration:underline;">#${Utils.escapeHtml(detailGlobalId)}</a></span>`;
          detailGlobalBadge.style.display = '';
        } else {
          detailGlobalBadge.innerHTML = '';
          detailGlobalBadge.style.display = 'none';
        }
      }

      const openerEl = backdrop.querySelector('#smax-resp-opener');
      if (openerEl) openerEl.textContent = entry.requestedForName ? `👤 ${entry.requestedForName}` : '';

      const vipBadge = backdrop.querySelector('#smax-resp-vip-badge');
      if (vipBadge) vipBadge.style.display = entry.isVip ? '' : 'none';

      const locationLabel = backdrop.querySelector('#smax-resp-location-label');
      if (locationLabel) {
        if (entry.locationName) {
          locationLabel.textContent = `📍 ${entry.locationName}`;
          locationLabel.dataset.fullLocation = entry.locationName;
          locationLabel.style.display = '';
        } else {
          locationLabel.style.display = 'none';
          locationLabel.dataset.fullLocation = '';
        }
      }

      const statusLabel = backdrop.querySelector('#smax-resp-status-label');
      if (statusLabel) statusLabel.textContent = STATUS_LABELS[entry.status] || (entry.status || '').replace('RequestStatus', '') || '';

      const sccdLabel = backdrop.querySelector('#smax-resp-sccd-label');
      if (sccdLabel) {
        const sccdVal = entry.statusSCCD || '';
        if (sccdVal) {
          sccdLabel.textContent = sccdVal.replace(/_c$/i, '').replace(/([A-Z])/g, ' $1').trim();
          sccdLabel.style.display = '';
        } else {
          sccdLabel.style.display = 'none';
        }
      }

      // Meta-bar: GSE chip (mostra batchPending — aplica-se a todos os selecionados)
      const pending = getBatchPending();
      const gseChipName = backdrop.querySelector('#smax-resp-gse-chip-name');
      const gseBtn = backdrop.querySelector('#smax-resp-gse-btn');
      if (gseChipName && gseBtn) {
        const displayGse = pending.gse ? pending.gse.name : (entry.assignmentGroupName || '—');
        gseChipName.textContent = displayGse;
        gseBtn.classList.toggle('dirty', !!pending.gse);
        gseBtn.title = pending.gse ? `Alterar GSE (pendente: ${pending.gse.name})` : 'Alterar GSE (Grupo de Suporte)';
      }
      // Meta-bar: Especialista chip
      const assigneeChipName = backdrop.querySelector('#smax-resp-assignee-chip-name');
      const assigneeBtn = backdrop.querySelector('#smax-resp-assignee-btn');
      if (assigneeChipName && assigneeBtn) {
        let displayAssignee;
        if (pending.assignee) {
          displayAssignee = pending.assignee.name || pending.assignee.id;
        } else {
          const aid = entry.expertAssigneeId || '';
          displayAssignee = aid ? (resolveAssigneeName(aid) || aid) : 'Sem especialista';
        }
        assigneeChipName.textContent = displayAssignee;
        assigneeBtn.classList.toggle('dirty', !!pending.assignee);
        assigneeBtn.title = pending.assignee ? `Alterar especialista (pendente: ${pending.assignee.name})` : 'Alterar especialista';
      }
      // Meta-bar: Status chip
      const statusChipName = backdrop.querySelector('#smax-resp-status-chip-name');
      const statusBtn = backdrop.querySelector('#smax-resp-status-btn');
      if (statusChipName && statusBtn) {
        const displayStatus = pending.status
          ? (STATUS_LABELS[pending.status.key] || pending.status.key)
          : (STATUS_LABELS[entry.status] || entry.status || '—');
        statusChipName.textContent = displayStatus;
        statusBtn.classList.toggle('dirty', !!pending.status);
        statusBtn.title = pending.status ? `Alterar status (pendente: ${displayStatus})` : 'Alterar status do chamado';
      }

      const descEl = backdrop.querySelector('#smax-resp-desc-content');
      if (descEl) descEl.innerHTML = entry.descriptionHtml || '<em style="color:#6b7280;">Sem descrição.</em>';

      const solEl = backdrop.querySelector('#smax-resp-solution-editor');
      if (solEl) {
        solEl.innerHTML = entry.solutionHtml || '';
      }

      // Preencher input Global ID com valor do ticket ativo
      const globalIdInput = backdrop.querySelector('#smax-resp-global-id');
      if (globalIdInput) {
        const gid = entry.globalChangeId || DataRepository.triageCache.get(entry.idText || '')?.globalChangeId || '';
        globalIdInput.value = gid;
      }

      renderDiscussions(entry.discussions || []);
      updateSendButton();
    };

    const loadTicket = async (id) => {
      if (!id) return;
      activeTicketId = id;
      backdrop?.querySelectorAll('.smax-resp-ticket-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === id);
      });
      applyDestaqueHighlights();
      setStatusMsg('Carregando chamado...', '#93c5fd');

      // Função auxiliar para aplicar subject + badge global no item da lista
      const applyListItemUpdates = (ticketId) => {
        const listItem = backdrop?.querySelector(`.smax-resp-ticket-item[data-id="${CSS.escape(ticketId)}"]`);
        if (!listItem) return;
        const subjectText = DataRepository.triageCache.get(ticketId)?.subjectText || '';
        if (subjectText && subjectText !== ticketId) {
          const subEl = listItem.querySelector('.smax-resp-ticket-subject');
          if (subEl) {
            subEl.textContent = subjectText.slice(0, 55);
            subEl.title = subjectText;
          } else {
            const idDiv = listItem.querySelector('.smax-resp-ticket-id');
            if (idDiv) {
              const newSub = document.createElement('div');
              newSub.className = 'smax-resp-ticket-subject';
              newSub.title = subjectText;
              newSub.textContent = subjectText.slice(0, 55);
              idDiv.after(newSub);
            }
          }
        }
        const globalId = DataRepository.triageCache.get(ticketId)?.globalChangeId || '';
        const idDiv = listItem.querySelector('.smax-resp-ticket-id');
        if (idDiv && globalId && !idDiv.querySelector('.smax-global-badge') && !idDiv.querySelector('.smax-warning-badge')) {
          idDiv.innerHTML = `<span style="color:#60a5fa;font-weight:700;">#${Utils.escapeHtml(ticketId)}</span>`
            + ` <span class="smax-global-badge" style="color:#f87171;font-size:9px;padding:1px 5px;border-radius:10px;border:1px solid rgba(248,113,113,.35);vertical-align:middle;">⬆ Global #${Utils.escapeHtml(globalId)}</span>`;
        }
      };

      try {
        const entry = await DataRepository.ensureRequestPayload(id, { force: true });
        renderTicketDetail(entry || DataRepository.triageCache.get(id) || null);
        applyListItemUpdates(id);
        setStatusMsg('', '');
      } catch (e) {
        setStatusMsg('Erro ao carregar chamado.', '#fca5a5');
      }
      fetchRespAttachments(id);
    };

    const renderStatusPills = (entries) => {
      const statusSection = backdrop?.querySelector('#smax-resp-status-section');
      const filterEl = backdrop?.querySelector('#smax-resp-status-filters');
      if (!filterEl) return;
      const statusesPresentes = [...new Set(entries.map(e => e.statusSCCD).filter(Boolean))].sort();
      if (!statusesPresentes.length) {
        if (statusSection) statusSection.style.display = 'none';
        return;
      }
      if (statusSection) statusSection.style.display = '';
      filterEl.innerHTML = statusesPresentes.map(s => {
        const active = selectedStatuses.has(s);
        return `<button class="smax-resp-status-pill" data-status="${Utils.escapeHtml(s)}"
          style="display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border-radius:6px;border:1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,.12)'};background:${active ? 'rgba(59,130,246,.25)' : 'transparent'};color:${active ? '#93c5fd' : '#9ca3af'};font-size:11px;cursor:pointer;text-align:left;transition:all .15s;">
          <span style="width:8px;height:8px;border-radius:50%;background:${active ? '#3b82f6' : 'transparent'};border:1.5px solid ${active ? '#3b82f6' : '#6b7280'};flex-shrink:0;"></span>
          ${Utils.escapeHtml(s)}
        </button>`;
      }).join('');
      filterEl.querySelectorAll('.smax-resp-status-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const s = pill.dataset.status;
          if (selectedStatuses.has(s)) selectedStatuses.delete(s);
          else selectedStatuses.add(s);
          const active = selectedStatuses.has(s);
          pill.style.border = `1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,.12)'}`;
          pill.style.background = active ? 'rgba(59,130,246,.25)' : 'transparent';
          pill.style.color = active ? '#93c5fd' : '#9ca3af';
          const dot = pill.querySelector('span');
          if (dot) { dot.style.background = active ? '#3b82f6' : 'transparent'; dot.style.border = `1.5px solid ${active ? '#3b82f6' : '#6b7280'}`; }
          applyFilters();
        });
      });
    };

    const renderAssigneePills = (entries) => {
      const section = backdrop?.querySelector('#smax-resp-assignee-section');
      const filterEl = backdrop?.querySelector('#smax-resp-assignee-filters');
      if (!filterEl) return;
      // Collect unique assignee IDs ('' = nenhum)
      const ids = [...new Set(entries.map(e => e.assignee))].sort((a, b) => {
        if (a === '') return -1;
        if (b === '') return 1;
        const na = DataRepository.peopleCache.get(a)?.name || a;
        const nb = DataRepository.peopleCache.get(b)?.name || b;
        return na.localeCompare(nb, 'pt');
      });
      if (!ids.length) { if (section) section.style.display = 'none'; return; }
      if (section) section.style.display = '';
      const pillHtml = (id) => {
        const label = id === '' ? 'Nenhum' : (DataRepository.peopleCache.get(id)?.name || id);
        const active = selectedAssignees.has(id);
        return `<button class="smax-resp-assignee-pill" data-assignee="${Utils.escapeHtml(id)}"
          style="display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border-radius:6px;border:1px solid ${active ? '#a78bfa' : 'rgba(255,255,255,.12)'};background:${active ? 'rgba(167,139,250,.2)' : 'transparent'};color:${active ? '#c4b5fd' : '#9ca3af'};font-size:11px;cursor:pointer;text-align:left;transition:all .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          <span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${active ? '#a78bfa' : 'transparent'};border:1.5px solid ${active ? '#a78bfa' : '#6b7280'};"></span>
          ${Utils.escapeHtml(label)}
        </button>`;
      };
      filterEl.innerHTML = ids.map(pillHtml).join('');
      filterEl.querySelectorAll('.smax-resp-assignee-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const id = pill.dataset.assignee;
          if (selectedAssignees.has(id)) selectedAssignees.delete(id);
          else selectedAssignees.add(id);
          const active = selectedAssignees.has(id);
          pill.style.border = `1px solid ${active ? '#a78bfa' : 'rgba(255,255,255,.12)'}`;
          pill.style.background = active ? 'rgba(167,139,250,.2)' : 'transparent';
          pill.style.color = active ? '#c4b5fd' : '#9ca3af';
          const dot = pill.querySelector('span');
          if (dot) { dot.style.background = active ? '#a78bfa' : 'transparent'; dot.style.border = `1.5px solid ${active ? '#a78bfa' : '#6b7280'}`; }
          applyFilters();
        });
      });
    };

    const applyFilters = () => {
      const q = textFilter.toLowerCase();
      ticketList = allFetchedEntries.filter(e =>
        (selectedStatuses.size === 0 || selectedStatuses.has(e.statusSCCD)) &&
        (selectedAssignees.size === 0 || selectedAssignees.has(e.assignee)) &&
        (!q ||
          e.id.includes(q) ||
          (e.descSnippet || '').toLowerCase().includes(q) ||
          (e.requestedForName || DataRepository.triageCache.get(e.id)?.requestedForName || '').toLowerCase().includes(q) ||
          (e.locationName    || DataRepository.triageCache.get(e.id)?.locationName    || '').toLowerCase().includes(q))
      );
      // Ordenação
      ticketList.sort((a, b) => {
        let va, vb;
        if (sortField === 'createTime') {
          va = a.createTime || 0;
          vb = b.createTime || 0;
        } else if (sortField === 'status') {
          va = a.statusSCCD || STATUS_LABELS[a.status] || '';
          vb = b.statusSCCD || STATUS_LABELS[b.status] || '';
        } else if (sortField === 'assignee') {
          va = resolveAssigneeName(a.assignee) || '';
          vb = resolveAssigneeName(b.assignee) || '';
        } else { // 'id'
          va = parseInt(a.id, 10) || 0;
          vb = parseInt(b.id, 10) || 0;
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ?  1 : -1;
        return 0;
      });
      const countEl = backdrop?.querySelector('#smax-resp-ticket-count');
      if (countEl) countEl.textContent = `${ticketList.length} chamado${ticketList.length !== 1 ? 's' : ''}`;
      const clearBtn = backdrop?.querySelector('#smax-resp-clear-filters');
      if (clearBtn) clearBtn.style.display = (selectedStatuses.size > 0 || selectedAssignees.size > 0) ? '' : 'none';
      setStatusMsg('', '');
      // Persiste filtros para próxima sessão
      try { GM_setValue('smax_resp_filters', JSON.stringify({ statuses: [...selectedStatuses], assignees: [...selectedAssignees], text: textFilter })); } catch {}
      renderTicketList();
      updateBatchBar();
      if (ticketList.length && !activeTicketId) loadTicket(ticketList[0].id);
    };

    const fetchTickets = async () => {
      // Coletar GSE IDs das equipes selecionadas
      const teams = TeamsConfig.getTeams();
      const teamsToSearch = selectedTeamIds.size > 0
        ? teams.filter(t => selectedTeamIds.has(t.id))
        : teams;

      const gseIdSet = new Set();
      const gseNameMap = {}; // id -> name
      for (const t of teamsToSearch) {
        (t.gseRules || []).forEach(r => { if (r.id) { gseIdSet.add(r.id); gseNameMap[r.id] = r.name || r.id; } });
        (t.gseIds || []).forEach(id => { if (id) { gseIdSet.add(id); if (!gseNameMap[id]) gseNameMap[id] = id; } });
      }
      const gseIds = [...gseIdSet];
      console.log('[SMAX ResponseHUD] gseIds coletados:', gseIds);

      if (!gseIds.length) {
        setStatusMsg('Nenhuma GSE configurada nas equipes.', '#fca5a5');
        console.warn('[SMAX ResponseHUD] Nenhum GSE ID encontrado nas equipes.');
        return;
      }

      // Preservar filtros ativos para restaurar após recarregar
      const prevStatuses  = new Set(selectedStatuses);
      const prevAssignees = new Set(selectedAssignees);

      // Resetar estado
      ticketList = [];
      allFetchedEntries = [];
      selectedTicketIds.clear();
      activeTicketId = '';
      selectedStatuses.clear();
      selectedAssignees.clear();
      realChildCountMap = new Map();

      const noTicket = backdrop?.querySelector('#smax-resp-no-ticket');
      const detailPanel = backdrop?.querySelector('#smax-resp-detail');
      if (noTicket) noTicket.style.display = 'flex';
      if (detailPanel) detailPanel.style.display = 'none';

      const countEl = backdrop?.querySelector('#smax-resp-ticket-count');
      if (countEl) countEl.textContent = '';
      setStatusMsg('Buscando chamados...', '#93c5fd');

      // Campo correto para filtrar por grupo é AssignedToGroup (ExpertGroup só funciona em updates)
      const gseFilter = gseIds.length === 1
        ? `AssignedToGroup='${gseIds[0]}'`
        : `(${gseIds.map(id => `AssignedToGroup='${id}'`).join(' or ')})`;

      // Excluir fechados pelo PhaseId (como o SMAX faz internamente) e pelo Status Operacional
      // "or StatusSCCDSMAX_c=null" inclui chamados sem valor no campo (maioria dos abertos)
      const filter = `(Active='true' and (PhaseId!='Close' and PhaseId!='Accept' or PhaseId=null) and ${gseFilter} and (StatusSCCDSMAX_c!='Fechado_c' or StatusSCCDSMAX_c=null))`;
      console.log('[SMAX ResponseHUD] filter:', filter.slice(0, 200));

      // Não inclui Description/Solution na listagem — carregados sob demanda em loadTicket
      const layout = 'Id,Status,PhaseId,CreateTime,ExpertAssignee,RequestedForPerson,StatusSCCDSMAX_c,AssignedToGroup,GlobalId_c,Description,RegisteredForLocation';

      try {
        const tenantId = ApiClient.getTenantId() || '213963628';
        const url = `/rest/${tenantId}/ems/Request?filter=${encodeURIComponent(filter)}&layout=${encodeURIComponent(layout)}&size=1000&TENANTID=${tenantId}`;
        console.log('[SMAX ResponseHUD] GET', url);
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          console.error('[SMAX ResponseHUD] fetchTickets HTTP', resp.status, body);
          throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
        }
        const data = await resp.json();
        const entities = data?.entities || [];

        allFetchedEntries = entities.map(e => {
          const p = e.properties || {};
          const rel = e.related_properties || {};
          const rawId = (p.Id || '').replace(/^IMRfc:/, '');
          if (!rawId) return null;
          // Extrai globalChangeId — tenta rel (objeto com Id) e props (string plana)
          const globalId = rel.GlobalId_c
            ? String(rel.GlobalId_c.Id || rel.GlobalId_c.id || rel.GlobalId_c || '').replace(/^IMRfc:/i, '').trim()
            : p.GlobalId_c
              ? String(p.GlobalId_c).replace(/^IMRfc:/i, '').trim()
              : '';
          if (globalId && globalId !== rawId) {
            const existing = DataRepository.triageCache.get(rawId) || {};
            if (!existing.globalChangeId) {
              DataRepository.triageCache.set(rawId, Object.assign({}, existing, { globalChangeId: globalId }));
            }
          }
          const statusSCCD = (p.StatusSCCDSMAX_c || '').replace(/_c$/i, '').replace(/([A-Z])/g, ' $1').trim();
          // Extrai primeira linha de texto da descrição HTML
          let descSnippet = '';
          if (p.Description) {
            const tmp = document.createElement('div');
            tmp.innerHTML = String(p.Description);
            const txt = (tmp.textContent || tmp.innerText || '').trim();
            descSnippet = txt.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
          }
          // RequestedForPerson: VIP e nome do solicitante (API de lista retorna só {Id}; fallback para peopleCache)
          const rfp = rel.RequestedForPerson || {};
          const rfpId = rfp.Id || rfp.id || '';
          const cachedPerson = rfpId ? DataRepository.peopleCache.get(rfpId) : null;
          const isVip = !!(rfp.IsVIP ?? cachedPerson?.IsVIP ?? cachedPerson?.isVIP);
          const requestedForName = (rfp.DisplayLabel || rfp.Name || rfp.PrimaryDisplayValue || rfp.FullName
            || cachedPerson?.name || cachedPerson?.DisplayLabel || cachedPerson?.Name || '').trim();
          // RegisteredForLocation: local de divulgação
          const rloc = rel.RegisteredForLocation || {};
          const locationName = (rloc.DisplayLabel || rloc.Name || rloc.DisplayName || rloc.FullName || '').trim();
          return {
            id: rawId,
            subject: rawId,
            descSnippet,
            status: p.Status || '',
            statusSCCD,
            gse: p.AssignedToGroup || '',
            assignee: p.ExpertAssignee || '',
            createTime: parseInt(p.CreateTime, 10) || 0,
            isVip,
            requestedForName,
            locationName,
          };
        }).filter(Boolean);
        console.log('[SMAX ResponseHUD] entities:', entities.length, '→ após filtro cliente:', allFetchedEntries.length);

        // Complementar com entradas do triageCache para equipes sem GSE IDs explícitos
        // (equipes que usam apenas matchers/regex não geram filtro de API, mas o suggestTeam funciona para elas)
        const teamsWithNoGSE = teamsToSearch.filter(t =>
          !((t.gseRules && t.gseRules.some(r => r.id)) || (t.gseIds && t.gseIds.length))
        );
        if (teamsWithNoGSE.length) {
          const coveredIds = new Set(allFetchedEntries.map(e => e.id));
          const CLOSED_STATUSES = new Set(['RequestStatusComplete', 'RequestStatusReject', 'RequestStatusCancel']);
          for (const [cacheId, ce] of DataRepository.triageCache) {
            if (coveredIds.has(cacheId)) continue;
            if (CLOSED_STATUSES.has(ce.status)) continue;
            const rawSCCD = (ce.statusSCCD || '').replace(/_c$/i, '').replace(/([A-Z])/g, ' $1').trim();
            if (rawSCCD === 'Fechado') continue;
            const suggestedTeam = TeamsConfig.suggestTeam(ce);
            if (!suggestedTeam || !teamsWithNoGSE.some(t => t.id === suggestedTeam.id)) continue;
            coveredIds.add(cacheId);
            allFetchedEntries.push({
              id: cacheId,
              subject: ce.subjectText || cacheId,
              status: ce.status || '',
              statusSCCD: rawSCCD,
              gse: ce.assignmentGroupId || '',
              assignee: '',
            });
          }
          console.log('[SMAX ResponseHUD] após complemento triageCache (equipes sem GSE):', allFetchedEntries.length);
        }

        console.log('[SMAX ResponseHUD] equipes buscadas:', teamsToSearch.map(t => t.name || t.id), '| GSEs:', gseIds, '| total encontrado:', allFetchedEntries.length);

        // Exibir resumo do filtro no painel esquerdo
        const infoEl = backdrop?.querySelector('#smax-resp-search-info');
        if (infoEl) {
          const teamLabels = teamsToSearch.map(t => t.name || t.id);
          const gseLines = gseIds.map(id => `<div style="color:#d1d5db;padding-left:8px;font-size:10px;line-height:1.5;">${Utils.escapeHtml(gseNameMap[id] || id)} <span style="color:#4b5563;">(${id})</span></div>`).join('');
          const section = (label) => `<div style="font-size:9px;font-weight:600;color:#4b5563;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;margin-bottom:2px;">${label}</div>`;
          infoEl.innerHTML = section('Equipes buscadas')
            + `<div style="color:#d1d5db;font-size:10px;line-height:1.5;">${Utils.escapeHtml(teamLabels.join(', ') || '—')}</div>`
            + section(`GSEs (${gseIds.length})`)
            + gseLines
            + section('Filtros')
            + `<div style="color:#d1d5db;font-size:10px;line-height:1.5;">Fase: excl. Close / Accept</div>`
            + `<div style="color:#d1d5db;font-size:10px;line-height:1.5;">Status Op.: excl. Fechado</div>`;
          infoEl.style.display = '';
        }

        // Restaurar filtros que ainda existam nos novos dados — ANTES de renderizar as pills
        // para que elas reflitam o estado ativo corretamente
        const newStatusSet   = new Set(allFetchedEntries.map(e => e.statusSCCD).filter(Boolean));
        const newAssigneeSet = new Set(allFetchedEntries.map(e => e.assignee));
        prevStatuses.forEach(s  => { if (newStatusSet.has(s))   selectedStatuses.add(s); });
        prevAssignees.forEach(a => { if (newAssigneeSet.has(a)) selectedAssignees.add(a); });

        // Gerar pills de filtro (agora refletem o estado restaurado)
        renderStatusPills(allFetchedEntries);
        renderAssigneePills(allFetchedEntries);

        // Aplicar filtros (vazio = mostrar todos)
        applyFilters();

        // Buscar contagem real de filhos para os tickets globais identificados na lista
        const parentIdsForCount = [...new Set(
          allFetchedEntries.map(e => DataRepository.triageCache.get(e.id)?.globalChangeId || '').filter(Boolean)
        )];
        if (parentIdsForCount.length) fetchGlobalChildCounts(parentIdsForCount);

      } catch (err) {
        setStatusMsg(`Erro: ${err.message}`, '#fca5a5');
        console.error('[SMAX ResponseHUD] fetchTickets error:', err);
      }
    };

    const loadScripts = async () => {
      if (scriptsCache) return scriptsCache;
      try {
        const equipeId = GM_getValue('smax_gerenciador_equipe_id', null);
        let url = `${SMAX_SB_URL}/rest/v1/scripts_customizados?select=id,nome,conteudo_bruto&deletado=eq.false&order=nome`;
        if (equipeId) url += `&equipe_id=eq.${equipeId}`;
        const resp = await fetch(url, {
          headers: {
            apikey: SMAX_SB_KEY,
            Authorization: `Bearer ${SMAX_SB_KEY}`,
            'Accept-Profile': 'public'
          }
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const fromDB = await resp.json();
        // Mescla scripts compartilhados (GitHub) — precedem os do Supabase
        const shared = SharedConfig.getScripts(false);
        scriptsCache = [...shared, ...fromDB];
        return scriptsCache;
      } catch (e) {
        console.warn('[SMAX] ResponseHUD: falha ao carregar scripts:', e);
        // Fallback: apenas os scripts compartilhados
        return SharedConfig.getScripts(false);
      }
    };

    const openScriptPicker = async () => {
      const picker = backdrop?.querySelector('#smax-resp-script-picker');
      if (!picker) return;
      const isOpen = picker.style.display !== 'none';
      if (isOpen) { picker.style.display = 'none'; return; }
      picker.innerHTML = '<div style="padding:10px 12px;color:#9ca3af;font-size:12px;">Carregando scripts...</div>';
      picker.style.display = 'block';
      const scripts = await loadScripts();
      if (!scripts.length) {
        picker.innerHTML = '<div style="padding:10px 12px;color:#9ca3af;font-size:12px;">Nenhum script disponível.</div>';
        return;
      }
      picker.innerHTML = `
        <div style="padding:8px;border-bottom:1px solid rgba(255,255,255,.08);">
          <input id="smax-resp-script-search" type="text" placeholder="Buscar script..." autocomplete="off"
            style="width:100%;box-sizing:border-box;background:#0a0f1e;border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:5px 8px;color:#e5e7eb;font-size:12px;outline:none;">
        </div>
        <div id="smax-resp-script-list" style="max-height:220px;overflow-y:auto;">
          ${scripts.map(s => `<div class="smax-resp-script-item" data-content="${Utils.escapeHtml(s.conteudo_bruto || '')}">${Utils.escapeHtml(s.nome)}${s._shared ? ' <span style="font-size:9px;padding:1px 4px;border-radius:999px;background:rgba(56,189,248,.15);color:#38bdf8;border:1px solid rgba(56,189,248,.3);">☁️</span>' : ''}</div>`).join('')}
        </div>`;

      picker.querySelectorAll('.smax-resp-script-item').forEach(item => {
        item.addEventListener('click', () => {
          const solEl = backdrop?.querySelector('#smax-resp-solution-editor');
          if (solEl) { solEl.innerHTML = item.dataset.content; solEl.focus(); updateSendButton(); }
          picker.style.display = 'none';
        });
      });

      const search = picker.querySelector('#smax-resp-script-search');
      const list = picker.querySelector('#smax-resp-script-list');
      if (search && list) {
        search.focus();
        search.addEventListener('input', () => {
          const q = search.value.toLowerCase();
          list.querySelectorAll('.smax-resp-script-item').forEach(item => {
            item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
        });
      }

      const closeOnOutside = (e) => {
        const scriptsBtn = backdrop?.querySelector('#smax-resp-scripts-btn');
        if (!picker.contains(e.target) && e.target !== scriptsBtn) {
          picker.style.display = 'none';
          document.removeEventListener('mousedown', closeOnOutside);
        }
      };
      setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 0);
    };

    // Analisa o que vai mudar por ticket (para confirmação e smart-skip)
    const analyzeTicket = (id, solutionRaw) => {
      const pending = getBatchPending();
      const fetched = allFetchedEntries.find(e => e.id === id) || {};
      const cache   = DataRepository.triageCache.get(id) || {};

      const hasSolution   = !!htmlToText(solutionRaw);
      const curGseId      = fetched.gse || cache.assignmentGroupId || '';
      const gseWillChange = !!(pending.gse?.id) && pending.gse.id !== curGseId;
      const curAssigneeId       = fetched.assignee || cache.expertAssigneeId || '';
      const assigneeWillChange  = !!(pending.assignee?.id) && pending.assignee.id !== curAssigneeId;
      const statusWillChange    = !!(pending.status?.key) && pending.status.key !== (cache.status || '');

      return { hasSolution, curGseId, gseWillChange, curAssigneeId, assigneeWillChange, statusWillChange,
               willAct: hasSolution || gseWillChange || assigneeWillChange || statusWillChange };
    };

    const commitTicket = async (id, solutionRaw) => {
      if (!prefs.enableRealWrites) return { ok: false, msg: 'Escritas reais desativadas.' };
      const pending = getBatchPending();
      const { hasSolution, gseWillChange, assigneeWillChange, statusWillChange, willAct } = analyzeTicket(id, solutionRaw);
      if (!willAct) return { skipped: true, msg: 'Sem alterações para este chamado.' };

      const props = { Id: id };
      if (hasSolution) {
        props.Solution = solutionRaw; // já é HTML do contenteditable
        props.CompletionCode = 'CompletionCodeFulfilled'; // encerra o chamado (igual à triagem)
      }
      if (gseWillChange) props.ExpertGroup = pending.gse.id;
      if (assigneeWillChange) props.ExpertAssignee = pending.assignee.id;
      if (statusWillChange) props.Status = pending.status.key;

      const body = { entities: [{ entity_type: 'Request', properties: props }], operation: 'UPDATE' };
      try {
        const result  = await ApiClient.ems.bulk(body);
        const outcome = Api.summarizeBulkOutcome(result);
        const success = outcome?.ok !== false;
        if (success) {
          const entry = DataRepository.triageCache.get(id);
          if (entry && (gseWillChange || assigneeWillChange || statusWillChange)) {
            DataRepository.triageCache.set(id, Object.assign({}, entry, {
              assignmentGroupId:   gseWillChange      ? pending.gse.id       : entry.assignmentGroupId,
              assignmentGroupName: gseWillChange      ? pending.gse.name     : entry.assignmentGroupName,
              expertAssigneeId:    assigneeWillChange ? pending.assignee.id  : entry.expertAssigneeId,
              status:              statusWillChange   ? pending.status.key   : entry.status,
            }));
          }
        }
        // Registrar no ActivityLog — garante que ações do ResponseHUD apareçam no relatório
        ActivityLog.log({
          ticketId:      id,
          answered:      hasSolution,
          assigned:      assigneeWillChange,
          assignedTo:    hasSolution       ? (prefs.myPersonName || '')
                       : assigneeWillChange ? (pending.assignee.name || pending.assignee.id)
                       : '',
          transferred:   gseWillChange,
          transferredTo: gseWillChange ? (pending.gse.name || pending.gse.id) : '',
          usedScript:    false,
          success,
        });
        return outcome;
      } catch (e) {
        ActivityLog.log({ ticketId: id, answered: hasSolution, success: false });
        return { ok: false, msg: e.message };
      }
    };

    const executeCommitAll = async (targets, solutionRaw) => {
      const sendBtn  = backdrop?.querySelector('#smax-resp-send-btn');
      const batchBtn = backdrop?.querySelector('#smax-resp-batch-send-btn');
      if (sendBtn)  sendBtn.disabled  = true;
      if (batchBtn) batchBtn.disabled = true;

      setStatusMsg(`Enviando ${targets.length} chamado(s)...`, '#93c5fd');
      let ok = 0, fail = 0, skipped = 0;
      for (const id of targets) {
        const r = await commitTicket(id, solutionRaw);
        if (r?.skipped) skipped++;
        else if (r?.ok !== false) ok++;
        else fail++;
      }
      if (sendBtn)  sendBtn.disabled  = false;
      if (batchBtn) batchBtn.disabled = false;

      if (fail === 0 && ok > 0) {
        const pendingBeforeClear = getBatchPending();
        const fwdText = pendingBeforeClear.forwarding?.text || '';
        clearBatchPending();
        const solEl = backdrop?.querySelector('#smax-resp-solution-editor');
        if (solEl) solEl.innerHTML = '';
        if (activeTicketId) {
          const entry = DataRepository.triageCache.get(activeTicketId);
          if (entry) renderTicketDetail(entry);
        }
        // Inserir texto de encaminhamento no CKEditor de discussão da página SMAX
        if (fwdText) {
          try {
            const inst = Utils.locateSolutionEditor?.();
            if (inst) {
              inst.focus();
              inst.insertHtml(fwdText);
            } else {
              // Fallback direto ao elemento contenteditable da discussão
              const ed = document.querySelector('.cke_wysiwyg_div[contenteditable="true"]');
              if (ed) { ed.focus(); document.execCommand('insertHTML', false, fwdText); }
            }
          } catch {}
        }
        const skipNote = skipped > 0 ? ` (${skipped} ignorado${skipped !== 1 ? 's' : ''} — sem alterações)` : '';
        const fwdNote = fwdText ? ' | 📤 Encaminhamento inserido no editor.' : '';
        setStatusMsg(`✓ ${ok} chamado(s) atualizado(s).${skipNote}${fwdNote}`, '#4ade80');
      } else if (fail === 0 && ok === 0) {
        setStatusMsg('Nenhum chamado com alterações para enviar.', '#fca5a5');
      } else {
        // Falha parcial ou total: limpar batchPending para evitar estado inconsistente
        clearBatchPending();
        const chipGseName = backdrop?.querySelector('#smax-resp-gse-chip-name');
        const chipGseBtn  = backdrop?.querySelector('#smax-resp-gse-btn');
        const chipAssName = backdrop?.querySelector('#smax-resp-assignee-chip-name');
        const chipAssBtn  = backdrop?.querySelector('#smax-resp-assignee-btn');
        const chipStBtn   = backdrop?.querySelector('#smax-resp-status-btn');
        const chipStName  = backdrop?.querySelector('#smax-resp-status-chip-name');
        const entry = DataRepository.triageCache.get(activeTicketId);
        if (chipGseName && entry) chipGseName.textContent = entry.assignmentGroupName || '—';
        if (chipGseBtn)  chipGseBtn.classList.remove('dirty');
        if (chipAssName && entry) chipAssName.textContent = resolveAssigneeName(entry.expertAssigneeId || '') || 'Sem especialista';
        if (chipAssBtn)  chipAssBtn.classList.remove('dirty');
        if (chipStName && entry)  chipStName.textContent = STATUS_LABELS[entry.status] || entry.status || '—';
        if (chipStBtn)   chipStBtn.classList.remove('dirty');
        setStatusMsg(`${ok} ok, ${fail} com erro${skipped > 0 ? `, ${skipped} ignorado(s)` : ''}.`, '#fca5a5');
      }
      updateSendButton();
    };

    const showBatchConfirm = (targets, solutionRaw, onConfirm) => {
      const pending  = getBatchPending();
      const groupMap = new Map(DataRepository.getSupportGroupsSnapshot().map(g => [g.id, g.name || g.id]));

      // Análise por ticket
      const rows = targets.map(id => {
        const a = analyzeTicket(id, solutionRaw);
        const curGseName      = groupMap.get(a.curGseId)      || a.curGseId      || '—';
        const curAssigneeName = resolveAssigneeName(a.curAssigneeId) || a.curAssigneeId || '—';
        return { id, ...a, curGseName, curAssigneeName };
      });

      const willActCount  = rows.filter(r => r.willAct).length;
      const willSkipCount = rows.length - willActCount;

      const tagHtml = (row) => {
        if (!row.willAct) return '<span class="smax-bc-tag skip">Ignorar</span>';
        if (row.hasSolution && row.gseWillChange && row.assigneeWillChange) return '<span class="smax-bc-tag ok">Tudo</span>';
        if (!row.gseWillChange && !row.assigneeWillChange) return '<span class="smax-bc-tag partial">Só solução</span>';
        return '<span class="smax-bc-tag partial">Parcial</span>';
      };

      const gseColHtml = (row) => {
        if (!pending.gse?.id) return '<span style="color:#6b7280">—</span>';
        if (row.gseWillChange) return `<span style="color:#9ca3af">${Utils.escapeHtml(row.curGseName)}</span> → <span style="color:#93c5fd">${Utils.escapeHtml(pending.gse.name)}</span>`;
        return `<span style="color:#6b7280">${Utils.escapeHtml(row.curGseName)} <em style="font-size:9px;">(igual)</em></span>`;
      };

      const assigneeColHtml = (row) => {
        if (!pending.assignee?.id) return '<span style="color:#6b7280">—</span>';
        if (row.assigneeWillChange) return `<span style="color:#9ca3af">${Utils.escapeHtml(row.curAssigneeName)}</span> → <span style="color:#c4b5fd">${Utils.escapeHtml(pending.assignee.name)}</span>`;
        return `<span style="color:#6b7280">${Utils.escapeHtml(row.curAssigneeName)} <em style="font-size:9px;">(igual)</em></span>`;
      };

      const overlay = document.createElement('div');
      overlay.id = 'smax-batch-confirm-overlay';
      const solutionPlain = htmlToText(solutionRaw);
      const solutionPreview = solutionPlain.slice(0, 90) + (solutionPlain.length > 90 ? '…' : '');
      overlay.innerHTML = `
        <div id="smax-batch-confirm-box">
          <div id="smax-batch-confirm-header">
            <span style="font-size:14px;font-weight:700;">Confirmar ações em lote</span>
            <button id="smax-bc-cancel-x" style="background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;line-height:1;">✕</button>
          </div>
          <div id="smax-batch-confirm-body">
            <div>
              <div class="smax-bc-section-title">Alterações que serão aplicadas a todos</div>
              <div class="smax-bc-changes">
                ${pending.gse?.id      ? `<span class="smax-bc-change-pill gse">🏢 GSE → ${Utils.escapeHtml(pending.gse.name)}</span>` : ''}
                ${pending.assignee?.id ? `<span class="smax-bc-change-pill assignee">👤 Especialista → ${Utils.escapeHtml(pending.assignee.name)}</span>` : ''}
                ${pending.status?.key  ? `<span class="smax-bc-change-pill" style="background:rgba(99,102,241,.18);color:#a5b4fc;border:1px solid rgba(99,102,241,.35);">🔄 Status → ${Utils.escapeHtml(pending.status.label || STATUS_LABELS[pending.status.key] || pending.status.key)}</span>` : ''}
                ${solutionPlain   ? `<span class="smax-bc-change-pill solution">📋 Solução: "${Utils.escapeHtml(solutionPreview)}"</span>` : ''}
                ${!pending.gse?.id && !pending.assignee?.id && !pending.status?.key && !solutionPlain ? '<span style="color:#f87171;font-size:12px;">Nenhuma alteração definida.</span>' : ''}
              </div>
            </div>
            <div>
              <div class="smax-bc-section-title">${rows.length} chamado(s) selecionado(s) — ${willActCount} será(ão) atualizado(s)${willSkipCount > 0 ? `, ${willSkipCount} ignorado(s)` : ''}</div>
              <table class="smax-bc-ticket-table">
                <thead>
                  <tr>
                    <th>Chamado</th>
                    ${pending.gse?.id      ? '<th>GSE</th>'         : ''}
                    ${pending.assignee?.id ? '<th>Especialista</th>' : ''}
                    ${solutionPlain   ? '<th>Solução</th>'      : ''}
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(r => `
                    <tr style="${!r.willAct ? 'opacity:.45;' : ''}">
                      <td style="font-weight:700;color:#60a5fa;">#${Utils.escapeHtml(r.id)}</td>
                      ${pending.gse?.id      ? `<td>${gseColHtml(r)}</td>`      : ''}
                      ${pending.assignee?.id ? `<td>${assigneeColHtml(r)}</td>` : ''}
                      ${solutionPlain   ? `<td><span style="color:${r.hasSolution ? '#86efac' : '#6b7280'};">${r.hasSolution ? '✓' : '—'}</span></td>` : ''}
                      <td>${tagHtml(r)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
          <div id="smax-batch-confirm-footer">
            <span id="smax-batch-confirm-summary" style="color:#9ca3af;font-size:12px;">
              ${willActCount > 0 ? `${willActCount} chamado(s) serão atualizados.` : 'Nenhum chamado será alterado.'}
            </span>
            <div style="display:flex;gap:8px;">
              <button id="smax-bc-cancel-btn" style="padding:7px 18px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:transparent;color:#9ca3af;font-size:13px;cursor:pointer;">Cancelar</button>
              <button id="smax-bc-confirm-btn" ${willActCount === 0 ? 'disabled' : ''}
                style="padding:7px 22px;border:none;border-radius:8px;background:${willActCount > 0 ? 'linear-gradient(135deg,#22c55e,#16a34a)' : '#374151'};color:#fff;font-size:13px;font-weight:700;cursor:${willActCount > 0 ? 'pointer' : 'default'};">
                Confirmar e Enviar (${willActCount})
              </button>
            </div>
          </div>
        </div>`;

      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector('#smax-bc-cancel-x').addEventListener('click', close);
      overlay.querySelector('#smax-bc-cancel-btn').addEventListener('click', close);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      overlay.querySelector('#smax-bc-confirm-btn').addEventListener('click', () => {
        close();
        onConfirm();
      });
    };

    const commitAll = async () => {
      const targets = selectedTicketIds.size > 1
        ? [...selectedTicketIds]
        : (activeTicketId ? [activeTicketId] : []);
      if (!targets.length) { setStatusMsg('Nenhum chamado selecionado.', '#fca5a5'); return; }

      if (!prefs.enableRealWrites) {
        setStatusMsg('⚠️ Escritas reais desativadas. Ative em Configurações → Geral.', '#facc15');
        return;
      }

      const solEl = backdrop?.querySelector('#smax-resp-solution-editor');
      const solutionRaw = solEl?.innerHTML || '';

      // Chamado único: executa diretamente sem modal de confirmação
      if (targets.length === 1) {
        executeCommitAll(targets, solutionRaw);
        return;
      }

      // Múltiplos: mostra confirmação antes de executar
      showBatchConfirm(targets, solutionRaw, () => executeCommitAll(targets, solutionRaw));
    };

    const closeAllPickers = () => {
      backdrop?.querySelectorAll('.smax-resp-field-picker').forEach(p => {
        p.style.display = 'none';
        if (p._closeHandler) {
          document.removeEventListener('mousedown', p._closeHandler, true);
          p._closeHandler = null;
        }
      });
    };

    const positionPicker = (picker, anchorBtn) => {
      const rect = anchorBtn.getBoundingClientRect();
      picker.style.display = 'block';
      const pickerH = picker.offsetHeight || 280;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      if (spaceBelow < pickerH && rect.top > pickerH) {
        picker.style.top = (rect.top - pickerH - 4) + 'px';
      } else {
        picker.style.top = (rect.bottom + 4) + 'px';
      }
      picker.style.left = Math.min(rect.left, window.innerWidth - 388) + 'px';
    };

    const openGsePicker = async () => {
      if (!backdrop || !activeTicketId) return;
      const picker = backdrop.querySelector('#smax-resp-gse-picker');
      const btn = backdrop.querySelector('#smax-resp-gse-btn');
      if (!picker || !btn) return;
      if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
      closeAllPickers();
      picker.innerHTML = '<div class="smax-resp-field-picker-empty">Carregando grupos...</div>';
      positionPicker(picker, btn);

      const groups = await DataRepository.ensureSupportGroups();
      const pending = getBatchPending();
      const currentGroupId = pending.gse?.id || DataRepository.triageCache.get(activeTicketId)?.assignmentGroupId || '';

      const renderGroups = (filter) => {
        const q = (filter || '').toLowerCase();
        const filtered = q ? groups.filter(g => (g.name || g.id).toLowerCase().includes(q)) : groups;
        if (!filtered.length) {
          picker.querySelector('.smax-resp-field-picker-list').innerHTML =
            '<div class="smax-resp-field-picker-empty">Nenhum grupo encontrado.</div>';
          return;
        }
        picker.querySelector('.smax-resp-field-picker-list').innerHTML = filtered.map(g => {
          const isActive = g.id === currentGroupId;
          return `<div class="smax-resp-field-picker-item${isActive ? ' active' : ''}" data-id="${Utils.escapeHtml(g.id)}" data-name="${Utils.escapeHtml(g.name || g.id)}">
            ${isActive ? '✓ ' : ''}<span>${Utils.escapeHtml(g.name || g.id)}</span>
          </div>`;
        }).join('');
        picker.querySelectorAll('.smax-resp-field-picker-item').forEach(item => {
          item.addEventListener('click', () => {
            const gid = item.dataset.id;
            const gname = item.dataset.name;
            const curPending = getBatchPending();
            const alreadySet = curPending.gse?.id === gid;

            if (alreadySet) {
              // Toggle off — remove GSE pending e encaminhamento
              const chipEl = backdrop.querySelector('#smax-resp-gse-chip-name');
              const chipBtn = backdrop.querySelector('#smax-resp-gse-btn');
              setBatchPending('gse', null);
              setBatchPending('forwarding', null);
              if (chipEl) chipEl.textContent = DataRepository.triageCache.get(activeTicketId)?.assignmentGroupName || '—';
              if (chipBtn) { chipBtn.classList.remove('dirty'); chipBtn.title = 'Alterar GSE (Grupo de Suporte)'; }
              updateSendButton();
              picker.style.display = 'none';
              return;
            }

            // Mostrar painel de confirmação + encaminhamento
            // Remover closeOnOutside enquanto estiver no painel de confirmação — evita fechar ao clicar no editor
            if (picker._closeHandler) {
              document.removeEventListener('mousedown', picker._closeHandler, true);
              picker._closeHandler = null;
            }

            let QUICK_BTNS = [];
            try { QUICK_BTNS = JSON.parse(prefs.forwardingButtonsRaw || '[]'); } catch {}
            if (!QUICK_BTNS.length) QUICK_BTNS = [
              { label: 'STI \u2013 Migra\u00e7\u00e3o', text: 'Encaminhado para STI \u2013 Migra\u00e7\u00e3o.' },
              { label: 'N3',            text: 'Encaminhado para N3.' },
              { label: 'SPI',           text: 'Encaminhado para SPI.' },
              { label: 'Devolu\u00e7\u00e3o SAJ', text: 'Devolvido ao SAJ.' },
            ];
            const quickHtml = QUICK_BTNS.map(b =>
              `<button class="smax-gse-fwd-quick" data-text="${Utils.escapeHtml(b.text)}"
                style="font-size:10px;padding:2px 8px;border-radius:12px;border:1px solid rgba(148,163,184,.35);background:rgba(148,163,184,.1);color:#94a3b8;cursor:pointer;white-space:nowrap;">${Utils.escapeHtml(b.label)}</button>`
            ).join('');

            picker.innerHTML = `
              <div style="padding:8px 12px;font-size:11px;color:#9ca3af;border-bottom:1px solid rgba(255,255,255,.08);">GSE selecionada:</div>
              <div style="padding:8px 12px 6px;font-size:12px;color:#e2e8f0;font-weight:600;">${Utils.escapeHtml(gname)}</div>
              <div style="padding:6px 12px 8px;border-top:1px solid rgba(255,255,255,.06);">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:#d1d5db;user-select:none;">
                  <input type="checkbox" id="smax-gse-fwd-cb" style="cursor:pointer;"> 📤 Com encaminhamento
                </label>
              </div>
              <div id="smax-gse-fwd-area" style="display:none;padding:0 12px 10px;">
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">${quickHtml}</div>
                <div id="smax-gse-fwd-editor" contenteditable="true" spellcheck="false"
                  data-placeholder="Texto de encaminhamento (suporta imagens coladas)..."></div>
              </div>
              <div style="display:flex;gap:6px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.08);">
                <button id="smax-gse-fwd-back" style="flex:1;padding:5px 0;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#9ca3af;font-size:11px;cursor:pointer;">← Voltar</button>
                <button id="smax-gse-fwd-confirm" style="flex:2;padding:5px 0;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Confirmar</button>
              </div>`;

            // Checkbox toggle
            const cb = picker.querySelector('#smax-gse-fwd-cb');
            const fwdArea = picker.querySelector('#smax-gse-fwd-area');
            cb.addEventListener('change', () => {
              fwdArea.style.display = cb.checked ? 'block' : 'none';
              if (cb.checked) picker.querySelector('#smax-gse-fwd-editor')?.focus();
            });
            // Paste de imagem no editor de encaminhamento
            addImagePasteHandler(picker.querySelector('#smax-gse-fwd-editor'));

            // Botões rápidos
            picker.querySelectorAll('.smax-gse-fwd-quick').forEach(qbtn => {
              qbtn.addEventListener('click', () => {
                const ta = picker.querySelector('#smax-gse-fwd-editor');
                if (ta) { ta.innerHTML = Utils.escapeHtml(qbtn.dataset.text).replace(/\n/g, '<br>'); ta.focus(); }
              });
            });

            // Voltar — volta para a lista de grupos e re-registra closeOnOutside
            picker.querySelector('#smax-gse-fwd-back').addEventListener('click', () => {
              picker.innerHTML = `<input class="smax-resp-field-picker-search" type="text" placeholder="Buscar grupo..." autocomplete="off"><div class="smax-resp-field-picker-list"></div>`;
              renderGroups('');
              const s = picker.querySelector('.smax-resp-field-picker-search');
              s?.addEventListener('input', () => renderGroups(s.value));
              s?.focus();
              const newHandler = (e) => { if (!picker.contains(e.target) && e.target !== btn) { picker.style.display = 'none'; document.removeEventListener('mousedown', newHandler, true); picker._closeHandler = null; } };
              picker._closeHandler = newHandler;
              setTimeout(() => document.addEventListener('mousedown', newHandler, true), 0);
            });

            // Confirmar
            picker.querySelector('#smax-gse-fwd-confirm').addEventListener('click', () => {
              const chipEl = backdrop.querySelector('#smax-resp-gse-chip-name');
              const chipBtn = backdrop.querySelector('#smax-resp-gse-btn');
              setBatchPending('gse', { id: gid, name: gname });
              if (chipEl) chipEl.textContent = gname;
              const fwdText = cb.checked ? (picker.querySelector('#smax-gse-fwd-editor')?.innerHTML || '').trim() : '';
              setBatchPending('forwarding', fwdText ? { text: fwdText } : null);
              if (chipBtn) {
                chipBtn.classList.add('dirty');
                chipBtn.title = `Alterar GSE → ${gname} (todos selecionados)${fwdText ? ' | 📤 Com encaminhamento' : ''}`;
              }
              // Encaminhamento implica remoção do especialista (chamado vai para outra equipe)
              if (fwdText) {
                setBatchPending('assignee', null);
                const assigneeChipName = backdrop.querySelector('#smax-resp-assignee-chip-name');
                const assigneeChipBtn  = backdrop.querySelector('#smax-resp-assignee-btn');
                const origEntry = DataRepository.triageCache.get(activeTicketId);
                if (assigneeChipName) assigneeChipName.textContent = resolveAssigneeName(origEntry?.expertAssigneeId || '') || 'Sem especialista';
                if (assigneeChipBtn)  { assigneeChipBtn.classList.remove('dirty'); assigneeChipBtn.title = 'Alterar especialista'; }
              }
              updateSendButton();
              picker.style.display = 'none';
            });
          });
        });
      };

      picker.innerHTML = `
        <input class="smax-resp-field-picker-search" type="text" placeholder="Buscar grupo..." autocomplete="off">
        <div class="smax-resp-field-picker-list"></div>`;
      renderGroups('');
      positionPicker(picker, btn);

      const search = picker.querySelector('.smax-resp-field-picker-search');
      search?.addEventListener('input', () => renderGroups(search.value));
      search?.focus();

      const closeOnOutside = (e) => {
        if (!picker.contains(e.target) && e.target !== btn) {
          picker.style.display = 'none';
          document.removeEventListener('mousedown', closeOnOutside, true);
          picker._closeHandler = null;
        }
      };
      if (picker._closeHandler) document.removeEventListener('mousedown', picker._closeHandler, true);
      picker._closeHandler = closeOnOutside;
      setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
    };

    const openAssigneePicker = async () => {
      if (!backdrop || !activeTicketId) return;
      const picker = backdrop.querySelector('#smax-resp-assignee-picker');
      const btn = backdrop.querySelector('#smax-resp-assignee-btn');
      if (!picker || !btn) return;
      if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
      closeAllPickers();
      picker.innerHTML = '<div class="smax-resp-field-picker-empty">Carregando pessoas...</div>';
      positionPicker(picker, btn);

      await DataRepository.ensurePeopleLoaded();
      const pending = getBatchPending();
      const currentAssigneeId = pending.assignee?.id || DataRepository.triageCache.get(activeTicketId)?.expertAssigneeId || '';
      const people = Array.from(DataRepository.peopleCache.values()).sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', 'pt'));

      const renderPeople = (filter) => {
        const q = (filter || '').toLowerCase();
        const filtered = q ? people.filter(p => (p.name || p.fullName || '').toLowerCase().includes(q)) : people.slice(0, 80);
        if (!filtered.length) {
          picker.querySelector('.smax-resp-field-picker-list').innerHTML =
            '<div class="smax-resp-field-picker-empty">Nenhuma pessoa encontrada.</div>';
          return;
        }
        picker.querySelector('.smax-resp-field-picker-list').innerHTML = filtered.map(p => {
          const isActive = p.id === currentAssigneeId;
          const label = p.name || p.fullName || p.id;
          return `<div class="smax-resp-field-picker-item${isActive ? ' active' : ''}" data-id="${Utils.escapeHtml(p.id)}" data-name="${Utils.escapeHtml(label)}">
            ${isActive ? '✓ ' : ''}<span>${Utils.escapeHtml(label)}</span>
          </div>`;
        }).join('');
        picker.querySelectorAll('.smax-resp-field-picker-item').forEach(item => {
          item.addEventListener('click', () => {
            const pid = item.dataset.id;
            const pname = item.dataset.name;
            const chipEl = backdrop.querySelector('#smax-resp-assignee-chip-name');
            const chipBtn = backdrop.querySelector('#smax-resp-assignee-btn');
            const curPending = getBatchPending();
            const alreadySet = curPending.assignee?.id === pid;
            setBatchPending('assignee', alreadySet ? null : { id: pid, name: pname });
            const isDirty = !alreadySet;
            const origEntry = DataRepository.triageCache.get(activeTicketId);
            if (chipEl) chipEl.textContent = isDirty ? pname : (resolveAssigneeName(origEntry?.expertAssigneeId || '') || 'Sem especialista');
            if (chipBtn) {
              chipBtn.classList.toggle('dirty', isDirty);
              chipBtn.title = isDirty ? `Alterar especialista → ${pname} (todos selecionados)` : 'Alterar especialista';
            }
            updateSendButton();
            picker.style.display = 'none';
          });
        });
      };

      picker.innerHTML = `
        <input class="smax-resp-field-picker-search" type="text" placeholder="Buscar especialista..." autocomplete="off">
        <div class="smax-resp-field-picker-list"></div>`;
      renderPeople('');
      positionPicker(picker, btn);

      const search = picker.querySelector('.smax-resp-field-picker-search');
      search?.addEventListener('input', () => renderPeople(search.value));
      search?.focus();

      const closeOnOutside = (e) => {
        if (!picker.contains(e.target) && e.target !== btn) {
          picker.style.display = 'none';
          document.removeEventListener('mousedown', closeOnOutside, true);
          picker._closeHandler = null;
        }
      };
      if (picker._closeHandler) document.removeEventListener('mousedown', picker._closeHandler, true);
      picker._closeHandler = closeOnOutside;
      setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
    };

    // Statuses oferecidos no picker (os mais usados no dia a dia)
    const CHANGEABLE_STATUSES = [
      'RequestStatusActive',
      'RequestStatusInProgress',
      'RequestStatusPendingCustomer',
      'RequestStatusPending',
      'RequestStatusSuspended',
      'RequestStatusClassify',
      'RequestStatusReject',
    ];

    const openStatusPicker = () => {
      if (!backdrop || !activeTicketId) return;
      const picker = backdrop.querySelector('#smax-resp-status-picker');
      const btn = backdrop.querySelector('#smax-resp-status-btn');
      if (!picker || !btn) return;
      if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
      closeAllPickers();

      const pending = getBatchPending();
      const cache = DataRepository.triageCache.get(activeTicketId);
      const currentStatus = pending.status?.key || cache?.status || '';

      picker.innerHTML = CHANGEABLE_STATUSES.map(key => {
        const label = STATUS_LABELS[key] || key.replace('RequestStatus', '');
        const isCurrent = key === currentStatus;
        return `<div class="smax-resp-field-picker-item${isCurrent ? ' status-current' : ''}" data-key="${Utils.escapeHtml(key)}">
          ${isCurrent ? '✓ ' : ''}<span>${Utils.escapeHtml(label)}</span>
        </div>`;
      }).join('');

      positionPicker(picker, btn);

      picker.querySelectorAll('.smax-resp-field-picker-item').forEach(item => {
        item.addEventListener('click', () => {
          const key = item.dataset.key;
          const label = STATUS_LABELS[key] || key.replace('RequestStatus', '');
          const alreadySet = pending.status?.key === key && !item.classList.contains('status-current');
          if (currentStatus === key && !pending.status) {
            // já é o status atual, sem pending — ignorar
            picker.style.display = 'none';
            return;
          }
          if (pending.status?.key === key) {
            // toggle off
            setBatchPending('status', null);
            const chipName = backdrop.querySelector('#smax-resp-status-chip-name');
            const chipBtn2 = backdrop.querySelector('#smax-resp-status-btn');
            if (chipName) chipName.textContent = STATUS_LABELS[cache?.status || ''] || cache?.status || '—';
            if (chipBtn2) { chipBtn2.classList.remove('dirty'); chipBtn2.title = 'Alterar status do chamado'; }
          } else {
            setBatchPending('status', { key, label });
            const chipName = backdrop.querySelector('#smax-resp-status-chip-name');
            const chipBtn2 = backdrop.querySelector('#smax-resp-status-btn');
            if (chipName) chipName.textContent = label;
            if (chipBtn2) { chipBtn2.classList.add('dirty'); chipBtn2.title = `Alterar status (pendente: ${label})`; }
          }
          updateSendButton();
          if (picker._closeHandler) { document.removeEventListener('mousedown', picker._closeHandler, true); picker._closeHandler = null; }
          picker.style.display = 'none';
        });
      });

      const closeOnOutside = (e) => {
        if (!picker.contains(e.target) && e.target !== btn) {
          picker.style.display = 'none';
          document.removeEventListener('mousedown', closeOnOutside, true);
          picker._closeHandler = null;
        }
      };
      if (picker._closeHandler) document.removeEventListener('mousedown', picker._closeHandler, true);
      picker._closeHandler = closeOnOutside;
      setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
    };

    const open = () => {
      if (!backdrop) return;
      DataRepository.ensurePeopleLoaded();
      backdrop.style.display = 'flex';
      if (prefs.myPersonId && !selectedPersonId) {
        selectedPersonId = prefs.myPersonId;
        selectedPersonName = prefs.myPersonName || prefs.myPersonId;
        const displayEl = backdrop.querySelector('#smax-resp-person-display');
        if (displayEl) displayEl.textContent = selectedPersonName;
      }
    };

    const init = () => {
      if (backdrop) return;

      backdrop = document.createElement('div');
      backdrop.id = 'smax-resp-hud-backdrop';
      backdrop.innerHTML = `
        <div id="smax-resp-hud">
          <!-- Left: filter + ticket list -->
          <div id="smax-resp-hud-list">
            <div id="smax-resp-filter-panel">
              <div id="smax-resp-filter-header">
                <span style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;">Filtros</span>
                <div style="display:flex;align-items:center;gap:5px;margin-left:auto;">
                  <button id="smax-resp-clear-filters" title="Limpar filtros ativos" style="display:none;padding:3px 7px;border:1px solid rgba(248,113,113,.35);border-radius:5px;background:rgba(248,113,113,.08);color:#f87171;font-size:10px;cursor:pointer;white-space:nowrap;">✕ Limpar</button>
                  <button id="smax-resp-fetch-btn" style="padding:5px 10px;border:none;border-radius:6px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">↺ Carregar</button>
                  <button id="smax-resp-toggle-criteria" title="Mostrar/ocultar critérios" style="padding:4px 7px;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:transparent;color:#9ca3af;font-size:11px;cursor:pointer;line-height:1;">▲</button>
                </div>
              </div>
              <div id="smax-resp-filter-criteria">
                <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Equipes</div>
                <div id="smax-resp-team-filters" style="display:flex;flex-direction:column;gap:3px;margin-bottom:10px;"></div>
                <div id="smax-resp-status-section" style="display:none;">
                  <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Status Operacional</div>
                  <div id="smax-resp-status-filters" style="display:flex;flex-direction:column;gap:3px;margin-bottom:10px;"></div>
                </div>
                <div id="smax-resp-assignee-section" style="display:none;">
                  <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Designado</div>
                  <div id="smax-resp-assignee-filters" style="display:flex;flex-direction:column;gap:3px;margin-bottom:10px;"></div>
                </div>
                <div id="smax-resp-search-info" style="display:none;padding:8px;background:rgba(255,255,255,.04);border-radius:6px;border:1px solid rgba(255,255,255,.07);"></div>
              </div>
            </div>
            <div style="padding:5px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(2,6,23,.4);">
              <span id="smax-resp-ticket-count" style="font-size:12px;font-weight:700;color:#60a5fa;"></span>
              <span id="smax-resp-status-msg" style="font-size:10px;"></span>
              <div id="smax-resp-select-all-btn" style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:#9ca3af;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,.1);transition:background .12s;" title="Selecionar/desmarcar todos">
                <span id="smax-resp-select-all-icon" style="font-size:13px;">☐</span> Todos
              </div>
            </div>
            <div id="smax-resp-num-search-bar" style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(2,6,23,.4);">
              <div style="display:flex;gap:5px;">
                <input type="text" id="smax-resp-num-search-input" placeholder="🔍 Buscar por número..." inputmode="numeric" autocomplete="off"
                  style="flex:1;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);border-radius:5px;padding:4px 8px;color:#fff;font-size:11px;outline:none;min-width:0;">
                <button id="smax-resp-num-search-btn" type="button" style="padding:4px 10px;border:none;border-radius:5px;background:rgba(59,130,246,.5);color:#fff;font-size:11px;cursor:pointer;white-space:nowrap;">→</button>
              </div>
            </div>
            <div id="smax-resp-text-filter-bar" style="padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(2,6,23,.4);">
              <div style="position:relative;">
                <input type="text" id="smax-resp-text-filter" placeholder="Filtrar lista (desc, solicitante, local)..." autocomplete="off"
                  style="width:100%;box-sizing:border-box;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:5px;padding:4px 24px 4px 8px;color:#fff;font-size:11px;outline:none;">
                <button id="smax-resp-text-filter-clear" type="button"
                  style="display:none;position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;color:#6b7280;cursor:pointer;font-size:13px;line-height:1;padding:0 2px;" title="Limpar filtro">✕</button>
              </div>
            </div>
            <div id="smax-resp-sort-bar" style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(2,6,23,.4);display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
              <span style="font-size:9px;color:#4b5563;text-transform:uppercase;letter-spacing:.06em;flex-shrink:0;">Ord.</span>
              <button class="smax-sort-btn active" data-field="id">ID</button>
              <button class="smax-sort-btn" data-field="createTime">Data</button>
              <button class="smax-sort-btn" data-field="status">Status</button>
              <button class="smax-sort-btn" data-field="assignee">Espec.</button>
              <button id="smax-sort-dir-btn" type="button" style="margin-left:auto;background:none;border:none;color:#6b7280;font-size:12px;cursor:pointer;padding:0 2px;line-height:1;" title="Inverter ordem">↓</button>
            </div>
            <div id="smax-resp-ticket-list" style="flex:1;overflow-y:auto;"></div>
            <div id="smax-resp-batch-bar" style="display:none;padding:6px 10px;border-top:1px solid rgba(255,255,255,.06);align-items:center;background:rgba(59,130,246,.08);">
              <span id="smax-resp-batch-count" style="font-size:11px;color:#93c5fd;"></span>
            </div>
          </div>

          <!-- Right: detail -->
          <div id="smax-resp-hud-main">
            <div id="smax-resp-hud-header">
              <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;overflow:hidden;">
                <a id="smax-resp-ticket-id-link" href="#" target="_blank" style="font-size:14px;font-weight:700;color:#fff;text-decoration:none;white-space:nowrap;opacity:.9;">—</a>
                <span id="smax-resp-detail-global-badge" style="display:none;flex-shrink:0;"></span>
                <span id="smax-resp-opener" style="font-size:12px;color:rgba(255,255,255,.65);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
                <span id="smax-resp-vip-badge" style="display:none;padding:1px 5px;border-radius:999px;background:#facc15;color:#854d0e;font-size:9px;font-weight:700;flex-shrink:0;">VIP</span>
                <span id="smax-resp-location-label" style="display:none;font-size:10px;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;max-width:160px;cursor:pointer;" title="Clique para ver nome completo"></span>
                <span id="smax-resp-status-label" style="font-size:10px;background:rgba(0,0,0,.3);color:rgba(255,255,255,.8);padding:2px 8px;border-radius:20px;white-space:nowrap;border:1px solid rgba(255,255,255,.2);flex-shrink:0;" title="Status SMAX"></span>
                <span id="smax-resp-sccd-label" style="font-size:10px;background:rgba(245,158,11,.2);color:#fcd34d;padding:2px 8px;border-radius:20px;white-space:nowrap;border:1px solid rgba(245,158,11,.4);flex-shrink:0;display:none;" title="Status Operacional"></span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <input type="text" id="smax-resp-global-id" placeholder="Global ID" inputmode="numeric" autocomplete="off"
                  style="width:80px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;color:#fff;font-size:11px;outline:none;">
                <button type="button" id="smax-resp-global-link-btn" title="Vincular chamado ativo ao Global informado">🔗 Vincular</button>
                <button type="button" id="smax-resp-close-btn" title="Fechar" style="border:none;background:rgba(0,0,0,.3);color:rgba(255,255,255,.8);font-size:14px;width:28px;height:28px;border-radius:6px;cursor:pointer;border:1px solid rgba(255,255,255,.2);">✕</button>
              </div>
            </div>

            <div id="smax-resp-hud-body">
              <div id="smax-resp-content-area">
                <div id="smax-resp-no-ticket" style="flex:1;display:flex;align-items:center;justify-content:center;">
                  <span>Selecione um chamado para começar.</span>
                </div>
                <div id="smax-resp-detail" style="display:none;">
                  <!-- Meta-bar: GSE, Especialista e Status editáveis -->
                  <div id="smax-resp-meta-bar">
                    <button id="smax-resp-gse-btn" class="smax-resp-meta-chip" title="Alterar GSE (Grupo de Suporte)">
                      🏢 <span id="smax-resp-gse-chip-name">—</span><span class="chip-edit">✎</span>
                    </button>
                    <button id="smax-resp-assignee-btn" class="smax-resp-meta-chip" title="Alterar especialista">
                      👤 <span id="smax-resp-assignee-chip-name">Sem especialista</span><span class="chip-edit">✎</span>
                    </button>
                    <button id="smax-resp-status-btn" class="smax-resp-meta-chip" title="Alterar status do chamado">
                      🔄 <span id="smax-resp-status-chip-name">—</span><span class="chip-edit">✎</span>
                    </button>
                  </div>
                  <!-- Pickers fixos (posicionados via JS) -->
                  <div id="smax-resp-gse-picker" class="smax-resp-field-picker"></div>
                  <div id="smax-resp-assignee-picker" class="smax-resp-field-picker"></div>
                  <div id="smax-resp-status-picker" class="smax-resp-field-picker"></div>
                  <div id="smax-resp-desc-panel">
                    <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">📋 Descrição</div>
                    <div id="smax-resp-desc-content"></div>
                  </div>
                  <div id="smax-resp-solution-panel">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                      <span style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;">✏️ Solução</span>
                      <button id="smax-resp-scripts-btn" type="button" style="font-size:11px;padding:3px 10px;border:1px solid rgba(255,255,255,.15);border-radius:6px;background:rgba(255,255,255,.06);color:#d1d5db;cursor:pointer;transition:background .15s;">📋 Scripts de Respostas</button>
                    </div>
                    <div style="position:relative;flex:1;min-height:0;display:flex;flex-direction:column;">
                      <div id="smax-resp-solution-toolbar">
                        <button type="button" class="smax-resp-tb-btn" data-cmd="bold"                title="Negrito (Ctrl+B)"><b>N</b></button>
                        <button type="button" class="smax-resp-tb-btn" data-cmd="italic"              title="Itálico (Ctrl+I)"><i>I</i></button>
                        <button type="button" class="smax-resp-tb-btn" data-cmd="underline"           title="Sublinhado (Ctrl+U)"><u>S</u></button>
                        <span class="smax-resp-tb-sep"></span>
                        <button type="button" class="smax-resp-tb-btn" data-cmd="insertUnorderedList" title="Lista com marcadores">• Lista</button>
                        <button type="button" class="smax-resp-tb-btn" data-cmd="insertOrderedList"   title="Lista numerada">1. Lista</button>
                        <span class="smax-resp-tb-sep"></span>
                        <button type="button" class="smax-resp-tb-btn" data-cmd="removeFormat"        title="Remover formatação">T̲×</button>
                      </div>
                      <div id="smax-resp-solution-editor" contenteditable="true" spellcheck="false" data-placeholder="Digite aqui a solução do chamado..."></div>
                      <div id="smax-resp-script-picker"></div>
                    </div>
                  </div>
                  <!-- Anexos -->
                  <div id="smax-resp-attachment-row" data-empty="true">
                    <span style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;flex-shrink:0;">📎 Anexos</span>
                    <div id="smax-resp-attachment-list" data-state="empty"></div>
                  </div>
                </div>
              </div>

              <aside id="smax-resp-hud-discussions">
                <div style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0;">💬 Discussões</div>
                <div id="smax-resp-discussions-list"></div>
              </aside>
            </div>

            <div id="smax-resp-hud-footer">
              <div style="font-size:11px;color:#6b7280;">Escritas reais: <span style="color:${prefs.enableRealWrites ? '#4ade80' : '#f87171'}">${prefs.enableRealWrites ? 'ativadas' : 'desativadas'}</span></div>
              <div style="display:flex;align-items:center;gap:8px;">
                <button id="smax-resp-report-btn" type="button" style="padding:6px 14px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:rgba(255,255,255,.06);color:#d1d5db;font-size:12px;cursor:pointer;">📊 Relatório</button>
                <button id="smax-resp-send-btn" type="button" style="padding:8px 28px;border:none;border-radius:8px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(34,197,94,.35);transition:transform .12s,box-shadow .12s;">ENVIAR</button>
              </div>
            </div>
          </div>
          <!-- Activity Report Modal (overlay) -->
          <div id="smax-resp-report-modal" style="display:none;position:absolute;inset:0;background:rgba(2,6,23,.97);z-index:10;border-radius:inherit;flex-direction:column;overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;">
              <span style="font-size:14px;font-weight:700;color:#e5e7eb;">📊 Relatório de Atividades</span>
              <button id="smax-resp-report-close" type="button" style="border:none;background:rgba(0,0,0,.3);color:rgba(255,255,255,.8);font-size:14px;width:28px;height:28px;border-radius:6px;cursor:pointer;border:1px solid rgba(255,255,255,.2);">✕</button>
            </div>
            <div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <label style="font-size:11px;color:#9ca3af;">De:</label>
              <input type="date" id="smax-resp-report-from" style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);border-radius:5px;padding:4px 8px;color:#e5e7eb;font-size:11px;outline:none;">
              <label style="font-size:11px;color:#9ca3af;">Até:</label>
              <input type="date" id="smax-resp-report-to" style="background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);border-radius:5px;padding:4px 8px;color:#e5e7eb;font-size:11px;outline:none;">
              <button id="smax-resp-report-gen-btn" type="button" style="padding:5px 14px;border:none;border-radius:6px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Gerar</button>
              <button id="smax-resp-report-export-btn" type="button" style="padding:5px 14px;border:1px solid rgba(255,255,255,.15);border-radius:6px;background:rgba(255,255,255,.06);color:#d1d5db;font-size:11px;cursor:pointer;display:none;">⬇ Exportar CSV</button>
            </div>
            <div id="smax-resp-report-content" style="flex:1;overflow-y:auto;padding:12px 16px;">
              <div style="color:#6b7280;font-size:12px;text-align:center;padding-top:40px;">Selecione o período e clique em Gerar.</div>
            </div>
          </div>
        </div>`;

      document.body.appendChild(backdrop);

      // Restaura filtros da sessão anterior
      try {
        const saved = JSON.parse(GM_getValue('smax_resp_filters', '{}'));
        if (saved.statuses?.length) saved.statuses.forEach(s => selectedStatuses.add(s));
        if (saved.assignees?.length) saved.assignees.forEach(a => selectedAssignees.add(a));
        if (saved.text) {
          textFilter = saved.text;
          const tfInp = backdrop.querySelector('#smax-resp-text-filter');
          const tfClr = backdrop.querySelector('#smax-resp-text-filter-clear');
          if (tfInp) tfInp.value = textFilter;
          if (tfClr) tfClr.style.display = textFilter ? '' : 'none';
        }
      } catch {}

      // Populate team pills
      const teamFilterEl = backdrop.querySelector('#smax-resp-team-filters');
      if (teamFilterEl) {
        const teams = TeamsConfig.getTeams();
        // Pre-select all teams on first open
        if (selectedTeamIds.size === 0) teams.forEach(t => selectedTeamIds.add(t.id));
        if (teams.length) {
          teamFilterEl.innerHTML = teams.map(t => {
            const active = selectedTeamIds.has(t.id);
            const hasGSE = (t.gseRules && t.gseRules.some(r => r.id)) || (t.gseIds && t.gseIds.length > 0);
            const srcHint = hasGSE ? '🔵' : '🟡';
            const srcTitle = hasGSE ? 'Busca por GSE na API' : 'Busca via fila local (sem GSE IDs configurados)';
            return `<button class="smax-resp-team-pill" data-team-id="${Utils.escapeHtml(t.id)}"
              title="${Utils.escapeHtml(srcTitle)}"
              style="display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border-radius:6px;border:1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,.12)'};background:${active ? 'rgba(59,130,246,.25)' : 'transparent'};color:${active ? '#93c5fd' : '#9ca3af'};font-size:11px;cursor:pointer;text-align:left;transition:all .15s;">
              <span style="width:8px;height:8px;border-radius:50%;background:${active ? '#3b82f6' : 'transparent'};border:1.5px solid ${active ? '#3b82f6' : '#6b7280'};flex-shrink:0;"></span>
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escapeHtml(t.name || t.id)}</span>
              <span style="font-size:9px;opacity:.7;">${srcHint}</span>
            </button>`;
          }).join('');
          teamFilterEl.querySelectorAll('.smax-resp-team-pill').forEach(pill => {
            pill.addEventListener('click', () => {
              const id = pill.dataset.teamId;
              if (selectedTeamIds.has(id)) selectedTeamIds.delete(id);
              else selectedTeamIds.add(id);
              const active = selectedTeamIds.has(id);
              pill.style.border = `1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,.12)'}`;
              pill.style.background = active ? 'rgba(59,130,246,.25)' : 'transparent';
              pill.style.color = active ? '#93c5fd' : '#9ca3af';
              const dot = pill.querySelector('span');
              if (dot) { dot.style.background = active ? '#3b82f6' : 'transparent'; dot.style.border = `1.5px solid ${active ? '#3b82f6' : '#6b7280'}`; }
            });
          });
        } else {
          teamFilterEl.innerHTML = '<div style="font-size:11px;color:#6b7280;">Nenhuma equipe configurada.</div>';
        }
      }

      // Close
      backdrop.querySelector('#smax-resp-close-btn').addEventListener('click', close);
      backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

      // Local do solicitante: clique revela nome completo via tooltip flutuante
      backdrop.querySelector('#smax-resp-location-label')?.addEventListener('click', function() {
        const full = this.dataset.fullLocation || this.textContent;
        if (!full) return;
        let tip = backdrop.querySelector('#smax-resp-location-tip');
        if (!tip) {
          tip = document.createElement('div');
          tip.id = 'smax-resp-location-tip';
          Object.assign(tip.style, {
            position: 'fixed', background: '#1e293b', color: '#e5e7eb', fontSize: '12px',
            padding: '6px 10px', borderRadius: '7px', border: '1px solid rgba(255,255,255,.15)',
            boxShadow: '0 4px 16px rgba(0,0,0,.5)', zIndex: '9999999',
            maxWidth: '320px', wordBreak: 'break-word', cursor: 'pointer',
            lineHeight: '1.5',
          });
          tip.title = 'Clique para fechar';
          tip.addEventListener('click', () => tip.remove());
          backdrop.appendChild(tip);
        }
        tip.textContent = full;
        const rect = this.getBoundingClientRect();
        tip.style.top = (rect.bottom + 6) + 'px';
        tip.style.left = rect.left + 'px';
        // auto-remove on next click outside
        setTimeout(() => {
          const removeTip = (ev) => { if (!tip.contains(ev.target)) { tip.remove(); document.removeEventListener('click', removeTip, true); } };
          document.addEventListener('click', removeTip, true);
        }, 0);
      });

      // Toggle criteria visibility
      const criteriaEl = backdrop.querySelector('#smax-resp-filter-criteria');
      const toggleBtn  = backdrop.querySelector('#smax-resp-toggle-criteria');
      const setCriteriaVisible = (visible) => {
        if (!criteriaEl || !toggleBtn) return;
        criteriaEl.classList.toggle('collapsed', !visible);
        toggleBtn.textContent = visible ? '▲' : '▼';
        toggleBtn.title = visible ? 'Ocultar critérios' : 'Mostrar critérios';
      };
      toggleBtn?.addEventListener('click', () => setCriteriaVisible(criteriaEl?.classList.contains('collapsed')));

      // Limpar filtros ativos
      backdrop.querySelector('#smax-resp-clear-filters')?.addEventListener('click', () => {
        selectedStatuses.clear();
        selectedAssignees.clear();
        applyFilters();
        renderStatusPills(allFetchedEntries);
        renderAssigneePills(allFetchedEntries);
      });

      // Fetch button — carregar e recolher critérios automaticamente
      backdrop.querySelector('#smax-resp-fetch-btn')?.addEventListener('click', async () => {
        await fetchTickets();
        setCriteriaVisible(false);
      });

      // Select all button
      let allSelected = false;
      backdrop.querySelector('#smax-resp-select-all-btn')?.addEventListener('click', () => {
        allSelected = !allSelected;
        if (allSelected) ticketList.forEach(t => selectedTicketIds.add(t.id));
        else selectedTicketIds.clear();
        const icon = backdrop.querySelector('#smax-resp-select-all-icon');
        if (icon) icon.textContent = allSelected ? '☑' : '☐';
        renderTicketList();
        updateBatchBar();
      });

      // Atualiza label do botão ao digitar na solução
      const solEditor = backdrop.querySelector('#smax-resp-solution-editor');
      solEditor?.addEventListener('input', updateSendButton);
      addImagePasteHandler(solEditor, updateSendButton);

      // Toolbar de formatação (execCommand via mousedown para não tirar o foco do editor)
      backdrop.querySelectorAll('#smax-resp-solution-toolbar .smax-resp-tb-btn').forEach(btn => {
        btn.addEventListener('mousedown', e => {
          e.preventDefault();
          document.execCommand(btn.dataset.cmd, false, null);
          updateSendButton();
        });
      });

      // Scripts picker
      backdrop.querySelector('#smax-resp-scripts-btn')?.addEventListener('click', openScriptPicker);

      // GSE picker
      backdrop.querySelector('#smax-resp-gse-btn')?.addEventListener('click', openGsePicker);

      // Especialista picker
      backdrop.querySelector('#smax-resp-assignee-btn')?.addEventListener('click', openAssigneePicker);

      // Status picker
      backdrop.querySelector('#smax-resp-status-btn')?.addEventListener('click', openStatusPicker);

      // Botão Vincular Global — suporte a lote, auto-designar, detectar duplicata
      backdrop.querySelector('#smax-resp-global-link-btn')?.addEventListener('click', async () => {
        const inputEl = backdrop.querySelector('#smax-resp-global-id');
        const globalId = (inputEl?.value || '').trim().replace(/\D/g, '');
        if (!globalId) { setStatusMsg('Informe o ID do chamado global.', '#fca5a5'); return; }
        if (!prefs.enableRealWrites) { setStatusMsg('⚠️ Escritas reais desativadas.', '#facc15'); return; }

        // Determina alvos: selecionados em lote ou chamado ativo
        const targets = selectedTicketIds.size > 0
          ? [...selectedTicketIds]
          : activeTicketId ? [activeTicketId] : [];
        if (!targets.length) { setStatusMsg('Selecione um chamado primeiro.', '#fca5a5'); return; }

        // Detecta já vinculados ao mesmo global
        const alreadyLinked = targets.filter(id => {
          const c = DataRepository.triageCache.get(id);
          return c?.globalChangeId === globalId;
        });
        const toLink = targets.filter(id => !alreadyLinked.includes(id));

        if (alreadyLinked.length && !toLink.length) {
          setStatusMsg(`⚠️ Chamado(s) já vinculado(s) ao Global #${globalId}.`, '#facc15');
          return;
        }
        if (alreadyLinked.length) {
          setStatusMsg(`⚠️ ${alreadyLinked.length} já vinculado(s). Vinculando os demais...`, '#facc15');
        } else {
          setStatusMsg(`Vinculando ${toLink.length} chamado(s) ao Global #${globalId}...`, '#93c5fd');
        }

        let ok = 0, fail = 0;
        for (const ticketId of toLink) {
          try {
            const result = await Api.postCreateRequestCausesRequest(globalId, ticketId);
            const outcome = Api.summarizeBulkOutcome(result);
            if (outcome?.ok !== false) {
              const existing = DataRepository.triageCache.get(ticketId) || {};
              const noAssignee = !existing.expertAssigneeId;
              DataRepository.triageCache.set(ticketId, Object.assign({}, existing, { globalChangeId: globalId }));
              ActivityLog.log({ ticketId, globalAssigned: true, globalChangeId: globalId });

              // Auto-designar ao usuário atual se sem especialista
              if (noAssignee && prefs.myPersonId) {
                try {
                  await Api.postUpdateRequest({ Id: ticketId, ExpertAssignee: prefs.myPersonId });
                  const cur = DataRepository.triageCache.get(ticketId) || {};
                  DataRepository.triageCache.set(ticketId, Object.assign({}, cur, { expertAssigneeId: prefs.myPersonId }));
                } catch {}
              }

              // Atualizar status para Suspenso após vinculação global
              try {
                await Api.postUpdateRequest({ Id: ticketId, Status: 'RequestStatusSuspended' });
                const cur2 = DataRepository.triageCache.get(ticketId) || {};
                DataRepository.triageCache.set(ticketId, Object.assign({}, cur2, { status: 'RequestStatusSuspended' }));
                const statusEl = backdrop.querySelector(`.smax-resp-ticket-item[data-id="${CSS.escape(ticketId)}"] .smax-resp-ticket-status`);
                if (statusEl) statusEl.textContent = 'Suspenso';
              } catch {}

              // Atualiza badge na lista
              const listItem = backdrop.querySelector(`.smax-resp-ticket-item[data-id="${CSS.escape(ticketId)}"]`);
              const idDiv = listItem?.querySelector('.smax-resp-ticket-id');
              if (idDiv && !idDiv.querySelector('.smax-global-badge') && !idDiv.querySelector('.smax-warning-badge')) {
                idDiv.innerHTML = `<span style="color:#60a5fa;font-weight:700;">#${Utils.escapeHtml(ticketId)}</span>`
                  + ` <span class="smax-global-badge" style="color:#f87171;font-size:9px;padding:1px 5px;border-radius:10px;border:1px solid rgba(248,113,113,.35);vertical-align:middle;">⬆ Global #${Utils.escapeHtml(globalId)}</span>`;
              }
              ok++;
            } else {
              fail++;
            }
          } catch {
            fail++;
          }
        }

        if (inputEl) inputEl.value = '';
        if (fail === 0) {
          setStatusMsg(`✓ ${ok} chamado(s) vinculado(s) ao Global #${globalId}.`, '#4ade80');
        } else {
          setStatusMsg(`${ok} vinculado(s), ${fail} erro(s).`, '#fca5a5');
        }
      });

      // Buscar chamado por número
      const doSearchTicket = async () => {
        const searchInput = backdrop.querySelector('#smax-resp-num-search-input');
        const id = (searchInput?.value || '').trim().replace(/\D/g, '');
        if (!id) return;
        setStatusMsg(`Buscando #${id}...`, '#93c5fd');
        try {
          await DataRepository.ensurePeopleLoaded();
          const entry = await DataRepository.ensureRequestPayload(id, { force: true });
          if (!entry && !DataRepository.triageCache.get(id)) {
            setStatusMsg(`Chamado #${id} não encontrado.`, '#fca5a5');
            return;
          }
          if (!ticketList.find(t => t.id === id)) {
            const cached = DataRepository.triageCache.get(id) || {};
            ticketList.unshift({
              id,
              subject: cached.subjectText || id,
              descSnippet: '',
              status: cached.status || '',
              statusSCCD: cached.statusSCCD || '',
              gse: cached.assignmentGroupName || '',
              assignee: cached.expertAssigneeId || '',
              isVip: cached.isVip || false,
              requestedForName: cached.requestedForName || '',
              locationName: cached.locationName || '',
            });
          }
          renderTicketList();
          setStatusMsg('', '');
          loadTicket(id);
          if (searchInput) searchInput.value = '';
        } catch (e) {
          setStatusMsg(`Erro: ${e.message}`, '#fca5a5');
        }
      };
      backdrop.querySelector('#smax-resp-num-search-btn')?.addEventListener('click', doSearchTicket);
      backdrop.querySelector('#smax-resp-num-search-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') doSearchTicket();
      });

      // Filtro de texto livre sobre a lista carregada
      backdrop.querySelector('#smax-resp-text-filter')?.addEventListener('input', function() {
        textFilter = this.value;
        const clearBtn = backdrop.querySelector('#smax-resp-text-filter-clear');
        if (clearBtn) clearBtn.style.display = this.value ? '' : 'none';
        applyFilters();
      });
      backdrop.querySelector('#smax-resp-text-filter-clear')?.addEventListener('click', () => {
        textFilter = '';
        const inp = backdrop.querySelector('#smax-resp-text-filter');
        if (inp) inp.value = '';
        const clearBtn = backdrop.querySelector('#smax-resp-text-filter-clear');
        if (clearBtn) clearBtn.style.display = 'none';
        applyFilters();
      });

      // Botões de ordenação
      backdrop.querySelectorAll('.smax-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const field = btn.dataset.field;
          if (sortField === field) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortField = field;
            sortDir = (field === 'status' || field === 'assignee') ? 'asc' : 'desc';
          }
          backdrop.querySelectorAll('.smax-sort-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.field === sortField));
          const dirBtn = backdrop.querySelector('#smax-sort-dir-btn');
          if (dirBtn) dirBtn.textContent = sortDir === 'asc' ? '↑' : '↓';
          applyFilters();
        });
      });
      backdrop.querySelector('#smax-sort-dir-btn')?.addEventListener('click', () => {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        const dirBtn = backdrop.querySelector('#smax-sort-dir-btn');
        if (dirBtn) dirBtn.textContent = sortDir === 'asc' ? '↑' : '↓';
        applyFilters();
      });

      // Relatório de atividades
      const reportModal = backdrop.querySelector('#smax-resp-report-modal');
      backdrop.querySelector('#smax-resp-report-btn')?.addEventListener('click', () => {
        if (!reportModal) return;
        reportModal.style.display = 'flex';
        // Pré-preencher datas: 30 dias atrás até hoje
        const toInput = backdrop.querySelector('#smax-resp-report-to');
        const fromInput = backdrop.querySelector('#smax-resp-report-from');
        const today = new Date();
        const pad = n => String(n).padStart(2, '0');
        const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (toInput && !toInput.value) toInput.value = fmt(today);
        if (fromInput && !fromInput.value) {
          const from = new Date(today); from.setDate(from.getDate() - 30);
          fromInput.value = fmt(from);
        }
      });
      backdrop.querySelector('#smax-resp-report-close')?.addEventListener('click', () => {
        if (reportModal) reportModal.style.display = 'none';
      });
      backdrop.querySelector('#smax-resp-report-gen-btn')?.addEventListener('click', async function() {
        const fromVal = backdrop.querySelector('#smax-resp-report-from')?.value;
        const toVal = backdrop.querySelector('#smax-resp-report-to')?.value;
        const content = backdrop.querySelector('#smax-resp-report-content');
        const exportBtn = backdrop.querySelector('#smax-resp-report-export-btn');
        if (!fromVal || !toVal) { if (content) content.innerHTML = '<div style="color:#fca5a5;font-size:12px;padding:20px;">Informe o período completo.</div>'; return; }
        const fromTs = new Date(fromVal + 'T00:00:00').getTime();
        const toTs = new Date(toVal + 'T23:59:59').getTime();
        this.disabled = true; this.textContent = '…';
        if (content) content.innerHTML = '<div style="color:#6b7280;font-size:12px;padding:20px;text-align:center;">Consultando Supabase…</div>';
        let entries, source;
        try {
          entries = await ActivityLog.fetchFromSupabase(fromTs, toTs);
          source = '☁ Supabase';
        } catch (e) {
          console.warn('[SMAX] Supabase fetch failed, using local:', e);
          entries = ActivityLog.getEntries().filter(e => e.ts >= fromTs && e.ts <= toTs);
          source = '⚠ Local';
        }
        this.disabled = false; this.textContent = 'Gerar';
        if (!entries.length) {
          if (content) content.innerHTML = '<div style="color:#6b7280;font-size:12px;padding:20px;text-align:center;">Nenhuma atividade no período.</div>';
          if (exportBtn) exportBtn.style.display = 'none';
          return;
        }
        // Resumo por tipo
        const counts = { RESPONDIDO: 0, VINCULO_GLOBAL: 0, TRANSFERIDO: 0, DESIGNADO: 0, OUTRO: 0 };
        for (const e of entries) counts[e.relevantWork] = (counts[e.relevantWork] || 0) + 1;
        const uniqueTickets = new Set(entries.map(e => e.ticketId)).size;
        const pad2 = n => String(n).padStart(2, '0');
        const fmtTs = ts => { const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
        const summaryHtml = `
          <div style="font-size:10px;color:#6b7280;margin-bottom:8px;">Fonte: <b style="color:#9ca3af;">${source}</b> — ${entries.length} registro(s)</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
            ${[['Respondidos','RESPONDIDO','#4ade80'],['Vinc. Global','VINCULO_GLOBAL','#60a5fa'],['Transferidos','TRANSFERIDO','#c084fc'],['Designados','DESIGNADO','#fbbf24'],['Outros','OUTRO','#6b7280']].map(([label, key, color]) =>
              `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 14px;text-align:center;">
                <div style="font-size:18px;font-weight:700;color:${color};">${counts[key]||0}</div>
                <div style="font-size:10px;color:#9ca3af;">${label}</div>
              </div>`
            ).join('')}
            <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 14px;text-align:center;">
              <div style="font-size:18px;font-weight:700;color:#e5e7eb;">${uniqueTickets}</div>
              <div style="font-size:10px;color:#9ca3af;">Chamados únicos</div>
            </div>
            <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 14px;text-align:center;">
              <div style="font-size:18px;font-weight:700;color:#e5e7eb;">${entries.length}</div>
              <div style="font-size:10px;color:#9ca3af;">Total ações</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead><tr style="background:rgba(255,255,255,.06);">
              <th style="padding:5px 8px;text-align:left;color:#9ca3af;font-weight:600;white-space:nowrap;">Data/Hora</th>
              <th style="padding:5px 8px;text-align:left;color:#9ca3af;font-weight:600;">Chamado</th>
              <th style="padding:5px 8px;text-align:left;color:#9ca3af;font-weight:600;">Descrição</th>
              <th style="padding:5px 8px;text-align:left;color:#9ca3af;font-weight:600;">Ação</th>
              <th style="padding:5px 8px;text-align:left;color:#9ca3af;font-weight:600;">Detalhe</th>
              <th style="padding:5px 8px;text-align:left;color:#9ca3af;font-weight:600;">Usuário</th>
            </tr></thead>
            <tbody>${entries.slice().reverse().map((e, i) => {
              const desc = (DataRepository.triageCache.get(e.ticketId)?.subjectText || '').slice(0, 60);
              const detalhe = e.globalChangeId ? `→ Global #${Utils.escapeHtml(e.globalChangeId)}` : e.transferredTo ? `→ ${Utils.escapeHtml(e.transferredTo)}` : e.assignedTo ? `→ ${Utils.escapeHtml(e.assignedTo)}` : '';
              return `<tr style="background:${i%2===0?'transparent':'rgba(255,255,255,.02)'};border-bottom:1px solid rgba(255,255,255,.04);">
                <td style="padding:4px 8px;color:#6b7280;white-space:nowrap;">${fmtTs(e.ts)}</td>
                <td style="padding:4px 8px;color:#60a5fa;white-space:nowrap;">#${Utils.escapeHtml(e.ticketId)}</td>
                <td style="padding:4px 8px;color:#e5e7eb;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.escapeHtml(desc)}">${Utils.escapeHtml(desc)}</td>
                <td style="padding:4px 8px;color:#e5e7eb;white-space:nowrap;">${Utils.escapeHtml(e.relevantWork)}</td>
                <td style="padding:4px 8px;color:#9ca3af;white-space:nowrap;">${detalhe}</td>
                <td style="padding:4px 8px;color:#9ca3af;white-space:nowrap;">${Utils.escapeHtml(e.user||'')}</td>
              </tr>`;
            }).join('')}
            </tbody>
          </table>`;
        if (content) content.innerHTML = summaryHtml;
        if (exportBtn) exportBtn.style.display = '';
        // Armazena range filtrado para exportar
        exportBtn._filteredEntries = entries;
      });
      backdrop.querySelector('#smax-resp-report-export-btn')?.addEventListener('click', function() {
        const entriesToExport = this._filteredEntries;
        if (!entriesToExport?.length) return;
        const pad2 = n => String(n).padStart(2, '0');
        const fmtFull = ts => { const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
        const esc = v => { const s = String(v||''); return (s.includes(',')||s.includes('"')||s.includes('\n')) ? '"'+s.replace(/"/g,'""')+'"' : s; };
        const headers = ['Data/Hora','Chamado','Descrição','Ação','Atribuído Para','Global','Transferido Para','Respondido','Script','Usuário','Sucesso'];
        const rows = entriesToExport.map(e => {
          const desc = DataRepository.triageCache.get(e.ticketId)?.subjectText || '';
          return [
            fmtFull(e.ts), e.ticketId, desc, e.relevantWork, e.assignedTo||'', e.globalChangeId||'',
            e.transferredTo||'', e.answered?'Sim':'Não', e.usedScript?'Sim':'Não', e.user||'', e.success?'Sim':'Não'
          ].map(esc).join(',');
        });
        const csv = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const now = new Date();
        const fn = `smax_relatorio_${pad2(now.getDate())}-${pad2(now.getMonth()+1)}-${now.getFullYear()}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fn;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });

      // Send button
      backdrop.querySelector('#smax-resp-send-btn')?.addEventListener('click', commitAll);
    };

    return { init, open };
  })();

  /* =========================================================
   * ZenMode — oculta campos desnecessários do formulário
   * =======================================================*/
  const ZenMode = (() => {
    const ZEN_CLASS = 'smax-zen-active';

    const apply = () => {
      if (prefs.zenModeOn) document.body.classList.add(ZEN_CLASS);
      else document.body.classList.remove(ZEN_CLASS);
    };

    const init = () => apply();
    return { init, apply };
  })();

  /* =========================================================
   * RadarRevisar — badge com chamados rejeitados/pendentes
   * =======================================================*/
  const RadarRevisar = (() => {
    let badgeEl = null;
    let dropdownEl = null;
    let dropdownOpen = false;

    const BADGE_ID    = 'smax-radar-badge';
    const DROPDOWN_ID = 'smax-radar-dropdown';

    const ensureElements = () => {
      if (!badgeEl) {
        badgeEl = document.createElement('div');
        badgeEl.id = BADGE_ID;
        badgeEl.setAttribute('role', 'button');
        badgeEl.setAttribute('aria-label', 'Chamados pendentes');
        document.body.appendChild(badgeEl);
        badgeEl.addEventListener('click', toggleDropdown);
      }
      if (!dropdownEl) {
        dropdownEl = document.createElement('div');
        dropdownEl.id = DROPDOWN_ID;
        document.body.appendChild(dropdownEl);
        const _radarCloseHandler = (e) => {
          if (!badgeEl.contains(e.target) && !dropdownEl.contains(e.target)) closeDropdown();
        };
        document.addEventListener('mousedown', _radarCloseHandler);
      }
    };

    const closeDropdown = () => {
      if (dropdownEl) dropdownEl.style.display = 'none';
      dropdownOpen = false;
    };

    const toggleDropdown = () => {
      if (!dropdownEl) return;
      dropdownOpen = !dropdownOpen;
      dropdownEl.style.display = dropdownOpen ? 'block' : 'none';
      if (dropdownOpen) {
        const r = badgeEl.getBoundingClientRect();
        dropdownEl.style.top  = (r.bottom + 6) + 'px';
        dropdownEl.style.right = (window.innerWidth - r.right) + 'px';
        dropdownEl.style.left = 'auto';
      }
    };

    const renderDropdown = (rejected, ready) => {
      if (!dropdownEl) return;
      const all = [
        ...rejected.map(id => ({ id, type: 'rejected' })),
        ...ready.map(id => ({ id, type: 'accept' })),
      ];
      if (!all.length) { dropdownEl.innerHTML = '<div style="padding:12px;font-size:12px;color:#64748b;">Nenhum chamado pendente.</div>'; return; }
      dropdownEl.innerHTML = all.map(({ id, type }) => `
        <div class="smax-radar-item" data-id="${Utils.escapeHtml(id)}">
          <span class="smax-radar-pill ${type === 'rejected' ? 'rejected' : 'accept'}">${type === 'rejected' ? 'Rejeitado' : 'Aceitar'}</span>
          <span style="font-family:monospace;">${Utils.escapeHtml(id)}</span>
        </div>
      `).join('');
      dropdownEl.querySelectorAll('.smax-radar-item').forEach(el => {
        el.addEventListener('click', () => {
          const id = el.dataset.id;
          if (id) window.open(`https://suporte.tjsp.jus.br/saw/Request/${encodeURIComponent(id)}/general`, '_blank');
          closeDropdown();
        });
      });
    };

    const updateBadge = (rejected, ready) => {
      ensureElements();
      const total = rejected.length + ready.length;
      if (total === 0) { badgeEl.style.display = 'none'; closeDropdown(); return; }
      badgeEl.style.display = 'flex';
      badgeEl.textContent = total;
      badgeEl.title = `${rejected.length} rejeitado(s) • ${ready.length} aguardando aceite`;
      renderDropdown(rejected, ready);
    };

    const query = async () => {
      if (!prefs.radarOn) return;
      const personId = prefs.myPersonId;
      if (!personId) return;
      try {
        const url = `/rest/213963628/ems/Request?filter=(ExpertAssignee=%27${encodeURIComponent(personId)}%27%20and%20(PhaseId%3D%27Review%27%20or%20PhaseId%3D%27Accept%27))&layout=Id,PhaseId,Status&size=500`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const items = (data.entities || []).map(e => ({
          id: (e.properties?.Id || '').replace(/^IMRfc:/, ''),
          phase: e.properties?.PhaseId || '',
        }));
        const rejected = items.filter(i => i.phase === 'Review').map(i => i.id);
        const ready    = items.filter(i => i.phase === 'Accept').map(i => i.id);
        updateBadge(rejected, ready);
      } catch (err) {
        console.warn('[SMAX Radar]', err);
      }
    };

    const init = () => {
      if (!prefs.radarOn) return;
      ensureElements();
      query();
      setInterval(query, 5 * 60 * 1000);
    };

    return { init, query };
  })();

  /* =========================================================
   * Templates — respostas reutilizáveis (localStorage)
   * =======================================================*/
  const Templates = (() => {
    const KEY_SOL  = 'smax_solutions_v2';
    const KEY_DISC = 'smax_discussions_v2';

    let _sharedSol = [], _sharedDisc = [];

    const setSharedScripts = (sol, disc) => {
      _sharedSol = Array.isArray(sol) ? sol : [];
      _sharedDisc = Array.isArray(disc) ? disc : [];
    };

    // Normaliza os dois formatos: { title, html } (nosso) e { title, content } (Felipe)
    const normalize = (arr) => arr.map(t => ({
      title: t.title || '',
      html: t.html || t.content || '',
      _shared: t._shared || false,
    }));

    const load = (disc) => {
      try { const r = JSON.parse(localStorage.getItem(disc ? KEY_DISC : KEY_SOL)); return normalize(Array.isArray(r) ? r : []); }
      catch { return []; }
    };

    // Returns local + shared (shared appended, marked with _shared:true)
    const loadAll = (disc) => {
      const local = load(disc);
      const shared = normalize(disc ? _sharedDisc : _sharedSol).map(s => ({ ...s, _shared: true }));
      return [...local, ...shared];
    };
    // Salva sempre no formato { title, html } para compatibilidade com os dois scripts
    const save = (disc, arr) => localStorage.setItem(disc ? KEY_DISC : KEY_SOL, JSON.stringify(normalize(arr)));

    const insertIntoEditor = (html) => {
      const ck = getPageCKEditor();
      if (ck) {
        const instances = Object.values(ck.instances || {});
        const focused = instances.find(i => i.focusManager?.hasFocus) || instances[instances.length - 1];
        if (focused) { focused.insertHtml(html); return true; }
      }
      const ed = document.querySelector('.cke_editable:focus, [contenteditable="true"]:focus');
      if (ed) { document.execCommand('insertHTML', false, html); return true; }
      return false;
    };

    let modalEl = null;
    let activeDisc = false;
    let editingIdx = null;

    const renderList = () => {
      const list = loadAll(activeDisc);
      const listEl = modalEl.querySelector('.smax-tpl-list');
      if (!listEl) return;

      listEl.innerHTML = list.length === 0
        ? `<div class="smax-tpl-empty">Nenhum script. Clique em "+ Novo" para criar.</div>`
        : list.map((t, i) => `
          <div class="smax-tpl-item" data-idx="${i}" data-shared="${t._shared ? '1' : ''}">
            <div class="smax-tpl-item-title">
              ${Utils.escapeHtml(t.title)}
              ${t._shared ? '<span style="margin-left:5px;font-size:9px;padding:1px 5px;border-radius:999px;background:rgba(56,189,248,.15);color:#38bdf8;border:1px solid rgba(56,189,248,.3);vertical-align:middle;">☁️ Compartilhado</span>' : ''}
            </div>
            <div class="smax-tpl-item-preview">${Utils.escapeHtml((t.html || '').replace(/<[^>]+>/g, ' ').trim())}</div>
            ${!t._shared ? `<div class="smax-tpl-item-actions">
              <button class="smax-tpl-edit-btn" data-idx="${i}">Editar</button>
              <button class="smax-tpl-del-btn"  data-idx="${i}">Excluir</button>
            </div>` : ''}
          </div>
        `).join('');

      // Event delegation — um único listener na lista, evita acúmulo a cada renderList()
      if (!listEl._delegated) {
        listEl._delegated = true;
        listEl.addEventListener('click', (e) => {
          const editBtn = e.target.closest('.smax-tpl-edit-btn');
          if (editBtn) { openForm(parseInt(editBtn.dataset.idx, 10)); return; }
          const delBtn = e.target.closest('.smax-tpl-del-btn');
          if (delBtn) {
            const idx = parseInt(delBtn.dataset.idx, 10);
            const arr = load(activeDisc);
            if (confirm(`Excluir "${arr[idx]?.title}"?`)) {
              arr.splice(idx, 1);
              save(activeDisc, arr);
              renderList();
              hideForm();
            }
            return;
          }
          const item = e.target.closest('.smax-tpl-item');
          if (item) {
            const idx = parseInt(item.dataset.idx, 10);
            const tpl = loadAll(activeDisc)[idx];
            if (!tpl) return;
            if (!insertIntoEditor(tpl.html)) {
              navigator.clipboard?.writeText(tpl.html).catch(() => {});
              alert('Editor não encontrado — conteúdo copiado para a área de transferência.');
            }
            closeModal();
          }
        });
      }
    };

    const openForm = (idx = null) => {
      editingIdx = idx;
      const arr = load(activeDisc);
      const tpl = idx !== null ? arr[idx] : null;
      const formEl = modalEl.querySelector('.smax-tpl-form');
      const titleInput = formEl.querySelector('.smax-tpl-form-title');
      const htmlInput  = formEl.querySelector('.smax-tpl-form-html');
      titleInput.value = tpl ? tpl.title : '';
      htmlInput.value  = tpl ? tpl.html  : '';
      formEl.style.display = 'flex';
      titleInput.focus();
    };

    const hideForm = () => {
      editingIdx = null;
      const formEl = modalEl?.querySelector('.smax-tpl-form');
      if (formEl) formEl.style.display = 'none';
    };

    const saveForm = () => {
      const formEl = modalEl.querySelector('.smax-tpl-form');
      const title = (formEl.querySelector('.smax-tpl-form-title').value || '').trim();
      const html  = (formEl.querySelector('.smax-tpl-form-html').value  || '').trim();
      if (!title) { alert('Informe um título para o script.'); return; }
      const arr = load(activeDisc);
      if (editingIdx !== null) arr[editingIdx] = { title, html };
      else arr.push({ title, html });
      save(activeDisc, arr);
      hideForm();
      renderList();
    };

    const closeModal = () => {
      if (modalEl) modalEl.classList.remove('open');
    };

    const openModal = (preferDisc = false) => {
      if (!modalEl) buildModal();
      activeDisc = preferDisc;
      // Set active tab
      modalEl.querySelectorAll('.smax-tpl-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.disc === String(preferDisc));
      });
      hideForm();
      renderList();
      modalEl.classList.add('open');
    };

    const buildModal = () => {
      modalEl = document.createElement('div');
      modalEl.id = 'smax-tpl-modal';
      modalEl.innerHTML = `
        <div id="smax-tpl-box">
          <h3>📋 Scripts de Respostas</h3>
          <div class="smax-tpl-tabs">
            <div class="smax-tpl-tab active" data-disc="false">Solução</div>
            <div class="smax-tpl-tab" data-disc="true">Discussão</div>
          </div>
          <div class="smax-tpl-list"></div>
          <button class="smax-tpl-add-btn">+ Novo script</button>
          <div class="smax-tpl-form" style="display:none;">
            <input class="smax-tpl-form-title" type="text" placeholder="Título do script">
            <textarea class="smax-tpl-form-html" placeholder="Conteúdo HTML (ou texto simples)"></textarea>
            <div class="smax-tpl-form-actions">
              <button class="smax-tpl-cancel-btn">Cancelar</button>
              <button class="smax-tpl-save-btn">Salvar</button>
            </div>
          </div>
          <div class="smax-tpl-footer">
            <button class="smax-tpl-close-btn">Fechar</button>
          </div>
        </div>
      `;
      document.body.appendChild(modalEl);

      // Tabs
      modalEl.querySelectorAll('.smax-tpl-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          activeDisc = tab.dataset.disc === 'true';
          modalEl.querySelectorAll('.smax-tpl-tab').forEach(t => t.classList.toggle('active', t === tab));
          hideForm();
          renderList();
        });
      });

      // Add button
      modalEl.querySelector('.smax-tpl-add-btn').addEventListener('click', () => openForm(null));

      // Form buttons
      modalEl.querySelector('.smax-tpl-save-btn').addEventListener('click', saveForm);
      modalEl.querySelector('.smax-tpl-cancel-btn').addEventListener('click', hideForm);
      modalEl.querySelector('.smax-tpl-close-btn').addEventListener('click', closeModal);

      // Click outside box to close
      modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
    };

    const init = () => { /* botão externo removido — acesso via painel de configurações */ };

    return { init, openModal, load, loadAll, save, insertIntoEditor, setSharedScripts };
  })();

  /* =========================================================
   * ContextualSolutionBank — barra de templates injetada
   * diretamente no container de Solução e na aba Discussão
   * =======================================================*/
  const ContextualSolutionBank = (() => {
    // Localiza o CKEditor dentro de um container específico do DOM
    const findEditorInContainer = (containerEl) => {
      if (!containerEl) return null;
      const ck = getPageCKEditor();
      if (!(ck && ck.instances)) return null;
      return Object.values(ck.instances).find(inst => {
        try {
          return !!(inst.container && inst.container.$ && containerEl.contains(inst.container.$));
        } catch { return false; }
      }) || null;
    };

    // Insere HTML no editor correto usando insertHtml (não substitui o conteúdo)
    const smartInsert = (html, isDisc) => {
      const containerSel = isDisc
        ? 'pl-entity-comment-tab'
        : '#onlyResolution_Solution_container';
      const containerEl = document.querySelector(containerSel);
      const editor = findEditorInContainer(containerEl);

      if (editor) {
        editor.insertHtml(html);
        editor.fire('change');
        return true;
      }
      // Fallback: injeta no div editável diretamente
      const fallbackSel = isDisc
        ? 'pl-entity-comment-tab .cke_wysiwyg_div'
        : '#onlyResolution_Solution_container .cke_wysiwyg_div';
      const div = document.querySelector(fallbackSel);
      if (div) {
        div.focus();
        document.execCommand('insertHTML', false, html);
        ['input', 'change'].forEach(e => div.dispatchEvent(new Event(e, { bubbles: true })));
        return true;
      }
      return false;
    };

    // Constrói a barra com select + botão Gerenciar
    const buildBar = (idPrefix, labelText, isDisc) => {
      const bar = document.createElement('div');
      bar.id = `${idPrefix}-bar`;
      bar.className = 'smax-ctx-bank-bar';

      const label = document.createElement('span');
      label.className = 'smax-ctx-bank-label';
      label.textContent = labelText;

      const select = document.createElement('select');
      select.id = `${idPrefix}-select`;
      select.className = 'smax-ctx-bank-select';

      const refreshSelect = () => {
        select.innerHTML = '<option value="">— Selecione para aplicar —</option>';
        Templates.load(isDisc).forEach((t, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = t.title;
          select.appendChild(opt);
        });
      };
      refreshSelect();

      select.addEventListener('change', () => {
        if (!select.value) return;
        const tpl = Templates.load(isDisc)[parseInt(select.value, 10)];
        if (tpl) smartInsert(tpl.html, isDisc);
        select.value = '';
      });

      const btnManage = document.createElement('button');
      btnManage.className = 'smax-ctx-bank-btn';
      btnManage.type = 'button';
      btnManage.textContent = '⚙️ Gerenciar';
      btnManage.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        Templates.openModal(isDisc);
      });

      bar._refresh = refreshSelect;
      bar.append(label, select, btnManage);
      return bar;
    };

    // Injeta barra no container de Solução
    const injectSolutionBar = () => {
      const container = document.getElementById('onlyResolution_Solution_container');
      if (!container || document.getElementById('smax-solution-bank-bar')) return;
      const bar = buildBar('smax-solution-bank', 'Soluções:', false);
      const control = container.querySelector('.control-container');
      if (control) control.insertBefore(bar, control.firstChild);
      else container.prepend(bar);
    };

    // Injeta barra no container de Discussão
    const injectDiscussionBar = () => {
      const container = document.querySelector('pl-entity-comment-tab');
      if (!container || document.getElementById('smax-discussion-bank-bar')) return;
      const bar = buildBar('smax-discussion-bank', 'Discussões:', true);
      const editorContent = container.querySelector('.currentUserComment .editor-content');
      const commentArea  = container.querySelector('.currentUserComment');
      const filterArea   = container.querySelector('.comment-filter');
      if (editorContent) {
        editorContent.insertBefore(bar, editorContent.firstChild);
      } else if (commentArea) {
        bar.style.marginLeft = '55px';
        bar.style.width = 'calc(100% - 55px)';
        commentArea.parentNode.insertBefore(bar, commentArea);
      } else if (filterArea) {
        filterArea.parentNode.insertBefore(bar, filterArea.nextSibling);
      } else {
        container.prepend(bar);
      }
    };

    const tick = () => {
      injectSolutionBar();
      injectDiscussionBar();
    };

    let _tickInterval = null;
    const init = () => {
      if (_tickInterval) return; // guard contra múltiplas inicializações
      const schedule = Utils.debounce(tick, 300);
      const obs = new MutationObserver(schedule);
      obs.observe(document.body, { childList: true, subtree: true });
      // Re-scan periódico: Angular pode re-renderizar o container sem disparar mutations
      _tickInterval = setInterval(tick, 1500);
      tick();
    };

    return { init };
  })();

  /* =========================================================
   * ResolutionButtons — Salvar / Salvar e fechar / Lifecycle
   * no topo da seção de resolução (evita scroll)
   * =======================================================*/
  const ResolutionButtons = (() => {
    const TARGET   = '#onlyResolution_CloseTime_container';
    const SEL_SAVE = 'button[data-aid="tool-bar-btn-save"].tool-bar-btn-save';
    const SEL_SAVE_CLOSE = 'button[data-aid="tool-bar-btn-save-and-close"].tool-bar-btn-save-and-close';
    const SEL_LC   = 'div.pl-lifecycle-overview[data-aid="lifecycle-overview"] div.overview-buttons-container:not(.tmx-clone-lc)';
    const CLS_WRAP = 'tmx-top-actions';
    const CLS_MENU = 'tmx-lifecycle-menu';

    const removeIds = (root) => root.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));

    const clickReal = (sel) => {
      const el = document.querySelector(sel);
      if (el && !el.disabled) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    let lcMenu = null;
    const showLcMenu = (anchor) => {
      if (!lcMenu) { lcMenu = document.createElement('div'); lcMenu.className = CLS_MENU; document.body.appendChild(lcMenu); }
      const src = document.querySelector(SEL_LC);
      lcMenu.innerHTML = '';
      if (src) {
        src.querySelectorAll('[target-phase-id]').forEach(el => {
          const label = el.textContent.trim();
          const phaseId = el.getAttribute('target-phase-id');
          if (!label || !phaseId) return;
          const item = document.createElement('div');
          item.className = 'tmx-lifecycle-menu-item';
          item.textContent = label;
          item.onclick = () => {
            const realEl = document.querySelector(`${SEL_LC} [target-phase-id="${phaseId}"]`);
            if (realEl) realEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            lcMenu.style.display = 'none';
          };
          lcMenu.appendChild(item);
        });
      }
      if (!lcMenu.children.length) return;
      const r = anchor.getBoundingClientRect();
      lcMenu.style.top  = (r.bottom + window.scrollY + 4) + 'px';
      lcMenu.style.left = (r.left  + window.scrollX) + 'px';
      lcMenu.style.display = 'block';
    };

    document.addEventListener('mousedown', (e) => {
      if (lcMenu && !lcMenu.contains(e.target)) lcMenu.style.display = 'none';
    });

    const tick = () => {
      const dst = document.querySelector(TARGET);
      if (!dst) return;
      if (dst.querySelector('.' + CLS_WRAP)) return; // já existe

      const wrap = document.createElement('div');
      wrap.className = CLS_WRAP;

      const makeBtnClone = (sel, cls) => {
        const src = document.querySelector(sel);
        if (!src) return null;
        const clone = src.cloneNode(true);
        clone.classList.add(cls);
        removeIds(clone);
        clone.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); clickReal(sel); }, true);
        return clone;
      };

      const btnSave     = makeBtnClone(SEL_SAVE,       'tmx-clone-save');
      const btnSaveCl   = makeBtnClone(SEL_SAVE_CLOSE, 'tmx-clone-save-close');

      // Lifecycle button
      const srcLc = document.querySelector(SEL_LC);
      let btnLc = null;
      if (srcLc) {
        btnLc = srcLc.cloneNode(true);
        btnLc.classList.add('tmx-clone-lc');
        removeIds(btnLc);
        btnLc.querySelectorAll('ul.dropdown-menu').forEach(u => u.remove());
        btnLc.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showLcMenu(btnLc); }, true);
      }

      [btnSave, btnSaveCl, btnLc].forEach(b => b && wrap.appendChild(b));
      dst.prepend(wrap);
    };

    const schedule = Utils.debounce(tick, 120);

    const init = () => {
      tick();
      const obs = new MutationObserver(schedule);
      obs.observe(document.body, { childList: true, subtree: true });
    };

    return { init };
  })();

  /* =========================================================
   * BlackHeader — barra de navegação preta
   * =======================================================*/
  const BlackHeader = (() => {
    const paintEl = (el) => {
      el.style.setProperty('background', '#000', 'important');
      el.style.setProperty('background-color', '#000', 'important');
    };

    // document.elementsFromPoint(x, y) returns every element stacked at that
    // screen coordinate, from topmost to root — it does NOT care about class
    // names, tag names, or position CSS. It finds whatever is actually rendered
    // there. We sample several y values to cover the full nav height.
    const applyHeuristic = () => {
      try {
        const W = window.innerWidth;
        const found = new Set();
        [2, 12, 28, 50].forEach(y => {
          try {
            (document.elementsFromPoint(W / 2, y) || []).forEach(el => found.add(el));
          } catch {}
        });
        found.forEach(el => {
          if (el === document.body || el === document.documentElement) return;
          try {
            const r = el.getBoundingClientRect();
            // Must span ≥70 % of viewport (full-width bar, not a nav item inside it)
            // and sit at the very top (top < 80px, height 20-200px)
            if (r.width > W * 0.7 && r.height > 20 && r.height < 200 && r.top < 80) {
              // Only paint fixed/sticky elements — real nav bars are always fixed/sticky;
              // form containers and ticket-page panels are static/relative and must be skipped.
              const pos = window.getComputedStyle(el).position;
              if (pos !== 'fixed' && pos !== 'sticky') return;
              paintEl(el);
            }
          } catch {}
        });
      } catch {}
    };

    const init = () => {
      // Apply at several points after page load — Angular bootstrap is async
      [0, 300, 800, 1500, 3000, 5000, 8000].forEach(t => setTimeout(applyHeuristic, t));
      // Keep reapplying every 2 s: Angular change-detection may reset inline styles
      setInterval(applyHeuristic, 2000);
    };

    return { init };
  })();

  /* =========================================================
   * TicketInfoBar — exibe nome, unidade e processo no topo
   * da tela de chamado (intercepta a API de inicialização)
   * =======================================================*/
  const TicketInfoBar = (() => {
    const BAR_ID    = 'smax-ticket-info-bar';
    const CACHE_KEY = '_smaxTicketInfoCache';
    let   lastTicketId = null;

    // ── dados extraídos da resposta de API ──
    const parseInitData = (json) => {
      try {
        const body = (typeof json === 'string') ? JSON.parse(json) : json;
        // Suporta envelope com entities[] ou resposta direta
        const entity = body?.entity_result_list?.[0] || body?.EntityData || body;
        const props   = entity?.properties || {};
        const related = entity?.related_properties || {};

        const person   = related?.RequestedForPerson?.Name
                      || related?.RequestedByPerson?.Name
                      || props?.RequestedByPerson?.Name
                      || '';
        const location = related?.RegisteredForLocation?.DisplayName
                      || related?.RegisteredForLocation?.Name
                      || related?.RequestedForLocation?.DisplayName
                      || '';
        const orgGroup = related?.RequestedForPerson?.OrganizationalGroup
                      || '';
        // Número de processo (campo customizado TJSP)
        const rawProc = props?.UserOptions
          ? (() => {
              try {
                const opts = typeof props.UserOptions === 'string' ? JSON.parse(props.UserOptions) : props.UserOptions;
                return opts?.complexTypeProperties?.[0]?.properties?.NumerodoProcesso_c || '';
              } catch { return ''; }
            })()
          : props?.NumerodoProcesso_c || '';

        // Anexos: lista de nomes/urls
        const attachments = [];
        try {
          const raw = props?.RequestAttachments || entity?.RequestAttachments;
          const arr = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : null);
          if (arr) arr.forEach(a => {
            const name = a.name || a.Name || a.file_name || '';
            const url  = a.url  || a.Url  || a.file_url  || '';
            if (name || url) attachments.push({ name, url });
          });
        } catch { /* ignore */ }

        return { person, location, orgGroup, process: rawProc, attachments };
      } catch { return null; }
    };

    const renderBar = (data, ticketId) => {
      let bar = document.getElementById(BAR_ID);
      if (!bar) {
        bar = document.createElement('div');
        bar.id = BAR_ID;
      }

      const copyBtn = (text) => text
        ? `<button class="smax-ib-copy" data-copy="${Utils.escapeHtml(text)}" title="Copiar" style="border:none;background:none;cursor:pointer;font-size:13px;padding:0 2px;color:var(--sp-primary,#38bdf8);line-height:1;">📋</button>`
        : '';

      const fields = [];
      if (data.person)   fields.push(`<span class="smax-ib-field"><span class="smax-ib-label">👤 Solicitante:</span> <span class="smax-ib-val">${Utils.escapeHtml(data.person)}</span>${copyBtn(data.person)}</span>`);
      if (data.location) fields.push(`<span class="smax-ib-field"><span class="smax-ib-label">📍 Unidade:</span> <span class="smax-ib-val">${Utils.escapeHtml(data.location)}</span>${copyBtn(data.location)}</span>`);
      if (data.process)  fields.push(`<span class="smax-ib-field"><span class="smax-ib-label">⚖️ Processo:</span> <span class="smax-ib-val">${Utils.escapeHtml(data.process)}</span>${copyBtn(data.process)}</span>`);

      const attHtml = data.attachments.length
        ? `<span class="smax-ib-divider">|</span><span class="smax-ib-field"><span class="smax-ib-label">📎 Anexos:</span> ${data.attachments.map(a =>
            `<a class="smax-ib-att-chip" ${a.url ? `href="${Utils.escapeHtml(a.url)}" target="_blank" rel="noopener"` : ''} title="${Utils.escapeHtml(a.name)}">${Utils.escapeHtml(a.name || 'Arquivo')}</a>`
          ).join('')}</span>`
        : '';

      bar.innerHTML = `
        <div class="smax-ib-inner">
          <div class="smax-ib-fields">
            ${fields.join('<span class="smax-ib-divider">|</span>')}
            ${attHtml}
          </div>
          <button class="smax-ib-close" title="Fechar">✕</button>
        </div>
      `;

      bar.querySelectorAll('.smax-ib-copy').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(btn.dataset.copy || '').catch(() => {});
        });
      });
      bar.querySelector('.smax-ib-close')?.addEventListener('click', () => bar.remove());

      return bar;
    };

    const inject = (data, ticketId) => {
      if (!data || (!data.person && !data.location && !data.process && !data.attachments.length)) return;
      // Find the ticket title area — try multiple selectors
      const anchors = [
        document.querySelector('input[data-aid="withoutResolution_DisplayLabel"]'),
        document.querySelector('.pl-entity-page-component-header'),
        document.querySelector('[data-aid="record-id"]'),
        document.querySelector('.pl-record-info'),
      ];
      const anchor = anchors.find(Boolean);
      if (!anchor) return;

      const container = anchor.closest('.field-container') || anchor.closest('.pl-entity-page-component-header') || anchor.parentElement;
      if (!container) return;

      // Remove old bar if ticket changed
      const existing = document.getElementById(BAR_ID);
      if (existing && ticketId !== lastTicketId) existing.remove();
      if (document.getElementById(BAR_ID)) return; // already injected for this ticket

      lastTicketId = ticketId;
      const bar = renderBar(data, ticketId);
      container.parentElement?.insertBefore(bar, container);
    };

    // ── Intercept XHR + fetch ──
    const hookNetwork = () => {
      // XHR hook
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._smaxUrl = url;
        return origOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(...args) {
        const url = this._smaxUrl || '';
        if (url.includes('/entity-page/initializationDataByLayout/Request/') || url.includes('/ems/Request/')) {
          this.addEventListener('load', () => {
            try {
              const data = parseInitData(this.responseText);
              const m = url.match(/\/Request\/(\d+)/);
              if (data) inject(data, m?.[1] || '');
            } catch { /* ignore */ }
          });
        }
        return origSend.apply(this, args);
      };

      // fetch hook
      const origFetch = pageWindow.fetch;
      pageWindow.fetch = function(input, init) {
        const url = (typeof input === 'string') ? input : (input?.url || '');
        const p = origFetch.call(this, input, init);
        if (url.includes('/entity-page/initializationDataByLayout/Request/') || url.includes('/ems/Request/')) {
          p.then(res => res.clone().text().then(text => {
            try {
              const data = parseInitData(text);
              const m = url.match(/\/Request\/(\d+)/);
              if (data) inject(data, m?.[1] || '');
            } catch { /* ignore */ }
          })).catch(() => {});
        }
        return p;
      };
    };

    const init = () => {
      hookNetwork();
      // Re-inject on SPA navigation (ticket changes)
      const onNav = Utils.debounce(() => {
        const existing = document.getElementById(BAR_ID);
        if (existing) existing.remove();
        lastTicketId = null;
      }, 400);
      const origPush    = history.pushState.bind(history);
      const origReplace = history.replaceState.bind(history);
      history.pushState    = (...a) => { origPush(...a);    onNav(); };
      history.replaceState = (...a) => { origReplace(...a); onNav(); };
      window.addEventListener('popstate', onNav);
    };

    return { init };
  })();

  /* =========================================================
   * PageLinkifier — linkifica CNJs em toda a página SMAX
   * (tela normal de chamado, fora do HUD de triagem)
   * =======================================================*/
  const PageLinkifier = (() => {
    const CNJ_RE = /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|\d{20})\b/g;
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'SELECT', 'OPTION']);

    const hasCNJ = (text) => { CNJ_RE.lastIndex = 0; return CNJ_RE.test(text); };

    const processNode = (root) => {
      if (!Utils.isTicketDetailPage()) return; // apenas na tela de chamado, não na lista
      if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
      if (root.dataset.smaxProc) return; // o próprio nó já é um link
      if (root.closest && root.closest('#smax-triage-hud-backdrop')) return; // HUD cuida do próprio

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.dataset.smaxProc) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest && parent.closest('#smax-triage-hud-backdrop')) return NodeFilter.FILTER_REJECT;
          if (!hasCNJ(node.nodeValue)) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const toProcess = [];
      let node;
      while ((node = walker.nextNode())) toProcess.push(node);

      for (const textNode of toProcess) {
        if (!textNode.parentNode) continue; // pode ter sido removido no loop
        CNJ_RE.lastIndex = 0;
        const text = textNode.nodeValue;
        const frag = document.createDocumentFragment();
        let last = 0, m;
        while ((m = CNJ_RE.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const formatted = Utils.normalizeCNJ(m[1]);
          const span = document.createElement('span');
          span.textContent = formatted;
          span.dataset.smaxProc = formatted;
          span.style.cssText = 'color:#38bdf8;font-family:monospace;font-weight:600;border-bottom:1px dotted rgba(56,189,248,.6);cursor:pointer;';
          span.title = `Consultar processo no eProc: ${formatted}`;
          frag.appendChild(span);
          last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        textNode.parentNode.replaceChild(frag, textNode);
      }
    };

    // Fila de elementos pendentes — evita processar o mesmo elemento várias vezes
    const pending = new Set();
    const flush = Utils.debounce(() => {
      const els = [...pending];
      pending.clear();
      els.forEach(processNode);
    }, 250);
    const queue = (el) => { pending.add(el); flush(); };

    // Seletores do campo de descrição no SMAX ticket (tentativa direta)
    const DESC_SELS = [
      '.pl-richtext-viewer', '[data-aid*="description"]', '[data-aid*="Description"]',
      '[class*="richtext"]', '[class*="rich-text"]', '.pl-entity-field-content',
      '[data-aid="preview_Description"]', '[data-aid="preview_Notes"]',
      '.ql-editor', '[contenteditable]',
    ];
    const scanDescFields = () => {
      if (!Utils.isTicketDetailPage()) return; // apenas na tela de chamado
      DESC_SELS.forEach(sel => {
        try { document.querySelectorAll(sel).forEach(el => {
          if (!el.closest('#smax-triage-hud-backdrop')) processNode(el);
        }); } catch {}
      });
    };

    // CKEditor 4 renders content inside an <iframe> even in view mode.
    // document.body TreeWalker can't cross into iframes — scan them explicitly.
    const scanIframes = () => {
      if (!Utils.isTicketDetailPage()) return;
      try {
        document.querySelectorAll('iframe').forEach(iframe => {
          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc && doc.body) processNode(doc.body);
          } catch {} // cross-origin iframes throw SecurityError — ignore
        });
      } catch {}
    };

    const fullScan = () => {
      if (!Utils.isTicketDetailPage()) return;
      processNode(document.body);
      scanDescFields();
      scanIframes();
    };

    // Re-scan após navegação SPA (pushState / popstate)
    const onNavigate = Utils.debounce(() => {
      // Múltiplas tentativas — Angular + SMAX renderizam conteúdo de forma assíncrona
      [800, 2000, 4000, 7000].forEach(t => setTimeout(fullScan, t));
    }, 300);

    let _scanInterval = null;
    const init = () => {
      if (_scanInterval) return; // guard contra múltiplas inicializações
      // Scan inicial
      [500, 1500, 3500, 6000].forEach(t => setTimeout(fullScan, t));

      // Periodic sweep: catches content rendered after initial retries
      _scanInterval = setInterval(fullScan, 4000);

      // MutationObserver: captura nós adicionados E alterações de texto (characterData)
      const obs = new MutationObserver((mutations) => {
        if (!Utils.isTicketDetailPage()) return;
        for (const mut of mutations) {
          if (mut.type === 'childList') {
            for (const node of mut.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) queue(node);
            }
          } else if (mut.type === 'characterData') {
            const parent = mut.target.parentElement;
            if (parent && !parent.dataset.smaxProc) queue(parent);
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });

      // Detecta navegação SPA via history API
      const origPush    = history.pushState.bind(history);
      const origReplace = history.replaceState.bind(history);
      history.pushState    = (...a) => { origPush(...a);    onNavigate(); };
      history.replaceState = (...a) => { origReplace(...a); onNavigate(); };
      window.addEventListener('popstate', onNavigate);
    };

    return { init };
  })();

  /* =========================================================
   * CellHighlighter — destaque de palavras-chave nas células da
   * grade de chamados (apenas na tela de lista)
   * Baseado no script SMAX SGS 221 do Adriano Cardoso
   * =======================================================*/
  const CellHighlighter = (() => {
    const escapeReg = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Grupos de palavras-chave e suas cores
    const GROUPS = {
      amarelo: {
        cls: 'smax-hl-yellow',
        whole: ['jurisprudência','jurisprudencia','distribuidor','DJEN','Diário Eletrônico',
                'automatização','ceman','Central de Mandados','mandado','mandados',
                'movimentar','dois fatores','Renajud','Sisbajud',
                'Autenticador','carta','evento','automação','automações',
                'migrar','migrador','migração','perito','perita',
                'localizadores','localizador'],
        substr: ['mail'],
        custom: [],
      },
      vermelho: {
        cls: 'smax-hl-red',
        whole: ['ERRO_AGENDAMENTO_EVENTO','ERRO_ENVIO_INTIMACAO_DJEN','Cookie not found',
                'Item 04 do Comunicado 435/2025','Erro ao gerar o Documento Comprobatório Renajud'],
        substr: ['erro','errado','réu revel','Urgente','urgência','Plantão'],
        custom: [],
      },
      verde: {
        cls: 'smax-hl-green',
        whole: ['taxa','taxas','custa','custas','restituir','restituição',
                'guia','diligência','diligencia','justiça gratuíta',
                'parcelamento','parcelamento das custas'],
        substr: [],
        custom: [],
      },
      azul: {
        cls: 'smax-hl-blue',
        whole: ['magistrado','magistrada','acesso','acessar','cadastro','senha','login','2fa','autenticação'],
        substr: ['acess'],
        custom: [/\bju[ií]z(?:a|es)?\b/gi],
      },
      rosa: {
        cls: 'smax-hl-pink',
        whole: ['BdOrigem'],
        substr: ['BdOrigem'],
        custom: [],
      },
    };

    const GROUP_ORDER = ['vermelho','rosa','amarelo','verde','azul'];

    const buildRegexes = (g) => {
      const regs = [];
      if (g.whole?.length) {
        regs.push(new RegExp(`(?<![\\p{L}\\d_])(${g.whole.map(escapeReg).join('|')})(?![\\p{L}\\d_])`, 'giu'));
      }
      if (g.substr?.length) {
        regs.push(new RegExp(`(${g.substr.map(escapeReg).join('|')})`, 'giu'));
      }
      if (g.custom?.length) {
        regs.push(...g.custom.map(r => new RegExp(r.source, r.flags || 'giu')));
      }
      return regs;
    };

    const ORDERED_GROUPS = GROUP_ORDER.map(name => ({
      cls: GROUPS[name].cls,
      regexes: buildRegexes(GROUPS[name]),
    }));

    const HL_CLS = ['smax-hl-yellow','smax-hl-red','smax-hl-green','smax-hl-blue','smax-hl-pink'];

    const injectStyles = () => {
      if (document.getElementById('smax-cellhl-styles')) return;
      const s = document.createElement('style');
      s.id = 'smax-cellhl-styles';
      s.textContent = `
        .smax-hl-yellow { background:#ffeb3b !important; color:#000 !important; font-weight:700; border-radius:5px; padding:0 .14em; }
        .smax-hl-red    { background:#d32f2f !important; color:#fff !important; font-weight:700; border-radius:3px; padding:0 .16em; }
        .smax-hl-green  { background:#2e7d32 !important; color:#fff !important; font-weight:700; border-radius:3px; padding:0 .14em; }
        .smax-hl-blue   { background:#1e88e5 !important; color:#fff !important; font-weight:700; border-radius:3px; padding:0 .14em; }
        .smax-hl-pink   { background:#000    !important; color:#ffeb3b !important; font-weight:700; border-radius:3px; padding:0 .14em; }
      `;
      (document.head || document.documentElement).appendChild(s);
    };

    const unwrap = (root) => {
      root.querySelectorAll(HL_CLS.map(c => `.${c}`).join(','))
          .forEach(span => span.replaceWith(document.createTextNode(span.textContent || '')));
    };

    const highlightWithRegex = (container, regex, cls) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const pe = node.parentElement;
          if (!pe) return NodeFilter.FILTER_ACCEPT;
          if (HL_CLS.some(c => pe.classList?.contains(c))) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      for (let n; (n = walker.nextNode()); ) nodes.push(n);
      for (const textNode of nodes) {
        if (!textNode.parentNode) continue;
        const text = textNode.nodeValue;
        if (!regex.test(text)) { regex.lastIndex = 0; continue; }
        regex.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0, m;
        while ((m = regex.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const span = document.createElement('span');
          span.className = cls;
          span.textContent = m[0];
          frag.appendChild(span);
          last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        textNode.parentNode.replaceChild(frag, textNode);
      }
    };

    const processCell = (cell) => {
      const current = (cell.textContent || '').trim();
      const last = cell.getAttribute('data-smax-hl-last') || '';
      if (current === last) return; // unchanged — skip
      unwrap(cell);
      for (const g of ORDERED_GROUPS) {
        for (const re of g.regexes) highlightWithRegex(cell, re, g.cls);
      }
      cell.setAttribute('data-smax-hl-last', (cell.textContent || '').trim());
    };

    const applyAll = () => {
      if (!Utils.isListPage()) return;
      document.querySelectorAll('.slick-cell').forEach(processCell);
    };

    const init = () => {
      injectStyles();
      applyAll();
      const obs = new MutationObserver(Utils.debounce(applyAll, 120));
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      setInterval(applyAll, 1500);
      window.addEventListener('beforeunload', () => obs.disconnect(), { once: true });
    };

    return { init, applyAll };
  })();

  /* =========================================================
   * SharedConfig — configuração compartilhada via GitHub JSON
   * Busca um arquivo JSON público e distribui equipes e scripts
   * para toda a equipe sem banco de dados.
   * =======================================================*/
  const SharedConfig = (() => {
    const CACHE_KEY = 'smax_shared_cache';
    const TTL_MS = 60 * 60 * 1000; // 1 hora

    let data = null;
    let fetchedAt = 0;
    let statusText = '';
    let isLoading = false;

    const loadCache = () => {
      try {
        const raw = GM_getValue(CACHE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        data = saved.data || null;
        fetchedAt = saved.fetchedAt || 0;
      } catch {}
    };

    const saveCache = (d) => {
      try { GM_setValue(CACHE_KEY, JSON.stringify({ data: d, fetchedAt: Date.now() })); } catch {}
    };

    const applyToModules = () => {
      if (!data) return;
      if (Array.isArray(data.teams)) TeamsConfig.setSharedTeams(data.teams);
      if (data.scripts) {
        Templates.setSharedScripts(
          Array.isArray(data.scripts.sol)  ? data.scripts.sol  : [],
          Array.isArray(data.scripts.disc) ? data.scripts.disc : []
        );
      }
    };

    const refresh = (force = false) => {
      const url = (prefs.sharedConfigUrl || '').trim();
      if (!url) { statusText = 'URL não configurada.'; return Promise.resolve(null); }
      if (!force && data && (Date.now() - fetchedAt) < TTL_MS) return Promise.resolve(data);

      isLoading = true;
      statusText = 'Buscando...';

      return new Promise((resolve) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now(),
          headers: { 'Cache-Control': 'no-cache' },
          timeout: 15000,
          onload: (res) => {
            isLoading = false;
            try {
              if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
              const parsed = JSON.parse(res.responseText);
              data = parsed;
              fetchedAt = Date.now();
              saveCache(data);
              const now = new Date();
              const hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
              statusText = `✓ v${data._version || '1'} — ${hm}`;
              console.log('[SMAX SharedConfig] carregado:', data._version, '| equipes:', (data.teams||[]).length, '| scripts sol:', (data.scripts?.sol||[]).length);
              applyToModules();
              resolve(data);
            } catch (e) {
              statusText = `Erro: ${e.message}`;
              console.warn('[SMAX SharedConfig]', e);
              resolve(data);
            }
          },
          onerror: () => { isLoading = false; statusText = 'Erro de rede (cache local em uso)'; resolve(data); },
          ontimeout: () => { isLoading = false; statusText = 'Timeout (cache local em uso)'; resolve(data); },
        });
      });
    };

    const init = () => {
      loadCache();
      if (data) applyToModules(); // aplica cache imediatamente
      refresh();                  // atualiza em segundo plano (sem await)
    };

    // Scripts no formato compatível com o picker do ResponseHUD (nome/conteudo_bruto)
    const getScripts = (disc) => {
      if (!data?.scripts) return [];
      const arr = disc ? (data.scripts.disc || []) : (data.scripts.sol || []);
      return arr.map(s => ({
        ...s,
        _shared: true,
        nome: s.title || s.nome || '',
        conteudo_bruto: s.html || s.conteudo_bruto || '',
      }));
    };

    const getStatus = () => ({ text: statusText, loading: isLoading, fetchedAt });
    const get = () => data;

    return { init, refresh, get, getStatus, getScripts };
  })();

  /* =========================================================
   * Boot
   * =======================================================*/
  const boot = () => {
    ThemeManager.init();
    CommentExpander.init();
    SectionTweaks.init();
    Orchestrator.init();
    SettingsPanel.init();
    GridTracker.init();
    TriageHUD.init();
    ResponseHUD.init();
    HighlightUser.init();
    CellHighlighter.init();
    ZenMode.init();
    RadarRevisar.init();
    Templates.init();
    ContextualSolutionBank.init();
    ResolutionButtons.init();
    PageLinkifier.init();
    BlackHeader.init();
    TicketInfoBar.init();
    SharedConfig.init();
    DataRepository.refreshQueueFromApi().catch(() => { });
    DataRepository.ensureSupportGroups().catch(() => { });
  };

  Utils.onDomReady(boot);
})();

// ═══════════════════════════════════════════════════════════════════════════
// ── eProc SMAX Bridge ────────────────────────────────────────────────────
// Roda no domínio do eProc. Recebe o número de processo via postMessage
// enviado pelo script SMAX e executa a consulta dentro da sessão ativa.
// ═══════════════════════════════════════════════════════════════════════════
if (window.location.hostname === 'eproc1g.tjsp.jus.br') {
  (function () {
    'use strict';

    const SMAX_ORIGIN = 'https://suporte.tjsp.jus.br';
    const STORAGE_KEY = 'eproc_smax_bridge_proc';
    const MSG_TYPE    = 'SMAX_CONSULTAR_PROCESSO';

    const normalizeCNJ = (s) => {
      const t = (s || '').trim();
      const d = t.replace(/\D/g, '');
      return d.length === 20
        ? `${d.slice(0,7)}-${d.slice(7,9)}.${d.slice(9,13)}.${d.slice(13,14)}.${d.slice(14,16)}.${d.slice(16,20)}`
        : t;
    };

    const tryConsultar = (processNumber) => {
      // Pesquisa rápida (barra superior — presente em todas as páginas do eProc)
      const quickSearch = document.querySelector('#txtNumProcessoPesquisaRapida');
      if (quickSearch) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(quickSearch, processNumber);
        else quickSearch.value = processNumber;
        quickSearch.dispatchEvent(new Event('input',  { bubbles: true }));
        quickSearch.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[SMAX Bridge] Consultando via pesquisa rápida:', processNumber);
        setTimeout(() => {
          quickSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          quickSearch.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          quickSearch.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          // Fallback: submete o form pai se existir
          const form = quickSearch.closest('form');
          if (form) form.submit();
        }, 200);
        return true;
      }

      // Fallback: formulário de consulta interno (páginas específicas)
      const selectors = [
        '#txtNumProcesso', '#NumProcesso',
        'input[name="num_processo"]',
        'input[id*="Processo"][type="text"]',
        'input[name*="processo"][type="text"]',
      ];
      let input = null;
      for (const s of selectors) { input = document.querySelector(s); if (input) break; }
      if (!input) return false;

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(input, processNumber);
      else input.value = processNumber;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const keywords = ['pesquisar', 'consultar', 'buscar', 'localizar'];
      const candidates = [
        ...document.querySelectorAll('button[type="submit"]'),
        ...document.querySelectorAll('input[type="submit"]'),
        ...document.querySelectorAll('.infraButton'),
        ...document.querySelectorAll('.btn-primary'),
      ];
      let button = candidates.find(b => keywords.some(k => (b.textContent || b.value || '').toLowerCase().includes(k)));
      if (!button && candidates.length) button = candidates[0];
      if (!button) return false;

      console.log('[SMAX Bridge] Consultando via formulário interno:', processNumber);
      setTimeout(() => button.click(), 300);
      return true;
    };

    const consultarProcesso = (raw) => {
      const num = normalizeCNJ(raw);
      if (tryConsultar(num)) { sessionStorage.removeItem(STORAGE_KEY); return; }
      console.warn('[SMAX Bridge] Campo de pesquisa não encontrado. Número:', num);
      sessionStorage.removeItem(STORAGE_KEY);
    };

    // Listener postMessage (vindo do SMAX)
    window.addEventListener('message', (event) => {
      if (event.origin !== SMAX_ORIGIN) return;
      if (!event.data || event.data.type !== MSG_TYPE) return;
      console.log('[SMAX Bridge] Mensagem recebida:', event.data.num);
      consultarProcesso(event.data.num);
    });

    // Retomada após redirecionamento interno
    const run = () => {
      const pending = sessionStorage.getItem(STORAGE_KEY);
      if (!pending) return;
      if (tryConsultar(pending)) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.removeItem(STORAGE_KEY);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();

    console.log('[SMAX Bridge] Aguardando mensagens do SMAX...');
  })();
}
