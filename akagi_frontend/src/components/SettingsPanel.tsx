import type {FC, ReactNode} from 'react';
import {Component, Suspense, use, useMemo, useState} from 'react';
import {Button} from '@/components/ui/button';
import {AlertTriangle, Loader2} from "lucide-react";
import {ConfirmationDialog} from "@/components/ui/confirmation-dialog";
import {Modal, ModalClose, ModalContent, ModalDescription, ModalHeader, ModalTitle} from "@/components/ui/modal";
import type {Settings} from '@/hooks/useSettings';
import {fetchSettingsApi, useSettings} from '@/hooks/useSettings';
import {GeneralSection} from './settings/GeneralSection';
import {BrowserSection} from './settings/BrowserSection';
import {ServerSection} from './settings/ServerSection';
import {DangerZoneSection} from './settings/DangerZoneSection';


class SettingsErrorBoundary extends Component<{ children: ReactNode, fallback: (error: Error) => ReactNode }, {
    hasError: boolean,
    error: Error | null
}> {
    constructor(props: { children: ReactNode, fallback: (error: Error) => ReactNode }) {
        super(props);
        this.state = {hasError: false, error: null};
    }

    static getDerivedStateFromError(error: Error) {
        return {hasError: true, error};
    }

    render() {
        if (this.state.hasError && this.state.error) {
            return this.props.fallback(this.state.error);
        }
        return this.props.children;
    }
}

interface SettingsPanelProps {
    open: boolean;
    onClose: () => void;
    apiBase: string;
}

interface SettingsFormProps {
    apiBase: string;
    onClose: () => void;
    settingsPromise: Promise<Settings>;
}

const SettingsForm = ({apiBase, onClose, settingsPromise}: SettingsFormProps) => {
    const initialSettings = use(settingsPromise);

    const {
        settings,
        originalSettings,
        busy,
        error: saveError,
        updateSetting,
        saveSettings,
        restoreDefaults,
        discardChanges
    } = useSettings(apiBase, initialSettings);

    const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);

    const handleSave = () => {
        saveSettings(() => onClose());
    };

    if (!settings) return null;

    return (
        <>
            <div className="space-y-8">
                {saveError && (
                    <div
                        className="p-3 rounded bg-destructive/10 text-destructive text-sm border border-destructive/20 flex gap-2 items-center">
                        <AlertTriangle className="h-4 w-4"/>
                        {saveError}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <GeneralSection settings={settings} updateSetting={updateSetting}/>
                    <BrowserSection settings={settings} updateSetting={updateSetting}/>
                </div>

                <ServerSection settings={settings} updateSetting={updateSetting}/>

                <DangerZoneSection
                    settings={settings}
                    updateSetting={updateSetting}
                    busy={busy}
                    onRestoreDefaults={() => setIsRestoreDialogOpen(true)}
                />
            </div>

            <div className="flex items-center justify-end gap-2 mt-8">
                {JSON.stringify(settings) !== JSON.stringify(originalSettings) && (
                    <Button variant="secondary" onClick={discardChanges} disabled={busy}>
                        Discard Changes
                    </Button>
                )}
                <Button onClick={handleSave} disabled={busy}>
                    Save Changes
                </Button>
            </div>

            <ConfirmationDialog
                open={isRestoreDialogOpen}
                onOpenChange={setIsRestoreDialogOpen}
                title="Restore Default Settings"
                description="Are you sure you want to restore all settings to their default values? This action cannot be undone and you will need to restart the backend."
                onConfirm={restoreDefaults}
                variant="destructive"
                confirmText="Restore"
            />
        </>
    );
};

const SettingsPanel: FC<SettingsPanelProps> = ({open, onClose, apiBase}) => {
    const settingsPromise = useMemo(() => {
        if (open) {
            return fetchSettingsApi(apiBase);
        }
        return null;
    }, [open, apiBase]);

    if (!open) return null;

    return (
        <Modal open={open} onOpenChange={onClose} className="max-w-4xl max-h-[90vh]">
            <ModalClose onClick={onClose}/>
            <ModalHeader>
                <ModalTitle>Akagi NG Settings</ModalTitle>
                <ModalDescription>Configuration Panel</ModalDescription>
            </ModalHeader>

            <ModalContent>
                <SettingsErrorBoundary
                    fallback={(error) => (
                        <div className="flex flex-col items-center justify-center p-8 text-center">
                            <AlertTriangle className="h-10 w-10 text-destructive mb-4"/>
                            <h3 className="text-lg font-semibold text-destructive mb-2">Connection Failed</h3>
                            <p className="text-muted-foreground mb-4 max-w-xs">
                                Could not load settings. Please check if the backend is running.
                            </p>
                            <div className="p-3 bg-muted rounded text-xs font-mono break-all text-left mb-4 w-full">
                                {error.message}
                            </div>
                            <Button onClick={onClose}>
                                Close
                            </Button>
                        </div>
                    )}
                >
                    <Suspense
                        fallback={
                            <div
                                className="flex flex-col items-center justify-center p-12 space-y-4 text-muted-foreground">
                                <Loader2 className="h-8 w-8 animate-spin"/>
                                <p>Loading settings...</p>
                            </div>
                        }
                    >
                        {settingsPromise &&
                            <SettingsForm apiBase={apiBase} onClose={onClose} settingsPromise={settingsPromise}/>}
                    </Suspense>
                </SettingsErrorBoundary>
            </ModalContent>
        </Modal>
    );
};

export default SettingsPanel;