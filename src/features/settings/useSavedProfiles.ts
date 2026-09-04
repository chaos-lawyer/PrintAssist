import { useCallback, useMemo, useState } from 'react';
import { message } from 'antd';
import {
  listSavedPrinterProfiles,
  loadPrinterProfile,
  openPrinterProperties,
} from '../../api/nativeBridge';
import type { PrintSettings } from '../../domain/printSettings';
import {
  applyDriverSettings,
  applyLoadedPersistentProfile,
  formatDriverSettingsSummary,
} from '../../domain/printSettings';
import type {
  PrinterDriverSettings,
  SavedPrinterProfileSummary,
} from '../../shared/contracts/printer';

export interface UseSavedProfilesOptions {
  globalSettings: PrintSettings;
  setGlobalSettings: React.Dispatch<React.SetStateAction<PrintSettings>>;
  commit: (label: string, updater: (curr: any) => any) => void;
}

export function useSavedProfiles(options: UseSavedProfilesOptions) {
  const { globalSettings, setGlobalSettings, commit } = options;

  const [savedProfiles, setSavedProfiles] = useState<SavedPrinterProfileSummary[]>([]);
  const [loadingSavedProfiles, setLoadingSavedProfiles] = useState(false);
  const [sessionProfiles, setSessionProfiles] = useState<
    Record<string, { profileId: string; settings: PrinterDriverSettings; summary: string }>
  >({});
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [managerModalOpen, setManagerModalOpen] = useState(false);
  const [loadingProperties, setLoadingProperties] = useState(false);

  const activeProfile = useMemo(
    () => savedProfiles.find((p) => p.id === globalSettings.persistentProfileId),
    [savedProfiles, globalSettings.persistentProfileId],
  );

  const fetchSavedProfiles = useCallback(async (printerName: string) => {
    if (!printerName) {
      setSavedProfiles([]);
      return [];
    }
    setLoadingSavedProfiles(true);
    try {
      const profiles = await listSavedPrinterProfiles(printerName);
      setSavedProfiles(profiles);
      return profiles;
    } catch (err) {
      console.error('Failed to load saved profiles:', err);
      return [];
    } finally {
      setLoadingSavedProfiles(false);
    }
  }, []);

  const handleOpenPrinterProperties = async () => {
    if (!globalSettings.printerName || loadingProperties) {
      return;
    }
    setLoadingProperties(true);
    try {
      const existingProfile = sessionProfiles[globalSettings.printerName];
      const result = await openPrinterProperties(
        globalSettings.printerName,
        existingProfile?.profileId,
      );

      if (result.status === 'accepted' && result.profileId && result.settings) {
        const profileId = result.profileId;
        const driverSettings = result.settings;
        const summary = formatDriverSettingsSummary(driverSettings);

        setSessionProfiles((prev) => ({
          ...prev,
          [globalSettings.printerName]: {
            profileId,
            settings: driverSettings,
            summary,
          },
        }));

        setGlobalSettings((curr) => {
          const applied = applyDriverSettings(curr, driverSettings, profileId);
          return {
            ...applied,
            profileDirty: Boolean(curr.persistentProfileId),
          };
        });
        message.success(`已同步“${globalSettings.printerName}”驱动设置`);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开打印机属性失败');
    } finally {
      setLoadingProperties(false);
    }
  };

  const handleSelectSavedProfile = async (profileId: string | null) => {
    if (!profileId) {
      commit('重置为默认配置', (curr) => ({
        ...curr,
        globalSettings: {
          ...curr.globalSettings,
          persistentProfileId: undefined,
          persistentProfileName: undefined,
          profileDirty: false,
        },
      }));
      message.info('已切换配置：不使用已保存配置');
      return;
    }
    try {
      const loaded = await loadPrinterProfile(profileId);
      commit(`应用配置“${loaded.persistentProfile.name}”`, (curr) => ({
        ...curr,
        globalSettings: applyLoadedPersistentProfile(curr.globalSettings, loaded),
      }));
      const index = savedProfiles.findIndex((p) => p.id === profileId);
      if (index >= 0) {
        message.info(
          `已切换配置：${loaded.persistentProfile.name} (${index + 1} / ${savedProfiles.length})`,
        );
      } else {
        message.info(`已切换配置：${loaded.persistentProfile.name}`);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载配置失败');
    }
  };

  const handleProfileSaved = (saved: SavedPrinterProfileSummary) => {
    setSaveModalOpen(false);
    setGlobalSettings((curr) => ({
      ...curr,
      persistentProfileId: saved.id,
      persistentProfileName: saved.name,
      profileDirty: false,
    }));
    void fetchSavedProfiles(globalSettings.printerName);
    message.success(`已保存配置“${saved.name}”`);
  };

  return {
    savedProfiles,
    setSavedProfiles,
    loadingSavedProfiles,
    sessionProfiles,
    setSessionProfiles,
    saveModalOpen,
    setSaveModalOpen,
    managerModalOpen,
    setManagerModalOpen,
    loadingProperties,
    activeProfile,
    fetchSavedProfiles,
    handleOpenPrinterProperties,
    handleSelectSavedProfile,
    handleProfileSaved,
  };
}
