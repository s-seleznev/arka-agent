const searchStopWords = new Set([
  "a",
  "an",
  "are",
  "for",
  "in",
  "list",
  "me",
  "my",
  "of",
  "please",
  "show",
  "the",
  "to",
  "which",
  "with",
  "а",
  "в",
  "во",
  "где",
  "дай",
  "для",
  "есть",
  "же",
  "и",
  "из",
  "или",
  "как",
  "какие",
  "каких",
  "которых",
  "которые",
  "ли",
  "мне",
  "меня",
  "мои",
  "моих",
  "моей",
  "мой",
  "на",
  "найди",
  "найти",
  "надо",
  "нужно",
  "о",
  "об",
  "по",
  "пожалуйста",
  "покажи",
  "показать",
  "с",
  "со",
  "сделай",
  "составить",
  "список",
  "списки",
  "списка",
  "у",
  "что",
  "это",
  "аркаша",
]);
const animalSearchWords = new Set([
  "животные",
  "животных",
  "животного",
  "голов",
  "головы",
  "коров",
  "коровы",
  "корова",
  "коровам",
  "телок",
  "телки",
  "телка",
  "телят",
  "быков",
  "быки",
]);

// Literal bilingual retrieval vocabulary; never field or formula bindings.
const englishSearchTerms: Readonly<Record<string, string>> = {
  calving: "отел",
  cow: "корова",
  cows: "коровы",
  evaluation: "оценка",
  genomic: "геномная",
  heifer: "телка",
  heifers: "телки",
  inseminated: "осемененные",
  insemination: "осеменение",
  milk: "молоко",
  not: "не",
  pregnancy: "стельность",
  pregnant: "стельная",
  weight: "вес",
  without: "без",
};

/** Retrieval terms never define rule conditions or resolve an ambiguous intent. */
export function prepareRuleSearch(query: string) {
  const phrase = query
    .normalize("NFC")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/\s+/gu, " ")
    .trim();
  const expansions: string[] = [];
  const translatedPhrase = phrase
    .replace(/\bdry off\b/gu, "запуск")
    .replace(/\bmilk yield\b/gu, "надой")
    .replace(/\bfor insemination\b/gu, "на осеменение")
    .replace(/[\p{L}]+/gu, (term) =>
      Object.hasOwn(englishSearchTerms, term) ? englishSearchTerms[term] : term
    );
  if (translatedPhrase !== phrase) {
    expansions.push(
      `${phrase} -> ${translatedPhrase} (retrieval translation only)`
    );
  }
  const terms = [
    ...new Set(
      (translatedPhrase.match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (term) => !searchStopWords.has(term)
      )
    ),
  ];
  const phrases = [
    ...translatedPhrase.matchAll(/(?:^| )((?:на|под|без|не) [\p{L}]+)/gu),
  ].map((match) => match[1]);
  // Colloquial phrase is ambiguous: broaden candidates, never assert equivalence.
  if (/(?:^| )на семя(?: |$)/u.test(phrase)) {
    terms.push("осеменение");
    phrases.push("на осеменение");
    expansions.push(
      "на семя -> осеменение (retrieval only; intent unresolved)"
    );
  }
  const primary = terms.filter(
    (term) => !animalSearchWords.has(term) && !["не", "без"].includes(term)
  );
  const requiredTerms = primary.length ? primary : terms;
  return {
    expansions,
    fullTsquery: [...new Set(terms)].join(" | "),
    phrase,
    phrases,
    terms,
    translatedPhrase,
    tsquery: [...new Set(requiredTerms)].join(" | "),
  };
}
