import type {FC} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {AlertTriangle, RotateCcw} from "lucide-react";
import {CapsuleSwitch} from "@/components/ui/capsule-switch";
import {Checkbox} from "@/components/ui/checkbox";
import {SettingsItem} from "@/components/ui/settings-item";
import type {Paths, PathValue, Settings} from '@/hooks/useSettings';

interface DangerZoneSectionProps {
    settings: Settings;
    updateSetting: <P extends Paths<Settings>>(path: readonly [...P], value: PathValue<Settings, P>) => void;
    busy: boolean;
    onRestoreDefaults: () => void;
}

export const DangerZoneSection: FC<DangerZoneSectionProps> = ({
                                                                  settings,
                                                                  updateSetting,
                                                                  busy,
                                                                  onRestoreDefaults
                                                              }) => {
    return (
        <div className="border border-destructive/50 rounded-lg p-6 bg-destructive/5 dark:bg-destructive/10">
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
                                onCheckedChange={(checked) => updateSetting(['model_config', 'enable_amp'], checked === true)}
                            />
                            <label htmlFor="enable_amp" className="text-sm font-medium cursor-pointer">
                                Enable AMP (Mixed Precision)
                            </label>
                        </div>

                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="agari_guard"
                                checked={settings.model_config.rule_based_agari_guard}
                                onCheckedChange={(checked) => updateSetting(['model_config', 'rule_based_agari_guard'], checked === true)}
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
                            onClick={onRestoreDefaults}
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
    );
};
