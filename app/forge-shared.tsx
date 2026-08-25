"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "./language";

export type Mood = "chaos" | "calm" | "contrast";
export type Motion = "push" | "pull" | "drift";
export type Scene = {
  headline: string;
  body: string;
  accent: string;
  marks: string[];
  mood: Mood;
  motion: Motion;
};
export type Project = {
  presetId: string;
  hook: string;
  sceneA: Scene;
  sceneB: Scene;
  durationA: number;
  durationB: number;
  audio: "none" | "ig_safe" | "original";
  abTest: boolean;
  originalReupload: boolean;
};
export type Packet = {
  hook: string;
  body: string;
  tags: string[];
  commentPrompt: string;
};
export type Preset = {
  id: string;
  title: string;
  sceneA: Scene;
  sceneB: Scene;
  motionHint: string;
  durationDefault: number;
  forbiddenTemplates: string[];
  format: "reel";
};
export type View =
  | "studio"
  | "edit"
  | "cut"
  | "production"
  | "bots"
  | "bot-guide"
  | "library"
  | "agent"
  | "connect"
  | "packet"
  | "gates"
  | "export";

const initialPacket: Packet = {
  hook: "ChatGPT when you say make it professional",
  body: "The email was never the work.\nThe twelve-line greeting was.\nMake the ask clear and send it.",
  tags: ["#aiatwork", "#email", "#prompts"],
  commentPrompt:
    'You edit work emails.\nMax 6 lines. One ask.\nNo greeting essay. No recap. No "happy to help".\nOutput: subject + body.',
};

const makeScene = (
  headline: string,
  body: string,
  mood: Mood,
  accent: string,
  marks: string[],
  motion: Motion,
): Scene => ({ headline, body, mood, accent, marks, motion });

export const presets: Preset[] = [
  {
    id: "unpaid-intern-email",
    title: "Unpaid intern email",
    sceneA: makeScene(
      "boss: make it professional with AI",
      "Hope this finds you well...\nHappy to jump on a call...\nPlease don’t hesitate...",
      "chaos",
      "A 47-word greeting for a six-line email.",
      ["Three greetings", "No actual ask", "Calendar bait"],
      "push",
    ),
    sceneB: makeScene(
      "You needed 6 lines.",
      "You edit work emails.\nMax 6 lines. One ask.\nNo greeting essay.\nOutput: subject + body.",
      "calm",
      "The prompt that ships.",
      ["One ask", "Clear subject", "Ready to send"],
      "pull",
    ),
    motionHint:
      "Fast push into the greeting pile, then pull out on the useful prompt.",
    durationDefault: 10,
    forbiddenTemplates: ["drake", "ivory_textbook", "hangul_quote"],
    format: "reel",
  },
  {
    id: "meeting-recap",
    title: "Meeting recap nobody asked for",
    sceneA: makeScene(
      "AI: here is your 47-line recap",
      "Context. Context. Context.\nA summary of the summary.\nNo decision in sight.",
      "chaos",
      "The meeting ended. The novel began.",
      ["47 lines", "No owner", "No decision"],
      "push",
    ),
    sceneB: makeScene(
      "4 bullets + one ask",
      "Decision: approve the brief.\nOwner: Maya.\nDeadline: Thursday.\nAsk: reply with blockers.",
      "calm",
      "The recap people can use.",
      ["Decision", "Owner", "Deadline"],
      "pull",
    ),
    motionHint: "Zoom into the wall of text. Cut to the four bullets.",
    durationDefault: 10,
    forbiddenTemplates: ["drake", "ivory_textbook", "hangul_quote"],
    format: "reel",
  },
  {
    id: "calendar-spam",
    title: "Calendar spam",
    sceneA: makeScene(
      "Happy to jump on a call anytime",
      "Monday? Tuesday?\nThursday works too.\nLet’s find time to find time.",
      "chaos",
      "Calendar Tetris, unpaid.",
      ["No options", "No timezone", "No question"],
      "push",
    ),
    sceneB: makeScene(
      "Two times. One timezone. One question.",
      "Tue 14:00 ET or Wed 10:30 ET?\nWhich works for the approval?",
      "contrast",
      "A calendar invite is not a quest.",
      ["Two options", "Timezone", "One decision"],
      "drift",
    ),
    motionHint: "Push through the calendar noise, soft drift on the answer.",
    durationDefault: 10,
    forbiddenTemplates: ["drake", "ivory_textbook", "hangul_quote"],
    format: "reel",
  },
  {
    id: "attachment-theatre",
    title: "Attachment theatre",
    sceneA: makeScene(
      "Kindly find attached hereof",
      "Please see the attached attachment\nfor your kind perusal\nand favourable consideration.",
      "chaos",
      "The file is doing theatre.",
      ["No file name", "No action", "Three formalities"],
      "push",
    ),
    sceneB: makeScene(
      "The file + what to do with it.",
      "Attached: Q3 budget.xlsx\nPlease approve rows 18–24 by Friday.",
      "calm",
      "Name it. Ask for something.",
      ["File named", "One action", "Deadline"],
      "pull",
    ),
    motionHint: "Fast push, then an intentional pull-out.",
    durationDefault: 10,
    forbiddenTemplates: ["drake", "ivory_textbook", "hangul_quote"],
    format: "reel",
  },
  {
    id: "slack-to-email",
    title: "Slack-to-email",
    sceneA: makeScene(
      "A Slack ping becomes a novel",
      "Hey! Just circling back 😊\nI wanted to gently flag\na tiny little thing...",
      "chaos",
      "AI found every filler word.",
      ["Novel energy", "Emoji spill", "No subject"],
      "push",
    ),
    sceneB: makeScene(
      "Subject + five lines. Done.",
      "Subject: Review needed by 3pm\nCan you approve the brief?\nTwo edits are highlighted.\nReply yes or send blockers.",
      "calm",
      "No “just circling back.”",
      ["Subject", "Five lines", "Clear ask"],
      "pull",
    ),
    motionHint: "Crash zoom into the filler, hard cut to the useful version.",
    durationDefault: 10,
    forbiddenTemplates: ["drake", "ivory_textbook", "hangul_quote"],
    format: "reel",
  },
  {
    id: "macbook-laptop",
    title: "MacBook vs gaming laptop",
    sceneA: makeScene(
      "Overkill setup. Overkill prompt.",
      "Act as a genius boardroom\nwith 14 expert personas\nwho also know my soul.",
      "chaos",
      "RGB prompt engineering.",
      ["14 personas", "No task", "Maximum theatre"],
      "push",
    ),
    sceneB: makeScene(
      "Boring machine. Boring prompt. Ships.",
      "Write a launch email.\nAudience: existing users.\nOne benefit. One CTA.\nMax 120 words.",
      "contrast",
      "Boring prompt. Useful output.",
      ["Audience", "Constraint", "CTA"],
      "drift",
    ),
    motionHint: "Aggressive push on the overkill, quiet drift on the prompt.",
    durationDefault: 10,
    forbiddenTemplates: ["drake", "ivory_textbook", "hangul_quote"],
    format: "reel",
  },
  {
    id: "docs-nobody-reads",
    title: "Docs nobody reads",
    sceneA: makeScene(
      "A 12-page “strategy”",
      "Vision. Mission. Synergy.\nPage 8 has a chart.\nNo one knows who decides.",
      "chaos",
      "Slides dressed up as a decision.",
      ["12 pages", "No owner", "No decision"],
      "push",
    ),
    sceneB: makeScene(
      "One page. One decision. One owner.",
      "Decision: run the pilot.\nOwner: Jordan.\nSuccess: 25 qualified demos.\nNext: approve budget.",
      "calm",
      "If it cannot decide, it cannot ship.",
      ["One page", "Owner", "Next step"],
      "pull",
    ),
    motionHint: "Dive into the deck, cut cleanly to the decision.",
    durationDefault: 10,
    forbiddenTemplates: ["drake", "ivory_textbook", "hangul_quote"],
    format: "reel",
  },
  {
    id: "per-my-last-email",
    title: "Per my last email",
    sceneA: makeScene(
      "AI wrote “per my last email”",
      "As previously communicated,\nI would appreciate it if you\nwould kindly revisit my note.",
      "chaos",
      "Passive aggression, now automated.",
      ["Temperature 100", "No fact", "No ask"],
      "push",
    ),
    sceneB: makeScene(
      "Fact + ask. No temperature.",
      "The invoice is still open.\nCan you confirm payment by Thursday?",
      "contrast",
      "Cold facts. Warm blood pressure.",
      ["Fact", "One ask", "No smoke"],
      "drift",
    ),
    motionHint: "Push into the passive-aggressive cloud. Cut to the fact.",
    durationDefault: 10,
    forbiddenTemplates: ["drake", "ivory_textbook", "hangul_quote"],
    format: "reel",
  },
];

const blankProject: Project = {
  presetId: presets[0].id,
  hook: presets[0].sceneA.headline,
  sceneA: presets[0].sceneA,
  sceneB: presets[0].sceneB,
  durationA: 5,
  durationB: 5,
  audio: "none",
  abTest: false,
  originalReupload: false,
};

function safeRead<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
function hasHangul(value: string) {
  return /[\uAC00-\uD7A3]/.test(value);
}
function wordSimilarity(a: string, b: string) {
  const one = new Set(a.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const two = new Set(b.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const common = [...one].filter((word) => two.has(word)).length;
  return common / Math.max(1, new Set([...one, ...two]).size);
}
export function todayLocal() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function isEnglish(value: string) {
  return !hasHangul(value) && /[a-zA-Z]/.test(value);
}

export function sceneScale(scene: Scene, progress: number) {
  if (scene.motion === "pull") return 1.22 - progress * 0.16;
  if (scene.motion === "drift")
    return 1.05 + Math.sin(progress * Math.PI) * 0.08;
  return 1 + progress * 0.22;
}

export function UiText({ ko, en, zh, ja }: { ko: string; en: string; zh: string; ja: string }) {
  const { t } = useLanguage();
  return <>{t(ko, en, zh, ja)}</>;
}

export function SceneCanvas({
  scene,
  label,
  active,
  progress,
  onChange,
}: {
  scene: Scene;
  label: "A" | "B";
  active: boolean;
  progress: number;
  onChange?: (scene: Scene) => void;
}) {
  const update = (field: keyof Scene, value: string) =>
    onChange?.({ ...scene, [field]: value });
  return (
    <section
      className={`scene-panel mood-${scene.mood} ${active ? "live-scene" : ""}`}
    >
      <div className="scene-panel-top">
        <span>SCENE {label}</span>
        <span className="scene-format">1080 × 1920</span>
      </div>
      <div className="scene-canvas-wrap">
        <div
          className="scene-canvas"
          style={{ transform: `scale(${sceneScale(scene, progress)})` }}
        >
          <span className="canvas-local">LOCAL</span>
          <span className="canvas-index">0{label}</span>
          <h2>{scene.headline}</h2>
          <p>{scene.body}</p>
          <strong>{scene.accent}</strong>
          <ul>
            {scene.marks.map((mark, index) => (
              <li
                key={`${mark}-${index}`}
                className={label === "A" ? "bad" : "good"}
              >
                <i>{label === "A" ? "×" : "✓"}</i>
                {mark}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {onChange && (
        <div className="scene-editor">
          <label>
            Headline
            <input
              value={scene.headline}
              onChange={(event) => update("headline", event.target.value)}
            />
          </label>
          <label>
            Body
            <textarea
              rows={3}
              value={scene.body}
              onChange={(event) => update("body", event.target.value)}
            />
          </label>
          <label>
            Accent
            <input
              value={scene.accent}
              onChange={(event) => update("accent", event.target.value)}
            />
          </label>
          <div className="scene-options">
            <label>
              Mood
              <select
                value={scene.mood}
                onChange={(event) =>
                  onChange({ ...scene, mood: event.target.value as Mood })
                }
              >
                <option value="chaos">chaos</option>
                <option value="calm">calm</option>
                <option value="contrast">contrast</option>
              </select>
            </label>
            <label>
              Camera
              <select
                value={scene.motion}
                onChange={(event) =>
                  onChange({ ...scene, motion: event.target.value as Motion })
                }
              >
                <option value="push">push in</option>
                <option value="pull">pull out</option>
                <option value="drift">soft drift</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </section>
  );
}

export function GateStrip({
  gates,
  compact = false,
}: {
  gates: GateResult[];
  compact?: boolean;
}) {
  return (
    <div className={`gate-strip ${compact ? "compact" : ""}`}>
      {gates.map((gate) => (
        <div
          className={`gate-chip ${gate.pass ? "pass" : "fail"}`}
          key={gate.id}
        >
          <span>{gate.pass ? "✓" : "×"}</span>
          <div>
            <b>GATE {gate.id}</b>
            <small>{gate.pass ? gate.passText : gate.failText}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

export type GateResult = {
  id: "A" | "B" | "C";
  pass: boolean;
  passText: string;
  failText: string;
  points: string[];
};

export function useForge() {
  const [project, setProject] = useState<Project>(() => {
    const saved = safeRead<Project>("localVideoProject", blankProject);
    return saved?.sceneA && saved?.sceneB ? saved : blankProject;
  });
  const [packet, setPacket] = useState<Packet>(() =>
    safeRead<Packet>("localVideoPacket", initialPacket),
  );
  const [lastTemplates, setLastTemplates] = useState<string[]>(() =>
    safeRead<string[]>("localVideoTemplates", []),
  );
  const [lastHooks, setLastHooks] = useState<{ hook: string; at: number }[]>(
    () => safeRead<{ hook: string; at: number }[]>("localVideoHooks", []),
  );
  const [slots, setSlots] = useState<Record<string, number>>(() =>
    safeRead<Record<string, number>>("localVideoSlots", {}),
  );
  useEffect(() => {
    window.localStorage.setItem("localVideoProject", JSON.stringify(project));
    window.localStorage.setItem("localVideoPacket", JSON.stringify(packet));
    window.localStorage.setItem(
      "localVideoTemplates",
      JSON.stringify(lastTemplates.slice(0, 7)),
    );
    window.localStorage.setItem(
      "localVideoHooks",
      JSON.stringify(lastHooks.slice(0, 7)),
    );
    window.localStorage.setItem("localVideoSlots", JSON.stringify(slots));
  }, [project, packet, lastTemplates, lastHooks, slots]);
  // Date.now() is impure to call during render, so the "now" used for the
  // 8-hour reuse window is a ticking state value updated from an effect
  // instead -- this also means the gate correctly clears itself if a tab
  // stays open past the 8-hour mark, instead of freezing at mount time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const templateBlocked = lastTemplates.includes(project.presetId);
  const hookBlocked = lastHooks.some(
    (entry) =>
      entry.hook.trim().toLowerCase() === project.hook.trim().toLowerCase() &&
      now - entry.at < 8 * 60 * 60 * 1000,
  );
  const gates = useMemo<GateResult[]>(() => {
    const allCopy = [
      project.sceneA.headline,
      project.sceneA.body,
      project.sceneA.accent,
      project.sceneB.headline,
      project.sceneB.body,
      project.sceneB.accent,
    ];
    const longDeck =
      project.sceneA.body.split("\n").length > 7 ||
      project.sceneB.body.split("\n").length > 7;
    const copyPass = allCopy.every(isEnglish) && !longDeck;
    const similar =
      wordSimilarity(
        `${project.sceneA.headline} ${project.sceneA.body}`,
        `${project.sceneB.headline} ${project.sceneB.body}`,
      ) >= 0.8;
    const scenePass =
      !similar &&
      project.sceneA.motion !== project.sceneB.motion &&
      !project.originalReupload &&
      !templateBlocked &&
      !hookBlocked &&
      project.durationA + project.durationB >= 8 &&
      project.durationA + project.durationB <= 12 &&
      !project.abTest &&
      (slots[todayLocal()] ?? 0) < 2;
    const packetPass = Boolean(
      packet.hook.trim() &&
      packet.body.trim() &&
      packet.tags.filter(Boolean).length &&
      packet.commentPrompt.trim(),
    );
    return [
      {
        id: "A",
        pass: copyPass,
        passText: "English copy, one hook",
        failText: "English only on the reel",
        points: [
          "English only",
          "One-hook dialogue structure",
          "Not a 7-page deck",
          "No ivory textbook treatment",
        ],
      },
      {
        id: "B",
        pass: scenePass,
        passText: "Two worlds. One hard cut.",
        failText: similar
          ? "A and B must be different scenes"
          : project.sceneA.motion === project.sceneB.motion
            ? "Same camera, not a recreate"
            : templateBlocked
              ? "Template used in last 7"
              : hookBlocked
                ? "Hook used in last 8 hours"
                : project.abTest
                  ? "A/B test. Do not Share."
                  : (slots[todayLocal()] ?? 0) >= 2
                    ? "Daily Reel slots are full"
                    : "This would die on the real account.",
        points: [
          "Two distinct 9:16 scenes",
          "Different copy and motion",
          "Hard cut only",
          "No stretched square image",
        ],
      },
      {
        id: "C",
        pass: packetPass,
        passText: "Caption packet ready",
        failText: "Chat-only caption = Gate C fail",
        points: [
          "Hook, body, tags, Comment PROMPT",
          "Up to five tags",
          "Useful and funny",
        ],
      },
    ];
  }, [project, packet, templateBlocked, hookBlocked, slots]);
  const allGreen = gates.every((gate) => gate.pass);
  const recordExport = () => {
    const date = todayLocal();
    setSlots((value) => ({ ...value, [date]: (value[date] ?? 0) + 1 }));
    setLastTemplates((value) =>
      [
        project.presetId,
        ...value.filter((id) => id !== project.presetId),
      ].slice(0, 7),
    );
    setLastHooks((value) =>
      [
        { hook: project.hook, at: Date.now() },
        ...value.filter(
          (entry) => entry.hook.toLowerCase() !== project.hook.toLowerCase(),
        ),
      ].slice(0, 7),
    );
  };
  return {
    project,
    setProject,
    packet,
    setPacket,
    lastTemplates,
    lastHooks,
    slots,
    gates,
    allGreen,
    recordExport,
  };
}
