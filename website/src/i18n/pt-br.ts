// Brazilian Portuguese copy. Follows en.ts; see the notes there. Uses "você"; "entitlements", "webhooks" and "paywalls" stay in English.
import type { Dict } from "./en";

export const ptBr: Dict = {
  meta: {
    title: "openpurr: alternativa ao RevenueCat open source e auto-hospedada",
    description:
      "openpurr é uma alternativa ao RevenueCat de código aberto e auto-hospedada. Use o Purchases SDK que você já tem, aponte para seu servidor e não pague comissão.",
    ogImageAlt: "openpurr: uma alternativa ao RevenueCat de código aberto e auto-hospedada, ao lado do seu painel de gráficos de assinaturas",
  },
  header: {
    home: "Página inicial do openpurr",
    nav: { features: "Recursos", editions: "Edições", roadmap: "Roadmap", faq: "FAQ", migrate: "Migrar" },
    language: "Idioma",
  },
  footer: {
    tagline: "Infraestrutura de compras de código aberto que você mesmo opera.",
    roadmap: "Roadmap",
    contributing: "Contribuir",
    sponsor: "Patrocinar",
    contact: "Contato",
    privacy: "Privacidade (em inglês)",
    disclaimer:
      "openpurr é um projeto independente. Não é afiliado à RevenueCat, Inc. nem endossado por ela. App Store é uma marca registrada da Apple Inc. Google Play é uma marca registrada da Google LLC.",
    copyright: "Copyright {year} colaboradores do openpurr.",
    cookieSettings: "Configurações de cookies",
  },
  consent: {
    label: "Consentimento de cookies",
    text: "Queremos usar cookies do Google Analytics para contar visitas e ver quais páginas ajudam. Nada é gravado a menos que você aceite, e você pode mudar de ideia a qualquer momento em Configurações de cookies.",
    privacy: "Privacidade (em inglês)",
    decline: "Recusar",
    accept: "Aceitar",
  },
  snippet: {
    tabs: "Plataforma do SDK",
    note: "Uma linha. O mesmo SDK, o mesmo código de compras.",
  },
  home: {
    hero: {
      title: 'A <span class="accent">alternativa ao RevenueCat</span> de código aberto e <span class="nowrap">auto-hospedada</span>',
      lede: "Controle sua própria infraestrutura de compras, não divida nada da sua receita e não dependa de nenhum serviço comercial. Mantenha o Purchases SDK que você já usa: mude uma URL, não o seu código de compras.",
      star: "Dê uma estrela no GitHub",
      how: "Como funciona",
      shotAlt:
        "O painel do openpurr Lite, com 12 meses de movimentação de MRR, assinaturas ativas, churn, novos clientes, novos testes gratuitos e testes gratuitos ativos",
    },
    why: {
      eyebrow: "Para quem é",
      title: "Para desenvolvedores de apps que preferem operar tudo por conta própria",
      lede: "openpurr funciona com os SDKs oficiais, sem modificações. Para migrar, você começa trocando uma URL, não reescrevendo seu código de compras.",
      reasons: [
        {
          title: "Seus dados, seus servidores",
          body: "Registros de compras, entitlements e credenciais das lojas ficam em um banco de dados que você opera, consulta, faz backup e exporta. Nenhum serviço externo fica entre o seu app e os seus clientes.",
        },
        {
          title: "Sem comissão sobre a receita",
          body: "Nenhuma porcentagem da receita e nenhuma taxa por transação. A edição Lite foi projetada para caber no plano gratuito da Cloudflare, então um app pequeno pode rodá-la sem custo.",
        },
        {
          title: "Sem depender de fornecedor",
          body: "É código aberto sob a licença Apache 2.0. Leia o código, altere-o e leve-o da Cloudflare para a sua própria nuvem, ou de volta.",
        },
      ],
    },
    how: {
      eyebrow: "Como funciona",
      title: "Seu servidor fica onde antes ficava o fornecedor",
      lede: "Seu app continua com o Purchases SDK de código aberto que ele já inclui. O SDK conversa com o openpurr. O openpurr conversa com as lojas, mantém o estado das assinaturas e avisa o seu backend sobre o que mudou.",
      flowLabel: "Fluxo de requisições",
      app: "Seu app",
      sdkLicense: "Oficial, sem modificações, licença MIT",
      sdkPlatforms: "iOS, Android, Flutter ou React Native",
      coreWhere: "No Cloudflare Workers ou na sua própria nuvem",
      appStoreApi: "Server API e notificações",
      playApi: "Developer API e RTDN",
      backend: "Seu backend",
      backendHooks: "Webhooks assinados",
      steps: [
        {
          title: "Implante",
          body: "Rode o openpurr Lite na sua própria conta da Cloudflare. Uma configuração guiada, <code>pnpm run setup</code>, cria o banco de dados, implanta os dois Workers e cria sua conta de proprietário.",
        },
        {
          title: "Aponte o SDK",
          body: "Defina a URL do proxy antes de <code>configure</code>. Use um domínio próprio para poder migrar depois.",
        },
        {
          title: "Conecte as lojas",
          body: "Adicione as credenciais das lojas e as URLs de notificação. A verificação de configuração, <code>openpurr doctor</code>, confere tudo e explica como corrigir o que estiver faltando.",
        },
      ],
    },
    features: {
      eyebrow: "O que ele faz",
      title: "O backend de assinaturas, sem os extras que você não usa",
      items: [
        {
          title: "Compras e notificações das lojas",
          body: "Valida transações do StoreKit 2 e compras do Google Play, retorna o CustomerInfo e os entitlements que o SDK espera e mantém renovações, reembolsos e períodos de carência atualizados a partir das notificações da App Store e do Google Play.",
        },
        {
          title: "Webhooks",
          body: "Envia ao seu backend eventos no formato do RevenueCat, assinados com HMAC-SHA256 e reenviados por cerca de 72 horas em caso de falha.",
        },
        {
          title: "Gráficos",
          body: "16 gráficos: receita, MRR e ARR, movimentação de MRR e de assinaturas, assinaturas ativas e pagas, status das assinaturas, churn, testes gratuitos e conversão de testes, novos clientes, reembolsos e taxa de reembolso, e compras avulsas. Filtre por app, loja, produto e ambiente, com a receita convertida para USD.",
        },
        {
          title: "Experimentos de preço",
          body: "Mostre offerings diferentes a clientes novos no seu app e compare a conversão e a receita por cliente, com a chance de cada variante superar o controle. Sem atualizar o app.",
        },
        {
          title: "Acesso e auditoria",
          body: "Chaves de SDK e chaves secretas, login de operadores com códigos de autenticador opcionais, papéis, tokens de acesso e log de auditoria.",
        },
        {
          title: "Servidor MCP e skills do Claude",
          body: "Pergunte a um assistente de IA por que um cliente tem ou não tem um entitlement, consulte compras ou receba orientação passo a passo na configuração do App Store Connect e do Play Console.",
        },
      ],
    },
    editions: {
      eyebrow: "Duas edições",
      title: "Comece pequeno e cresça sem atualizar o app",
      lede: "As duas edições passam pela mesma suíte de testes de conformidade. Se o seu app aponta para um domínio próprio, passar do Lite para o Standard não exige publicar uma nova versão do app.",
      lite: {
        badge: "Para apps independentes",
        price: "US$ 0",
        priceNote: "no plano gratuito da Cloudflare",
        items: ["TypeScript no Cloudflare Workers e D1", "Leve e barato de manter no ar", "Alertas de uso antes de atingir os limites do plano gratuito"],
      },
      standard: {
        badge: "Em breve",
        price: "Sua conta de nuvem",
        priceNote: "nada além disso",
        items: ["Go e Postgres em contêineres", "GCP ou AWS", "Para portfólios maiores de apps"],
      },
    },
    savings: {
      eyebrow: "Custo",
      title: "Quanto você guarda em comparação com o RevenueCat",
      lede: "O plano Pro do RevenueCat é gratuito abaixo de US$ 2.500 de receita rastreada por mês e depois cobra 1% de toda ela. O Lite roda no plano gratuito da Cloudflare e, quando seu app passar dele, no Workers Paid, a partir de US$ 5 por mês.",
      revenue: "Receita mensal",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "Economia por ano",
      perMonth: "{amount} por mês",
      free: "Plano gratuito da Cloudflare",
      paid: "Cloudflare Workers Paid",
      chartLabel: "Custo mensal por receita mensal: o do RevenueCat sobe com a receita, o do openpurr Lite fica perto de zero",
      gapLegend: "Quanto você guarda",
      tableSummary: "Comparar em outros níveis de receita",
      colRevenue: "Receita mensal",
      colRc: "RevenueCat, por mês",
      colOp: "openpurr Lite, por mês",
      colSaved: "Economia por ano",
      methodSummary: "Como estimamos",
      method: [
        "RevenueCat: o preço de tabela do plano Pro, 1% da receita mensal rastreada a partir de US$ 2.500. A receita rastreada conta planos anuais e compras únicas no mês em que são pagos, então pode ser maior que o MRR. Contas grandes podem negociar preços Enterprise.",
        "openpurr Lite: os preços da Cloudflare para Workers e D1. Supomos cerca de US$ 1,50 de receita mensal e cerca de 10 requisições do SDK por dia por usuário ativo diário. Assim, as 100.000 requisições por dia do plano gratuito cobrem até cerca de {paidFrom} de receita mensal, com folga. Acima disso, contamos o Workers Paid: US$ 5 por mês, mais US$ 0,30 por milhão de requisições acima de 10 milhões.",
        "Não incluído: o seu tempo para operar. As taxas das lojas são as mesmas nos dois casos.",
        "Preços verificados em {date}. O openpurr não é afiliado ao RevenueCat.",
      ],
    },
    fit: {
      eyebrow: "Sendo transparentes",
      title: "Talvez ainda não seja para você",
      lede: "Se você precisa de construtores de paywalls, integrações com ferramentas de analytics de terceiros ou um contrato de suporte, as plataformas comerciais já oferecem isso hoje.",
      outTitle: "Fora do escopo por enquanto",
      tags: [
        "Paywalls",
        "Eventos de anúncios",
        "Customer Center",
        "Moedas virtuais",
        "Pagamentos na web",
        "Amazon",
        "Integrações de analytics",
      ],
    },
    roadmap: {
      eyebrow: "Roadmap",
      title: "Para onde estamos indo",
      lede: "A ordem está definida, mas não há datas. Se algo é importante para você, diga em uma issue.",
      status: { done: "Concluído", wip: "Em andamento", planned: "Planejado", later: "Você decide" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Versão mais recente: {version}",
            "Projetado para o plano gratuito da Cloudflare",
            "App Store e Google Play",
            "Webhooks, painel e administração",
            "Vários apps em uma única implantação",
            "Experimentos de preço",
            "Servidor MCP, CLI e skills do Claude",
            "Próximos passos: testes em dispositivos e depois a 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["Go e Postgres em contêineres", "Primeiro GCP, depois AWS", "Mesma suíte de conformidade do Lite", "Migração a partir do Lite sem atualizar o app"],
        },
        {
          phase: "Definido pela comunidade",
          items: ["Identidade verificada do usuário final", "Extras do Standard para equipes maiores", "O que você pedir nas issues"],
        },
      ],
      more: "Leia o roadmap completo (em inglês) →",
    },
    cta: {
      title: "Ajude a construir",
      body: "A ajuda mais útil agora é feedback: suposições erradas sobre os SDKs ou as lojas, e casos reais fora do comum em renovações, reembolsos e períodos de carência.",
      star: "Dê uma estrela no GitHub",
      issue: "Abra uma issue",
      coffee: "Pague um café para a gente",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr como alternativa ao RevenueCat",
    lede: "O que muda quando você opera seu próprio backend de assinaturas, e o que não muda.",
    items: [
      {
        q: "O que é o openpurr?",
        a: "openpurr é uma alternativa ao RevenueCat de código aberto e auto-hospedada. É um backend para compras no app e assinaturas que funciona com o Purchases SDK oficial do RevenueCat. Ele valida compras da App Store e do Google Play, controla entitlements, recebe as notificações das lojas, envia webhooks para o seu backend e gera gráficos das suas principais métricas de assinatura, tudo em uma infraestrutura que você controla.",
      },
      {
        q: "Qual é a diferença entre o openpurr e o RevenueCat?",
        a: "RevenueCat é um serviço comercial hospedado que cobra uma porcentagem da receita acima de um plano gratuito. openpurr é um software que você mesmo opera: seus registros de compras, entitlements e credenciais das lojas ficam no seu próprio banco de dados, e não há comissão sobre a receita nem taxa por transação. Hoje o RevenueCat oferece mais recursos, como paywalls e integrações de analytics. O openpurr se concentra no essencial de um backend de assinaturas.",
      },
      {
        q: "Preciso reescrever meu código de compras para sair do RevenueCat?",
        a: "Não. O openpurr funciona com o Purchases SDK oficial, sem modificações. Você define a URL do proxy do SDK como o seu servidor openpurr antes de chamar configure, e o resto do seu código de compras continua igual. Use um domínio próprio para poder trocar de servidor depois sem atualizar o app.",
      },
      {
        q: "Como migro meus clientes atuais do RevenueCat?",
        a: "Importando-os. Peça ao RevenueCat uma exportação de migração, e o openpurr import busca as compras de cada cliente na Apple e no Google e as associa aos mesmos IDs de usuário do app. A nova versão do seu app também envia as compras de cada cliente uma vez, e os dois backends ficam atualizados enquanto as pessoas atualizam o app, então ninguém perde o acesso.",
        link: "Como migrar",
      },
      {
        q: "Posso migrar do Adapty?",
        a: "Sim, com uma atualização do app. O SDK do Adapty não pode ser apontado para outro servidor, então a atualização o substitui pelo Purchases SDK, com o qual o openpurr funciona. Seus produtos continuam os mesmos nas lojas. O openpurr importa seus clientes da App Store a partir da exportação de eventos do Adapty, a nova versão do seu app traz todos os outros na primeira vez que é aberta, e os dois backends ficam atualizados enquanto as pessoas atualizam o app.",
        link: "Leia o guia do Adapty",
        linkTo: "adapty",
      },
      {
        q: "Quais plataformas e lojas o openpurr suporta?",
        a: "O openpurr suporta o Purchases SDK para iOS, Android, Flutter e React Native, com compras da App Store e do Google Play. Amazon e pagamentos na web estão fora do escopo por enquanto.",
      },
      {
        q: "Quanto custa o openpurr?",
        a: "O openpurr é gratuito e de código aberto, sob a licença Apache 2.0. Você paga apenas pela infraestrutura em que ele roda. A edição Lite foi projetada para rodar no plano gratuito da Cloudflare, então um app pequeno pode usá-la sem custo. A edição Standard roda em contêineres na sua própria nuvem, então o custo é a sua conta de nuvem.",
      },
      {
        q: "Onde meus dados ficam armazenados?",
        a: "No seu próprio banco de dados. A edição Lite usa o Cloudflare D1 na sua conta da Cloudflare. A edição Standard usa Postgres no GCP ou na AWS. Você pode consultar, fazer backup e exportar os dados, e nenhum serviço externo fica entre o seu app e os seus clientes.",
      },
      {
        q: "O openpurr envia webhooks como o RevenueCat?",
        a: "Sim. O openpurr envia ao seu backend eventos no formato do RevenueCat, assinados com HMAC-SHA256 e reenviados por cerca de 72 horas em caso de falha, então os handlers de webhooks que você já tem precisam de poucas mudanças ou nenhuma.",
      },
      {
        q: "O que o RevenueCat faz que o openpurr não faz?",
        a: "Paywalls, integrações com ferramentas de analytics de terceiros, Customer Center, moedas virtuais, pagamentos na web, Amazon, eventos de anúncios e um contrato de suporte comercial estão fora do escopo por enquanto. Experimentos de preço já vêm incluídos. Se você precisa dos demais hoje, uma plataforma comercial atende melhor.",
      },
      {
        q: "O openpurr está pronto para produção?",
        a: "Ainda não. O openpurr está no começo: a edição Lite está em andamento e a edição Standard vem depois. Acompanhe o roadmap no GitHub e abra uma issue se algo for importante para você.",
      },
      {
        q: "O openpurr é afiliado ao RevenueCat?",
        a: "Não. O openpurr é um projeto independente de código aberto, não afiliado à RevenueCat, Inc. nem endossado por ela. Ele funciona com o Purchases SDK oficial do RevenueCat, que tem licença MIT.",
      },
    ],
  },
  structured: {
    description:
      "Uma alternativa ao RevenueCat de código aberto e auto-hospedada: um backend para compras no app e assinaturas da App Store e do Google Play que funciona com o Purchases SDK oficial, sem modificações. Ele valida compras, controla entitlements, recebe as notificações das lojas, envia webhooks e gera gráficos de métricas de assinatura.",
    subCategory: "Backend de compras no app e assinaturas",
    features: [
      "Funciona com o Purchases SDK oficial do RevenueCat para iOS, Android, Flutter e React Native",
      "Validação de compras do StoreKit 2 e do Google Play",
      "App Store Server Notifications V2 e Real-time Developer Notifications do Google Play",
      "Webhooks no formato do RevenueCat, assinados com HMAC-SHA256",
      "16 gráficos de assinatura, incluindo MRR, churn e conversão de testes gratuitos",
      "Experimentos de preço em offerings, com resultados por variante",
      "Servidor MCP, CLI e skills do Claude",
    ],
  },
};
