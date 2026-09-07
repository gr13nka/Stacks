// SettingsScreen.tsx — a column of SETTINGS.rowH rows in a native
// scroller: the stack gap (− n h +), the raw twin rule, the sources with
// "remove" for user folders and "add folder", the fixture flag, and the
// about block. Every control is a TextButton; the Overlay's back gesture
// handles everything else.

import type { ReactNode } from 'react';
import type { Source, Volume } from '../api/types';
import { COLOR, FRAME, LAYER, SETTINGS, TYPE } from '../tokens';
import { GAP_HOURS } from '../store/types';
import { Overlay } from '../motion/Overlay';
import { Caption } from '../components/Caption';
import { TextButton } from '../components/TextButton';
import { actions, useStore } from '../store/store';

const APP_VERSION_FALLBACK = '0.1.0';

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const environment = useStore((s) => s.environment);
  const volumes = useStore((s) => s.volumes);
  const sources = useStore((s) => s.sources);

  const gap = settings.gapHours;

  return (
    <Overlay layer={LAYER.settings} onTapEmpty={actions.goBack}>
      <div
        className="scroller"
        style={{ position: 'absolute', left: 0, top: SETTINGS.scroller.y, width: FRAME.w, height: SETTINGS.scroller.h }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: `${SETTINGS.rowY0 - SETTINGS.scroller.y}px ${SETTINGS.valueRight}px 40px ${SETTINGS.labelX}px`,
          }}
        >
          <Row label="gap between stacks">
            <TextButton label="−" tone={gap > GAP_HOURS.min ? 'active' : 'muted'} onTap={() => actions.setGapHours(gap - 1)} style={stepStyle} />
            <Label>{gap} h</Label>
            <TextButton label="+" tone={gap < GAP_HOURS.max ? 'active' : 'muted'} onTap={() => actions.setGapHours(gap + 1)} style={stepStyle} />
          </Row>
          <Row label="remove raw with jpg">
            <TextButton
              label={settings.removeRawWithJpg ? 'on' : 'off'}
              tone={settings.removeRawWithJpg ? 'accent' : 'muted'}
              onTap={() => actions.setRemoveRawWithJpg(!settings.removeRawWithJpg)}
            />
          </Row>

          <Section>sources</Section>
          {sources.map((src) => (
            <SourceRow key={src.volumeId} source={src} volumes={volumes} userFolder={settings.folders.includes(src.root)} />
          ))}
          <Row label="">
            <TextButton label="add folder" tone="accent" onTap={() => void actions.pickAndAddFolder()} />
          </Row>
          {environment?.fixtures && (
            <Row label="fixture card">
              <Label>on</Label>
            </Row>
          )}

          <Section>about</Section>
          <Caption>stacks {environment?.version ?? APP_VERSION_FALLBACK}</Caption>
          <Caption style={{ whiteSpace: 'normal', wordBreak: 'break-word', marginTop: 4 }}>
            {typeof navigator === 'undefined' ? '' : navigator.userAgent}
          </Caption>
          <Caption style={{ marginTop: 4 }}>place names: geonames (cc by 4.0)</Caption>
          <Caption>font: jetbrains mono (ofl)</Caption>
        </div>
      </div>
    </Overlay>
  );
}

const stepStyle = { width: SETTINGS.stepW, justifyContent: 'center' } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ height: SETTINGS.rowH, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Label>{label}</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{children}</div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div style={{ color: COLOR.ink, fontSize: TYPE.label.size, lineHeight: `${TYPE.label.lineHeight}px`, whiteSpace: 'nowrap' }}>
      {children}
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <Caption style={{ marginTop: SETTINGS.sectionGap, height: SETTINGS.rowH / 2, lineHeight: `${SETTINGS.rowH / 2}px` }}>{children}</Caption>;
}

/** Name from the volume when there is one, else the folder's last path segment. */
function sourceName(source: Source, volumes: Volume[]): string {
  const volume = volumes.find((v) => v.id === source.volumeId);
  if (volume) return volume.name;
  return source.root.split('/').filter(Boolean).pop() ?? source.root;
}

function SourceRow({ source, volumes, userFolder }: { source: Source; volumes: Volume[]; userFolder: boolean }) {
  return (
    <div style={{ height: SETTINGS.rowH, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ minWidth: 0 }}>
        <Label>
          {sourceName(source, volumes)} <span style={{ color: COLOR.muted }}>· {source.kind}</span>
        </Label>
        <Caption style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260, textTransform: 'none' }}>{source.root}</Caption>
      </div>
      {userFolder && <TextButton label="remove" tone="muted" onTap={() => actions.removeFolder(source.root)} />}
    </div>
  );
}
