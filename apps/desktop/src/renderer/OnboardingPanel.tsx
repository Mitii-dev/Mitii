/**
 * Desktop first-run onboarding — Netflix-style fullscreen steps:
 * 1) Choose workspace → 2) Set up profile → 3) Auto-index with defaults.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  PROVIDER_PRESET_OPTIONS,
  type DesktopProviderPreset,
} from '../shared/settings.js';
import { IdentityPicker, type IdentityCard } from './IdentityPicker.js';

export type OnboardingStep = 'workspace' | 'profile' | 'index';

export interface OnboardingProfileCard {
  id: string;
  name: string;
  subtitle?: string;
}

export interface OnboardingPanelProps {
  workspaceRoot: string;
  workspaceCards: IdentityCard[];
  profiles: OnboardingProfileCard[];
  activeProfileId: string;
  indexing?: boolean;
  indexed?: boolean;
  indexStatus?: string;
  indexProgress?: number | null;
  busy?: boolean;
  onPickWorkspace: () => void | Promise<void>;
  onSelectWorkspace: (path: string) => void | Promise<void>;
  onForgetWorkspace?: (path: string) => void | Promise<void>;
  onSelectProfile: (id: string) => void | Promise<void>;
  onCreateProfileFromPreset: (
    preset: DesktopProviderPreset,
  ) => void | Promise<void>;
  onManageProfiles: () => void;
  onStartIndex: () => void | Promise<void>;
  onComplete: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
}

function stepIndex(step: OnboardingStep): number {
  if (step === 'workspace') return 0;
  if (step === 'profile') return 1;
  return 2;
}

export function OnboardingPanel(props: OnboardingPanelProps) {
  const hasWorkspace = Boolean(props.workspaceRoot.trim());
  const hasProfile = props.profiles.length > 0;

  const [step, setStep] = useState<OnboardingStep>(() => {
    if (!hasWorkspace) return 'workspace';
    if (!hasProfile) return 'profile';
    return 'index';
  });

  const [indexStarted, setIndexStarted] = useState(false);
  const prevRootRef = useRef(props.workspaceRoot);
  const onStartIndexRef = useRef(props.onStartIndex);
  const onCompleteRef = useRef(props.onComplete);
  onStartIndexRef.current = props.onStartIndex;
  onCompleteRef.current = props.onComplete;

  // After “Open folder…”, advance once a workspace root appears.
  useEffect(() => {
    const prev = prevRootRef.current.trim();
    const next = props.workspaceRoot.trim();
    prevRootRef.current = props.workspaceRoot;
    if (step !== 'workspace') return;
    if (!prev && next) setStep('profile');
  }, [props.workspaceRoot, step]);

  useEffect(() => {
    if (step !== 'index') return;
    if (indexStarted) return;
    if (props.indexing || props.indexed) {
      setIndexStarted(true);
      return;
    }
    setIndexStarted(true);
    void onStartIndexRef.current();
  }, [step, indexStarted, props.indexing, props.indexed]);

  useEffect(() => {
    if (step !== 'index') return;
    if (!props.indexed || props.indexing) return;
    const timer = window.setTimeout(() => {
      void onCompleteRef.current();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [step, props.indexed, props.indexing]);

  const presets = useMemo(
    () =>
      PROVIDER_PRESET_OPTIONS.filter((p) =>
        ['ollama', 'lm-studio', 'echo', 'openai', 'anthropic'].includes(p.id),
      ),
    [],
  );

  const progress = Math.max(
    0,
    Math.min(100, Math.round(props.indexProgress ?? (props.indexed ? 100 : 12))),
  );

  return (
    <div
      className="onboarding-flow"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Mitii"
    >
      <div className="onboarding-flow__backdrop" aria-hidden />
      <div className="onboarding-flow__stage">
        <header className="onboarding-flow__brand">
          <div className="onboarding-flow__logo">Mitii</div>
          <p className="onboarding-flow__tagline">
            Local-first coding agent — pick a workspace, a profile, then go.
          </p>
          <ol className="onboarding-flow__steps" aria-label="Setup steps">
            {(['workspace', 'profile', 'index'] as const).map((id, i) => (
              <li
                key={id}
                className={
                  stepIndex(step) === i
                    ? 'is-active'
                    : stepIndex(step) > i
                      ? 'is-done'
                      : undefined
                }
              >
                <span className="onboarding-flow__step-num">{i + 1}</span>
                <span>
                  {id === 'workspace'
                    ? 'Workspace'
                    : id === 'profile'
                      ? 'Profile'
                      : 'Index'}
                </span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn btn-ghost onboarding-flow__skip"
            onClick={() => void props.onSkip()}
            disabled={props.busy}
          >
            Skip setup
          </button>
        </header>

        <div className="onboarding-flow__panel">
          {step === 'workspace' ? (
            <IdentityPicker
              title="Where are we working?"
              subtitle="Choose a repo Mitii can index and edit. You can add more later."
              cards={props.workspaceCards}
              onSelect={(id) => {
                void (async () => {
                  await props.onSelectWorkspace(id);
                  setStep('profile');
                })();
              }}
              onAdd={() => void props.onPickWorkspace()}
              addLabel="Open folder…"
              onRemove={
                props.onForgetWorkspace
                  ? (id) => void props.onForgetWorkspace?.(id)
                  : undefined
              }
              removeLabel="Remove"
              footer={
                <div className="onboarding-flow__footer">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!hasWorkspace || props.busy}
                    onClick={() => setStep('profile')}
                  >
                    Continue
                  </button>
                </div>
              }
            />
          ) : null}

          {step === 'profile' ? (
            <div className="onboarding-flow__profile">
              <IdentityPicker
                title="Who's coding?"
                subtitle="A profile owns provider, model, and mode defaults. Start with a preset — tweak later in Settings."
                cards={props.profiles.map((p) => ({
                  id: p.id,
                  title: p.name,
                  subtitle: p.subtitle,
                  active: p.id === props.activeProfileId,
                }))}
                onSelect={(id) => {
                  void (async () => {
                    await props.onSelectProfile(id);
                    setStep('index');
                  })();
                }}
                onAdd={props.onManageProfiles}
                addLabel="Custom profile…"
                footer={
                  <div className="onboarding-flow__footer onboarding-flow__footer--stack">
                    <div
                      className="onboarding-flow__presets"
                      role="group"
                      aria-label="Quick presets"
                    >
                      {presets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="onboarding-flow__preset"
                          disabled={props.busy}
                          onClick={() => {
                            void (async () => {
                              await props.onCreateProfileFromPreset(preset.id);
                              setStep('index');
                            })();
                          }}
                        >
                          <strong>{preset.label}</strong>
                          <span>
                            {preset.model ||
                              (preset.baseUrl
                                ? preset.baseUrl.replace(/^https?:\/\//, '')
                                : 'local')}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="onboarding-flow__footer-row">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setStep('workspace')}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!hasProfile || props.busy}
                        onClick={() => setStep('index')}
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                }
              />
            </div>
          ) : null}

          {step === 'index' ? (
            <div className="onboarding-flow__index">
              <header className="identity-picker__header">
                <h1>Indexing your workspace</h1>
                <p>
                  Using default semantic index settings. Ask, Plan, and Agent get
                  repo-aware context once this finishes.
                </p>
              </header>
              <div className="onboarding-flow__index-card" role="status">
                <div className="onboarding-flow__index-bar" aria-hidden>
                  <div
                    className="onboarding-flow__index-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="onboarding-flow__index-msg">
                  {props.indexing
                    ? props.indexStatus?.trim() || 'Indexing workspace…'
                    : props.indexed
                      ? props.indexStatus?.trim() || 'Index ready.'
                      : props.indexStatus?.trim() ||
                        'Starting index with defaults…'}
                </p>
                <p className="onboarding-flow__index-path">
                  {props.workspaceRoot || 'No workspace selected'}
                </p>
              </div>
              <div className="onboarding-flow__footer onboarding-flow__footer-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setStep('profile')}
                  disabled={props.indexing}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void props.onStartIndex()}
                  disabled={props.indexing || props.busy}
                >
                  {props.indexing ? 'Indexing…' : 'Re-run index'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void props.onComplete()}
                  disabled={props.busy}
                >
                  {props.indexed ? 'Start chatting' : 'Continue anyway'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
