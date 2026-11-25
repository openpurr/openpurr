// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startPtBr: StartDict = {
  meta: {
    title: "Compras no app e assinaturas no seu app, grátis - openpurr",
    description:
      "Começando um app novo? Adicione compras no app e assinaturas com o Purchases SDK oficial e um backend de código aberto que você mesmo roda. Sem comissão, nunca.",
    ogImageAlt: "Começando um app novo? Comece sem comissão sobre a receita. Fique com o seu 1% e invista no seu negócio.",
  },
  hero: {
    crumb: "Adicionar compras no app",
    eyebrow: "Para apps novos",
    headline: "Começando um app novo?",
    headlineAccent: "Comece sem comissão sobre a receita.",
    /** {threshold} is "$2,500". */
    lede: "A maioria dos backends de compras fica com 1% da sua receita assim que você passa de {threshold} por mês, e a conta cresce junto com você. O mais fácil é evitar isso antes da primeira venda. O openpurr é um backend gratuito e de código aberto para compras no app e assinaturas que você mesmo roda, com o mesmo SDK oficial que as grandes plataformas usam.",
    ctaStart: "Comece no GitHub",
    ctaAi: "Copie um prompt para seu assistente de IA",
  },
  growth: {
    title: "O seu 1%, desde o primeiro dia",
    text: "Escolha onde você espera que o seu app esteja daqui a três anos. Veja quanto uma comissão de 1% somaria até lá, supondo um crescimento constante a partir do zero.",
    target: "Receita mensal daqui a três anos",
    /** Labels for the totals. */
    fee: "Comissão de 1%, em 3 anos",
    servers: "Rodando você mesmo, em 3 anos",
    after: "E depois disso, todo ano",
    /** The chart's accessible description. */
    chartLabel: "A comissão sobre a receita somando mês a mês ao longo de três anos",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "São <b>{fee}</b> que você entregaria antes do quarto ano, contra <b>{servers}</b> pelos seus próprios servidores. Fique com esse dinheiro e invista no negócio.",
  },
  invest: {
    title: "Invista no seu negócio, e em você",
    text: "O que um ano do seu 1% compra quando fica com você:",
  },
  how: {
    title: "Como funciona",
    lede: "Quatro passos, e o código que você escreve é o mesmo de qualquer tutorial do RevenueCat.",
    steps: [
      {
        title: "Implante o openpurr",
        /** HTML. */
        text: "Rode a configuração na sua conta da Cloudflare. Para apps pequenos, o Lite cabe no <b>plano gratuito</b>, e a configuração pode ser rodada de novo com segurança se parar no meio.",
      },
      {
        title: "Adicione seu app e seus produtos",
        text: "O painel começa pelo seu primeiro app: o bundle ID e o nome do pacote, depois produtos, entitlements e offerings.",
      },
      {
        title: "Adicione o Purchases SDK",
        /** HTML. */
        text: "Instale o Purchases SDK oficial do RevenueCat, de código aberto sob a licença MIT, e defina <b>uma URL de proxy</b> antes de configurá-lo.",
      },
      {
        title: "Publique",
        text: "As compras são validadas com a Apple e o Google, renovações e reembolsos chegam pelas notificações das lojas, e o seu backend recebe webhooks. Usa o Claude Code? O plugin do openpurr guia você pela configuração do App Store Connect e do Play Console.",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "Configuração, na sua máquina",
  },
  ai: {
    title: "Configure com seu assistente de programação com IA",
    text: "Abra o projeto do seu app no Claude Code, Codex, Cursor, Grok ou qualquer agente de programação e cole este prompt. Ele faz o deploy do openpurr, conecta as lojas e adiciona o SDK, perguntando antes de qualquer etapa que precise do seu login.",
    copy: "Copiar prompt",
    copied: "Copiado",
    claudeTip: "Usa o Claude Code? Adicione antes o plugin do openpurr, que ajuda passo a passo:",
  },
  includes: {
    title: "O que você ganha",
    yes: [
      "Compras e assinaturas na App Store e no Google Play",
      "Entitlements e offerings",
      "Webhooks para o seu backend, assinados e com novas tentativas",
      "16 gráficos: receita, MRR, churn, períodos de teste e mais",
      "Experimentos de preço",
      "Seus dados no seu próprio banco de dados",
    ],
    notYetTitle: "Ainda não",
    notYet: "Criadores de paywall, integrações com ferramentas de analytics de terceiros, eventos de anúncios, cobrança na web e Amazon. Se você precisa disso desde o primeiro dia, as plataformas comerciais já oferecem hoje.",
  },
  lockin: {
    title: "Sem lock-in, para nenhum lado",
    text: "Como o openpurr usa o Purchases SDK padrão, o seu código de compras funciona com qualquer um dos dois backends. Se o seu app crescer além do openpurr, ou você quiser o que as plataformas comerciais oferecem a mais, trocar é uma mudança de configuração e uma importação de clientes, não uma reescrita.",
  },
  pricingLink: {
    text: "Curioso para saber para onde vai o 1% quando você paga?",
    link: "Veja o preço do RevenueCat, detalhado →",
  },
  faq: {
    title: "O que as pessoas perguntam",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "Preciso de um backend para compras no app?",
        a: "Não estritamente: o StoreKit e o Google Play Billing rodam no aparelho. Mas um backend mantém as assinaturas confiáveis. Ele valida as compras com a Apple e o Google, acompanha renovações, cancelamentos e reembolsos pelas notificações das lojas, e informa ao seu app e ao seu servidor quem tem acesso. O openpurr é esse backend, e você mesmo o roda.",
      },
      cheapest: {
        q: "Qual é o jeito mais barato de adicionar assinaturas a um app iOS ou Android?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "Rodar o backend você mesmo. Para apps pequenos, o openpurr Lite cabe no plano gratuito da Cloudflare e funciona com o Purchases SDK gratuito e de código aberto, então você paga só os servidores: cerca de {servers} por ano para um app que fatura {m25k} por mês no nosso modelo, sem comissão sobre a receita.",
      },
      free: {
        q: "O openpurr é gratuito mesmo?",
        a: "Sim. É de código aberto sob a licença Apache 2.0, sem comissão sobre a receita e sem taxas por transação. Você paga pelos seus próprios servidores, e apps pequenos cabem no plano gratuito da Cloudflare.",
      },
      switch: {
        q: "Posso mudar para o RevenueCat depois?",
        a: "Sim. O openpurr usa o Purchases SDK oficial do RevenueCat, então o código de compras do seu app funciona com qualquer um dos dois backends e os seus produtos continuam os mesmos nas lojas. Trocar é uma mudança de configuração mais a migração dos registros dos seus clientes.",
      },
      missing: {
        q: "O que o openpurr ainda não faz?",
        a: "Criadores de paywall, integrações com ferramentas de analytics de terceiros, eventos de anúncios, cobrança na web e Amazon. Experimentos de preço já vêm incluídos. Se você precisa do resto desde o primeiro dia, uma plataforma comercial já oferece hoje.",
      },
    },
  },
};
