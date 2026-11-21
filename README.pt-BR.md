<!-- translated-from: README.md sha256:2f5fb4fb0a81c338 -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <b>Português (Brasil)</b> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <a href="README.vi.md">Tiếng Việt</a> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Um backend alternativo ao RevenueCat, auto-hospedado e de código aberto.

Com os Purchases SDKs de código aberto do RevenueCat, aponte o `Purchases.proxyURL` do seu app para o seu próprio servidor. O openpurr valida compras da App Store e do Google Play, controla entitlements, recebe as notificações das lojas, envia webhooks para o seu backend e gera gráficos das suas principais métricas de assinatura. Ele roda em uma infraestrutura que você controla.

O openpurr é um projeto independente. Não é afiliado à RevenueCat, Inc. nem endossado por ela.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-dark.png">
  <img src=".github/assets/openpurr-dashboard.png" alt="O painel do openpurr Lite, com 12 meses de movimentação de MRR, assinaturas ativas, churn, novos clientes, novos testes gratuitos e testes gratuitos ativos">
</picture>

## Para quem é

Desenvolvedores de apps que:

- **Querem controlar a própria infraestrutura de compras.** Seus registros de compras, entitlements e credenciais das lojas ficam em servidores que você opera, em um banco de dados que você pode consultar, fazer backup e exportar. Nenhum serviço externo fica entre o seu app e os seus clientes.
- **Não querem dividir uma porcentagem da receita.** O openpurr não cobra comissão sobre a receita nem taxas por transação. A edição Lite foi projetada para caber no plano gratuito da Cloudflare, então um app pequeno pode rodá-la sem custo.
- **Não querem depender de um serviço comercial.** É código aberto: você pode ler o código, alterá-lo e levá-lo da Cloudflare para a sua própria nuvem, ou de volta.

Também é uma boa opção se você já usa os SDKs do RevenueCat e quer mantê-los. O openpurr funciona com os SDKs oficiais, sem modificações, então a migração começa trocando uma URL, não reescrevendo seu código de compras. Para trazer seus clientes atuais, veja [Como migrar do RevenueCat](https://openpurr.org/pt-br/migrate-from-revenuecat/).

**Talvez ainda não seja para você** se você precisa de construtores de paywalls, testes A/B, integrações com ferramentas de analytics de terceiros ou um contrato de suporte. As plataformas comerciais já oferecem isso hoje. Veja o [roadmap](ROADMAP.md) (em inglês) para saber o que vem por aí.

## O que ele faz

- **Compras:** valida transações do StoreKit 2 e compras do Google Play, e retorna o `CustomerInfo` e os entitlements que o SDK espera.
- **Notificações das lojas:** recebe as App Store Server Notifications V2 e as Real-time Developer Notifications do Google Play.
- **Webhooks:** envia ao seu backend eventos no formato do RevenueCat, assinados com HMAC-SHA256 e reenviados por cerca de 72 horas em caso de falha.
- **Gráficos:** um painel simples com assinaturas ativas, MRR, testes gratuitos, conversões e churn.
- **Autenticação:** chaves de SDK e chaves secretas, login de operadores (senha com códigos de autenticador opcionais; o Cloudflare Access está planejado), papéis e log de auditoria.
- **Servidor MCP e skills do Claude:** um assistente de IA pode consultar clientes, explicar por que alguém tem ou não tem um entitlement e orientar você passo a passo na configuração da App Store e do Play Console.

**Fora do escopo por enquanto:** paywalls, eventos de anúncios, Customer Center, moedas virtuais, pagamentos na web, Amazon e integrações com ferramentas de analytics de terceiros. Experimentos de preço estão no [roadmap](ROADMAP.md#later-) (em inglês).

## Duas edições

| | Lite | Standard |
|---|---|---|
| Linguagem | TypeScript | Go |
| Roda em | Cloudflare Workers + D1 | Contêineres + Postgres no GCP ou na AWS |
| Custo | Projetada para caber no plano gratuito da Cloudflare | Sua conta de nuvem |
| Para | Apps independentes: leve e barata de manter no ar | Portfólios maiores de apps (em breve) |

As duas edições passam pela mesma suíte de conformidade, em `spec/`. Você pode passar do Lite para o Standard sem publicar uma atualização do app, desde que o seu app aponte para um domínio próprio.

## Compatibilidade com os SDKs

Desde o primeiro dia, o openpurr usa os SDKs oficiais, sem modificações (todos com licença MIT):

| SDK | Como apontar para o openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Defina a URL do proxy antes de chamar `configure`. Deixe a verificação de entitlements no padrão (desativada), porque as respostas assinadas dependem da chave do próprio RevenueCat.

**Limitação conhecida no Android:** o SDK envia tráfego de diagnóstico, paywalls e anúncios diretamente para três hosts do RevenueCat, mesmo com uma URL de proxy definida. O openpurr desativa o diagnóstico pela configuração remota. Não use os paywalls nem os anúncios do RevenueCatUI no Android com o openpurr.

## Estrutura planejada do repositório

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Primeiros passos

O Lite está na versão 0.1.0, a primeira, então espere mudanças antes da 1.0. Para testá-lo na sua própria conta da Cloudflare (o plano gratuito basta), com Node 22.12 ou mais recente:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

A configuração pode ser executada de novo com segurança se parar no meio. Ela termina com um link para o painel, que abre no cadastro do seu primeiro app: o bundle ID e o nome do pacote, e depois produtos, entitlements e offerings. Uma única implantação pode rodar vários apps como projetos separados, cada um com seus próprios clientes. Depois disso:

- **Verifique sua configuração:** rode `npx @openpurr/cli login` e depois `npx @openpurr/cli doctor`. Ele mostra o que está faltando e como corrigir cada item.
- **Receba alertas de uso:** adicione um token de API da Cloudflare com a permissão Account Analytics: Read como o secret `CLOUDFLARE_ANALYTICS_TOKEN`, e o painel avisa você antes que os limites diários do plano gratuito bloqueiem requisições.
- **Faça backup dos seus dados:** `npx pnpm db:backup` exporta o banco de dados para um arquivo. O D1 também guarda 7 dias de histórico no plano gratuito (30 no Workers Paid).
- **Implante a cada push:** faça um fork do repositório e adicione os dados da sua conta da Cloudflare como secrets do repositório. O [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) lista quais são.

Usa o Claude Code? O [plugin do openpurr](plugin/) (em inglês) orienta você pelas mesmas etapas, além da configuração do App Store Connect e do Play Console.

## Como contribuir

Veja o [CONTRIBUTING.md](CONTRIBUTING.md) (em inglês). No momento, a ajuda mais útil é feedback nas issues: suposições erradas sobre os SDKs ou as lojas, e casos reais fora do comum.

## Histórico de estrelas

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Gráfico do histórico de estrelas" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Licença

[Apache License 2.0](LICENSE). Copyright 2026 colaboradores do openpurr.
