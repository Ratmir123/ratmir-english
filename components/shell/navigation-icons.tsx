'use client';

import { ChartLineUpIcon, PhoneCallIcon, SunIcon, UserCircleIcon, WaveformIcon, type Icon } from '@phosphor-icons/react';
import type { TabId } from '../app/labels';

/** Same icons as iOS (DESIGN-SYSTEM §3): sun.max / waveform / phone.bubble / chart.line.uptrend / person.crop.circle. */
export const TAB_ICONS: Record<TabId, Icon> = {
  today: SunIcon, practice: WaveformIcon, calls: PhoneCallIcon, progress: ChartLineUpIcon, profile: UserCircleIcon,
};
