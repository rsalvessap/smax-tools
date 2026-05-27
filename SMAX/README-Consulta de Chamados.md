# SMAX Consulta de Chamados - TJSP

Script auxiliar para consulta detalhada de chamados SMAX por lista de IDs. Suporta **listas salvas com detecção automática de mudanças** entre consultas, seleção de campos configurável e exportação em Markdown e Word.

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

> **Requisito:** estar logado no SMAX (`suporte.tjsp.jus.br/saw/*`) — o script utiliza a sessão ativa para autenticar as consultas à API.

---

## 3. Modos de uso

O script opera em dois modos, selecionáveis no painel lateral esquerdo:

### 3.1 Consulta simples

- Cole os IDs na área de texto (um por linha, separados por vírgula, espaço ou ponto-e-vírgula)
- Clique em **Consultar**
- Os resultados são exibidos e descartados ao fechar o painel
- Ideal para consultas pontuais sem necessidade de histórico

### 3.2 Lista salva

- Crie uma lista nomeada com **+ Nova lista**
- Cole os IDs e clique em **Salvar IDs**
- Ao consultar, o script compara com o snapshot da consulta anterior e destaca automaticamente o que mudou
- A lista fica disponível para nova consulta a qualquer momento via dropdown

---

## 4. Seleção de campos

Cada lista salva tem sua própria configuração de campos. Marque apenas os campos desejados para que o script consulte somente o necessário:

| Grupo | Campo | Rastreado para mudanças |
|-------|-------|:-----------------------:|
| Básico | Status | Sim |
| Básico | Status Operacional | Sim |
| Básico | Data de abertura | — |
| Básico | Última atualização | Sim |
| Relações | Global pai | Sim |
| Relações | Solicitante | — |
| Relações | Grupo (GSE) | Sim |
| Relações | Especialista | Sim |
| Conteúdo | Descrição | — |
| Conteúdo | Solução | — |
| Conteúdo | Comentários | Sim |

---

## 5. Detecção de mudanças (listas salvas)

Após cada consulta de lista salva, o sistema salva um snapshot com os valores atuais dos campos rastreados. Na próxima consulta, cada chamado é comparado com o snapshot anterior:

- **COM ATUALIZAÇÃO** — exibido em destaque com as mudanças identificadas (ex: status anterior → novo, novos comentários)
- **SEM ATUALIZAÇÃO** — sem alterações nos campos rastreados
- **ENCERRADO** — chamados com status Concluído, Rejeitado ou Cancelado

Uma barra de resumo no topo dos resultados exibe os contadores de cada categoria.

---

## 6. Exportação

### 6.1 Markdown

Gera um arquivo `.md` no estilo dos relatórios de acompanhamento, com agrupamento por status de atualização quando aplicável:

```
## COM ATUALIZAÇÃO (2)

🔵 **84408773** — Título do chamado
**Status:** Em Andamento | **Status Operacional:** Aguardando Atendimento | **GSE:** SGS221 | **Especialista:** Nome | **Última atualização:** 25/05/2026 14:20
**Mudanças:** Status: Novo → Em Andamento

> **Agent | 25/05/2026**
> Texto do comentário registrado no chamado.
```

Emojis de status:

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

### 6.2 Word (.doc)

Gera um arquivo `.doc` formatado com título, cabeçalho de campos, comentários e seções de mudança destacadas. Abre diretamente no Microsoft Word.

---

## 7. Gerenciamento de listas

- **+ Nova lista** — cria uma lista com nome personalizado
- **Renomear** — altera o nome da lista selecionada
- **Excluir** — remove a lista e seu histórico de snapshots
- **Dropdown** — seleciona a lista ativa; o painel carrega automaticamente seus IDs e campos configurados
- O snapshot da última consulta é salvo automaticamente e exibido como "Última consulta: DD/MM/AAAA HH:MM"

---

## 8. Outras funcionalidades

- **Tela cheia** — o painel ocupa a tela inteira para melhor visualização de muitos chamados
- **Seções colapsáveis** — descrição, solução e comentários ficam recolhidos por padrão
- **Barra de progresso** — até 4 chamados são buscados em paralelo com indicador visual
- **Tratamento de erros** — chamados não encontrados ou com erro são sinalizados individualmente sem interromper os demais
- **Compatível com SMAX Toolkit** — pode ser instalado junto sem conflito; o botão aparece fixo no topo da página

---

## 9. Dicas

- Cole qualquer quantidade de IDs — o script processa em lotes de 4 simultâneos
- O script atualiza automaticamente pelo Tampermonkey quando há nova versão no repositório
- Para monitorar um conjunto fixo de chamados ao longo do tempo, use lista salva e consulte periodicamente — o sistema registra todas as mudanças entre consultas
