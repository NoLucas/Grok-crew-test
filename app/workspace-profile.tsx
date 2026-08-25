'use client';

import { useCallback, useEffect, useState } from 'react';

export type WorkspaceProfile = { workspaceName: string; defaultBotLabel: string };

export const WORKSPACE_PROFILE_KEY = 'localVideoWorkspaceProfile';
export const defaultWorkspaceProfile: WorkspaceProfile = { workspaceName: 'My Video Workspace', defaultBotLabel: 'Local editor bot' };

const storedDraftKeys = [
  'localVideoWorkspaceProfile', 'localVideoWorkspaceLanguage', 'localVideoAgentDesk', 'localVideoAgentSnapshots',
  'localVideoEditLab', 'localVideoCutLog', 'localVideoFinishRack', 'localVideoOfflineBotReturn',
  'localVideoProject', 'localVideoPacket', 'localVideoTemplates', 'localVideoHooks', 'localVideoSlots',
  'nohAgentDesk', 'nohAgentSnapshots', 'nohEditLab', 'nohCutLog', 'nohFinishRack', 'nohOfflineGrokReturn',
  'nohReelForgeLanguage', 'currentProject', 'packet', 'last7Templates', 'last7Hooks', 'slotCountByDate',
];

function clean(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function readProfile(): WorkspaceProfile {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PROFILE_KEY);
    if (!raw) return defaultWorkspaceProfile;
    const parsed = JSON.parse(raw) as Partial<WorkspaceProfile>;
    return { workspaceName: clean(parsed.workspaceName, defaultWorkspaceProfile.workspaceName), defaultBotLabel: clean(parsed.defaultBotLabel, defaultWorkspaceProfile.defaultBotLabel) };
  } catch { return defaultWorkspaceProfile; }
}

export function useWorkspaceProfile() {
  const [profile, setProfile] = useState<WorkspaceProfile>(defaultWorkspaceProfile);
  useEffect(() => {
    const refresh = () => setProfile(readProfile());
    refresh();
    window.addEventListener('local-video-workspace-profile', refresh);
    return () => window.removeEventListener('local-video-workspace-profile', refresh);
  }, []);
  const save = useCallback((next: WorkspaceProfile) => {
    const safe = { workspaceName: clean(next.workspaceName, defaultWorkspaceProfile.workspaceName), defaultBotLabel: clean(next.defaultBotLabel, defaultWorkspaceProfile.defaultBotLabel) };
    window.localStorage.setItem(WORKSPACE_PROFILE_KEY, JSON.stringify(safe));
    setProfile(safe);
    window.dispatchEvent(new Event('local-video-workspace-profile'));
  }, []);
  return { profile, save };
}

export function clearBrowserWorkspaceData() {
  storedDraftKeys.forEach((key) => window.localStorage.removeItem(key));
  document.cookie = 'localVideoWorkspaceLanguage=; path=/; max-age=0; samesite=lax';
  document.cookie = 'nohReelForgeLanguage=; path=/; max-age=0; samesite=lax';
}
