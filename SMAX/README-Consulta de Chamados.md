# SMAX Consulta de Chamados — TJSP

Script Tampermonkey para consulta detalhada de chamados SMAX por lista de IDs.
Suporta **listas salvas com detecção automática de mudanças entre consultas**, histórico de snapshots, auto-refresh, exportação em múltiplos formatos e painel redimensionável.

> Versão atual: **2.19**

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

**[⬇ Instalar SMAX Consulta de Chamados](https://github.com/rsalvessap/SMAX-TOOLS/raw/refs/heads/master/SMAX/SMAX%20Consulta%20de%20Chamados.user.js)**

> O Tampermonkey abrirá uma aba de confirmação. Clique em **Instalar**.

> **Requisito:** estar logado no SMAX (`suporte.tjsp.jus.br/saw/*`) — o script usa a sessão ativa para autenticar as chamadas à API.

---

## 3. Como abrir o painel

- Clique no botão **🔍 Consulta de Chamados** que aparece fixo no topo da página
- Ou use o atalho de teclado: **Ctrl + Shift + Q**

Para fechar: botão **✕** no canto superior direito, tecla **Esc** ou **Ctrl + Shift + Q** novamente.

---

## 4. Modos de uso

O painel lateral esquerdo oferece dois modos, selecionáveis pelas abas:

### 4.1 Modo Simples

- Cole os IDs dos chamados na área de texto (um por linha, separados por vírgula, espaço ou ponto-e-vírgula)
- Clique em **🔍 Consultar** — ou pressione **Ctrl + Enter** com o cursor na textarea
- Os resultados são exibidos sem comparação com consultas anteriores
- O botão **💾 Salvar como nova lista** permite transformar o conjunto atual em lista salva

### 4.2 Modo Lista salva

- Selecione uma lista existente no painel lateral ou crie uma com **+ Nova**
- Ao consultar, o script compara automaticamente com o snapshot da consulta anterior e destaca o que mudou
- Os IDs e campos configurados da lista são carregados automaticamente ao selecioná-la

---

## 5. Gerenciamento de listas

### 5.1 Criação e edição

| Ação | Como fazer |
|------|------------|
| Criar lista | Botão **+ Nova** → informe o nome → os IDs atuais da textarea são salvos |
| Atualizar lista | Edite os IDs na textarea → clique em **✏️ Atualizar lista selecionada** |
| Renomear | Botão **✏️** → informe o novo nome |
| Excluir | Botão **🗑️** → confirmação |

### 5.2 Navegação e filtro

- O painel de listas exibe todas as listas como itens clicáveis, mostrando o nome completo (sem truncamento), a quantidade de IDs e a data da última consulta (`📸 DD/MM/AAAA HH:MM`)
- O campo **Filtrar listas…** acima do painel permite buscar listas pelo nome
- Selecionar uma lista carrega automaticamente seus IDs e campos configurados

### 5.3 Histórico de snapshots

Cada lista mantém o **histórico das últimas 3 consultas**. As datas aparecem abaixo do painel de listas após selecionar uma lista. O snapshot mais recente é sempre usado como baseline para detectar mudanças na próxima consulta.

---

## 6. Seleção de campos

Cada lista salva tem sua própria configuração de campos. Os campos marcados determinam quais dados são consultados e quais são rastreados para detecção de mudanças:

| Grupo | Campo | Rastreado |
|-------|-------|:---------:|
| Básico | Status | Sim |
| Básico | Status Operacional | Sim |
| Básico | Data de abertura | — |
| Básico | Última atualização | Sim |
| Relações | Global pai | Sim |
| Relações | Vinculados | Sim |
| Relações | Solicitado por | — |
| Relações | Cargo do solicitante | — |
| Relações | Grupo (GSE) | Sim |
| Relações | Especialista | Sim |
| Conteúdo | Descrição | — |
| Conteúdo | Solução | — |
| Conteúdo | Comentários | Sim |

---

## 7. Detecção de mudanças

Ao consultar uma lista salva que já possui snapshot, cada chamado é comparado com o estado anterior:

| Categoria | Indicador | Descrição |
|-----------|-----------|-----------|
| **COM ATUALIZAÇÃO** | 🔄 badge azul | Campo rastreado mudou ou há novos comentários |
| **ENCERRADO** | ✅ badge verde | Status passou para Concluído, Rejeitado ou Cancelado |
| **SEM ATUALIZAÇÃO** | ⏸️ badge cinza | Nenhum campo rastreado alterado |

As mudanças individuais são exibidas no card do chamado com o valor anterior riscado em vermelho e o novo em verde. Uma **barra de resumo** no topo dos resultados exibe os totais de cada categoria.

---

## 8. Filtragem e ordenação dos resultados

Após a consulta, a barra de ferramentas acima dos resultados permite:

- **Filtrar por ID, assunto, grupo ou especialista** — digitação em tempo real
- **Ordenar por:**
  - Ordem padrão (ordem dos IDs informados)
  - Atualizado primeiro
  - Encerrado primeiro
  - Por status
  - Última atualização

---

## 9. Auto-refresh

Após a primeira consulta bem-sucedida, a opção **Auto-refresh** aparece na sidebar:

1. Marque a caixa **Auto-refresh**
2. Escolha o intervalo: 1 min / 5 min / 10 min / 30 min
3. Um contador regressivo indica quando a próxima consulta ocorrerá

**Notificação de mudanças:** se o auto-refresh detectar chamados atualizados enquanto o painel estiver fechado:
- O título da aba muda para `🔴 N atualiz. — [título original]`
- O botão **🔍 Consulta de Chamados** fica vermelho e pulsante
- Ao abrir o painel, a notificação é limpa automaticamente

---

## 10. Exportação

Disponível após qualquer consulta bem-sucedida. Os formatos são divididos em duas categorias:

### 10.1 Exportar consulta (visão completa de todos os chamados)

| Botão | Formato | Descrição |
|-------|---------|-----------|
| 📄 Word (.doc) | `.doc` | Tabela de metadados, descrição, solução e comentários por chamado |
| 📊 Excel (.xls) | `.xls` | Planilha com todos os campos principais |
| 🖨️ PDF | Impressão | Abre janela de impressão do Word formatado |
| 📝 Markdown (.md) | `.md` | Formato texto com emojis de status e agrupamento por situação |
| 📊 CSV (.csv) | `.csv` | Dados tabulares compatíveis com qualquer planilha |

### 10.2 Exportar relatório (focado em mudanças — ideal para uso com lista salva)

| Botão | Formato | Descrição |
|-------|---------|-----------|
| 📋 Word (.doc) | `.doc` | Chamados agrupados em seções: Encerrado / Sem atualização / Nova atualização |
| 📊 Excel (.xls) | `.xls` | Planilha com coluna de situação e alterações detectadas |
| 🖨️ PDF | Impressão | Versão imprimível do relatório Word |
| 📋 Markdown (.md) | `.md` | Relatório texto com emojis e indicadores de mudança |

> Nos exports Word e Markdown, o número de cada chamado é um **link clicável** que abre o chamado direto no SMAX.

### 10.3 Emojis de status usados nos exports

| Emoji | Status |
|-------|--------|
| 🆕 | Novo |
| 🟡 | Pendente |
| 🔵 | Em Andamento |
| ⏸️ | Suspenso |
| 🟣 | Pronto |
| ✅ | Concluído |
| ❌ | Rejeitado |
| ⛔ | Cancelado |

---

## 11. Outras funcionalidades

- **Painel redimensionável** — arraste a barra divisória entre o sidebar e os resultados para ajustar as proporções
- **Seções colapsáveis** — descrição, solução e comentários ficam recolhidos por padrão; clique para expandir
- **Preview de comentário** — o comentário mais recente aparece em prévia direta no card sem precisar expandir
- **Barra de progresso** — até 4 chamados são consultados em paralelo com indicador `X/N`
- **Tratamento de erros** — chamados com erro são sinalizados individualmente sem interromper os demais
- **Compatível com SMAX Toolkit** — pode ser instalado junto sem conflito

---

## 12. Atalhos de teclado

| Atalho | Ação |
|--------|------|
| **Ctrl + Shift + Q** | Abrir / fechar o painel |
| **Ctrl + Enter** | Executar consulta (com cursor na textarea) |
| **Esc** | Fechar o painel |
