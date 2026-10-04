import type { CEFRLevel, PlacementItem, PlacementRoleplayScript, PlacementSpeakingPrompt } from './types';
import type { StrategyMoveId } from '../strategy-moves';

/**
 * Placement test v2 — open speaking prompts and scripted work roleplays (bank v1).
 * Pure data, no server imports. Speaking and roleplay answers are rated by Sol in the single scoring call.
 * Parallel versions of the audit's calibration anchors (planning/v05/audit-product.md, Appendix A):
 * same construct and level, new context — no anchor text is served. Names and companies are fictional.
 */

type PromptLevel = Exclude<CEFRLevel, 'A1' | 'C2'>;

/** Prep / min / max seconds per task level (audit A.4). B2 and C1 add an unprepared follow-up (0 s prep). */
export const SPEAKING_TIMING: Record<PromptLevel, { prepSeconds: number; minSeconds: number; maxSeconds: number }> = {
  A2: { prepSeconds: 10, minSeconds: 20, maxSeconds: 45 },
  B1: { prepSeconds: 20, minSeconds: 30, maxSeconds: 60 },
  B2: { prepSeconds: 30, minSeconds: 40, maxSeconds: 75 },
  C1: { prepSeconds: 30, minSeconds: 50, maxSeconds: 90 },
};
export const FOLLOW_UP_MAX_SECONDS = 40;

function task(id: string, level: PromptLevel, instruction: string, prompt: string, followUp?: string): PlacementSpeakingPrompt {
  const item: PlacementSpeakingPrompt = { id, level, kind: 'task', instruction, prompt, ...SPEAKING_TIMING[level] };
  if (followUp) item.followUp = { prompt: followUp, maxSeconds: FOLLOW_UP_MAX_SECONDS };
  return item;
}

/** 3 prompts per level A2–C1 (parallel forms for resumes and retakes), then one optional read-aloud warm-up. */
export const SPEAKING_PROMPTS: PlacementSpeakingPrompt[] = [
  task('sp-a2-01', 'A2', "Расскажи, как обычно проходят твои выходные.",
    "How do you usually spend your weekends? Tell me about a normal Saturday or Sunday for you."),
  task('sp-a2-02', 'A2', "Опиши место в своём городе, которое тебе нравится.",
    "Tell me about a café, a park or another place in your city that you like. Where is it, and why do you go there?"),
  task('sp-a2-03', 'A2', "Расскажи, какими программами ты пользуешься в работе.",
    "What programs or tools do you use for your work? Which one do you use most, and why?"),

  task('sp-b1-01', 'B1', "Расскажи о проекте, которым гордишься, и объясни почему.",
    "Describe a piece of work you're proud of. What did you do, what was difficult, and why are you proud of the result?"),
  task('sp-b1-02', 'B1', "Расскажи о поездке, которая что-то изменила в твоих взглядах.",
    "Tell me about a trip that changed how you see something. Where did you go, what happened, and what changed for you?"),
  task('sp-b1-03', 'B1', "Дай советы другу, который переезжает в твой город.",
    "A friend is about to move to your current city. How should they look for an apartment, and how can they meet people quickly? Give them some practical tips."),

  task('sp-b2-01', 'B2', "Сравни ИИ-видео и классическое 3D для коммерческих проектов и дай рекомендацию.",
    "Compare AI video and traditional 3D for commercial projects. What are the strengths and weaknesses of each, and when would you recommend one over the other?",
    "But if AI is faster and cheaper, why would any client still pay for 3D?"),
  task('sp-b2-02', 'B2', "Выскажи и обоснуй своё мнение о соцсетях после переезда.",
    "Some people say social media makes moving abroad easier, because you can stay close to friends back home. Others say it stops you from settling in. What's your view?",
    "Wouldn't it be easier to just switch your phone off for the first month?"),
  task('sp-b2-03', 'B2', "Обоснуй, что лучше — снимать жильё или покупать, если ты можешь снова переехать.",
    "If you might move again in a few years, is it better to rent or to buy a home? Argue your position.",
    "But isn't paying rent just throwing money away?"),

  task('sp-c1-01', 'C1', "Ответь клиенту, который хочет всю кампанию вдвое быстрее и вдвое дешевле, как на настоящем звонке.",
    "Imagine a client tells you: \"We love your work, but we need the whole campaign in half the time and for half the budget.\" Respond as you would on a real call. Keep the relationship, but protect your interests.",
    "Come on, other creators would jump at this. Why should we pay more for you?"),
  task('sp-c1-02', 'C1', "Взвесь, кому выгодны и кому вредны ограничения на краткосрочную аренду жилья.",
    "Some cities are limiting short-term rentals to protect local residents. Weigh up who gains and who loses from rules like this, and say where you stand.",
    "But isn't that just punishing visitors for a housing problem the city created?"),
  task('sp-c1-03', 'C1', "Порассуждай, меняет ли переезд за границу самого человека.",
    "Some say moving abroad changes who you are; others say you simply take yourself with you. Which view is closer to your experience, and why might both be partly true?",
    "Then why do so many people call moving the best decision of their lives?"),

  { id: 'sp-ra-01', level: 'B1', kind: 'read-aloud', prepSeconds: 5, minSeconds: 10, maxSeconds: 30,
    instruction: "Прочитай текст вслух в обычном темпе: это проверка микрофона и твоего темпа чтения.",
    prompt: "Every Saturday morning, the market in the old town fills up with farmers from nearby villages. They sell fresh bread, cheese, honey and vegetables, usually at better prices than the supermarkets. Last summer the city added a small stage, so now there is live music until noon. Most people come early, before the best things are gone." },
];

/** Prepared speaking tasks for one level (the read-aloud warm-up is excluded). */
export function speakingPromptsFor(level: PromptLevel): PlacementSpeakingPrompt[] {
  return SPEAKING_PROMPTS.filter(prompt => prompt.level === level && prompt.kind !== 'read-aloud');
}

/** Upper limit for one live roleplay answer (audit §2.7). */
export const ROLEPLAY_ANSWER_MAX_SECONDS = 45;

/**
 * Three parallel work roleplays; the first attempt uses 'rp-agency-01'. Each line is robust to any answer and opens
 * specific strategy moves (ROLEPLAY_MOVES). Rubric lines are scorer hints and are never shown before answering.
 */
export const ROLEPLAY_SCRIPTS: PlacementRoleplayScript[] = [
  {
    id: 'rp-agency-01',
    title: "Первый созвон с агентством",
    setup: "Вводный созвон с продюсером креативной студии в Амстердаме: они знакомятся с авторами, чтобы знать, кому звонить, когда придёт подходящий бриф.",
    partnerRole: "Sanne, producer at a small Amsterdam studio that creates computer-generated and AI-assisted films for fashion and lifestyle labels",
    lines: [
      "Hi, lovely to meet you, and thanks for finding the time! I'm Sanne, one of the producers at a small studio here in Amsterdam. Our work is mostly computer-generated and AI-assisted films for fashion and lifestyle labels. Today's really just a get-to-know-you chat, so that when a suitable project comes up, we already know each other. Could you walk me through who you are and what you do?",
      "Great. Have brands hired you directly yet? Tell me about the latest one and, ballpark, what kind of budget that project had.",
      "Okay, good to know. And what's your pricing model, a day rate or a fixed fee per project? For reference, the freelancers we work with usually charge about three hundred and fifty euros a day.",
      "Brilliant, that's all really helpful. That's about it from me, actually!",
    ],
    rubric: [
      "Answers first with a 30–45-second pitch: role, years, genre, one concrete metric and a current client or project; no age, 'no education' or 'just started' disclaimers, no labels in place of facts, no asking permission to continue.",
      "Leads with the strongest recent brand case and its result; politely declines to share that client's budget or terms and gives his own typical range instead.",
      "Names his own day rate or project range with confidence instead of adopting the 350-euro benchmark; explains the difference through value, or adjusts scope rather than price.",
      "Treats the pause as his turn: asks one or two useful questions (what projects are coming, how freelancers are briefed and paid, typical timelines) and suggests a specific next step with an owner and a date.",
    ],
  },
  {
    id: 'rp-price-01',
    title: "Цена и схема оплаты",
    setup: "Созвон со стартапом: им понравился твой ролик, и они предлагают свою стандартную схему оплаты за рекламные креативы.",
    partnerRole: "Riley, head of growth at a sleep-tracking app startup; upbeat, fast-talking, startup-casual",
    lines: [
      "Hey! So, we're big fans of your night-time city video. Quick context: we run a lot of creative tests in paid social. The way we normally work is three hundred dollars upfront for each video, and on top of that, one and a half percent of the money we put behind it in ads. How does that sound?",
      "Okay, I hear you. Honestly, that's what all our creators get. What would make it work on your side?",
      "Cool. And we'd want to keep the ad running for as long as it keeps converting, and maybe use your voice in a few of the versions. That's fine, right?",
      "Awesome. I've got another call in two minutes, so where did we end up?",
    ],
    rubric: [
      "Doesn't say yes on the spot: acknowledges the offer, asks about volume, deliverables or expected spend, and/or proposes a figure or payment structure of his own.",
      "Holds his floor without apologizing and trades rather than concedes: for example, the base fee only for simple re-cuts and more for fresh concepts, a volume commitment, or a minimum ad spend.",
      "Puts limits on how long and where the ad can run (or charges separately for using his voice) and asks how ad spend will be reported to him.",
      "Summarizes all agreed terms (upfront fee, the percentage and what it is calculated on, spend reporting, license length, deliverables, delivery date) and closes with a dated next step.",
    ],
  },
  {
    id: 'rp-scope-01',
    title: "Дополнительные версии и права",
    setup: "Клиент доволен готовым роликом и просит «ещё пару мелочей», не обсуждая доплату.",
    partnerRole: "Noor, marketing manager at a travel luggage brand; polite but persistent",
    lines: [
      "Hi! We're so happy with the video, honestly. Just a few tiny extras: a square version, two six-second teasers, and maybe a different voiceover? Shouldn't take long, right?",
      "Hmm. We didn't really plan any extra budget for this. To be fair, the agency we used before never charged us for little tweaks like that.",
      "Oh, and we're thinking of running it on TV in a couple of countries for six months. That's covered, isn't it?",
      "Okay. So can we get everything by Thursday?",
    ],
    rubric: [
      "Thanks them, separates what the original scope covers (e.g., one round of changes) from new deliverables, and asks which item matters most and why.",
      "Holds the value calmly and without hostility; offers options such as a bundle price, fewer versions or a later date; doesn't give new deliverables away for free.",
      "Checks what the original license covers and ties TV usage, territories and the six-month term to an additional license fee.",
      "Confirms what is realistic by Thursday, then recaps deliverables, price, license terms and the next step.",
    ],
  },
];

/**
 * Strategy moves each partner line gives an opportunity for (same order as `lines`).
 * Moves that never appear in a script are scored N/A (null) for that attempt.
 */
export const ROLEPLAY_MOVES: Record<string, StrategyMoveId[][]> = {
  'rp-agency-01': [['answer-first', 'positioning', 'proof'], ['proof', 'confidential'], ['anchor-hold'], ['discovery', 'close']],
  'rp-price-01': [['anchor-hold', 'discovery'], ['anchor-hold'], ['anchor-hold', 'discovery'], ['recap', 'close']],
  'rp-scope-01': [['answer-first', 'discovery'], ['anchor-hold'], ['anchor-hold', 'discovery'], ['recap', 'close']],
};

// ---------------------------------------------------------------------------------------------------------------
// Offline quality gate (audit §2.3, step 2): an independent Sol pass answers every objective item blind.
// Pure prompt building and checking only; Root runs the paid call and drops or rewrites rejected items.

/** One blind verdict per item, parsed from the verifier's JSON answer. */
export interface BlindVerdict {
  itemId: string;
  answer: number;                  // option index the verifier chose without the key
  secondPlausible: number | null;  // another option a proficient speaker could defend, if any
  level: CEFRLevel;                // judged CEFR level of the construct and language
  levelReason: string;
  distractorIssues: string[];      // implausible distractors or cues that give the key away
}

const LEVEL_STEP: Record<CEFRLevel, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

/** Prompt for the blind pass. Never includes keys or explanations. */
export function blindVerifierPrompt(items: PlacementItem[]): string {
  const blocks = items.map(item => [
    `### ${item.id} (${item.skill})`,
    ...(item.passage ? [`${item.skill === 'listening' ? 'Audio script, heard once' : 'Passage'}: ${item.passage}`] : []),
    `Question: ${item.prompt}`,
    `Options: ${item.options.map((option, index) => `[${index}] ${option}`).join(' | ')}`,
  ].join('\n'));
  return [
    'You are an independent reviewer of an English placement test (CEFR A2–C2) for an adult learner whose first language is Russian.',
    'Answer every multiple-choice item yourself, without any key, as a careful proficient speaker would. For each item report:',
    '- answer: the index of the single best option;',
    '- secondPlausible: the index of any other option a proficient speaker could defend in a major variety of English or a common register, otherwise null;',
    '- level: the CEFR level (A2, B1, B2, C1 or C2) of what the item tests, with a one-line levelReason;',
    '- distractorIssues: options nobody would choose and any cue that gives the key away (stem grammar, length, repeated words, world knowledge); [] if none.',
    'Listening items show the script the learner hears once: judge them as listening, not as reading.',
    'Return JSON only: {"verdicts":[{"itemId":"…","answer":0,"secondPlausible":null,"level":"B1","levelReason":"…","distractorIssues":[]}]}',
    '',
    ...blocks,
  ].join('\n');
}

/** Rejection rule: blind answer ≠ key, a second defensible key, or a judged level 2+ steps from the target. */
export function blindVerdictProblems(item: PlacementItem, verdict: BlindVerdict): { reject: string[]; warn: string[] } {
  const reject: string[] = [];
  const warn = [...verdict.distractorIssues];
  if (verdict.answer !== item.answer) reject.push(`blind answer ${verdict.answer} differs from key ${item.answer}`);
  if (verdict.secondPlausible !== null && verdict.secondPlausible !== verdict.answer) reject.push(`second plausible key ${verdict.secondPlausible}`);
  const judged = LEVEL_STEP[verdict.level];
  if (judged === undefined) reject.push(`invalid level ${String(verdict.level)}`);
  else if (Math.abs(judged - LEVEL_STEP[item.level]) >= 2) reject.push(`judged ${verdict.level}, target ${item.level}`);
  else if (judged !== LEVEL_STEP[item.level]) warn.push(`judged ${verdict.level}, target ${item.level}`);
  return { reject, warn };
}
