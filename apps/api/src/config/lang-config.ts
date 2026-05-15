/** Mirrors aptos-translateai/config/settings.py LANG_CONFIG — keys are internal language codes. */
export type LangEntry = {
  name: string;
  context: string;
  ai_hints?: string[];
  ai_hints_reference?: string;
};

export const LANG_CONFIG: Record<string, LangEntry> = {
  spanish: {
    name: 'Spanish',
    context: 'business software users in Spanish-speaking markets',
  },
  korean: {
    name: 'Korean',
    context: 'business software users in Korean markets',
  },
  hindi: {
    name: 'Hindi',
    context: 'business software users in Hindi markets',
  },
  french: {
    name: 'French',
    context: 'business software users in French-speaking markets',
  },
  german: {
    name: 'German',
    context: 'business software users in German-speaking markets',
  },
  italian: {
    name: 'Italian',
    context: 'business software users in Italian-speaking markets',
  },
  portuguese: {
    name: 'Portuguese',
    context: 'business software users in Portuguese-speaking markets',
  },
  chinese: {
    name: 'Chinese (Simplified)',
    context: 'business software users in Chinese markets',
  },
  japanese: {
    name: 'Japanese',
    context: 'business software users in Japanese markets',
  },
  dutch: {
    name: 'Dutch',
    context: 'business software users in Dutch-speaking markets',
  },
  russian: {
    name: 'Russian',
    context: 'business software users in Russian-speaking markets',
  },
  arabic: {
    name: 'Arabic',
    context: 'business software users in Arabic-speaking markets',
  },
  turkish: {
    name: 'Turkish',
    context: 'business software users in Turkish-speaking markets',
  },
  polish: {
    name: 'Polish',
    context: 'business software users in Polish-speaking markets',
  },
  swedish: {
    name: 'Swedish',
    context: 'business software users in Swedish-speaking markets',
  },
  norwegian: {
    name: 'Norwegian',
    context: 'business software users in Norwegian-speaking markets',
  },
  danish: {
    name: 'Danish',
    context: 'business software users in Danish-speaking markets',
  },
  czech: {
    name: 'Czech',
    context: 'business software users in Czech-speaking markets',
  },
  greek: {
    name: 'Greek',
    context: 'business software users in Greek-speaking markets',
  },
  canadian_english: {
    name: 'Canadian English',
    context: 'business software users in Canadian English-speaking markets',
  },
  canadian_french: {
    name: 'Canadian French (Québécois)',
    context:
      'business software users in Quebec and Canadian French-speaking markets',
    ai_hints_reference: `French Canadian Translation Glossary
| English Term (Original String) | Correct French Term (Suggestion by locals) | Context/Rule to Apply |
| Tender (as in payment)         | Paiement                                  | Use for any method of payment (cash, card, voucher). Do not use Appel d'offres. |
| Discount                       | Rabais                                    | Use for price reduction. Do not use Remise (which often means 'delivery' or 'handing over'). |
| Voucher                        | Bon d'achat                               | Use for a certificate that can be redeemed for goods. |
`,
  },
  british_english: {
    name: 'British English',
    context: 'business software users in British English-speaking markets',
  },
  american_english: {
    name: 'American English',
    context: 'business software users in American English-speaking markets',
  },
};
