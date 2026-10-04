import { CEFR_VALUE, PLACEMENT_PROCEDURE_VERSION, cefrFromScore, type CEFRLevel, type PlacementResult,
  type PlacementSkillId, type PlacementSkillResult } from '../../placement/types';
import { SECTION_RULES, levelIndex, posteriorFrom, summarisePosterior, type ObjectiveSkill } from '../../placement/engine';
import { CONFIDENCE_RU, CORE_LANGUAGE_TAGS, SKILL_BAND_NOTES, TIMING_CONFLICT_NOTE, aggregateInteraction, aggregateSpeaking, countFillers,
  overallFromSkills, placementHeadline, plural, ratedRange, tagTitle, type RatedRole, type SpeakingTaskRating } from '../../placement/scoring';
import { bankItem, type PlacementBank } from './bank-source';
import { SECTION_INFO, iso, spokenRef, type AttemptRecord, type RatedScoring, type SpokenRecord } from './model';
import { answeredObjective, answeredSpoken, insufficientSpeech, recordMetrics, toEvidence, verbatimText } from './records';

const round1 = (value: number) => Math.round(value * 10) / 10;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function unmeasured(id: PlacementSkillId, note: string | null | undefined): PlacementSkillResult {
  return { id, level: null, label: null, score: null, confidence: 'low', basis: 'Не измерено',
    note: note?.trim() || 'Раздел пропущен.', range: null, answered: null, correct: null };
}

function objectiveSkill(id: ObjectiveSkill, attempt: AttemptRecord, bank: PlacementBank): PlacementSkillResult {
  const section = id === 'grammar' || id === 'vocabulary' ? 'language' : id;
  const sectionRecord = attempt.sections[section];
  if (sectionRecord.status === 'skipped') return unmeasured(id, sectionRecord.note);
  const records = answeredObjective(attempt, record => record.skill === id);
  if (!records.length) return unmeasured(id, 'В этом разделе не нашлось заданий.');
  const minQuestions = section === 'language' ? Math.ceil(SECTION_RULES.language.minQuestions / 2) : SECTION_RULES[section].minQuestions;
  const summary = summarisePosterior(posteriorFrom(records.map(record => toEvidence(record, bank))), records.length, minQuestions);
  const correct = records.filter(record => record.correct).length;
  const stimuli = new Set(records.map(record => record.stimulus)).size;
  const questions = plural(records.length, ['вопрос', 'вопроса', 'вопросов']);
  const basis = id === 'listening' ? `${plural(stimuli, ['запись', 'записи', 'записей'])}, ${questions}, ${correct} верно`
    : id === 'reading' ? `${plural(stimuli, ['текст', 'текста', 'текстов'])}, ${questions}, ${correct} верно`
    : `${plural(records.length, ['задание', 'задания', 'заданий'])}, ${correct} верно`;
  return { id, level: summary.level, label: summary.label, score: summary.score, confidence: summary.confidence, basis,
    note: SKILL_BAND_NOTES[id][summary.level], range: summary.range, answered: records.length, correct };
}

function speakingTimingBlock(records: readonly SpokenRecord[]): PlacementResult['speaking']['timing'] {
  const timed = records.filter(record => record.speechTiming && record.speechTiming.quality !== 'no-speech');
  if (!timed.length) return null;
  const spans = timed.filter(record => record.speechTiming!.speechSpanSeconds >= 5);
  const spanSeconds = sum(spans.map(record => record.speechTiming!.speechSpanSeconds));
  const paced = timed.filter(record => record.speechTiming!.approximateWordsPerMinute !== null && record.speechTiming!.recognizedWords !== null);
  const pacedSpan = sum(paced.map(record => record.speechTiming!.speechSpanSeconds));
  const runs = timed.filter(record => !record.speechTiming!.transcriptEdited && record.speechTiming!.recognizedWords !== null);
  const latencies = timed.map(recordMetrics).flatMap(metrics => metrics?.latencySeconds !== null && metrics?.latencySeconds !== undefined ? [metrics.latencySeconds] : []);
  return {
    wordsPerMinute: pacedSpan > 0 ? round1(sum(paced.map(record => record.speechTiming!.recognizedWords!)) * 60 / pacedSpan) : null,
    pausesPerMinute: spanSeconds > 0 ? round1(sum(spans.map(record => record.speechTiming!.internalPauseCount)) * 60 / spanSeconds) : null,
    longestPauseSeconds: round1(Math.max(...timed.map(record => record.speechTiming!.longestPauseSeconds))),
    meanLengthOfRun: runs.length ? round1(sum(runs.map(record => record.speechTiming!.recognizedWords!))
      / sum(runs.map(record => record.speechTiming!.internalPauseCount + 1))) : null,
    fillersPerMinute: spanSeconds > 0 ? round1(sum(spans.map(record => countFillers(verbatimText(record)).fillers)) * 60 / spanSeconds) : null,
    latencySeconds: latencies.length ? round1(sum(latencies) / latencies.length) : null,
  };
}

function spokenPart(attempt: AttemptRecord, rated: RatedScoring | null) {
  const speakingRecords = answeredSpoken(attempt, 'speaking');
  const ratedRecords = speakingRecords.filter(record => record.role !== 'R0');
  const roleplayRecords = answeredSpoken(attempt, 'interaction');
  const ratings = new Map((rated?.tasks ?? []).map(task => [task.ref, task]));
  const taskRatings: SpeakingTaskRating[] = ratedRecords.map(record => {
    const rating = ratings.get(spokenRef(record));
    return { role: record.role as RatedRole, taskLevel: CEFR_VALUE[record.level ?? 'B1'],
      insufficient: insufficientSpeech(record) || !!rating?.insufficient, edited: record.transcriptEdited,
      timingQuality: record.speechTiming?.quality ?? null, range: rating?.range ?? null, accuracy: rating?.accuracy ?? null,
      fluency: rating?.fluency ?? null, coherence: rating?.coherence ?? null, metrics: recordMetrics(record) };
  });
  const aggregate = aggregateSpeaking(taskRatings);
  const notes: string[] = [];
  let speaking: PlacementSkillResult;
  if (attempt.sections.speaking.status === 'skipped') speaking = unmeasured('speaking', attempt.sections.speaking.note);
  else if (aggregate.score === null) {
    speaking = { ...unmeasured('speaking', ratedRecords.length
      ? 'Ответы оказались слишком короткими для оценки: нужно хотя бы 15 секунд речи на задание.' : 'Нет ответов голосом для оценки.'),
    basis: ratedRecords.length ? `${plural(ratedRecords.length, ['ответ', 'ответа', 'ответов'])}, речи недостаточно` : 'Не измерено' };
  } else {
    const { level, label } = cefrFromScore(aggregate.score);
    speaking = { id: 'speaking', level, label, score: aggregate.score, confidence: aggregate.confidence,
      basis: `${plural(aggregate.usableRecordings, ['ответ', 'ответа', 'ответов'])} голосом, оценка по критериям CEFR`,
      note: [SKILL_BAND_NOTES.speaking[level], rated?.speakingNextBand?.trim()].filter(Boolean).join(' '),
      range: ratedRange(aggregate.score, aggregate.confidence), answered: null, correct: null };
    if (aggregate.conflict) notes.push(TIMING_CONFLICT_NOTE);
    if (aggregate.guardrailMissing) notes.push('Беглость оценена по расшифровке: замеров темпа по записи не хватило.');
  }
  const short = taskRatings.filter(task => task.insufficient).length;
  if (short && attempt.sections.speaking.status !== 'skipped') notes.push(`Ответов короче 15 секунд речи, не вошедших в оценку: ${short}.`);
  const edited = [...ratedRecords, ...roleplayRecords].filter(record => record.transcriptEdited).length;
  if (edited) notes.push(`Ответов с исправленной вручную расшифровкой: ${edited}. Их вес в оценке снижен.`);
  const readAloud = speakingRecords.find(record => record.role === 'R0')?.speechTiming?.approximateWordsPerMinute ?? null;
  const spontaneous = ratedRecords.map(record => record.speechTiming?.approximateWordsPerMinute ?? null).filter((value): value is number => value !== null);
  if (readAloud && spontaneous.length) {
    notes.push(`Спонтанный темп около ${Math.round(100 * sum(spontaneous) / spontaneous.length / readAloud)}% от темпа чтения вслух.`);
  }

  const followUp = taskRatings.find(task => task.role === 'F2' && !task.insufficient);
  const followUpInteraction = followUp ? ratings.get('f2')?.interaction ?? null : null;
  let interaction: PlacementSkillResult;
  if (attempt.sections.interaction.status === 'skipped') interaction = unmeasured('interaction', attempt.sections.interaction.note);
  else {
    const combined = aggregateInteraction({ roleplay: rated?.roleplayInteraction ?? null, followUp: followUpInteraction,
      answeredTurns: roleplayRecords.length, editedTurns: roleplayRecords.filter(record => record.transcriptEdited).length });
    if (combined.score === null) interaction = unmeasured('interaction', 'Разговор не удалось оценить.');
    else {
      const { level, label } = cefrFromScore(combined.score);
      interaction = { id: 'interaction', level, label, score: combined.score, confidence: combined.confidence,
        basis: `Ролевая сцена, ${plural(roleplayRecords.length, ['реплика', 'реплики', 'реплик'])}${followUpInteraction !== null ? ', вопрос без подготовки' : ''}`,
        note: [SKILL_BAND_NOTES.interaction[level], rated?.interactionNextBand?.trim()].filter(Boolean).join(' '),
        range: ratedRange(combined.score, combined.confidence), answered: null, correct: null };
    }
  }
  const criterion = (value: number | null) => value === null ? { level: null, label: null } : cefrFromScore(value);
  const block: PlacementResult['speaking'] = {
    range: criterion(aggregate.criteria.range).level, accuracy: criterion(aggregate.criteria.accuracy).level,
    fluency: criterion(aggregate.criteria.fluency).level, coherence: criterion(aggregate.criteria.coherence).level,
    labels: { range: criterion(aggregate.criteria.range).label, accuracy: criterion(aggregate.criteria.accuracy).label,
      fluency: criterion(aggregate.criteria.fluency).label, coherence: criterion(aggregate.criteria.coherence).label },
    timing: speakingTimingBlock(ratedRecords),
    examples: rated?.examples ?? [],
    errors: (rated?.errors ?? []).map(({ quote, correction, tag, impact }) => ({ quote, correction, tag, impact })),
    notes,
  };
  return { speaking, interaction, block };
}

function languageTargets(attempt: AttemptRecord, bank: PlacementBank, skills: readonly PlacementSkillResult[], rated: RatedScoring | null): PlacementResult['languageTargets'] {
  const byTag = new Map<string, { level: number; count: number }>();
  for (const skillId of ['grammar', 'vocabulary'] as const) {
    const level = skills.find(skill => skill.id === skillId)?.level;
    if (!level) continue;
    for (const record of answeredObjective(attempt, item => item.skill === skillId && !item.correct && levelIndex(item.level) <= levelIndex(level))) {
      for (const tag of bankItem(bank, record.itemId)?.tags ?? []) {
        const previous = byTag.get(tag);
        byTag.set(tag, { level: Math.min(previous?.level ?? 9, levelIndex(record.level)), count: (previous?.count ?? 0) + 1 });
      }
    }
  }
  const errors = rated?.errors ?? [];
  const targets: PlacementResult['languageTargets'] = [...byTag.entries()]
    .sort((left, right) => left[1].level - right[1].level || right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .map(([tag]) => { const error = errors.find(item => item.tag === tag);
      return { tag, title: tagTitle(tag, error?.title), quote: error?.quote ?? null, correction: error?.correction ?? null }; });
  // Then speaking errors that change meaning or sound junior, fossilised basics (core pattern tags) first.
  const core = new Set<string>(CORE_LANGUAGE_TAGS);
  const spoken = errors.filter(item => item.impact !== 'minor')
    .sort((left, right) => Number(core.has(right.tag)) - Number(core.has(left.tag)));
  for (const error of spoken) {
    if (!targets.some(target => target.tag === error.tag)) targets.push({ tag: error.tag, title: tagTitle(error.tag, error.title), quote: error.quote, correction: error.correction });
  }
  return targets.slice(0, 3);
}

const PRIORITY_TEMPLATES: Record<PlacementSkillId, { title: string; action: string }> = {
  listening: { title: 'Понимание на слух', action: 'Каждый день слушай одну короткую рабочую запись и пересказывай главное и все цифры.' },
  reading: { title: 'Чтение брифов и условий', action: 'Разбирай по одному брифу или письму: главное, сроки, деньги и права.' },
  grammar: { title: 'Базовая грамматика', action: 'Повтори ошибки из разбора теста короткими фразами вслух, по пять минут в день.' },
  vocabulary: { title: 'Рабочий словарь', action: 'Собери десять выражений для разговора о проекте, сроках и цене и используй их в практике.' },
  speaking: { title: 'Связная речь', action: 'Отвечай на рабочие вопросы по схеме: ответ, факт с цифрой, следующий шаг.' },
  interaction: { title: 'Ведение разговора', action: 'В практике задавай один вопрос по делу и закрывай разговор следующим шагом.' },
};

function objectivePriorities(skills: readonly PlacementSkillResult[], overallScore: number): PlacementResult['priorities'] {
  const priorities: PlacementResult['priorities'] = [];
  if (skills.find(skill => skill.id === 'speaking')?.score === null) {
    priorities.push({ title: 'Проверить речь голосом', why: 'Говорение и разговор в этот раз не измерены, а на звонках это главное.',
      action: 'Подключи голос в настройках и пройди тест заново, когда будет 15 минут.' });
  }
  const weakest = skills.filter(skill => skill.score !== null && skill.score <= overallScore).sort((left, right) => left.score! - right.score!);
  for (const skill of weakest.slice(0, 3 - priorities.length)) {
    priorities.push({ title: PRIORITY_TEMPLATES[skill.id].title, why: `Сейчас около ${skill.label}, это самый низкий из измеренных навыков.`,
      action: PRIORITY_TEMPLATES[skill.id].action });
  }
  return priorities.length ? priorities : [{ title: 'Держать уровень в живой речи', why: 'Навыки ровные, расти дальше проще всего через практику разговоров.',
    action: 'Проходи по одной рабочей сцене в день и разбирай ответы.' }];
}

function limitations(attempt: AttemptRecord, rated: RatedScoring | null): string[] {
  const list: string[] = [];
  if (rated) list.push('Говорение и разговор оценены Sol по описаниям CEFR и пока не сверены с оценками живых экзаменаторов.',
    'Произношение и акцент не оцениваются: Sol видит только расшифровку и автоматические замеры пауз.');
  list.push('Задания новые и не откалиброваны на других учениках. Это ориентир, а не сертификат.',
    'Тест короткий, поэтому рядом с уровнем показан диапазон: настоящий уровень может быть на полшага выше или ниже.');
  for (const id of ['listening', 'speaking', 'interaction'] as const) {
    if (attempt.sections[id].status === 'skipped') list.push(`${SECTION_INFO[id].title}: не измерено, раздел пропущен.`);
  }
  if (attempt.objective.some(record => record.reusedExposure && record.answeredAt && !record.voided)) {
    list.push('Часть заданий уже встречалась в прошлых попытках, по ним результат может быть немного завышен.');
  }
  return list;
}

/** Combine objective posteriors and the validated model rating into the stored result (audit §2.8–2.10). */
export function buildPlacementResult(attempt: AttemptRecord, bank: PlacementBank, rated: RatedScoring | null, now: number): PlacementResult {
  const spoken = spokenPart(attempt, rated);
  const skills: PlacementSkillResult[] = [objectiveSkill('listening', attempt, bank), objectiveSkill('reading', attempt, bank),
    objectiveSkill('grammar', attempt, bank), objectiveSkill('vocabulary', attempt, bank), spoken.speaking, spoken.interaction];
  const overall = overallFromSkills(skills) ?? { score: 1, level: 'A1' as CEFRLevel, label: 'A1', confidence: 'low' as const };
  const scores = Object.fromEntries(skills.map(skill => [skill.id, skill.score])) as Record<PlacementSkillId, number | null>;
  const lead = `Общий ориентир ${overall.label} (медиана навыков, уверенность ${CONFIDENCE_RU[overall.confidence]}).`;
  const tail = rated?.summary?.trim() || (scores.speaking === null ? 'Речь в этот раз не измерена, поэтому ориентир опирается на понимание и язык.' : '');
  const review = answeredObjective(attempt).flatMap(record => {
    const item = bankItem(bank, record.itemId);
    return item ? [{ itemId: item.id, section: item.section, prompt: item.prompt, options: [...item.options], chosen: record.choice!,
      answer: item.answer, correct: !!record.correct, explanation: item.explanation,
      passage: item.section === 'language' ? null : item.passage ?? null }] : [];
  });
  return {
    version: 2, attemptId: attempt.id, completedAt: iso(now), model: rated?.model ?? 'objective-only',
    procedureVersion: PLACEMENT_PROCEDURE_VERSION,
    headline: placementHeadline(scores, overall.label),
    overall: { level: overall.level, label: overall.label, score: overall.score, confidence: overall.confidence, summary: tail ? `${lead} ${tail}` : lead },
    skills,
    speaking: spoken.block,
    communication: { strengths: rated?.strengths ?? [], risks: rated?.risks ?? [], observations: rated?.observations ?? [],
      moves: rated?.moves ?? [] },
    languageTargets: languageTargets(attempt, bank, skills, rated),
    partnerLevel: skills[0].level,
    priorities: rated?.priorities.length ? rated.priorities : objectivePriorities(skills, overall.score),
    review,
    limitations: limitations(attempt, rated),
  };
}
