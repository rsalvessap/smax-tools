// ==UserScript==
// @name         eProc SMAX Bridge
// @namespace    eproc-tjsp
// @version      2.0
// @description  Recebe número de processo do SMAX via postMessage e executa a consulta dentro da sessão ativa do eProc
// @author       Helpdesk Automation
// @match        https://eproc1g.tjsp.jus.br/eproc/controlador.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SMAX_ORIGIN  = 'https://suporte.tjsp.jus.br';
    const STORAGE_KEY  = 'eproc_smax_bridge_proc';
    const MSG_TYPE     = 'SMAX_CONSULTAR_PROCESSO';

    // ─── Normalização ────────────────────────────────────────────────────────
    const normalizeCNJ = (s) => {
        const t = (s || '').trim();
        const digits = t.replace(/\D/g, '');
        if (digits.length === 20) {
            return `${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16,20)}`;
        }
        return t;
    };

    // ─── Execução da consulta ────────────────────────────────────────────────
    // Tenta preencher o campo de número de processo e submeter o formulário.
    // Testa os seletores conhecidos nas diferentes páginas do eProc.
    const tryConsultar = (processNumber) => {
        const inputSelectors = [
            '#txtNumProcesso',
            '#NumProcesso',
            'input[name="num_processo"]',
            'input[id*="Processo"][type="text"]',
            'input[name*="processo"][type="text"]',
        ];

        let input = null;
        for (const sel of inputSelectors) {
            const el = document.querySelector(sel);
            if (el) { input = el; break; }
        }
        if (!input) return false;

        // Preenche respeitando frameworks que interceptam o setter nativo
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(input, processNumber);
        else input.value = processNumber;

        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Localiza o botão de busca
        const btnKeywords = ['pesquisar', 'consultar', 'buscar', 'localizar'];
        let button = null;

        const candidates = [
            ...document.querySelectorAll('button[type="submit"]'),
            ...document.querySelectorAll('input[type="submit"]'),
            ...document.querySelectorAll('.infraButton'),
            ...document.querySelectorAll('.btn-primary'),
        ];

        for (const btn of candidates) {
            const txt = (btn.textContent || btn.value || '').toLowerCase();
            if (btnKeywords.some(kw => txt.includes(kw))) { button = btn; break; }
        }
        if (!button && candidates.length) button = candidates[0];
        if (!button) return false;

        console.log('[SMAX Bridge] Consultando processo:', processNumber);
        setTimeout(() => button.click(), 300);
        return true;
    };

    // ─── Navegação com fallback ──────────────────────────────────────────────
    // Se a página atual não tem o formulário, armazena o número e navega
    // para a página principal do eProc; ao carregar, tenta de novo via sessionStorage.
    const consultarProcesso = (rawNumber) => {
        const processNumber = normalizeCNJ(rawNumber);

        if (tryConsultar(processNumber)) {
            sessionStorage.removeItem(STORAGE_KEY);
            return;
        }

        // Guarda para a próxima página
        sessionStorage.setItem(STORAGE_KEY, processNumber);

        // Navega para a página principal do eProc — o usuário já está logado
        const params = new URLSearchParams(window.location.search);
        const currentAcao = params.get('acao') || '';

        // Evita loop: se já está na principal e não há formulário, desiste
        if (currentAcao === 'principal' || currentAcao === '') {
            console.warn('[SMAX Bridge] Nenhum formulário encontrado na página principal. Número:', processNumber);
            sessionStorage.removeItem(STORAGE_KEY);
            return;
        }

        window.location.href = 'https://eproc1g.tjsp.jus.br/eproc/controlador.php';
    };

    // ─── Listener postMessage (chamada da aba do SMAX) ───────────────────────
    window.addEventListener('message', (event) => {
        if (event.origin !== SMAX_ORIGIN) return;
        if (!event.data || event.data.type !== MSG_TYPE) return;
        console.log('[SMAX Bridge] Mensagem recebida do SMAX:', event.data.num);
        consultarProcesso(event.data.num);
    });

    // ─── Retomada via sessionStorage (após redirecionamento interno) ─────────
    const pending = sessionStorage.getItem(STORAGE_KEY);
    if (pending) {
        console.log('[SMAX Bridge] Número pendente no storage:', pending);
        if (tryConsultar(pending)) {
            sessionStorage.removeItem(STORAGE_KEY);
        } else {
            // Se ainda não há form, limpa para não ficar em loop
            sessionStorage.removeItem(STORAGE_KEY);
            console.warn('[SMAX Bridge] Formulário não encontrado após redirecionamento.');
        }
    }

    console.log('[SMAX Bridge] Aguardando mensagens do SMAX...');

})();
