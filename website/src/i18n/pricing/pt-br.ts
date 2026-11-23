// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingPtBr: PricingDict = {
  meta: {
    title: "Preço do RevenueCat: para onde vai o seu 1% · openpurr",
    description:
      "O RevenueCat cobra 1% da sua receita. Os servidores do seu app custam uma ninharia. Veja o que o resto paga: salários, vendas e investidores de risco.",
    ogImageAlt: "O RevenueCat fica com 1% da sua receita; os servidores custam uma ninharia. O que o resto paga.",
  },
  hero: {
    crumb: "Preço do RevenueCat",
    eyebrow: "Para onde vai o seu 1%",
    headline: "Você não está pagando por servidores.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Está pagando por uma empresa de {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "O RevenueCat fica com 1% de toda a sua receita rastreada assim que você passa de {threshold} por mês, e a conta cresce junto com você. Os servidores do seu app custam uma ninharia. O resto paga a empresa: a folha de pagamento, o time de vendas e o retorno dos investidores.",
    updated: "Atualizado em {date} · Estimativas a partir de dados públicos",
  },
  answer: {
    title: "O preço do RevenueCat em uma linha",
    /** HTML. {threshold} is "$2,500". */
    text: "Grátis abaixo de {threshold} de receita rastreada por mês; depois, <strong>1% de tudo</strong>. Quanto isso dá em um ano, ao lado do custo dos servidores para o mesmo app:",
    colRevenue: "Receita mensal",
    colFee: "RevenueCat, por ano",
    colServers: "Servidores, por ano",
  },
  calc: {
    revenue: "Receita mensal do seu app",
    fee: "O RevenueCat fica com",
    servers: "Os servidores custam, de fato",
    perYear: "por ano",
    stackLabel: "Sua taxa anual, dividida entre servidores e as equipes do RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Servidores: {servers}. Todo o resto, {rest}, paga as equipes deles:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Cerca de {people} pessoas · salário típico de {salary}",
    ownersTitle: "E mais da metade disso engorda o exit de outra pessoa",
    /** {pct} is like "55%". */
    ownersInvestors: "Investidores de risco · cerca de {pct}",
    ownersRest: "Fundadores e funcionários",
    ownersBarLabel: "Investidores de risco detêm cerca de {pct} do RevenueCat, pela nossa estimativa",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Investidores de risco já colocaram cerca de {funding} no RevenueCat em cinco rodadas e, pelas avaliações divulgadas, são donos de mais da metade da empresa. Eles não precisam de uma fatia de cada pagamento. Cada taxa que você paga valoriza a empresa que é deles, e eles embolsam quando ela for vendida. Em termos de participação, cerca de {vc} do que você paga por ano vira retorno para eles.",
    investorsLabel: "Os investidores do RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "Seu 1% compra cerca de {days} dias de engenheiro por ano no RevenueCat. Fazer o mesmo trabalho por conta própria custa {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Fique com os outros {keep}.",
    ctaKeep: "Fique com o seu 1% →",
    ctaGithub: "openpurr no GitHub",
  },
  teams: {
    eng: { name: "Engenharia", basis: "Vaga de engenheiro sênior de SDK, US$ 212 mil" },
    product: { name: "Produto, design e dados", basis: "Vagas de gerente de produto sênior, US$ 230 mil; cientista de dados sênior, US$ 220 mil" },
    sales: { name: "Vendas", basis: "Vaga de Head of Sales, US$ 363 mil; engenheiro de vendas sênior, US$ 200 mil; especialista de produto, US$ 133 mil" },
    growth: { name: "Marketing e crescimento", basis: "Vaga de Head of Customer Growth, US$ 259 mil; designer de CRO, US$ 205 mil; marketing de produto, US$ 168 mil" },
    support: { name: "Sucesso do cliente e suporte", basis: "Vaga de engenheiro de suporte a desenvolvedores, US$ 118 mil" },
    community: { name: "Relações com desenvolvedores e comunidade", basis: "A mediana geral das vagas, cerca de US$ 215 mil, com desconto pela mistura de níveis" },
    ops: { name: "Operações, finanças e pessoas", basis: "Vaga de especialista em vendas e operações, US$ 167 mil; Head of People, US$ 280 mil" },
    exec: { name: "Executivos", basis: "Acima da vaga de Head of Sales (US$ 363 mil) para alguns, abaixo para outros" },
  },
  faq: {
    title: "O que as pessoas perguntam",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "Quanto custa o RevenueCat?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "O plano Pro do RevenueCat é gratuito abaixo de {threshold} de receita rastreada por mês. A partir daí, custa 1% de toda ela, não só da parte acima de {threshold}: {at10k} por ano para um app que fatura {m10k} por mês, {at100k} por ano com {m100k} por mês. Contas grandes podem negociar preços Enterprise.",
      },
      pays: {
        q: "O que a taxa de 1% do RevenueCat paga?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Principalmente a empresa. Os servidores por trás de um app típico custam poucos dólares por mês: {servers} por ano para um app que fatura {m25k} por mês, contra {fee} em taxas. O resto paga uma equipe de cerca de {people} pessoas, incluindo engenharia, vendas, marketing e executivos, e gera valor para os investidores da empresa.",
      },
      owns: {
        q: "Quem é dono do RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "O RevenueCat captou cerca de {funding} de investidores de risco em cinco rodadas, entre eles {investors}. Compondo as avaliações divulgadas de cada rodada, os investidores detêm cerca de {pct} da empresa, pela nossa estimativa. O resto pertence aos fundadores e funcionários.",
      },
      worth: {
        q: "Quanto vale o RevenueCat?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "Segundo a imprensa, o RevenueCat foi avaliado em {valuation} quando captou sua Série C de {round} em 2025, com cerca de {revenue} de receita anual na época. São números da imprensa e de analistas, não divulgados pela empresa.",
      },
      alternative: {
        q: "Existe uma alternativa ao RevenueCat sem comissão sobre a receita?",
        a: "Sim. O openpurr é um backend gratuito, de código aberto e auto-hospedado que funciona com o Purchases SDK oficial do RevenueCat. Você aponta a URL do proxy do SDK para o seu próprio servidor e mantém o seu código de compras. Para apps pequenos, ele roda no plano gratuito da Cloudflare, sem comissão sobre a receita e sem taxas por transação.",
      },
    },
  },
  more: {
    title: "Sim, eles fazem mais",
    text: "O RevenueCat oferece mais do que um backend de compras: paywalls, experimentos, integrações, suporte. Se você usa tudo isso, talvez valha a pena para você. Se o que você precisa é validar compras e manter as assinaturas em dia, está entregando uma fatia de tudo o que vai faturar na vida por um trabalho que roda com alguns dólares de servidor por mês.",
  },
  method: {
    title: "Como estimamos",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Sua taxa:</b> o preço de tabela do plano Pro do RevenueCat, 1% da receita mensal rastreada a partir de {threshold}. Contas grandes podem negociar outros preços.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Servidores:</b> quanto o openpurr Lite custa na Cloudflare para um app com essa receita, o mesmo modelo da nossa {calculator}. Os custos de hospedagem do próprio RevenueCat não são públicos; este é o custo do trabalho quando você mesmo o executa.",
    calculatorLink: "calculadora de economia",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Equipes:</b> funções, não pessoas. Supomos {used} pessoas (as estimativas públicas vão de {low} a {high}) e nós mesmos as distribuímos entre as funções. Os salários vêm das vagas públicas do RevenueCat, que informam a remuneração; o custo de cada equipe é pessoas × salário × {loaded} para impostos, benefícios e equipamentos, sem equity. A parte da sua taxa que não vai para servidores é dividida na proporção desses custos.",
    split:
      "<b>Por que vendas e crescimento superam engenharia:</b> em {date}, a página de vagas do RevenueCat listava {open} vagas abertas: {gtm} em vendas, marketing e crescimento, e {eng} em engenharia central. Uma empresa nesse estágio está montando seu go-to-market, e a nova vaga de Head of Sales é a mais bem paga da página.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Investidores:</b> cinco rodadas de 2018 a 2025, cerca de {funding} no total. A participação não é pública, então a calculamos compondo as avaliações divulgadas: os investidores de cada rodada ficam com o valor dividido pela avaliação post-money, e todos os anteriores são diluídos na mesma proporção. Isso dá cerca de {pct}. Option pools e a participação da aceleradora Y Combinator não entram na conta. A fatia deles é do valor da empresa, não uma linha nos custos, por isso aparece separada. Na rodada de 2025, a empresa tinha, segundo a imprensa, cerca de {revenue} de receita anual, perto do break-even.",
    colRound: "Rodada",
    colRaised: "Captado",
    colValuation: "Avaliação",
    colLead: "Liderada por",
    notReported: "não divulgado",
    /** HTML. */
    affiliation: "<b>Sem vínculo:</b> o openpurr não tem vínculo com o RevenueCat. Estas são estimativas nossas, não números do RevenueCat.",
    assumptions: "As premissas, equipe por equipe",
    colTeam: "Equipe",
    colPeople: "Pessoas",
    colSalary: "Salário",
    colCost: "Custo anual",
    colBasis: "Salário com base em",
  },
  sources: {
    title: "Fontes",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "Preços do RevenueCat: 1% da receita mensal rastreada a partir de US$ 2.500",
      "Vagas do RevenueCat, com faixas salariais (Ashby)",
      "Vagas anteriores do RevenueCat com salário (Greenhouse)",
      "TechCrunch: RevenueCat capta US$ 50 milhões e chega a US$ 100 milhões no total (maio de 2025)",
      "TechCrunch: a Série B de US$ 40 milhões, liderada pelo Continuity Fund da Y Combinator, com avaliação de US$ 300 milhões (2021)",
      "TechCrunch: uma Série C de US$ 12 milhões liderada pela Adjacent (2024)",
      "SaaStr: a rodada seed de 2018 com avaliação de US$ 7 milhões, e as rodadas seguintes",
      "Multiples.vc: cerca de US$ 30 milhões de receita e avaliação de US$ 500 milhões na rodada de 2025 (estimativas)",
      "Estimativas de número de funcionários: TipRanks (185)",
      "Estimativas de número de funcionários: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Verificado em {date}. Viu algo desatualizado? {issue}.",
    issueLink: "Abra uma issue",
  },
};
