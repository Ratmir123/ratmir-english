'use client';

/**
 * «Для тебя» on Practice (planning/v05/MOTION-PASS-0.5.2.md §7 with the §8 fixes). Full width and lighter than the catalog:
 * today's plan and the drills from calls as compact tiles (one tap starts the default mode, a small text action starts the other
 * one, the speaker plays the partner's line), the costliest patterns as chips, «Все тренировки · N» opens every drill in a sheet. When
 * nothing is pending, one quiet line with a curious companion asks for a call. 0.5.3: the «Мои фразы» card sits between the
 * drills and the patterns (components/phrases/phrases-card.tsx). iPhone: ios/Sources/PracticeForYou.swift.
 */
import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowRightIcon, CaretRightIcon, TargetIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import type { Mode } from '@/lib/types';
import type { CatalogFamily } from '@/lib/training';
import { useApp } from '../app/app-context';
import { MODE_LABEL } from '../app/labels';
import { cx, kit, Spinner, TtsButton } from '../calls/kit';
import { PhrasesCard } from '../phrases/phrases-card';
import { ScreenMascot } from '../shell/screen-mascot';
import { Sheet } from '../ui/sheet';
import { forYouModel, type ForYouModel, type ForYouTile } from './for-you-model';
import styles from './for-you.module.css';

type StartTile = (tile: ForYouTile, mode: Mode) => void;
const lower = (mode: Mode) => MODE_LABEL[mode].toLowerCase();

function Meta({ parts }: { parts: ReactNode[] }) {
  return <>{parts.map((part, index) => <Fragment key={index}>{index > 0 && <span className={styles.sep} aria-hidden="true">·</span>}{part}</Fragment>)}</>;
}

const seedOf = (tile: ForYouTile) => tile.kind === 'drill' ? tile.drill.seedLine?.trim() ?? '' : '';
const hasFoot = (tile: ForYouTile) => !!tile.other || !!seedOf(tile);

/**
 * One tile. The whole surface starts the default mode; the footer holds the other mode and the line to listen to.
 * `reserve` keeps the footer room in a row where any tile has one, so the meta lines of neighbours stay aligned.
 */
function Tile({ tile, layout, busy, preparing, onStart, enter, reserve = false }: {
  tile: ForYouTile; layout: 'row' | 'list'; busy: boolean; preparing: boolean; onStart: StartTile; enter?: boolean; reserve?: boolean;
}) {
  const id = useId();
  const plan = tile.kind === 'plan';
  const title = plan ? tile.recommendation.title : tile.drill.title;
  const why = plan ? tile.recommendation.why : tile.drill.why;
  const seed = seedOf(tile);
  const status = plan ? 'new' : tile.drill.status;
  const verb = status === 'done' ? 'Ещё раз' : status === 'started' ? 'Продолжить' : 'Начать';
  const parts: ReactNode[] = [];
  if (plan) parts.push(<span className={styles.planLabel}><TargetIcon size={14} weight="bold" aria-hidden="true" />План на сегодня</span>);
  if (status === 'started') parts.push(<span className={styles.state}>Начата</span>);
  if (status === 'done') parts.push(<span>Пройдена</span>);
  parts.push(<span className="tabular">~{tile.minutes} мин</span>, <span>{tile.other ? MODE_LABEL[tile.mode] : 'Текст'}</span>);
  const foot = preparing || hasFoot(tile);
  return <li className={styles.tile} data-kind={tile.kind} data-status={status} data-enter={enter ? '' : undefined}>
    <button type="button" className={styles.main} data-foot={foot || reserve} onClick={() => onStart(tile, tile.mode)} disabled={busy}
      aria-label={`${verb}: ${title}`} aria-describedby={why ? `${id}-why ${id}-meta` : `${id}-meta`} title={layout === 'row' && why ? why : undefined}
      data-testid={plan ? 'practice-plan' : `practice-drill-${tile.drill.id}`}>
      <span className={styles.title}>{title}</span>
      {why && <span className={styles.why} id={`${id}-why`}>{why}</span>}
      <span className={styles.meta} id={`${id}-meta`}>
        {!plan && <span className={styles.tier} data-tier={tile.drill.tier} title={`Давление ${tile.drill.tier} из 3`}>
          <span className="visually-hidden">Давление {tile.drill.tier} из 3.</span></span>}
        <Meta parts={parts} />
      </span>
    </button>
    {foot && <div className={styles.foot}>
      {preparing ? <span className={styles.preparing} role="status"><Spinner />Готовлю…</span>
        : tile.other ? <button type="button" className={styles.alt} onClick={() => onStart(tile, tile.other!)} disabled={busy}
          aria-label={`${verb} ${lower(tile.other)}: ${title}`}>или {lower(tile.other)}</button> : <span />}
      {seed && !preparing && <span className={cx(kit.scope, styles.listen)}><TtsButton text={seed} compact label="Послушать реплику" /></span>}
    </div>}
  </li>;
}

/** Every drill inside Practice (§8.3): pending first in the shared order, done ones folded under «Пройденные». */
function AllDrills({ open, onClose, model, busy, preparing, onStart }: {
  open: boolean; onClose: () => void; model: ForYouModel; busy: boolean; preparing: string | null; onStart: StartTile;
}) {
  const start: StartTile = (tile, mode) => { onClose(); onStart(tile, mode); };
  const subtitle = [model.pending.length ? `Ждут: ${model.pending.length}` : 'Все пройдены', model.done.length ? `Пройдены: ${model.done.length}` : null]
    .filter(Boolean).join(' · ');
  return <Sheet open={open} onClose={onClose} title="Все тренировки" subtitle={subtitle} testId="practice-drills">
    {model.pending.length ? <ul className={styles.tiles} data-layout="list" aria-label="Ждут">
      {model.pending.map(tile => <Tile key={tile.key} tile={tile} layout="list" busy={busy} preparing={preparing === tile.key} onStart={start} />)}
    </ul> : <p className={styles.note}>Новые тренировки появятся после разбора следующего созвона.</p>}
    {model.done.length > 0 && <details className={styles.done}>
      <summary><span>Пройденные · {model.done.length}</span><CaretRightIcon size={16} className={styles.caret} aria-hidden="true" /></summary>
      <ul className={styles.tiles} data-layout="list" aria-label="Пройденные">
        {model.done.map(tile => <Tile key={tile.key} tile={tile} layout="list" busy={busy} preparing={preparing === tile.key} onStart={start} />)}
      </ul>
    </details>}
  </Sheet>;
}

export function PracticeForYou({ onOpenFamily }: { onOpenFamily: (family: CatalogFamily) => void }) {
  const app = useApp();
  const state = app.data.state!;
  const families = useMemo(() => app.catalog?.flatMap(section => section.families) ?? [], [app.catalog]);
  const model = useMemo(() => forYouModel(state, families), [state, families]);
  const [listOpen, setListOpen] = useState(false);
  // The tile that asked for the lesson shows «Готовлю…» while it is being prepared.
  const [pressed, setPressed] = useState<{ key: string; at: number } | null>(null);
  const starting = app.lesson.starting;
  useEffect(() => { if (!starting) setPressed(null); }, [starting]);
  const preparing = starting && pressed && Math.abs(starting.since - pressed.at) < 1500 ? pressed.key : null;
  const busy = !!starting || !!app.lesson.busy;

  const start: StartTile = (tile, mode) => {
    if (busy) return;
    setPressed({ key: tile.key, at: Date.now() });
    if (tile.kind === 'drill') app.startDrill(tile.drill.id, mode);
    else app.start({ familyId: tile.recommendation.familyId, mode, from: 'practice' });
  };
  const tiles: ForYouTile[] = [...(model.plan ? [model.plan] : []), ...model.tiles];
  const reserve = tiles.some(hasFoot);
  const total = model.pending.length + model.done.length;

  return <>
    <section className={styles.forYou} aria-labelledby="practice-for-you">
      <div className={styles.head} data-enter>
        <div className={styles.headCopy}>
          <h2 id="practice-for-you">Для тебя</h2>
          <p className="caption">По твоим созвонам и последним разборам.</p>
        </div>
        {total > 0 && <button type="button" className={`text-button ${styles.all}`} onClick={() => setListOpen(true)} aria-haspopup="dialog">
          Все тренировки · <span className="tabular">{total}</span><CaretRightIcon size={15} aria-hidden="true" />
        </button>}
      </div>

      {tiles.length > 0 && <ul className={styles.tiles} data-layout="row" data-count={tiles.length} aria-label="План и тренировки">
        {tiles.map(tile => <Tile key={tile.key} tile={tile} layout="row" busy={busy} preparing={preparing === tile.key} onStart={start} enter reserve={reserve} />)}
      </ul>}

      {model.pending.length === 0 && <div className={styles.empty} data-enter>
        <ScreenMascot emotion="curious" size={56} className={styles.emptyMascot} />
        <p>Загрузи запись созвона — после разбора здесь появятся тренировки из твоих моментов.</p>
        <button type="button" className="button secondary small" onClick={() => app.go('calls')}><UploadSimpleIcon size={16} />Загрузить созвон</button>
      </div>}

      {/* 0.5.3 «Мои фразы» (PASS-0.5.3 §1.6): what he saved with «Запомнить» comes back here. */}
      <PhrasesCard />

      {model.suggestions.length > 0 && <div className={styles.patterns} data-enter>
        <h3 className={styles.patternsTitle} id="practice-patterns">Против твоих паттернов</h3>
        <ul className={styles.chips} aria-labelledby="practice-patterns">
          {model.suggestions.map(item => <li key={item.patternId}>
            <button type="button" className={styles.chip} onClick={() => onOpenFamily(item.family)} data-testid={`practice-pattern-${item.patternId}`}
              aria-label={`${item.patternTitle}: открыть ситуацию «${item.family.title}»`}>
              <strong>{item.patternTitle}</strong><ArrowRightIcon size={14} aria-hidden="true" /><span className={styles.chipFamily}>{item.family.title}</span>
            </button>
          </li>)}
        </ul>
      </div>}
    </section>

    <AllDrills open={listOpen} onClose={() => setListOpen(false)} model={model} busy={busy} preparing={preparing} onStart={start} />
  </>;
}
