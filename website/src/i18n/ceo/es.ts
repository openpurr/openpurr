// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoEs: CeoDict = {
  meta: {
    title: "El CEO de RevenueCat, Jacob Eiting, publica {perDay} veces al día en X",
    description:
      "El CEO de RevenueCat, Jacob Eiting, publicó {posts} veces en X en 90 días, en {hours} horas distintas al día. Cerca del {pct} menciona RevenueCat. Tu 1 % ayuda a pagarlo.",
    ogImageAlt: "El CEO de RevenueCat publica en X unas 10 veces al día, todos los días. Tu 1 % ayuda a pagarlo.",
  },
  hero: {
    crumb: "El CEO en X",
    eyebrow: "A dónde va tu 1 %",
    headline: "El CEO de RevenueCat, Jacob Eiting, publica en X {perDay} veces al día.",
    headlineAccent: "Tu 1 % ayuda a pagarlo.",
    lede: "En los últimos {days} días, el CEO de RevenueCat, Jacob Eiting ({handle}), publicó {posts} veces en X. Son unas {perDay} publicaciones al día, repartidas en {hours} horas distintas cada día, en {active} de {days} días.",
    updated: "Actualizado el {date} - Contado a partir de publicaciones públicas",
  },
  stats: {
    posts: "publicaciones en {days} días",
    perDay: "publicaciones al día",
    hours: "horas activas al día",
    active: "días con alguna publicación, de {days}",
  },
  calendar: {
    title: "{days} días de publicaciones",
    note: "Cada cuadro es un día. Cuanto más oscuro, más horas de ese día tuvieron alguna publicación.",
    less: "Sin publicaciones",
    more: "Más horas",
    cell: "{date}: {posts} publicaciones en {hours} horas",
  },
  topic: {
    title: "¿Cuánto de eso trata sobre RevenueCat?",
    text: "Según las reglas de abajo, el <b>{pct}</b> de sus publicaciones menciona RevenueCat o su negocio: {onTopic} de {posts}. Las mismas reglas encuentran un {basePct} en las publicaciones de la propia cuenta {base}, así que se les escapan algunas. Aun así, la mayor parte de lo que publica trata de otra cosa.",
    ceo: "Sus publicaciones",
    base: "Publicaciones de {base}",
    about: "Sobre RevenueCat",
  },
  pays: {
    title: "Tu 1 % también paga sus redes sociales",
    text: "RevenueCat se lleva el 1 % de todos tus ingresos en cuanto pasas de {threshold} al mes. Con ese dinero funciona la empresa, incluido lo que paga a su CEO. Así que parte de tu 1 % paga {perDay} publicaciones al día en X.",
    link: "Mira a dónde va el resto de tu 1 % →",
    ctaKeep: "Quédate con tu 1 % →",
    ctaGithub: "openpurr en GitHub",
  },
  faq: {
    title: "Lo que la gente pregunta",
    items: {
      who: {
        q: "¿Quién es el CEO de RevenueCat?",
        a: "Jacob Eiting es cofundador y CEO de RevenueCat. Publica en X como {handle}, donde lo siguen unas {followers} personas.",
      },
      often: {
        q: "¿Con qué frecuencia publica en X el CEO de RevenueCat?",
        a: "En los {days} días hasta el {end}, Jacob Eiting publicó {posts} veces en X, contando respuestas pero no reposts. Son unas {perDay} publicaciones al día, en {hours} horas distintas cada día, en {active} de {days} días.",
      },
      about: {
        q: "¿Sobre qué publica en X el CEO de RevenueCat?",
        a: "Sobre todo, de cosas que no son RevenueCat. Según nuestras reglas de palabras clave, el {pct} de sus publicaciones menciona RevenueCat o su negocio, frente al {basePct} de las publicaciones de la propia cuenta {base}. A las reglas se les escapan algunas publicaciones, así que toma el {pct} como un mínimo.",
      },
      pays: {
        q: "¿La comisión del 1 % de RevenueCat paga a su CEO?",
        a: "En parte. RevenueCat se lleva el 1 % de todos tus ingresos en cuanto pasas de {threshold} al mes, y con ese dinero funciona la empresa, incluido lo que paga a su equipo directivo. RevenueCat no publica cuánto paga a sus directivos.",
      },
    },
  },
  method: {
    title: "Cómo lo contamos",
    posts: "<b>Publicaciones:</b> todas las publicaciones y respuestas públicas de {handle} del {start} al {end}, leídas de la API de X el {checked}. No contamos los reposts, y las publicaciones borradas no se pueden contar.",
    hours: "<b>Horas activas:</b> horas de reloj con al menos una publicación. Publicaciones a las 9:05, 9:40 y 14:10 suman 2 horas activas. Cuenta horas con alguna publicación, no tiempo dedicado. Los días van de medianoche a medianoche, en UTC.",
    rules: "<b>Sobre RevenueCat:</b> una publicación que menciona {accounts}, enlaza a {sites} o usa uno de estos términos: {terms}.",
    limits: "<b>Lo que esto no dice:</b> publicar puede ser parte del trabajo de un CEO, y estas cifras no muestran cuándo trabaja. Muestran con qué frecuencia publica y sobre qué.",
    data: "<b>Datos:</b> solo guardamos recuentos, nada del texto de las publicaciones. El script que los contó está {script}.",
    scriptLink: "en nuestro repositorio",
    affiliation: "<b>Sin afiliación:</b> openpurr no está afiliado a RevenueCat.",
  },
};
