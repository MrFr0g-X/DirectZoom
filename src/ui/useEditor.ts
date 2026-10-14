import { useCallback, useEffect, useRef, useState } from 'react';
import { regionsFromEvents } from '../textFocus';
import { autoZooms, defaultClips, normalizeSettings } from '../settings';
import { readTrackSegments } from '../trackSegments';
import type { Annotation, BlurRegion, Clip, Project, ProjectSettings, ZoomRegion } from '../types';

type Snapshot = Pick<Project, 'zooms' | 'clips' | 'blurRegions' | 'annotations' | 'captions' | 'voiceoverClips' | 'threeDKeyframes' | 'cameraKeyframes' | 'textFocusRegions' | 'trackSegments' | 'settings'>;
const snapshot = (p: Project): Snapshot => ({ zooms: p.zooms, clips: p.clips, blurRegions: p.blurRegions, annotations: p.annotations, captions: p.captions, voiceoverClips: p.voiceoverClips, threeDKeyframes: p.threeDKeyframes, cameraKeyframes: p.cameraKeyframes, textFocusRegions: p.textFocusRegions, trackSegments: p.trackSegments, settings: p.settings });

export function useEditor(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const [, bump] = useState(0);
  const saveTimer = useRef<number | undefined>(undefined);
  const latest = useRef<Project | null>(null);
  const lastChange = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    let cancelled = false;
    window.dz.projects.load(projectId).then(raw => {
      if (cancelled) return;
      const settings = normalizeSettings(raw.settings);
      const duration = raw.metadata.duration;
      const clips = raw.clips?.length ? raw.clips : defaultClips(duration);
      const cursorData = (raw.cursorData ?? []).filter(e => Number.isFinite(e.t) && Number.isFinite(e.x) && Number.isFinite(e.y));
      // Generate zoom points on first open when auto detection is on.
      const zooms = raw.zooms?.length ? raw.zooms : autoZooms(cursorData, settings.zoomSettings, duration);
      const loaded: Project = { ...raw, cursorData, keyboardData: raw.keyboardData ?? [], zooms, clips, blurRegions: raw.blurRegions ?? [], annotations: (raw as any).annotations ?? [], captions: (raw as any).captions ?? [], voiceoverClips: (raw as any).voiceoverClips ?? [], threeDKeyframes: (raw as any).threeDKeyframes ?? [], cameraKeyframes: (raw as any).cameraKeyframes ?? [], textFocusEvents: (raw as any).textFocusEvents ?? [], textFocusRegions: (raw as any).textFocusRegions ?? [], trackSegments: readTrackSegments((raw as any).trackSegments), settings };
      // Derive focus regions from recorded events the first time a project opens.
      if (settings.textFocusSettings.autoDetect && loaded.textFocusEvents.length && !loaded.textFocusRegions.length) loaded.textFocusRegions = regionsFromEvents(loaded.textFocusEvents, loaded.metadata.duration);
      latest.current = loaded;
      setProject(loaded);
      if (!raw.settings || !raw.zooms?.length || !raw.clips?.length) window.dz.projects.save({ id: loaded.id, zooms, clips, settings });
    }).catch(e => setError(String(e?.message ?? e)));
    return () => { cancelled = true; };
  }, [projectId]);

  const persist = useCallback((next: Project) => {
    setSaved(false);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      await window.dz.projects.save({ id: next.id, ...snapshot(next) });
      setSaved(true);
    }, 600);
  }, []);

  // Flush pending saves when leaving the editor.
  useEffect(() => () => {
    if (saveTimer.current && latest.current) {
      window.clearTimeout(saveTimer.current);
      const p = latest.current;
      window.dz.projects.save({ id: p.id, ...snapshot(p) });
    }
  }, []);

  /** Applies an edit; `record` adds an undo step (set false for continuous drags). */
  const update = useCallback((change: Partial<Snapshot>, record = true) => {
    // Continuous changes (slider/drag) coalesce: they open a new undo step only after a pause.
    const now = performance.now();
    const coalesced = !record && now - lastChange.current < 800;
    lastChange.current = now;
    setProject(current => {
      if (!current) return current;
      if (!coalesced && (record || !dragging.current)) {
        past.current.push(snapshot(current));
        if (past.current.length > 100) past.current.shift();
        future.current = [];
      }
      const next = { ...current, ...change };
      latest.current = next;
      persist(next);
      return next;
    });
    bump(n => n + 1);
  }, [persist]);

  /** Starts an undo step without changing anything (call before a drag). */
  const checkpoint = useCallback(() => {
    const current = latest.current;
    if (!current) return;
    past.current.push(snapshot(current));
    future.current = [];
    // A drag started: its continuous updates belong to this step.
    dragging.current = true;
    lastChange.current = performance.now();
    const release = () => { dragging.current = false; window.removeEventListener('pointerup', release); };
    window.addEventListener('pointerup', release);
    bump(n => n + 1);
  }, []);

  const step = useCallback((from: React.MutableRefObject<Snapshot[]>, to: React.MutableRefObject<Snapshot[]>) => {
    const restored = from.current.pop();
    const current = latest.current;
    if (!restored || !current) return;
    to.current.push(snapshot(current));
    const next = { ...current, ...restored };
    latest.current = next;
    setProject(next);
    persist(next);
    bump(n => n + 1);
  }, [persist]);

  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

  const setSettings = useCallback(<K extends keyof ProjectSettings>(key: K, value: Partial<ProjectSettings[K]>, record = true) => {
    const current = latest.current;
    if (!current) return;
    update({ settings: { ...current.settings, [key]: { ...(current.settings[key] as object), ...value } } }, record);
  }, [update]);

  return {
    project, error, saved, update, checkpoint, setSettings, undo, redo,
    canUndo: past.current.length > 0, canRedo: future.current.length > 0,
  };
}
