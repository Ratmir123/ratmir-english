'use client';

/** Playbook in Profile: facts suggested by call reviews (accept/reject) and accepted ones grouped by kind (remove). */
import { useEffect, useState } from 'react';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { api } from '@/lib/client/api';
import type { ProfileFact } from '@/lib/calls/types';
import { Chip, cx, kit, Spinner } from './kit';
import { FACT_KIND_LABEL, FACT_KIND_ORDER, formatClock } from './format';
import styles from './patterns.module.css';

function sourceLabel(fact: ProfileFact): string {
  if (fact.source.type === 'call') return `из звонка${fact.at !== null ? `, ${formatClock(fact.at)}` : ''}`;
  if (fact.source.type === 'seed') return 'из стартовых данных';
  return 'добавлено вручную';
}

export function FactsPanel({ facts, onChanged }: { facts: ProfileFact[]; onChanged: () => void }) {
  const [local, setLocal] = useState<ProfileFact[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setLocal(null); }, [facts]);
  const list = local ?? facts;
  const pending = list.filter(fact => fact.status === 'suggested');
  const accepted = list.filter(fact => fact.status === 'accepted');
  const groups = FACT_KIND_ORDER.map(kind => ({ kind, items: accepted.filter(fact => fact.kind === kind) })).filter(group => group.items.length);

  async function decide(fact: ProfileFact, decision: 'accept' | 'reject') {
    setBusy(fact.id); setError(null);
    try {
      const result = await api<{ profileFacts: ProfileFact[] }>('facts', { factId: fact.id, decision });
      setLocal(result.profileFacts);
      onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не получилось сохранить.'); }
    finally { setBusy(null); }
  }

  return (
    <section className={cx(kit.scope, styles.panel)} aria-labelledby="playbook-title">
      <div className={styles.panelHead}>
        <h2 id="playbook-title">Мой плейбук</h2>
        <p>Факты о тебе, которые знают собеседник и тренер: ставки, кейсы, цифры, что конфиденциально. Сюда попадает только то, что ты подтвердил.</p>
      </div>
      {error ? <p className={styles.errorLine} role="alert">{error}</p> : null}
      {pending.length ? (
        <div className={styles.pending}>
          <h3>Ждут подтверждения · {pending.length}</h3>
          {pending.map(fact => (
            <div key={fact.id} className={styles.factRow}>
              <div>
                <Chip tone="violet">{FACT_KIND_LABEL[fact.kind]}</Chip>
                <p style={{ marginTop: 6 }}>{fact.text}</p>
                <small>{sourceLabel(fact)}{fact.quote ? <> · <span lang="en">«{fact.quote}»</span></> : null}</small>
              </div>
              <div className={styles.factActions}>
                <button type="button" className={cx(kit.btn, kit.primary, kit.small)} disabled={busy === fact.id} onClick={() => void decide(fact, 'accept')}>
                  {busy === fact.id ? <Spinner /> : <CheckIcon size={14} weight="bold" />}Верно
                </button>
                <button type="button" className={cx(kit.btn, kit.quiet, kit.small)} disabled={busy === fact.id} onClick={() => void decide(fact, 'reject')}>
                  <XIcon size={14} weight="bold" />Нет
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {groups.length ? groups.map(group => (
        <div key={group.kind} className={styles.factsGroup}>
          <h3 className={styles.groupTitle}>{FACT_KIND_LABEL[group.kind]}</h3>
          {group.items.map(fact => (
            <div key={fact.id} className={styles.factRow}>
              <div>
                <p>{fact.text}</p>
                <small>{sourceLabel(fact)}{fact.quote ? <> · <span lang="en">«{fact.quote}»</span></> : null}</small>
              </div>
              <div className={styles.factActions}>
                <button type="button" className={cx(kit.btn, kit.quiet, kit.danger, kit.small)} disabled={busy === fact.id} onClick={() => void decide(fact, 'reject')}
                  aria-label={`Убрать из плейбука: ${fact.text}`}>
                  {busy === fact.id ? <Spinner /> : <XIcon size={14} weight="bold" />}Убрать
                </button>
              </div>
            </div>
          ))}
        </div>
      )) : !pending.length ? (
        <div className={cx(kit.glass, styles.pattern)}>
          <p className={kit.muted} style={{ margin: 0, fontSize: 14 }}>Плейбук пока пуст. Факты появятся из разборов звонков — ты подтвердишь, что правда.</p>
        </div>
      ) : null}
    </section>
  );
}
