import React from 'react';
import {
  MEETING_LANGUAGES,
  MEETING_LANGUAGE_LABELS,
  defaultPreferences,
  type MeetingLanguage,
  type Project,
} from '@noclue/shared';
export function ResponseControls({
  project,
  onChange,
}: {
  project: Project;
  onChange: (value: NonNullable<Project['preferences']>) => void;
}) {
  const value = project.preferences ?? defaultPreferences;
  const update = (patch: Partial<typeof value>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="response-controls">
      <legend>Response preferences</legend>
      <label>
        Meeting language
        <select
          aria-label="Meeting language"
          value={value.language ?? 'en'}
          onChange={(e) => update({ language: e.target.value as MeetingLanguage })}
        >
          {MEETING_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {MEETING_LANGUAGE_LABELS[language]}
            </option>
          ))}
        </select>
      </label>
      <p className="privacy">
        noclue transcribes this language and prepares answers in it. Automatic answers in the
        language of each question. Coaching and the interface stay in English.
      </p>
      <label>
        Response style
        <select
          aria-label="Response style"
          value={value.tone}
          onChange={(e) => update({ tone: e.target.value as typeof value.tone })}
        >
          <option value="casual">Casual</option>
          <option value="professional">Professional</option>
          <option value="executive">Executive</option>
        </select>
      </label>
      <p className="privacy">
        QUICK uses 1–3 short sentences. Your saved length preference is retained for future expanded
        answers.
      </p>
      <label>
        Response length
        <select
          aria-label="Response length"
          value={value.length}
          onChange={(e) => update({ length: e.target.value as typeof value.length })}
        >
          <option value="brief">Brief · 1–2 sentences</option>
          <option value="standard">Standard · 2–4 sentences</option>
          <option value="detailed">Detailed · 4–7 sentences</option>
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.strictContext}
          onChange={(e) => update({ strictContext: e.target.checked })}
        />
        Stick to my knowledge
      </label>
      <p className="privacy">
        Strict mode uses only your project and personal facts. Turning it off allows general advice,
        never invented project claims or metrics.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.previewUnverified ?? false}
          onChange={(e) => update({ previewUnverified: e.target.checked })}
        />
        Show first draft while facts are checked
      </label>
      <p className="privacy">
        Faster: the first draft appears immediately, marked “Checking facts…”, and is replaced by
        the checked answer. Turn off to see only checked answers.
      </p>
      <label>
        Silence threshold · {(value.silenceMs / 1000).toFixed(1)} s
        <input
          aria-label="Silence threshold"
          type="range"
          min="300"
          max="2000"
          step="100"
          value={value.silenceMs}
          onChange={(e) => update({ silenceMs: Number(e.target.value) })}
        />
      </label>
      <p className="privacy">
        Shorter for rapid Q&amp;A; longer for thoughtful pauses. Applies to meeting speech, not your
        microphone.
      </p>
    </fieldset>
  );
}
