import type { PlacementItem } from './types';

/**
 * Placement test v2 — objective item bank (listening, reading, grammar, vocabulary). Server-side only.
 *
 * ⚠️ Здесь ключи ответов. Если собираешься проходить тест сам, не открывай этот файл:
 * знакомые задания завышают результат.
 *
 * Blueprint (planning/v05/audit-product.md §2.3): per level A2/B1/B2/C1 — language 10 items (6 grammar + 4 vocabulary),
 * listening 4 clips × 2 questions, reading 3 passages × 2 questions; optional C2 ceiling checks (3 language items,
 * 2 listening clips). About 1/3 of the stimuli are work context, 2/3 life and relocation. Everything is a parallel
 * of the audit's calibration anchors (same construct and level, new context); anchor text is never served.
 * Rule-like content (visas, permits, city rules) uses fictional places: Norvalia, Lorveta.
 * Revised after an independent blind review: from B1 up, keys paraphrase the stimulus and higher levels test inference,
 * stance and implicature; distractors are misreadings built from the stimulus's own words (rules enforced in
 * tests/placement-bank.test.ts).
 * Pure data and tiny helpers: no server imports, no client bundling (keys must stay on the server).
 */

export {
  SPEAKING_PROMPTS, SPEAKING_TIMING, FOLLOW_UP_MAX_SECONDS, speakingPromptsFor,
  ROLEPLAY_SCRIPTS, ROLEPLAY_MOVES, ROLEPLAY_ANSWER_MAX_SECONDS,
  blindVerifierPrompt, blindVerdictProblems, type BlindVerdict,
} from './prompts';

export const BANK_VERSION = 1;
/** At most this many questions are asked about one clip or passage (they share a groupId). */
export const PLACEMENT_GROUP_MAX = 2;

type BankLevel = PlacementItem['level'];
type BankSkill = PlacementItem['skill'];
type ItemContext = NonNullable<PlacementItem['context']>;
type KeyPosition = 0 | 1 | 2 | 3;

/** Listening pace bands for TTS acceptance (words ÷ clip minutes); `target` is stored on items as `targetWpm`. */
export const LISTENING_WPM: Record<BankLevel, { min: number; max: number; target: number }> = {
  A2: { min: 95, max: 125, target: 110 },
  B1: { min: 125, max: 150, target: 138 },
  B2: { min: 150, max: 175, target: 162 },
  C1: { min: 170, max: 205, target: 188 },
  C2: { min: 175, max: 215, target: 195 },
};

/** Word count used for `wordCount` and WPM checks: tokens with a letter or digit; dialogue labels ("A:") excluded. */
export function countWords(text: string): number {
  return text.replace(/^[AB]:\s*/gm, '').split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}

/** Abstract voices so clips sound different; the server maps them to real TTS voices (see SUGGESTED_TTS_VOICES). */
export type ListeningVoice = 'f1' | 'f2' | 'f3' | 'm1' | 'm2' | 'm3';
export const SUGGESTED_TTS_VOICES: Record<ListeningVoice, string> = {
  f1: 'coral', f2: 'nova', f3: 'shimmer', m1: 'cedar', m2: 'ash', m3: 'onyx',
};
/** voices[0] reads speaker A (or the whole monologue), voices[1] reads speaker B. */
export interface ListeningCast {
  voices: [ListeningVoice] | [ListeningVoice, ListeningVoice];
  /** Dialogue only: start each B turn this many seconds before the previous A turn ends (mixed, e.g. with amix). */
  overlapSeconds?: number;
}

/** Split a listening script into TTS turns. Dialogue lines start with "A: " or "B: "; anything else is one monologue turn. */
export function scriptTurns(passage: string): { speaker: 'A' | 'B'; text: string }[] {
  const lines = passage.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every(line => /^[AB]: /.test(line))) return [{ speaker: 'A', text: passage.trim() }];
  return lines.map(line => ({ speaker: line[0] === 'B' ? 'B' : 'A', text: line.slice(3).trim() }));
}

// ---------------------------------------------------------------------------------------------------------------
// Builders: an item is written as key + three distractors + the key's position, so `answer` can never drift.

interface Choice { key: string; distractors: [string, string, string]; at: KeyPosition }
interface Question extends Choice { tags: string[]; prompt: string; explanation: string }
interface LanguageDraft extends Question { id: string; level: BankLevel; context: ItemContext }
interface ClipDraft {
  id: string; level: BankLevel; context: ItemContext; cast: ListeningCast; delivery: string; script: string;
  questions: [Question, Question];
}
interface PassageDraft { id: string; level: BankLevel; context: ItemContext; text: string; questions: [Question, Question] }

function arrange({ key, distractors, at }: Choice): Pick<PlacementItem, 'options' | 'answer'> {
  const options = [...distractors];
  options.splice(at, 0, key);
  return { options, answer: at };
}

function language(skill: 'grammar' | 'vocabulary', draft: LanguageDraft): PlacementItem {
  const { id, level, context, tags, prompt, explanation } = draft;
  return { id, section: 'language', skill, level, context, tags, prompt, ...arrange(draft), explanation };
}
const grammar = (draft: LanguageDraft) => language('grammar', draft);
const vocabulary = (draft: LanguageDraft) => language('vocabulary', draft);

function clipItems(clip: ClipDraft): PlacementItem[] {
  const wordCount = countWords(clip.script);
  return clip.questions.map((question, index): PlacementItem => ({
    id: `${clip.id}${index === 0 ? 'a' : 'b'}`, section: 'listening', skill: 'listening', level: clip.level,
    context: clip.context, groupId: clip.id, passage: clip.script, delivery: clip.delivery,
    wordCount, targetWpm: LISTENING_WPM[clip.level].target,
    tags: question.tags, prompt: question.prompt, ...arrange(question), explanation: question.explanation,
  }));
}

function passageItems(passage: PassageDraft): PlacementItem[] {
  return passage.questions.map((question, index): PlacementItem => ({
    id: `${passage.id}${index === 0 ? 'a' : 'b'}`, section: 'reading', skill: 'reading', level: passage.level,
    context: passage.context, groupId: passage.id, passage: passage.text,
    tags: question.tags, prompt: question.prompt, ...arrange(question), explanation: question.explanation,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Listening: questions are shown before playback; the script stays hidden until the answer (review only).

const CLIPS: ClipDraft[] = [
  // A2 — slow and clear, about 25 s.
  {
    id: 'ls-a2-01', level: 'A2', context: 'life', cast: { voices: ['m1'] },
    delivery: "Slow, clear station announcement. Neutral British accent. Short pauses between sentences.",
    script: "Good afternoon. The two fifteen train to Porto will now leave from platform six, not platform nine. Platform six. The café on platform one is closed today, and the drinks machine on platform six is not working, but you can buy drinks and snacks on the train. Please keep your bags with you.",
    questions: [
      { tags: ['numbers', 'detail'], prompt: "You hear an announcement at a train station. Which platform does the Porto train leave from?",
        key: "Platform 6", distractors: ["Platform 9", "Platform 2", "Platform 15"], at: 2,
        explanation: "Диктор говорит «platform six, not platform nine» и повторяет: «Platform six». Девять — прежняя платформа, а два и пятнадцать звучат во времени отправления (two fifteen)." },
      { tags: ['detail'], prompt: "Where can passengers buy drinks today?",
        key: "On the train", distractors: ["At the café", "From the machine", "On platform one"], at: 0,
        explanation: "Кафе на первой платформе закрыто, а автомат с напитками на шестой не работает, поэтому остаётся поезд: «you can buy drinks and snacks on the train»." },
    ],
  },
  {
    id: 'ls-a2-02', level: 'A2', context: 'life', cast: { voices: ['f1'] },
    delivery: "Slow, friendly voicemail. General American accent. Short pauses between sentences.",
    script: "Hi, it's Maria, your landlord. The plumber is coming tomorrow at ten in the morning to fix the kitchen sink. He says it will take about an hour. If you can't be at home, please leave the key with your neighbor. Thanks, bye!",
    questions: [
      { tags: ['numbers', 'detail'], prompt: "Your landlord leaves you a voicemail. When is the plumber coming?",
        key: "Tomorrow at 10 a.m.", distractors: ["Today at 10 a.m.", "Tomorrow at 11 a.m.", "Tomorrow at 10 p.m."], at: 1,
        explanation: "Мария говорит: «tomorrow at ten in the morning». Работа займёт около часа, поэтому 11 — время окончания, а не прихода сантехника." },
      { tags: ['detail'], prompt: "What should you do if you can't be at home?",
        key: "Give the key to your neighbor", distractors: ["Give the key to the plumber", "Leave the key in the kitchen", "Stay at home for about an hour"], at: 3,
        explanation: "Мария просит: «If you can't be at home, please leave the key with your neighbor», то есть оставить ключ соседу. Сантехнику ключ не отдают, а «about an hour» — это сколько продлится ремонт." },
    ],
  },
  {
    id: 'ls-a2-03', level: 'A2', context: 'work', cast: { voices: ['m2'] },
    delivery: "Slow, clear and friendly business voicemail. General American accent.",
    script: "Hi, this is Tom from City Bikes. We're opening a second shop in May, and we'd like a short video about it. Could you send me your prices by email? There's no rush. I'm away on Monday and Tuesday, so Friday is fine. Thanks, and have a good day!",
    questions: [
      { tags: ['detail'], prompt: "A client leaves you a voicemail. What does Tom want you to send?",
        key: "Your prices", distractors: ["A short video", "Your email address", "Ideas for the video"], at: 2,
        explanation: "Том просит: «Could you send me your prices by email?». Видео — это будущий проект, а email — способ отправки, а не то, что нужно прислать." },
      { tags: ['detail'], prompt: "When does Tom need an answer?",
        key: "By Friday", distractors: ["On Monday", "By Tuesday", "In May"], at: 3,
        explanation: "Том говорит, что спешки нет («There's no rush»), а в понедельник и вторник его не будет, поэтому «Friday is fine» — ответ нужен к пятнице. В мае откроется второй магазин, это не срок ответа." },
    ],
  },
  {
    id: 'ls-a2-04', level: 'A2', context: 'life', cast: { voices: ['f2'] },
    delivery: "Slow, cheerful voice message from a friend. General American accent.",
    script: "Hey! I just got back from Montenegro. The food was amazing and the people were really friendly, but it rained almost every day, so we didn't go to the mountains. We spent a lot of time in museums and cafés instead. Next time, I want to go in August.",
    questions: [
      { tags: ['detail'], prompt: "A friend sends you a voice message about a trip. Why didn't they go to the mountains?",
        key: "It was rainy most of the time", distractors: ["They liked the museums more", "August is a better month for it", "The people weren't friendly"], at: 0,
        explanation: "Подруга говорит: «it rained almost every day, so we didn't go to the mountains», значит, помешала погода. В музеи они пошли уже вместо гор, а август — это планы на следующий раз." },
      { tags: ['detail', 'paraphrase'], prompt: "What does your friend want to do next time?",
        key: "Go there in the summer", distractors: ["Go back to the museums", "Try more of the local food", "Spend more time in cafés"], at: 1,
        explanation: "В конце подруга говорит: «Next time, I want to go in August», а август — это лето. Музеи, кафе и еда — рассказ о прошлой поездке, а не планы." },
    ],
  },

  // B1 — natural but clear, about 25–30 s.
  {
    id: 'ls-b1-01', level: 'B1', context: 'work', cast: { voices: ['f3'] },
    delivery: "Natural but clear pace. Friendly client voicemail. General American accent.",
    script: "Hi, it's Laura from Bloom Yoga. Quick update about Saturday's shoot. We can't use the big studio after all, because there's a private class, so we'll film in the small room upstairs. The time is the same, nine o'clock, but please come twenty minutes early to set up the lights. Oh, and we'll need the final edit a week later, not two weeks. Call me if that's a problem.",
    questions: [
      { tags: ['numbers', 'inference'], prompt: "A client leaves a voicemail about a video shoot. What time should you arrive on Saturday?",
        key: "8:40", distractors: ["9:00", "9:20", "8:20"], at: 3,
        explanation: "Съёмка, как и раньше, в девять, но Лаура просит прийти «twenty minutes early», то есть к 8:40. Девять — начало съёмки, а не время прихода." },
      { tags: ['detail'], prompt: "What has changed since the original plan?",
        key: "The room and the edit deadline", distractors: ["The time and the edit deadline", "The room and the start time", "The day and the room"], at: 0,
        explanation: "Меняются две вещи: съёмка переезжает в маленький зал наверху, а монтаж нужен через неделю, «not two weeks». Время прямо названо прежним: «The time is the same»." },
    ],
  },
  {
    id: 'ls-b1-02', level: 'B1', context: 'life', cast: { voices: ['m1'] },
    delivery: "Natural pace. A friend telling a story, amused and relaxed. General American accent.",
    script: "You won't believe what happened at my visa interview. I was so nervous that I left my bank statements at home. The officer just smiled and said I could email them the same day. I did it from a café across the street, and two weeks later I got the visa. Honestly, I was worried for nothing.",
    questions: [
      { tags: ['detail', 'reference'], prompt: "A friend tells you about a visa interview. How did your friend solve the problem with the documents?",
        key: "Sent them later that day", distractors: ["Went back home to get them", "Brought them two weeks later", "Had them printed at a café"], at: 1,
        explanation: "Сотрудник разрешил прислать выписки по почте в тот же день, и друг «did it from a café across the street», то есть отправил их из кафе. Две недели — это срок получения визы, а домой за документами друг не ездил." },
      { tags: ['attitude'], prompt: "How does your friend feel about the interview now?",
        key: "Relieved that it all worked out", distractors: ["Still nervous about the result", "Worried about getting the visa", "Annoyed with the officer"], at: 2,
        explanation: "Итоговая фраза «I was worried for nothing» и полученная виза показывают облегчение. Нервничал и волновался друг до и во время интервью, а сотрудник, наоборот, отнёсся к нему по-доброму." },
    ],
  },
  {
    id: 'ls-b1-03', level: 'B1', context: 'life', cast: { voices: ['m3'] },
    delivery: "Moderate pace. Formal recorded announcement with clear diction. Neutral accent.",
    script: "Good morning, and welcome to the Norvalian Visa Center. Please take a number from the machine on your left and wait until it appears on the screen. Photos must be no older than six months. If you need copies of your documents, there is a copy machine on the second floor, but it only accepts cards.",
    questions: [
      { tags: ['inference', 'rule-application'], prompt: "You hear an announcement at a visa center. Your photos were taken eight months ago. What does that mean for you?",
        key: "You'll need to get new ones", distractors: ["You can copy them upstairs", "They're fine for six more months", "You must pay for them by card"], at: 0,
        explanation: "Фото должны быть «no older than six months», а восьмимесячные уже старше, значит, нужны новые. Копировальный аппарат наверху — для копий документов, а не для решения проблемы со старыми фото." },
      { tags: ['detail'], prompt: "What is true about the copy machine?",
        key: "It only takes cards", distractors: ["It only takes cash", "It's on your left", "It's on the first floor"], at: 2,
        explanation: "Аппарат стоит на втором этаже и «only accepts cards». Слева находится автомат с номерками очереди, а наличные не принимаются." },
    ],
  },
  {
    id: 'ls-b1-04', level: 'B1', context: 'life', cast: { voices: ['f2', 'm1'] },
    delivery: "Two friends talking. Relaxed, natural but clear pace. General American accents.",
    script: "A: The agent says we can see the apartment on Thursday at six.\nB: Six is too early for me. I finish work at six thirty. Can we ask for seven?\nA: She's busy at seven, but she said Saturday morning is also possible.\nB: Saturday's perfect. Then we'll have more time to look around the area.",
    questions: [
      { tags: ['detail', 'inference', 'dialogue'], prompt: "Two friends talk about seeing an apartment. When will they probably see it?",
        key: "On Saturday morning", distractors: ["On Thursday at six", "On Thursday at seven", "On Saturday evening"], at: 3,
        explanation: "В семь агент занята, зато предлагает утро субботы, и второй друг отвечает «Saturday's perfect». В шесть ему слишком рано, а в семь не может агент." },
      { tags: ['detail', 'paraphrase', 'dialogue'], prompt: "Why is six o'clock a problem for the second speaker?",
        key: "They'll still be at work", distractors: ["The agent is busy at six", "They want to see the area first", "Saturday morning suits them more"], at: 1,
        explanation: "Второй собеседник говорит «I finish work at six thirty», то есть в шесть он ещё на работе. Агент занята в семь, а не в шесть, а суббота появляется в разговоре позже, как новое предложение." },
    ],
  },

  // B2 — natural pace, about 25–30 s.
  {
    id: 'ls-b2-01', level: 'B2', context: 'work', cast: { voices: ['m3'] },
    delivery: "Natural pace, slightly hurried. A colleague briefing a teammate. British accent.",
    script: "Okay, so the client loved the storyboard, but there's a catch. Their legal team says we can't show the logo on real buildings, so the billboard shot has to change. Instead of cutting it, I'd rather keep the idea and move it to an obviously fictional city. It'll cost us a day, but I think the shot is worth it. I've already spoken to the producer, so there's no need to ask her again.",
    questions: [
      { tags: ['detail', 'paraphrase'], prompt: "A colleague talks about changes to a storyboard. Why does the billboard shot have to change?",
        key: "The client's lawyers rejected the setting", distractors: ["The client wasn't happy with the storyboard", "It would add a day to the schedule", "The producer wants a different city"], at: 2,
        explanation: "Юристы клиента не разрешают показывать логотип на реальных зданиях, то есть отвергли место действия кадра. Лишний день — цена решения, а не причина, а раскадровка клиенту, наоборот, понравилась." },
      { tags: ['detail', 'inference'], prompt: "What does the speaker want to do with the shot?",
        key: "Keep the shot but set it in a made-up city", distractors: ["Cut the shot and save a day of work", "Ask the producer whether it can stay", "Film the billboard scene in a studio instead"], at: 0,
        explanation: "Он предлагает «keep the idea and move it to an obviously fictional city». Вырезать кадр он как раз не хочет, а с продюсером уже поговорил сам." },
    ],
  },
  {
    id: 'ls-b2-02', level: 'B2', context: 'life', cast: { voices: ['m2'] },
    delivery: "Natural pace. Polite but businesslike voicemail. General American accent.",
    script: "Hi, it's Daniel, the landlord. Just a heads-up: I've had quite a lot of interest in the apartment this week. If you'd like to sign the lease, I'd need the deposit by Monday. I'm not trying to pressure you, but I can't really hold it beyond that. Also, they're doing some work on the roof in March, so it might be a bit noisy for a couple of weeks. Give me a call either way.",
    questions: [
      { tags: ['implicature', 'inference'], prompt: "A landlord leaves you a voicemail. What is Daniel suggesting?",
        key: "Someone else may take the apartment after Monday", distractors: ["The rent may go up after Monday", "He has already given the apartment to someone", "You must pay the deposit today"], at: 1,
        explanation: "Фразы «a lot of interest» и «I can't really hold it beyond that» — вежливый намёк: после понедельника квартиру может снять кто-то другой. О повышении цены речи нет, а залог нужен к понедельнику, а не сегодня." },
      { tags: ['idiom', 'inference'], prompt: "What does Daniel ask you to do?",
        key: "Call him whatever you decide", distractors: ["Call him only if you want it", "Call him once you've paid", "Call him after the roof work"], at: 3,
        explanation: "«Give me a call either way» значит «позвони в любом случае» — и если решишь снимать квартиру, и если откажешься. Звонок не зависит ни от оплаты залога, ни от ремонта крыши." },
    ],
  },
  {
    id: 'ls-b2-03', level: 'B2', context: 'life', cast: { voices: ['f3'] },
    delivery: "Natural podcast pace. Warm and conversational. General American accent.",
    script: "Most people assume remote workers are happier because they skip the commute. The surveys say it's more complicated. Yes, people love the extra hour, but after about a year, many of them start to miss the small, unplanned conversations: the chat in the kitchen, the quick question you'd never put in an email. The ones who stay happy tend to build those moments back in on purpose, with a coworking day, a weekly lunch or a running club.",
    questions: [
      { tags: ['gist'], prompt: "You hear part of a podcast about remote work. What is the speaker's main point?",
        key: "Skipping the commute isn't enough to stay happy", distractors: ["Remote work makes most people unhappy within a year", "The extra hour is what remote workers value most", "Unplanned chats matter less than people think"], at: 3,
        explanation: "Спикер спорит с мнением, что удалёнщики счастливее просто потому, что не ездят в офис: «it's more complicated», ведь со временем не хватает живого общения. Он не говорит, что удалёнка делает большинство несчастными: довольные просто специально возвращают такие встречи." },
      { tags: ['detail', 'paraphrase'], prompt: "What do many remote workers start to miss?",
        key: "Casual chats that happen by chance", distractors: ["The commute and the extra hour", "Sending quick emails to colleagues", "A weekly lunch with their team"], at: 0,
        explanation: "Через год многим не хватает «the small, unplanned conversations» — случайных разговоров на кухне и быстрых вопросов. Еженедельный обед — способ вернуть такие моменты, а вопросы как раз те, что «you'd never put in an email»." },
    ],
  },
  {
    id: 'ls-b2-04', level: 'B2', context: 'life', cast: { voices: ['f1', 'm3'] },
    delivery: "A salesperson and a customer in a phone shop. Natural pace. General American accents.",
    script: "A: So with this plan, you get unlimited data, but only inside the country.\nB: And if I'm abroad? I travel quite a lot for work.\nA: Then it's five dollars a day, but only on the days you actually use data.\nB: Hmm. Is there a plan that includes roaming?\nA: There is, but honestly, unless you're away more than a week a month, it works out more expensive.",
    questions: [
      { tags: ['numbers', 'inference', 'dialogue'], prompt: "A customer asks about a phone plan. On this plan, you spend ten days abroad and use data on four of them. What do you pay for data?",
        key: "$20", distractors: ["$50", "$5", "$0"], at: 2,
        explanation: "Пять долларов списывают «only on the days you actually use data»: 4 дня × $5 = $20. $50 вышло бы, если платить за все десять дней, а безлимит действует только внутри страны." },
      { tags: ['inference', 'dialogue'], prompt: "What does the salesperson suggest about the roaming plan?",
        key: "It pays off only if you're away a lot", distractors: ["It works out cheaper for most people", "It's only for people who travel for work", "It doesn't include any data abroad"], at: 1,
        explanation: "«Unless you're away more than a week a month, it works out more expensive»: тариф с роумингом выгоден, только если часто уезжаешь. Остальные варианты в разговоре не звучат." },
    ],
  },

  // C1 — fast, casual register: contractions, fillers, self-corrections, one overlapping dialogue.
  {
    id: 'ls-c1-01', level: 'C1', context: 'work', cast: { voices: ['f2'] },
    delivery: "Fast, warm and diplomatic voicemail. British accent. Casual register; keep the contractions and the hesitation as written.",
    script: "Hi, it's Claire from Atelier Nord, just following up. So, I've had a proper look at the treatment, and honestly, it's one of the more original things we've had in. That said, this particular client has gone, um, let's say rather cautious since their last launch, and I'm not sure a talking cactus is going to survive the first meeting. I'll put it in front of them anyway, because you never know. But if you happened to have something a little more down-to-earth in your back pocket, now would be a really good time to send it.",
    questions: [
      { tags: ['implicature', 'hedging'], prompt: "An agency producer calls about your idea. What does Claire expect to happen with it?",
        key: "The client will probably turn it down", distractors: ["She'll probably keep it for another client", "She won't show it to the client at all", "The client may well love how original it is"], at: 0,
        explanation: "Клэр сомневается, что идея «is going to survive the first meeting», то есть ожидает отказа клиента, хотя всё равно её покажет («I'll put it in front of them anyway»). Оригинальность она хвалит сама, а о клиенте говорит, что он стал «rather cautious»." },
      { tags: ['implicature', 'idiom'], prompt: "What is Claire hinting you should do?",
        key: "Send a safer alternative soon", distractors: ["Make the cactus idea more original", "Wait until the client has seen it", "Get ready to meet the client yourself"], at: 2,
        explanation: "«Something a little more down-to-earth in your back pocket» — запасная идея попроще и безопаснее, а «now would be a really good time to send it» значит «присылай сейчас». Ждать реакции клиента или дорабатывать кактус она не просит." },
    ],
  },
  {
    id: 'ls-c1-02', level: 'C1', context: 'life', cast: { voices: ['m1', 'f3'], overlapSeconds: 0.3 },
    delivery: "Fast, casual conversation between friends, full of contractions. The second speaker hesitates and corrects herself as written. General American accents.",
    script: "A: So I land at, what, ten past six on Friday?\nB: Ten past… no, wait, that was before they pushed it back by half an hour. Anyway, parking there's a total nightmare, so, um, don't call me the second you land. Shoot me a text once you've actually got your bags, and I'll swing by the pick-up area.\nA: Fair enough. I'll probably grab a coffee first anyway. See you Friday!",
    questions: [
      { tags: ['numbers', 'inference', 'dialogue', 'self-correction'], prompt: "Two friends arrange an airport pickup. When does the flight land now?",
        key: "At 6:40", distractors: ["At 6:10", "At 5:40", "At 6:30"], at: 1,
        explanation: "«Ten past six» — старое время: рейс «pushed it back by half an hour», то есть перенесли на полчаса позже, на 6:40. Push back значит «отложить», а не «перенести раньше», поэтому 5:40 неверно." },
      { tags: ['inference', 'dialogue'], prompt: "Why does the second speaker want to hear from the traveler only after the bags are collected?",
        key: "She wants to avoid parking and waiting", distractors: ["The traveler wants to get a coffee first", "The flight has been pushed back again", "The pick-up area is far from the gates"], at: 3,
        explanation: "Она говорит «parking there's a total nightmare, so… don't call me the second you land»: стоять и ждать ей неудобно, поэтому она подъедет, когда багаж уже будет на руках. Кофе — собственный план прилетающего, а не её причина." },
    ],
  },
  {
    id: 'ls-c1-03', level: 'C1', context: 'work', cast: { voices: ['m2'] },
    delivery: "Fast and casual, dry and ironic. A friend telling a story with lots of contractions. General American accent.",
    script: "So the \"quick call\" with the brand lasted an hour and a half. They loved the concept, loved the style, and then, wait for it, asked if I'd do it for free, because it'd be \"amazing exposure\". I told them I'd think about it, which, between you and me, means I've already thought about it. Anyway, the upside is I now have a very polished pitch deck, and someone with an actual budget is going to love it.",
    questions: [
      { tags: ['implicature'], prompt: "A friend tells you about a call with a brand. What has your friend decided?",
        key: "To turn down the unpaid project", distractors: ["To do the project for the exposure", "To ask the brand for more time", "To offer the brand a lower price"], at: 1,
        explanation: "«I told them I'd think about it, which… means I've already thought about it»: вежливое «подумаю» прикрывает уже принятый отказ. Это подтверждает и надежда на клиента «with an actual budget»." },
      { tags: ['implicature', 'inference'], prompt: "What does your friend plan to do with the pitch deck?",
        key: "Pitch the idea to a client who'll pay", distractors: ["Send it back to the brand with a price", "Polish it further before sending it", "Turn it into an ad for the brand"], at: 0,
        explanation: "Фраза «someone with an actual budget is going to love it» подразумевает, что ту же идею друг предложит клиенту, который готов платить. Возвращаться к этому бренду с ценой или дорабатывать презентацию он не собирается: она и так «very polished»." },
    ],
  },
  {
    id: 'ls-c1-04', level: 'C1', context: 'life', cast: { voices: ['f1'] },
    delivery: "Fast, confident relocation consultant. Casual register with contractions. General American accent.",
    script: "Okay, a quick word on timing, because this is where people tend to trip up. On paper, a Norvalian residence permit takes four to six weeks, and for some people it genuinely does. But if your income's on the irregular side, say, freelance payments that jump around from month to month, expect them to come back asking for more paperwork, and that alone can eat up another month. So, unless your file's airtight, I'd hold off on anything you can't cancel, flights included, until you've actually got the decision in writing.",
    questions: [
      { tags: ['gist', 'hedging', 'paraphrase'], prompt: "A relocation consultant talks about timing. What does she advise?",
        key: "Make no fixed travel plans until you're approved", distractors: ["Count on four to six weeks from the day you apply", "Apply at least a month earlier than you normally would", "Wait until your income is steady before applying"], at: 3,
        explanation: "Совет — не брать ничего, что нельзя отменить, «flights included», пока не придёт письменное решение. Срок «four to six weeks» она называет официальным («On paper»), а лишний месяц — это риск, а не совет подаваться раньше." },
      { tags: ['inference', 'paraphrase', 'idiom'], prompt: "Who is most likely to face a longer wait?",
        key: "A freelancer whose income changes a lot", distractors: ["Someone who books a flight they can't cancel", "Someone who applies on paper rather than online", "Someone who wants the decision in writing"], at: 2,
        explanation: "Задержку вызывает нерегулярный доход: «freelance payments that jump around from month to month», и тогда попросят дополнительные документы. «On paper» здесь значит «официально», а не «подать заявление на бумаге»." },
    ],
  },

  // C2 — optional ceiling checks.
  {
    id: 'ls-c2-01', level: 'C2', context: 'work', cast: { voices: ['m3'] },
    delivery: "Natural fast pace. Measured, dry and understated podcast critic. British accent.",
    script: "I'll say this much for the new campaign: it's competent. The lighting is lovely, the edit is tidy, and the product stays on screen for precisely as long as the brief no doubt demanded. Nobody involved put a foot wrong, which I suspect was rather the point. What it isn't is memorable. You watch it, you nod along, and by the time the next ad starts, it's gone. Which, to be clear, isn't the same as being bad. It's arguably worse. Bad work at least starts an argument; this just politely leaves the room.",
    questions: [
      { tags: ['attitude', 'implicature', 'concession'], prompt: "A critic talks about an ad campaign. What is the speaker's overall verdict?",
        key: "Well made, but its blandness is a real failing", distractors: ["Flawed, but at least it gets people talking", "Forgettable, though at least it isn't bad", "Dull, but only because the brief was strict"], at: 2,
        explanation: "Критик хвалит ремесло («competent», «lovely», «tidy»), но главное — «What it isn't is memorable», и это, по его словам, «arguably worse», чем плохая работа. «Хотя бы не плохо» — лишь первая половина мысли, которую он тут же переворачивает." },
      { tags: ['implicature', 'idiom'], prompt: "What does the speaker suggest about the team behind the campaign?",
        key: "Avoiding mistakes was their main goal", distractors: ["They made a few small but visible mistakes", "They ignored the brief to try something new", "They hoped the ad would start an argument"], at: 0,
        explanation: "«Nobody involved put a foot wrong, which I suspect was rather the point»: никто не ошибся, и, похоже, в этом и была вся цель — не рисковать. Put a foot wrong значит «оступиться, ошибиться», так что ошибок, по словам критика, как раз не было." },
    ],
  },
  {
    id: 'ls-c2-02', level: 'C2', context: 'work', cast: { voices: ['m1'] },
    delivery: "Natural fast pace. Candid, slightly weary client voicemail. General American accent.",
    script: "Hi, it's Marcus. I'll level with you: your number landed with a bit of a thud upstairs. Not because anyone thinks it's unjustified, if anything the opposite, but it's a different order of magnitude from what we'd penciled in, and I'd rather not be the one who walks it back into that room unchanged. If there were some daylight between the full package and, say, a leaner version, I suspect we could get somewhere. Have a think and let me know.",
    questions: [
      { tags: ['implicature', 'idiom'], prompt: "A client leaves a voicemail about your quote. What is Marcus hinting at?",
        key: "A reduced scope at a lower price could work", distractors: ["He might defend the full package upstairs", "The number may already be off the table", "He wants a more justified number first"], at: 3,
        explanation: "«Some daylight between the full package and, say, a leaner version» — намёк: если сократить объём, меньшую сумму, скорее всего, согласуют. Цену окончательно не отвергли («I suspect we could get somewhere»), а защищать её «unchanged» перед руководством Маркус как раз не хочет." },
      { tags: ['attitude'], prompt: "How does Marcus see your price?",
        key: "Fair, but hard to get approved", distractors: ["Unjustified for this kind of work", "Acceptable, so it can go upstairs unchanged", "Lower than the amount penciled in"], at: 1,
        explanation: "Маркус говорит, что цену никто не считает неоправданной («if anything the opposite»), но она на порядок выше заложенной суммы, и в таком виде её трудно согласовать. Отсюда и просьба о «leaner version», а не возмущение ценой." },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Reading: the passage is visible with the questions. Lengths: A2 40–60, B1 60–100, B2 80–120, C1 70–120 (dense).

const PASSAGES: PassageDraft[] = [
  {
    id: 'rd-a2-01', level: 'A2', context: 'life',
    text: "Hi Alex, I'm writing from my new apartment in Valencia! It's small, but it's only ten minutes from the beach. My new job starts on Monday. My Spanish isn't very good yet, but everyone at the office speaks English. I'm taking Spanish lessons twice a week. Would you like to visit me in October? Love, Kate",
    questions: [
      { tags: ['detail'], prompt: "How often does Kate have Spanish lessons?",
        key: "Twice a week", distractors: ["Every weekday", "Once a week", "On Mondays"], at: 2,
        explanation: "Кейт пишет: «I'm taking Spanish lessons twice a week». Понедельник — день, когда начинается работа, а не урок." },
      { tags: ['purpose', 'main-idea'], prompt: "Why is Kate writing to Alex?",
        key: "To share her news and invite Alex", distractors: ["To ask Alex for help with Spanish", "To say that she is coming home", "To ask Alex to find her a job"], at: 0,
        explanation: "Кейт рассказывает о квартире и новой работе, а в конце приглашает: «Would you like to visit me in October?». О помощи с испанским или возвращении домой она не просит." },
    ],
  },
  {
    id: 'rd-a2-02', level: 'A2', context: 'life',
    text: "FOR SALE: Blue city bike, three years old, in very good condition. New tires last month. I'm moving abroad, so I need to sell it quickly. The price is $120, or $100 if you can pick it up this weekend. The lock and lights are included. Call or text Ana after 6 p.m.",
    questions: [
      { tags: ['numbers', 'detail'], prompt: "How much is the bike if you pick it up this weekend?",
        key: "$100", distractors: ["$120", "$20", "$80"], at: 3,
        explanation: "Цена $120, но «$100 if you can pick it up this weekend». $20 — это разница между ценами, а не стоимость велосипеда." },
      { tags: ['detail'], prompt: "Why is Ana selling the bike?",
        key: "She is moving abroad", distractors: ["It is too old now", "She bought a new one", "It needs new tires"], at: 1,
        explanation: "Ана пишет: «I'm moving abroad, so I need to sell it quickly». Шины новые, а велосипед в очень хорошем состоянии." },
    ],
  },
  {
    id: 'rd-a2-03', level: 'A2', context: 'work',
    text: "Hi! Our video call with the client is on Thursday at 3 p.m., not Wednesday. Please send me your storyboard before the call, by Wednesday evening. The client wants to see two ideas, not one. The call will be short, about twenty minutes. Thanks! Dana",
    questions: [
      { tags: ['detail'], prompt: "When is the call with the client?",
        key: "On Thursday at 3 p.m.", distractors: ["On Wednesday at 3 p.m.", "On Wednesday evening", "On Thursday evening"], at: 0,
        explanation: "В сообщении: «on Thursday at 3 p.m., not Wednesday». Вечер среды — срок для раскадровки, а не время звонка." },
      { tags: ['detail'], prompt: "What does Dana ask you to send?",
        key: "A storyboard with two ideas", distractors: ["A storyboard with one idea", "A short finished video", "A list of questions for the client"], at: 2,
        explanation: "Дана просит прислать раскадровку до звонка, а клиент хочет увидеть «two ideas, not one». Готовое видео и список вопросов в сообщении не упоминаются." },
    ],
  },
  {
    id: 'rd-b1-01', level: 'B1', context: 'work',
    text: "When I started freelancing, I never asked for a deposit. I thought it would look unprofessional, and I was afraid clients would simply go to someone cheaper. Then one client disappeared after I had delivered a whole project, and I never got paid. Since then, I have always asked for 50% before I start. Surprisingly, nobody has complained. In fact, most clients seem to trust me more, because it shows I take my work seriously. If a client refuses to pay anything upfront, I now see it as a warning sign.",
    questions: [
      { tags: ['detail', 'paraphrase'], prompt: "Why did the writer start asking for a deposit?",
        key: "One client never paid for delivered work", distractors: ["Clients kept choosing cheaper freelancers", "It made the writer look more professional", "Clients complained about paying at the end"], at: 1,
        explanation: "Поворотный момент описан прямо: клиент исчез после сдачи проекта, «and I never got paid». Доверие клиентов автор заметил уже потом, а уход к дешёвым исполнителям был его прежним страхом." },
      { tags: ['inference', 'main-idea'], prompt: "What has the writer learned?",
        key: "A deposit protects you and doesn't scare good clients away", distractors: ["Asking for a deposit makes freelancers look unprofessional", "Lowering your price is better than asking for a deposit", "Clients who pay upfront usually ask for more changes"], at: 3,
        explanation: "После введения предоплаты «nobody has complained», а клиенты стали больше доверять, так что депозит защищает и не отпугивает. Мысль о «непрофессиональности» — старый страх автора, который не подтвердился." },
    ],
  },
  {
    id: 'rd-b1-02', level: 'B1', context: 'life',
    text: "Our city's running club started three years ago with five people and one rule: nobody runs alone. Today, more than two hundred people join us every Saturday morning in Lakeside Park. You don't have to be fast; in fact, most of our members are beginners. There are three groups: 5 km, 8 km and 10 km. After the run, many of us go for breakfast together, which for some people is the best part of the week. Membership is free, but we ask everyone to help organize at least one event a year.",
    questions: [
      { tags: ['detail', 'paraphrase'], prompt: "Instead of a fee, what does the club expect from its members?",
        key: "Volunteering once a year or more", distractors: ["Running with the group every week", "Joining the others for breakfast", "Bringing a beginner to a run"], at: 0,
        explanation: "«Membership is free, but we ask everyone to help organize at least one event a year» — вместо взноса нужно хотя бы раз в год помочь с организацией, то есть поработать волонтёром. Бегать каждую субботу и ходить на завтрак клуб не требует." },
      { tags: ['inference', 'main-idea'], prompt: "Which statement best describes the club?",
        key: "It is open to runners of any level", distractors: ["It is mainly for fast, experienced runners", "It has always been a very large group", "Breakfast is part of the official program"], at: 2,
        explanation: "Правило «nobody runs alone», много новичков и дистанции от 5 км показывают, что клуб открыт для любого уровня. Начинали с пяти человек, а завтрак — неофициальная традиция части участников." },
    ],
  },
  {
    id: 'rd-b1-03', level: 'B1', context: 'life',
    text: "NEW IN LORVETA? Getting around is easy. Buses, trams and the metro all use one card, the GoCard. You can buy it at any metro station for $5 and add money at the machines or in the app. A single trip costs $1.50, but after three trips in one day, the rest of the day is free. Students and people over 65 pay half price, but they need to show an ID card when they buy the GoCard.",
    questions: [
      { tags: ['numbers', 'inference'], prompt: "You already have a GoCard. How much will five trips in one day cost?",
        key: "$4.50", distractors: ["$7.50", "$1.50", "$6.00"], at: 3,
        explanation: "Платишь только за первые три поездки (3 × $1.50 = $4.50), потом «the rest of the day is free». $7.50 получилось бы, если платить за все пять поездок." },
      { tags: ['inference', 'rule-application'], prompt: "What is true for a 70-year-old visitor?",
        key: "They need ID to get the lower fare", distractors: ["They can only top up the card in the app", "They ride free after their first trip", "They don't need a card to travel"], at: 1,
        explanation: "Люди старше 65 платят половину, но «they need to show an ID card when they buy the GoCard», так что без документа скидки не будет. Бесплатно все ездят только после трёх поездок за день, а пополнять карту можно и в автоматах." },
    ],
  },
  {
    id: 'rd-b2-01', level: 'B2', context: 'life',
    text: "Digital nomad visas were sold as a simple deal: bring your remote income, spend it locally and enjoy the lifestyle. The reality has turned out to be more complicated. In several popular destinations, rents in central neighborhoods have risen sharply, and some residents blame the newcomers. Governments have responded in different ways. Some have raised the minimum income required, effectively limiting the visas to higher earners. Others have introduced tax obligations after a certain number of days, which many applicants only discover after they arrive. For freelancers, the lesson is not to avoid these programs, but to read the conditions as carefully as a client contract.",
    questions: [
      { tags: ['inference', 'cohesion'], prompt: "According to the article, why did some governments raise the income requirement?",
        key: "To react to rising rents and local complaints", distractors: ["To collect more tax from people who move there", "To keep the original simple deal working", "To stop freelancers from applying at all"], at: 2,
        explanation: "Сначала автор пишет о росте аренды и недовольстве жителей, а затем: «Governments have responded in different ways», и повышение порога дохода — один из таких ответов. Налоги — отдельная мера других стран, а подавать заявки фрилансерам никто не запрещал." },
      { tags: ['main-idea', 'paraphrase'], prompt: "What is the writer's main advice to freelancers?",
        key: "Treat the visa terms like a contract you'd sign", distractors: ["Avoid these visas until the rules settle down", "Choose places where rents are still low", "Apply before more governments change the rules"], at: 1,
        explanation: "Вывод: «not to avoid these programs, but to read the conditions as carefully as a client contract», то есть относиться к условиям визы так же внимательно, как к договору. Отказываться от таких виз автор как раз не советует." },
    ],
  },
  {
    id: 'rd-b2-02', level: 'B2', context: 'work',
    text: "When AI video tools first appeared, many agencies assumed they would simply make production faster and cheaper. What actually happened was more interesting. Clients did start expecting quicker turnarounds, but they also began asking for more versions of every idea: different endings, different formats, different markets. As a result, much of the time saved in production was spent on iteration instead. The creators who benefited most were not necessarily the fastest operators, but those who could keep a consistent look across dozens of variations without losing the original concept. In other words, the bottleneck shifted from making images to making decisions.",
    questions: [
      { tags: ['inference', 'paraphrase'], prompt: "Why did AI tools save agencies less time than expected?",
        key: "Clients' extra requests ate up the savings", distractors: ["The tools made production slower at first", "Agencies used the time to find new clients", "Fast operators became too expensive to hire"], at: 0,
        explanation: "Время, сэкономленное на производстве, ушло на доработки: клиенты стали просить больше версий каждой идеи («much of the time saved in production was spent on iteration instead»). Производство при этом не замедлилось, а ускорилось." },
      { tags: ['inference'], prompt: "What does \"the bottleneck shifted from making images to making decisions\" mean here?",
        key: "Judgment, not production, became the main limit", distractors: ["Production became much slower than before", "Clients now make all the creative decisions", "AI tools now choose the images for the video"], at: 3,
        explanation: "Узким местом стало не производство картинки, а решения: держать единый стиль и концепцию в десятках вариантов. Производство, наоборот, ускорилось, а клиенты просят больше версий, но не принимают все решения сами." },
    ],
  },
  {
    id: 'rd-b2-03', level: 'B2', context: 'life',
    text: "Most travelers try to beat jet lag by sleeping on the plane, but researchers say light matters more than sleep. The body clock is reset mainly by daylight, so what counts is when you see it after you land. After flying east, it helps to get bright light in the morning and avoid it in the late afternoon; after flying west, the opposite is true. Melatonin can help a little, but only at the right time, and caffeine mostly hides the problem rather than solving it. The old advice to stay awake until bedtime does work, the researchers add, but mainly because it keeps people outside in daylight.",
    questions: [
      { tags: ['inference', 'rule-application'], prompt: "You've just flown west. Which advice from the text applies to you?",
        key: "Seek daylight later in the day", distractors: ["Get outside early in the morning", "Take melatonin as soon as you land", "Have a coffee to stay alert"], at: 3,
        explanation: "После перелёта на восток нужен утренний свет, а «after flying west, the opposite is true», то есть после полёта на запад свет нужен ближе к вечеру. Утренний свет — совет для восточного направления, а кофе, по тексту, лишь маскирует проблему." },
      { tags: ['concession', 'inference'], prompt: "How do the researchers see the old advice about staying awake?",
        key: "It works, but for a different reason", distractors: ["It's a myth that doesn't really help", "It works because it makes people tired", "It only helps after flying east"], at: 0,
        explanation: "Исследователи признают, что совет «does work», но объясняют это светом: он помогает «mainly because it keeps people outside in daylight», а не потому, что человек сильнее устаёт. Мифом они его не называют и к направлению полёта не привязывают." },
    ],
  },
  {
    id: 'rd-c1-01', level: 'C1', context: 'work',
    text: "There is a persistent myth that whoever names a number first in a negotiation loses. The research suggests almost the opposite: an opening figure acts as an anchor, and later offers tend to orbit around it, even when both sides know it is arbitrary. The catch is that an anchor only works if it is credible. Open absurdly high and you do not so much anchor the conversation as end it. The useful question, then, is not whether to go first, but whether you have done enough homework to make your number defensible. Freelancers who quote from a clear rationale tend to fare better than those who hide behind \"What's your budget?\"",
    questions: [
      { tags: ['paraphrase', 'structure'], prompt: "What does the writer mean by \"you do not so much anchor the conversation as end it\"?",
        key: "It closes the conversation rather than framing it", distractors: ["It frames the conversation more than it closes it", "It frames the conversation and then closes it", "It closes the conversation only if it's arbitrary"], at: 2,
        explanation: "Конструкция not so much… as… означает «не столько…, сколько…»: абсурдная цифра не задаёт рамку разговора, а обрывает его. Вариант «скорее задаёт рамку, чем обрывает» переворачивает смысл." },
      { tags: ['main-idea', 'inference'], prompt: "Which statement best reflects the writer's position?",
        key: "Going first helps if your number is well justified", distractors: ["You should always let the client name a budget first", "Opening with a very high number is the safest strategy", "Research shows that most negotiation advice is a myth"], at: 0,
        explanation: "Главный вопрос, по словам автора, — не кто называет цифру первым, а можно ли её защитить («make your number defensible»). Прятаться за «What's your budget?» менее выгодно, чем назвать обоснованную цифру." },
    ],
  },
  {
    id: 'rd-c1-02', level: 'C1', context: 'life',
    text: "Ask adult language learners where they got stuck, and many will describe the same place: the point at which they could get by in almost any situation, yet still sounded unmistakably foreign, not so much in accent as in phrasing. The irony is that getting by is precisely what entrenches the plateau. Once people can make themselves understood, the pressure to notice their own errors largely disappears; listeners tolerate them, conversations carry on, and the errors quietly harden into habits. Breaking through tends to require deliberately reintroducing that pressure, which is less comfortable than chatting and exactly why so few people do it.",
    questions: [
      { tags: ['inference', 'paraphrase'], prompt: "What does the writer present as ironic?",
        key: "Being understood is what stops progress", distractors: ["Learners sound foreign despite a good accent", "More conversation leads to fewer errors", "Listeners notice errors but say nothing"], at: 1,
        explanation: "Ирония в том, что «getting by is precisely what entrenches the plateau»: умение объясниться и есть то, что тормозит рост. То, что учащиеся звучат иностранно «not so much in accent as in phrasing», — факт из текста, но иронией автор называет не его." },
      { tags: ['inference', 'reference'], prompt: "According to the writer, what does breaking through require?",
        key: "Making your mistakes matter again on purpose", distractors: ["Chatting more often with very tolerant listeners", "Focusing on accent rather than on phrasing", "Getting by in a wider range of situations"], at: 3,
        explanation: "«That pressure» отсылает к давлению замечать свои ошибки, которое исчезает, когда тебя и так понимают; прорыв требует «deliberately reintroducing» его, то есть сознательно сделать ошибки снова значимыми. Больше болтать с терпеливыми слушателями — как раз то, что закрепляет плато." },
    ],
  },
  {
    id: 'rd-c1-03', level: 'C1', context: 'life',
    text: "Emigrants often describe a peculiar double vision. The place they left keeps changing in their absence, yet in memory it stays fixed at the moment of departure, so every visit home brings a small shock of both recognition and estrangement. Meanwhile, the new country rarely feels fully native, however fluent one becomes. Some find this unsettling; others come to regard it as an advantage, since standing slightly outside two cultures makes the unspoken assumptions of each easier to see. Whether it is experienced as loss or as perspective seems to depend less on the move itself than on whether it was chosen.",
    questions: [
      { tags: ['inference', 'integration'], prompt: "What does the writer mean by \"double vision\"?",
        key: "Feeling not quite at home in either place", distractors: ["Seeing the new culture more clearly than home", "Remembering home as better than it really was", "Living between two countries for work"], at: 2,
        explanation: "Автор раскрывает это сразу: дом в памяти «stays fixed», поэтому визиты туда приносят «recognition and estrangement», а новая страна «rarely feels fully native», и человек не до конца свой ни там, ни там. Идеализации дома в тексте нет: память его не приукрашивает, а «замораживает»." },
      { tags: ['inference', 'application'], prompt: "Who is most likely to find this experience an advantage?",
        key: "A person who moved because they wanted to", distractors: ["A person who has become fully fluent", "A person who seldom goes back home", "A person who had no choice about leaving"], at: 1,
        explanation: "Последняя фраза: восприятие зависит «less on the move itself than on whether it was chosen», значит, плюсом это скорее увидит тот, кто уехал по своей воле. Беглость, по тексту, новую страну родной не делает («however fluent one becomes»)." },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Language: 10 per level (6 grammar + 4 vocabulary) plus 3 optional C2. Gaps are shown as "____".
// Tags matching attested learner patterns (question-aux, prep-direction, agreement, past-participle, be-based,
// will-in-if-clause, indirect-question, compound-age) feed the result's language targets.

const LANGUAGE: PlacementItem[] = [
  // A2
  grammar({ id: 'gr-a2-01', level: 'A2', context: 'life', tags: ['question-aux'],
    prompt: "Your sister is a designer, right? ____ work from home too?",
    key: "Does she", distractors: ["Is she", "Do she", "Has she"], at: 1,
    explanation: "С обычным глаголом (work) вопрос строится через do/does, а для she — does: Does she work…? «Is she work» — частая ошибка: is не ставится перед смысловым глаголом." }),
  grammar({ id: 'gr-a2-02', level: 'A2', context: 'life', tags: ['prep-direction'],
    prompt: "Next summer we're flying ____ Portugal to visit my cousin.",
    key: "to", distractors: ["in", "at", "on"], at: 0,
    explanation: "Направление движения (куда?) передаёт to: fly to Portugal. In отвечает на вопрос «где?», а at и on со странами не используются." }),
  grammar({ id: 'gr-a2-03', level: 'A2', context: 'work', tags: ['agreement', 'relative'],
    prompt: "I work with a producer who ____ speak Russian, so we always talk in English.",
    key: "doesn't", distractors: ["don't", "isn't", "aren't"], at: 3,
    explanation: "Who относится к a producer (он или она), поэтому глагол в третьем лице: who doesn't speak. «Who don't» — частая ошибка согласования, а isn't и aren't не образуют отрицание с обычным глаголом." }),
  grammar({ id: 'gr-a2-04', level: 'A2', context: 'life', tags: ['past-simple'],
    prompt: "I ____ to the gym yesterday because I was sick.",
    key: "didn't go", distractors: ["haven't gone", "don't go", "wasn't go"], at: 2,
    explanation: "«Yesterday» — законченное прошлое, поэтому отрицание в Past Simple: didn't + глагол (didn't go). Present Perfect (haven't gone) с yesterday не сочетается, а «wasn't go» смешивает be и обычный глагол." }),
  grammar({ id: 'gr-a2-05', level: 'A2', context: 'work', tags: ['countability'],
    prompt: "We don't have ____ time before the call, so let's be quick.",
    key: "much", distractors: ["many", "a few", "few"], at: 0,
    explanation: "Time в значении «время» — неисчисляемое, поэтому much. Many и (a) few ставятся только перед исчисляемыми существительными во множественном числе." }),
  grammar({ id: 'gr-a2-06', level: 'A2', context: 'life', tags: ['comparatives'],
    prompt: "This apartment is nice, but it's ____ than the one we saw yesterday.",
    key: "more expensive", distractors: ["expensiver", "most expensive", "the more expensive"], at: 3,
    explanation: "Длинные прилагательные образуют сравнительную степень через more: more expensive than. Формы «expensiver» нет, а most — превосходная степень, она не сочетается с than." }),
  vocabulary({ id: 'vc-a2-01', level: 'A2', context: 'life', tags: ['collocation'],
    prompt: "Can you ____ a photo of us in front of the fountain?",
    key: "take", distractors: ["make", "do", "put"], at: 1,
    explanation: "Фото по-английски «берут»: take a photo. «Make a photo» — калька с русского «сделать фото», так не говорят." }),
  vocabulary({ id: 'vc-a2-02', level: 'A2', context: 'work', tags: ['phrasal-verb'],
    prompt: "Please ____ your phone before the client meeting starts.",
    key: "turn off", distractors: ["turn up", "take off", "put on"], at: 2,
    explanation: "Turn off — «выключить» прибор. Turn up — «сделать громче», take off — «снять (одежду)», put on — «надеть»." }),
  vocabulary({ id: 'vc-a2-03', level: 'A2', context: 'life', tags: ['confusable'],
    prompt: "Sorry, I can't come to your party on Saturday. I'm ____ all day.",
    key: "busy", distractors: ["free", "boring", "ready"], at: 3,
    explanation: "Busy — «занят», это и объясняет, почему не получится прийти. Free — «свободен», а boring — «скучный» (не путать с bored)." }),
  vocabulary({ id: 'vc-a2-04', level: 'A2', context: 'life', tags: ['collocation'],
    prompt: "My flight ____ at 6 a.m., so I need to be at the airport by four.",
    key: "leaves", distractors: ["goes out", "starts", "opens"], at: 0,
    explanation: "О рейсах, поездах и автобусах говорят leave — «отправляется». Start и open к рейсам не применяются, а go out значит «выходить из дома, гулять»." }),

  // B1
  grammar({ id: 'gr-b1-01', level: 'B1', context: 'life', tags: ['present-perfect', 'past-participle'],
    prompt: "Sorry, Marta isn't home right now. She ____ to the pharmacy, but she'll be back in ten minutes.",
    key: "has gone", distractors: ["has been", "has went", "had gone"], at: 2,
    explanation: "Has gone значит «ушла и ещё не вернулась», поэтому её нет дома; has been означало бы, что она уже сходила и вернулась. «Has went» — ошибка (после have нужна третья форма gone), а had gone не сочетается с «she'll be back»." }),
  grammar({ id: 'gr-b1-02', level: 'B1', context: 'work', tags: ['be-based'],
    prompt: "____ in Prague, but most of my clients are in the US.",
    key: "I'm based", distractors: ["I based", "I'm basing", "I base"], at: 1,
    explanation: "«Базироваться» по-английски — пассивная конструкция be based: I'm based in Prague. «I based» без am — частая ошибка, а base и basing в этом значении не используются." }),
  grammar({ id: 'gr-b1-03', level: 'B1', context: 'work', tags: ['conditional-1', 'will-in-if-clause'],
    prompt: "If the client ____ the draft today, we'll start the animation tomorrow.",
    key: "approves", distractors: ["will approve", "approved", "would approve"], at: 0,
    explanation: "В первом условном после if ставится Present Simple, даже если речь о будущем: If the client approves… we'll start. «If the client will approve» — калька с русского «если одобрит»." }),
  grammar({ id: 'gr-b1-04', level: 'B1', context: 'life', tags: ['indirect-question'],
    prompt: "I'm writing to ask ____ the apartment is still available.",
    key: "if", distractors: ["that", "is", "what"], at: 3,
    explanation: "Косвенный вопрос «да/нет» вводится через if (или whether), а дальше идёт прямой порядок слов: ask if the apartment is still available. That вводит утверждение, а не вопрос, а is и what здесь ломают структуру." }),
  grammar({ id: 'gr-b1-05', level: 'B1', context: 'life', tags: ['modality'],
    prompt: "You ____ bring your laptop tomorrow. The library has computers.",
    key: "don't have to", distractors: ["must not", "cannot", "need not to"], at: 2,
    explanation: "Don't have to = «не обязательно»: компьютеры есть, поэтому ноутбук брать не нужно. Must not и cannot означают запрет, а после need not частица to не ставится." }),
  grammar({ id: 'gr-b1-06', level: 'B1', context: 'life', tags: ['compound-age'],
    prompt: "My neighbor is a ____ student from Brazil.",
    key: "23-year-old", distractors: ["23-years-old", "23 years old", "23-year-olds"], at: 1,
    explanation: "Возраст перед существительным — составное прилагательное через дефисы и без -s: a 23-year-old student. «A 23 years old student» — частая калька, и -s внутри такого прилагательного (years, olds) не ставится." }),
  vocabulary({ id: 'vc-b1-01', level: 'B1', context: 'work', tags: ['business', 'confusable'],
    prompt: "A brand manager asked me: \"How much do you ____ for a 30-second video?\"",
    key: "charge", distractors: ["pay", "cost", "spend"], at: 3,
    explanation: "Charge — «брать плату, назначать цену»: так спрашивают о ставке исполнителя. Pay — платит сам говорящий, а cost говорят о вещи (How much does it cost?), а не о человеке." }),
  vocabulary({ id: 'vc-b1-02', level: 'B1', context: 'life', tags: ['confusable'],
    prompt: "Can you ____ me to call the landlord tomorrow? I always forget.",
    key: "remind", distractors: ["remember", "repeat", "notice"], at: 0,
    explanation: "Remind someone to do something — «напомнить кому-то сделать». Remember значит «помнить, не забыть» и не строится с me в этом смысле." }),
  vocabulary({ id: 'vc-b1-03', level: 'B1', context: 'life', tags: ['phrasal-verb'],
    prompt: "Before I book the tickets, I need to ____ whether I need a visa.",
    key: "find out", distractors: ["look for", "look after", "come across"], at: 1,
    explanation: "Find out — «выяснить, узнать» информацию. Look for — «искать (предмет)», look after — «присматривать», come across — «случайно наткнуться»." }),
  vocabulary({ id: 'vc-b1-04', level: 'B1', context: 'life', tags: ['meaning-in-context'],
    prompt: "I'd love to rent a bigger apartment, but I can't ____ it right now.",
    key: "afford", distractors: ["allow", "pay", "spend"], at: 2,
    explanation: "Can't afford — «не могу себе позволить (по деньгам)». Allow значит «разрешать», а pay и spend не употребляются с квартирой как прямым дополнением." }),

  // B2
  grammar({ id: 'gr-b2-01', level: 'B2', context: 'work', tags: ['conditional-3', 'implied-condition'],
    prompt: "Without your recommendation last spring, the agency ____ me about the campaign.",
    key: "would never have contacted", distractors: ["would never contact", "had never contacted", "will never have contacted"], at: 3,
    explanation: "«Without your recommendation last spring» — скрытое условие о прошлом («если бы не твоя рекомендация»), поэтому нужен результат третьего условного: would never have contacted. Would never contact говорит о настоящем и не сочетается с last spring." }),
  grammar({ id: 'gr-b2-02', level: 'B2', context: 'life', tags: ['passive', 'modal-perfect'],
    prompt: "The lease ____ by a lawyer before we signed it. Now we can't get out of it.",
    key: "should have been checked", distractors: ["should had been checked", "should have checked", "should be checked"], at: 0,
    explanation: "Договор сам ничего не проверяет, поэтому нужен пассив, а упрёк о прошлом — should have been + третья форма: should have been checked. После should всегда have, а не had, should have checked — активный залог, а should be checked не подходит к уже подписанному договору." }),
  grammar({ id: 'gr-b2-03', level: 'B2', context: 'work', tags: ['verb-pattern', 'reported-speech'],
    prompt: "When I asked about the missing files, he denied ____ them with anyone.",
    key: "sharing", distractors: ["to share", "share", "of sharing"], at: 2,
    explanation: "После deny нужен герундий: denied sharing («отрицал, что делился»). «Denied to share» — частая калька с русского, а «of sharing» путают с accused of." }),
  grammar({ id: 'gr-b2-04', level: 'B2', context: 'life', tags: ['wish', 'past-perfect'],
    prompt: "I wish I ____ my umbrella this morning. I'm completely soaked.",
    key: "had brought", distractors: ["have brought", "would bring", "am bringing"], at: 1,
    explanation: "Сожаление о прошлом после wish выражается через Past Perfect: I wish I had brought. Have brought и am bringing после wish невозможны, а would bring выражает желание изменить что-то в будущем." }),
  grammar({ id: 'gr-b2-05', level: 'B2', context: 'work', tags: ['modality', 'modal-perfect'],
    prompt: "The client ____ our email. They replied with comments ten minutes ago.",
    key: "must have read", distractors: ["can't have read", "had to read", "would read"], at: 0,
    explanation: "Уверенный вывод о прошлом — must have + третья форма: раз ответили с комментариями, точно прочитали. Can't have read означает обратное, а had to read — обязанность, а не вывод." }),
  grammar({ id: 'gr-b2-06', level: 'B2', context: 'life', tags: ['relative'],
    prompt: "My roommates, both of ____ work from home, rarely leave the apartment.",
    key: "whom", distractors: ["them", "who", "which"], at: 3,
    explanation: "После предлога (both of) в придаточном о людях нужен whom: both of whom. «Both of them» без союза разрывает предложение, who после предлога не ставится, а which — для предметов." }),
  vocabulary({ id: 'vc-b2-01', level: 'B2', context: 'work', tags: ['collocation'],
    prompt: "We worked all weekend to ____ the deadline.",
    key: "meet", distractors: ["reach", "catch", "win"], at: 1,
    explanation: "Устойчивое сочетание — meet a deadline («уложиться в срок»). Catch и reach — кальки с «успеть» и «достичь», а win с deadline не сочетается." }),
  vocabulary({ id: 'vc-b2-02', level: 'B2', context: 'work', tags: ['phrasal-verb'],
    prompt: "They offered me a full-time job, but I decided to ____ the offer because I want to stay freelance.",
    key: "turn down", distractors: ["turn over", "put down", "take off"], at: 2,
    explanation: "Turn down an offer — «отклонить предложение». Turn over — «перевернуть, передать», put down — «положить, унизить», take off — «снять, взлететь»." }),
  vocabulary({ id: 'vc-b2-03', level: 'B2', context: 'life', tags: ['meaning-in-context'],
    prompt: "At first my brother was ____ to move abroad, but his wife eventually talked him into it.",
    key: "reluctant", distractors: ["determined", "unable", "forbidden"], at: 0,
    explanation: "Reluctant — «не хотел, сопротивлялся»: жене пришлось его уговаривать (talked him into it). Determined значит «твёрдо решил», а unable и forbidden говорят о невозможности и запрете, а не о нежелании." }),
  vocabulary({ id: 'vc-b2-04', level: 'B2', context: 'life', tags: ['register', 'confusable'],
    prompt: "I am writing to ____ about the status of my residence permit application.",
    key: "inquire", distractors: ["require", "acquire", "request"], at: 3,
    explanation: "Inquire about — нейтрально-официальное «осведомиться», так пишут в деловых письмах. Require — «требовать», acquire — «приобретать», а request не употребляется с about (request information about)." }),

  // C1
  grammar({ id: 'gr-c1-01', level: 'C1', context: 'work', tags: ['inversion'],
    prompt: "Not only ____ the deadline, but they also cut the budget.",
    key: "did they move", distractors: ["they moved", "they did move", "did they moved"], at: 1,
    explanation: "После отрицательного выражения в начале предложения (Not only) нужна инверсия, как в вопросе: did they move. Прямой порядок (they moved, they did move) здесь ошибочен, а после did глагол стоит в начальной форме, не moved." }),
  grammar({ id: 'gr-c1-02', level: 'C1', context: 'life', tags: ['passive', 'perfect-infinitive'],
    prompt: "The castle ____ in just two years, back in the 1600s.",
    key: "is said to have been built", distractors: ["is said to be built", "is said to have built", "is said to having been built"], at: 3,
    explanation: "Сложный пассив с перфектным инфинитивом: is said to have been built — «говорят, что был построен», а to have been указывает на прошлое (back in the 1600s). Is said to be built не сочетается с прошедшим временем, is said to have built — актив, а после to нужен инфинитив, а не having." }),
  grammar({ id: 'gr-c1-03', level: 'C1', context: 'work', tags: ['cleft', 'discourse'],
    prompt: "It's not that I don't value the exposure; ____ I can't pay my rent with it.",
    key: "it's that", distractors: ["it's what", "that's why", "it's so"], at: 0,
    explanation: "Рамка It's not that X; it's that Y противопоставляет мнимую причину настоящей: «дело не в том, что…, а в том, что…». That's why вводит следствие и ломает логику, а it's what и it's so в этой рамке не используются." }),
  grammar({ id: 'gr-c1-04', level: 'C1', context: 'life', tags: ['inversion', 'conditional-3'],
    prompt: "____ about the cleaning fee, I would never have booked that apartment.",
    key: "Had I known", distractors: ["Did I know", "If I would know", "Were I to know"], at: 2,
    explanation: "Had I known = If I had known: инверсия вместо if в третьем условном. Were I to know говорит о будущем или воображаемом настоящем, а would в условной части не ставится." }),
  grammar({ id: 'gr-c1-05', level: 'C1', context: 'life', tags: ['modality', 'modal-perfect'],
    prompt: "You ____ told me the party was moved! I drove all the way across town for nothing.",
    key: "might have", distractors: ["must have", "would have", "can have"], at: 1,
    explanation: "Might have + третья форма с интонацией упрёка значит «мог бы и сказать!»: так выражают недовольство тем, чего человек не сделал. Must have — уверенный вывод («наверняка сказал»), а он противоречит поездке впустую." }),
  grammar({ id: 'gr-c1-06', level: 'C1', context: 'life', tags: ['participle-clause', 'passive'],
    prompt: "____ twice by previous landlords, we asked for every repair cost in writing.",
    key: "Having been overcharged", distractors: ["Having overcharged", "Overcharging", "To be overcharged"], at: 3,
    explanation: "Перфектный пассивный оборот: нас уже дважды обсчитывали раньше — Having been overcharged; having been показывает, что это случилось до основного действия. Having overcharged и Overcharging значили бы, что обсчитывали мы сами, а To be overcharged выражает цель." }),
  vocabulary({ id: 'vc-c1-01', level: 'C1', context: 'work', tags: ['phrasal-verb'],
    prompt: "The deal ____ at the last minute when the brand's budget was frozen.",
    key: "fell through", distractors: ["fell behind", "fell out", "fell off"], at: 0,
    explanation: "Fall through — «сорваться» о сделке или плане. Fall behind — «отстать», fall out — «поссориться», fall off — «упасть, снизиться»." }),
  vocabulary({ id: 'vc-c1-02', level: 'C1', context: 'life', tags: ['idiom', 'collocation'],
    prompt: "Moving countries twice in one year was a steep learning ____, but I'd do it again.",
    key: "curve", distractors: ["line", "path", "slope"], at: 2,
    explanation: "Steep learning curve — устойчивое «пришлось быстро многому учиться». С line, path и slope такого выражения нет, хотя slope и похоже по смыслу." }),
  vocabulary({ id: 'vc-c1-03', level: 'C1', context: 'life', tags: ['meaning-in-context'],
    prompt: "Her reply was ____: \"Interesting. Let's see how things go.\"",
    key: "noncommittal", distractors: ["unequivocal", "effusive", "emphatic"], at: 1,
    explanation: "Noncommittal — «уклончивый, ни к чему не обязывающий»: «посмотрим» ничего не обещает. Unequivocal — «однозначный», effusive — «рассыпающийся в похвалах», emphatic — «категоричный»." }),
  vocabulary({ id: 'vc-c1-04', level: 'C1', context: 'life', tags: ['idiom'],
    prompt: "I hate calling the tax office, but I'll have to bite the ____ and do it today.",
    key: "bullet", distractors: ["dust", "tongue", "hand"], at: 3,
    explanation: "Bite the bullet — «стиснуть зубы и сделать неприятное». Bite the dust — «потерпеть крах», bite your tongue — «промолчать», а bite the hand — из другой идиомы («кусать руку, которая кормит»)." }),

  // C2 — optional ceiling checks.
  grammar({ id: 'gr-c2-01', level: 'C2', context: 'life', tags: ['fixed-expression'],
    prompt: "____ it to say that the move didn't go as planned.",
    key: "Suffice", distractors: ["Needless", "Strange", "Fair"], at: 2,
    explanation: "Suffice it to say — книжное устойчивое «достаточно сказать» с формой сослагательного наклонения и it. Needless to say, strange to say и fair to say тоже существуют, но без it в этом месте." }),
  grammar({ id: 'gr-c2-02', level: 'C2', context: 'work', tags: ['fixed-expression', 'emphasis'],
    prompt: "The client took the files and left without so ____ as a thank-you.",
    key: "much", distractors: ["long", "far", "many"], at: 0,
    explanation: "Without so much as = «даже не…, без малейшего…»: ушёл, даже не поблагодарив. So long as и so far as — союзы со значением «при условии» и «насколько», а so many as здесь невозможно." }),
  vocabulary({ id: 'vc-c2-01', level: 'C2', context: 'work', tags: ['collocation', 'confusable'],
    prompt: "The client canceled the project, so the question of who pays for the extra edits is now ____.",
    key: "moot", distractors: ["mute", "mooted", "muted"], at: 1,
    explanation: "Moot — «потерявший смысл, неактуальный»: проект отменён, и спор о доплате больше ничего не решает. Mute и muted — «немой, приглушённый» (mute point — частая ошибка по созвучию), а mooted значит «предложенный к обсуждению»." }),
];

// ---------------------------------------------------------------------------------------------------------------

export const PLACEMENT_ITEMS: PlacementItem[] = [
  ...CLIPS.flatMap(clipItems),
  ...PASSAGES.flatMap(passageItems),
  ...LANGUAGE,
];

/** Voice casting per listening clip, keyed by groupId (= clip id used in 'placement/audio/<clipId>'). */
export const LISTENING_CASTS: Record<string, ListeningCast> = Object.fromEntries(CLIPS.map(clip => [clip.id, clip.cast]));

const ITEMS_BY_ID = new Map(PLACEMENT_ITEMS.map(item => [item.id, item]));

export function itemById(id: string): PlacementItem | undefined {
  return ITEMS_BY_ID.get(id);
}

export function itemsFor(skill: BankSkill, level: BankLevel): PlacementItem[] {
  return PLACEMENT_ITEMS.filter(item => item.skill === skill && item.level === level);
}

/** One listening clip or reading passage with its questions (in bank order). */
export interface PlacementStimulus {
  groupId: string; skill: 'listening' | 'reading'; level: BankLevel; context: ItemContext; passage: string; items: PlacementItem[];
}

export function stimuliFor(skill: 'listening' | 'reading', level: BankLevel): PlacementStimulus[] {
  const groups = new Map<string, PlacementStimulus>();
  for (const item of itemsFor(skill, level)) {
    if (!item.groupId) continue;
    const group = groups.get(item.groupId)
      ?? { groupId: item.groupId, skill, level, context: item.context ?? 'life', passage: item.passage ?? '', items: [] };
    group.items.push(item);
    groups.set(item.groupId, group);
  }
  return [...groups.values()];
}
