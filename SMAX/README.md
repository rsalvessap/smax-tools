# SMAX Toolkit - TJSP

Conjunto de ferramentas de automação e aprimoramento de interface para o sistema SMAX do Tribunal de Justiça de São Paulo.

---

## Scripts disponíveis

| Script | Descrição |
|--------|-----------|
| `SMAX Toolkit - TJSP.user.js` | Triagem, templates, radar de pendentes, Zen Mode, consulta de processos no eProc e mais |

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

**[⬇ Instalar SMAX Toolkit - TJSP](https://github.com/rsalvessap/SMAX-TOOLS/raw/refs/heads/master/SMAX/SMAX%20Toolkit%20-%20TJSP.user.js)**

> O Tampermonkey abrirá uma aba de confirmação. Clique em **Instalar**.

Um único script cobre tanto o SMAX quanto o eProc — não é necessário instalar nada separado.

---

## 3. Configuração inicial

Ao abrir o SMAX na tela de chamados (`Requests`), uma **engrenagem** aparecerá no canto inferior direito. Clique nela para configurar.

### 3.1 Triador (quem está operando)

No campo **"Quem é você?"**, busque e selecione seu próprio nome. Isso vincula suas ações ao seu usuário e ativa o Radar de pendentes.

### 3.2 Equipes e roteamento

1. Clique em **+ Nova Equipe** para criar uma equipe (ex: JEC)
2. Defina as regras de roteamento:
   - **GSE:** grupos de suporte que pertencem a esta equipe
   - **Local de Divulgação:** termos que identificam chamados da equipe (ex: `JUIZADO ESPECIAL CIVEL`)
3. Adicione os membros da equipe:
   - Use a busca para encontrar atendentes
   - Configure os **Dígitos Finais** de cada um (ex: `00-05, 10-15`)
   - Marque **Ausente** para quem não deve receber chamados

> A equipe **GERAL** é padrão e captura tudo que não se enquadrar nas regras específicas.

### 3.3 Opções

Na engrenagem, a seção **Opções** permite ativar/desativar cada módulo:

| Opção | Descrição |
|-------|-----------|
| 🧘 Zen Mode | Oculta campos desnecessários no formulário (Fabricante, SLTs, Plano de Tarefa…) |
| 📡 Radar de pendentes | Badge vermelho com chamados seus em revisão ou aguardando aceite |
| 💬 Comentários expandidos | Exibe todos os comentários sem limite de altura |
| 📂 Recolher seções | Recolhe automaticamente seções desnecessárias |
| 💀 Caveira detratores | Marca visualmente pessoas na lista de detratores |
| 🏷️ Badges na grid | Exibe responsável ao lado do chamado na lista |

---

## 4. Módulos

### 4.1 HUD de Triagem

Clique em **INICIAR TRIAGEM** (botão flutuante, canto inferior da tela) para abrir o painel.

| Campo | Descrição |
|-------|-----------|
| Local de Divulgação | Origem do chamado |
| Meus Finais | Dígitos que você processa (ex: `00-50`) |
| GSE | Grupo de suporte — visualizar ou alterar |
| Controles | Navegação `< >`, atualizar fila `↻`, sair |

1. Navegue entre chamados com as setas ou atalhos de teclado
2. Clique em uma urgência (**Baixa / Média / Alta / Crítica**) — o sistema automaticamente define urgência e calcula o responsável pelos dígitos finais
3. Opcionalmente, digite uma resposta no editor de texto
4. Clique em **ENVIAR** para gravar tudo de uma vez

### 4.2 Templates de Resposta

Botão **📋** flutuante (acima da engrenagem). Abre um modal com abas **Solução** e **Discussão**.

- Clique em um template para **inserir direto no CKEditor** aberto
- Crie, edite e exclua templates pelo próprio modal
- Armazenados localmente no navegador (localStorage)

### 4.3 Radar de Pendentes

Badge vermelho fixo no canto superior direito da tela quando há chamados seus em:
- **Rejeitado** (fase Review)
- **Aguardando aceite** (fase Accept)

Clique no badge para ver a lista e acessar cada chamado diretamente.

### 4.4 Botões de Resolução no Topo

Na tela de fechamento de chamado, os botões **Salvar**, **Salvar e Fechar** e **Lifecycle** aparecem automaticamente no **topo** da seção — sem precisar rolar até a toolbar.

### 4.5 Consulta de Processos no eProc

Números de processo no formato CNJ aparecem como links clicáveis em qualquer parte do SMAX (descrição, discussões, tela normal de chamado).

**Formatos reconhecidos:**
- Formatado: `4000439-14.2026.8.26.0201`
- Bruto (20 dígitos): `40004391420268260201`

Clique no número → nova aba do eProc abre já com a pesquisa executada (requer eProc aberto e logado).

---

## 5. Dicas

- Mantenha o cadastro de ausências atualizado — chamados são redistribuídos automaticamente para quem está presente
- Se um chamado cair na equipe errada, revise as regras de GSE e Local de Divulgação nas configurações
- O script atualiza automaticamente pelo Tampermonkey quando há nova versão no repositório
