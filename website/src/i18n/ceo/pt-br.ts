// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoPtBr: CeoDict = {
  meta: {
    title: "O CEO do RevenueCat posta no X {perDay} vezes por dia - openpurr",
    description:
      "Em 90 dias, o CEO do RevenueCat postou {posts} vezes no X, em {hours} horas diferentes por dia. Cerca de {pct} cita o RevenueCat. Seu 1% banca a empresa que ele comanda.",
    ogImageAlt: "O CEO do RevenueCat posta no X cerca de 10 vezes por dia, todo dia. Seu 1% banca a empresa que ele comanda.",
  },
  hero: {
    crumb: "O CEO no X",
    eyebrow: "Para onde vai o seu 1%",
    headline: "O CEO do RevenueCat posta no X {perDay} vezes por dia.",
    headlineAccent: "Seu 1% banca a empresa que ele comanda.",
    lede: "Nos últimos {days} dias, o CEO do RevenueCat, Jacob Eiting ({handle}), postou {posts} vezes no X. São cerca de {perDay} posts por dia, espalhados por {hours} horas diferentes por dia, em {active} de {days} dias.",
    updated: "Atualizado em {date} - Contado a partir de posts públicos",
  },
  stats: {
    posts: "posts em {days} dias",
    perDay: "posts por dia",
    hours: "horas ativas por dia",
    active: "dias com post, de {days}",
  },
  calendar: {
    title: "{days} dias de posts",
    note: "Cada quadrado é um dia. Quanto mais escuro, mais horas daquele dia tiveram algum post.",
    less: "Nenhum post",
    more: "Mais horas",
    cell: "{date}: {posts} posts em {hours} horas",
  },
  topic: {
    title: "Quanto disso é sobre o RevenueCat?",
    text: "Pelas regras abaixo, <b>{pct}</b> dos posts dele citam o RevenueCat ou o negócio da empresa: {onTopic} de {posts}. As mesmas regras encontram {basePct} nos posts do próprio {base}, então deixam alguns passar. Mesmo assim, a maior parte do que ele posta é sobre outra coisa.",
    ceo: "Posts dele",
    base: "Posts de {base}",
    about: "Sobre o RevenueCat",
  },
  pays: {
    title: "O que o seu 1% paga",
    text: "O RevenueCat fica com 1% de toda a sua receita assim que você passa de {threshold} por mês. Esse dinheiro mantém a empresa, dos servidores à liderança.",
    link: "Veja para onde vai o resto do seu 1% →",
    ctaKeep: "Fique com o seu 1% →",
    ctaGithub: "openpurr no GitHub",
  },
  method: {
    title: "Como contamos",
    posts: "<b>Posts:</b> todos os posts e respostas públicos de {handle} de {start} a {end}, lidos pela API do X em {checked}. Reposts não entram na conta, e posts apagados não têm como entrar.",
    hours: "<b>Horas ativas:</b> horas cheias do relógio com pelo menos um post. Posts às 9:05, 9:40 e 14:10 somam 2 horas ativas. Conta horas com post, não tempo gasto. Os dias vão de meia-noite a meia-noite, em UTC.",
    rules: "<b>Sobre o RevenueCat:</b> um post que cita {accounts}, tem link para {sites} ou usa um destes termos: {terms}.",
    limits: "<b>O que isto não diz:</b> postar pode fazer parte do trabalho de um CEO, e estes números não mostram quando ele trabalha. Mostram com que frequência ele posta, e sobre o quê.",
    data: "<b>Dados:</b> guardamos só contagens, nenhum texto dos posts. O script que fez a contagem está {script}.",
    scriptLink: "no nosso repositório",
    affiliation: "<b>Sem vínculo:</b> o openpurr não tem vínculo com o RevenueCat.",
  },
};
