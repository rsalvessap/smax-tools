# SMAX Tools — Triagem SGS221

Scripts de automação e aprimoramento de interface para o sistema SMAX do Tribunal de Justiça de São Paulo.

---

## Scripts disponíveis

| Script | Descrição |
|--------|-----------|
| `TRIAGEM - SMAX SGS221-0.1.user.js` | Interface de triagem no SMAX + bridge de consulta de processos no eProc |

---

## 1. Pré-requisito: instalar o Tampermonkey

1. Instale a extensão **Tampermonkey** na loja do seu navegador (Chrome, Edge ou Firefox)
2. Vá em **Gerenciar Extensões** e ative o **Modo do desenvolvedor**
3. No Tampermonkey → **Painel de Controle** → **Configurações**, marque:
   - Permitir scripts de usuário
   - Permitir acesso a abas
   - Permitir requisições remotas

---

## 2. Instalação

Clique no link abaixo para instalar diretamente pelo Tampermonkey:

**[⬇ Instalar TRIAGEM - SMAX SGS221](https://github.com/rsalvessap/SMAX-TOOLS/raw/refs/heads/master/SMAX/TRIAGEM%20-%20SMAX%20SGS221-0.1.user.js)**

> O Tampermonkey abrirá uma aba de confirmação. Clique em **Instalar**.

Um único script cobre tanto o SMAX quanto o eProc — não é necessário instalar nada separado.

---

## 3. Configuração inicial do script de triagem

Ao abrir o SMAX na tela de chamados (`Requests`), uma **engrenagem** aparecerá no canto inferior direito. Clique nela para configurar.

### 3.1 Equipes e roteamento

1. Clique em **+ Nova Equipe** para criar uma equipe (ex: JEC)
2. Defina as regras de roteamento:
   - **GSE:** grupos de suporte que pertencem a esta equipe
   - **Local de Divulgação:** termos que identificam chamados da equipe (ex: `JUIZADO ESPECIAL CIVEL`)
3. Adicione os membros da equipe:
   - Use a busca para encontrar atendentes
   - Configure os **Dígitos Finais** de cada um (ex: `00-05, 10-15`)
   - Marque **Ausente** para quem não deve receber chamados

> A equipe **GERAL** é padrão e captura tudo que não se enquadrar nas regras específicas.

### 3.2 Configurações pessoais

No campo **"Triador (quem está operando)"**, busque e selecione seu próprio nome. Isso vincula suas ações de triagem ao seu usuário.

---

## 4. Como usar o HUD de triagem

Clique em **INICIAR TRIAGEM** (botão flutuante, canto inferior da tela) para abrir o painel.

### Cabeçalho

| Campo | Descrição |
|-------|-----------|
| Local de Divulgação | Origem do chamado (ex: "JUIZADO ESPECIAL CÍVEL DE JUNDIAÍ") |
| Meus Finais | Dígitos que você processa (ex: `00-50`) |
| GSE | Grupo de suporte — visualizar ou alterar |
| Controles | Navegação `< >`, atualizar fila `↻`, sair |

### Processo de triagem

1. Navegue entre chamados com as setas ou atalhos de teclado
2. Clique em uma urgência (**Baixa / Média / Alta / Crítica**) — o sistema automaticamente:
   - Define a urgência
   - Calcula o responsável pelos dígitos finais do chamado
   - Prepara o chamado para envio (campo Responsável fica com borda verde)
3. Opcionalmente, digite uma resposta no editor de texto
4. Clique em **ENVIAR** para gravar tudo de uma vez

### Funcionalidades extras

- **Anexos** — exibidos no canto inferior direito, clique para visualizar
- **Discussões** — histórico de interações exibido à esquerda
- **Log de atividades** — exportável em CSV pelas configurações (engrenagem)

---

## 5. Consulta de processos no eProc

Chamados que contenham um número de processo judicial (formato CNJ) na **descrição** ou nas **discussões** exibem o número como link clicável.

**Formatos reconhecidos:**
- Formatado: `4000439-14.2026.8.26.0201`
- Bruto (20 dígitos): `40004391420268260201`

**Como funciona:**
1. Clique no número de processo
2. A aba do eProc (já logada) é focada automaticamente
3. O bridge script executa a consulta dentro da sessão ativa — sem nenhuma ação adicional do usuário

> **Requisito:** ter o eProc aberto e logado em alguma aba do navegador, e o script `eproc-smax-bridge.user.js` instalado.

---

## 6. Dicas

- Mantenha o cadastro de ausências atualizado — chamados são redistribuídos automaticamente para quem está presente
- Se um chamado cair na equipe errada, revise as regras de GSE e Local de Divulgação nas configurações
- O script atualiza automaticamente pelo Tampermonkey quando há nova versão no repositório
