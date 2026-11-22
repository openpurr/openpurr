// Brazilian Portuguese copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migratePtBr: MigrateDict = {
  meta: {
    title: "Como migrar do RevenueCat para o openpurr, passo a passo",
    description:
      "Migre seu app do RevenueCat para o openpurr, a alternativa ao RevenueCat de código aberto: mantenha o Purchases SDK, importe os assinantes e preserve o acesso.",
    ogImageAlt:
      "Migre do RevenueCat para o openpurr sem perder nenhum assinante: mantenha o Purchases SDK, importe todos os clientes e as versões antigas do app continuam funcionando.",
  },
  hero: {
    crumb: "Migrar do RevenueCat",
    eyebrow: "Guia de migração",
    headline: "Migre do RevenueCat para o openpurr sem perder nenhum assinante",
    lede: "Mantenha o Purchases SDK que o seu app já usa. Importe seus clientes atuais a partir da exportação do RevenueCat: o próprio openpurr busca cada compra na Apple e no Google. As versões antigas do app continuam funcionando enquanto as pessoas atualizam.",
    guide: "Leia o guia passo a passo (em inglês)",
    steps: "Ver as etapas",
    updated: "Atualizado em {date}",
  },
  summary: {
    title: "Em resumo",
    items: [
      "openpurr é uma alternativa ao RevenueCat auto-hospedada e de código aberto. Ele funciona com o Purchases SDK oficial do RevenueCat, sem modificações.",
      "Seu app ganha uma linha (a URL do proxy do SDK) e uma chamada única a <code>syncPurchases</code>. O resto do seu código de compras continua igual.",
      "<code>openpurr import</code> traz os clientes atuais a partir da exportação do RevenueCat. As compras em si são buscadas na Apple e no Google, não copiadas.",
      "Apps da App Store podem usar o Scheduled Data Export do RevenueCat. O Google Play exige uma exportação de migração do suporte do RevenueCat, a única que inclui os purchase tokens.",
      "Os dois backends ficam atualizados até que a maioria das pessoas tenha atualizado o app, então ninguém perde o acesso.",
      "No plano gratuito da Cloudflare, a importação processa cerca de 2.500 clientes por dia. No Workers Paid, uma importação grande leva algumas horas.",
    ],
  },
  how: {
    eyebrow: "Como funciona",
    title: "Como funciona uma migração do RevenueCat",
    lede: "O openpurr não copia registros de compras do RevenueCat. Ele só precisa saber quem é o dono de cada compra e depois consulta as lojas, exatamente como faz quando o seu app envia uma compra.",
    ways: [
      {
        title: "A importação",
        body: "A exportação do RevenueCat informa qual usuário do app é dono de cada compra na loja. <code>openpurr import</code> consulta cada compra na Apple e no Google e registra a resposta da loja para esse usuário. Ele traz todo mundo de uma vez, inclusive quem nunca mais abre o app.",
      },
      {
        title: "A atualização do app",
        body: "A nova versão aponta o Purchases SDK para o openpurr e envia as compras de cada cliente uma vez com <code>syncPurchases</code>. Isso cobre quem ficou fora da exportação e quem comprou depois que ela foi gerada.",
      },
      {
        title: "Os dois backends, por um tempo",
        body: "As versões antigas do app continuam falando com o RevenueCat até as pessoas atualizarem. O RevenueCat encaminha as notificações da Apple para o openpurr, e uma segunda assinatura do Pub/Sub faz o mesmo com o Google, então os dois ficam atualizados.",
      },
    ],
  },
  app: {
    eyebrow: "No seu app",
    title: "O que muda no seu app",
    lede: "Defina a URL do proxy antes de configure e envie as compras de cada cliente uma vez. As mesmas duas mudanças valem para Android, Flutter e React Native; o guia traz o código de cada um.",
    codeLabel: "Exemplo em Swift: a URL do proxy e uma sincronização única",
    proxyComment: "Antes de configure(): a única linha que a maioria dos apps adiciona",
    syncComment: "Uma vez por instalação: envia as compras deste cliente ao openpurr",
  },
  import: {
    eyebrow: "A importação",
    title: "Como importar clientes do RevenueCat",
    lede: "A CLI do openpurr lê as colunas do RevenueCat como elas vêm: IDs de usuário do app, IDs de transação da App Store, purchase tokens do Google Play e atributos como <code>$email</code>.",
    codeLabel: "Terminal: importando a exportação do RevenueCat",
    dryRunComment: "Confira as primeiras linhas: consulta Apple e Google, não grava nada",
    importComment: "Importe todos. Pare quando quiser; rode de novo para continuar.",
    safeguards: [
      ["Ninguém perde o acesso", "Uma compra que o app já enviou para um cliente continua sendo dele; a importação nunca a move."],
      ["Sem webhooks duplicados", "Compras importadas não são novas, então o openpurr não envia eventos para elas."],
      ["Gráficos fiéis", "Clientes importados são datados pela primeira compra, e não contados como novos no dia da importação."],
      ["Seu app continua funcionando", "No plano gratuito da Cloudflare, a importação para em 90% de um limite diário e continua no dia seguinte."],
      ["Pare e retome", "O progresso fica salvo. Importar uma linha duas vezes não muda nada, então dá para rodar de novo uma exportação mais recente."],
      ["Teste antes", "Uma simulação (dry run) consulta as lojas e mostra o que aconteceria, sem gravar nada."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Passo a passo",
    title: "Como migrar do RevenueCat em sete etapas",
    lede: "Os dois backends continuam rodando até você estar pronto para fazer a troca, então clientes em versões antigas do app mantêm o acesso.",
    items: [
      {
        title: "Configure o openpurr",
        body: "Implante o openpurr Lite na sua conta da Cloudflare, dê a ele acesso às APIs da App Store e do Google Play, e recrie seus produtos, entitlements e offerings com os mesmos identificadores. Você pode até manter as chaves públicas de SDK do RevenueCat.",
      },
      {
        title: "Mantenha os dois backends informados",
        body: "Defina o openpurr como a Apple Server Notification Forwarding URL do RevenueCat e adicione a assinatura push do openpurr ao seu tópico de notificações do Play.",
      },
      {
        title: "Obtenha sua exportação",
        body: "Só App Store: o Scheduled Data Export do RevenueCat tem o que é preciso. Com Google Play, peça ao suporte do RevenueCat uma exportação de migração, já que só ela inclui os purchase tokens. O guia traz um pedido que você pode copiar.",
      },
      { title: "Importe", body: "Rode <code>openpurr import</code>, primeiro com uma simulação. Problemas em linhas isoladas vão para um relatório e não interrompem a importação." },
      { title: "Publique a atualização do app", body: "Adicione a URL do proxy e uma chamada única a <code>syncPurchases</code>. Publique depois que a importação terminar." },
      {
        title: "Verifique",
        body: "<code>openpurr doctor</code> verifica a configuração. Consulte clientes que você conhece e compare as assinaturas ativas com os gráficos do RevenueCat.",
      },
      {
        title: "Conclua a troca",
        body: "Quando a maioria dos clientes tiver atualizado, aponte a Apple e o Google diretamente para o openpurr, ative os webhooks do openpurr e desative os do RevenueCat.",
      },
    ],
    source: "Fonte:",
    sourceNotifications: "RevenueCat: notificações de servidor da Apple (em inglês)",
    sourceExports: "RevenueCat: exportar dados ou migrar para outro serviço (em inglês)",
    more: "Todos os comandos e configurações estão no guia completo (em inglês) →",
  },
  moves: {
    eyebrow: "O que é migrado",
    title: "O que é migrado do RevenueCat e o que não é",
    rows: [
      ["Assinaturas e compras, com renovações, reembolsos, períodos de carência e expiração", "Sim, buscadas na Apple e no Google"],
      ["Quem é dono de cada compra", "Sim, a partir da exportação do RevenueCat"],
      ["IDs de usuário do app, inclusive os anônimos", "Sim, sem alterações"],
      ["Atributos de clientes ($email, $displayName e os seus próprios)", "Sim, a partir de um Audience export"],
      ["Produtos, entitlements e offerings", "Você os recria, com os mesmos identificadores"],
      ["Histórico de gráficos anterior à troca", "Em parte: guarde os CSVs de gráficos do RevenueCat para os seus registros"],
      ["Experimentos", "Você os recria: o openpurr roda experimentos de preço nos seus offerings"],
      ["Paywalls, integrações, Customer Center", "Não: o openpurr não tem esses recursos"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Perguntas frequentes sobre migrar do RevenueCat",
    items: [
      {
        q: "Preciso mudar meu código de compras?",
        a: "Não. O openpurr funciona com o Purchases SDK oficial do RevenueCat, sem modificações. A atualização do app adiciona a URL do proxy antes de configure e uma chamada única a syncPurchases. getOfferings, purchase, restorePurchases, logIn e o resto continuam iguais.",
      },
      {
        q: "Preciso da ajuda do RevenueCat para migrar?",
        a: "Para apps da App Store, não: o Scheduled Data Export do RevenueCat tem os IDs de transação de que o openpurr precisa. Para o Google Play, sim: segundo a documentação do RevenueCat, só uma exportação de migração preparada pelo suporte do RevenueCat inclui os purchase tokens que o Google exige.",
      },
      {
        q: "E os clientes que nunca atualizam o app?",
        a: "A importação cobre esses clientes: as compras deles são buscadas na Apple e no Google e associadas aos mesmos IDs de usuário do app. Enquanto eles estiverem em uma versão antiga, essa versão fala com o RevenueCat, e é por isso que os dois backends ficam informados até a maioria das pessoas atualizar.",
      },
      {
        q: "Quanto tempo leva uma importação?",
        a: "Cada cliente gera cerca de 30 gravações de linhas no banco de dados. No plano gratuito da Cloudflare, isso dá cerca de 2.500 clientes por dia, e a importação pausa sozinha ao atingir o limite diário e retoma no dia seguinte. No Workers Paid (US$ 5 por mês), uma importação grande leva algumas horas.",
      },
      {
        q: "Meus dados são copiados do RevenueCat?",
        a: "Só a associação entre usuários do app e compras nas lojas, além dos atributos, se você importá-los. As compras em si vêm diretamente da Apple e do Google, então o openpurr registra o estado atual segundo as lojas, com renovações e reembolsos incluídos.",
      },
    ],
  },
  cta: {
    title: "Pronto para trocar?",
    body: "O guia explica cada etapa. Se algo na sua configuração não se encaixar, abra uma issue: as migrações definem o que será construído a seguir.",
    guide: "Leia o guia (em inglês)",
    github: "openpurr no GitHub",
    issue: "Abra uma issue",
  },
};
