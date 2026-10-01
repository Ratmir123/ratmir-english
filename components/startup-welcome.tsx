'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Clock, Play } from '@phosphor-icons/react';
import { deriveStartupWelcome } from '@/lib/startup-welcome';
import type { AppState, Session } from '@/lib/types';
import styles from './startup-welcome.module.css';
import type { DesktopStatus } from './desktop-bridge';

export interface StartupWelcomeProps {
  state: AppState;
  busy: string;
  error?: string;
  onStart: (minutes: number) => void;
  onResume: (session: Session) => void;
  onDismiss: () => void;
}

export function StartupWelcome({ state, busy, error, onStart, onResume, onDismiss }: StartupWelcomeProps) {
  const [short, setShort] = useState(false);
  const [instant, setInstant] = useState(true);
  const [desktop, setDesktop] = useState<DesktopStatus | null>(null);
  const [reminder, setReminder] = useState('');
  useEffect(() => {
    let mounted = true;
    void window.ratmirDesktop?.getStatus().then(status => { if (mounted) setDesktop(status); }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);
  async function remind() {
    try {
      const result = await window.ratmirDesktop?.remindLater(30);
      setReminder(result?.scheduled ? 'Напомню через 30 минут, пока приложение работает в трее.' : 'Уведомления недоступны. Можно вернуться через иконку в трее.');
    } catch { setReminder('Не удалось поставить напоминание.'); }
  }
  const { resumable, completedToday, calibrationStep, fullMinutes } = deriveStartupWelcome(state);
  const done = !resumable && completedToday;
  const selectedMinutes = short ? 5 : fullMinutes;
  const pending = Boolean(busy);
  const name = state.profile.name.trim();
  const greeting = !name || name === 'Ты' ? 'Привет.' : `Привет, ${name}.`;
  const kicker = resumable
    ? resumable.status === 'review' ? 'ОСТАЛАСЬ ТВОЯ НОВАЯ ВЕРСИЯ'
      : resumable.status === 'analysing' ? 'ТВОЁ ЗАНЯТИЕ СОХРАНЕНО' : 'ПРОДОЛЖИМ С ТОГО ЖЕ МЕСТА'
    : done ? 'ПРАКТИКА НА СЕГОДНЯ ЗАВЕРШЕНА'
      : calibrationStep ? `КАЛИБРОВКА · ${calibrationStep} ИЗ 3` : 'ТВОЙ СЛЕДУЮЩИЙ РАЗГОВОР';
  const title = resumable?.lesson.title || (done ? 'Сегодня уже сделано.' : 'Давай немного поговорим.');
  const description = resumable
    ? resumable.status === 'review' ? resumable.analysis?.priorities.length
      ? 'Разговор и разбор уже здесь. Осталось попробовать свою улучшенную формулировку.'
      : 'Разговор разобран. Посмотри результат и заверши занятие.'
      : resumable.status === 'analysing' ? 'Разбор готовится. Можно открыть занятие и посмотреть его состояние.'
        : resumable.status === 'error' ? 'Твоя попытка сохранена. Открой занятие, чтобы продолжить или повторить последний шаг.'
          : resumable.lesson.goal
    : done ? `Занятие «${done.lesson.title}» завершено. Можно спокойно вернуться к своим делам.`
      : calibrationStep ? 'Первые три занятия помогут понять твою речь и логику разговора. Начнём с живой ситуации, а затем разберём твою попытку.'
        : 'Небольшой разговор, конкретный разбор и своя новая попытка. Ситуация подстроится под твой опыт.';
  const action = resumable
    ? resumable.status === 'review' ? 'Продолжить разбор'
      : resumable.status === 'analysing' ? 'Открыть занятие' : 'Продолжить занятие'
    : done ? 'Открыть тренинг' : 'Начать сейчас';

  return <section className={styles.entry} aria-labelledby="startup-greeting">
    <div className={styles.content}>
      <div className={styles.identity}><span className={styles.wordmark}>ratmir<span>english</span></span><span>Личная практика</span></div>
      <div className={styles.panel}>
        <div className={styles.greeting}><h1 id="startup-greeting">{greeting}</h1><p>{done ? 'Хорошая точка, чтобы остановиться.' : 'Английский — сейчас, небольшим шагом.'}</p></div>
        <div className={styles.task}>
          <span className={styles.kicker}><span className={done ? styles.doneDot : styles.dot} aria-hidden="true" />{kicker}</span>
          <h2>{title}</h2>
          <p>{description}</p>
          {resumable && <span className={styles.saved}><Clock size={16} aria-hidden="true" />{resumable.lesson.minutes} минут · {resumable.mode === 'call' ? 'Созвон' : 'Учебный режим'}</span>}
        </div>

        {!resumable && !done && <fieldset className={styles.duration} disabled={pending}>
          <legend>Сколько времени выделим?</legend>
          <div className={styles.options} data-short={short ? 'true' : 'false'} data-instant={instant ? 'true' : undefined}>
            <span className={styles.selection} aria-hidden="true" />
            <button type="button" aria-pressed={!short} onClick={event => { setInstant(event.detail === 0); setShort(false); }}><strong>{fullMinutes} минут</strong><span>Обычное занятие</span></button>
            {fullMinutes > 5 && <button type="button" aria-pressed={short} onClick={event => { setInstant(event.detail === 0); setShort(true); }}><strong>5 минут</strong><span>Короткая практика</span></button>}
          </div>
          <p className={styles.durationNote}>{selectedMinutes === 5 ? 'Один короткий разговор и один ближайший шаг.' : 'Разговор, разбор и своя улучшенная попытка.'}</p>
        </fieldset>}

        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="button" className={styles.primary} disabled={pending} onClick={() => resumable ? onResume(resumable) : done ? onDismiss() : onStart(selectedMinutes)}>
          {done ? <Check size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}<span>{pending ? busy : action}</span><ArrowRight size={21} aria-hidden="true" />
        </button>
        <div className={styles.secondary}>
          {done
            ? <button type="button" disabled={pending} onClick={() => onResume(done)}>Посмотреть результат</button>
            : <button type="button" disabled={pending} onClick={onDismiss}>Открыть тренинг</button>}
        </div>
        {desktop && !done && <div className={styles.reminder}><button type="button" disabled={pending || !!reminder} onClick={() => void remind()}>Напомнить через 30 минут</button>{reminder && <p role="status">{reminder}</p>}</div>}
        <p className={styles.footnote}>{done ? 'Новый разговор можно выбрать в разделе «Практика».' : 'Занятие начнётся только после нажатия. Можно говорить или писать.'}</p>
      </div>
    </div>
  </section>;
}
