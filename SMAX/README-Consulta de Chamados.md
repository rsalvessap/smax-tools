# SMAX Consulta de Chamados - TJSP

Script auxiliar para consulta detalhada de chamados SMAX por lista de IDs. Gera relatórios em Markdown e CSV com status, datas, responsáveis, descrição, solução e últimos comentários.

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

## 3. Como usar

1. Acesse qualquer tela do SMAX
2. Clique no botão **🔍 Consulta de Chamados** que aparece fixo no topo da página
3. Cole os IDs dos chamados desejados na área de texto (aceita um por linha, separados por vírgula, espaço ou ponto-e-vírgula)
4. Clique em **🔍 Consultar**
5. Aguarde o carregamento — até 4 chamados são buscados em paralelo com barra de progresso
6. Use os botões de exportação para baixar o resultado

---

## 4. Informações extraídas por chamado

| Campo | Descrição |
|-------|-----------|
| **ID** | Número do chamado (com link direto) |
| **Assunto** | Título do chamado |
| **Status** | Status SMAX (Novo, Em Andamento, Suspenso, Concluído…) |
| **Status Operacional** | Campo customizado `StatusSCCDSMAX_c` |
| **É Global / Global pai** | Indica se o chamado está vinculado a um global e qual |
| **Solicitante** | Pessoa que abriu o chamado |
| **Grupo (GSE)** | Grupo de suporte responsável |
| **Especialista** | Atendente vinculado |
| **Data de abertura** | `CreateTime` formatado |
| **Última atualização** | `LastUpdateTime` formatado |
| **Descrição** | Texto completo (seção colapsável) |
| **Solução** | Texto de resolução registrado (seção colapsável) |
| **Últimos 3 comentários** | Comentários de usuário/agente, excluindo mensagens do sistema, em ordem cronológica (seção colapsável) |

---

## 5. Exportação

### 5.1 Markdown

Gera um arquivo `.md` no mesmo estilo dos relatórios de acompanhamento de chamados:

```
🔵 **84408773** — Título do chamado
**Status:** Em Andamento | **Status Operacional:** Aguardando Atendimento | **GSE:** SGS221 | **Especialista:** Nome | **Última atualização:** 25/05/2026 14:20

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

### 5.2 CSV

Gera um arquivo `.csv` com todos os campos em colunas, incluindo descrição e solução em texto plano (sem HTML). Compatível com Excel (encoding UTF-8 com BOM).

---

## 6. Outras funcionalidades

- **Painel arrastável** — posição salva entre sessões
- **Última consulta** — data e hora da última consulta realizada exibida no cabeçalho do painel e persistida entre sessões
- **Seções colapsáveis** — descrição, solução e comentários ficam recolhidos por padrão para facilitar a visualização de muitos chamados
- **Tratamento de erros** — chamados não encontrados ou com erro de acesso são sinalizados individualmente sem interromper os demais

---

## 7. Dicas

- Cole qualquer quantidade de IDs — o script processa em lotes de 4 simultâneos
- O script atualiza automaticamente pelo Tampermonkey quando há nova versão no repositório
- Pode ser instalado junto com o **SMAX Toolkit** sem conflito — os botões ficam em posições distintas
