import React, {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from "@/components/ui/select";
import {AlertTriangle, RotateCcw} from "lucide-react";
import {CapsuleSwitch} from "@/components/ui/capsule-switch";
import {Checkbox} from "@/components/ui/checkbox";
import {SettingsItem} from "@/components/ui/settings-item";
import {ConfirmationDialog} from "@/components/ui/confirmation-dialog";
import {
    Modal,
    ModalClose,
    ModalContent,
    ModalDescription,
    ModalFooter,
    ModalHeader,
    ModalTitle
} from "@/components/ui/modal";

interface SettingsPanelProps {
    open: boolean;
    onClose: () => void;
    apiBase: string;
}

interface Settings {
    log_level: string;
    majsoul_url: string;
    model: string;
    browser: {
        headless: boolean;
        channel: string;
        window_size: string;
    };
    server: {
        host: string;
        port: number;
    };
    model_config: {
        device: string;
        enable_amp: boolean;
        rule_based_agari_guard: boolean;
        ot: {
            online: boolean;
            server: string;
            api_key: string;
        }
    };
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({open, onClose, apiBase}) => {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [originalSettings, setOriginalSettings] = useState<Settings | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            loadSettings();
        }
    }, [open]);

    const loadSettings = async () => {
        setError(null);
        setBusy(true);
        try {
            const res = await fetch(`${apiBase}/api/settings`, {method: 'GET'});
            const body = await res.json();
            if (!body?.ok) {
                throw new Error(body?.error || 'Failed to load settings');
            }
            setSettings(body.data);
            // Deep clone to avoid reference sharing with nested objects
            setOriginalSettings(JSON.parse(JSON.stringify(body.data)));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const saveSettings = async () => {
        if (!settings) return;
        setError(null);
        setBusy(true);
        try {
            const res = await fetch(`${apiBase}/api/settings`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(settings),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body?.ok) {
                throw new Error(body?.error || `Save failed (${res.status})`);
            }

            setOriginalSettings(JSON.parse(JSON.stringify(settings)));
            alert('Settings saved. Please restart Akagi backend to apply.');
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const [isRestoreDialogOpen, setIsRestoreDialogOpen] = useState(false);

    const handleRestoreClick = () => {
        setIsRestoreDialogOpen(true);
    };

    const confirmRestoreDefaults = async () => {
        console.log('Restore Defaults confirmed');
        setError(null);
        setBusy(true);
        try {
            console.log('Fetching:', `${apiBase}/api/settings/reset`);
            const res = await fetch(`${apiBase}/api/settings/reset`, {
                method: 'POST',
            });

            let body;
            try {
                body = await res.json();
            } catch (e) {
                if (!res.ok) throw new Error(`Server returned ${res.status} ${res.statusText}`);
                throw e;
            }

            console.log('Response:', body);
            if (!body?.ok) {
                throw new Error(body?.error || 'Failed to restore settings');
            }

            setSettings(body.data);
            setOriginalSettings(JSON.parse(JSON.stringify(body.data)));
            alert('Settings restored to defaults. Please restart Akagi backend to apply.');
        } catch (e) {
            console.error('Restore Defaults error:', e);
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    // Helper to update nested state
    const updateSetting = (path: (string | number)[], value: any) => {
        setSettings((prev) => {
            if (!prev) return null;
            // Deep clone previous state to avoid mutating shared references
            const newSettings = JSON.parse(JSON.stringify(prev));
            let current: any = newSettings;
            for (let i = 0; i < path.length - 1; i++) {
                current = current[path[i]];
            }
            current[path[path.length - 1]] = value;
            return newSettings;
        });
    };

    if (!open) return null;

    if (!settings && busy) {
        return (
            <Modal open={true} onOpenChange={onClose} className="max-w-md">
                <ModalContent className="flex items-center justify-center p-8">
                    Loading settings...
                </ModalContent>
            </Modal>
        );
    }

    // Connection Error State
    if (!settings && error) {
        return (
            <Modal open={true} onOpenChange={onClose} className="max-w-md">
                <ModalHeader>
                    <ModalTitle className="flex items-center gap-2 text-destructive">
                        <AlertTriangle className="h-5 w-5"/> Connection Failed
                    </ModalTitle>
                </ModalHeader>
                <ModalContent>
                    <p className="text-muted-foreground mb-4">
                        Could not connect to the backend server. Is Akagi running?
                    </p>
                    <div className="p-3 bg-muted rounded text-xs font-mono break-all text-left">
                        {error}
                    </div>
                </ModalContent>
                <ModalFooter>
                    <Button variant="outline" onClick={onClose}>
                        Close
                    </Button>
                    <Button onClick={loadSettings} disabled={busy}>
                        {busy ? 'Connecting...' : 'Try Again'}
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }

    if (!settings) return null;

    return (
        <>
            <Modal open={open} onOpenChange={onClose} className="max-w-4xl max-h-[90vh]">
                <ModalClose onClick={onClose}/>
                <ModalHeader>
                    <ModalTitle>Akagi NG Settings</ModalTitle>
                    <ModalDescription>Configuration Panel</ModalDescription>
                </ModalHeader>

                <ModalContent>
                    <div className="space-y-8">
                        {error && (
                            <div
                                className="p-3 rounded bg-destructive/10 text-destructive text-sm border border-destructive/20 flex gap-2 items-center">
                                <AlertTriangle className="h-4 w-4"/>
                                {error}
                            </div>
                        )}

                        {/* General Section */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold border-b border-border pb-2">General</h3>

                                <SettingsItem label="Log Level">
                                    <Select
                                        value={settings.log_level}
                                        onValueChange={(val) => updateSetting(['log_level'], val)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select level"/>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="TRACE">TRACE</SelectItem>
                                            <SelectItem value="DEBUG">DEBUG</SelectItem>
                                            <SelectItem value="INFO">INFO</SelectItem>
                                            <SelectItem value="WARNING">WARNING</SelectItem>
                                            <SelectItem value="ERROR">ERROR</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </SettingsItem>

                                <SettingsItem label="Majsoul URL">
                                    <Input
                                        value={settings.majsoul_url}
                                        onChange={(e) => updateSetting(['majsoul_url'], e.target.value)}
                                    />
                                </SettingsItem>

                                <SettingsItem label="Model">
                                    <Input
                                        value={settings.model}
                                        onChange={(e) => updateSetting(['model'], e.target.value)}
                                    />
                                </SettingsItem>
                            </div>

                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold border-b border-border pb-2">Browser</h3>

                                <SettingsItem label="Browser">
                                    <Select
                                        value={settings.browser.channel}
                                        onValueChange={(val) => updateSetting(['browser', 'channel'], val)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue/>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="chrome">Chrome</SelectItem>
                                            <SelectItem value="msedge">Edge</SelectItem>
                                            <SelectItem value="chromium">Chromium</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </SettingsItem>

                                <SettingsItem label="Window Size">
                                    <Select
                                        value={settings.browser.window_size || "default"}
                                        onValueChange={(val) => updateSetting(['browser', 'window_size'], val === "default" ? "" : val)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select resolution"/>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="default">Default</SelectItem>
                                            <SelectItem value="maximized">Maximized</SelectItem>
                                            <SelectItem value="1280,720">1280x720</SelectItem>
                                            <SelectItem value="1920,1080">1920x1080</SelectItem>
                                            <SelectItem value="2560,1440">2560x1440</SelectItem>
                                            <SelectItem value="3840,2160">3840x2160</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </SettingsItem>

                                <SettingsItem label="Headless Mode">
                                    <CapsuleSwitch
                                        checked={settings.browser.headless}
                                        onCheckedChange={(val) => updateSetting(['browser', 'headless'], val)}
                                        labelOn="Enabled"
                                        labelOff="Disabled"
                                    />
                                </SettingsItem>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold border-b border-border pb-2">Server</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <SettingsItem label="Host">
                                    <Input
                                        value={settings.server.host}
                                        onChange={(e) => updateSetting(['server', 'host'], e.target.value)}
                                    />
                                </SettingsItem>
                                <SettingsItem label="Port">
                                    <Input
                                        type="number"
                                        value={settings.server.port}
                                        onChange={(e) => updateSetting(['server', 'port'], parseInt(e.target.value))}
                                    />
                                </SettingsItem>
                            </div>
                        </div>

                        {/* Danger Zone */}
                        <div
                            className="border border-destructive/50 rounded-lg p-6 bg-destructive/5 dark:bg-destructive/10">
                            <h3 className="text-lg font-bold text-destructive flex items-center gap-2 mb-2">
                                <AlertTriangle className="h-5 w-5"/>
                                Danger Zone
                            </h3>
                            <p className="text-sm text-muted-foreground mb-6">
                                Changing these settings may impact bot performance or correctness. Proceed with caution.
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-6">
                                    <SettingsItem label="Device">
                                        <Select
                                            value={settings.model_config.device}
                                            onValueChange={(val) => updateSetting(['model_config', 'device'], val)}
                                        >
                                            <SelectTrigger>
                                                <SelectValue/>
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="auto">Auto</SelectItem>
                                                <SelectItem value="cpu">CPU</SelectItem>
                                                <SelectItem value="cuda">CUDA</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </SettingsItem>

                                    <div className="space-y-3 pt-2">
                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="enable_amp"
                                                checked={settings.model_config.enable_amp}
                                                onCheckedChange={(checked) => updateSetting(['model_config', 'enable_amp'], checked)}
                                            />
                                            <label htmlFor="enable_amp" className="text-sm font-medium cursor-pointer">
                                                Enable AMP (Mixed Precision)
                                            </label>
                                        </div>

                                        <div className="flex items-center space-x-2">
                                            <Checkbox
                                                id="agari_guard"
                                                checked={settings.model_config.rule_based_agari_guard}
                                                onCheckedChange={(checked) => updateSetting(['model_config', 'rule_based_agari_guard'], checked)}
                                            />
                                            <label htmlFor="agari_guard" className="text-sm font-medium cursor-pointer">
                                                Rule-based Agari Guard
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4 border-l border-border pl-6">

                                    <SettingsItem label="Online Model">
                                        <CapsuleSwitch
                                            checked={settings.model_config.ot.online}
                                            onCheckedChange={(val) => updateSetting(['model_config', 'ot', 'online'], val)}
                                            labelOn="Enabled"
                                            labelOff="Disabled"
                                        />
                                    </SettingsItem>

                                    {settings.model_config.ot.online && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                            <SettingsItem label="Server URL">
                                                <Input
                                                    value={settings.model_config.ot.server}
                                                    onChange={(e) => updateSetting(['model_config', 'ot', 'server'], e.target.value)}
                                                    placeholder="http://..."
                                                />
                                            </SettingsItem>
                                            <SettingsItem label="API Key">
                                                <Input
                                                    type="password"
                                                    value={settings.model_config.ot.api_key}
                                                    onChange={(e) => updateSetting(['model_config', 'ot', 'api_key'], e.target.value)}
                                                    placeholder="API Key"
                                                />
                                            </SettingsItem>
                                        </div>
                                    )}

                                    <div className="pt-4 flex justify-start">
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={handleRestoreClick}
                                            disabled={busy}
                                            className="w-full sm:w-auto"
                                        >
                                            <RotateCcw className="mr-2 h-4 w-4"/>
                                            Restore Defaults
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </ModalContent>

                <ModalFooter>
                    {JSON.stringify(settings) !== JSON.stringify(originalSettings) && (
                        <Button variant="secondary" onClick={() => setSettings(originalSettings)} disabled={busy}>
                            Discard Changes
                        </Button>
                    )}
                    <Button onClick={saveSettings} disabled={busy}>
                        Save Changes
                    </Button>
                </ModalFooter>
            </Modal>

            <ConfirmationDialog
                open={isRestoreDialogOpen}
                onOpenChange={setIsRestoreDialogOpen}
                title="Restore Default Settings"
                description="Are you sure you want to restore all settings to their default values? This action cannot be undone and you will need to restart the backend."
                onConfirm={confirmRestoreDefaults}
                variant="destructive"
                confirmText="Restore"
            />
        </>
    );
};

export default SettingsPanel;